import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COSTS, CostAccumulator, emptyBreakdown,
  sqlScanMs, uploadMs, castMs, interleaveMs, kernelMs, cpuEvalMs, renderFrameMs,
  estimateChunks, DUCKDB_BATCH_ROWS, type CostConstants,
} from './cost.js';

/**
 * The cost model does not need to be accurate to be useful — it needs to be *monotonic* and
 * to have the right shape. If more rows could ever cost less, the optimizer's argmin becomes
 * meaningless, so monotonicity in every input is what these tests pin. Absolute accuracy is
 * checked against real hardware in the browser suite instead.
 */

const c = DEFAULT_COSTS;

describe('constants', () => {
  it('are all finite and positive', () => {
    for (const [name, value] of Object.entries(c)) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  it('order the engines the way the architecture claims', () => {
    // The whole design rests on a GPU op being cheaper per row than a CPU op, and a uniform
    // rebind being cheaper than either. If a default ever inverted these the planner would
    // still "work" while recommending nonsense.
    expect(c.kernelPerRowPerOpMs).toBeLessThan(c.cpuPerRowPerOpMs);
    expect(c.uniformWriteMs).toBeLessThan(c.sqlFixedMs);
  });
});

describe('monotonicity', () => {
  it('sqlScanMs grows with rows, columns and ops', () => {
    expect(sqlScanMs(c, 2e6, 4, 10)).toBeGreaterThan(sqlScanMs(c, 1e6, 4, 10));
    expect(sqlScanMs(c, 1e6, 8, 10)).toBeGreaterThan(sqlScanMs(c, 1e6, 4, 10));
    expect(sqlScanMs(c, 1e6, 4, 20)).toBeGreaterThan(sqlScanMs(c, 1e6, 4, 10));
  });

  it('sqlScanMs charges its fixed cost even for zero rows', () => {
    expect(sqlScanMs(c, 0, 1, 0)).toBeCloseTo(c.sqlFixedMs, 9);
  });

  it('uploadMs grows with bytes and with call count', () => {
    expect(uploadMs(c, 2e6, 1)).toBeGreaterThan(uploadMs(c, 1e6, 1));
    // The per-call term is why chunked uploads are not free: 500 batches cost more than 1.
    expect(uploadMs(c, 1e6, 500)).toBeGreaterThan(uploadMs(c, 1e6, 1));
  });

  it.each([
    ['castMs', castMs],
    ['interleaveMs', interleaveMs],
  ])('%s is linear in element count', (_name, fn) => {
    expect(fn(c, 2000)).toBeCloseTo(2 * fn(c, 1000), 9);
    expect(fn(c, 0)).toBe(0);
  });

  it('kernelMs and cpuEvalMs grow with rows and ops', () => {
    expect(kernelMs(c, 2e6, 5)).toBeGreaterThan(kernelMs(c, 1e6, 5));
    expect(kernelMs(c, 1e6, 10)).toBeGreaterThan(kernelMs(c, 1e6, 5));
    expect(cpuEvalMs(c, 2e6, 5)).toBeGreaterThan(cpuEvalMs(c, 1e6, 5));
    expect(cpuEvalMs(c, 1e6, 10)).toBeGreaterThan(cpuEvalMs(c, 1e6, 5));
  });

  it('a kernel dispatch costs its fixed overhead at zero rows, a cpu loop does not', () => {
    expect(kernelMs(c, 0, 5)).toBeCloseTo(c.kernelFixedMs, 9);
    expect(cpuEvalMs(c, 0, 5)).toBe(0);
  });

  it('renderFrameMs grows with instances', () => {
    // This term is the reason a real filter beats a discard mask; without it the model
    // preferred keeping 3x the rows.
    expect(renderFrameMs(c, 300_000)).toBeGreaterThan(renderFrameMs(c, 100_000));
    expect(renderFrameMs(c, 0)).toBeCloseTo(c.renderFixedMs, 9);
  });

  it('a plan drawing fewer instances is cheaper to render over any horizon', () => {
    const frames = c.horizonSec * c.frameRateHz;
    expect(frames * renderFrameMs(c, 99_000)).toBeLessThan(frames * renderFrameMs(c, 300_000));
  });
});

describe('estimateChunks', () => {
  it('matches DuckDB-Wasm’s measured 2048-row batches', () => {
    expect(DUCKDB_BATCH_ROWS).toBe(2048);
    expect(estimateChunks(2048)).toBe(1);
    expect(estimateChunks(2049)).toBe(2);
    expect(estimateChunks(300_000)).toBe(Math.ceil(300_000 / 2048));
  });

  it('never returns zero, so the per-call term is always charged', () => {
    expect(estimateChunks(0)).toBe(1);
    expect(estimateChunks(1)).toBe(1);
  });

  it('is close to what a 300k-row query actually returned', () => {
    // The observed figure from the demo was 147 batches for 300k rows.
    expect(estimateChunks(300_000)).toBe(147);
  });
});

describe('CostAccumulator', () => {
  it('separates build from amortized interaction', () => {
    const acc = new CostAccumulator();
    acc.addBuild('query', 10);
    acc.addInteract('rebind', 4);
    const r = acc.result();
    expect(r.buildMs).toBe(10);
    expect(r.interactMs).toBe(4);
    expect(r.totalMs).toBe(14);
  });

  it('merges repeated labels instead of listing them twice', () => {
    const acc = new CostAccumulator();
    acc.addBuild('upload', 3);
    acc.addBuild('upload', 2);
    const r = acc.result();
    expect(r.terms).toHaveLength(1);
    expect(r.terms[0]).toEqual({ label: 'upload', ms: 5 });
  });

  it('sorts terms by cost so the explain pane leads with what matters', () => {
    const acc = new CostAccumulator();
    acc.addBuild('small', 1);
    acc.addBuild('big', 100);
    acc.addBuild('medium', 10);
    expect(acc.result().terms.map((t) => t.label)).toEqual(['big', 'medium', 'small']);
  });

  it('drops zero-cost terms rather than cluttering the breakdown', () => {
    const acc = new CostAccumulator();
    acc.addBuild('nothing', 0);
    acc.addInteract('also nothing', 0);
    expect(acc.result().terms).toEqual([]);
  });

  it('accumulates gpu bytes independently of time', () => {
    const acc = new CostAccumulator();
    acc.addGpuBytes(1000);
    acc.addGpuBytes(2000);
    const r = acc.result();
    expect(r.gpuBytes).toBe(3000);
    expect(r.totalMs).toBe(0);
  });

  it('emptyBreakdown is a usable zero', () => {
    const r = emptyBreakdown();
    expect(r).toMatchObject({ buildMs: 0, interactMs: 0, totalMs: 0, gpuBytes: 0 });
    expect(r.terms).toEqual([]);
  });
});

describe('the objective a plan is chosen by', () => {
  /** Mirrors what optimizer.ts assembles, so the shape is asserted independently. */
  const objective = (rows: number, gpuOps: number, cost: CostConstants) =>
    sqlScanMs(cost, rows, 4, 0)
    + uploadMs(cost, rows * 4 * 4, estimateChunks(rows))
    + kernelMs(cost, rows, gpuOps)
    + cost.horizonSec * cost.frameRateHz * renderFrameMs(cost, rows);

  it('is monotonic in row count', () => {
    expect(objective(1e6, 20, c)).toBeGreaterThan(objective(1e5, 20, c));
  });

  it('is dominated by rendering over a long horizon', () => {
    // Rendering recurs; building happens once. A long horizon must make row count matter
    // more than build cost, which is precisely why filter placement is data-dependent.
    const short = { ...c, horizonSec: 0.1 };
    const long = { ...c, horizonSec: 60 };
    const ratioShort = objective(1e6, 20, short) / objective(1e5, 20, short);
    const ratioLong = objective(1e6, 20, long) / objective(1e5, 20, long);
    expect(ratioLong).toBeGreaterThan(ratioShort);
  });

  it('zeroing the render term removes that pressure entirely', () => {
    const noRender = { ...c, renderFixedMs: 0, renderPerInstanceMs: 0 };
    const withRender = objective(1e6, 20, c) - objective(1e5, 20, c);
    const without = objective(1e6, 20, noRender) - objective(1e5, 20, noRender);
    expect(without).toBeLessThan(withRender);
  });
});
