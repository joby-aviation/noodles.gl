/**
 * Phase 3 of planning: emit a physical plan for a chosen assignment.
 *
 * This file used to do all three phases at once — decide, then generate, in a single walk.
 * Splitting the decision out into `analyze.ts` and `optimizer.ts` is what makes a cost
 * model possible: emit now *receives* the placement and has no opinion about it, so the
 * same code generates the plan whichever way the optimizer or a policy decided.
 *
 * Three stages exist, in this order and only this order:
 *   SQL  filters (real row removal), aggregates, scalar attribute expressions
 *   CPU  generated JS over Arrow columns, results uploaded
 *   GPU  one fused compute kernel writing attribute buffers in place
 */

import { type Expr, columnsOf, parseExpr, widthOf } from './expr.js';
import { toSql, toSqlColumns, quoteIdent, castToFloat, castToDouble, SqlParams } from './backends/sql.js';
import { toWgsl, wgslType, wgslParamMember, type Resolver } from './backends/wgsl.js';
import {
  type Graph, type RenderNode, type Bin2dNode, type RawNode, type ParamSpec, type RampName,
  statExpr, statParamName,
} from './types.js';
import {
  analyze, PlanError, externalAttributes, type Analysis, type AnalyzedNode, type Schema, type Stage,
  type RenderChannels, type LayerAnalysis, type ColumnTypes, type PathColumns,
} from './analyze.js';
import type { AttributeConventions } from './conventions.js';
import {
  optimize, stageOf, sameAssignment, type Assignment, type Candidate, type Policy, type OptimizeResult,
} from './optimizer.js';
import { type CostConstants, DEFAULT_COSTS, type CostBreakdown } from './cost.js';
import type { SourceStats } from './stats.js';
import { type TargetCaps, targetCaps } from './target.js';
import { packedColorName, positionFormat, type AttributeFormat } from './packing.js';
import { type DerivedParam, withDerived } from './hoist.js';

export { PlanError };
export type { Schema, Stage, Policy, Assignment, Candidate };

export interface AttributeDecl {
  name: string;
  width: number;
  /**
   * `arrow` came out of the query, `cpu` was written by the generated JS loop, `derived`
   * was written by a kernel. The distinction drives both invalidation and the upload path.
   */
  provenance: 'arrow' | 'cpu' | 'derived';
  /** For arrow attributes: the query columns backing each component. */
  sourceColumns?: string[];
  /** True for wrangle locals, which the inspector hides. */
  internal?: boolean;
  /**
   * Absent for ordinary f32 attributes. `str` is a string column, selected uncast and read
   * as JS strings. `raw` is a column selected in its native type — a path id, which must not
   * be narrowed to f32, where ids above 2^24 would merge. `list` is a column holding a whole
   * path per row (`LayerAnalysis.lists`), read as its Arrow vector.
   */
  type?: 'str' | 'raw' | 'list';
  /**
   * Selected as DOUBLE and read in f64 by the runtime: a trips layer's timestamps, which as
   * epoch seconds are past f32's integers (it steps 128 s at 1.5e9). The runtime sends them
   * as f32 offsets from an origin, and the layer's current time likewise.
   */
  precise?: boolean;
  /**
   * GPU storage format, when it is not f32 per component. `rgba8` is one packed u32 per row
   * (see `packing.ts`); `width` stays the logical component count.
   */
  format?: AttributeFormat;
}

export interface KernelPlan {
  id: string;
  code: string;
  reads: string[];
  writes: string[];
  params: string[];
  usesRamp: boolean;
  nodeIds: string[];
}

export interface StatsPlan {
  nodeId: string;
  sql: string;
  outputs: { column: string; param: string }[];
  params: string[];
}

export interface StageNode {
  nodeId: string;
  name: string;
  /** The compiled expression. Absent exactly when `raw` is present. */
  expr?: Expr;
  /** Literal backend code for a `raw` node, spliced instead of compiled. */
  raw?: RawStage;
}

/** A `raw` node reduced to what the emitters need. */
export interface RawStage {
  engine: 'sql' | 'gpu';
  /** WGSL statements, or one SQL expression per write. */
  code: string | Record<string, string>;
  writes: { name: string; width: number }[];
  reads: string[];
  params: string[];
  label?: string;
}

/**
 * Names the generated kernel already uses. A raw node's reads, writes and params are exposed
 * to its code under their plain names, so one of these would shadow the loop index or the
 * uniform block and produce WGSL that compiles into something quietly wrong.
 */
const KERNEL_RESERVED = new Set(['i', 'params', 'rowInfo', 'ramp_lut', 'gid', 'sampleRamp']);

function checkRawNames(raw: RawStage, nodeId: string): void {
  for (const name of [...raw.reads, ...raw.params, ...raw.writes.map((w) => w.name)]) {
    if (KERNEL_RESERVED.has(name) || /^[rv]\d+$/.test(name)) {
      throw new PlanError(
        `Node ${nodeId}: '${name}' collides with a name the generated kernel uses ` +
        `(${[...KERNEL_RESERVED].join(', ')}, or r<N>/v<N>)`,
      );
    }
  }
}

export interface Explain {
  method: OptimizeResult['method'];
  chosen: Assignment;
  candidates: Candidate[];
  /** Estimated cost of the chosen plan. */
  estimated?: CostBreakdown;
  estimatedRows: number;
  estimatedSelectivity: OptimizeResult['estimatedSelectivity'];
  costs: CostConstants;
  caps: TargetCaps;
  /** Nodes in topological order with their assigned stage. */
  placement: { nodeId: string; kind: string; stage: Stage; ops: number; why: string }[];
  /**
   * Edges of the *desugared* graph, `[from, to]`. Sugar has already been expanded and dead
   * branches removed, so this is the topology that was actually planned rather than the one
   * that was authored — which is what a consumer drawing the plan wants to see.
   */
  edges: [string, string][];
  notes: string[];
}

export interface PhysicalPlan {
  sql: string;
  sqlParams: string[];
  stats: StatsPlan[];
  kernels: KernelPlan[];
  /** Nodes the generated JS loop evaluates, in order. */
  cpuStage: StageNode[];
  /** Nodes the fused kernel evaluates, in order. */
  gpuStage: StageNode[];
  attributes: AttributeDecl[];
  uniformParams: string[];
  params: Record<string, ParamSpec>;
  /**
   * Parameters computed from `params` rather than set: hoisted param-only subexpressions
   * (`hoist.ts`). They appear in `sqlParams`, `uniformParams` and the stages' trees, never in
   * `params`. Bind through `withDerived(plan, values)`; key routes by `sourceParams`.
   */
  derived: DerivedParam[];
  /** The render node as authored, for its id and mode. For a layer output, synthesized. */
  render: RenderNode;
  /** The layer output with its channels resolved, when the output is a `layer` node. */
  layer?: LayerAnalysis;
  /**
   * The render channels with every attribute name resolved by `analyze`. Consumers bind
   * from these; nothing outside `analyze` applies a naming default.
   */
  channels: RenderChannels;
  /** The naming vocabulary this plan was produced under. */
  conventions: AttributeConventions;
  ramp?: RampName;
  bin2d?: Bin2dNode;
  assignments: { nodeId: string; type: string; engine: 'sql' | 'cpu' | 'gpu' | 'scalar' | 'render' | 'source'; why: string }[];
  notes: string[];
  maskAttribute?: string;
  /**
   * Present when the plan compacts on the GPU (`Assignment.compact`): the conjunction of the
   * GPU-stage filters, for the target's compaction engine to evaluate after the kernel. The
   * renderer draws the compacted ids indirectly; no mask attribute exists for these filters.
   */
  compaction?: {
    predicate: Expr;
    /** Attributes the predicate reads. Each has a buffer, and each is a scalar. */
    reads: string[];
    /** Parameters it reads. A change to one of these alone re-runs only the compaction. */
    params: string[];
  };
  explain: Explain;
}

export interface PlanOptions {
  policy?: Policy;
  costs?: CostConstants;
  caps?: TargetCaps;
  stats?: SourceStats;
  /** Current parameter values, so selectivity estimates move when a slider moves. */
  params?: Record<string, number>;
  /** Relation the generated SQL should read, from the source provider. */
  relation?: string;
  /**
   * Override the attribute vocabulary. Defaults to Houdini's `P` / `Cd` / `pscale` /
   * `Alpha`. Only meaningful when `plan` does its own `analyze`.
   */
  conventions?: Partial<AttributeConventions>;
  /** Column types of the relation, so string columns can be read. See `ColumnTypes`. */
  columnTypes?: ColumnTypes;
  /** Columns holding a path per row. See `PathColumns`. */
  pathColumns?: PathColumns;
}

const WORKGROUP = 256;
/**
 * Fallback relation name when the caller does not supply one. Real callers pass the
 * provider's relation through `PlanOptions.relation`, so the generated SQL names whatever
 * the source actually created rather than assuming a table called `src`.
 */
export const DEFAULT_RELATION = '"src"';

export { WORKGROUP };

// ---------------------------------------------------------------------------

export function plan(
  graph: Graph,
  sourceSchema: Schema,
  options: Policy | PlanOptions = {},
): PhysicalPlan {
  const opts: PlanOptions = typeof options === 'string' ? { policy: options } : options;
  const caps = opts.caps ?? targetCaps('webgpu-native', undefined);
  const costs = opts.costs ?? DEFAULT_COSTS;
  // Cost-based planning needs statistics; without them the rule-based policy is honest
  // and the optimizer says so in its notes.
  const policy: Policy = opts.policy ?? (opts.stats ? 'cost' : 'auto');

  const analysis = analyze(graph, sourceSchema, opts.conventions, opts.columnTypes, { pathColumns: opts.pathColumns });
  // Derived values too: a hoisted threshold (`lat > {{a}} * 2`) is a bound value to the
  // selectivity estimator, where the expression it replaced was not.
  const result = optimize(analysis, {
    costs, caps, stats: opts.stats, params: withDerived(analysis, opts.params ?? {}), policy,
  });

  return emit(analysis, result, {
    costs, caps, relation: opts.relation ?? DEFAULT_RELATION, columnTypes: opts.columnTypes,
  });
}

// ---------------------------------------------------------------------------
// Raw nodes
// ---------------------------------------------------------------------------

/**
 * SQL text for one write of a raw node.
 *
 * `code` may be a bare string when the node has a single write, or a map keyed by write name.
 * The map form is required as soon as there are two, because there is no ordering convention
 * that would not be a trap.
 */
function rawSqlFor(raw: RawStage, name: string, nodeId: string): string {
  if (typeof raw.code === 'string') {
    if (raw.writes.length !== 1) {
      throw new PlanError(
        `Node ${nodeId}: raw sql declares ${raw.writes.length} writes, so 'code' must be an ` +
        `object keyed by write name (${raw.writes.map((w) => w.name).join(', ')})`,
      );
    }
    return raw.code;
  }
  const code = raw.code[name];
  if (code === undefined) {
    throw new PlanError(`Node ${nodeId}: raw sql has no expression for declared write '${name}'`);
  }
  return code;
}

/** Select-list text for one item, compiled or spliced. */
function selectItems(
  item: { name: string; width: number; expr?: Expr; raw?: string; str?: boolean },
  bind: SqlParams,
  /** Select as DOUBLE rather than FLOAT: a `hilo` position keeps the precision (`packing.ts`). */
  double = false,
): string[] {
  // A string cannot reach a GPU buffer, so the f32 narrowing that every numeric item gets
  // would turn it into NULL. It is selected as itself.
  if (item.str && item.expr) return [`${toSql(item.expr, bind).code} AS ${quoteIdent(item.name)}`];
  if (item.raw !== undefined) {
    // Wrapped in parentheses and cast, so a raw expression behaves like a compiled one:
    // `a + b` cannot bind tighter than the alias, and a DECIMAL result cannot reach Arrow
    // unscaled. Vector writes are not supported here — a raw SQL node produces scalars,
    // because component naming would have to be invented and would not match `toSqlColumns`.
    if (item.width !== 1) {
      throw new PlanError(
        `Raw sql write '${item.name}' has width ${item.width}; raw sql produces scalars only. ` +
        'Declare one write per component, or use a raw gpu node.',
      );
    }
    return [`${castToFloat(`(${item.raw})`)} AS ${quoteIdent(item.name)}`];
  }
  return toSqlColumns(item.expr!, item.name, bind, double ? castToDouble : castToFloat).items;
}

/**
 * Splice a raw WGSL node into the kernel body.
 *
 * The contract with the author is that their code sees plain names: a declared read, write or
 * param is in scope under exactly the name they declared. That is worth the small amount of
 * preamble below, because the alternative — exposing `r7` and `params.p_cut` — would make raw
 * code depend on generated identifiers that change whenever a neighbouring node does.
 *
 * Writes are `var` rather than `let` so the code can assign them, and are declared before the
 * body so the code may also read them.
 */
function emitRaw(
  node: StageNode,
  raw: RawStage,
  ctx: {
    resolve: Resolver;
    body: string[];
    live: Map<string, { code: string; width: number }>;
    widths: Map<string, number>;
    params: Set<string>;
    writes: string[];
    derivedOut: AttributeDecl[];
    external: Set<string>;
    registerOnly: Set<string>;
    order: AnalyzedNode[];
    next: () => string;
    formats: Map<string, AttributeFormat>;
  },
): void {
  if (typeof raw.code !== 'string') {
    throw new PlanError(
      `Node ${node.nodeId}: raw gpu code must be a string of WGSL statements, not an object`,
    );
  }
  checkRawNames(raw, node.nodeId);

  const { body } = ctx;

  // Reads are resolved *before* the block opens, because `resolve` appends its own load
  // statements to the body and those must not land inside a scope that closes.
  const bound = raw.reads.map((name) => [name, ctx.resolve(name)] as const);

  body.push(`  // ${node.nodeId}: raw wgsl${raw.label ? ` (${raw.label})` : ''}`);

  /**
   * The SSA locals are declared outside the block and assigned inside it.
   *
   * They have to outlive the block — a later node reads this attribute through the local — and
   * the block has to exist, so that two raw nodes can both declare `let elevation` without
   * colliding. Declaring them inside was the first version, and it produced WGSL that failed to
   * compile; WebGPU reports that by leaving every derived attribute zero-filled, so it looked
   * like an arithmetic bug rather than a scope bug.
   */
  const locals = new Map<string, string>();
  for (const w of raw.writes) {
    const local = ctx.next();
    locals.set(w.name, local);
    body.push(`  var ${local}: ${wgslType(w.width)};`);
  }

  body.push('  {');
  for (const [name, val] of bound) body.push(`    let ${name} = ${val.code};`);
  for (const p of raw.params) {
    ctx.params.add(p);
    body.push(`    let ${p} = params.${wgslParamMember(p)};`);
  }
  for (const w of raw.writes) body.push(`    var ${w.name}: ${wgslType(w.width)};`);
  for (const line of raw.code.split('\n')) body.push(`    ${line.trim()}`);
  for (const w of raw.writes) body.push(`    ${locals.get(w.name)!} = ${w.name};`);
  body.push('  }');

  for (const w of raw.writes) {
    const local = locals.get(w.name)!;
    ctx.live.set(w.name, { code: local, width: w.width });
    ctx.widths.set(w.name, w.width);
    if (!ctx.external.has(w.name)) {
      ctx.registerOnly.add(w.name);
      continue;
    }
    if (!ctx.writes.includes(w.name)) ctx.writes.push(w.name);
    const format = ctx.formats.get(w.name);
    if (!ctx.derivedOut.some((d) => d.name === w.name)) {
      ctx.derivedOut.push({ name: w.name, width: w.width, provenance: 'derived', ...(format ? { format } : {}) });
    }
    body.push(...storeAttribute(w.name, local, w.width, format, node.nodeId));
  }
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function emit(
  analysis: Analysis,
  chosen: OptimizeResult,
  ctx: { costs: CostConstants; caps: TargetCaps; relation: string; columnTypes?: ColumnTypes },
): PhysicalPlan {
  const relation = ctx.relation;
  const assignment = chosen.chosen;
  const order = analysis.order;
  const n = order.length;
  const notes = [...analysis.notes, ...chosen.notes];

  const assignments: PhysicalPlan['assignments'] = [
    {
      nodeId: analysis.source.id,
      type: 'source',
      engine: 'source',
      why: `source '${analysis.source.dataset.ref}'`,
    },
  ];

  // --- partition -----------------------------------------------------------
  const stageOfNode = (i: number) => stageOf(assignment, i);
  // Expressions, not emitted text: placeholder numbering is per statement, so emission has
  // to wait until we know which statement each expression lands in.
  const whereExprs: Expr[] = [];
  type SelectItem = { name: string; width: number; expr?: Expr; raw?: string; str?: boolean };
  const preAggSelect: SelectItem[] = [];
  const postAggSelect: SelectItem[] = [];
  const cpuStage: StageNode[] = [];
  const gpuStage: StageNode[] = [];
  let maskAttribute: string | undefined;
  /** Where a GPU- or CPU-stage filter writes its discard mask, per the conventions. */
  const mask = analysis.conventions.mask;

  /** The position channel's name when the SQL stage produces it as `hilo`. */
  const sqlPosition = positionFormat(analysis, ctx.caps, 'sql') ? analysis.channels.position : undefined;
  const isSqlPosition = (item: { name: string; width: number }) => item.name === sqlPosition && item.width >= 2;
  /** A trips layer's timestamp attribute, kept in doubles. See `AttributeDecl.precise`. */
  // A list of times (path rows) is read in doubles by the runtime's flattening instead.
  const timeBinding = analysis.layer?.kind === 'trips'
    ? analysis.layer.bindings.find((b) => b.channel === 'timestamp')?.attribute
    : undefined;
  const preciseName = timeBinding && !analysis.layer?.lists?.some((l) => l.column === timeBinding)
    ? timeBinding : undefined;
  const isPrecise = (item: { name: string; width: number }) => item.name === preciseName && item.width === 1;
  const sqlFormat = (item: { name: string; width: number }) =>
    isSqlPosition(item) ? { format: 'hilo' as const } : isPrecise(item) ? { precise: true } : {};

  const aggregateIndex = order.findIndex((node) => node.kind === 'aggregate');
  const aggregateInSql = aggregateIndex >= 0 && aggregateIndex < assignment.sqlEnd;
  const aggregateNode = aggregateIndex >= 0 ? order[aggregateIndex] : undefined;

  /** Mask expression accumulated per non-SQL stage. */
  const maskExpr: Partial<Record<'cpu' | 'gpu', Expr>> = {};
  /** GPU-stage predicate the compaction engine evaluates, when the assignment compacts. */
  let compactExpr: Expr | undefined;

  for (let i = 0; i < n; i++) {
    const node = order[i];
    const stage = stageOfNode(i);

    switch (node.kind) {
      case 'filter': {
        if (stage === 'sql') {
          whereExprs.push(node.expr!);
          assignments.push({
            nodeId: node.id, type: 'filter', engine: 'sql',
            why: `WHERE clause; removes rows (est. ${pct(selectivityOf(chosen, node.id))} kept)`,
          });
        } else if (stage === 'gpu' && assignment.compact) {
          compactExpr = compactExpr
            ? { kind: 'binary', op: '&&', left: compactExpr, right: node.expr! }
            : node.expr!;
          assignments.push({
            nodeId: node.id, type: 'filter', engine: 'gpu',
            why: `GPU compaction; rows removed on the GPU and drawn indirectly (est. ${pct(selectivityOf(chosen, node.id))} kept), no requery`,
          });
        } else {
          // Outside SQL a predicate cannot remove rows, so it becomes a discard mask and
          // the row keeps costing memory and an instance slot. Said plainly because it is
          // the main reason the optimizer prefers SQL for filters.
          maskAttribute = mask;
          const prior = maskExpr[stage];
          maskExpr[stage] = prior
            ? { kind: 'binary', op: '&&', left: prior, right: node.expr! }
            : node.expr!;
          assignments.push({
            nodeId: node.id, type: 'filter', engine: stage,
            why: 'discard mask; the row still occupies memory and an instance slot',
          });
        }
        break;
      }

      case 'aggregate': {
        if (stage !== 'sql') {
          throw new PlanError(
            `Node ${node.id}: aggregate cannot run after the SQL stage has closed. Move it upstream of the GPU-only nodes.`,
          );
        }
        assignments.push({
          nodeId: node.id, type: 'aggregate', engine: 'sql',
          why: 'aggregates collapse rows; no per-invocation GPU analogue',
        });
        break;
      }

      case 'attribute': {
        if (stage === 'sql') {
          const bucket = aggregateInSql && i > aggregateIndex ? postAggSelect : preAggSelect;
          bucket.push({ name: node.name!, width: node.width, expr: node.expr!, str: analysis.strings.has(node.name!) });
          assignments.push({
            nodeId: node.id, type: 'attribute', engine: 'sql',
            why: node.feasible.has('gpu')
              ? 'placed in SQL by the plan'
              : 'no GPU equivalent for one of its functions',
          });
        } else {
          const target = stage === 'cpu' ? cpuStage : gpuStage;
          target.push({ nodeId: node.id, name: node.name!, expr: node.expr! });
          assignments.push({
            nodeId: node.id, type: 'attribute', engine: stage,
            why: node.feasible.has('sql')
              ? `placed on the ${stage.toUpperCase()} by the plan; value params rebind cheaply here`
              : 'not SQL-expressible (ramp/swizzle)',
          });
        }
        break;
      }

      case 'raw': {
        const src = node.node as RawNode;
        const rawStage: RawStage = {
          engine: src.engine,
          code: src.code,
          writes: src.writes,
          reads: [...(src.reads ?? [])],
          params: [...(src.params ?? [])],
          label: src.label,
        };
        if (src.engine === 'sql') {
          const bucket = aggregateInSql && i > aggregateIndex ? postAggSelect : preAggSelect;
          for (const w of src.writes) {
            bucket.push({ name: w.name, width: w.width, raw: rawSqlFor(rawStage, w.name, src.id) });
          }
        } else {
          gpuStage.push({ nodeId: src.id, name: src.writes[0].name, raw: rawStage });
        }
        assignments.push({
          nodeId: src.id, type: 'raw', engine: src.engine,
          why: `raw ${src.engine}; pinned by declaration, not placed`,
        });
        break;
      }

      case 'bin2d':
        assignments.push({
          nodeId: node.id, type: 'bin2d', engine: 'gpu', why: 'atomic binning compute pass',
        });
        break;
    }
  }

  // Masks are emitted at the head of their stage so later nodes can read them.
  if (maskExpr.cpu) cpuStage.unshift({ nodeId: `${mask}_cpu`, name: mask, expr: maskExpr.cpu });
  if (maskExpr.gpu) {
    // If the CPU stage already produced a mask, extend it rather than replacing it.
    const expr: Expr = maskExpr.cpu
      ? { kind: 'binary', op: '&&', left: { kind: 'col', name: mask }, right: maskExpr.gpu }
      : maskExpr.gpu;
    gpuStage.unshift({ nodeId: `${mask}_gpu`, name: mask, expr });
  }

  // --- statistics queries --------------------------------------------------
  const stats: StatsPlan[] = analysis.statsNodes.map((s) => {
    const outputs = s.ops.map((op) => ({ column: `${op}`, param: statParamName(s.id, op) }));
    // A statement of its own, so it gets its own numbering. The WHERE clause is re-emitted
    // rather than sharing text with the row query, whose numbering differs.
    const bind = new SqlParams();
    const items = s.ops.map((op) => {
      const emitted = toSql(parseExpr(statExpr(op, s.column)), bind);
      return `${emitted.code} AS ${quoteIdent(op)}`;
    });
    const where = emitWhere(whereExprs, bind);
    return {
      nodeId: s.id,
      sql: `SELECT ${items.join(', ')} FROM ${relation}${where}`,
      outputs,
      params: [...bind.order],
    };
  });
  const statsParams = new Set(stats.flatMap((s) => s.outputs.map((o) => o.param)));

  // --- the row query -------------------------------------------------------
  const arrowAttributes: AttributeDecl[] = [];
  const pathId = analysis.layer?.pathId;
  const ringId = analysis.layer?.ringId;
  /** Name plus its non-f32 type, if it has one. */
  const lists = new Map((analysis.layer?.lists ?? []).map((l) => [l.column, l.kind]));
  const typed = (name: string): { name: string; type?: 'str' | 'raw' | 'list' } =>
    lists.has(name) ? { name, type: 'list' }
    : analysis.strings.has(name) ? { name, type: 'str' }
    : name === pathId || name === ringId ? { name, type: 'raw' }
    : name === analysis.rowIdColumn ? { name, type: 'raw' }
    : { name };
  // One numbering for the whole row query: SELECT list and WHERE clause together.
  const rowBind = new SqlParams();
  let sql: string;

  // Columns the CPU and GPU stages still need, plus what the stats read.
  const needed = new Set<string>();
  for (const s of [...cpuStage, ...gpuStage]) {
    // A raw node cannot be walked, so its declared reads stand in for `columnsOf`.
    if (s.raw) { for (const r of s.raw.reads) needed.add(r); continue; }
    for (const c of columnsOf(s.expr!)) needed.add(c);
  }
  for (const s of analysis.statsNodes) needed.add(s.column);
  // Anything bound outside the graph — a channel, a layer binding, a path id, a sort key —
  // must be selected even when no stage reads it. A channel bound straight to a source column
  // (`size: 'mag'`) used to be dropped here, and the runtime then skipped the binding silently.
  const external = externalAttributes(analysis);
  // The compaction engine reads its inputs from buffers after the kernel, so they are external
  // to it, and any source column among them must be selected even if no kernel node reads it.
  const compactReads = compactExpr ? columnsOf(compactExpr) : [];
  for (const r of compactReads) external.add(r);
  for (const name of external) if (analysis.sourceSchema.has(name)) needed.add(name);

  if (aggregateInSql && aggregateNode?.aggs && aggregateNode.groupBy) {
    const groupBy = aggregateNode.groupBy;
    const aggs = aggregateNode.aggs;
    const groupItems = groupBy.map((g) => quoteIdent(g));
    const aggItems = aggs.map(
      (a) => `${castToFloat(toSql(a.expr, rowBind).code)} AS ${quoteIdent(a.name)}`,
    );
    const where = emitWhere(whereExprs, rowBind);
    // SQL-stage attributes upstream of the aggregate — a grid cell key `floor(lng / cell)`,
    // say — must exist before GROUP BY can read them, so they get a subquery of their own.
    // Without it the query grouped by a column that was never computed.
    let from = relation;
    if (preAggSelect.length > 0) {
      const shadowed = preAggSelect
        .flatMap((item) => componentColumns(item.name, item.width))
        .filter((c) => analysis.sourceSchema.has(c));
      const star = shadowed.length ? `* EXCLUDE (${shadowed.map(quoteIdent).join(', ')})` : '*';
      const pre = preAggSelect.flatMap((item) => selectItems(item, rowBind, isSqlPosition(item) || isPrecise(item)));
      from = `(SELECT ${star}, ${pre.join(', ')} FROM ${relation}) AS "pre"`;
    }
    const inner = `SELECT ${[...groupItems, ...aggItems].join(', ')} FROM ${from}${where} GROUP BY ${groupItems.join(', ')}`;

    for (const g of groupBy) {
      arrowAttributes.push({ ...typed(g), width: 1, provenance: 'arrow', sourceColumns: [g] });
    }
    for (const a of aggs) {
      arrowAttributes.push({ name: a.name, width: 1, provenance: 'arrow', sourceColumns: [a.name] });
    }

    if (postAggSelect.length > 0) {
      // A SQL-stage attribute after the aggregate must read the grouped result, which
      // means wrapping rather than adding to the same SELECT list.
      const outer = [
        ...groupItems,
        ...aggs.map((a) => quoteIdent(a.name)),
        ...postAggSelect.flatMap((item) => selectItems(item, rowBind, isSqlPosition(item) || isPrecise(item))),
      ];
      sql = `SELECT ${outer.join(', ')} FROM (${inner}) AS "agg"`;
      notes.push('a SQL attribute follows the aggregate, so the query is wrapped in a subquery');
    } else {
      sql = inner;
    }
    for (const s of postAggSelect) {
      arrowAttributes.push({
        ...typed(s.name), width: s.width, provenance: 'arrow',
        sourceColumns: componentColumns(s.name, s.width), ...sqlFormat(s),
      });
    }
  } else {
    // Projection pushdown: only source columns something downstream reads.
    // `__rowid` is in the analysed schema so expressions can name it, but the relation has no
    // such column: it is DuckDB's ROWID pseudo-column, selected by `rowidExpr` below. Letting it
    // through as a passthrough emitted `"__rowid" AS "__rowid"`, which DuckDB rejects.
    const rowidExpr = analysis.rowIdColumn === '__rowid'
      ? 'CAST(ROWID AS INTEGER) AS "__rowid"'
      : undefined;
    const passthrough = [...needed]
      .filter((c) => analysis.sourceSchema.has(c) && !(rowidExpr && c === '__rowid'))
      .sort();
    const items = [
      ...(rowidExpr ? [rowidExpr] : []),
      // Cast in SQL: everything reaching a GPU buffer is f32, so narrowing here uses DuckDB's
      // vectorised executor instead of a JS loop, and sidesteps DECIMAL entirely.
      ...passthrough.map((c) => (typed(c).type
        // A geometry is selected as it is: the runtime reads its bytes, and ST_AsWKB would
        // copy every vertex for nothing
        ? `${quoteIdent(c)} AS ${quoteIdent(c)}`
        : `${(c === preciseName ? castToDouble : castToFloat)(quoteIdent(c))} AS ${quoteIdent(c)}`)),
      ...preAggSelect.flatMap((item) => selectItems(item, rowBind, isSqlPosition(item) || isPrecise(item))),
    ];
    if (items.length === 0) items.push('1 AS "__unit"');
    sql = `SELECT ${items.join(', ')} FROM ${relation}${emitWhere(whereExprs, rowBind)}`;

    if (rowidExpr) {
      arrowAttributes.push({
        name: '__rowid',
        width: 1,
        provenance: 'arrow',
        type: 'raw',
        sourceColumns: ['__rowid'],
      });
    }
    for (const c of passthrough) {
      arrowAttributes.push({
        ...typed(c), width: 1, provenance: 'arrow', sourceColumns: [c], ...(c === preciseName ? { precise: true } : {}),
      });
    }
    for (const s of preAggSelect) {
      arrowAttributes.push({
        ...typed(s.name), width: s.width, provenance: 'arrow',
        sourceColumns: componentColumns(s.name, s.width), ...sqlFormat(s),
      });
    }
    notes.push(
      `projection pushdown: ${passthrough.length} of ${analysis.sourceSchema.size} source columns selected`,
    );

    if (aggregateIndex >= 0 && !aggregateInSql) {
      throw new PlanError(
        `Node ${order[aggregateIndex].id}: aggregate cannot run after the SQL stage has closed. Move it upstream of the GPU-only nodes.`,
      );
    }
  }

  // --- output order --------------------------------------------------------
  if (analysis.layer && analysis.layer.orderBy.length > 0) {
    const sqlNames = new Set([...analysis.sourceSchema.keys(), ...arrowAttributes.map((a) => a.name)]);
    for (const c of analysis.layer.orderBy) {
      if (!sqlNames.has(c)) {
        throw new PlanError(
          `Layer ${analysis.layer.id}: cannot order by '${c}'; only source columns and SQL-stage attributes are sortable`,
        );
      }
    }
    // On the outermost statement, so the order survives the aggregate wrapper.
    sql += ` ORDER BY ${analysis.layer.orderBy.map(quoteIdent).join(', ')}`;
  }

  // --- CPU stage declarations ---------------------------------------------
  const widthOfName = new Map<string, number>();
  for (const a of arrowAttributes) widthOfName.set(a.name, a.width);

  const cpuAttributes: AttributeDecl[] = [];
  for (const s of cpuStage) {
    const node = order.find((o) => o.id === s.nodeId);
    const width = node?.width ?? inferWidth(s.expr!, widthOfName);
    widthOfName.set(s.name, width);
    if (!cpuAttributes.some((a) => a.name === s.name)) {
      // A position the SQL stage already gave a `hilo` buffer keeps that layout.
      const upstream = arrowAttributes.find((a) => a.name === s.name)?.format;
      const format = upstream ?? (s.name === analysis.channels.position && width >= 2
        ? positionFormat(analysis, ctx.caps, 'cpu') : undefined);
      cpuAttributes.push({ name: s.name, width, provenance: 'cpu', internal: node?.internal, ...(format ? { format } : {}) });
    }
  }

  // --- GPU stage: one fused kernel ----------------------------------------
  const derivedAttributes: AttributeDecl[] = [];
  const kernels: KernelPlan[] = [];
  const uniformParams = new Set<string>();

  if (gpuStage.length > 0) {
    // Attributes anything outside the kernel needs (`externalAttributes`). Everything else the
    // kernel produces is a temporary — a wrangle local, typically — and lives in an SSA
    // register rather than a storage buffer. Giving those a buffer would waste bandwidth and
    // burn a binding slot against the per-stage limit for a value nothing outside the kernel
    // ever reads.
    const kernelExternal = new Set(external);
    // A CPU-stage or SQL-stage attribute name reused later must keep its buffer too.
    for (const a of [...arrowAttributes, ...cpuAttributes]) kernelExternal.add(a.name);

    // The color channel packs as RGBA8 unless something upstream of the kernel already gave
    // it an f32 buffer under the same name.
    const colorName = packedColorName(analysis);
    const packed = colorName && !arrowAttributes.some((a) => a.name === colorName) && !cpuAttributes.some((a) => a.name === colorName)
      ? colorName : undefined;
    // Storage formats the kernel must read and write in. An upstream buffer's format wins,
    // because the kernel reads or overwrites that buffer in place.
    const formats = new Map<string, AttributeFormat>();
    for (const a of [...arrowAttributes, ...cpuAttributes]) if (a.format) formats.set(a.name, a.format);
    if (packed) formats.set(packed, 'rgba8');
    const position = analysis.channels.position;
    const gpuPosition = positionFormat(analysis, ctx.caps, 'gpu');
    if (gpuPosition && !formats.has(position)) formats.set(position, gpuPosition);
    const kernel = buildKernel(gpuStage, widthOfName, derivedAttributes, order, kernelExternal, formats);
    kernels.push(kernel);
    for (const p of kernel.params) uniformParams.add(p);
  }

  // --- parameters ---------------------------------------------------------
  const declaredParams: Record<string, ParamSpec> = { ...analysis.params };
  for (const p of statsParams) {
    if (!declaredParams[p]) declaredParams[p] = { value: 0, kind: 'value', label: p };
  }
  const derivedNames = new Set(analysis.derived.map((d) => d.name));
  for (const p of [...rowBind.order, ...uniformParams]) {
    if (!declaredParams[p] && !derivedNames.has(p)) {
      throw new PlanError(`Parameter '${p}' is referenced but not declared in graph.params`);
    }
  }
  // CPU-stage and compaction params are neither SQL binds nor uniforms, but must still be declared.
  for (const expr of [...cpuStage.map((s) => s.expr!), ...(compactExpr ? [compactExpr] : [])]) {
    for (const p of paramsIn(expr)) {
      if (!declaredParams[p] && !derivedNames.has(p)) {
        throw new PlanError(`Parameter '${p}' is referenced but not declared in graph.params`);
      }
    }
  }

  const attributes = [...arrowAttributes, ...cpuAttributes, ...derivedAttributes];

  // --- render bindings ----------------------------------------------------
  if (analysis.layer) {
    for (const b of analysis.layer.bindings) {
      // A path column is checked when the runtime flattens it
      if (lists.has(b.attribute)) continue;
      const decl = attributes.find((a) => a.name === b.attribute);
      if (!decl) {
        throw new PlanError(
          `Layer ${analysis.layer.id}: channel '${b.channel}' reads '${b.attribute}', which the graph does not produce`,
        );
      }
      if ((b.type === 'str') !== (decl.type === 'str')) {
        if (ctx.columnTypes?.get(b.attribute) === 'other') {
          throw new PlanError(
            `Layer ${analysis.layer.id}: channel '${b.channel}' takes a number, but '${b.attribute}' is a list or struct. ` +
            `A list of 2 to 4 numbers reads as a vector when every row's list has the same length`,
          );
        }
        throw new PlanError(
          `Layer ${analysis.layer.id}: channel '${b.channel}' takes ${b.type === 'str' ? 'a string' : 'a number'}, ` +
          `but '${b.attribute}' is ${decl.type === 'str' ? 'a string' : 'numeric'}` +
          (decl.type === 'str' && /color/i.test(b.channel) ? `. For hex colors use hex_color(${b.attribute})` : ''),
        );
      }
      if (b.type === 'vec' && decl.width < 2) {
        throw new PlanError(`Layer ${analysis.layer.id}: '${b.channel}' needs 2+ components, '${b.attribute}' has ${decl.width}`);
      }
    }
  } else if (analysis.channels.mode === 'points') {
    const posName = analysis.channels.position;
    const pos = attributes.find((a) => a.name === posName);
    if (!pos) throw new PlanError(`Render node needs attribute '${posName}' for position; none was produced`);
    if (pos.width < 2) throw new PlanError(`Position attribute '${posName}' must have 2+ components, got ${pos.width}`);
  } else if (!analysis.bin2d) {
    throw new PlanError(`Render mode 'heatmap' requires a bin2d node upstream`);
  }

  // Edges over the nodes that survived: the placeable ones, plus the source and render nodes
  // that bracket them. Read off `input`/`inputs` rather than recomputed, so this cannot
  // disagree with the order the planner actually used.
  const planned = new Set<string>([
    analysis.source.id, analysis.render.id, ...order.map((o) => o.id),
  ]);
  const edges: [string, string][] = [];
  const addEdges = (to: string, node: { input?: string; inputs?: string[] }) => {
    const froms = node.inputs ?? (node.input ? [node.input] : []);
    for (const from of froms) if (planned.has(from)) edges.push([from, to]);
  };
  for (const o of order) addEdges(o.id, o.node as { input?: string; inputs?: string[] });
  addEdges(analysis.render.id, analysis.render);

  const placement = order.map((node, i) => ({
    nodeId: node.id,
    kind: node.kind,
    stage: stageOfNode(i),
    ops: node.ops,
    why: assignments.find((a) => a.nodeId === node.id)?.why ?? '',
  }));

  const chosenCandidate = chosen.candidates.find((c) => sameAssignment(c.assignment, assignment));

  assignments.push({
    nodeId: analysis.render.id, type: 'render', engine: 'render',
    why: `mode=${analysis.render.mode}`,
  });

  return {
    sql,
    sqlParams: [...rowBind.order],
    stats,
    kernels,
    cpuStage,
    gpuStage,
    attributes,
    uniformParams: [...uniformParams],
    params: declaredParams,
    derived: analysis.derived,
    render: analysis.render,
    layer: analysis.layer,
    channels: analysis.channels,
    conventions: analysis.conventions,
    ramp: analysis.ramp,
    bin2d: analysis.bin2d,
    assignments,
    notes,
    maskAttribute,
    compaction: compactExpr
      ? { predicate: compactExpr, reads: compactReads, params: paramsIn(compactExpr) }
      : undefined,
    explain: {
      method: chosen.method,
      chosen: assignment,
      candidates: chosen.candidates,
      estimated: chosenCandidate?.cost,
      estimatedRows: chosen.sqlRows,
      estimatedSelectivity: chosen.estimatedSelectivity,
      costs: ctx.costs,
      caps: ctx.caps,
      placement,
      edges,
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// Kernel codegen
// ---------------------------------------------------------------------------

function buildKernel(
  stage: StageNode[],
  widths: Map<string, number>,
  derivedOut: AttributeDecl[],
  order: AnalyzedNode[],
  /** Names something outside the kernel reads. Anything else stays in a register. */
  external: Set<string>,
  /** Attributes stored in a format other than f32 components (`packing.ts`). */
  formats: Map<string, AttributeFormat> = new Map(),
): KernelPlan {
  /** SSA: attribute name -> current WGSL local. Lets a node overwrite what it reads. */
  const live = new Map<string, { code: string; width: number }>();
  let ssa = 0;

  const reads = new Set<string>();
  const writes: string[] = [];
  const params = new Set<string>();
  const body: string[] = [];
  /** Kernel temporaries that never reach a buffer. */
  const registerOnly = new Set<string>();
  let usesRamp = false;

  const resolve: Resolver = (name) => {
    const existing = live.get(name);
    if (existing) return existing;
    const width = widths.get(name);
    if (width === undefined) {
      throw new PlanError(`Kernel references attribute '${name}' that no upstream stage produced`);
    }
    reads.add(name);
    const local = `r${ssa++}`;
    body.push(`  let ${local} = ${loadAttribute(name, width, formats.get(name))};`);
    const val = { code: local, width };
    live.set(name, val);
    return val;
  };

  for (const node of stage) {
    if (node.raw) {
      emitRaw(node, node.raw, {
        resolve, body, live, widths, params, writes, derivedOut, external, registerOnly, order,
        next: () => `v${ssa++}`, formats,
      });
      continue;
    }
    const emitted = toWgsl(node.expr!, resolve);
    for (const p of emitted.params) params.add(p);
    if (/\bsampleRamp\(/.test(emitted.code)) usesRamp = true;
    const local = `v${ssa++}`;
    body.push(`  // ${node.nodeId}: ${node.name}`);
    body.push(`  let ${local} = ${emitted.code};`);
    live.set(node.name, { code: local, width: emitted.width });
    widths.set(node.name, emitted.width);
    const analyzed = order.find((o) => o.id === node.nodeId);

    // A temporary nothing outside the kernel reads needs no buffer: the SSA local above
    // already holds it for the rest of this invocation.
    if (!external.has(node.name)) {
      registerOnly.add(node.name);
      continue;
    }

    if (!writes.includes(node.name)) writes.push(node.name);
    const format = formats.get(node.name);
    if (!derivedOut.some((d) => d.name === node.name)) {
      derivedOut.push({
        name: node.name, width: emitted.width, provenance: 'derived', internal: analyzed?.internal,
        ...(format ? { format } : {}),
      });
    }
    body.push(...storeAttribute(node.name, local, emitted.width, format, node.nodeId));
  }

  // A register-only temporary is never bound, even though earlier nodes "read" it — the
  // resolver returned its SSA local, not a buffer load.
  const readOnly = [...reads].filter((r) => !writes.includes(r) && !registerOnly.has(r));

  const bindings: string[] = [];
  let slot = 0;
  const paramList = [...params];
  bindings.push(
    paramList.length > 0
      ? `struct Params {\n${paramList.map((p) => `  ${wgslParamMember(p)}: f32,`).join('\n')}\n};\n@group(0) @binding(${slot++}) var<uniform> params: Params;`
      : `@group(0) @binding(${slot++}) var<uniform> params: vec4<f32>;`,
  );
  // Not `meta` — that is a WGSL reserved keyword.
  bindings.push(`@group(0) @binding(${slot++}) var<uniform> rowInfo: vec4<u32>; // .x = row count`);
  if (usesRamp) {
    bindings.push(`@group(0) @binding(${slot++}) var<storage, read> ramp_lut: array<vec4<f32>>;`);
  }
  const element = (name: string) => (formats.get(name) === 'rgba8' ? 'u32' : 'f32');
  for (const name of readOnly) {
    bindings.push(`@group(0) @binding(${slot++}) var<storage, read> ${bufName(name)}: array<${element(name)}>;`);
  }
  for (const name of writes) {
    bindings.push(`@group(0) @binding(${slot++}) var<storage, read_write> ${bufName(name)}: array<${element(name)}>;`);
  }

  const prelude = usesRamp
    ? `
fn sampleRamp(t: f32) -> vec3<f32> {
  let n = f32(arrayLength(&ramp_lut) - 1u);
  let x = clamp(t, 0.0, 1.0) * n;
  let i0 = u32(floor(x));
  let i1 = min(i0 + 1u, u32(n));
  let f = x - floor(x);
  return mix(ramp_lut[i0].rgb, ramp_lut[i1].rgb, f);
}
`
    : '';

  const code = `${bindings.join('\n')}
${prelude}
@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= rowInfo.x) { return; }
${body.join('\n')}
}
`;

  return {
    id: 'kernel0',
    code,
    reads: readOnly,
    writes,
    params: paramList,
    usesRamp,
    nodeIds: stage.map((s) => s.nodeId),
  };
}

// ---------------------------------------------------------------------------

/** Emit the shared WHERE clause into a statement's own placeholder numbering. */
function emitWhere(exprs: Expr[], bind: SqlParams): string {
  if (exprs.length === 0) return '';
  return ` WHERE ${exprs.map((e) => toSql(e, bind).code).join(' AND ')}`;
}

/** WGSL that loads one row of an attribute as a value of its logical width. */
function loadAttribute(name: string, width: number, format: AttributeFormat | undefined): string {
  const buf = bufName(name);
  if (format === 'rgba8') return width === 4 ? `unpack4x8unorm(${buf}[i])` : `unpack4x8unorm(${buf}[i]).rgb`;
  if (format === 'hilo') {
    // hi + lo in f32 rounds back to hi: kernel arithmetic is f32 either way. The precision
    // lives in the buffer for the renderer, which subtracts the eye from each half first.
    const stride = width * 2;
    return `${wgslType(width)}(${range(width).map((c) => `${buf}[i * ${stride}u + ${c}u] + ${buf}[i * ${stride}u + ${width + c}u]`).join(', ')})`;
  }
  if (width === 1) return `${buf}[i]`;
  return `${wgslType(width)}(${range(width).map((c) => `${buf}[i * ${width}u + ${c}u]`).join(', ')})`;
}

/** WGSL statements that store a local into one row of an attribute. */
function storeAttribute(
  name: string, local: string, width: number, format: AttributeFormat | undefined, nodeId: string,
): string[] {
  const buf = bufName(name);
  if (format === 'rgba8') {
    // `packedColorName` chose this attribute from its final width. An earlier write of another
    // width would leave the buffer holding two layouts, so refuse rather than mix them.
    if (width !== 3 && width !== 4) {
      throw new PlanError(`Node ${nodeId}: color attribute is packed as RGBA8 but this write has width ${width}`);
    }
    // `pack4x8unorm` clamps to [0, 1], so an out-of-range color saturates exactly as
    // `toUint8Color` does on the CPU path.
    const packed = width === 4 ? `pack4x8unorm(${local})` : `pack4x8unorm(vec4<f32>(${local}, 1.0))`;
    return [`  ${buf}[i] = ${packed};`];
  }
  if (format === 'hilo') {
    // A kernel computes in f32, so the low half is zero: the layout without the precision.
    const stride = width * 2;
    const at = (c: number) => (width === 1 ? local : `${local}[${c}]`);
    return range(width).flatMap((c) => [
      `  ${buf}[i * ${stride}u + ${c}u] = ${at(c)};`,
      `  ${buf}[i * ${stride}u + ${width + c}u] = 0.0;`,
    ]);
  }
  if (width === 1) return [`  ${buf}[i] = ${local};`];
  return range(width).map((c) => `  ${buf}[i * ${width}u + ${c}u] = ${local}[${c}];`);
}

function bufName(attr: string): string {
  return `b_${attr.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

export { bufName };

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function componentColumns(name: string, width: number): string[] {
  return width === 1 ? [name] : range(width).map((i) => `${name}_${i}`);
}

function selectivityOf(chosen: OptimizeResult, nodeId: string): number {
  return chosen.estimatedSelectivity.find((s) => s.nodeId === nodeId)?.selectivity ?? 1;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Width for a synthesised stage node such as the discard mask. Analyzed nodes already
 * carry their width; this is only the safety net for nodes emit creates itself.
 */
function inferWidth(e: Expr, widths: Map<string, number>): number {
  return widthOf(e, (n) => widths.get(n) ?? 1);
}

function paramsIn(e: Expr): string[] {
  const out = new Set<string>();
  const walk = (n: Expr): void => {
    switch (n.kind) {
      case 'param': out.add(n.name); break;
      case 'unary': walk(n.operand); break;
      case 'binary': walk(n.left); walk(n.right); break;
      case 'call': n.args.forEach(walk); break;
      case 'vec': n.components.forEach(walk); break;
      case 'swizzle': walk(n.target); break;
      case 'cond': walk(n.test); walk(n.then); walk(n.else); break;
      default: break;
    }
  };
  walk(e);
  return [...out];
}
