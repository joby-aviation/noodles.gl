/**
 * Programs: graphs with many sources, relational nodes and many layer outputs.
 *
 * `plan()` compiles one pipeline — one source, a DAG of row-wise nodes, one output — into a
 * SQL / CPU / GPU split. A program is what a node editor produces: several files, joins
 * between them, forks where one relation feeds three layers. `compileProgram` does not
 * replace `plan()`; it cuts a program into pieces `plan()` can take.
 *
 *   RELATIONS  every relational node (source, join, union, sort, limit, sql, generate,
 *              unnest), plus any row-wise node a relational node reads — a filter ahead of a
 *              join has to be SQL, because the join reads a relation. Each lowers to one
 *              SELECT (`relational.ts`) and is the unit of memoization.
 *   LAYERS     every layer node, with the row-wise nodes between it and its nearest relation.
 *              That tail becomes a sub-graph `{source: relation, …tail, layer}` and goes to
 *              `plan()` unchanged, so every layer still gets its own cost-based SQL/CPU/GPU
 *              placement — and its own ramp and aggregate, lifting `plan()`'s one-per-graph
 *              limits to one per layer.
 *
 * Memoization is by structural hash. A relation's hash covers its node's fields with ids
 * removed, its inputs' hashes, and the value of every parameter it inlines; its table is
 * `__m_<hash>`. So an unchanged relation is never recomputed, moving a slider back to a value
 * already seen is a table that still exists, and renaming a node recomputes nothing. A layer's
 * plan is keyed by its sub-graph's structure and its relation's hash, excluding value
 * parameters, which is what lets a slider rebind instead of replan.
 *
 * Compilation is async because a relation's columns are not knowable from the graph: a CSV's
 * header, a `sql` node's result. The host's `Catalog` describes each relation — and may
 * materialize it while doing so — in topological order, so an input is always described (and,
 * if it is a table, created) before anything reads it.
 */

import {
  type Graph, type GraphNode, type ParamSpec, type SourceNode, type LayerNode, type DeckNode,
  RELATIONAL_TYPES,
} from './types.js';
import { plan, type PhysicalPlan } from './planner.js';
import { PlanError, type ColumnType } from './analyze.js';
import type { Policy } from './optimizer.js';
import type { CostConstants } from './cost.js';
import type { TargetCaps } from './target.js';
import type { SourceStats } from './stats.js';
import type { AttributeConventions } from './conventions.js';
import { hashOf } from './hash.js';
import { sourceParams } from './hoist.js';
import { propParam, type LayerKind } from './layers.js';
import { quoteIdent } from './backends/sql.js';
import {
  type RelShape, type RelColumn,
  sourceSql, joinSql, unionSql, sortSql, limitSql, sqlNodeSql, generateSql, unnestSql, rowwiseSql,
} from './relational.js';

export type Route = 'rematerialize' | 'requery' | 'uniform' | 'cpu' | 'prop';

export interface RelationPlan {
  /** The program node this relation is. */
  id: string;
  kind: string;
  hash: string;
  /** Temp table name, when materialized. */
  table: string;
  /** The SELECT producing the rows, referring to input relations by `ref`. */
  sql: string;
  /** How consumers refer to it: the table, or the SELECT as a subquery. */
  ref: string;
  materialize: boolean;
  /** Relation ids this one reads. */
  inputs: string[];
  /** Parameters whose values were inlined. Changing one makes a new relation. */
  params: string[];
  /** Relation and layer ids that read this one. */
  consumers: string[];
  shape: RelShape;
  stats?: SourceStats;
  rows?: number;
}

export interface LayerPlan {
  id: string;
  kind: LayerKind;
  relation: string;
  /** Structure of the sub-graph plus the relation's hash. Value parameters excluded. */
  hash: string;
  graph: Graph;
  plan: PhysicalPlan;
  /** Program node ids planned as part of this layer's tail. */
  nodes: string[];
}

export interface NodeInfo {
  role: 'relation' | 'row' | 'layer' | 'deck' | 'dead';
  /** The relation a row-wise node or layer reads from; a relation's own id. */
  relation?: string;
  /** Layers whose plans include this node. */
  layers: string[];
  /** Columns available at this node's output, for column pickers. */
  columns: RelColumn[];
  /** Engine per layer that placed it, for row-wise nodes. */
  engines: Record<string, string>;
  error?: string;
}

export interface ParamRouteEntry {
  route: Route;
  /** The relation or layer the change reaches. */
  target: string;
}

export interface ProgramPlan {
  relations: RelationPlan[];
  layers: LayerPlan[];
  /** Layer ids in draw order, bottom first. */
  draw: string[];
  deck?: DeckNode;
  params: Record<string, ParamSpec>;
  /** Every parameter's routes. A parameter can reach several targets by different routes. */
  routes: Record<string, ParamRouteEntry[]>;
  nodes: Record<string, NodeInfo>;
  errors: { nodeId: string; message: string }[];
  notes: string[];
}

export interface CatalogEntry {
  columns: RelColumn[];
  stats?: SourceStats;
  rows?: number;
}

/**
 * The host's view of the database. `describe` receives relations in dependency order; a host
 * that materializes creates `rel.table` from `rel.sql` here, before describing it.
 */
export interface Catalog {
  describe(rel: RelationPlan): Promise<CatalogEntry>;
}

export interface CompileOptions {
  policy?: Policy;
  caps?: TargetCaps;
  costs?: CostConstants;
  conventions?: Partial<AttributeConventions>;
  /** Current parameter values; defaults to each spec's `value`. */
  values?: Record<string, number | string>;
  /** Layer plans from a previous compile, reused when their hash matches. */
  cache?: Map<string, LayerPlan>;
}

/** Inputs of any node, uniformly. */
export function inputsOf(node: GraphNode): string[] {
  switch (node.type) {
    case 'source':
    case 'generate':
      return [];
    case 'join':
      return [node.input, node.right];
    case 'union':
    case 'deck':
      return node.inputs?.length ? node.inputs : node.input ? [node.input] : [];
    case 'sql':
      return node.inputs?.length ? node.inputs : node.input ? [node.input] : [];
    default: {
      const n = node as { input?: string; inputs?: string[] };
      if (n.inputs?.length) return n.inputs;
      return typeof n.input === 'string' ? [n.input] : [];
    }
  }
}

/**
 * Structural fields of a node: everything but its id and wiring, which the hash covers
 * through the inputs' own hashes instead.
 */
function structural(node: GraphNode): Record<string, unknown> {
  const { id: _id, input: _input, inputs: _inputs, right: _right, ...rest } = node as unknown as Record<string, unknown>;
  void _id; void _input; void _inputs; void _right;
  return rest;
}

/** Columns a row-wise node adds, for editor column pickers. Best-effort; plan() is authoritative. */
function columnsAfter(node: GraphNode, before: RelColumn[]): RelColumn[] {
  const add = (name: string, type: ColumnType = 'num'): RelColumn[] =>
    [...before.filter((c) => c.name !== name), { name, type, duckType: type === 'str' ? 'VARCHAR' : 'FLOAT' }];
  switch (node.type) {
    case 'attribute':
    case 'scale':
      return add(node.name);
    case 'colorscale':
      return add(node.name ?? 'Cd');
    case 'project':
      return add('P');
    case 'raw':
      return node.writes.reduce((cols, w) => [...cols.filter((c) => c.name !== w.name), { name: w.name, type: 'num' as const, duckType: 'FLOAT' }], before);
    case 'wrangle': {
      let cols = before;
      for (const m of node.body.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) cols = [...cols.filter((c) => c.name !== m[1]), { name: m[1], type: 'num', duckType: 'FLOAT' }];
      return cols;
    }
    case 'aggregate':
      return [
        ...before.filter((c) => node.groupBy.includes(c.name)),
        ...node.aggs.map((a) => ({ name: a.name, type: 'num' as const, duckType: 'DOUBLE' })),
      ];
    default:
      return before;
  }
}

function shapeColumns(shape: RelShape): RelColumn[] {
  return [
    ...shape.columns,
    ...shape.vectors.map((v) => ({ name: v.name, type: 'num' as const, duckType: `FLOAT[${v.width}]` })),
  ];
}

export async function compileProgram(
  graph: Graph,
  catalog: Catalog,
  options: CompileOptions = {},
): Promise<ProgramPlan> {
  const notes: string[] = [];
  const errors: ProgramPlan['errors'] = [];
  const byId = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (byId.has(n.id)) throw new PlanError(`Duplicate node id '${n.id}'`);
    byId.set(n.id, n);
  }
  for (const n of graph.nodes) {
    for (const i of inputsOf(n)) {
      if (!byId.has(i)) throw new PlanError(`Node ${n.id} reads '${i}', which does not exist`);
    }
  }

  const params: Record<string, ParamSpec> = { ...(graph.params ?? {}) };
  const values: Record<string, number | string> = {};
  for (const [k, spec] of Object.entries(params)) values[k] = options.values?.[k] ?? spec.value;

  // --- outputs and liveness -----------------------------------------------
  const decks = graph.nodes.filter((n): n is DeckNode => n.type === 'deck');
  if (decks.length > 1) throw new PlanError(`A program has one deck output; found ${decks.length}`);
  const deck = decks[0];
  const layerIds = deck
    ? inputsOf(deck).filter((id) => {
      if (byId.get(id)?.type !== 'layer') throw new PlanError(`Deck ${deck.id}: input '${id}' is not a layer`);
      return true;
    })
    : graph.nodes.filter((n) => n.type === 'layer').map((n) => n.id);

  const live = new Set<string>();
  const visit = (id: string, path: Set<string>) => {
    if (path.has(id)) throw new PlanError(`Cycle in graph through node ${id}`);
    if (live.has(id)) return;
    path.add(id);
    for (const i of inputsOf(byId.get(id)!)) visit(i, path);
    path.delete(id);
    live.add(id);
  };
  for (const id of layerIds) visit(id, new Set());
  if (deck) live.add(deck.id);
  // Stats branch off the main path and are read by name, not by an edge.
  for (const n of graph.nodes) {
    if (n.type === 'stats' && live.has(n.input)) live.add(n.id);
  }

  const consumers = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (!live.has(n.id)) continue;
    for (const i of inputsOf(n)) consumers.set(i, [...(consumers.get(i) ?? []), n.id]);
  }

  // --- classification -------------------------------------------------------
  const isRelational = (n: GraphNode) => RELATIONAL_TYPES.has(n.type);
  const isRowwise = (n: GraphNode) => !isRelational(n) && n.type !== 'layer' && n.type !== 'deck' && n.type !== 'render';
  const relationIds = new Set<string>();
  for (const n of graph.nodes) {
    if (!live.has(n.id)) continue;
    if (isRelational(n)) relationIds.add(n.id);
    else if (isRowwise(n) && (consumers.get(n.id) ?? []).some((c) => isRelational(byId.get(c)!))) {
      relationIds.add(n.id);
    }
  }

  /** The relation a node reads its rows from. Every input of a row-wise node must agree. */
  const rootMemo = new Map<string, string>();
  const rootOf = (id: string): string => {
    const cached = rootMemo.get(id);
    if (cached) return cached;
    const node = byId.get(id)!;
    const ins = inputsOf(node);
    if (ins.length === 0) throw new PlanError(`Node ${id}: has no input`);
    const roots = [...new Set(ins.map((i) => (relationIds.has(i) ? i : rootOf(i))))];
    if (roots.length > 1) {
      throw new PlanError(
        `Node ${id} reads two different row sets (${roots.join(', ')}). Rows can only be combined by a join or union.`,
      );
    }
    rootMemo.set(id, roots[0]);
    return roots[0];
  };

  /** Row-wise ancestors of `id` that belong to `root`'s region, in declaration order. */
  const tailOf = (id: string, root: string): string[] => {
    const seen = new Set<string>();
    const walk = (n: string) => {
      if (n === root || seen.has(n) || relationIds.has(n)) return;
      seen.add(n);
      for (const i of inputsOf(byId.get(n)!)) walk(i);
    };
    for (const i of inputsOf(byId.get(id)!)) walk(i);
    // Stats nodes hanging off the tail are read by name from inside it.
    for (const n of graph.nodes) {
      if (n.type === 'stats' && live.has(n.id) && (seen.has(n.input) || n.input === root)) seen.add(n.id);
    }
    return graph.nodes.filter((n) => seen.has(n.id)).map((n) => n.id);
  };

  const nodes: Record<string, NodeInfo> = {};
  for (const n of graph.nodes) {
    nodes[n.id] = { role: live.has(n.id) ? 'row' : 'dead', layers: [], columns: [], engines: {} };
  }
  if (deck) nodes[deck.id].role = 'deck';

  // --- relations, in dependency order ------------------------------------
  const relations = new Map<string, RelationPlan>();
  const failed = new Set<string>();
  const orderedRelations = graph.nodes.filter((n) => relationIds.has(n.id));
  const topo: GraphNode[] = [];
  const placed = new Set<string>();
  const place = (n: GraphNode) => {
    if (placed.has(n.id)) return;
    placed.add(n.id);
    const deps = isRelational(n) ? inputsOf(n) : [rootOf(n.id)];
    for (const d of deps) place(byId.get(d)!);
    topo.push(n);
  };
  for (const n of orderedRelations) place(n);

  for (const node of topo) {
    const info = nodes[node.id];
    info.role = 'relation';
    info.relation = node.id;
    try {
      const inputIds = isRelational(node) ? inputsOf(node) : [rootOf(node.id)];
      const dead = inputIds.find((i) => failed.has(i));
      if (dead) throw new PlanError(`skipped: input '${dead}' failed`);
      const ins = inputIds.map((i) => relations.get(i)!);
      const refs = ins.map((r) => r.ref);
      const shapes = ins.map((r) => r.shape);
      let sql: string;
      let vectors = shapes[0]?.vectors ?? [];
      let used: string[] = [];
      let structure: unknown = structural(node);

      switch (node.type) {
        case 'source': sql = sourceSql(node as SourceNode); vectors = []; break;
        case 'join': ({ sql, vectors } = joinSql(node, refs[0], refs[1], shapes[0], shapes[1])); break;
        case 'union': ({ sql, vectors } = unionSql(node, refs, shapes)); break;
        case 'sort': sql = sortSql(node, refs[0], shapes[0]); break;
        case 'limit': sql = limitSql(node, refs[0]); break;
        case 'sql': ({ sql, params: used } = sqlNodeSql(node, refs, values)); vectors = []; break;
        case 'generate': ({ sql, params: used } = generateSql(node, values)); vectors = []; break;
        case 'unnest': ({ sql, vectors } = unnestSql(node, refs[0], shapes[0])); break;
        default: {
          // A row-wise node a relational node reads: its tail, lowered to SQL.
          const chainIds = [...tailOf(node.id, inputIds[0]), node.id].filter((id) => byId.get(id)!.type !== 'stats');
          const chain = chainIds.map((id) => byId.get(id)!);
          ({ sql, vectors, params: used } = rowwiseSql(chain, refs[0], shapes[0], values, graph, `relation '${node.id}'`));
          // Ids inside the chain are wiring; map them to positions so a rename is free.
          const index = new Map(chainIds.map((id, i) => [id, `#${i}`]));
          structure = chain.map((n) => ({
            ...structural(n),
            inputs: inputsOf(n).map((i) => index.get(i) ?? '#in'),
          }));
          for (const id of chainIds) {
            if (id !== node.id) { nodes[id].relation = node.id; nodes[id].role = 'row'; }
          }
        }
      }

      const hash = hashOf({
        structure,
        inputs: ins.map((r) => r.hash),
        values: Object.fromEntries(used.sort().map((p) => [p, values[p]])),
      });
      const cons = consumers.get(node.id) ?? [];
      // Materialize what is expensive to recompute or read more than once. A cheap relation
      // read once is inlined, so it costs no memory and DuckDB can push predicates through it.
      const materialize =
        node.type === 'source' || node.type === 'join' || node.type === 'unnest' ||
        node.type === 'sql' || node.type === 'generate' || node.type === 'union' || cons.length >= 2;
      const table = `__m_${hash}`;
      const rel: RelationPlan = {
        id: node.id, kind: node.type, hash, table, sql,
        ref: materialize ? quoteIdent(table) : `(${sql})`,
        materialize, inputs: inputIds, params: used, consumers: cons,
        shape: { columns: [], vectors },
      };
      const described = await catalog.describe(rel);
      // Component columns of a vector are real columns; the vector itself is listed apart.
      rel.shape = { columns: described.columns, vectors };
      rel.stats = described.stats;
      rel.rows = described.rows ?? described.stats?.rows;
      relations.set(node.id, rel);
      info.columns = shapeColumns(rel.shape);
    } catch (err) {
      failed.add(node.id);
      const message = (err as Error).message;
      info.error = message;
      errors.push({ nodeId: node.id, message });
    }
  }

  // --- layers ---------------------------------------------------------------
  const layers: LayerPlan[] = [];
  for (const layerId of layerIds) {
    const layer = byId.get(layerId) as LayerNode;
    const info = nodes[layerId];
    info.role = 'layer';
    let tail: string[] = [];
    try {
      const root = rootOf(layerId);
      info.relation = root;
      const rel = relations.get(root);
      if (!rel) throw new PlanError(`skipped: relation '${root}' failed`);
      tail = tailOf(layerId, root);

      // Re-pack vectors a relation stored as components, but only those something reads:
      // an unused one would be selected and uploaded for nothing.
      const tailText = JSON.stringify([...tail.map((id) => byId.get(id)), layer]);
      const repack = rel.shape.vectors.filter((v) => new RegExp(`\\b${v.name}\\b`).test(tailText));
      const sourceId = root;
      const subNodes: GraphNode[] = [
        { id: sourceId, type: 'source', dataset: { ref: rel.table, estimatedRows: rel.rows } },
      ];
      let head = sourceId;
      for (const v of repack) {
        const id = `${root}#${v.name}`;
        const comps = Array.from({ length: v.width }, (_, i) => `${v.name}_${i}`);
        subNodes.push({ id, type: 'attribute', input: head, name: v.name, expr: `[${comps.join(', ')}]` });
        head = id;
      }
      const redirect = (id: string) => (id === root ? head : id);
      for (const id of [...tail, layerId]) {
        const copy = structuredClone(byId.get(id)!) as GraphNode & { input?: string; inputs?: string[] };
        if (typeof copy.input === 'string') copy.input = redirect(copy.input);
        if (copy.inputs) copy.inputs = copy.inputs.map(redirect);
        subNodes.push(copy);
      }
      const sub: Graph = { params, functions: graph.functions, nodes: subNodes, output: layerId };

      const schema = new Map<string, number>();
      const columnTypes = new Map<string, ColumnType>();
      for (const c of rel.shape.columns) {
        columnTypes.set(c.name, c.type);
        if (c.type === 'num') schema.set(c.name, 1);
      }
      const policy: Policy = options.policy ?? (rel.stats ? 'cost' : 'auto');
      const hash = hashOf({
        nodes: subNodes.map((n) => ({ ...structural(n), id: n.id, inputs: inputsOf(n) })),
        functions: graph.functions,
        specs: Object.fromEntries(Object.entries(params).map(([k, s]) => [k, { kind: s.kind, changeRate: s.changeRate }])),
        rel: rel.hash, policy, caps: options.caps?.id,
      });
      let lp = options.cache?.get(hash);
      if (!lp) {
        const numeric: Record<string, number> = {};
        for (const [k, v] of Object.entries(values)) if (typeof v === 'number') numeric[k] = v;
        const physical = plan(sub, schema, {
          policy, caps: options.caps, costs: options.costs, stats: rel.stats, params: numeric,
          relation: rel.ref, conventions: options.conventions, columnTypes,
        });
        lp = { id: layerId, kind: layer.kind, relation: root, hash, graph: sub, plan: physical, nodes: tail };
        options.cache?.set(hash, lp);
      }
      layers.push(lp);
      rel.consumers = [...new Set([...rel.consumers, layerId])];

      for (const a of lp.plan.assignments) {
        // Wrangle statements are planned as `wr#name`; report them on the wrangle.
        const owner = a.nodeId.split('#')[0];
        const n = nodes[owner];
        if (!n || owner === root || owner === layerId) continue;
        n.engines[layerId] = n.engines[layerId] && n.engines[layerId] !== a.engine ? 'mixed' : a.engine;
      }
    } catch (err) {
      const message = (err as Error).message;
      info.error = message;
      errors.push({ nodeId: layerId, message });
    }
    for (const id of tail) {
      if (nodes[id].role !== 'relation') {
        nodes[id].role = 'row';
        nodes[id].layers.push(layerId);
        nodes[id].relation ??= info.relation;
      }
    }
    info.layers.push(layerId);
  }

  // Columns at every row-wise node, walking from its relation.
  const columnsMemo = new Map<string, RelColumn[]>();
  const columnsAt = (id: string): RelColumn[] => {
    const cached = columnsMemo.get(id);
    if (cached) return cached;
    const rel = relations.get(id);
    let out: RelColumn[];
    if (rel) out = shapeColumns(rel.shape);
    else {
      const node = byId.get(id)!;
      const ins = inputsOf(node);
      out = columnsAfter(node, ins.length ? columnsAt(ins[0]) : []);
    }
    columnsMemo.set(id, out);
    return out;
  };
  for (const n of graph.nodes) {
    if (!live.has(n.id) || relationIds.has(n.id)) continue;
    try { nodes[n.id].columns = columnsAt(n.id); } catch { /* a failed input already reported */ }
  }

  // --- parameter routes -----------------------------------------------------
  const routes: Record<string, ParamRouteEntry[]> = {};
  const addRoute = (p: string, route: Route, target: string) => {
    const list = (routes[p] ??= []);
    if (!list.some((r) => r.route === route && r.target === target)) list.push({ route, target });
  };
  for (const rel of relations.values()) for (const p of rel.params) addRoute(p, 'rematerialize', rel.id);
  for (const lp of layers) {
    const pp = lp.plan;
    // A hoisted parameter is routed under what it is computed from: moving `lat0` is what
    // recomputes it, and `routes` is keyed by what a user can move.
    const sources = (names: Iterable<string>) => sourceParams(pp, names);
    for (const p of sources(pp.sqlParams)) addRoute(p, 'requery', lp.id);
    for (const s of pp.stats) for (const p of s.params) addRoute(p, 'requery', lp.id);
    for (const p of sources(pp.uniformParams)) addRoute(p, 'uniform', lp.id);
    for (const s of pp.cpuStage) {
      for (const p of s.expr ? sources(paramsOfTree(s.expr)) : []) addRoute(p, 'cpu', lp.id);
    }
    for (const p of pp.layer?.propParams ?? []) addRoute(p, 'prop', lp.id);
  }
  for (const v of Object.values(deck?.view ?? {})) {
    const p = propParam(v);
    if (p) addRoute(p, 'prop', deck!.id);
  }

  const dead = graph.nodes.filter((n) => !live.has(n.id));
  if (dead.length) notes.push(`not connected to an output: ${dead.map((n) => n.id).join(', ')}`);

  return {
    relations: topo.map((n) => relations.get(n.id)).filter((r): r is RelationPlan => !!r),
    layers,
    draw: layers.map((l) => l.id),
    deck,
    params,
    routes,
    nodes,
    errors,
    notes,
  };
}

function paramsOfTree(e: import('./expr.js').Expr): string[] {
  const out = new Set<string>();
  const go = (n: import('./expr.js').Expr): void => {
    switch (n.kind) {
      case 'param': out.add(n.name); break;
      case 'unary': go(n.operand); break;
      case 'binary': go(n.left); go(n.right); break;
      case 'call': n.args.forEach(go); break;
      case 'vec': n.components.forEach(go); break;
      case 'swizzle': go(n.target); break;
      case 'cond': go(n.test); go(n.then); go(n.else); break;
      default: break;
    }
  };
  go(e);
  return [...out];
}

/** Resolve deck view fields (`{{param}}` references) against current values. */
export function resolveView(
  view: Record<string, number | string> | undefined,
  values: Record<string, number | string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(view ?? {})) {
    const p = propParam(v);
    out[k] = Number(p !== undefined ? values[p] : v);
  }
  return out;
}

