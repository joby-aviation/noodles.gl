/**
 * The JSON graph schema.
 *
 * Deliberately thin. `scale`, `colorscale` and `project` are sugar: they desugar into
 * `attribute` nodes whose expressions go through the same IR as everything else. That
 * keeps exactly one thing to compile, and it is the answer to noodles' open question
 * about MapRangeOp / ColorRampOp — they do not need to be operators, they need to be
 * expression templates.
 */

import { registerUdfs, type UdfSpec } from './udfs.js';
import type { Expr } from './expr.js';
import { parseWrangle, expandWrangle } from './wrangle.js';
import { type AttributeConventions, HOUDINI_CONVENTIONS } from './conventions.js';
import type { LayerKind, LayerPropValue } from './layers.js';
import {
  type FunctionDef, type FunctionRegistry, type FunctionSpec,
  addFunction, buildRegistry,
} from './functions.js';
import { GEO_PRELUDE } from './geo.js';

/**
 * A color ramp's name: one of the built-in ramps, or one registered with `registerRamp`.
 */
export type RampName = string;

export interface ParamSpec {
  /**
   * A string value is only ever a SQL bind — `code == {{airport}}` — so a string parameter
   * routes as `requery` or not at all; the optimizer never places its reader off SQL.
   */
  value: number | string;
  /**
   * `value` params rebind cheaply (uniform write / prepared-statement rebind).
   * `structural` params change the shape of the plan and force a recompile.
   */
  kind?: 'value' | 'structural';
  /**
   * Expected changes per second, the planner's amortization input.
   *
   * This is what lets placement respond to interaction rather than only to data size: a
   * parameter dragged on a slider is worth keeping on the GPU, where rebinding is a
   * 16-byte uniform write, even if putting its node in SQL would build marginally faster.
   * Defaults to 2/s for `value` params and 0 for `structural` ones (a structural change
   * recompiles the plan, so amortizing it here would double count).
   */
  changeRate?: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export interface SourceNode {
  id: string;
  type: 'source';
  /** Either a synthetic generator or a URL DuckDB can read (parquet/csv). */
  /**
   * Which registered source provides the rows.
   *
   * `ref` names an entry in the host's `SourceRegistry`; everything else is passed through
   * to that provider untouched. Keeping the payload opaque is what stops a particular
   * dataset (the demo's synthetic generator, say) from becoming part of the graph schema.
   *
   * `estimatedRows` is an optional hint used only when no catalog statistics exist yet, so
   * the very first plan has a finite cost to compare against.
   */
  dataset: { ref: string; estimatedRows?: number; [key: string]: unknown };
  /** A file the program runtime reads directly. Takes the place of a registered provider. */
  file?: FileSource;
  /**
   * Preserve source row identity through filtering and compaction.
   * - `true`: use DuckDB ROWID (0-based row position of a table, int64 cast to INTEGER)
   * - `string`: use named numeric column as key
   * Generates `__rowid` attribute (or the named column) with `type: 'raw'`.
   */
  preserveRowId?: boolean | string;
}

/** Row filter. Pushed into the SQL WHERE clause whenever the predicate is SQL-expressible. */
export interface FilterNode {
  id: string;
  type: 'filter';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  predicate: string;
}

/** GROUP BY + aggregates. Always SQL: aggregates collapse rows. */
export interface AggregateNode {
  id: string;
  type: 'aggregate';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  groupBy: string[];
  aggs: { name: string; expr: string }[];
}

/**
 * Scalar reduction whose results become bindable parameters, e.g. a scale domain.
 * `stats` is what lets a scale say "domain: auto" without a CPU pass over the column.
 */
export interface StatsNode {
  id: string;
  type: 'stats';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  column: string;
  ops: StatOp[];
}

export type StatOp = 'min' | 'max' | 'mean' | 'median' | 'p01' | 'p99' | 'stddev';

/** The wrangle. Creates or overwrites a named point attribute. */
export interface AttributeNode {
  id: string;
  type: 'attribute';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  name: string;
  /**
   * The expression. A string in authored JSON; desugaring may instead pass an
   * already-parsed tree, which avoids round-tripping through an unparser whose precedence
   * handling would be one more thing to get wrong.
   */
  expr: string | Expr;
  /** Set by wrangle expansion: the source text, for display. */
  source?: string;
}

/** Sugar -> attribute. Numeric remap with an optional auto domain from a stats node. */
export interface ScaleNode {
  id: string;
  type: 'scale';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  name: string;
  expr: string;
  kind?: 'linear' | 'log' | 'sqrt';
  /** Two expressions, or `'auto'` to read the domain from `statsFrom`. */
  domain?: [string, string] | 'auto';
  statsFrom?: string;
  range: [string, string];
  clamp?: boolean;
}

/** Sugar -> attribute. Numeric remap into a ramp lookup. */
export interface ColorScaleNode {
  id: string;
  type: 'colorscale';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  /** Defaults to `Cd`. */
  name?: string;
  expr: string;
  ramp: RampName;
  domain?: [string, string] | 'auto';
  statsFrom?: string;
}

/** Sugar -> attribute. Produces a vec3 `P`. */
export interface ProjectNode {
  id: string;
  type: 'project';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  mode: 'mercator' | 'identity';
  x: string;
  y: string;
  z?: string;
  /** World-unit scale applied after projection, so the orbit camera sees sane numbers. */
  worldScale?: string;
}

/** GPU binning into a 2D grid, consumed by the heatmap raster pass. */
export interface Bin2dNode {
  id: string;
  type: 'bin2d';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  resolution: number;
  /** Expression contributing to each bin; defaults to 1 (a plain count). */
  weight?: string;
  ramp: RampName;
  /** Bin value mapped through the ramp between 0 and this. `'auto'` uses the max bin. */
  ceiling?: string | 'auto';
}

export interface RenderNode {
  id: string;
  type: 'render';
  input: string;
  /**
   * Multi-input form. When present it replaces `input`, so a node can read attributes
   * produced along several upstream paths. Inputs merge namespaces over a shared row set;
   * relational joins are out of scope.
   */
  inputs?: string[];
  mode: 'points' | 'heatmap';
  /** Points mode: attribute names bound to visual channels. */
  position?: string;
  color?: string;
  size?: string;
  opacity?: string;
  background?: [number, number, number];
}

/**
 * A deck.gl layer output: `render` generalized to a layer kind with its own channels.
 *
 * `channels` maps a channel of the kind (see `LAYER_SPECS`) to the attribute that feeds it.
 * A channel left out falls back to the convention attribute where the spec names one, so a
 * scatter over a graph that wrote `P` and `Cd` needs no channels at all.
 */
export interface LayerNode {
  id: string;
  type: 'layer';
  kind: LayerKind;
  input: string;
  inputs?: string[];
  channels?: Record<string, string>;
  /** deck layer props, applied as uniforms. `{{name}}` reads a parameter. */
  props?: Record<string, LayerPropValue>;
  /** Vertex layers: the column grouping rows into paths. Read raw, never cast. */
  pathId?: string;
  /**
   * Polygon layers: the column splitting a polygon's vertices into rings. Rows sort by it after
   * `pathId`; the first ring is the outer boundary and the rest are holes. Read raw. Without
   * it every polygon is a single ring.
   */
  ringId?: string;
  /** Row order of the output. Vertex layers need it; others may use it for draw order. */
  orderBy?: string[];
}

// ---------------------------------------------------------------------------
// Relational nodes
// ---------------------------------------------------------------------------
//
// Everything above is row-wise: a node sees one row set and adds or removes attributes. The
// nodes below change the row set itself — combine two, reshape one, or bring one into being —
// and so they are SQL-only by construction. `compileProgram` lowers each to a relation, which
// is also the unit of memoization: a relation's hash covers its structure, its inputs' hashes
// and the values of any parameter it reads.

/** A relation read from a file DuckDB can open, or from SQL the host supplies. */
export interface FileSource {
  /** `csv`, `json` and `parquet` map to DuckDB's `read_*` functions. */
  /**
   * `spatial` reads any vector format DuckDB spatial's `ST_Read` does (GeoJSON, shapefile,
   * GeoPackage…): one row per feature, its properties as columns and its geometry as `geom`.
   */
  format: 'csv' | 'json' | 'parquet' | 'spatial';
  url: string;
  /**
   * Named options for the reader, rendered as DuckDB named parameters: a headerless CSV needs
   * `{ header: false, names: [...] }`. Values are literals, never parameters — a reader's
   * options decide what the relation *is*, so changing one is structural.
   */
  options?: Record<string, string | number | boolean | string[]>;
}

/** Relational join. `on` pairs a left column with a right one; `cross` takes no keys. */
export interface JoinNode {
  id: string;
  type: 'join';
  /** Left input. */
  input: string;
  right: string;
  how?: 'inner' | 'left' | 'cross';
  on?: [string, string][];
  /**
   * Prepended to every right-side column. Joining one table twice — routes to their origin
   * and their destination airport — needs two different prefixes, and a name both sides
   * share is an error rather than a silent shadow.
   */
  prefix?: string;
}

/** Rows of every input, matched by column name (`UNION ALL BY NAME`). */
export interface UnionNode {
  id: string;
  type: 'union';
  inputs: string[];
  /** Drop duplicate rows. Off by default, because deduplication is a full sort. */
  distinct?: boolean;
  input?: string;
}

/**
 * Row order plus an optional limit. Order is only guaranteed within this relation's own
 * statement — a later join or filter may reorder — so it exists to make `limit` mean "top N".
 * A layer that needs drawing order says so with its own `orderBy`.
 */
export interface SortNode {
  id: string;
  type: 'sort';
  input: string;
  /** Column names, each optionally followed by ` desc`. */
  by: string[];
  limit?: number;
}

export interface LimitNode {
  id: string;
  type: 'limit';
  input: string;
  count: number;
  offset?: number;
}

/**
 * Literal DuckDB SQL: the relational escape hatch, like Noodles' DuckDbOp. `{{input}}` (or
 * `{{input0}}`, `{{input1}}`…) names an input relation; any other `{{name}}` is a parameter,
 * inlined as a literal. Its output schema is whatever DuckDB says it is.
 */
export interface SqlNode {
  id: string;
  type: 'sql';
  inputs?: string[];
  input?: string;
  query: string;
}

/** `count` rows with one column, `name`, holding 0..count-1. The seed of an interpolation. */
export interface GenerateNode {
  id: string;
  type: 'generate';
  count: number | string;
  /** Defaults to `i`. */
  name?: string;
}

/**
 * List columns to rows. Every list in `lists` is unnested in lockstep, so a trip's `path` and
 * `timestamps` stay paired. `split` names the components of a list-of-lists element
 * (`path: ['lng', 'lat']`); `id` numbers the original rows and `index` the position within
 * each, which together are exactly what a path layer groups and orders by.
 */
export interface UnnestNode {
  id: string;
  type: 'unnest';
  input: string;
  lists: string[];
  /** Output name per list. Defaults to the list's own name. */
  as?: Record<string, string>;
  split?: Record<string, string[]>;
  /** Name for the original row number. Defaults to `row`. */
  rowId?: string;
  /** Name for the 1-based position within the list. Defaults to `index`. */
  index?: string;
}

/**
 * The program's output: an ordered list of layers, bottom first, plus the view. View fields
 * accept `{{param}}` references, which is how a keyframed camera reaches deck.
 */
export interface DeckNode {
  id: string;
  type: 'deck';
  inputs: string[];
  input?: string;
  basemap?: string;
  view?: Record<string, number | string>;
}

/**
 * Geometry to vertex rows: what a layer draws from a relation with a GEOMETRY column (a
 * `spatial` source, say). Each row of the input is a feature; its geometry is split into
 * parts, and each part into rows a planner layer reads directly:
 *
 *   polygons  feature, id, ring, vertex, lng, lat, ...properties   (ring 0 is the outline)
 *   lines     feature, id, vertex, lng, lat, ...properties
 *   points    feature, id, lng, lat, ...properties
 *   all       the three, with `kind` ('polygon' | 'line' | 'point')
 *
 * The geometry itself stays in DuckDB; only coordinates leave it. A property whose name a
 * vertex column uses is renamed with a `p_` prefix.
 */
export interface VerticesNode {
  id: string;
  type: 'vertices';
  input: string;
  kind: 'polygons' | 'lines' | 'points' | 'all';
  /** The GEOMETRY column. Defaults to `geom`, what DuckDB spatial's ST_Read names it. */
  geometry?: string;
}

export type RelationalNode =
  | JoinNode | UnionNode | SortNode | LimitNode | SqlNode | GenerateNode | UnnestNode | VerticesNode;

export const RELATIONAL_TYPES: ReadonlySet<string> = new Set([
  'source', 'join', 'union', 'sort', 'limit', 'sql', 'generate', 'unnest', 'vertices',
]);

/**
 * Sugar -> N attribute nodes. A VEX-style multi-statement body, which is what makes the
 * pipeline programmable rather than a closed catalogue of operator types. See
 * `src/graph/wrangle.ts` for the grammar.
 */
export interface WrangleNode {
  id: string;
  type: 'wrangle';
  input: string;
  inputs?: string[];
  /** Statements separated by `;`. `@name = expr` writes an attribute, `var name = expr` a local. */
  body: string;
  /** Ramp used by any `ramp()` call in the body. Defaults to viridis. */
  ramp?: RampName;
}

/**
 * The escape hatch: literal SQL or WGSL the planner does not understand.
 *
 * Everything else in this schema compiles from one expression IR, which is what lets the
 * optimizer move it between engines. A `raw` node gives that up deliberately, for the cases
 * the IR genuinely cannot reach — a window function, a texture sample, an atomic, a vendor
 * intrinsic. In exchange it must declare what the planner can no longer infer:
 *
 *   - `engine` — the only stage it can run on. Its feasible set is this and nothing else,
 *     so it pins the stage boundary rather than being placed.
 *   - `reads` / `writes` — its dependency set and its outputs. The planner *trusts* these.
 *     Reading an attribute you did not declare gives you a stale or unbound buffer; writing
 *     one you did not declare loses the value. This is the real cost of the escape hatch,
 *     and it is why a `wrangle` should be preferred whenever the expression fits.
 *   - `params` — parameters the code references, so they are still bound and still routed.
 *   - `opCost` — a scalar-operation estimate, since `opCount` cannot walk opaque text. The
 *     optimizer needs *some* number to price the node; a wrong one misprices this node only.
 *
 * What it does not give up: fusion. A `raw` node on the GPU is spliced into the same kernel
 * as its neighbours, because fusion depends on the stage assignment, not on legibility.
 */
export interface RawNode {
  id: string;
  type: 'raw';
  input: string;
  inputs?: string[];
  /** The only engine this node can run on. */
  engine: 'sql' | 'gpu';
  /**
   * `sql`: one expression per declared write, keyed by name.
   * `gpu`: WGSL statements. Read an attribute as `name`, assign a write as `name = ...`;
   * both are rewritten to the kernel's local register names.
   */
  code: string | Record<string, string>;
  /** Attributes produced, with their component counts. */
  writes: { name: string; width: number }[];
  /** Attributes read. Declared, because the code cannot be parsed to find out. */
  reads?: string[];
  /** Parameters referenced, so they are still bound and routed. */
  params?: string[];
  /** Scalar-operation estimate per row, for costing. Defaults to 8. */
  opCost?: number;
  /** Shown in the inspector instead of the code, when set. */
  label?: string;
}

export type GraphNode =
  | SourceNode | FilterNode | AggregateNode | StatsNode | AttributeNode | RawNode
  | ScaleNode | ColorScaleNode | ProjectNode | WrangleNode | Bin2dNode | RenderNode | LayerNode
  | RelationalNode | DeckNode;

export interface Graph {
  name?: string;
  params?: Record<string, ParamSpec>;
  /**
   * User-defined functions, callable from any expression in the graph. Inlined at analysis
   * time, so they cost the planner and the backends nothing. See `functions.ts`.
   */
  functions?: Record<string, FunctionSpec>;
  /** JS functions DuckDB runs as scalar UDFs, callable from any expression. See `udfs.ts`. */
  udfs?: Record<string, UdfSpec>;
  nodes: GraphNode[];
  /** Node id of the render or layer node to evaluate. Defaults to the last render node. */
  output?: string;
}

// ---------------------------------------------------------------------------
// Desugaring
// ---------------------------------------------------------------------------

/** Nodes that survive into the planner. */
export type CoreNode =
  | SourceNode | FilterNode | AggregateNode | StatsNode | AttributeNode | RawNode
  | Bin2dNode | RenderNode | LayerNode;

export const RAMP_STOPS: Record<string, [number, number, number][]> = {
  // 8-stop approximations, linearly interpolated in the LUT builder. Close enough for
  // a prototype and far cheaper than shipping the full 256-entry tables.
  viridis: [
    [0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.53],
    [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551],
    [0.267, 0.749, 0.441], [0.993, 0.906, 0.144],
  ],
  magma: [
    [0.001, 0.000, 0.014], [0.116, 0.066, 0.232], [0.298, 0.079, 0.446],
    [0.478, 0.137, 0.505], [0.665, 0.199, 0.480], [0.851, 0.302, 0.392],
    [0.972, 0.556, 0.351], [0.987, 0.991, 0.750],
  ],
  turbo: [
    [0.190, 0.072, 0.232], [0.246, 0.552, 0.925], [0.113, 0.855, 0.792],
    [0.322, 0.980, 0.443], [0.708, 0.999, 0.180], [0.960, 0.799, 0.176],
    [0.973, 0.427, 0.106], [0.720, 0.087, 0.021],
  ],
  cividis: [
    [0.000, 0.135, 0.305], [0.000, 0.223, 0.410], [0.196, 0.310, 0.415],
    [0.336, 0.396, 0.427], [0.459, 0.484, 0.450], [0.593, 0.577, 0.437],
    [0.740, 0.678, 0.393], [0.995, 0.909, 0.218],
  ],
};

/** Stat op -> the aggregate expression that computes it. */
export function statExpr(op: StatOp, column: string): string {
  switch (op) {
    case 'min': return `minAgg(${column})`;
    case 'max': return `maxAgg(${column})`;
    case 'mean': return `avg(${column})`;
    case 'median': return `median(${column})`;
    case 'p01': return `quantile(${column}, 0.01)`;
    case 'p99': return `quantile(${column}, 0.99)`;
    case 'stddev': return `stddev(${column})`;
  }
}

/** The parameter name a stats node publishes for one of its ops. */
export function statParamName(nodeId: string, op: StatOp): string {
  return `${nodeId}_${op}`;
}

/**
 * Rewrite sugar nodes into core nodes. Every sugar node becomes one or more
 * `attribute` nodes, so the planner only ever sees expressions.
 */
export function desugar(
  graph: Graph,
  conv: AttributeConventions = HOUDINI_CONVENTIONS,
): { nodes: CoreNode[]; notes: string[]; ramp?: RampName; functions: FunctionRegistry } {
  // Graph-level declarations first, then any hoisted out of wrangle bodies. Both land in one
  // flat registry, so a redefinition is an error wherever it came from. The geo prelude is
  // the registry's starting point, which is what puts it in scope for every graph.
  const functions = buildRegistry(graph.functions, new Map(GEO_PRELUDE));
  registerUdfs(functions, graph.udfs);
  const out: CoreNode[] = [];
  const notes: string[] = [];
  // One LUT is bound per kernel, so this prototype supports one ramp per graph.
  // Two colorscales with different ramps is a real use case and a real limitation.
  const ramps = new Set<RampName>();
  /**
   * Sugar that expands into several nodes changes which id represents its output, so any
   * node downstream still pointing at the original has to be redirected. Recorded here and
   * applied in one pass at the end, because JSON node order is not guaranteed topological.
   */
  const idRewrites = new Map<string, string>();

  const domainRefs = (
    node: { domain?: [string, string] | 'auto'; statsFrom?: string; id: string },
  ): [string, string] => {
    if (node.domain && node.domain !== 'auto') return node.domain;
    if (!node.statsFrom) {
      throw new Error(`Node ${node.id}: domain 'auto' requires 'statsFrom' naming a stats node`);
    }
    return [
      `{{${statParamName(node.statsFrom, 'min')}}}`,
      `{{${statParamName(node.statsFrom, 'max')}}}`,
    ];
  };

  for (const node of graph.nodes) {
    switch (node.type) {
      case 'scale': {
        const [d0, d1] = domainRefs(node);
        const warp =
          node.kind === 'log' ? (s: string) => `ln(max(${s}, 1e-9))`
          : node.kind === 'sqrt' ? (s: string) => `sqrt(max(${s}, 0.0))`
          : (s: string) => s;
        const fit = `fit(${warp(`(${node.expr})`)}, ${warp(`(${d0})`)}, ${warp(`(${d1})`)}, ${node.range[0]}, ${node.range[1]})`;
        const expr = node.clamp === false
          ? fit
          : `clamp(${fit}, min(${node.range[0]}, ${node.range[1]}), max(${node.range[0]}, ${node.range[1]}))`;
        out.push({ id: node.id, type: 'attribute', input: node.input, name: node.name, expr });
        notes.push(`${node.id}: scale desugared to attribute '${node.name}'`);
        break;
      }

      case 'colorscale': {
        ramps.add(node.ramp);
        const [d0, d1] = domainRefs(node);
        const t = `clamp(fit((${node.expr}), (${d0}), (${d1}), 0.0, 1.0), 0.0, 1.0)`;
        out.push({
          id: node.id,
          type: 'attribute',
          input: node.input,
          name: node.name ?? conv.color,
          expr: `ramp(${t})`,
        });
        notes.push(`${node.id}: colorscale desugared to attribute '${node.name ?? conv.color}' via ramp()`);
        break;
      }

      case 'project': {
        const scale = node.worldScale ?? '1.0';
        const z = node.z ?? '0.0';
        const expr = node.mode === 'mercator'
          // Web Mercator, normalized to [-0.5, 0.5] on both axes so the orbit camera
          // starts with the whole world inside the near/far planes. The formulas are the geo
          // prelude's, which inline to exactly the tree this sugar used to spell out.
          ? `[(mercator_x(${node.x})) * (${scale}), (mercator_y(${node.y})) * (${scale}), ` +
            `(${z}) * (${scale})]`
          : `[(${node.x}) * (${scale}), (${node.y}) * (${scale}), (${z}) * (${scale})]`;
        out.push({ id: node.id, type: 'attribute', input: node.input, name: conv.position, expr });
        notes.push(`${node.id}: project(${node.mode}) desugared to attribute '${conv.position}'`);
        break;
      }

      case 'raw':
        // Already a core node; nothing to desugar. Listed explicitly so a new sugar type
        // cannot fall through to the default and be silently dropped.
        out.push(node);
        break;

      case 'wrangle': {
        // One statement becomes one attribute node, so the planner places each statement
        // independently and the existing kernel fusion merges them back into one dispatch.
        // The planner needs no knowledge of wrangles at all.
        const statements = parseWrangle(node.body, functions);
        for (const s of statements) {
          if (s.kind === 'function' && s.fn) {
            addFunction(functions as Map<string, FunctionDef>, s.fn);
            notes.push(`${node.id}: declared ${s.fn.name}(${s.fn.params.join(', ')}) on line ${s.line}`);
          }
        }
        const expanded = expandWrangle(node.id, statements);
        if (/\bramp\s*\(/.test(node.body)) ramps.add(node.ramp ?? 'viridis');
        let input = node.inputs?.[0] ?? node.input;
        for (const s of expanded) {
          out.push({
            id: `${node.id}#${s.name}`,
            type: 'attribute',
            input,
            // Only the first statement inherits the wrangle's multi-input list; the rest
            // chain off their predecessor so ordering within the body is preserved.
            inputs: input === (node.inputs?.[0] ?? node.input) ? node.inputs : undefined,
            name: s.name,
            expr: s.expr,
            source: `line ${s.line}`,
          });
          input = `${node.id}#${s.name}`;
        }
        // The wrangle's output is its final statement, so that is what its consumers
        // should read.
        idRewrites.set(node.id, `${node.id}#${expanded[expanded.length - 1].name}`);
        notes.push(
          `${node.id}: wrangle expanded to ${expanded.length} attribute node(s) (${expanded.map((s) => s.name).join(', ')})`,
        );
        break;
      }

      case 'join': case 'union': case 'sort': case 'limit': case 'sql': case 'generate': case 'vertices':
      case 'unnest': case 'deck':
        // These change the row set, which a single plan cannot: it has one source and one
        // statement. `compileProgram` splits a graph at them and plans each piece.
        throw new Error(
          `Node ${node.id}: '${node.type}' needs compileProgram; plan() takes one source and one output`,
        );

      default:
        if (node.type === 'bin2d') ramps.add(node.ramp);
        out.push(node);
        break;
    }
  }

  if (ramps.size > 1) {
    throw new Error(
      `Graph uses ${ramps.size} different ramps (${[...ramps].join(', ')}); this prototype binds one LUT per graph`,
    );
  }

  // Redirect references to any node whose id changed during expansion. Nodes created by
  // the expansion already point at each other, so only pre-existing ids are rewritten.
  if (idRewrites.size > 0) {
    const created = new Set(out.map((n) => n.id));
    for (const node of out) {
      if (!('input' in node)) continue;
      const redirect = (id: string) => (created.has(id) ? id : idRewrites.get(id) ?? id);
      if (node.inputs) node.inputs = node.inputs.map(redirect);
      node.input = redirect(node.input);
    }
  }

  return { nodes: out, notes, ramp: [...ramps][0], functions };
}

/** Build a 256-entry RGB LUT from a ramp's stops. */
export function buildRampLut(ramp: RampName, size = 256): Float32Array {
  const stops = RAMP_STOPS[ramp];
  if (!stops) throw new Error(`Unknown color ramp '${ramp}'`);
  const lut = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const t = (i / (size - 1)) * (stops.length - 1);
    const lo = Math.min(Math.floor(t), stops.length - 2);
    const f = t - lo;
    const a = stops[lo];
    const b = stops[lo + 1];
    lut[i * 4 + 0] = a[0] + (b[0] - a[0]) * f;
    lut[i * 4 + 1] = a[1] + (b[1] - a[1]) * f;
    lut[i * 4 + 2] = a[2] + (b[2] - a[2]) * f;
    lut[i * 4 + 3] = 1;
  }
  return lut;
}
