/**
 * The cost model.
 *
 * Every constant is in milliseconds and is measured on the actual device by
 * `src/engine/calibrate.ts`, not hardcoded — the defaults below exist only so unit tests
 * and a pre-calibration first frame have something to work with.
 *
 * The part that matters is the second term of the objective:
 *
 *     cost(plan) = buildMs + horizonSec * Σ_params rate_p * rebindMs(stage owning p)
 *
 * Placement chosen on build cost alone would push almost everything into SQL, because
 * DuckDB is fast and uploading less is always better. What makes the decision interesting
 * is that a *parameter* has a change rate: a value on a slider is re-bound many times per
 * second, and where its consumers live decides whether that costs a 16-byte uniform write
 * or a requery plus a re-upload. That is the whole "parameterized query" idea expressed as
 * an objective function rather than a rule.
 */

export interface CostConstants {
  /** Fixed per-query overhead in DuckDB-Wasm: parse, bind, dispatch to the worker. */
  sqlFixedMs: number;
  /** Marginal cost of scanning and projecting one row of one column. */
  sqlPerRowPerColMs: number;
  /** Marginal cost of evaluating one SQL scalar operation over one row. */
  sqlPerRowPerOpMs: number;
  /** writeBuffer throughput. */
  uploadPerByteMs: number;
  /** Per-writeBuffer-call overhead; matters because chunked columns issue one per batch. */
  uploadPerCallMs: number;
  /** CPU cost of narrowing one element (f64 -> f32, or consuming a validity bitmap). */
  castPerElemMs: number;
  /** CPU cost of one interleave write, for vector attributes built in SQL. */
  interleavePerElemMs: number;
  /** Fixed cost of a compute dispatch. */
  kernelFixedMs: number;
  /** Marginal GPU cost of one scalar operation over one row. */
  kernelPerRowPerOpMs: number;
  /** Marginal CPU cost of one generated-JS scalar operation over one row. */
  cpuPerRowPerOpMs: number;
  /** Cost of rebinding a uniform: the cheap path. */
  uniformWriteMs: number;
  /** Fixed per-frame render cost: pass setup, clear, present. */
  renderFixedMs: number;
  /**
   * Marginal render cost per instance per frame.
   *
   * Without this term the model prices *building* a plan and ignores *drawing* it, which
   * systematically undervalues row reduction: a filter evaluated as a GPU discard mask
   * keeps every row, and those rows are re-rasterized every frame for as long as the view
   * is open. Charging only the build made a 300k-instance masked plan look cheaper than a
   * 99k-instance filtered one.
   */
  renderPerInstanceMs: number;
  /** Fixed cost of one GPU compaction pass: predicate, scan and count, as encoded. */
  compactFixedMs: number;
  /** Marginal cost of compacting one row. */
  compactPerRowMs: number;
  /**
   * One-time cost of compiling a compaction for a row count. Paid at build and again after
   * a requery, because the engine's outputs are sized to the rows.
   */
  compactCompileMs: number;
  /** Frames per second assumed when amortizing render cost. */
  frameRateHz: number;
  /** How far ahead to amortize parameter changes and rendering. */
  horizonSec: number;
}

/**
 * Order-of-magnitude defaults derived from the sweep recorded in FINDINGS.md on one
 * machine. Replaced at boot by `calibrate()`; kept only as a starting point.
 */
export const DEFAULT_COSTS: CostConstants = {
  sqlFixedMs: 1.5,
  sqlPerRowPerColMs: 9e-6,
  sqlPerRowPerOpMs: 3e-6,
  uploadPerByteMs: 3.4e-7,
  uploadPerCallMs: 0.004,
  castPerElemMs: 1.7e-6,
  interleavePerElemMs: 2.0e-6,
  kernelFixedMs: 0.05,
  kernelPerRowPerOpMs: 4e-7,
  cpuPerRowPerOpMs: 6e-6,
  uniformWriteMs: 0.01,
  renderFixedMs: 0.05,
  renderPerInstanceMs: 6.3e-6,
  // luma.gl GPU Dataframe on Apple Metal-3 (FINDINGS §12): 0.33 ms at 100k rows and 1.58 ms at
  // 4M, filter only, drained. Compile is the warm figure; the first one is ~5x that.
  compactFixedMs: 0.3,
  compactPerRowMs: 3.1e-7,
  compactCompileMs: 25,
  frameRateHz: 60,
  horizonSec: 4,
};

export type Stage = 'sql' | 'cpu' | 'gpu';

/** One line of a cost estimate, so the EXPLAIN pane can show where the time goes. */
export interface CostTerm {
  label: string;
  ms: number;
}

export interface CostBreakdown {
  terms: CostTerm[];
  buildMs: number;
  interactMs: number;
  totalMs: number;
  /** Bytes of attribute buffers this plan needs resident on the GPU. */
  gpuBytes: number;
}

export function emptyBreakdown(): CostBreakdown {
  return { terms: [], buildMs: 0, interactMs: 0, totalMs: 0, gpuBytes: 0 };
}

export class CostAccumulator {
  private terms: CostTerm[] = [];
  private build = 0;
  private interact = 0;
  private bytes = 0;

  addBuild(label: string, ms: number): void {
    if (ms === 0) return;
    this.build += ms;
    this.push(label, ms);
  }

  addInteract(label: string, ms: number): void {
    if (ms === 0) return;
    this.interact += ms;
    this.push(label, ms);
  }

  addGpuBytes(bytes: number): void {
    this.bytes += bytes;
  }

  private push(label: string, ms: number): void {
    const existing = this.terms.find((t) => t.label === label);
    if (existing) existing.ms += ms;
    else this.terms.push({ label, ms });
  }

  result(): CostBreakdown {
    return {
      terms: [...this.terms].sort((a, b) => b.ms - a.ms),
      buildMs: this.build,
      interactMs: this.interact,
      totalMs: this.build + this.interact,
      gpuBytes: this.bytes,
    };
  }
}

// ---------------------------------------------------------------------------
// Individual cost functions
// ---------------------------------------------------------------------------

export function sqlScanMs(c: CostConstants, rows: number, columns: number, ops: number): number {
  return c.sqlFixedMs + rows * columns * c.sqlPerRowPerColMs + rows * ops * c.sqlPerRowPerOpMs;
}

/**
 * Upload cost. `chunks` is the number of Arrow record batches, because DuckDB-Wasm
 * returns ~one per 2048 rows and each becomes its own writeBuffer call — a per-call term
 * that a naive model would miss entirely.
 */
export function uploadMs(c: CostConstants, bytes: number, chunks: number): number {
  return bytes * c.uploadPerByteMs + chunks * c.uploadPerCallMs;
}

/** CPU narrowing, only for f64 / nullable columns. */
export function castMs(c: CostConstants, elements: number): number {
  return elements * c.castPerElemMs;
}

/** CPU interleave, only for vector attributes assembled from separate SQL columns. */
export function interleaveMs(c: CostConstants, elements: number): number {
  return elements * c.interleavePerElemMs;
}

export function kernelMs(c: CostConstants, rows: number, ops: number): number {
  return c.kernelFixedMs + rows * ops * c.kernelPerRowPerOpMs;
}

export function cpuEvalMs(c: CostConstants, rows: number, ops: number): number {
  return rows * ops * c.cpuPerRowPerOpMs;
}

export function compactMs(c: CostConstants, rows: number): number {
  return c.compactFixedMs + rows * c.compactPerRowMs;
}

/** One frame of drawing `instances` points. */
export function renderFrameMs(c: CostConstants, instances: number): number {
  return c.renderFixedMs + instances * c.renderPerInstanceMs;
}

/**
 * Cost of re-binding one parameter once, given the stage that consumes it.
 *
 * This is the asymmetry the whole design turns on:
 *   gpu -> write a uniform and redispatch
 *   cpu -> re-run the generated JS loop over every row, then re-upload
 *   sql -> re-execute the prepared statement, re-cast, re-upload
 */
export function rebindMs(
  c: CostConstants,
  stage: Stage,
  rows: number,
  ops: number,
  bytes: number,
  chunks: number,
  castElements: number,
): number {
  switch (stage) {
    case 'gpu':
      return c.uniformWriteMs + kernelMs(c, rows, ops);
    case 'cpu':
      return cpuEvalMs(c, rows, ops) + uploadMs(c, bytes, 1);
    case 'sql':
      return sqlScanMs(c, rows, 1, ops) + castMs(c, castElements) + uploadMs(c, bytes, chunks);
  }
}

/** Arrow record batches DuckDB-Wasm will return for a row count. Measured at 2048. */
export const DUCKDB_BATCH_ROWS = 2048;

export function estimateChunks(rows: number): number {
  return Math.max(1, Math.ceil(rows / DUCKDB_BATCH_ROWS));
}
