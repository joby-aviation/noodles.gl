/**
 * Phase 1 of planning: turn a graph into a costable, placeable description.
 *
 * Analysis answers only questions with objective answers — what is the topological order,
 * which engines *could* run each node, how wide is each attribute, how many scalar
 * operations does each expression cost. It makes no placement decisions. Keeping this
 * separate from `optimize` and `emit` is the change that makes a cost model possible at
 * all: in the original single-pass planner the decision was interleaved with codegen, so
 * there was no moment at which a plan existed as data that could be priced or compared.
 */

import {
  type Expr, parseExpr, columnsOf, enginesFor, isAggregate, simplifyExpr, widthOf,
  FUNCTIONS,
} from './expr.js';
import {
  type Graph, type CoreNode, type RenderNode, type Bin2dNode, type StatsNode,
  type SourceNode, type RawNode, type ParamSpec, type RampName, type LayerNode, desugar,
} from './types.js';
import { LAYER_SPECS, propParams, type LayerKind, type ChannelType, type LayerPropValue } from './layers.js';
import { type AttributeConventions, attributeConventions, isInternal } from './conventions.js';
import { type FunctionRegistry, inlineFunctions } from './functions.js';
import { type DerivedParam, HOIST_PREFIX, hoistParams } from './hoist.js';

export type Stage = 'sql' | 'cpu' | 'gpu';

export class PlanError extends Error {}

/** Column or attribute name -> component count. */
export type Schema = Map<string, number>;

/**
 * What a relation column holds, beyond its width. `Schema` stays numeric-width-only so every
 * existing caller keeps working; a caller with string columns passes these alongside it.
 * `other` covers lists, structs and timestamps: selectable into a relation, never into a buffer.
 */
export type ColumnType = 'num' | 'str' | 'other';
export type ColumnTypes = ReadonlyMap<string, ColumnType>;

export interface AnalyzedNode {
  id: string;
  node: CoreNode;
  kind: 'filter' | 'aggregate' | 'attribute' | 'bin2d' | 'raw';
  /** Attribute nodes: the name they write. */
  name?: string;
  /** Filter predicate or attribute expression. */
  expr?: Expr;
  /** Aggregate nodes: parsed aggregate expressions, so emit does not re-parse. */
  aggs?: { name: string; expr: Expr }[];
  /** Aggregate nodes: the group-by columns. */
  groupBy?: string[];
  /** Result width for attribute nodes. */
  width: number;
  /** Approximate scalar operation count, the marginal-cost input. */
  ops: number;
  /** Engines that could evaluate this node, ignoring stage ordering. */
  feasible: Set<Stage>;
  /** True for wrangle locals, which the inspector hides. */
  internal: boolean;
  /** Attributes this node reads. */
  reads: string[];
  /**
   * Parameters this node reads, by their declared names. A hoisted subtree is still counted
   * under its sources, so a rebind is charged to the node the value lands in.
   */
  params: string[];
}

/**
 * The render node's channels with every name resolved to a concrete attribute.
 *
 * Resolution happens here, once. Downstream code — the optimizer, the emitters, the WebGPU
 * runtime, the deck.gl adapters — reads these without a fallback, so there is no `?? 'P'`
 * anywhere else to disagree with. Whether a channel is actually *bound* is a separate
 * question, answered by whether the named attribute exists after the graph has run.
 */
export interface RenderChannels {
  mode: 'points' | 'heatmap';
  position: string;
  color: string;
  size: string;
  opacity: string;
  background?: [number, number, number];
}

/** One resolved layer channel: which attribute feeds it, and what kind of value it is. */
export interface LayerBinding {
  channel: string;
  attribute: string;
  type: ChannelType;
  required: boolean;
}

/**
 * A layer output with every channel resolved. Published once by `analyze`, like `channels`,
 * so emit, the optimizer and the deck adapters agree on what the layer reads.
 */
export interface LayerAnalysis {
  id: string;
  kind: LayerKind;
  bindings: LayerBinding[];
  pathId?: string;
  /** Polygon layers: the column splitting each polygon into rings. */
  ringId?: string;
  orderBy: string[];
  props: Record<string, LayerPropValue>;
  /** Parameters read by props. They route as `prop`: deck applies them, the plan never sees them. */
  propParams: string[];
}

export interface Analysis {
  source: SourceNode;
  /**
   * The output node. For a layer output this is a points-mode render synthesized from it, so
   * every consumer of `render` keeps working; the layer itself is in `layer`.
   */
  render: RenderNode;
  /** Present when the output is a `layer` node. */
  layer?: LayerAnalysis;
  /**
   * String-valued columns and attributes. Anything that reads one is SQL-only, and emit
   * selects them uncast.
   */
  strings: Set<string>;
  /** `render`'s channels, with the attribute conventions applied. */
  channels: RenderChannels;
  /** The naming vocabulary this analysis was produced under. */
  conventions: AttributeConventions;
  /** User functions declared by the graph. Already inlined into every `expr` below. */
  functions: FunctionRegistry;
  bin2d?: Bin2dNode;
  statsNodes: StatsNode[];
  /** Placeable nodes in topological order. */
  order: AnalyzedNode[];
  sourceSchema: Schema;
  /** Final attribute widths, after every node has run. */
  widths: Schema;
  /** Group-by columns of the single aggregate, if any. */
  groupBy: string[];
  aggregateNames: string[];
  ramp?: RampName;
  /** Column preserving source row identity, if requested via `preserveRowId`. */
  rowIdColumn?: string;
  params: Record<string, ParamSpec>;
  /**
   * Param-only subexpressions lifted out of the trees above (`hoist.ts`). The trees read them
   * as `{{__hoist_…}}`; every consumer binds them through `withDerived`.
   */
  derived: DerivedParam[];
  notes: string[];
}

export interface AnalyzeOptions {
  /**
   * Lift param-only subexpressions into derived parameters. Default true. Off where
   * parameters are inlined as literals instead of bound, which DuckDB folds itself.
   */
  hoist?: boolean;
}

/**
 * The CPU (generated JS) backend implements every function the GPU backend does — see the
 * `JS_FN` table in `backends/js.ts` — so a node is CPU-feasible exactly when it is
 * GPU-feasible. Stated once here rather than implied by two parallel checks that could
 * drift.
 */
function feasibleStages(e: Expr): Set<Stage> {
  const engines = enginesFor(e);
  const out = new Set<Stage>();
  if (engines.has('sql')) out.add('sql');
  if (engines.has('gpu')) {
    out.add('gpu');
    out.add('cpu');
  }
  return out;
}

/**
 * Scalar operations in an expression, as a cost proxy.
 *
 * One for the load itself plus one per interior node, times the result width — an elementwise
 * vec3 operation costs three scalar operations. Additive rather than floored at 1, so a bare
 * copy (`@P = pop`) is distinguishable from a call (`@P = sqrt(pop)`); flooring made every
 * one-operation expression cost the same as a zero-operation one.
 *
 * Crude, but it is a *relative* measure and every engine is charged with the same yardstick,
 * which is what the optimizer needs.
 */
export function opCount(e: Expr, width: number): number {
  let interior = 0;
  const walk = (n: Expr): void => {
    switch (n.kind) {
      case 'unary': interior++; walk(n.operand); break;
      case 'binary': interior++; walk(n.left); walk(n.right); break;
      case 'call': interior++; n.args.forEach(walk); break;
      case 'cond': interior += 1; walk(n.test); walk(n.then); walk(n.else); break;
      case 'vec': n.components.forEach(walk); break;
      case 'swizzle': walk(n.target); break;
      default: break;
    }
  };
  walk(e);
  return (1 + interior) * Math.max(1, width);
}

export function analyze(
  graph: Graph,
  sourceSchema: Schema,
  conventionOverrides?: Partial<AttributeConventions>,
  columnTypes?: ColumnTypes,
  options: AnalyzeOptions = {},
): Analysis {
  const conventions = attributeConventions(conventionOverrides);
  const declared = graph.params ?? {};
  for (const name of Object.keys(declared)) {
    if (name.startsWith(HOIST_PREFIX)) {
      throw new PlanError(`Parameter '${name}': the '${HOIST_PREFIX}' prefix is reserved for hoisted subexpressions`);
    }
  }
  const derived = new Map<string, DerivedParam>();
  const isNumericParam = (name: string) => typeof declared[name]?.value === 'number';
  /** After `params` is read off the tree, so a node keeps its source names. */
  const hoist = (e: Expr): Expr =>
    options.hoist === false ? e : hoistParams(e, isNumericParam, derived);
  const { nodes, notes: sugarNotes, ramp, functions } = desugar(graph, conventions);
  const notes = [...sugarNotes];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const source = nodes.find((n): n is SourceNode => n.type === 'source');
  if (!source) throw new PlanError('Graph has no source node');

  const output = (graph.output ? byId.get(graph.output) : [...nodes].reverse().find((n) => n.type === 'render')) as
    | RenderNode | LayerNode | undefined;
  if (!output || (output.type !== 'render' && output.type !== 'layer')) {
    throw new PlanError('Graph has no render node');
  }
  const layerNode = output.type === 'layer' ? output : undefined;
  const render: RenderNode = output.type === 'render' ? output : layerAsRender(output, conventions);

  const channels: RenderChannels = {
    mode: render.mode,
    position: render.position ?? conventions.position,
    color: render.color ?? conventions.color,
    size: render.size ?? conventions.size,
    opacity: render.opacity ?? conventions.opacity,
    background: render.background,
  };

  // --- topological order over the ancestry of the render node --------------
  const ordered = topoSort(nodes, byId, render, notes);

  // String columns join the namespace as width-1 names so references resolve; `strings`
  // is what keeps them out of every stage but SQL.
  const strings = new Set<string>();
  const fullSource: Schema = new Map(sourceSchema);
  // Lists, structs and geometry are SQL-only too: an expression can read one in SQL (`item`
  // of a list, say) and hand the CPU a number.
  for (const [name, type] of columnTypes ?? []) {
    if (type === 'num') continue;
    strings.add(name);
    if (!fullSource.has(name)) fullSource.set(name, 1);
  }
  sourceSchema = fullSource;
  const schema: Schema = new Map(sourceSchema);

  // Validate and register row ID column if requested
  let rowIdColumn: string | undefined;
  if (source.preserveRowId) {
    if (typeof source.preserveRowId === 'string') {
      rowIdColumn = source.preserveRowId;
      if (!sourceSchema.has(rowIdColumn)) {
        throw new PlanError(
          `Source ${source.id}: preserveRowId='${rowIdColumn}' not found in schema. ` +
          `Available: ${[...sourceSchema.keys()].join(', ')}`
        );
      }
      if (strings.has(rowIdColumn)) {
        throw new PlanError(
          `Source ${source.id}: preserveRowId='${rowIdColumn}' is a string column. ` +
          `Row ID must be numeric.`
        );
      }
    } else {
      // Use DuckDB's built-in ROWID
      rowIdColumn = '__rowid';
      sourceSchema.set(rowIdColumn, 1);
      schema.set(rowIdColumn, 1);
    }
  }

  /** Restrict to SQL if the tree reads a string, and say why. */
  const readsString = (e: Expr) => columnsOf(e).some((c) => strings.has(c));
  const withStrings = (e: Expr, feasible: Set<Stage>): Set<Stage> =>
    readsString(e) ? new Set([...feasible].filter((s) => s === 'sql')) : feasible;
  const order: AnalyzedNode[] = [];
  const statsNodes: StatsNode[] = [];
  let groupBy: string[] = [];
  let aggregateNames: string[] = [];
  let sawAggregate = false;

  /**
   * Parse if needed, inline user functions, then simplify the swizzles inlining exposes.
   *
   * Every expression in the graph goes through here, which is what makes functions free: by
   * the time anything else looks at a tree, the calls are gone. Wrangle statements arrive
   * already parsed, so the `Expr` branch matters as much as the string one. The simplify has
   * to follow the inline: `st_x([lng, lat])` only becomes `[lng, lat].x` once inlined.
   */
  const resolve = (src: string | Expr, nodeId: string): Expr => {
    try {
      const tree = typeof src === 'string' ? parseExpr(src, { functions }) : src;
      return coerceStrings(simplifyExpr(inlineFunctions(tree, functions)), strings);
    } catch (err) {
      throw new PlanError(`Node ${nodeId}: ${(err as Error).message}`);
    }
  };
  const parseOrThrow = (src: string, nodeId: string): Expr => resolve(src, nodeId);

  const requireColumns = (e: Expr, nodeId: string) => {
    for (const c of columnsOf(e)) {
      if (!schema.has(c)) {
        throw new PlanError(
          `Node ${nodeId} references unknown attribute '${c}'. Available: ${[...schema.keys()].join(', ')}`,
        );
      }
    }
  };

  // Vector attributes some node computes. SQL holds one as a column per component, so an
  // expression that does more than pass one through (`c / 255.0`) has no SQL form: it would
  // name a column that does not exist.
  const vectorAttributes = new Set<string>();
  const withoutSqlVectors = (e: Expr, stages: Set<Stage>): Set<Stage> => {
    if (e.kind === 'col' || !columnsOf(e).some((c) => vectorAttributes.has(c))) return stages;
    const out = new Set(stages);
    out.delete('sql');
    return out;
  };

  for (const node of ordered) {
    switch (node.type) {
      case 'source':
      case 'render':
      case 'layer':
        break;

      case 'stats':
        statsNodes.push(node);
        break;

      case 'filter': {
        const resolved = parseOrThrow(node.predicate, node.id);
        requireColumns(resolved, node.id);
        const expr = hoist(resolved);
        const feasible = withoutSqlVectors(expr, withStrings(expr, feasibleStages(expr)));
        if (feasible.size === 0) {
          throw new PlanError(`Node ${node.id}: predicate is neither SQL- nor GPU-expressible`);
        }
        order.push({
          id: node.id, node, kind: 'filter', expr, width: 1,
          ops: opCount(expr, 1), feasible, internal: false,
          reads: columnsOf(expr), params: paramsOfExpr(resolved),
        });
        break;
      }

      case 'aggregate': {
        if (sawAggregate) {
          throw new PlanError(`Node ${node.id}: only one aggregate per graph in this prototype`);
        }
        sawAggregate = true;
        const aggs = node.aggs.map((a) => {
          const expr = parseOrThrow(a.expr, node.id);
          requireColumns(expr, node.id);
          if (!isAggregate(expr)) {
            throw new PlanError(`Node ${node.id}: agg '${a.name}' (${a.expr}) is not an aggregate expression`);
          }
          return { name: a.name, expr: hoist(expr), resolved: expr };
        });
        for (const g of node.groupBy) {
          if (!schema.has(g)) throw new PlanError(`Node ${node.id}: unknown groupBy column '${g}'`);
        }
        groupBy = node.groupBy;
        aggregateNames = aggs.map((a) => a.name);

        // The aggregate reshapes the namespace: only group keys and aggregates survive.
        const keep = new Set([...node.groupBy, ...aggregateNames]);
        for (const key of [...schema.keys()]) if (!keep.has(key)) schema.delete(key);
        for (const name of aggregateNames) schema.set(name, 1);

        order.push({
          id: node.id, node, kind: 'aggregate', width: 1,
          aggs: aggs.map(({ name, expr }) => ({ name, expr })), groupBy: node.groupBy,
          ops: aggs.reduce((s, a) => s + opCount(a.expr, 1), 0),
          // Aggregates collapse rows; there is no per-invocation GPU or CPU analogue.
          feasible: new Set<Stage>(['sql']),
          internal: false,
          reads: aggs.flatMap((a) => columnsOf(a.expr)),
          params: aggs.flatMap((a) => paramsOfExpr(a.resolved)),
        });
        break;
      }

      case 'attribute': {
        const resolved = resolve(node.expr, node.id);
        requireColumns(resolved, node.id);
        if (isAggregate(resolved)) {
          throw new PlanError(`Node ${node.id}: attribute expressions cannot aggregate; use an 'aggregate' node`);
        }
        const width = widthOf(resolved, (n) => schema.get(n) ?? 1);
        const expr = hoist(resolved);
        const feasible = withoutSqlVectors(expr, withStrings(expr, feasibleStages(expr)));
        if (feasible.size === 0) {
          throw new PlanError(`Node ${node.id}: expression mixes strings with functions only the GPU has`);
        }
        if (width > 1) vectorAttributes.add(node.name);
        else vectorAttributes.delete(node.name);
        if (isStringValued(resolved, strings)) strings.add(node.name);
        else strings.delete(node.name);
        order.push({
          id: node.id, node, kind: 'attribute', name: node.name, expr, width,
          ops: opCount(expr, width), feasible,
          internal: isInternal(node.name, conventions),
          reads: columnsOf(expr), params: paramsOfExpr(resolved),
        });
        schema.set(node.name, width);
        break;
      }

      case 'raw': {
        const raw = node as RawNode;
        if (raw.writes.length === 0) {
          throw new PlanError(`Node ${raw.id}: a raw node must declare at least one write`);
        }
        for (const r of raw.reads ?? []) {
          if (!schema.has(r)) {
            throw new PlanError(
              `Node ${raw.id} declares a read of unknown attribute '${r}'. ` +
              `Available: ${[...schema.keys()].join(', ')}`,
            );
          }
        }
        // The one node whose feasible set is declared rather than derived, because there is
        // no expression to derive it from. A set of one means it pins the stage boundary.
        const width = Math.max(...raw.writes.map((w) => w.width));
        order.push({
          id: raw.id, node: raw, kind: 'raw', name: raw.writes[0].name, width,
          ops: (raw.opCost ?? 8) * Math.max(1, width),
          feasible: new Set<Stage>([raw.engine === 'sql' ? 'sql' : 'gpu']),
          internal: false,
          reads: [...(raw.reads ?? [])],
          params: [...(raw.params ?? [])],
        });
        for (const w of raw.writes) schema.set(w.name, w.width);
        notes.push(
          `${raw.id}: raw ${raw.engine} node, pinned; ` +
          `declares ${raw.writes.map((w) => `${w.name}:${w.width}`).join(', ')}`,
        );
        break;
      }

      case 'bin2d':
        order.push({
          id: node.id, node, kind: 'bin2d', width: 1,
          // Atomic binning has no SQL or CPU form in this prototype.
          ops: 4, feasible: new Set<Stage>(['gpu']), internal: false, reads: [], params: [],
        });
        break;

      default:
        throw new PlanError(`Unhandled node type: ${(node as { type: string }).type}`);
    }
  }

  for (const s of statsNodes) {
    if (!sourceSchema.has(s.column) && !schema.has(s.column)) {
      // An expression over source columns: its statistics are one SQL aggregate over the
      // relation, so it may read nothing a later stage computes.
      let reads: string[];
      try {
        reads = columnsOf(parseExpr(s.column));
      } catch {
        throw new PlanError(`Stats node ${s.id}: unknown column '${s.column}'`);
      }
      const missing = reads.filter((c) => !sourceSchema.has(c));
      if (missing.length && s.column.trim() === missing[0]) {
        throw new PlanError(`Stats node ${s.id}: unknown column '${s.column}'`);
      }
      if (missing.length) {
        throw new PlanError(`Stats node ${s.id}: '${s.column}' reads ${missing.join(', ')}, which the source does not have`);
      }
      const str = reads.filter((c) => strings.has(c));
      if (str.length) throw new PlanError(`Stats node ${s.id}: '${str.join(', ')}' is a string column`);
      continue;
    }
    if (strings.has(s.column)) throw new PlanError(`Stats node ${s.id}: '${s.column}' is a string column`);
  }

  const layer = layerNode ? resolveLayer(layerNode, conventions, schema) : undefined;

  return {
    source,
    render,
    layer,
    strings,
    channels,
    conventions,
    functions,
    bin2d: ordered.find((n): n is Bin2dNode => n.type === 'bin2d'),
    statsNodes,
    order,
    sourceSchema,
    widths: schema,
    groupBy,
    aggregateNames,
    ramp,
    rowIdColumn,
    params: { ...declared },
    derived: [...derived.values()],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/**
 * The points-mode render a layer stands in for. `position` is the layer's primary position so
 * the existing position checks and the optimizer's external-name rule keep their meaning.
 */
function layerAsRender(layer: LayerNode, conv: AttributeConventions): RenderNode {
  const ch = layer.channels ?? {};
  return {
    id: layer.id,
    type: 'render',
    input: layer.input,
    inputs: layer.inputs,
    mode: 'points',
    position: ch.position ?? ch.sourcePosition ?? conv.position,
    color: ch.color ?? ch.sourceColor ?? conv.color,
    size: ch.radius ?? ch.size ?? ch.width ?? conv.size,
    opacity: conv.opacity,
  };
}

function resolveLayer(layer: LayerNode, conv: AttributeConventions, widths: Schema): LayerAnalysis {
  const spec = LAYER_SPECS[layer.kind];
  if (!spec) throw new PlanError(`Layer ${layer.id}: unknown kind '${layer.kind}'`);
  const given = layer.channels ?? {};
  for (const name of Object.keys(given)) {
    if (!spec.channels.some((c) => c.name === name)) {
      throw new PlanError(
        `Layer ${layer.id}: '${layer.kind}' has no channel '${name}'. ` +
        `Channels: ${spec.channels.map((c) => c.name).join(', ')}`,
      );
    }
  }
  const bindings: LayerBinding[] = [];
  for (const c of spec.channels) {
    const explicit = given[c.name];
    // A fallback binds only when the attribute exists; an explicit binding must exist, and
    // that is checked in emit, where string and source columns are known too.
    const attribute = explicit ?? (c.fallback && widths.has(conv[c.fallback]) ? conv[c.fallback] : undefined);
    if (attribute === undefined) {
      if (c.required) throw new PlanError(`Layer ${layer.id}: '${layer.kind}' needs a '${c.name}' channel`);
      continue;
    }
    bindings.push({ channel: c.name, attribute, type: c.type, required: !!c.required });
  }
  if (spec.vertices && !layer.pathId) {
    throw new PlanError(`Layer ${layer.id}: '${layer.kind}' draws paths, so it needs 'pathId'`);
  }
  if (layer.ringId && !spec.rings) {
    throw new PlanError(`Layer ${layer.id}: '${layer.kind}' has no rings, so 'ringId' does not apply`);
  }
  const ringId = spec.rings ? layer.ringId : undefined;
  const props = { ...(layer.props ?? {}) };
  const readParams = [...new Set(Object.values(props).flatMap(propParams))];
  return {
    id: layer.id,
    kind: layer.kind,
    bindings,
    pathId: layer.pathId,
    ringId,
    // Vertex order within a path is the whole point of a path, so the id always leads; a
    // polygon's ring id comes next, so each ring's vertices are contiguous.
    orderBy: spec.vertices
      ? [layer.pathId!, ...(ringId ? [ringId] : []),
        ...(layer.orderBy ?? []).filter((c) => c !== layer.pathId && c !== ringId)]
      : [...(layer.orderBy ?? [])],
    props,
    propParams: readParams,
  };
}

/**
 * Attributes something outside the graph reads: the render channels, every layer binding, the
 * discard mask and the bin2d weight.
 *
 * One rule, used by the optimizer to count kernel bindings, by emit to decide which kernel
 * outputs need buffers, and by emit again for projection pushdown. It used to be written out
 * in two places, and the copies disagreed about the bin2d weight — one added the expression
 * text, the other its columns.
 */
export function externalAttributes(analysis: Analysis): Set<string> {
  const { position, color, size, opacity } = analysis.channels;
  const out = new Set<string>([position, color, size, opacity, analysis.conventions.mask]);
  if (analysis.bin2d?.weight) {
    for (const c of columnsOf(parseExpr(analysis.bin2d.weight))) out.add(c);
  }
  if (analysis.layer) {
    for (const b of analysis.layer.bindings) out.add(b.attribute);
    if (analysis.layer.pathId) out.add(analysis.layer.pathId);
    if (analysis.layer.ringId) out.add(analysis.layer.ringId);
    for (const c of analysis.layer.orderBy) out.add(c);
  }
  // Row ID column must survive all transformations
  if (analysis.rowIdColumn) {
    out.add(analysis.rowIdColumn);
  }
  return out;
}

// ---------------------------------------------------------------------------

/**
 * Kahn's algorithm over the render node's ancestry.
 *
 * Nodes not upstream of the render output are dropped — dead-code elimination, and the
 * reason an unused branch costs nothing. Ties are broken by the graph's declaration order
 * so the resulting plan is deterministic; a different tie-break would produce a different
 * (equally legal) stage boundary and make the EXPLAIN output unstable between runs.
 */
function topoSort(
  nodes: CoreNode[],
  byId: Map<string, CoreNode>,
  render: { id: string },
  notes: string[],
): CoreNode[] {
  const declarationIndex = new Map(nodes.map((n, i) => [n.id, i]));

  const inputsOf = (n: CoreNode): string[] => {
    const explicit = 'inputs' in n && Array.isArray(n.inputs) ? n.inputs : undefined;
    if (explicit) return explicit;
    return 'input' in n && typeof n.input === 'string' ? [n.input] : [];
  };

  // Reachable set: the render node plus everything it transitively depends on, plus any
  // stats node whose own input is reachable (stats branch off the main path).
  const reachable = new Set<string>();
  const visit = (id: string, path: Set<string>) => {
    if (reachable.has(id)) return;
    if (path.has(id)) throw new PlanError(`Cycle in graph through node ${id}`);
    const node = byId.get(id);
    if (!node) throw new PlanError(`Unknown node id '${id}'`);
    path.add(id);
    for (const dep of inputsOf(node)) visit(dep, path);
    path.delete(id);
    reachable.add(id);
  };
  visit(render.id, new Set());

  for (const n of nodes) {
    if (n.type === 'stats' && reachable.has(n.input)) visit(n.id, new Set());
  }

  const dropped = nodes.filter((n) => !reachable.has(n.id));
  if (dropped.length) {
    notes.push(`dead-code elimination: ${dropped.length} node(s) not upstream of the output were dropped (${dropped.map((n) => n.id).join(', ')})`);
  }

  const live = nodes.filter((n) => reachable.has(n.id));
  const indegree = new Map<string, number>();
  const consumers = new Map<string, string[]>();
  for (const n of live) {
    const deps = inputsOf(n).filter((d) => reachable.has(d));
    indegree.set(n.id, deps.length);
    for (const d of deps) consumers.set(d, [...(consumers.get(d) ?? []), n.id]);
  }

  const ready = live.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const out: CoreNode[] = [];
  while (ready.length) {
    // Stable order: earliest declaration first.
    ready.sort((a, b) => (declarationIndex.get(a) ?? 0) - (declarationIndex.get(b) ?? 0));
    const id = ready.shift()!;
    out.push(byId.get(id)!);
    for (const c of consumers.get(id) ?? []) {
      const left = (indegree.get(c) ?? 0) - 1;
      indegree.set(c, left);
      if (left === 0) ready.push(c);
    }
  }

  if (out.length !== live.length) throw new PlanError('Cycle in graph: topological sort did not consume every node');
  return pushDownFilters(out, notes);
}

/**
 * Predicate pushdown: move each filter ahead of the attribute nodes it does not read.
 *
 * Attribute nodes are per-row and pure, so a filter commutes with every one whose output it
 * does not read. Moving it earlier is what lets a SQL-only filter (a string comparison, say)
 * run in SQL after a chain of CPU-only attributes: stages run SQL, then CPU, then GPU, so in
 * declaration order the filter would follow work SQL cannot do and no plan would be legal.
 * It only moves past attributes; a source, aggregate, bin or another filter stops it, so
 * nothing that reshapes or reorders rows is crossed.
 */
function pushDownFilters(nodes: CoreNode[], notes: string[]): CoreNode[] {
  const out = [...nodes];
  for (let i = 0; i < out.length; i++) {
    const f = out[i];
    if (f.type !== 'filter') continue;
    let reads: Set<string>;
    try {
      reads = new Set(columnsOf(parseExpr(f.predicate)));
    } catch {
      continue; // User functions resolve later; leave the filter where it was declared.
    }
    let j = i;
    while (j > 0) {
      const prev = out[j - 1];
      if (prev.type !== 'attribute' || reads.has(prev.name)) break;
      j--;
    }
    if (j < i) {
      out.splice(i, 1);
      out.splice(j, 0, f);
      notes.push(`predicate pushdown: ${f.id} moved ahead of ${i - j} attribute node(s)`);
    }
  }
  return out;
}

/** Functions whose arguments are not numbers: they read strings or lists as they are. */
const TEXT_ARGUMENTS = new Set(['as_text', 'category', 'coalesce', 'hex_byte', 'item', 'to_number']);

/**
 * A string column used as a number (`sqrt(exits)`, `pop * 2`) read as one, as JS would: JSON
 * and CSV readers often type a numeric field as text, and Noodles' accessors never noticed.
 * A string compared, passed to a text function, or used bare, stays text.
 */
function coerceStrings(e: Expr, strings: ReadonlySet<string>, numeric = false): Expr {
  const go = (n: Expr, asNumber: boolean): Expr => {
    switch (n.kind) {
      case 'col':
        return asNumber && strings.has(n.name) ? { kind: 'call', fn: 'to_number', args: [n] } : n;
      case 'unary':
        return { ...n, operand: go(n.operand, n.op === '-') };
      case 'binary': {
        // A comparison may be between strings (`country == {{region}}`); only arithmetic is
        // certainly numeric.
        const arithmetic = ['+', '-', '*', '/', '%'].includes(n.op);
        return { ...n, left: go(n.left, arithmetic), right: go(n.right, arithmetic) };
      }
      case 'call': {
        const argTypes = FUNCTIONS[n.fn]?.argTypes;
        if (argTypes) {
          // A UDF: a text column goes as text, anything else as a number
          return {
            ...n,
            args: n.args.map((a, i) => {
              const type = argTypes[i];
              if (type === 'text') return a;
              if (type === 'number') return go(a, true);
              return a.kind === 'col' && strings.has(a.name)
                ? { kind: 'call', fn: 'as_text', args: [a] }
                : { kind: 'call', fn: 'as_double', args: [go(a, true)] };
            }),
          };
        }
        const text = TEXT_ARGUMENTS.has(n.fn);
        return { ...n, args: n.args.map((a, i) => go(a, !text || (n.fn === 'hex_byte' && i === 1))) };
      }
      case 'vec':
        return { ...n, components: n.components.map((c) => go(c, true)) };
      case 'swizzle':
        return { ...n, target: go(n.target, true) };
      case 'cond':
        return { ...n, test: go(n.test, false), then: go(n.then, asNumber), else: go(n.else, asNumber) };
      default:
        return n;
    }
  };
  return go(e, numeric);
}

/** True when the expression's value is a string: a literal, a string column, or a branch of them. */
function isStringValued(e: Expr, strings: ReadonlySet<string>): boolean {
  switch (e.kind) {
    case 'str': return true;
    case 'col': return strings.has(e.name);
    case 'cond': return isStringValued(e.then, strings) || isStringValued(e.else, strings);
    default: return false;
  }
}

function paramsOfExpr(e: Expr): string[] {
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
