/**
 * Phase 2 of planning: choose where each node runs, by cost.
 *
 * The search space is small for a provable reason. SQL cannot read a GPU buffer, and GPU
 * output cannot return to the CPU without a readback, so in topological order the stages
 * must appear as `SQL* CPU* GPU*`. An assignment is therefore a pair of boundary indices
 * `(i, j)` — nodes `[0,i)` in SQL, `[i,j)` on the CPU, `[j,n)` on the GPU — and there are
 * only O(n²) of them. So this enumerates *every* candidate and prices it exactly, rather
 * than descending a heuristic and hoping.
 *
 * Two things the cost model gets right that a rule cannot:
 *
 *   1. Only a SQL filter removes rows. A filter placed later becomes a discard mask, so
 *      every downstream stage pays for rows that will never be drawn, and the upload pays
 *      for them too. That makes filter placement depend on *selectivity*, which is a
 *      statistic, not a rule.
 *   2. A parameter has a change rate. Where its consumers live decides whether moving a
 *      slider costs a 16-byte uniform write or a requery plus a re-upload. Minimising
 *      build cost alone would push nearly everything into SQL; minimising build plus
 *      amortised interaction is what makes the answer interesting.
 */

import type { Analysis, AnalyzedNode, Stage } from './analyze.js';
import { PlanError, externalAttributes } from './analyze.js';
import {
  type CostConstants, CostAccumulator, type CostBreakdown,
  sqlScanMs, uploadMs, castMs, interleaveMs, kernelMs, cpuEvalMs, renderFrameMs, compactMs,
  estimateChunks,
} from './cost.js';
import { compactable } from './expr.js';
import { type SourceStats, estimateSelectivity, DEFAULT_SELECTIVITY } from './stats.js';
import type { TargetCaps } from './target.js';
import { packedColorName, positionFormat } from './packing.js';

export type Policy = 'cost' | 'auto' | 'sql-first' | 'gpu-first';

export interface Assignment {
  /** Nodes [0, sqlEnd) run in SQL. */
  sqlEnd: number;
  /** Nodes [sqlEnd, cpuEnd) run on the CPU; [cpuEnd, n) on the GPU. */
  cpuEnd: number;
  /**
   * GPU-stage filters run on the target's compaction engine instead of writing a discard
   * mask: rows are removed on the GPU and drawn with `drawIndirect`. Only offered when
   * `caps.compaction` is set and every GPU-stage filter is `compactable`.
   */
  compact?: boolean;
}

export function sameAssignment(a: Assignment, b: Assignment): boolean {
  return a.sqlEnd === b.sqlEnd && a.cpuEnd === b.cpuEnd && Boolean(a.compact) === Boolean(b.compact);
}

export interface Candidate {
  assignment: Assignment;
  legal: boolean;
  /** Why it was rejected, when illegal. */
  reason?: string;
  cost?: CostBreakdown;
  /** Estimated rows leaving the SQL stage. */
  sqlRows?: number;
  /**
   * Storage buffers the fused kernel would bind.
   *
   * Exposed so it can be compared against what `buildKernel` actually emits: these are two
   * implementations of the same rule, and if they drift the optimizer will happily choose a
   * plan that cannot be compiled.
   */
  storageBindings?: number;
  label: string;
}

export interface OptimizeContext {
  costs: CostConstants;
  caps: TargetCaps;
  stats?: SourceStats;
  params: Record<string, number>;
  policy: Policy;
}

export interface OptimizeResult {
  chosen: Assignment;
  candidates: Candidate[];
  /** How the choice was made, for the EXPLAIN pane. */
  method: 'cost' | 'policy';
  /** Estimated rows leaving SQL, used downstream for reporting. */
  sqlRows: number;
  estimatedSelectivity: { nodeId: string; selectivity: number; pushedToSql: boolean }[];
  notes: string[];
}

export function optimize(analysis: Analysis, ctx: OptimizeContext): OptimizeResult {
  const n = analysis.order.length;
  const notes: string[] = [];

  // Cost-based planning needs statistics. Without them, fall back to the rule-based
  // policy rather than pricing plans against invented numbers.
  const useCost = ctx.policy === 'cost' && ctx.stats !== undefined;
  if (ctx.policy === 'cost' && !ctx.stats) {
    notes.push('no source statistics available; fell back to the rule-based auto policy');
  }

  // Compaction doubles the space only where it applies: a boundary pair with a compactable
  // GPU-stage filter gets a second candidate, and every other pair keeps one. Still exact.
  const candidates: Candidate[] = [];
  for (let sqlEnd = 0; sqlEnd <= n; sqlEnd++) {
    for (let cpuEnd = sqlEnd; cpuEnd <= n; cpuEnd++) {
      candidates.push(evaluate(analysis, { sqlEnd, cpuEnd }, ctx));
      if (ctx.caps.compaction && hasGpuFilter(analysis, cpuEnd)) {
        candidates.push(evaluate(analysis, { sqlEnd, cpuEnd, compact: true }, ctx));
      }
    }
  }

  const legal = candidates.filter((c) => c.legal);
  if (legal.length === 0) {
    const why = candidates.map((c) => `  ${c.label}: ${c.reason}`).join('\n');
    throw new PlanError(`No legal plan for target '${ctx.caps.id}'.\n${why}`);
  }

  let chosen: Assignment;
  let method: OptimizeResult['method'];
  if (useCost) {
    const best = legal.reduce((a, b) => (a.cost!.totalMs <= b.cost!.totalMs ? a : b));
    chosen = best.assignment;
    method = 'cost';
  } else {
    chosen = policyAssignment(analysis, ctx, notes);
    const match = candidates.find((c) => sameAssignment(c.assignment, chosen));
    method = 'policy';
    if (!match?.legal && ctx.policy !== 'auto') {
      // A policy someone chose (sql-first, gpu-first) is refused rather than overridden.
      throw new PlanError(
        `Policy '${ctx.policy}' produced an illegal plan (${label(chosen, n)}): ${match?.reason ?? 'unknown'}`,
      );
    }
    if (!match?.legal) {
      // The rules place each node by what it is, not by what follows it: a CPU-feasible node
      // ahead of a SQL-only one gets the CPU, and the SQL-only node then has nowhere to go.
      // A legal plan exists (checked above), so take the cheapest one and say so.
      const best = legal.reduce((a, b) => ((a.cost?.totalMs ?? Infinity) <= (b.cost?.totalMs ?? Infinity) ? a : b));
      notes.push(
        `policy '${ctx.policy}' chose ${label(chosen, n)}, which is illegal (${match?.reason ?? 'unknown'}); ` +
        `using the cheapest legal plan, ${best.label}`,
      );
      chosen = best.assignment;
      method = 'cost';
    }
  }

  const chosenCandidate = candidates.find((c) => sameAssignment(c.assignment, chosen))!;

  const estimatedSelectivity = analysis.order
    .filter((node) => node.kind === 'filter')
    .map((node, _i) => {
      const index = analysis.order.indexOf(node);
      return {
        nodeId: node.id,
        selectivity: ctx.stats ? estimateSelectivity(node.expr!, ctx.stats, ctx.params) : DEFAULT_SELECTIVITY,
        pushedToSql: index < chosen.sqlEnd,
      };
    });

  // Sort for display: legal plans by cost, then illegal ones.
  candidates.sort((a, b) => {
    if (a.legal !== b.legal) return a.legal ? -1 : 1;
    return (a.cost?.totalMs ?? Infinity) - (b.cost?.totalMs ?? Infinity);
  });

  return {
    chosen,
    candidates,
    method,
    sqlRows: chosenCandidate.sqlRows ?? 0,
    estimatedSelectivity,
    notes,
  };
}

export function stageOf(assignment: Assignment, index: number): Stage {
  if (index < assignment.sqlEnd) return 'sql';
  if (index < assignment.cpuEnd) return 'cpu';
  return 'gpu';
}

// ---------------------------------------------------------------------------
// Pricing one candidate
// ---------------------------------------------------------------------------

function evaluate(analysis: Analysis, assignment: Assignment, ctx: OptimizeContext): Candidate {
  const { costs, caps, stats } = ctx;
  const n = analysis.order.length;
  const text = label(assignment, n);

  // --- legality -----------------------------------------------------------
  for (let i = 0; i < n; i++) {
    const node = analysis.order[i];
    const stage = stageOf(assignment, i);
    if (!node.feasible.has(stage)) {
      const reason =
        node.kind === 'aggregate'
          ? `aggregate '${node.id}' cannot run after the SQL stage has closed`
          : stage === 'sql'
            ? `'${node.id}' is not SQL-expressible (ramp/swizzle)`
            : `'${node.id}' has no ${stage.toUpperCase()} form`;
      return { assignment, legal: false, reason, label: text };
    }
    if (stage === 'gpu' && !caps.compute) {
      return {
        assignment,
        legal: false,
        reason: `target '${caps.id}' has no compute shaders, so '${node.id}' cannot run on the GPU`,
        label: text,
      };
    }
  }

  if (assignment.compact) {
    const why = compactionBlocker(analysis, assignment);
    if (why) return { assignment, legal: false, reason: why, label: text };
  }

  // --- cardinality --------------------------------------------------------
  const sourceRows = stats?.rows ?? fallbackRows(analysis);
  let sqlRows = sourceRows;
  const acc = new CostAccumulator();

  let sqlSelectivity = 1;
  for (let i = 0; i < assignment.sqlEnd; i++) {
    const node = analysis.order[i];
    if (node.kind === 'filter' && stats) {
      sqlSelectivity *= estimateSelectivity(node.expr!, stats, ctx.params);
    } else if (node.kind === 'filter') {
      sqlSelectivity *= DEFAULT_SELECTIVITY;
    }
  }
  sqlRows = Math.max(1, Math.round(sourceRows * sqlSelectivity));

  // An aggregate inside the SQL stage replaces the row count with the group count.
  const aggregateIndex = analysis.order.findIndex((node) => node.kind === 'aggregate');
  if (aggregateIndex >= 0 && aggregateIndex < assignment.sqlEnd) {
    sqlRows = estimateGroups(analysis.groupBy, stats, sqlRows);
  }

  // Bytes a row of an attribute node occupies on the GPU, by the rules emit applies
  // (`packing.ts`). A position takes the layout of whichever stage produces it first.
  const position = analysis.channels.position;
  const firstPosition = analysis.order.findIndex((node) => node.name === position);
  const positionLayout = firstPosition >= 0
    ? positionFormat(analysis, caps, stageOf(assignment, firstPosition)) : undefined;
  const colorName = packedColorName(analysis);
  const packed = colorName && !analysis.order.slice(0, assignment.cpuEnd).some((node) => node.name === colorName)
    ? colorName : undefined;
  const rowBytesOf = (node: AnalyzedNode, stage: Stage): number => {
    if (stage === 'gpu' && node.name === packed) return 4;
    if (positionLayout && node.name === position && node.width >= 2) return node.width * 8;
    return node.width * 4;
  };

  // --- SQL stage ----------------------------------------------------------
  const sqlOps = sum(analysis.order.slice(0, assignment.sqlEnd).map((node) => node.ops));
  // Columns scanned: source columns any node reads, in SQL or after it. This is DuckDB's
  // read, not the upload; what crosses to the GPU is `plannedBuffers`.
  const scanned = new Set<string>();
  for (const node of analysis.order) for (const r of node.reads) scanned.add(r);
  for (const s of analysis.statsNodes) scanned.add(s.column);
  const scannedColumns = Math.max(1, [...scanned].filter((c) => analysis.sourceSchema.has(c)).length);
  acc.addBuild('duckdb scan', sqlScanMs(costs, sourceRows, scannedColumns, sqlOps));

  // --- attributes crossing into the GPU -----------------------------------
  const planned = plannedBuffers(analysis, assignment, rowBytesOf);
  const chunks = estimateChunks(sqlRows);
  for (const col of planned.passthrough) {
    acc.addBuild('upload arrow columns', uploadMs(costs, sqlRows * 4, chunks));
    const colStats = stats?.columns.get(col);
    // f64 or nullable columns cannot be handed to the GPU as-is.
    if (!colStats || colStats.isF64 || colStats.nullFrac > 0) {
      acc.addBuild('arrow -> f32 cast', castMs(costs, sqlRows));
    }
  }

  // Attributes produced by the SQL stage: uploaded, and interleaved if they are vectors.
  for (const node of planned.sqlUploads) {
    acc.addBuild('upload arrow columns', uploadMs(costs, sqlRows * rowBytesOf(node, 'sql'), chunks * node.width));
    if (node.width > 1) {
      // SQL columns are scalars, so a vec3 arrives as three columns and must be packed.
      acc.addBuild('interleave sql vectors', interleaveMs(costs, sqlRows * node.width));
    }
  }

  // --- CPU stage ----------------------------------------------------------
  const cpuOps = sum(analysis.order.slice(assignment.sqlEnd, assignment.cpuEnd).map((node) => node.ops));
  if (cpuOps > 0) acc.addBuild('cpu js loop', cpuEvalMs(costs, sqlRows, cpuOps));
  for (let i = assignment.sqlEnd; i < assignment.cpuEnd; i++) {
    const node = analysis.order[i];
    if (node.kind !== 'attribute') continue;
    acc.addBuild('upload cpu results', uploadMs(costs, sqlRows * rowBytesOf(node, 'cpu'), 1));
  }

  // --- GPU stage ----------------------------------------------------------
  // A compacted filter leaves the kernel: the compaction engine evaluates it instead.
  const gpuNodes = analysis.order.slice(assignment.cpuEnd);
  const kernelNodes = assignment.compact ? gpuNodes.filter((node) => node.kind !== 'filter') : gpuNodes;
  const gpuOps = sum(kernelNodes.map((node) => node.ops));
  if (gpuOps > 0) acc.addBuild('gpu kernel', kernelMs(costs, sqlRows, gpuOps));

  // Rows that survive every filter placed after SQL. A mask draws all of them anyway; a
  // compaction draws only these.
  let drawnRows = sqlRows;
  if (assignment.compact) {
    let gpuSelectivity = 1;
    for (const node of gpuNodes) {
      if (node.kind !== 'filter') continue;
      gpuSelectivity *= stats ? estimateSelectivity(node.expr!, stats, ctx.params) : DEFAULT_SELECTIVITY;
    }
    drawnRows = Math.max(1, Math.round(sqlRows * gpuSelectivity));
    acc.addBuild('gpu compaction compile', costs.compactCompileMs);
    acc.addBuild('gpu compaction', compactMs(costs, sqlRows));
    // The engine's selection mask and compacted ids, one u32 each per row.
    acc.addGpuBytes(sqlRows * 8);
  }
  acc.addGpuBytes(sqlRows * sum([...planned.buffers.values()]));

  // --- memory constraint --------------------------------------------------
  const gpuBytes = acc.result().gpuBytes;
  if (gpuBytes > caps.gpuBudgetBytes) {
    return {
      assignment,
      legal: false,
      reason: `needs ${mb(gpuBytes)} of attribute buffers, over the ${mb(caps.gpuBudgetBytes)} budget`,
      label: text,
      sqlRows,
    };
  }

  // --- binding constraint -------------------------------------------------
  // The fused kernel binds one storage buffer per attribute it touches, plus the ramp LUT.
  // Exceeding the per-stage limit is a hard failure at pipeline creation, so it has to be
  // caught here rather than discovered as a WebGPU validation error at first draw.
  const bindings = countStorageBindings(analysis, assignment);
  if (bindings.total > caps.maxStorageBuffersPerStage) {
    return {
      assignment,
      legal: false,
      reason: `fused kernel needs ${bindings.total} storage buffers (${bindings.reads} read + ${bindings.writes} written${bindings.ramp ? ' + ramp LUT' : ''}), over the per-stage limit of ${caps.maxStorageBuffersPerStage}`,
      label: text,
      sqlRows,
      storageBindings: bindings.total,
    };
  }

  // --- amortised interaction ----------------------------------------------
  // Suffix costs: what re-running from a given stage would cost.
  const castElements = planned.passthrough.length * sqlRows;
  const totalBytes = gpuBytes;
  // Anything upstream of a compaction invalidates it. A requery also changes the row count,
  // which the engine's outputs are sized to, so it recompiles.
  const recompact = assignment.compact ? compactMs(costs, sqlRows) : 0;
  const suffix = {
    sql: sqlScanMs(costs, sourceRows, scannedColumns, sqlOps)
      + castMs(costs, castElements)
      + uploadMs(costs, totalBytes, chunks)
      + cpuEvalMs(costs, sqlRows, cpuOps)
      + kernelMs(costs, sqlRows, gpuOps)
      + (assignment.compact ? costs.compactCompileMs + recompact : 0),
    cpu: cpuEvalMs(costs, sqlRows, cpuOps)
      + uploadMs(costs, totalBytes, 1)
      + kernelMs(costs, sqlRows, gpuOps)
      + recompact,
    gpu: costs.uniformWriteMs + (gpuOps > 0 ? kernelMs(costs, sqlRows, gpuOps) : 0) + recompact,
  };
  /**
   * A parameter only a compacted filter reads re-runs the compaction and nothing else: the
   * kernel's outputs do not depend on it. This is the route that makes compaction cheap to
   * drag — cheaper than the mask, which re-runs the whole fused kernel.
   */
  const compactOnly = costs.uniformWriteMs + recompact;

  // Drawing is a recurring cost, and the number of instances is what a filter's placement
  // decides. A discard mask keeps every row and re-rasterizes it every frame; a SQL filter
  // removes it once. Omitting this term made masked plans look cheaper than filtered ones.
  const frames = costs.horizonSec * costs.frameRateHz;
  acc.addInteract(
    `render ${drawnRows.toLocaleString()} instances x ${frames.toFixed(0)} frames`,
    frames * renderFrameMs(costs, drawnRows),
  );

  for (const [name, spec] of Object.entries(analysis.params)) {
    const rate = changeRate(spec);
    if (rate <= 0) continue;
    // A change to a parameter invalidates from the most upstream node that reads it, so
    // that node's stage sets the price.
    let earliest: Stage | undefined;
    for (let i = 0; i < n; i++) {
      if (!analysis.order[i].params.includes(name)) continue;
      const stage = stageOf(assignment, i);
      earliest = earliest === undefined ? stage : earlier(earliest, stage);
    }
    if (!earliest) continue;
    const onlyCompacted = assignment.compact && earliest === 'gpu'
      && !kernelNodes.some((node) => node.params.includes(name));
    const route = onlyCompacted ? 'compaction' : earliest;
    const ms = onlyCompacted ? compactOnly : suffix[earliest];
    acc.addInteract(`rebind ${name} (${route}, ${rate}/s)`, rate * costs.horizonSec * ms);
  }

  return {
    assignment, legal: true, cost: acc.result(), sqlRows, label: text,
    storageBindings: bindings.total,
  };
}

// ---------------------------------------------------------------------------
// Rule-based policies, expressed as boundaries
// ---------------------------------------------------------------------------

/**
 * The legacy rules, restated as a choice of boundary so every policy goes through the
 * same pricing and codegen path. Kept so the cost model can be measured against them
 * rather than merely replacing them.
 */
function policyAssignment(analysis: Analysis, ctx: OptimizeContext, notes: string[]): Assignment {
  const n = analysis.order.length;

  switch (ctx.policy) {
    case 'gpu-first': {
      // Everything on the GPU; a filter becomes a discard mask. Except what only SQL can run
      // — an aggregate, anything reading a string — which forces the shortest SQL prefix that
      // still contains it. Stages are ordered, so that prefix is everything up to the last one.
      let sqlEnd = 0;
      analysis.order.forEach((node, i) => { if (!node.feasible.has('gpu')) sqlEnd = i + 1; });
      notes.push(sqlEnd === 0
        ? 'policy gpu-first: no SQL stage, filters become discard masks'
        : `policy gpu-first: ${sqlEnd} node(s) kept in SQL because the last of them has no GPU form`);
      return { sqlEnd, cpuEnd: sqlEnd };
    }

    case 'sql-first': {
      // Longest legal SQL prefix, no CPU stage.
      let sqlEnd = 0;
      while (sqlEnd < n && analysis.order[sqlEnd].feasible.has('sql')) sqlEnd++;
      notes.push(`policy sql-first: ${sqlEnd} of ${n} nodes pushed into SQL`);
      return { sqlEnd, cpuEnd: sqlEnd };
    }

    case 'auto':
    case 'cost':
    default: {
      // The original heuristic: keep taking nodes into SQL while they either reduce
      // volume (filter, aggregate) or have no GPU form. Stop at the first
      // volume-preserving per-row node, because those are cheaper to reparameterise on
      // the GPU.
      let sqlEnd = 0;
      while (sqlEnd < n) {
        const node = analysis.order[sqlEnd];
        const reduces = node.kind === 'filter' || node.kind === 'aggregate';
        const gpuCapable = node.feasible.has('gpu');
        if (!node.feasible.has('sql')) break;
        if (!reduces && gpuCapable) break;
        sqlEnd++;
      }
      // If a GPU stage is impossible, everything after the SQL prefix must go to the CPU.
      const cpuEnd = ctx.caps.compute ? sqlEnd : n;
      if (!ctx.caps.compute) {
        notes.push(`target '${ctx.caps.id}' has no compute, so the remaining ${n - sqlEnd} node(s) run on the CPU`);
      }
      return { sqlEnd, cpuEnd };
    }
  }
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

function hasGpuFilter(analysis: Analysis, cpuEnd: number): boolean {
  return analysis.order.slice(cpuEnd).some((node) => node.kind === 'filter');
}

/**
 * Why this assignment cannot compact, or `undefined` if it can. Legality, not cost: each of
 * these would produce a plan the runtime cannot execute.
 */
function compactionBlocker(analysis: Analysis, assignment: Assignment): string | undefined {
  // Only the point pass has an indexed draw. A heatmap bins every row it is given, and a
  // layer hands buffers to deck, which draws them itself.
  if (analysis.render.mode !== 'points' || analysis.layer) {
    return 'GPU compaction feeds an indexed point draw; this output is not a point pass';
  }
  const order = analysis.order;
  for (let i = assignment.sqlEnd; i < assignment.cpuEnd; i++) {
    if (order[i].kind === 'filter') {
      return `'${order[i].id}' is a CPU-stage filter; its mask would have to be compacted too`;
    }
  }
  const widths = new Map<string, number>();
  for (const node of order) if (node.kind === 'attribute' && node.name) widths.set(node.name, node.width);
  for (let i = assignment.cpuEnd; i < order.length; i++) {
    const node = order[i];
    if (node.kind !== 'filter') continue;
    if (!compactable(node.expr!)) {
      return `'${node.id}' uses an operation the compaction engine lacks (functions, %, vectors, conditionals)`;
    }
    const wide = node.reads.find((r) => (widths.get(r) ?? 1) !== 1);
    if (wide) return `'${node.id}' reads vector attribute '${wide}'; compaction reads scalars`;
  }
  return undefined;
}

function changeRate(spec: { changeRate?: number; kind?: 'value' | 'structural' }): number {
  if (spec.changeRate !== undefined) return Math.max(0, spec.changeRate);
  // A structural parameter recompiles the plan, so amortising it here would double count.
  return spec.kind === 'structural' ? 0 : 2;
}

const STAGE_ORDER: Record<Stage, number> = { sql: 0, cpu: 1, gpu: 2 };

function earlier(a: Stage, b: Stage): Stage {
  return STAGE_ORDER[a] <= STAGE_ORDER[b] ? a : b;
}

/**
 * Storage buffers the fused GPU kernel will bind, mirroring `buildKernel`'s bookkeeping:
 * one per attribute written, one per attribute read that the kernel does not itself write,
 * and one for the color LUT if any node calls `ramp()`.
 */
function countStorageBindings(
  analysis: Analysis,
  assignment: Assignment,
): { reads: number; writes: number; ramp: boolean; total: number } {
  const allGpu = analysis.order.slice(assignment.cpuEnd);
  // A compacted filter is not in the kernel. What it reads, though, has to be in a buffer
  // the compaction engine can see, so those names count as external.
  const gpuNodes = assignment.compact ? allGpu.filter((node) => node.kind !== 'filter') : allGpu;
  if (gpuNodes.length === 0) return { reads: 0, writes: 0, ramp: false, total: 0 };

  // Must match `buildKernel`: a temporary nothing outside the kernel reads stays in a
  // register and is never bound. Both read the same rule.
  const external = externalAttributes(analysis);
  if (assignment.compact) {
    for (const node of allGpu) if (node.kind === 'filter') for (const r of node.reads) external.add(r);
    external.delete(analysis.conventions.mask);
  }

  const written = new Set<string>();
  const registerOnly = new Set<string>();
  const read = new Set<string>();
  let ramp = false;
  for (const node of gpuNodes) {
    for (const r of node.reads) if (!written.has(r) && !registerOnly.has(r)) read.add(r);
    if (node.kind === 'attribute' && node.name) {
      if (external.has(node.name)) written.add(node.name);
      else registerOnly.add(node.name);
    }
    if (node.kind === 'filter') written.add(analysis.conventions.mask);
    // A raw node declares several writes, any of which may be external. Counted here for the
    // same reason as everything else: exceeding the per-stage binding limit is a hard failure
    // at pipeline creation, so it has to be caught while pricing rather than discovered later.
    if (node.kind === 'raw') {
      for (const w of rawWritesOf(node)) {
        if (external.has(w)) written.add(w);
        else registerOnly.add(w);
      }
    }
    if (node.expr && usesRamp(node)) ramp = true;
  }
  for (const t of registerOnly) read.delete(t);
  // A name both read and written needs one read_write binding, not two.
  for (const w of written) read.delete(w);
  const total = read.size + written.size + (ramp ? 1 : 0);
  return { reads: read.size, writes: written.size, ramp, total };
}

/**
 * The attribute buffers emit will allocate for an assignment, name -> bytes per row, and the
 * uploads behind them.
 *
 * This mirrors emit rather than approximating it, because the memory constraint is a hard
 * limit and the upload terms are what the optimizer trades SQL against the GPU on. It used to
 * charge every source column any node read, including ones read only inside SQL, which emit's
 * projection pushdown never selects: a sql-first scatter was priced at 52 bytes a row against
 * the 40 it allocates, so pushing work into SQL looked dearer than it was. It also charged
 * wrangle locals that stay in kernel registers, and missed the discard mask. A test in
 * `packing.test.ts` holds this to emit's allocation across graphs, policies and targets.
 */
function plannedBuffers(
  analysis: Analysis,
  assignment: Assignment,
  rowBytesOf: (node: AnalyzedNode, stage: Stage) => number,
): { buffers: Map<string, number>; passthrough: string[]; sqlUploads: AnalyzedNode[] } {
  const { order, sourceSchema, strings } = analysis;
  const n = order.length;
  const buffers = new Map<string, number>();
  // The first producer of a name allocates its buffer; a later stage writes it in place.
  const add = (name: string, bytes: number) => { if (!buffers.has(name)) buffers.set(name, bytes); };
  const mask = analysis.conventions.mask;

  // --- SQL: what the row query selects ---------------------------------------
  const aggregateIndex = order.findIndex((node) => node.kind === 'aggregate');
  const aggregateInSql = aggregateIndex >= 0 && aggregateIndex < assignment.sqlEnd;
  let passthrough: string[] = [];
  const sqlUploads: AnalyzedNode[] = [];
  if (aggregateInSql) {
    // GROUP BY keys and aggregates replace the passthrough columns, and attributes before
    // the aggregate live only in the inner query.
    const agg = order[aggregateIndex];
    for (const g of agg.groupBy ?? []) add(g, 4);
    for (const a of agg.aggs ?? []) add(a.name, 4);
    for (let i = aggregateIndex + 1; i < assignment.sqlEnd; i++) {
      if (order[i].kind === 'attribute') sqlUploads.push(order[i]);
    }
  } else {
    // Projection pushdown: source columns read after SQL, stats columns, and anything bound
    // outside the graph. Strings are selected too but never reach a GPU buffer.
    const needed = new Set<string>();
    for (let i = assignment.sqlEnd; i < n; i++) for (const r of order[i].reads) needed.add(r);
    for (const s of analysis.statsNodes) needed.add(s.column);
    for (const name of externalAttributes(analysis)) needed.add(name);
    passthrough = [...needed].filter((c) => sourceSchema.has(c) && !strings.has(c)).sort();
    for (const c of passthrough) add(c, 4);
    for (let i = 0; i < assignment.sqlEnd; i++) if (order[i].kind === 'attribute') sqlUploads.push(order[i]);
  }
  for (const node of sqlUploads) add(node.name!, rowBytesOf(node, 'sql'));
  for (let i = 0; i < assignment.sqlEnd; i++) {
    // A raw SQL node selects one scalar column per declared write.
    for (const w of rawWritesOf(order[i])) add(w, 4);
  }

  // --- CPU: every result is uploaded, and a filter becomes the mask ---------
  for (let i = assignment.sqlEnd; i < assignment.cpuEnd; i++) {
    const node = order[i];
    if (node.kind === 'attribute') add(node.name!, rowBytesOf(node, 'cpu'));
    if (node.kind === 'filter') add(mask, 4);
  }

  // --- GPU: buffers only for what something outside the kernel reads ---------
  // The same rule `buildKernel` and `countStorageBindings` apply; a name an earlier stage
  // already gave a buffer keeps it, because the kernel writes that buffer in place.
  const external = externalAttributes(analysis);
  for (let i = assignment.cpuEnd; i < n; i++) {
    const node = order[i];
    const kept = (name: string) => external.has(name) || buffers.has(name);
    if (node.kind === 'attribute' && kept(node.name!)) add(node.name!, rowBytesOf(node, 'gpu'));
    if (node.kind === 'filter' && !assignment.compact) add(mask, 4);
    const raw = node.node as { type?: string; writes?: { name: string; width: number }[] };
    if (node.kind === 'raw' && raw.type === 'raw') {
      for (const w of raw.writes ?? []) if (kept(w.name)) add(w.name, rowBytesOf({ ...node, name: w.name, width: w.width }, 'gpu'));
    }
  }
  return { buffers, passthrough, sqlUploads };
}

/** Declared writes of a raw node, or none for any other kind. */
function rawWritesOf(node: AnalyzedNode): string[] {
  const n = node.node as { type?: string; writes?: { name: string }[] };
  return n.type === 'raw' ? (n.writes ?? []).map((w) => w.name) : [];
}

function usesRamp(node: { expr?: { kind: string } }): boolean {
  const walk = (e: unknown): boolean => {
    if (!e || typeof e !== 'object') return false;
    const n = e as { kind?: string; fn?: string } & Record<string, unknown>;
    if (n.kind === 'call' && n.fn === 'ramp') return true;
    return Object.values(n).some((v) =>
      Array.isArray(v) ? v.some(walk) : typeof v === 'object' && walk(v),
    );
  };
  return walk(node.expr);
}

/**
 * Estimated group count for a GROUP BY: the product of the key columns' distinct counts,
 * capped at the input row count. Standard, and standardly an overestimate when the keys
 * are correlated.
 */
function estimateGroups(groupBy: string[], stats: SourceStats | undefined, inputRows: number): number {
  if (groupBy.length === 0) return 1;
  if (!stats) return Math.max(1, Math.min(inputRows, 100));
  let product = 1;
  for (const key of groupBy) {
    product *= stats.columns.get(key)?.ndv ?? 10;
  }
  return Math.max(1, Math.min(inputRows, Math.round(product)));
}

/** Row count when no statistics exist, so costs stay finite and comparable. */
function fallbackRows(analysis: Analysis): number {
  return analysis.source.dataset.estimatedRows ?? 1_000_000;
}

function label(a: Assignment, n: number): string {
  const parts = [`sql[0,${a.sqlEnd})`];
  if (a.cpuEnd > a.sqlEnd) parts.push(`cpu[${a.sqlEnd},${a.cpuEnd})`);
  if (n > a.cpuEnd) parts.push(`gpu[${a.cpuEnd},${n})`);
  if (a.compact) parts.push('+compact');
  return parts.join(' ');
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
