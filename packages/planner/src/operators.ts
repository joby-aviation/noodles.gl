/**
 * The operator library: what an editor offers, and how each operator becomes graph nodes.
 *
 * An operator is the thing a person places — "Filter", "Arc Layer" — with typed ports and a
 * parameter schema. The schema is what an editor builds a parameter pane from (widgets,
 * folders, ranges, which input a column menu lists); `lower` is how the operator becomes IR.
 * Operators are deliberately *not* IR node types: several lower to more than one node (a grid
 * is two attributes and an aggregate), and a layer's channel expressions become a wrangle in
 * front of it. The IR stays small and the library can grow without the planner noticing.
 *
 * How a parameter reaches the plan is the one decision that matters for interactivity, and it
 * is declared here, per parameter:
 *
 *   value       a number that lowers to a `{{placeholder}}` with a ParamSpec. Dragging it
 *               rebinds — a uniform write, a prepared-statement rebind, a CPU re-evaluation,
 *               or a rematerialize if a relation reads it — and never replans.
 *   prop        a number that lowers to a deck layer prop reference. Changing it costs no
 *               query and no evaluation at all; deck applies it as a uniform.
 *   structural  substituted into the graph as text. A change recompiles, and memoization
 *               makes that cost only what actually changed.
 */

import type { GraphNode, LayerNode, DeckNode } from './types.js';
import type { LayerKind, LayerPropValue } from './layers.js';
import type { ParamValue } from './doc.js';
import { RAMP_STOPS, type RampName } from './types.js';
import { parseGeometry } from './geometry.js';
import { GIS_OPERATORS } from './gis.js';

/**
 * `value` is anything a host application passes between its own operators (a view, an
 * extension, a loaded mesh). The planner never reads one; it only checks where it may flow.
 */
export type PortType = 'table' | 'layer' | 'number' | 'value';

export interface PortSpec {
  name: string;
  type: PortType;
  label?: string;
  /** Takes several edges, in order: a deck's layers, a union's inputs. */
  multi?: boolean;
  optional?: boolean;
}

export type ParamKind =
  | 'float' | 'int' | 'toggle' | 'menu' | 'string' | 'text' | 'expr' | 'code' | 'column' | 'color' | 'url'
  /** Edited by a widget the host application supplies; see `ParamDef.field`. */
  | 'field';

export interface ParamDef {
  name: string;
  label: string;
  kind: ParamKind;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** Parameter-pane folder, as in Houdini's tabbed parameter interface. */
  folder?: string;
  help?: string;
  /** Column pickers: the input port whose columns are listed. */
  of?: string;
  columnType?: 'num' | 'str' | 'any';
  language?: 'sql' | 'vex' | 'expr' | 'geometry' | 'js';
  bind?: 'value' | 'prop' | 'structural';
  /** Expected changes per second while being dragged; the optimizer's amortization input. */
  changeRate?: number;
  /** Offer a `par:<name>` handle so a number output can drive it. */
  port?: boolean;
  /** What a `par:` handle accepts. Defaults to `number`. */
  portType?: PortType;
  /** For `kind: 'field'`: the host's description of its widget. Opaque to the planner. */
  field?: unknown;
  /** Show only when another parameter has one of these values. */
  when?: { param: string; is: (string | number | boolean)[] };
}

export type Category =
  | 'data' | 'table' | 'geometry' | 'rows' | 'color' | 'layer' | 'output' | 'number' | 'structure'
  /** Host operators: run by the application, never lowered. */
  | 'host';

export interface LowerCtx {
  id: string;
  /** IR id of the node connected to an input port. Throws when a required port is empty. */
  input(port: string): string;
  maybeInput(port: string): string | undefined;
  inputs(port: string): string[];
  /** Structural reads. An expression or reference in a structural parameter is an error. */
  str(param: string): string;
  num(param: string): number;
  bool(param: string): boolean;
  /** `{{key}}` for a value or prop parameter. */
  bind(param: string): string;
  /** Three `{{key}}` references, 0–255, for a color. */
  bindColor(param: string): string[];
  /** Expression text with `ch()` references rewritten to placeholders. */
  expr(param: string): string;
  error(message: string): never;
}

export interface ScalarParams {
  num(param: string): number;
  str(param: string): string;
}

export interface LowerResult {
  nodes: GraphNode[];
  /** Output port -> IR node id producing it. */
  outputs: Record<string, string>;
}

export interface OpDef {
  type: string;
  label: string;
  category: Category;
  description: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  params: ParamDef[];
  lower?: (ctx: LowerCtx) => LowerResult;
  /** Scalar operators compute a number from their parameters and the clock. */
  scalar?: (p: ScalarParams, clock: { T: number; F: number }) => number;
  /**
   * Number outputs that are statistics of the rows: computed in the layer's SQL, not by the
   * scalar program. A parameter wired from one binds the statistic, so it lives in the same
   * plan as the rows it summarizes.
   */
  stats?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RAMPS: { value: RampName; label: string }[] = [
  { value: 'viridis', label: 'Viridis' }, { value: 'magma', label: 'Magma' },
  { value: 'turbo', label: 'Turbo' }, { value: 'cividis', label: 'Cividis' },
];

/**
 * Add a color ramp, or replace one, so `ramp()`, colorscale nodes and every ramp menu can use
 * it. Stops are 0–1 RGB, evenly spaced and linearly interpolated, as the built-ins are.
 */
export function registerRamp(name: string, stops: [number, number, number][], label = name): void {
  if (stops.length < 2) throw new Error(`Ramp '${name}' needs at least two stops`);
  RAMP_STOPS[name] = stops;
  const existing = RAMPS.find((r) => r.value === name);
  if (existing) existing.label = label;
  else RAMPS.push({ value: name, label });
}

const table = (name = 'in', label?: string, extra: Partial<PortSpec> = {}): PortSpec => ({ name, type: 'table', label, ...extra });
const out = (type: PortType = 'table', name = 'out'): PortSpec => ({ name, type });

/** An identifier safe as an attribute name, derived from a node id. */
export const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

const BARE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const opacity: ParamDef = { name: 'opacity', label: 'Opacity', kind: 'float', default: 1, min: 0, max: 1, step: 0.01, bind: 'prop', folder: 'Style', port: true };
/** luma.gl blend presets, as Noodles' Blending operator names them. */
const blendParam: ParamDef = {
  name: 'blend', label: 'Blending', kind: 'menu', default: 'normal', folder: 'Style',
  options: [{ value: 'normal', label: 'Normal' }, { value: 'additive', label: 'Additive' }, { value: 'subtractive', label: 'Subtractive' }],
};
const rampParam: ParamDef = { name: 'ramp', label: 'Color ramp', kind: 'menu', default: 'viridis', options: RAMPS, folder: 'Channels', help: 'Used by ramp() in any channel expression.' };

interface ChannelParam { channel: string; param: string }

/** Lower Manhattan, as a default any lng/lat data near New York lands partly inside. */
const DEFAULT_REGION = 'POLYGON((-74.02 40.70, -73.97 40.71, -73.97 40.76, -74.01 40.76, -74.02 40.70))';
const geometryParam: ParamDef = {
  name: 'geometry', label: 'Geometry', kind: 'code', language: 'geometry', default: DEFAULT_REGION,
  help: 'WKT or GeoJSON, lng/lat degrees. Expanded into the expression, so a change replans.',
};

/**
 * The geometry parameter as an expression string literal, checked here so a bad ring or a
 * swapped axis is an error on the node rather than from the planner. Structural: the
 * literal's vertices become constants in the tree (docs/geometry.md, case 1a).
 */
function geometryLiteral(ctx: LowerCtx, dims: number[], what: string): string {
  const text = ctx.str('geometry');
  let g;
  try { g = parseGeometry(text); } catch (err) { ctx.error((err as Error).message); }
  if (!dims.includes(g.dim)) ctx.error(`${what} needs ${dims.includes(2) ? 'a polygon' : 'a geometry'}, got a ${g.type}`);
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * A layer: channel expressions, then the layer node. A channel that names an attribute binds
 * it directly; anything else — `sqrt(mag) * 2`, `ramp(fit(depth, 0, 700, 0, 1))` — becomes one
 * statement of a wrangle in front of the layer, so the planner places it like any attribute.
 */
function lowerLayer(
  ctx: LowerCtx,
  kind: LayerKind,
  channels: ChannelParam[],
  props: Record<string, LayerPropValue>,
  extra: Partial<LayerNode> = {},
): LowerResult {
  const base = ctx.input('in');
  const bound: Record<string, string> = {};
  const lines: string[] = [];
  for (const { channel, param } of channels) {
    const text = ctx.expr(param).trim();
    if (!text) continue;
    if (BARE.test(text)) { bound[channel] = text; continue; }
    const name = `${safeId(ctx.id)}_${channel}`;
    lines.push(`@${name} = ${text};`);
    bound[channel] = name;
  }
  const nodes: GraphNode[] = [];
  let input = base;
  if (lines.length) {
    const wid = `${ctx.id}__ch`;
    nodes.push({ id: wid, type: 'wrangle', input: base, body: lines.join('\n'), ramp: ctx.str('ramp') as RampName });
    input = wid;
  }
  nodes.push({ id: ctx.id, type: 'layer', kind, input, channels: bound, props: { ...props, blend: ctx.str('blend') }, ...extra });
  return { nodes, outputs: { out: ctx.id } };
}

/** A color range for aggregation layers, from a ramp. Empty keeps deck's own default. */
const colorRangeParam: ParamDef = {
  name: 'colorRange', label: 'Color range', kind: 'menu', default: '', folder: 'Style',
  options: [{ value: '', label: 'Default (yellow to red)' }, ...RAMPS],
  help: 'Six colors sampled from a ramp.',
};

/** A 3D model per row, placed by channels. The model URL is structural: deck loads it once. */
function modelLayer(kind: 'mesh' | 'scenegraph', label: string, urlParam: string, urlLabel: string, urlDefault: string): OpDef {
  return {
    type: kind, label, category: 'layer',
    description: 'A 3D model per row, positioned, oriented (pitch, yaw, roll in degrees), scaled and colored by channels.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P'),
      channel('color', 'Color', ''),
      channel('orientation', 'Orientation', '', '[pitch, yaw, roll] in degrees.'),
      channel('scale', 'Scale', '', '[x, y, z] multipliers.'),
      channel('translation', 'Translation', '', '[x, y, z] offset in meters.'),
      { name: urlParam, label: urlLabel, kind: 'url', default: urlDefault, folder: 'Model' },
      { name: 'sizeScale', label: 'Size scale', kind: 'float', default: 1, min: 0, max: 10000, step: 1, bind: 'prop', folder: 'Style', port: true },
      ...(kind === 'scenegraph'
        ? [
          { name: 'sizeMinPixels', label: 'Min size (px)', kind: 'float', default: 0, min: 0, max: 100, step: 1, bind: 'prop', folder: 'Style' } as ParamDef,
          { name: 'sizeMaxPixels', label: 'Max size (px)', kind: 'float', default: 100, min: 0, max: 10000, step: 1, bind: 'prop', folder: 'Style' } as ParamDef,
        ]
        : [{ name: 'wireframe', label: 'Wireframe', kind: 'toggle', default: false, folder: 'Style' } as ParamDef]),
      { name: 'modelColor', label: 'Color', kind: 'color', default: [255, 255, 255], folder: 'Style' },
      rampParam,
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, kind,
      ['position', 'color', 'orientation', 'scale', 'translation'].map((c) => ({ channel: c, param: c })),
      {
        model: ctx.str(urlParam), sizeScale: ctx.bind('sizeScale'), color: ctx.bindColor('modelColor'),
        ...(kind === 'scenegraph'
          ? { sizeMinPixels: ctx.bind('sizeMinPixels'), sizeMaxPixels: ctx.bind('sizeMaxPixels') }
          : { wireframe: ctx.bool('wireframe') }),
        opacity: ctx.bind('opacity'),
      }),
  };
}

/** Hexagon and grid bins: the same layer but for the shape of a bin. */
function binLayer(
  type: string, kind: 'hexagon' | 'grid', label: string, size: string, sizeLabel: string, sizeDefault: number,
): OpDef {
  const aggregation = (name: string, folder: string): ParamDef => ({
    name, label: 'Aggregation', kind: 'menu', default: 'SUM', folder,
    options: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() })),
  });
  return {
    type, label, category: 'layer',
    description: `Rows binned into ${kind === 'hexagon' ? 'hexagons' : 'square cells'}, colored and raised by per-row weights deck sums per bin.`,
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P'),
      channel('colorWeight', 'Color weight', '', 'Per-row weight for color. Empty counts rows.'),
      channel('elevationWeight', 'Elevation weight', '', 'Per-row weight for height. Empty counts rows.'),
      { name: size, label: sizeLabel, kind: 'float', default: sizeDefault, min: 1, max: 100000, step: 10, bind: 'prop', folder: 'Style', port: true },
      { ...aggregation('colorAggregation', 'Color') },
      { name: 'upperPercentile', label: 'Upper percentile', kind: 'float', default: 100, min: 0, max: 100, step: 1, bind: 'prop', folder: 'Color' },
      { name: 'lowerPercentile', label: 'Lower percentile', kind: 'float', default: 0, min: 0, max: 100, step: 1, bind: 'prop', folder: 'Color' },
      colorRangeParam,
      { name: 'extruded', label: 'Extruded', kind: 'toggle', default: kind === 'grid', folder: 'Elevation' },
      { ...aggregation('elevationAggregation', 'Elevation') },
      { name: 'elevationScale', label: 'Elevation scale', kind: 'float', default: 1, min: 0, max: 1000, step: 0.5, bind: 'prop', folder: 'Elevation', port: true },
      rampParam,
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, kind,
      [
        { channel: 'position', param: 'position' }, { channel: 'colorWeight', param: 'colorWeight' },
        { channel: 'elevationWeight', param: 'elevationWeight' },
      ],
      {
        [size]: ctx.bind(size), colorAggregation: ctx.str('colorAggregation'), upperPercentile: ctx.bind('upperPercentile'),
        lowerPercentile: ctx.bind('lowerPercentile'), colorRange: ctx.str('colorRange'), extruded: ctx.bool('extruded'),
        elevationAggregation: ctx.str('elevationAggregation'), elevationScale: ctx.bind('elevationScale'),
        opacity: ctx.bind('opacity'),
      }),
  };
}

const channel = (name: string, label: string, def: string, help?: string): ParamDef =>
  ({ name, label, kind: 'expr', default: def, folder: 'Channels', of: 'in', help });

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export const OPERATORS: OpDef[] = [
  // --- data -----------------------------------------------------------------
  {
    type: 'file', label: 'File', category: 'data',
    description: 'Read a CSV, JSON or Parquet file by URL. The relation is memoized: it is fetched once.',
    inputs: [], outputs: [out()],
    params: [
      { name: 'url', label: 'URL', kind: 'url', default: '' },
      { name: 'format', label: 'Format', kind: 'menu', default: 'csv', options: [
        { value: 'csv', label: 'CSV' }, { value: 'json', label: 'JSON' }, { value: 'parquet', label: 'Parquet' },
      ] },
      { name: 'header', label: 'Header row', kind: 'toggle', default: true, when: { param: 'format', is: ['csv'] }, folder: 'CSV' },
      { name: 'names', label: 'Column names', kind: 'string', default: '', when: { param: 'format', is: ['csv'] }, folder: 'CSV', help: 'Comma-separated, for a file without a header row.' },
      { name: 'nullstr', label: 'Null marker', kind: 'string', default: '', when: { param: 'format', is: ['csv'] }, folder: 'CSV', help: 'Text that means "no value", such as \\N.' },
    ],
    lower(ctx) {
      const url = ctx.str('url');
      if (!url) ctx.error('File needs a URL');
      const format = ctx.str('format') as 'csv' | 'json' | 'parquet';
      const options: Record<string, string | number | boolean | string[]> = {};
      if (format === 'csv') {
        options.header = ctx.bool('header');
        const names = ctx.str('names').split(',').map((s) => s.trim()).filter(Boolean);
        if (names.length) options.names = names;
        const nullstr = ctx.str('nullstr');
        if (nullstr) options.nullstr = nullstr;
      }
      return {
        nodes: [{ id: ctx.id, type: 'source', dataset: { ref: url }, file: { format, url, options } }],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'geojson', label: 'GeoJSON', category: 'data',
    description: 'A GeoJSON file, or any vector file DuckDB spatial reads (shapefile, GeoPackage…), as rows: `features` has one row per feature with its geometry; polygons, lines and points have one row per vertex, ready for a layer; `all` has every vertex row with a `kind` column. Wire a table with a `geom` column into `in` to read its geometry instead of a file.',
    inputs: [table('in', 'features', { optional: true })],
    outputs: [
      { name: 'all', type: 'table' }, { name: 'polygons', type: 'table' },
      { name: 'lines', type: 'table' }, { name: 'points', type: 'table' }, { name: 'features', type: 'table' },
    ],
    params: [{ name: 'url', label: 'URL', kind: 'url', default: '' }],
    lower(ctx) {
      const wired = ctx.maybeInput('in');
      const url = ctx.str('url');
      if (!wired && !url) ctx.error('GeoJSON needs a URL or a table of features');
      const features = wired ?? `${ctx.id}#features`;
      const kinds = ['all', 'polygons', 'lines', 'points'] as const;
      return {
        nodes: [
          ...(wired ? [] : [{ id: features, type: 'source' as const, dataset: { ref: url }, file: { format: 'spatial' as const, url } }]),
          ...kinds.map((kind) => ({ id: `${ctx.id}#${kind}`, type: 'vertices' as const, input: features, kind })),
        ],
        outputs: { features, ...Object.fromEntries(kinds.map((kind) => [kind, `${ctx.id}#${kind}`])) },
      };
    },
  },
  {
    type: 'sql', label: 'DuckDB SQL', category: 'data',
    description: 'Any SELECT. {{input0}}…{{input2}} name the connected tables; other {{name}} are parameters.',
    inputs: [table('in0', 'input0', { optional: true }), table('in1', 'input1', { optional: true }), table('in2', 'input2', { optional: true })],
    outputs: [out()],
    params: [{ name: 'query', label: 'Query', kind: 'code', language: 'sql', default: 'SELECT * FROM {{input0}}' }],
    lower(ctx) {
      const inputs = ['in0', 'in1', 'in2'].map((p) => ctx.maybeInput(p));
      const firstGap = inputs.findIndex((i) => i === undefined);
      if (firstGap >= 0 && inputs.slice(firstGap).some((i) => i !== undefined)) ctx.error('Connect inputs in order: input0, then input1');
      return {
        nodes: [{ id: ctx.id, type: 'sql', inputs: inputs.filter((i): i is string => !!i), query: ctx.expr('query') }],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'generate', label: 'Generate', category: 'data',
    description: 'N rows numbered 0…N−1. Cross-join it to give every row N steps.',
    inputs: [], outputs: [out()],
    params: [
      { name: 'count', label: 'Count', kind: 'int', default: 16, min: 1, max: 1000, step: 1, changeRate: 0.5 },
      { name: 'name', label: 'Column', kind: 'string', default: 'i' },
    ],
    lower: (ctx) => ({
      nodes: [{ id: ctx.id, type: 'generate', count: ctx.bind('count'), name: ctx.str('name') || 'i' }],
      outputs: { out: ctx.id },
    }),
  },

  // --- table ----------------------------------------------------------------
  {
    type: 'join', label: 'Join', category: 'table',
    description: 'Match rows of two tables on key columns. Right-hand columns get the prefix.',
    inputs: [table('left', 'left'), table('right', 'right')], outputs: [out()],
    params: [
      { name: 'how', label: 'Kind', kind: 'menu', default: 'inner', options: [
        { value: 'inner', label: 'Inner' }, { value: 'left', label: 'Left' }, { value: 'cross', label: 'Cross (every pair)' },
      ] },
      { name: 'leftKey', label: 'Left key', kind: 'column', default: '', of: 'left', when: { param: 'how', is: ['inner', 'left'] } },
      { name: 'rightKey', label: 'Right key', kind: 'column', default: '', of: 'right', when: { param: 'how', is: ['inner', 'left'] } },
      { name: 'leftKey2', label: 'Left key 2', kind: 'column', default: '', of: 'left', when: { param: 'how', is: ['inner', 'left'] }, folder: 'More keys' },
      { name: 'rightKey2', label: 'Right key 2', kind: 'column', default: '', of: 'right', when: { param: 'how', is: ['inner', 'left'] }, folder: 'More keys' },
      { name: 'prefix', label: 'Right prefix', kind: 'string', default: 'r_' },
    ],
    lower(ctx) {
      const how = ctx.str('how') as 'inner' | 'left' | 'cross';
      const on: [string, string][] = [];
      if (how !== 'cross') {
        if (!ctx.str('leftKey') || !ctx.str('rightKey')) ctx.error('Join needs a left and a right key');
        on.push([ctx.str('leftKey'), ctx.str('rightKey')]);
        if (ctx.str('leftKey2') && ctx.str('rightKey2')) on.push([ctx.str('leftKey2'), ctx.str('rightKey2')]);
      }
      return {
        nodes: [{ id: ctx.id, type: 'join', input: ctx.input('left'), right: ctx.input('right'), how, on, prefix: ctx.str('prefix') }],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'union', label: 'Union', category: 'table',
    description: 'All rows of every input, columns matched by name.',
    inputs: [table('in', 'inputs', { multi: true })], outputs: [out()],
    params: [{ name: 'distinct', label: 'Drop duplicates', kind: 'toggle', default: false }],
    lower: (ctx) => ({
      nodes: [{ id: ctx.id, type: 'union', inputs: ctx.inputs('in'), distinct: ctx.bool('distinct') }],
      outputs: { out: ctx.id },
    }),
  },
  {
    type: 'sort', label: 'Sort', category: 'table',
    description: 'Order rows by a column; with a limit, keep the top N.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'by', label: 'Column', kind: 'column', default: '', of: 'in' },
      { name: 'descending', label: 'Descending', kind: 'toggle', default: false },
      { name: 'limit', label: 'Limit (0 = all)', kind: 'int', default: 0, min: 0, max: 100000, step: 1, bind: 'structural' },
    ],
    lower(ctx) {
      const by = ctx.str('by');
      if (!by) ctx.error('Sort needs a column');
      const limit = ctx.num('limit');
      return {
        nodes: [{ id: ctx.id, type: 'sort', input: ctx.input('in'), by: [`${by}${ctx.bool('descending') ? ' desc' : ''}`], limit: limit > 0 ? limit : undefined }],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'limit', label: 'Limit', category: 'table',
    description: 'The first N rows.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'count', label: 'Count', kind: 'int', default: 1000, min: 0, max: 1_000_000, step: 1, bind: 'structural' },
      { name: 'offset', label: 'Offset', kind: 'int', default: 0, min: 0, max: 1_000_000, step: 1, bind: 'structural' },
    ],
    lower: (ctx) => ({
      nodes: [{ id: ctx.id, type: 'limit', input: ctx.input('in'), count: ctx.num('count'), offset: ctx.num('offset') }],
      outputs: { out: ctx.id },
    }),
  },
  {
    type: 'unnest', label: 'Unnest', category: 'table',
    description: 'List columns to rows, in lockstep. Numbers each source row and each position, which is what a path layer groups and orders by.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'lists', label: 'List columns', kind: 'string', default: 'path, timestamps', help: 'Comma-separated; unnested together.' },
      { name: 'split', label: 'Split', kind: 'string', default: 'path: lng lat', help: 'list: a b … names the components of a list of lists.' },
      { name: 'rename', label: 'Rename', kind: 'string', default: 'timestamps: t', help: 'list: name, comma-separated.' },
      { name: 'rowId', label: 'Row id column', kind: 'string', default: 'row', folder: 'Numbering' },
      { name: 'index', label: 'Position column', kind: 'string', default: 'index', folder: 'Numbering' },
    ],
    lower(ctx) {
      const lists = ctx.str('lists').split(',').map((s) => s.trim()).filter(Boolean);
      const pairs = (text: string) => Object.fromEntries(text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const [k, v = ''] = s.split(':').map((x) => x.trim());
        return [k, v];
      }));
      const split = Object.fromEntries(Object.entries(pairs(ctx.str('split'))).map(([k, v]) => [k, v.split(/\s+/).filter(Boolean)]));
      return {
        nodes: [{
          id: ctx.id, type: 'unnest', input: ctx.input('in'), lists, split, as: pairs(ctx.str('rename')),
          rowId: ctx.str('rowId') || 'row', index: ctx.str('index') || 'index',
        }],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'time-series', label: 'Time Series', category: 'table',
    description: "Each path's place at one time: vertex rows interpolated between the two vertices around it, holding the first and last vertex outside the path's span. The time is a query parameter: moving it re-runs only the sampling query, never the segment table.",
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'pathId', label: 'Path id', kind: 'column', default: 'row', of: 'in', folder: 'Channels' },
      { name: 'order', label: 'Vertex order', kind: 'column', default: 'index', of: 'in', folder: 'Channels' },
      { name: 'timestamp', label: 'Timestamp', kind: 'column', default: 't', of: 'in', columnType: 'num', folder: 'Channels' },
      { name: 'values', label: 'Interpolate', kind: 'string', default: 'lng, lat', help: 'Comma-separated numeric columns.' },
      { name: 'time', label: 'Time', kind: 'float', default: 0, min: 0, max: 86400, step: 1, port: true },
    ],
    lower(ctx) {
      const q = (c: string) => `"${c.replace(/"/g, '""')}"`;
      const path = q(ctx.str('pathId') || 'row');
      const t = q(ctx.str('timestamp') || 't');
      const values = ctx.str('values').split(',').map((v) => v.trim()).filter(Boolean);
      if (values.length === 0) ctx.error('Time Series needs a column to interpolate');
      const w = `(PARTITION BY ${path} ORDER BY ${q(ctx.str('order') || 'index')})`;
      const next = values.map((v, i) => `coalesce(lead(${q(v)}) OVER ${w}, ${q(v)}) AS __v${i}`);
      // Each vertex starts a segment that ends at the next one. The first also covers all time
      // before it and the last all time after, so a path is always somewhere.
      const segments = [
        `SELECT *, CASE WHEN row_number() OVER ${w} = 1 THEN -1e300 ELSE ${t} END AS __lo,`,
        `  coalesce(lead(${t}) OVER ${w}, 1e300) AS __hi,`,
        `  coalesce(lead(${t}) OVER ${w}, ${t}) AS __t1,`,
        `  ${next.join(', ')}`,
        'FROM {{input0}}',
      ].join('\n');
      // Timestamps are often epoch seconds, past float32's integers, so the fraction along a
      // segment is computed here in doubles rather than on the CPU or GPU.
      const time = ctx.bind('time');
      const hidden = ['__lo', '__hi', '__t1', '__u', ...values.map((_, i) => `__v${i}`)];
      const lerped = values.map((v, i) => `${q(v)} + (__v${i} - ${q(v)}) * __u AS ${q(v)}`);
      const sample = [
        `SELECT * EXCLUDE (${hidden.join(', ')}) REPLACE (${lerped.join(', ')})`,
        `FROM (SELECT *, CASE WHEN __t1 > ${t} THEN greatest(0.0, least(1.0, (${time} - ${t}) / (__t1 - ${t}))) ELSE 0.0 END AS __u`,
        `  FROM {{input0}} WHERE __lo <= ${time} AND ${time} < __hi)`,
      ].join('\n');
      return {
        nodes: [
          { id: `${ctx.id}#segments`, type: 'sql', inputs: [ctx.input('in')], query: segments },
          { id: ctx.id, type: 'sql', inputs: [`${ctx.id}#segments`], query: sample },
        ],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'code', label: 'Code', category: 'data',
    description: "Rows made by JavaScript: `d` is the input's rows as objects (an empty array with nothing wired), or a JSON file parsed whole when a URL is set, and the body returns an array of rows or GeoJSON. d3, turf and utils are in scope. It runs when its input changes, in the engine, and its rows become a DuckDB table every later node plans over; for per-row values use a JS Function instead.",
    inputs: [table('in', 'input', { optional: true })], outputs: [out()],
    params: [
      { name: 'code', label: 'Code', kind: 'code', language: 'js', default: 'return d' },
      { name: 'url', label: 'JSON file', kind: 'url', default: '', help: 'Read instead of an input: d is the parsed file.' },
    ],
    lower: (ctx) => {
      const input = ctx.maybeInput('in');
      const url = ctx.str('url');
      return {
        nodes: [{ id: ctx.id, type: 'js', ...(input ? { input } : {}), ...(url && !input ? { url } : {}), code: ctx.str('code') }],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'js-function', label: 'JS Function', category: 'rows',
    description: "A JavaScript function any expression can call by name, run by DuckDB per row. For logic the expression language has no words for; it returns a number, or an array of `width` numbers. Prefer an expression where one will do: DuckDB runs JS some 20 times slower than SQL.",
    inputs: [], outputs: [],
    params: [
      { name: 'name', label: 'Name', kind: 'string', default: 'fn' },
      { name: 'params', label: 'Parameters', kind: 'string', default: 'x', help: 'Comma-separated; `name: text` for a text parameter.' },
      { name: 'width', label: 'Returns', kind: 'int', default: 1, min: 1, max: 4, step: 1, help: 'Numbers returned: 1, or the length of the array.' },
      { name: 'body', label: 'Body', kind: 'code', language: 'js', default: 'return x' },
    ],
    // Declares a function for the graph (see lowerDocument), and draws nothing itself.
    lower: () => ({ nodes: [], outputs: {} }),
  },
  {
    type: 'aggregate', label: 'Aggregate', category: 'table',
    description: 'GROUP BY with aggregates, one per line: name = count(), total = sum(pop).',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'groupBy', label: 'Group by', kind: 'string', default: '', help: 'Comma-separated columns.' },
      { name: 'aggs', label: 'Aggregates', kind: 'code', language: 'expr', default: 'n = count()' },
    ],
    lower(ctx) {
      const groupBy = ctx.str('groupBy').split(',').map((s) => s.trim()).filter(Boolean);
      const aggs = ctx.expr('aggs').split(/[;\n]/).map((s) => s.trim()).filter(Boolean).map((line) => {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
        if (!m) ctx.error(`Aggregate line '${line}' is not 'name = expression'`);
        return { name: m![1], expr: m![2] };
      });
      if (!groupBy.length) ctx.error('Aggregate needs at least one group-by column');
      return { nodes: [{ id: ctx.id, type: 'aggregate', input: ctx.input('in'), groupBy, aggs }], outputs: { out: ctx.id } };
    },
  },
  {
    type: 'grid', label: 'Grid Bin', category: 'table',
    description: 'Count rows per square cell and emit one row per cell at its centre (P), with n and the weight sum w.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'x', label: 'X', kind: 'expr', default: 'lng', of: 'in' },
      { name: 'y', label: 'Y', kind: 'expr', default: 'lat', of: 'in' },
      { name: 'cell', label: 'Cell size', kind: 'float', default: 0.01, min: 0.0005, max: 1, step: 0.0005, changeRate: 2 },
      { name: 'weight', label: 'Weight', kind: 'expr', default: '1.0', of: 'in' },
    ],
    lower(ctx) {
      const id = ctx.id;
      const cell = ctx.bind('cell');
      const x = ctx.expr('x');
      const y = ctx.expr('y');
      const w = ctx.expr('weight') || '1.0';
      return {
        nodes: [
          { id: `${id}__ix`, type: 'attribute', input: ctx.input('in'), name: 'ix', expr: `floor((${x}) / ${cell})` },
          { id: `${id}__iy`, type: 'attribute', input: `${id}__ix`, name: 'iy', expr: `floor((${y}) / ${cell})` },
          { id: `${id}__w`, type: 'attribute', input: `${id}__iy`, name: 'cellw', expr: w },
          { id: `${id}__agg`, type: 'aggregate', input: `${id}__w`, groupBy: ['ix', 'iy'], aggs: [{ name: 'n', expr: 'count()' }, { name: 'w', expr: 'sum(cellw)' }] },
          { id, type: 'attribute', input: `${id}__agg`, name: 'P', expr: `[(ix + 0.5) * ${cell}, (iy + 0.5) * ${cell}, 0.0]` },
        ],
        outputs: { out: id },
      };
    },
  },

  // --- rows -----------------------------------------------------------------
  {
    type: 'filter', label: 'Filter', category: 'rows',
    description: 'Keep rows matching a condition. The planner puts it in SQL when that removes real volume.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'mode', label: 'Mode', kind: 'menu', default: 'compare', options: [
        { value: 'compare', label: 'Compare a number' }, { value: 'match', label: 'Match text' }, { value: 'expression', label: 'Expression' },
      ] },
      { name: 'column', label: 'Column', kind: 'column', default: '', of: 'in', when: { param: 'mode', is: ['compare', 'match'] } },
      { name: 'op', label: 'Operator', kind: 'menu', default: '>', when: { param: 'mode', is: ['compare'] }, options: [
        { value: '>', label: '>' }, { value: '>=', label: '≥' }, { value: '<', label: '<' }, { value: '<=', label: '≤' }, { value: '==', label: '=' }, { value: '!=', label: '≠' },
      ] },
      { name: 'value', label: 'Value', kind: 'float', default: 0, min: -1000, max: 1000, step: 0.1, when: { param: 'mode', is: ['compare'] }, changeRate: 4, port: true },
      { name: 'text', label: 'Text', kind: 'text', default: '', when: { param: 'mode', is: ['match'] } },
      { name: 'negate', label: 'Invert', kind: 'toggle', default: false, when: { param: 'mode', is: ['match'] } },
      { name: 'expression', label: 'Expression', kind: 'expr', default: 'true', of: 'in', when: { param: 'mode', is: ['expression'] } },
    ],
    lower(ctx) {
      const mode = ctx.str('mode');
      let predicate: string;
      if (mode === 'expression') predicate = ctx.expr('expression');
      else {
        const col = ctx.str('column');
        if (!col) ctx.error('Filter needs a column');
        predicate = mode === 'match'
          ? `${col} ${ctx.bool('negate') ? '!=' : '=='} ${ctx.bind('text')}`
          : `${col} ${ctx.str('op')} ${ctx.bind('value')}`;
      }
      return { nodes: [{ id: ctx.id, type: 'filter', input: ctx.input('in'), predicate }], outputs: { out: ctx.id } };
    },
  },
  {
    type: 'range', label: 'Range Filter', category: 'rows',
    description: 'Keep rows whose column lies between two values.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'column', label: 'Column', kind: 'column', default: '', of: 'in', columnType: 'num' },
      { name: 'min', label: 'Min', kind: 'float', default: 0, min: -1000, max: 1000, step: 0.1, changeRate: 4, port: true },
      { name: 'max', label: 'Max', kind: 'float', default: 100, min: -1000, max: 1000, step: 0.1, changeRate: 4, port: true },
    ],
    lower(ctx) {
      const col = ctx.str('column');
      if (!col) ctx.error('Range Filter needs a column');
      return {
        nodes: [{ id: ctx.id, type: 'filter', input: ctx.input('in'), predicate: `${col} >= ${ctx.bind('min')} && ${col} <= ${ctx.bind('max')}` }],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'attribute', label: 'Attribute Create', category: 'rows',
    description: 'Create or overwrite one attribute from an expression.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'name', label: 'Name', kind: 'string', default: 'value' },
      { name: 'expression', label: 'Expression', kind: 'expr', default: '0.0', of: 'in' },
    ],
    lower(ctx) {
      const name = ctx.str('name');
      if (!BARE.test(name)) ctx.error(`'${name}' is not a valid attribute name`);
      return { nodes: [{ id: ctx.id, type: 'attribute', input: ctx.input('in'), name, expr: ctx.expr('expression') }], outputs: { out: ctx.id } };
    },
  },
  {
    type: 'wrangle', label: 'Attribute Wrangle', category: 'rows',
    description: 'A VEX-style body: @name = expr; var t = expr; fn f(x) = expr;. Each statement is placed on its own.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'code', label: 'VEXpression', kind: 'code', language: 'vex', default: '@value = 1.0;' },
      rampParam,
    ],
    lower: (ctx) => ({
      nodes: [{ id: ctx.id, type: 'wrangle', input: ctx.input('in'), body: ctx.expr('code'), ramp: ctx.str('ramp') as RampName }],
      outputs: { out: ctx.id },
    }),
  },
  {
    type: 'position', label: 'Point Position', category: 'rows',
    description: 'Build the position attribute P from longitude, latitude and altitude.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'lng', label: 'Longitude', kind: 'expr', default: 'lng', of: 'in' },
      { name: 'lat', label: 'Latitude', kind: 'expr', default: 'lat', of: 'in' },
      { name: 'alt', label: 'Altitude (m)', kind: 'expr', default: '0.0', of: 'in' },
      { name: 'name', label: 'Attribute', kind: 'string', default: 'P' },
    ],
    lower: (ctx) => ({
      nodes: [{
        id: ctx.id, type: 'attribute', input: ctx.input('in'), name: ctx.str('name') || 'P',
        expr: `[${ctx.expr('lng')}, ${ctx.expr('lat')}, ${ctx.expr('alt') || '0.0'}]`,
      }],
      outputs: { out: ctx.id },
    }),
  },
  {
    type: 'map-range', label: 'Map Range', category: 'rows',
    description: 'Rescale a value from one range to another, linearly, on a log scale or a square root.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'input', label: 'Input', kind: 'expr', default: 'value', of: 'in' },
      { name: 'name', label: 'Output', kind: 'string', default: 'pscale' },
      { name: 'kind', label: 'Scale', kind: 'menu', default: 'linear', options: [
        { value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' }, { value: 'sqrt', label: 'Square root' },
      ] },
      { name: 'inMin', label: 'In min', kind: 'float', default: 0, min: -1000, max: 1000, step: 0.1, folder: 'Ranges', port: true },
      { name: 'inMax', label: 'In max', kind: 'float', default: 1, min: -1000, max: 1000, step: 0.1, folder: 'Ranges', port: true },
      { name: 'outMin', label: 'Out min', kind: 'float', default: 0, min: -1000, max: 1000, step: 0.1, folder: 'Ranges', port: true },
      { name: 'outMax', label: 'Out max', kind: 'float', default: 1, min: -1000, max: 1000, step: 0.1, folder: 'Ranges', port: true },
      { name: 'clamp', label: 'Clamp', kind: 'toggle', default: true },
    ],
    lower: (ctx) => ({
      nodes: [{
        id: ctx.id, type: 'scale', input: ctx.input('in'), name: ctx.str('name'), expr: ctx.expr('input'),
        kind: ctx.str('kind') as 'linear' | 'log' | 'sqrt',
        domain: [ctx.bind('inMin'), ctx.bind('inMax')], range: [ctx.bind('outMin'), ctx.bind('outMax')], clamp: ctx.bool('clamp'),
      }],
      outputs: { out: ctx.id },
    }),
  },
  {
    type: 'color-ramp', label: 'Color Ramp', category: 'color',
    description: 'Map a value through a color ramp into an RGB attribute.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'input', label: 'Input', kind: 'expr', default: 'value', of: 'in' },
      { name: 'ramp', label: 'Ramp', kind: 'menu', default: 'viridis', options: RAMPS },
      { name: 'min', label: 'Min', kind: 'float', default: 0, min: -1000, max: 1000, step: 0.1, port: true },
      { name: 'max', label: 'Max', kind: 'float', default: 1, min: -1000, max: 1000, step: 0.1, port: true },
      { name: 'name', label: 'Output', kind: 'string', default: 'Cd' },
    ],
    lower: (ctx) => ({
      nodes: [{
        id: ctx.id, type: 'colorscale', input: ctx.input('in'), expr: ctx.expr('input'),
        ramp: ctx.str('ramp') as RampName, domain: [ctx.bind('min'), ctx.bind('max')], name: ctx.str('name') || 'Cd',
      }],
      outputs: { out: ctx.id },
    }),
  },
  {
    type: 'color', label: 'Color', category: 'color',
    description: 'A color other parameters reference, so several layers can share one.',
    inputs: [], outputs: [],
    params: [{ name: 'color', label: 'Color', kind: 'color', default: [255, 255, 255] }],
  },
  {
    type: 'extent', label: 'Extent', category: 'rows', stats: true,
    description: 'The minimum and maximum of an expression over the rows that reach it, computed in SQL. Wire min or max into another node\'s parameter, e.g. a Map Range\'s In max.',
    inputs: [table()],
    outputs: [{ name: 'min', type: 'number' }, { name: 'max', type: 'number' }],
    params: [{ name: 'input', label: 'Input', kind: 'expr', default: 'value', of: 'in' }],
    lower: (ctx) => ({
      // Statistics publish `<id>_min` and `<id>_max`, so the id must be a parameter name.
      nodes: [{ id: safeId(ctx.id), type: 'stats', input: ctx.input('in'), column: ctx.expr('input'), ops: ['min', 'max'] }],
      outputs: {},
    }),
  },
  {
    type: 'distance', label: 'Distance', category: 'rows',
    description: 'Great-circle distance in km between two lng/lat points (haversine).',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'lng1', label: 'From lng', kind: 'expr', default: 'lng', of: 'in' },
      { name: 'lat1', label: 'From lat', kind: 'expr', default: 'lat', of: 'in' },
      { name: 'lng2', label: 'To lng', kind: 'expr', default: 'r_lng', of: 'in' },
      { name: 'lat2', label: 'To lat', kind: 'expr', default: 'r_lat', of: 'in' },
      { name: 'name', label: 'Output', kind: 'string', default: 'km' },
    ],
    lower(ctx) {
      const [x1, y1, x2, y2] = ['lng1', 'lat1', 'lng2', 'lat2'].map((p) => `(${ctx.expr(p)})`);
      // The geo prelude's `distance` (geo.ts). This used to be spelled out here with
      // `pow(sin(Δ), 2.0)`, which WGSL leaves undefined for a negative base — half of all
      // point pairs — and with a 6371 km radius where turf and DuckDB use 6371.0088.
      const km = `distance([${x1}, ${y1}], [${x2}, ${y2}])`;
      return { nodes: [{ id: ctx.id, type: 'attribute', input: ctx.input('in'), name: ctx.str('name') || 'km', expr: km }], outputs: { out: ctx.id } };
    },
  },
  {
    type: 'region', label: 'Region Filter', category: 'rows',
    description: 'Keep rows inside, outside or near a polygon. Runs in SQL, on the GPU or the CPU, wherever the planner puts it.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'mode', label: 'Keep', kind: 'menu', default: 'inside', options: [
        { value: 'inside', label: 'Inside' }, { value: 'outside', label: 'Outside' }, { value: 'near', label: 'Within a distance' },
      ] },
      geometryParam,
      { name: 'metres', label: 'Distance (m)', kind: 'float', default: 500, min: 0, max: 50000, step: 10, when: { param: 'mode', is: ['near'] }, changeRate: 4, port: true },
      { name: 'lng', label: 'Longitude', kind: 'expr', default: 'lng', of: 'in', folder: 'Point' },
      { name: 'lat', label: 'Latitude', kind: 'expr', default: 'lat', of: 'in', folder: 'Point' },
    ],
    lower(ctx) {
      const mode = ctx.str('mode');
      // Near is measured to any geometry; inside and outside need an area.
      const g = geometryLiteral(ctx, mode === 'near' ? [0, 1, 2] : [2], 'Region Filter');
      const p = `[(${ctx.expr('lng')}), (${ctx.expr('lat')})]`;
      const predicate = mode === 'near' ? `st_dwithin(${g}, ${p}, ${ctx.bind('metres')})`
        : mode === 'outside' ? `!st_intersects(${g}, ${p})` : `st_intersects(${g}, ${p})`;
      return { nodes: [{ id: ctx.id, type: 'filter', input: ctx.input('in'), predicate }], outputs: { out: ctx.id } };
    },
  },
  {
    type: 'geo-distance', label: 'Distance to Geometry', category: 'rows',
    description: 'Distance from each row\'s point to a line, polygon or set of points: zero inside a polygon.',
    inputs: [table()], outputs: [out()],
    params: [
      { ...geometryParam, default: 'LINESTRING(-74.02 40.70, -73.99 40.73, -73.97 40.76)' },
      { name: 'units', label: 'Units', kind: 'menu', default: 'm', options: [{ value: 'm', label: 'Metres' }, { value: 'km', label: 'Kilometres' }] },
      { name: 'name', label: 'Output', kind: 'string', default: 'dist' },
      { name: 'lng', label: 'Longitude', kind: 'expr', default: 'lng', of: 'in', folder: 'Point' },
      { name: 'lat', label: 'Latitude', kind: 'expr', default: 'lat', of: 'in', folder: 'Point' },
    ],
    lower(ctx) {
      const name = ctx.str('name') || 'dist';
      if (!BARE.test(name)) ctx.error(`'${name}' is not a valid attribute name`);
      const metres = `st_distance(${geometryLiteral(ctx, [0, 1, 2], 'Distance to Geometry')}, [(${ctx.expr('lng')}), (${ctx.expr('lat')})])`;
      const expr = ctx.str('units') === 'km' ? `${metres} / 1000.0` : metres;
      return { nodes: [{ id: ctx.id, type: 'attribute', input: ctx.input('in'), name, expr }], outputs: { out: ctx.id } };
    },
  },

  // --- layers ---------------------------------------------------------------
  {
    type: 'scatter', label: 'Scatterplot Layer', category: 'layer',
    description: 'A circle per row.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P', '[lng, lat] or [lng, lat, metres], or an attribute holding one.'),
      channel('color', 'Color', '', 'An RGB attribute or expression in 0–1, e.g. ramp(fit(mag, 0, 7, 0, 1)). Empty uses Fill color.'),
      channel('radius', 'Radius', '', 'Per-row radius. Empty uses 1 × Radius scale.'),
      rampParam,
      { name: 'radiusScale', label: 'Radius scale', kind: 'float', default: 4, min: 0, max: 100, step: 0.1, bind: 'prop', folder: 'Style', port: true },
      { name: 'radiusUnits', label: 'Units', kind: 'menu', default: 'pixels', options: [{ value: 'pixels', label: 'Pixels' }, { value: 'meters', label: 'Metres' }], folder: 'Style' },
      { name: 'fillColor', label: 'Fill color', kind: 'color', default: [255, 140, 0], folder: 'Style' },
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, 'scatter',
      [{ channel: 'position', param: 'position' }, { channel: 'color', param: 'color' }, { channel: 'radius', param: 'radius' }],
      { radiusScale: ctx.bind('radiusScale'), radiusUnits: ctx.str('radiusUnits'), fillColor: ctx.bindColor('fillColor'), opacity: ctx.bind('opacity') }),
  },
  {
    type: 'arc', label: 'Arc Layer', category: 'layer',
    description: 'An arc per row between two positions.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('source', 'Source position', '[lng, lat]'),
      channel('target', 'Target position', '[r_lng, r_lat]'),
      channel('sourceColor', 'Source color', ''),
      channel('targetColor', 'Target color', ''),
      channel('width', 'Width', ''),
      rampParam,
      { name: 'widthScale', label: 'Width scale', kind: 'float', default: 1.5, min: 0, max: 20, step: 0.1, bind: 'prop', folder: 'Style', port: true },
      { name: 'widthUnits', label: 'Width units', kind: 'menu', default: 'pixels', options: [{ value: 'pixels', label: 'Pixels' }, { value: 'meters', label: 'Metres' }, { value: 'common', label: 'Common' }], folder: 'Style' },
      { name: 'height', label: 'Height', kind: 'float', default: 1, min: 0, max: 5, step: 0.05, bind: 'prop', folder: 'Style', port: true },
      { name: 'greatCircle', label: 'Great circle', kind: 'toggle', default: false, folder: 'Style' },
      { name: 'fromColor', label: 'From color', kind: 'color', default: [0, 180, 255], folder: 'Style' },
      { name: 'toColor', label: 'To color', kind: 'color', default: [255, 60, 120], folder: 'Style' },
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, 'arc',
      [
        { channel: 'sourcePosition', param: 'source' }, { channel: 'targetPosition', param: 'target' },
        { channel: 'sourceColor', param: 'sourceColor' }, { channel: 'targetColor', param: 'targetColor' },
        { channel: 'width', param: 'width' },
      ],
      {
        widthScale: ctx.bind('widthScale'), widthUnits: ctx.str('widthUnits'), height: ctx.bind('height'), greatCircle: ctx.bool('greatCircle'),
        sourceColor: ctx.bindColor('fromColor'), targetColor: ctx.bindColor('toColor'), opacity: ctx.bind('opacity'),
      }),
  },
  {
    type: 'path', label: 'Path Layer', category: 'layer',
    description: 'Rows are vertices: grouped into paths by an id column, ordered by another.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P'),
      { name: 'pathId', label: 'Path id', kind: 'column', default: 'row', of: 'in', folder: 'Channels' },
      { name: 'order', label: 'Vertex order', kind: 'column', default: 'index', of: 'in', folder: 'Channels' },
      channel('color', 'Color', ''),
      channel('width', 'Width', ''),
      rampParam,
      { name: 'widthScale', label: 'Width scale', kind: 'float', default: 2, min: 0, max: 50, step: 0.1, bind: 'prop', folder: 'Style', port: true },
      { name: 'widthMinPixels', label: 'Min width (px)', kind: 'float', default: 1, min: 0, max: 20, step: 0.5, bind: 'prop', folder: 'Style' },
      { name: 'widthUnits', label: 'Width units', kind: 'menu', default: 'pixels', options: [{ value: 'pixels', label: 'Pixels' }, { value: 'meters', label: 'Metres' }], folder: 'Style' },
      { name: 'lineColor', label: 'Line color', kind: 'color', default: [120, 200, 255], folder: 'Style' },
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, 'path',
      [{ channel: 'position', param: 'position' }, { channel: 'color', param: 'color' }, { channel: 'width', param: 'width' }],
      { widthScale: ctx.bind('widthScale'), widthMinPixels: ctx.bind('widthMinPixels'), widthUnits: ctx.str('widthUnits'), color: ctx.bindColor('lineColor'), opacity: ctx.bind('opacity') },
      { pathId: ctx.str('pathId'), orderBy: [ctx.str('order')].filter(Boolean) }),
  },
  {
    type: 'trips', label: 'Trips Layer', category: 'layer',
    description: 'Animated trails: vertex rows with a timestamp each. Current time is a deck prop, so playing costs no queries.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P'),
      channel('timestamp', 'Timestamp', 't'),
      { name: 'pathId', label: 'Path id', kind: 'column', default: 'row', of: 'in', folder: 'Channels' },
      { name: 'order', label: 'Vertex order', kind: 'column', default: 'index', of: 'in', folder: 'Channels' },
      channel('color', 'Color', ''),
      rampParam,
      { name: 'currentTime', label: 'Current time', kind: 'float', default: 0, min: 0, max: 86400, step: 1, bind: 'prop', folder: 'Animation', port: true },
      { name: 'trailLength', label: 'Trail length', kind: 'float', default: 180, min: 1, max: 20000, step: 1, bind: 'prop', folder: 'Animation', port: true },
      { name: 'fadeTrail', label: 'Fade trail', kind: 'toggle', default: true, folder: 'Animation' },
      { name: 'widthMinPixels', label: 'Width (px)', kind: 'float', default: 2, min: 0, max: 20, step: 0.5, bind: 'prop', folder: 'Style' },
      { name: 'widthScale', label: 'Width', kind: 'float', default: 1, min: 0, max: 10000, step: 1, bind: 'prop', folder: 'Style' },
      { name: 'widthUnits', label: 'Width units', kind: 'menu', default: 'meters', options: [{ value: 'pixels', label: 'Pixels' }, { value: 'meters', label: 'Metres' }], folder: 'Style' },
      { name: 'lineColor', label: 'Trail color', kind: 'color', default: [253, 128, 93], folder: 'Style' },
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, 'trips',
      [{ channel: 'position', param: 'position' }, { channel: 'timestamp', param: 'timestamp' }, { channel: 'color', param: 'color' }],
      {
        currentTime: ctx.bind('currentTime'), trailLength: ctx.bind('trailLength'), fadeTrail: ctx.bool('fadeTrail'),
        widthMinPixels: ctx.bind('widthMinPixels'), widthScale: ctx.bind('widthScale'), widthUnits: ctx.str('widthUnits'),
        color: ctx.bindColor('lineColor'), opacity: ctx.bind('opacity'),
      },
      { pathId: ctx.str('pathId'), orderBy: [ctx.str('order')].filter(Boolean) }),
  },
  {
    type: 'column', label: 'Column Layer', category: 'layer',
    description: 'An extruded column per row: bars on a map.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P'),
      channel('elevation', 'Elevation', 'n'),
      channel('color', 'Color', ''),
      rampParam,
      { name: 'radius', label: 'Radius (m)', kind: 'float', default: 250, min: 1, max: 50000, step: 1, bind: 'prop', folder: 'Style', port: true },
      { name: 'elevationScale', label: 'Elevation scale', kind: 'float', default: 20, min: 0, max: 5000, step: 1, bind: 'prop', folder: 'Style', port: true },
      { name: 'columnColor', label: 'Column color', kind: 'color', default: [255, 170, 60], folder: 'Style' },
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, 'column',
      [{ channel: 'position', param: 'position' }, { channel: 'elevation', param: 'elevation' }, { channel: 'color', param: 'color' }],
      { radius: ctx.bind('radius'), elevationScale: ctx.bind('elevationScale'), fillColor: ctx.bindColor('columnColor'), opacity: ctx.bind('opacity') }),
  },
  {
    type: 'polygon', label: 'Polygon Layer', category: 'layer',
    description: 'Rows are vertices: grouped into polygons by an id, into rings by another (the first ring is the outline, the rest are holes), ordered by a third.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P'),
      { name: 'pathId', label: 'Polygon id', kind: 'column', default: 'row', of: 'in', folder: 'Channels' },
      { name: 'ringId', label: 'Ring id', kind: 'column', default: '', of: 'in', folder: 'Channels', help: 'Empty: every polygon is one ring.' },
      { name: 'order', label: 'Vertex order', kind: 'column', default: 'index', of: 'in', folder: 'Channels' },
      channel('color', 'Color', ''),
      channel('lineColorChannel', 'Outline color', '', 'Per-row outline color in 0–1. Empty uses the constant Outline color.'),
      channel('elevation', 'Elevation', '', 'Per-row height when extruded. Empty uses 1 × Elevation scale.'),
      rampParam,
      { name: 'filled', label: 'Fill', kind: 'toggle', default: true, folder: 'Style' },
      { name: 'fillColor', label: 'Fill color', kind: 'color', default: [80, 160, 220], folder: 'Style' },
      { name: 'stroked', label: 'Outline', kind: 'toggle', default: false, folder: 'Style' },
      { name: 'lineColor', label: 'Outline color', kind: 'color', default: [255, 255, 255], folder: 'Style' },
      { name: 'lineWidthScale', label: 'Outline width', kind: 'float', default: 1, min: 0, max: 1000, step: 0.1, bind: 'prop', folder: 'Style' },
      { name: 'lineWidthUnits', label: 'Outline units', kind: 'menu', default: 'pixels', options: [{ value: 'pixels', label: 'Pixels' }, { value: 'meters', label: 'Metres' }], folder: 'Style' },
      { name: 'lineWidthMinPixels', label: 'Outline min width (px)', kind: 'float', default: 1, min: 0, max: 20, step: 0.1, bind: 'prop', folder: 'Style' },
      { name: 'extruded', label: 'Extruded', kind: 'toggle', default: false, folder: 'Style' },
      { name: 'elevationScale', label: 'Elevation scale', kind: 'float', default: 1, min: 0, max: 10000, step: 1, bind: 'prop', folder: 'Style', port: true },
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, 'polygon',
      [
        { channel: 'position', param: 'position' }, { channel: 'color', param: 'color' },
        { channel: 'lineColor', param: 'lineColorChannel' }, { channel: 'elevation', param: 'elevation' },
      ],
      {
        fillColor: ctx.bindColor('fillColor'), filled: ctx.bool('filled'), stroked: ctx.bool('stroked'),
        lineColor: ctx.bindColor('lineColor'), lineWidthScale: ctx.bind('lineWidthScale'),
        lineWidthUnits: ctx.str('lineWidthUnits'), lineWidthMinPixels: ctx.bind('lineWidthMinPixels'),
        extruded: ctx.bool('extruded'), elevationScale: ctx.bind('elevationScale'), opacity: ctx.bind('opacity'),
      },
      {
        pathId: ctx.str('pathId'),
        ...(ctx.str('ringId') ? { ringId: ctx.str('ringId') } : {}),
        orderBy: [ctx.str('order')].filter(Boolean),
      }),
  },
  {
    type: 'text', label: 'Text Layer', category: 'layer',
    description: 'A label per row from a string column.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P'),
      { name: 'text', label: 'Text', kind: 'column', default: 'name', of: 'in', columnType: 'str', folder: 'Channels' },
      rampParam,
      { name: 'size', label: 'Size (px)', kind: 'float', default: 12, min: 4, max: 64, step: 1, bind: 'prop', folder: 'Style', port: true },
      { name: 'textColor', label: 'Color', kind: 'color', default: [230, 230, 230], folder: 'Style' },
      { name: 'offsetY', label: 'Offset Y (px)', kind: 'float', default: -12, min: -64, max: 64, step: 1, bind: 'prop', folder: 'Style' },
      opacity,
      blendParam,
    ],
    lower(ctx) {
      const text = ctx.str('text');
      if (!text) ctx.error('Text Layer needs a text column');
      const r = lowerLayer(ctx, 'text', [{ channel: 'position', param: 'position' }],
        { size: ctx.bind('size'), color: ctx.bindColor('textColor'), offsetY: ctx.bind('offsetY'), opacity: ctx.bind('opacity') });
      const layer = r.nodes[r.nodes.length - 1] as LayerNode;
      layer.channels = { ...layer.channels, text };
      return r;
    },
  },

  // --- aggregation layers -----------------------------------------------------
  {
    type: 'heatmap', label: 'Heatmap Layer', category: 'layer',
    description: 'A density surface of the rows\' positions, weighted per row.',
    inputs: [table()], outputs: [out('layer')],
    params: [
      channel('position', 'Position', 'P'),
      channel('weight', 'Weight', '', 'Per-row weight. Empty uses the constant Weight.'),
      { name: 'weightConstant', label: 'Weight', kind: 'float', default: 1, min: 0, max: 1000, step: 0.1, bind: 'prop', folder: 'Style', port: true },
      { name: 'aggregation', label: 'Aggregation', kind: 'menu', default: 'SUM', options: [{ value: 'SUM', label: 'Sum' }, { value: 'MEAN', label: 'Mean' }], folder: 'Style' },
      { name: 'radiusPixels', label: 'Radius (px)', kind: 'float', default: 30, min: 1, max: 500, step: 1, bind: 'prop', folder: 'Style', port: true },
      { name: 'intensity', label: 'Intensity', kind: 'float', default: 1, min: 0, max: 10, step: 0.05, bind: 'prop', folder: 'Style', port: true },
      { name: 'threshold', label: 'Threshold', kind: 'float', default: 0.05, min: 0, max: 1, step: 0.01, bind: 'prop', folder: 'Style' },
      colorRangeParam,
      rampParam,
      opacity,
      blendParam,
    ],
    lower: (ctx) => lowerLayer(ctx, 'heatmap',
      [{ channel: 'position', param: 'position' }, { channel: 'weight', param: 'weight' }],
      {
        weight: ctx.bind('weightConstant'), aggregation: ctx.str('aggregation'), radiusPixels: ctx.bind('radiusPixels'),
        intensity: ctx.bind('intensity'), threshold: ctx.bind('threshold'), colorRange: ctx.str('colorRange'),
        opacity: ctx.bind('opacity'),
      }),
  },
  modelLayer('mesh', 'Simple Mesh Layer', 'mesh', 'Mesh URL', 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/humanoid_quad.obj'),
  modelLayer('scenegraph', 'Scenegraph Layer', 'scenegraph', 'Model URL (glTF)', 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/scenegraph-layer/airplane.glb'),
  binLayer('hexagon', 'hexagon', 'Hexagon Layer', 'radius', 'Radius (m)', 1000),
  // `grid` is the Grid Bin operator; this draws deck's own grid aggregation.
  binLayer('grid-layer', 'grid', 'Grid Layer', 'cellSize', 'Cell size (m)', 1000),

  // --- output ---------------------------------------------------------------
  {
    type: 'deck', label: 'Deck', category: 'output',
    description: 'The map: layers bottom to top, the basemap, and the camera. Camera fields are props, so a keyframed fly-through costs no queries.',
    inputs: [
      { name: 'layers', type: 'layer', label: 'layers', multi: true },
      // Host values the planner passes through to deck and MapLibre untouched.
      { name: 'views', type: 'value', label: 'views', multi: true, optional: true },
      { name: 'effects', type: 'value', label: 'effects', multi: true, optional: true },
      { name: 'widgets', type: 'value', label: 'widgets', multi: true, optional: true },
      { name: 'viewState', type: 'value', label: 'view state', optional: true },
      { name: 'maplibreLayers', type: 'value', label: 'MapLibre layers', multi: true, optional: true },
    ], outputs: [],
    params: [
      { name: 'basemap', label: 'Basemap', kind: 'menu', default: 'dark-matter', options: [
        { value: 'dark-matter', label: 'Dark Matter' }, { value: 'positron', label: 'Positron' }, { value: 'voyager', label: 'Voyager' }, { value: 'none', label: 'None' },
      ] },
      { name: 'longitude', label: 'Longitude', kind: 'float', default: 0, min: -180, max: 180, step: 0.01, bind: 'prop', folder: 'Camera', port: true },
      { name: 'latitude', label: 'Latitude', kind: 'float', default: 20, min: -85, max: 85, step: 0.01, bind: 'prop', folder: 'Camera', port: true },
      { name: 'zoom', label: 'Zoom', kind: 'float', default: 1.5, min: 0, max: 22, step: 0.05, bind: 'prop', folder: 'Camera', port: true },
      { name: 'pitch', label: 'Pitch', kind: 'float', default: 0, min: 0, max: 85, step: 0.5, bind: 'prop', folder: 'Camera', port: true },
      { name: 'bearing', label: 'Bearing', kind: 'float', default: 0, min: -180, max: 180, step: 0.5, bind: 'prop', folder: 'Camera', port: true },
      { name: 'follow', label: 'Drive the map camera', kind: 'toggle', default: false, folder: 'Camera', help: 'On: the camera parameters (and their keyframes) move the map. Off: the map is free to pan.' },
      { name: 'mapStyle', label: 'Map style URL', kind: 'url', default: '', help: 'A MapLibre style. Overrides Basemap when set.' },
      { name: 'projection', label: 'Projection', kind: 'menu', default: 'mercator', options: [{ value: 'mercator', label: 'Mercator' }, { value: 'globe', label: 'Globe' }] },
      // Video export. Read by the renderer, never lowered.
      { name: 'display', label: 'Display', kind: 'menu', default: 'fixed', options: [{ value: 'fixed', label: 'Fixed size' }, { value: 'responsive', label: 'Responsive' }], folder: 'Export' },
      { name: 'width', label: 'Width', kind: 'int', default: 1920, min: 1, max: 8192, step: 1, folder: 'Export' },
      { name: 'height', label: 'Height', kind: 'int', default: 1080, min: 1, max: 8192, step: 1, folder: 'Export' },
      { name: 'lod', label: 'Level of detail', kind: 'float', default: 2, min: 0.1, max: 4, step: 0.1, folder: 'Export' },
      { name: 'scaleMode', label: 'Scale mode', kind: 'menu', default: 'fit', options: [{ value: 'fit', label: 'Fit' }, { value: 'manual', label: 'Manual' }], folder: 'Export' },
      { name: 'waitForData', label: 'Wait for data', kind: 'toggle', default: true, folder: 'Export' },
      { name: 'codec', label: 'Codec', kind: 'menu', default: 'avc', options: ['avc', 'hevc', 'vp9', 'av1'].map((v) => ({ value: v, label: v.toUpperCase() })), folder: 'Export' },
      { name: 'bitrateMbps', label: 'Bitrate (Mbps)', kind: 'float', default: 10, min: 1, max: 100, step: 1, folder: 'Export' },
      { name: 'bitrateMode', label: 'Bitrate mode', kind: 'menu', default: 'constant', options: [{ value: 'constant', label: 'Constant' }, { value: 'variable', label: 'Variable' }], folder: 'Export' },
      { name: 'scaleControl', label: 'Scale control', kind: 'float', default: 0.3, min: 0.1, max: 1, step: 0.05, folder: 'Export' },
      { name: 'framerate', label: 'Frame rate', kind: 'int', default: 30, min: 1, max: 120, step: 1, folder: 'Export' },
      { name: 'captureDelay', label: 'Capture delay (ms)', kind: 'int', default: 50, min: 0, max: 10000, step: 10, folder: 'Export' },
      { name: 'rendersDirectory', label: 'Renders folder', kind: 'string', default: 'renders', folder: 'Export' },
    ],
    lower(ctx) {
      const deck: DeckNode = {
        id: ctx.id, type: 'deck', inputs: ctx.inputs('layers'), basemap: ctx.str('mapStyle') || ctx.str('basemap'),
        view: Object.fromEntries(['longitude', 'latitude', 'zoom', 'pitch', 'bearing'].map((k) => [k, ctx.bind(k)])),
      };
      return { nodes: [deck], outputs: {} };
    },
  },

  // --- numbers --------------------------------------------------------------
  {
    type: 'number', label: 'Number', category: 'number',
    description: 'A constant, a slider, or a keyframed value. Wire it into any parameter.',
    inputs: [], outputs: [out('number')],
    params: [{ name: 'value', label: 'Value', kind: 'float', default: 0, min: -1000, max: 1000, step: 0.01 }],
    scalar: (p) => p.num('value'),
  },
  {
    type: 'time', label: 'Time', category: 'number',
    description: 'Timeline seconds × speed + offset. The clock that drives an animation.',
    inputs: [], outputs: [out('number')],
    params: [
      { name: 'speed', label: 'Speed', kind: 'float', default: 1, min: -100, max: 1000, step: 0.1 },
      { name: 'offset', label: 'Offset', kind: 'float', default: 0, min: -100000, max: 100000, step: 1 },
    ],
    scalar: (p, clock) => clock.T * p.num('speed') + p.num('offset'),
  },
  {
    type: 'math', label: 'Math', category: 'number',
    description: 'Combine two numbers.',
    inputs: [], outputs: [out('number')],
    params: [
      { name: 'op', label: 'Operation', kind: 'menu', default: '*', options: [
        { value: '+', label: 'a + b' }, { value: '-', label: 'a − b' }, { value: '*', label: 'a × b' }, { value: '/', label: 'a ÷ b' },
        { value: 'min', label: 'min(a, b)' }, { value: 'max', label: 'max(a, b)' }, { value: 'pow', label: 'a ^ b' }, { value: 'mod', label: 'a mod b' },
      ] },
      { name: 'a', label: 'a', kind: 'float', default: 1, min: -1000, max: 1000, step: 0.01, port: true },
      { name: 'b', label: 'b', kind: 'float', default: 1, min: -1000, max: 1000, step: 0.01, port: true },
    ],
    scalar(p) {
      const a = p.num('a');
      const b = p.num('b');
      switch (p.str('op')) {
        case '+': return a + b;
        case '-': return a - b;
        case '/': return a / b;
        case 'min': return Math.min(a, b);
        case 'max': return Math.max(a, b);
        case 'pow': return a ** b;
        case 'mod': return a - b * Math.floor(a / b);
        default: return a * b;
      }
    },
  },
  {
    type: 'expression', label: 'Expression', category: 'number',
    description: 'A number from an expression over a, b, T (seconds), F (frame) and ch() references.',
    inputs: [], outputs: [out('number')],
    params: [
      { name: 'a', label: 'a', kind: 'float', default: 0, min: -1000, max: 1000, step: 0.01, port: true },
      { name: 'b', label: 'b', kind: 'float', default: 0, min: -1000, max: 1000, step: 0.01, port: true },
      { name: 'expression', label: 'Expression', kind: 'expr', default: 'a + b * sin(T)' },
    ],
    // Evaluated by the scalar program, which compiles `expression` with a, b, T and F bound.
  },

  // --- structure ------------------------------------------------------------
  {
    type: 'switch', label: 'Switch', category: 'structure',
    description: 'Pass one of several layers through, chosen by index. A change re-plans, and the memo keeps every layer it is not showing, so switching back costs at most that layer\'s query.',
    inputs: [{ name: 'in', type: 'layer', label: 'layers', multi: true }],
    outputs: [out('layer')],
    params: [{ name: 'index', label: 'Index', kind: 'int', default: 0, min: 0, max: 16, step: 1, bind: 'structural' }],
    lower(ctx) {
      const layers = ctx.inputs('in');
      if (layers.length === 0) ctx.error('Switch needs a layer');
      const i = Math.max(0, Math.min(layers.length - 1, Math.floor(ctx.num('index') || 0)));
      return { nodes: [], outputs: { out: layers[i] } };
    },
  },
  {
    type: 'subnet', label: 'Subnetwork', category: 'structure',
    description: 'A network inside a node. Double-click to enter. Promote parameters to control the inside from here.',
    inputs: [table('in0', 'in0', { optional: true }), table('in1', 'in1', { optional: true })],
    outputs: [out('table', 'out0')],
    params: [],
  },
  {
    type: 'subnet-input', label: 'Subnet Input', category: 'structure',
    description: 'Inside a subnet: the table connected to the subnet\'s input.',
    inputs: [], outputs: [out()],
    params: [{ name: 'index', label: 'Input', kind: 'int', default: 0, min: 0, max: 1, step: 1, bind: 'structural' }],
  },
  {
    type: 'subnet-output', label: 'Subnet Output', category: 'structure',
    description: 'Inside a subnet: what the subnet outputs.',
    inputs: [table()], outputs: [],
    params: [{ name: 'index', label: 'Output', kind: 'int', default: 0, min: 0, max: 0, step: 1, bind: 'structural' }],
  },
  ...GIS_OPERATORS,
];

const INDEX = new Map(OPERATORS.map((o) => [o.type, o]));
export const OPERATOR_INDEX: ReadonlyMap<string, OpDef> = INDEX;

/**
 * Add an operator to the catalog, e.g. a host application's own operator that runs outside the
 * planner. One without `lower` is skipped by lowering, and a deck drops a layer from it.
 */
export function registerOperator(def: OpDef): void {
  if (INDEX.has(def.type)) {
    const i = OPERATORS.findIndex((o) => o.type === def.type);
    OPERATORS[i] = def;
  } else {
    OPERATORS.push(def);
  }
  INDEX.set(def.type, def);
}

export function operator(type: string): OpDef {
  const op = OPERATOR_INDEX.get(type);
  if (!op) throw new Error(`Unknown operator '${type}'`);
  return op;
}

/** How a parameter reaches the plan, with the defaults spelled out once. */
export function bindingOf(def: ParamDef): 'value' | 'prop' | 'structural' {
  if (def.bind) return def.bind;
  return def.kind === 'float' || def.kind === 'int' || def.kind === 'text' ? 'value' : 'structural';
}

/** Whether an output port may feed an input port. */
export function canConnect(from: PortType, to: PortType | 'param'): boolean {
  if (to === 'param') return from === 'number';
  // A host value port takes anything; a host value may be a layer (a switch between two).
  if (to === 'value') return true;
  if (from === 'value') return to === 'layer';
  return from === to;
}

/** The port type a parameter's `par:` handle accepts. */
export const paramAccepts = (def: ParamDef): PortType => def.portType ?? 'number';

/** The port a parameter handle is addressed by. */
export const paramPort = (param: string): string => `par:${param}`;
