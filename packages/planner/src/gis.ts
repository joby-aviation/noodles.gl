/**
 * Geometry operators: turf's GIS set as DuckDB spatial SQL over a table of features, one row
 * per feature with its geometry in `geom` and its properties as columns (what a GeoJSON node's
 * `features` port gives). Each returns such a table, so they chain, and a GeoJSON node's `in`
 * turns the result back into vertex rows for a layer.
 *
 * Distances are on the ground: lengths and areas are spheroidal, and buffers, translations,
 * rectangles and grids work in a local frame where a degree of longitude is scaled to the
 * length of a degree of latitude there (WGS84), accurate at the sizes maps use. Where DuckDB has no equivalent
 * (clustering, interpolation, isolines, triangulation, smoothing) the operator is turf itself,
 * run by the engine as a JS table.
 *
 * DuckDB's spheroidal functions read coordinates as lat/lng, so every one is applied to
 * ST_FlipCoordinates(geom).
 */

import type { GraphNode } from './types.js';
import type { LowerCtx, LowerResult, OpDef, ParamDef, PortSpec } from './operators.js';

const features = (name = 'in', label = 'features', extra: Partial<PortSpec> = {}): PortSpec => ({ name, type: 'table', label, ...extra });
const table = (name = 'in', label?: string): PortSpec => ({ name, type: 'table', label });
const out = (name = 'out'): PortSpec => ({ name, type: 'table' });
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const str = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** Meters per degree, for the `degrees` unit: a degree of a great circle on turf's sphere. */
const M_PER_DEG = 111319.49;
/** Meters per degree of latitude and of longitude at a latitude in degrees, on WGS84. */
const mLat = (lat: string) => `(111132.92 - 559.82 * cos(radians(2 * ${lat})) + 1.175 * cos(radians(4 * ${lat})))`;
const mLng = (lat: string) => `(111412.84 * cos(radians(${lat})) - 93.5 * cos(radians(3 * ${lat})))`;

/** Meters in one of each distance unit turf takes. */
export const METERS: Record<string, number> = {
  kilometers: 1000, meters: 1, miles: 1609.344, nauticalmiles: 1852, feet: 0.3048, yards: 0.9144,
  inches: 0.0254, centimeters: 0.01, millimeters: 0.001, degrees: M_PER_DEG, radians: 6371008.8,
};
const UNIT_OPTIONS = [
  { value: 'kilometers', label: 'Kilometers' }, { value: 'meters', label: 'Meters' },
  { value: 'miles', label: 'Miles' }, { value: 'nauticalmiles', label: 'Nautical miles' },
  { value: 'feet', label: 'Feet' }, { value: 'degrees', label: 'Degrees' },
];
const units = (def = 'kilometers'): ParamDef => ({ name: 'units', label: 'Units', kind: 'menu', default: def, options: UNIT_OPTIONS });

/** A distance parameter in meters, bound so a drag rebinds rather than replans. */
function meters(ctx: LowerCtx, param: string): string {
  const per = METERS[ctx.str('units')];
  if (per === undefined) ctx.error(`Unknown units '${ctx.str('units')}'`);
  return `(${ctx.bind(param)} * ${per})`;
}

/** A length in meters on the spheroid: a line's length, a polygon's perimeter. */
const groundLength = (g: string) =>
  `CASE WHEN ST_Dimension(${g}) = 2 THEN ST_Perimeter_Spheroid(ST_FlipCoordinates(${g})) ELSE ST_Length_Spheroid(ST_FlipCoordinates(${g})) END`;

const sqlNode = (ctx: LowerCtx, query: string, inputs: string[], id = ctx.id): GraphNode => ({ id, type: 'sql', inputs, query });
const one = (ctx: LowerCtx, query: string, inputs = [ctx.input('in')]): LowerResult => ({
  nodes: [sqlNode(ctx, query, inputs)], outputs: { out: ctx.id },
});

/** A JS table made by turf from the input's features (`d` is a FeatureCollection). */
const turfTable = (ctx: LowerCtx, code: string): LowerResult => ({
  nodes: [{ id: ctx.id, type: 'js', input: ctx.input('in'), code }], outputs: { out: ctx.id },
});

/** Every row with `geom` replaced by an expression of it. */
const replaceGeom = (expr: string, where = '') =>
  `SELECT * REPLACE (${expr} AS geom) FROM {{input0}}${where ? ` WHERE ${where}` : ''}`;

/** A JSON value as a SQL literal, for properties written into a node. */
function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? `CAST(${v} AS DOUBLE)` : 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return str(v);
  return `${str(JSON.stringify(v))}::JSON`;
}

/** Properties as SELECT items, one column each. */
function propertyItems(ctx: LowerCtx, text: string): string[] {
  if (!text.trim()) return [];
  let props: unknown;
  try { props = JSON.parse(text); } catch { ctx.error('Properties must be a JSON object'); }
  if (!props || typeof props !== 'object' || Array.isArray(props)) ctx.error('Properties must be a JSON object');
  return Object.entries(props as Record<string, unknown>).filter(([k]) => k !== 'geom').map(([k, v]) => `${literal(v)} AS ${q(k)}`);
}

const properties: ParamDef = { name: 'properties', label: 'Properties', kind: 'text', default: '', help: 'A JSON object: one column per key.' };

/** turf's grids: hexagons, squares or points of a cell size, centered in a bounding box. */
function gridSql(ctx: LowerCtx): string {
  const [w, s, e, n] = ['west', 'south', 'east', 'north'].map((p) => `CAST(${ctx.bind(p)} AS DOUBLE)`);
  const size = meters(ctx, 'cellSize');
  const shape = ctx.str('shape');
  // dy: a cell's height in degrees of latitude; dx: its width in degrees of longitude
  const mid = `((${s} + ${n}) / 2)`;
  const frame = `SELECT ${w} AS w, ${s} AS s, ${e} AS e, ${n} AS n, ${size} / ${mLat(mid)} AS dy, ${size} / ${mLng(mid)} AS dx`;
  if (shape === 'hex') {
    // Flat-topped hexagons of circumradius dx, columns 1.5 radii apart, odd columns half a row up
    const cells = [
      `SELECT *, w + ((e - w) - (nx - 1) * 1.5 * dx) / 2 AS x0, s + ((n - s) - (ny - 1) * sqrt(3) * dy) / 2 AS y0 FROM`,
      `(SELECT *, greatest(1, CAST(floor((e - w) / (1.5 * dx)) AS BIGINT)) AS nx, greatest(1, CAST(floor((n - s) / (sqrt(3) * dy)) AS BIGINT)) AS ny FROM (${frame}))`,
    ].join(' ');
    const center = `(SELECT *, x0 + i * 1.5 * dx AS cx, y0 + j * sqrt(3) * dy + (i % 2) * sqrt(3) / 2 * dy AS cy FROM (SELECT *, unnest(range(nx)) AS i FROM (SELECT *, unnest(range(ny)) AS j FROM (${cells}))))`;
    // Six corners, then the first again: cos(360°) is not exactly 1, and a ring must close
    const corners = 'list_transform(range(6), k -> ST_Point(cx + dx * cos(radians(60 * k)), cy + dy * sin(radians(60 * k))))';
    return `SELECT ST_MakePolygon(ST_MakeLine(list_append(${corners}, ST_Point(cx + dx, cy)))) AS geom FROM ${center}`;
  }
  const point = shape === 'point';
  const cells = [
    `SELECT *, w + ((e - w) - (nx - ${point ? 1 : 0}) * dx) / 2 AS x0, s + ((n - s) - (ny - ${point ? 1 : 0}) * dy) / 2 AS y0 FROM`,
    `(SELECT *, greatest(1, CAST(floor((e - w) / dx) AS BIGINT) + ${point ? 1 : 0}) AS nx, greatest(1, CAST(floor((n - s) / dy) AS BIGINT) + ${point ? 1 : 0}) AS ny FROM (${frame}))`,
  ].join(' ');
  const each = `(SELECT *, unnest(range(nx)) AS i FROM (SELECT *, unnest(range(ny)) AS j FROM (${cells})))`;
  return point
    ? `SELECT ST_Point(x0 + i * dx, y0 + j * dy) AS geom FROM ${each}`
    : `SELECT ST_MakeEnvelope(x0 + i * dx, y0 + j * dy, x0 + (i + 1) * dx, y0 + (j + 1) * dy) AS geom FROM ${each}`;
}


// --- choropleths ------------------------------------------------------------------------------

const CHOROPLETH_PARAMS: ParamDef[] = [
  { name: 'geography', label: 'Boundaries', kind: 'menu', default: 'us-states', options: [
    { value: 'us-states', label: 'US states' }, { value: 'world-countries', label: 'World countries' },
    { value: 'ca-provinces', label: 'Canadian provinces' },
  ] },
  { name: 'joinKey', label: 'Join key', kind: 'column', default: 'name', of: 'in', help: 'The column naming each row\'s place.' },
  { name: 'geoKey', label: 'Key is', kind: 'menu', default: 'auto', options: [
    { value: 'auto', label: 'Detect' }, { value: 'name', label: 'Name' }, { value: 'abbrev', label: 'Abbreviation / code' },
    { value: 'fips', label: 'FIPS code (US)' }, { value: 'iso2', label: 'ISO alpha-2' }, { value: 'iso3', label: 'ISO alpha-3' },
  ] },
];

// Ramps the editor registers (its d3 continuous schemes)
const CHOROPLETH_RAMPS = [
  'viridis', 'magma', 'inferno', 'plasma', 'cividis', 'turbo', 'spectral', 'blues', 'greens', 'reds', 'oranges',
  'purples', 'greys', 'OrangeRed', 'RedYellowBlue', 'RedBlue', 'BlueGreen', 'GreenBlue',
].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1).replace(/([A-Z])/g, ' $1') }));

const safeName = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

/** The join as engine code: the boundaries fetched, the rows matched to them by key. */
function choroplethJoinNode(ctx: LowerCtx, id: string): GraphNode {
  const options = JSON.stringify({ geography: ctx.str('geography'), joinKey: ctx.str('joinKey'), geoKey: ctx.str('geoKey') });
  return { id, type: 'js', input: ctx.input('in'), code: `return await utils.choroplethJoin(d, ${options})` };
}

export const GIS_OPERATORS: OpDef[] = [
  // --- features from parameters ---------------------------------------------------------
  {
    type: 'features', label: 'Features', category: 'geometry',
    description: 'GeoJSON written into the node (a FeatureCollection, a Feature or a bare geometry) or WKT, as a table of features. What a drawing tool writes.',
    inputs: [], outputs: [out()],
    params: [{ name: 'geojson', label: 'GeoJSON', kind: 'code', language: 'geometry', default: '{"type":"FeatureCollection","features":[]}' }],
    lower(ctx) {
      const text = ctx.str('geojson').trim();
      let parsed: { type?: string; features?: unknown[]; geometry?: unknown; properties?: Record<string, unknown> } | undefined;
      if (text.startsWith('{')) {
        try { parsed = JSON.parse(text); } catch { ctx.error('GeoJSON does not parse'); }
      }
      if (!parsed) return one(ctx, `SELECT ST_GeomFromText(${str(text)}) AS geom`, []);
      const list = (parsed.type === 'FeatureCollection' ? parsed.features ?? []
        : parsed.type === 'Feature' ? [parsed] : [{ type: 'Feature', geometry: parsed, properties: {} }]) as { geometry?: unknown; properties?: Record<string, unknown> | null }[];
      const rows = list.filter((f) => f?.geometry).map((f) => {
        const props = Object.entries(f.properties ?? {}).filter(([k]) => k !== 'geom').map(([k, v]) => `${literal(v)} AS ${q(k)}`);
        return `SELECT ST_GeomFromGeoJSON(${str(JSON.stringify(f.geometry))}) AS geom${props.length ? `, ${props.join(', ')}` : ''}`;
      });
      return one(ctx, rows.length ? rows.join(' UNION ALL BY NAME ') : 'SELECT NULL::GEOMETRY AS geom WHERE false', []);
    },
  },
  {
    type: 'point', label: 'Point', category: 'geometry',
    description: 'One point feature at a longitude and latitude, which numbers can drive.',
    inputs: [], outputs: [out()],
    params: [
      { name: 'lng', label: 'Longitude', kind: 'float', default: 0, min: -180, max: 180, step: 0.001, port: true },
      { name: 'lat', label: 'Latitude', kind: 'float', default: 0, min: -90, max: 90, step: 0.001, port: true },
      properties,
    ],
    lower(ctx) {
      const items = [`ST_Point(${ctx.bind('lng')}, ${ctx.bind('lat')}) AS geom`, ...propertyItems(ctx, ctx.str('properties'))];
      return one(ctx, `SELECT ${items.join(', ')}`, []);
    },
  },
  {
    type: 'rectangle', label: 'Rectangle', category: 'geometry',
    description: 'One rectangle feature of a width and height on the ground, centered on a point.',
    inputs: [], outputs: [out()],
    params: [
      { name: 'lng', label: 'Longitude', kind: 'float', default: 0, min: -180, max: 180, step: 0.001, port: true },
      { name: 'lat', label: 'Latitude', kind: 'float', default: 0, min: -90, max: 90, step: 0.001, port: true },
      { name: 'width', label: 'Width', kind: 'float', default: 1, min: 0, max: 1000, step: 0.1, port: true },
      { name: 'height', label: 'Height', kind: 'float', default: 1, min: 0, max: 1000, step: 0.1, port: true },
      units(), properties,
    ],
    lower(ctx) {
      const lng = ctx.bind('lng');
      const lat = ctx.bind('lat');
      const hy = `(${meters(ctx, 'height')} / 2 / ${mLat(lat)})`;
      const hx = `(${meters(ctx, 'width')} / 2 / ${mLng(lat)})`;
      const items = [`ST_MakeEnvelope(${lng} - ${hx}, ${lat} - ${hy}, ${lng} + ${hx}, ${lat} + ${hy}) AS geom`, ...propertyItems(ctx, ctx.str('properties'))];
      return one(ctx, `SELECT ${items.join(', ')}`, []);
    },
  },
  {
    type: 'geo-grid', label: 'Grid Features', category: 'geometry',
    description: 'Hexagons, squares or points of one cell size covering a bounding box, as turf.hexGrid, squareGrid and pointGrid make them. Join features to it to bin them.',
    inputs: [], outputs: [out()],
    params: [
      { name: 'shape', label: 'Cells', kind: 'menu', default: 'hex', options: [{ value: 'hex', label: 'Hexagons' }, { value: 'square', label: 'Squares' }, { value: 'point', label: 'Points' }] },
      { name: 'cellSize', label: 'Cell size', kind: 'float', default: 1, min: 0.001, max: 1000, step: 0.1, port: true },
      units(),
      { name: 'west', label: 'West', kind: 'float', default: -74.05, min: -180, max: 180, step: 0.01, port: true, folder: 'Bounds' },
      { name: 'south', label: 'South', kind: 'float', default: 40.68, min: -90, max: 90, step: 0.01, port: true, folder: 'Bounds' },
      { name: 'east', label: 'East', kind: 'float', default: -73.9, min: -180, max: 180, step: 0.01, port: true, folder: 'Bounds' },
      { name: 'north', label: 'North', kind: 'float', default: 40.82, min: -90, max: 90, step: 0.01, port: true, folder: 'Bounds' },
    ],
    lower: (ctx) => one(ctx, gridSql(ctx), []),
  },

  // --- per-feature geometry -------------------------------------------------------------
  {
    type: 'buffer', label: 'Buffer', category: 'geometry',
    description: 'Each feature grown by a distance on the ground (shrunk, for a negative one), as turf.buffer.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'radius', label: 'Radius', kind: 'float', default: 1, min: -100, max: 100, step: 0.1, port: true },
      units(),
      { name: 'steps', label: 'Segments per quarter circle', kind: 'int', default: 8, min: 1, max: 64, step: 1 },
    ],
    lower(ctx) {
      const r = meters(ctx, 'radius');
      const steps = Math.max(1, Math.round(ctx.num('steps')));
      // With x scaled by __k, a degree is the same distance both ways and a circle is round
      const buffered = `ST_Affine(ST_Buffer(ST_Affine(geom, __k, 0, 0, 1, 0, 0), ${r} / __m, ${steps}), 1.0 / __k, 0, 0, 1, 0, 0)`;
      const frame = `SELECT *, ${mLng('__lat')} / ${mLat('__lat')} AS __k, ${mLat('__lat')} AS __m FROM (SELECT *, ST_Y(ST_Centroid(geom)) AS __lat FROM {{input0}})`;
      return one(ctx, `SELECT * EXCLUDE (__lat, __k, __m) REPLACE (${buffered} AS geom) FROM (${frame})`);
    },
  },
  {
    type: 'centroid', label: 'Centroid', category: 'geometry',
    description: "Each feature as a point at its center of mass, keeping its properties. turf.centroid averages a feature's vertices instead; the two differ for uneven shapes.",
    inputs: [features()], outputs: [out()], params: [],
    lower: (ctx) => one(ctx, replaceGeom('ST_Centroid(geom)')),
  },
  {
    type: 'simplify', label: 'Simplify', category: 'geometry',
    description: 'Fewer vertices: Douglas–Peucker with a tolerance in degrees, as turf.simplify.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'tolerance', label: 'Tolerance (degrees)', kind: 'float', default: 0.01, min: 0, max: 1, step: 0.001, port: true },
      { name: 'preserveTopology', label: 'Keep shapes valid', kind: 'toggle', default: true },
    ],
    lower: (ctx) => one(ctx, replaceGeom(`${ctx.bool('preserveTopology') ? 'ST_SimplifyPreserveTopology' : 'ST_Simplify'}(geom, ${ctx.bind('tolerance')})`)),
  },
  {
    type: 'transform', label: 'Transform', category: 'geometry',
    description: 'Each feature rotated (degrees clockwise), scaled about its centroid or bounding-box center, then moved a distance along a compass bearing, as turf.transformRotate, transformScale and transformTranslate.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'rotate', label: 'Rotate', kind: 'float', default: 0, min: -360, max: 360, step: 1, port: true },
      { name: 'scale', label: 'Scale', kind: 'float', default: 1, min: 0, max: 10, step: 0.01, port: true },
      { name: 'distance', label: 'Move', kind: 'float', default: 0, min: 0, max: 1000, step: 0.1, port: true },
      { name: 'direction', label: 'Bearing', kind: 'float', default: 0, min: -360, max: 360, step: 1, port: true },
      units(),
      { name: 'origin', label: 'About', kind: 'menu', default: 'centroid', options: [{ value: 'centroid', label: 'Centroid' }, { value: 'center', label: 'Bounding-box center' }] },
    ],
    lower(ctx) {
      const center = ctx.str('origin') === 'center';
      const x0 = center ? '(ST_XMin(geom) + ST_XMax(geom)) / 2' : 'ST_X(ST_Centroid(geom))';
      const y0 = center ? '(ST_YMin(geom) + ST_YMax(geom)) / 2' : 'ST_Y(ST_Centroid(geom))';
      const r = `radians(${ctx.bind('rotate')})`;
      const s = ctx.bind('scale');
      const d = meters(ctx, 'distance');
      const dir = `radians(${ctx.bind('direction')})`;
      // In a frame where x is scaled by __c to the length of a degree of latitude, rotate
      // clockwise and scale about (x0, y0), then translate: one affine map per feature.
      const frame = `SELECT *, ${mLng('__y0')} / ${mLat('__y0')} AS __c, ${mLat('__y0')} AS __my, ${mLng('__y0')} AS __mx FROM (SELECT *, ${x0} AS __x0, ${y0} AS __y0 FROM {{input0}})`;
      const coefficients = [
        `${s} * cos(${r}) AS __a`, `${s} * sin(${r}) / __c AS __b`, `-${s} * __c * sin(${r}) AS __d`, `${s} * cos(${r}) AS __e`,
        `${d} * sin(${dir}) / __mx AS __dx`, `${d} * cos(${dir}) / __my AS __dy`,
      ].join(', ');
      const map = 'ST_Affine(geom, __a, __b, __d, __e, __x0 - __a * __x0 - __b * __y0 + __dx, __y0 - __d * __x0 - __e * __y0 + __dy)';
      return one(ctx, `SELECT * EXCLUDE (__x0, __y0, __c, __my, __mx, __a, __b, __d, __e, __dx, __dy) REPLACE (${map} AS geom) FROM (SELECT *, ${coefficients} FROM (${frame}))`);
    },
  },
  {
    type: 'reproject', label: 'Reproject', category: 'geometry',
    description: 'Coordinates from one CRS to another, as PROJ names them (EPSG:4326 is lng/lat).',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'from', label: 'From', kind: 'string', default: 'EPSG:4326' },
      { name: 'to', label: 'To', kind: 'string', default: 'EPSG:3857' },
    ],
    lower(ctx) {
      if (ctx.str('from') === ctx.str('to')) return one(ctx, 'SELECT * FROM {{input0}}');
      return one(ctx, replaceGeom(`ST_Transform(geom, ${str(ctx.str('from'))}, ${str(ctx.str('to'))}, always_xy := true)`));
    },
  },
  {
    type: 'line-to-polygon', label: 'Line to Polygon', category: 'geometry',
    description: 'Each line as the polygon it outlines, closed if it is open, as turf.lineToPolygon. Other features pass through.',
    inputs: [features()], outputs: [out()], params: [],
    lower(ctx) {
      const closed = "CASE WHEN ST_IsClosed(geom) THEN geom ELSE ST_MakeLine(list_append(list_transform(ST_Dump(ST_Points(geom)), p -> p.geom), ST_StartPoint(geom))) END";
      return one(ctx, replaceGeom(`CASE WHEN ST_GeometryType(geom) = 'LINESTRING' AND ST_NPoints(geom) >= 3 THEN ST_MakePolygon(${closed}) ELSE geom END`));
    },
  },
  {
    type: 'polygon-to-line', label: 'Polygon to Line', category: 'geometry',
    description: 'Each polygon as its outline, holes included, as turf.polygonToLine. Other features pass through.',
    inputs: [features()], outputs: [out()], params: [],
    lower: (ctx) => one(ctx, replaceGeom('CASE WHEN ST_Dimension(geom) = 2 THEN ST_Boundary(geom) ELSE geom END')),
  },
  {
    type: 'explode', label: 'Explode', category: 'geometry',
    description: 'Each multi-part feature as one row per part (turf.flatten), or every feature as one point row per vertex (turf.explode). Properties are copied to every row.',
    inputs: [features()], outputs: [out()],
    params: [{ name: 'mode', label: 'Into', kind: 'menu', default: 'parts', options: [{ value: 'parts', label: 'Parts' }, { value: 'vertices', label: 'Vertices' }] }],
    lower(ctx) {
      const of = ctx.str('mode') === 'vertices' ? 'ST_Points(geom)' : 'geom';
      return one(ctx, `SELECT * EXCLUDE (__p) REPLACE (__p.geom AS geom) FROM (SELECT *, unnest(ST_Dump(${of})) AS __p FROM {{input0}})`);
    },
  },
  {
    type: 'along', label: 'Along', category: 'geometry',
    description: 'The point a distance along each line, as turf.along; past the end is the end. Lines only.',
    inputs: [features()], outputs: [out()],
    params: [{ name: 'distance', label: 'Distance', kind: 'float', default: 1, min: 0, max: 10000, step: 0.1, port: true }, units()],
    lower(ctx) {
      const f = `least(1.0, greatest(0.0, ${meters(ctx, 'distance')} / ST_Length_Spheroid(ST_FlipCoordinates(geom))))`;
      return one(ctx, replaceGeom(`ST_LineInterpolatePoint(geom, ${f})`, "ST_GeometryType(geom) = 'LINESTRING'"));
    },
  },
  {
    type: 'line-slice', label: 'Line Slice', category: 'geometry',
    description: 'The part of each line between two distances from its start, as turf.lineSliceAlong. Lines only.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'start', label: 'Start', kind: 'float', default: 0, min: 0, max: 10000, step: 0.1, port: true },
      { name: 'stop', label: 'Stop', kind: 'float', default: 1, min: 0, max: 10000, step: 0.1, port: true },
      units(),
    ],
    lower(ctx) {
      const at = (p: string) => `least(1.0, greatest(0.0, ${meters(ctx, p)} / ST_Length_Spheroid(ST_FlipCoordinates(geom))))`;
      return one(ctx, replaceGeom(`ST_LineSubstring(geom, least(${at('start')}, ${at('stop')}), greatest(${at('start')}, ${at('stop')}))`, "ST_GeometryType(geom) = 'LINESTRING'"));
    },
  },
  {
    type: 'area', label: 'Area', category: 'geometry',
    description: 'A column with each feature’s area on the spheroid, as turf.area; 0 for points and lines.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'units', label: 'Units', kind: 'menu', default: 'squareMeters', options: [
        { value: 'squareMeters', label: 'Square meters' }, { value: 'squareKilometers', label: 'Square kilometers' },
        { value: 'squareMiles', label: 'Square miles' }, { value: 'hectares', label: 'Hectares' }, { value: 'acres', label: 'Acres' },
      ] },
      { name: 'column', label: 'Column', kind: 'string', default: 'area' },
    ],
    lower(ctx) {
      const per: Record<string, number> = { squareMeters: 1, squareKilometers: 1e6, squareMiles: 2589988.110336, hectares: 1e4, acres: 4046.8564224 };
      const div = per[ctx.str('units')] ?? 1;
      return one(ctx, `SELECT *, ST_Area_Spheroid(ST_FlipCoordinates(geom)) / ${div} AS ${q(ctx.str('column') || 'area')} FROM {{input0}}`);
    },
  },
  {
    type: 'length', label: 'Length', category: 'geometry',
    description: 'A column with each feature’s length on the spheroid (a polygon’s perimeter), as turf.length.',
    inputs: [features()], outputs: [out()],
    params: [units(), { name: 'column', label: 'Column', kind: 'string', default: 'length' }],
    lower(ctx) {
      const per = METERS[ctx.str('units')] ?? 1000;
      return one(ctx, `SELECT *, (${groundLength('geom')}) / ${per} AS ${q(ctx.str('column') || 'length')} FROM {{input0}}`);
    },
  },

  // --- features together ----------------------------------------------------------------
  {
    type: 'dissolve', label: 'Dissolve', category: 'geometry',
    description: 'Polygons merged: all of them, or those sharing a value of a column (turf.dissolve, turf.union). With separate parts on, each connected piece is its own row.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'by', label: 'Group by', kind: 'column', default: '', of: 'in' },
      { name: 'split', label: 'Separate parts', kind: 'toggle', default: false },
    ],
    lower(ctx) {
      const by = ctx.str('by');
      const polygons = "FROM {{input0}} WHERE ST_Dimension(geom) = 2";
      const merged = by ? `SELECT ${q(by)}, ST_Union_Agg(geom) AS geom ${polygons} GROUP BY ${q(by)}` : `SELECT ST_Union_Agg(geom) AS geom ${polygons}`;
      const query = ctx.bool('split')
        ? `SELECT * EXCLUDE (__p) REPLACE (__p.geom AS geom) FROM (SELECT *, unnest(ST_Dump(geom)) AS __p FROM (${merged}) WHERE geom IS NOT NULL)`
        : `SELECT * FROM (${merged}) WHERE geom IS NOT NULL`;
      return one(ctx, query);
    },
  },
  {
    type: 'convex-hull', label: 'Convex Hull', category: 'geometry',
    description: 'One polygon enclosing every feature, as turf.convex.',
    inputs: [features()], outputs: [out()], params: [],
    lower: (ctx) => one(ctx, 'SELECT ST_ConvexHull(ST_Collect(list(geom))) AS geom FROM {{input0}} HAVING count(*) > 0'),
  },
  {
    type: 'voronoi', label: 'Voronoi', category: 'geometry',
    description: "One cell per point, the area nearer it than any other, clipped to the points' bounding box and carrying the point's properties, as turf.voronoi.",
    inputs: [features()], outputs: [out()], params: [],
    lower(ctx) {
      const points = "SELECT * FROM {{input0}} WHERE ST_GeometryType(geom) = 'POINT'";
      const cells = `SELECT unnest(ST_Dump(ST_VoronoiDiagram(ST_Collect(list(geom))))).geom AS __cell, ST_Envelope(ST_Collect(list(geom))) AS __box FROM (${points})`;
      return one(ctx, `SELECT p.* REPLACE (ST_Intersection(c.__cell, c.__box) AS geom) FROM (${points}) AS p JOIN (${cells}) AS c ON ST_Intersects(c.__cell, p.geom) QUALIFY row_number() OVER (PARTITION BY c.__cell ORDER BY ST_X(p.geom), ST_Y(p.geom)) = 1`);
    },
  },
  {
    type: 'clip', label: 'Clip', category: 'geometry',
    description: 'Each feature cut by a mask (the union of its features): the part inside, as turf.intersect and a clip do, or the part outside, as turf.difference does. Features left with nothing are dropped. turf takes the first feature of each side; this cuts every feature by the whole mask.',
    inputs: [features(), features('mask', 'mask')], outputs: [out()],
    params: [{ name: 'keep', label: 'Keep', kind: 'menu', default: 'inside', options: [{ value: 'inside', label: 'Inside the mask' }, { value: 'outside', label: 'Outside the mask' }] }],
    lower(ctx) {
      const mask = "(SELECT coalesce(ST_Union_Agg(geom), ST_GeomFromText('GEOMETRYCOLLECTION EMPTY')) AS __m FROM {{input1}})";
      const cut = ctx.str('keep') === 'outside' ? 'ST_Difference(geom, __m)' : 'ST_Intersection(geom, __m)';
      const query = `SELECT * FROM (SELECT * EXCLUDE (__m) REPLACE (${cut} AS geom) FROM {{input0}} CROSS JOIN ${mask}) WHERE NOT ST_IsEmpty(geom)`;
      return one(ctx, query, [ctx.input('in'), ctx.input('mask')]);
    },
  },
  {
    type: 'spatial-join', label: 'Spatial Join', category: 'geometry',
    description: "Each feature with the columns of a feature of the other table it intersects, lies within, or contains, as Noodles' spatial join: the first match, and a same-named column takes the match's value. Features with no match keep their own columns and nulls.",
    inputs: [features(), features('join', 'join')], outputs: [out()],
    params: [
      { name: 'predicate', label: 'Where it', kind: 'menu', default: 'intersects', options: [
        { value: 'intersects', label: 'Intersects' }, { value: 'within', label: 'Lies within' }, { value: 'contains', label: 'Contains' },
      ] },
      { name: 'prefix', label: 'Joined prefix', kind: 'string', default: '', help: 'Empty: a same-named column takes the joined value.' },
    ],
    lower(ctx) {
      const prefix = ctx.str('prefix');
      const predicate = ctx.str('predicate') as 'intersects' | 'within' | 'contains';
      return {
        nodes: [{ id: ctx.id, type: 'join', input: ctx.input('in'), right: ctx.input('join'), how: 'left', spatial: predicate, first: true, overwrite: prefix === '', prefix }],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'inside', label: 'Inside / Outside', category: 'geometry',
    description: 'Features split by whether they touch any feature of a second table (a point inside a polygon, on its edge included, as turf.booleanPointInPolygon): `inside` and `outside`.',
    inputs: [features(), features('polygons', 'polygons')], outputs: [out('inside'), out('outside')],
    params: [],
    lower(ctx) {
      const of = (how: 'semi' | 'anti', id: string): GraphNode => ({ id, type: 'join', input: ctx.input('in'), right: ctx.input('polygons'), how, spatial: 'intersects' });
      return { nodes: [of('semi', ctx.id), of('anti', `${ctx.id}#outside`)], outputs: { inside: ctx.id, outside: `${ctx.id}#outside` } };
    },
  },
  {
    type: 'aggregate-within', label: 'Aggregate Within', category: 'geometry',
    description: 'Each polygon with a count, sum, mean, min or max of the points inside it, as a new column `<operation>_<column>` (0 for none).',
    inputs: [features('in', 'polygons'), features('points', 'points')], outputs: [out()],
    params: [
      { name: 'operation', label: 'Operation', kind: 'menu', default: 'count', options: ['count', 'sum', 'mean', 'min', 'max'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
      { name: 'column', label: 'Column', kind: 'column', default: '', of: 'points', when: { param: 'operation', is: ['sum', 'mean', 'min', 'max'] } },
      { name: 'as', label: 'Name', kind: 'string', default: '', help: 'Defaults to <operation>_<column>.' },
    ],
    lower(ctx) {
      const op = ctx.str('operation');
      const column = ctx.str('column');
      if (op !== 'count' && !column) ctx.error(`Aggregate Within needs a column to ${op}`);
      const fn = op === 'count' ? 'count(*)' : `${op === 'mean' ? 'avg' : op}(TRY_CAST(p.${q(column)} AS DOUBLE))`;
      const name = ctx.str('as') || `${op}_${column || 'points'}`;
      const value = `(SELECT coalesce(${fn}, 0) FROM {{input1}} AS p WHERE ST_Intersects(t.geom, p.geom))`;
      return one(ctx, `SELECT t.*, CAST(${value} AS DOUBLE) AS ${q(name)} FROM {{input0}} AS t`, [ctx.input('in'), ctx.input('points')]);
    },
  },
  {
    type: 'nearest', label: 'Nearest', category: 'geometry',
    description: 'The feature nearest a point, with its distance in kilometers in `distanceToPoint`, as turf.nearestPoint.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'lng', label: 'Longitude', kind: 'float', default: 0, min: -180, max: 180, step: 0.001, port: true },
      { name: 'lat', label: 'Latitude', kind: 'float', default: 0, min: -90, max: 90, step: 0.001, port: true },
    ],
    lower(ctx) {
      const distance = `ST_Distance_Sphere(ST_FlipCoordinates(geom), ST_Point(${ctx.bind('lat')}, ${ctx.bind('lng')})) / 1000.0`;
      return one(ctx, `SELECT *, ${distance} AS "distanceToPoint" FROM {{input0}} ORDER BY "distanceToPoint" LIMIT 1`);
    },
  },

  // --- turf, run by the engine ----------------------------------------------------------
  {
    type: 'cells', label: 'Grid Cells', category: 'geometry',
    description: 'Rows with a grid cell id (H3, S2, A5, geohash or quadkey) as polygon features of their cells, keeping their columns; a column of H3 id lists draws each list’s merged outline. What deck’s cell layers draw. Runs in the engine.',
    inputs: [table()], outputs: [out()],
    params: [
      { name: 'kind', label: 'Grid', kind: 'menu', default: 'h3', options: [
        { value: 'h3', label: 'H3' }, { value: 'h3-cluster', label: 'H3 cluster (a list per row)' }, { value: 's2', label: 'S2' },
        { value: 'a5', label: 'A5' }, { value: 'geohash', label: 'Geohash' }, { value: 'quadkey', label: 'Quadkey' },
      ] },
      { name: 'column', label: 'Cell id', kind: 'column', default: 'hex', of: 'in' },
    ],
    lower(ctx) {
      const kind = ctx.str('kind');
      const column = ctx.str('column');
      if (!column) ctx.error('Grid Cells needs a cell id column');
      const geometry = kind === 'h3-cluster'
        ? "{ type: 'MultiPolygon', coordinates: utils.h3Cluster(Array.from(id ?? [])) }"
        : `{ type: 'Polygon', coordinates: [utils.cellRing(${JSON.stringify(kind)}, id)] }`;
      const code = [
        `return { type: 'FeatureCollection', features: d.map(({ ${JSON.stringify(column)}: id, ...properties }) => ({`,
        `  type: 'Feature', properties, geometry: ${geometry},`,
        '})) }',
      ].join('\n');
      return { nodes: [{ id: ctx.id, type: 'js', input: ctx.input('in'), code }], outputs: { out: ctx.id } };
    },
  },

  {
    type: 'choropleth-join', label: 'Choropleth Join', category: 'geometry',
    description: "Rows joined onto boundaries by a key: US states, world countries or Canadian provinces. A row per boundary with its geometry, its name and codes (`name`, `abbrev`, `fips`, `iso2`, `iso3`) and the matching row's columns; a boundary no row matches keeps only its own. The key's kind (a name, an abbreviation, a FIPS or ISO code) is detected from the values when left on Auto. Runs in the engine; the boundaries are fetched once.",
    inputs: [table('in', 'data')], outputs: [out()],
    params: [...CHOROPLETH_PARAMS],
    lower: (ctx) => ({
      nodes: [choroplethJoinNode(ctx, ctx.id)],
      outputs: { out: ctx.id },
    }),
  },
  {
    type: 'choropleth', label: 'Choropleth Layer', category: 'layer',
    description: "Rows joined onto boundaries (as Choropleth Join does) and filled by a color ramp over a column, its domain the column's minimum to maximum; a boundary with no value is gray.",
    inputs: [table('in', 'data')], outputs: [{ name: 'out', type: 'layer' }],
    params: [
      ...CHOROPLETH_PARAMS,
      { name: 'valueColumn', label: 'Value', kind: 'column', default: 'value', of: 'in', columnType: 'num', folder: 'Channels' },
      { name: 'colorScheme', label: 'Ramp', kind: 'menu', default: 'viridis', options: CHOROPLETH_RAMPS, folder: 'Style' },
      { name: 'stroked', label: 'Outline', kind: 'toggle', default: true, folder: 'Style' },
      { name: 'lineColor', label: 'Outline color', kind: 'color', default: [0, 0, 0], folder: 'Style' },
      { name: 'lineWidth', label: 'Outline width (px)', kind: 'float', default: 1, min: 0, max: 20, step: 0.5, bind: 'prop', folder: 'Style' },
      { name: 'opacity', label: 'Opacity', kind: 'float', default: 0.85, min: 0, max: 1, step: 0.01, bind: 'prop', folder: 'Style' },
    ],
    lower(ctx) {
      const join = `${ctx.id}#join`;
      const value = q(ctx.str('valueColumn') || 'value');
      // The value's place between the column's minimum and maximum, and whether it has one
      const scaled = `${ctx.id}#scaled`;
      const query = [
        'SELECT *,',
        `  coalesce((CAST(${value} AS DOUBLE) - min(${value}) OVER ()) / nullif(max(${value}) OVER () - min(${value}) OVER (), 0), 0.0) AS __choropleth_t,`,
        `  CASE WHEN ${value} IS NULL THEN 0.0 ELSE 1.0 END AS __choropleth_has`,
        'FROM {{input0}}',
      ].join('\n');
      const colors = `${ctx.id}#color`;
      const name = `${safeName(ctx.id)}_color`;
      return {
        nodes: [
          choroplethJoinNode(ctx, join),
          { id: scaled, type: 'sql', inputs: [join], query },
          {
            id: colors, type: 'wrangle', input: scaled,
            body: `@${name} = __choropleth_has > 0.5 ? ramp(__choropleth_t) : [0.706, 0.706, 0.706];`,
            ramp: ctx.str('colorScheme') as never,
          },
          {
            id: ctx.id, type: 'layer', kind: 'polygon', input: colors,
            channels: { position: 'geom', color: name },
            props: {
              filled: true, stroked: ctx.bool('stroked'), lineColor: ctx.bindColor('lineColor'),
              lineWidthScale: ctx.bind('lineWidth'), lineWidthUnits: 'pixels', lineWidthMinPixels: 0,
              opacity: ctx.bind('opacity'),
            },
          },
        ],
        outputs: { out: ctx.id },
      };
    },
  },
  {
    type: 'cluster', label: 'Cluster', category: 'geometry',
    description: 'Points labeled with a `cluster` number by k-means (turf.clustersKmeans) or by density (turf.clustersDbscan, with `dbscan` noise/core/edge). Runs turf in the engine.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'method', label: 'Method', kind: 'menu', default: 'kmeans', options: [{ value: 'kmeans', label: 'K-means' }, { value: 'dbscan', label: 'DBSCAN' }] },
      { name: 'clusters', label: 'Clusters', kind: 'int', default: 5, min: 1, max: 100, step: 1, when: { param: 'method', is: ['kmeans'] } },
      { name: 'maxDistance', label: 'Max distance', kind: 'float', default: 1, min: 0, max: 1000, step: 0.1, when: { param: 'method', is: ['dbscan'] } },
      { ...units(), when: { param: 'method', is: ['dbscan'] } },
      { name: 'minPoints', label: 'Min points', kind: 'int', default: 3, min: 1, max: 100, step: 1, when: { param: 'method', is: ['dbscan'] } },
    ],
    lower(ctx) {
      const points = "d.features.filter(f => f.geometry && f.geometry.type === 'Point')";
      if (ctx.str('method') === 'dbscan') {
        return turfTable(ctx, `return turf.clustersDbscan(turf.featureCollection(${points}), ${ctx.num('maxDistance')}, { units: ${JSON.stringify(ctx.str('units'))}, minPoints: ${Math.round(ctx.num('minPoints'))} })`);
      }
      return turfTable(ctx, `return turf.clustersKmeans(turf.featureCollection(${points}), { numberOfClusters: ${Math.round(ctx.num('clusters'))} })`);
    },
  },
  {
    type: 'interpolate', label: 'Interpolate', category: 'geometry',
    description: 'A grid of points valued by inverse-distance weighting of a column of the input points, as turf.interpolate. Runs turf in the engine.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'property', label: 'Column', kind: 'column', default: 'value', of: 'in', columnType: 'num' },
      { name: 'cellSize', label: 'Cell size', kind: 'float', default: 1, min: 0.01, max: 1000, step: 0.1 },
      units(),
      { name: 'weight', label: 'Weight', kind: 'float', default: 2, min: 0.1, max: 10, step: 0.1 },
      { name: 'gridType', label: 'Cells', kind: 'menu', default: 'point', options: [
        { value: 'point', label: 'Points' }, { value: 'square', label: 'Squares' }, { value: 'hex', label: 'Hexagons' }, { value: 'triangle', label: 'Triangles' },
      ] },
    ],
    lower: (ctx) => turfTable(ctx, `return turf.interpolate(d, ${ctx.num('cellSize')}, ${JSON.stringify({ gridType: ctx.str('gridType'), property: ctx.str('property'), units: ctx.str('units'), weight: ctx.num('weight') })})`),
  },
  {
    type: 'isolines', label: 'Isolines', category: 'geometry',
    description: 'Contour lines through a grid of points at each break value of a column, as turf.isolines (the input must be a point grid, such as Interpolate makes). Runs turf in the engine.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'property', label: 'Column', kind: 'column', default: 'elevation', of: 'in', columnType: 'num' },
      { name: 'breaks', label: 'Breaks', kind: 'string', default: '100, 200, 500, 1000, 2000', help: 'Comma-separated values.' },
    ],
    lower(ctx) {
      const breaks = ctx.str('breaks').split(',').map((b) => Number(b.trim())).filter((b) => Number.isFinite(b));
      if (breaks.length === 0) ctx.error('Isolines needs at least one break');
      return turfTable(ctx, `return turf.isolines(d, ${JSON.stringify(breaks)}, { zProperty: ${JSON.stringify(ctx.str('property'))} })`);
    },
  },
  {
    type: 'tin', label: 'TIN', category: 'geometry',
    description: 'Triangles joining the input points (Delaunay), as turf.tin; with a column, each triangle has its corners’ values as a, b and c. Runs turf in the engine.',
    inputs: [features()], outputs: [out()],
    params: [{ name: 'property', label: 'Column', kind: 'column', default: '', of: 'in', columnType: 'num' }],
    lower: (ctx) => turfTable(ctx, `return turf.tin(turf.featureCollection(d.features.filter(f => f.geometry && f.geometry.type === 'Point')), ${ctx.str('property') ? JSON.stringify(ctx.str('property')) : 'undefined'})`),
  },
  {
    type: 'smooth-lines', label: 'Smooth Lines', category: 'geometry',
    description: 'Lines with their corners rounded: a moving average of each vertex and its neighbors (gaussian or boxcar), or a spline through the vertices (Catmull–Rom, cardinal, basis, natural, monotone, or a fixed turn radius). Other features pass through. Runs in the engine.',
    inputs: [features()], outputs: [out()],
    params: [
      { name: 'method', label: 'Method', kind: 'menu', default: 'gaussian', options: [
        { value: 'gaussian', label: 'Gaussian average' }, { value: 'boxcar', label: 'Boxcar average' },
        { value: 'linear', label: 'Linear' }, { value: 'catmull-rom', label: 'Catmull–Rom' }, { value: 'cardinal', label: 'Cardinal' },
        { value: 'basis', label: 'Basis' }, { value: 'natural', label: 'Natural' }, { value: 'monotone-x', label: 'Monotone X' },
        { value: 'monotone-y', label: 'Monotone Y' }, { value: 'turn-radius', label: 'Turn radius' },
      ] },
      { name: 'windowSize', label: 'Window', kind: 'int', default: 5, min: 1, max: 99, step: 2, when: { param: 'method', is: ['gaussian', 'boxcar'] } },
      { name: 'samplesPerSegment', label: 'Samples per segment', kind: 'int', default: 12, min: 1, max: 64, step: 1, when: { param: 'method', is: ['linear', 'catmull-rom', 'cardinal', 'basis', 'natural', 'monotone-x', 'monotone-y', 'turn-radius'] } },
      { name: 'alpha', label: 'Alpha', kind: 'float', default: 0.5, min: 0, max: 1, step: 0.05, when: { param: 'method', is: ['catmull-rom'] } },
      { name: 'tension', label: 'Tension', kind: 'float', default: 0, min: 0, max: 1, step: 0.05, when: { param: 'method', is: ['cardinal'] } },
      { name: 'turnRadiusMeters', label: 'Turn radius (m)', kind: 'float', default: 250, min: 0, max: 10000, step: 10, when: { param: 'method', is: ['turn-radius'] } },
    ],
    lower(ctx) {
      const method = ctx.str('method');
      if (method === 'gaussian' || method === 'boxcar') {
        const size = Math.max(1, Math.round(ctx.num('windowSize')));
        // Noodles' Smooth: each vertex the weighted mean of the window around it
        const code = [
          `const radius = ${Math.floor(size / 2)}, sigma = ${size / 6}, gaussian = ${method === 'gaussian'}`,
          'const smooth = (coords) => coords.map((pt, i) => {',
          '  let x = 0, y = 0, w = 0',
          '  for (let j = Math.max(0, i - radius); j <= Math.min(coords.length - 1, i + radius); j++) {',
          '    const k = gaussian ? Math.exp(-0.5 * ((j - i) / sigma) ** 2) : 1',
          '    x += coords[j][0] * k; y += coords[j][1] * k; w += k',
          '  }',
          '  return [x / w, y / w, ...pt.slice(2)]',
          '})',
          'return turf.featureCollection(d.features.map(f => {',
          "  if (f.geometry?.type === 'LineString' && f.geometry.coordinates.length > 1) return { ...f, geometry: { ...f.geometry, coordinates: smooth(f.geometry.coordinates) } }",
          "  if (f.geometry?.type === 'MultiLineString') return { ...f, geometry: { ...f.geometry, coordinates: f.geometry.coordinates.map(smooth) } }",
          '  return f',
          '}))',
        ].join('\n');
        return turfTable(ctx, code);
      }
      const options = { method, samplesPerSegment: Math.round(ctx.num('samplesPerSegment')), alpha: ctx.num('alpha'), tension: ctx.num('tension'), turnRadiusMeters: ctx.num('turnRadiusMeters') };
      return turfTable(ctx, `return utils.interpolateGeoJsonLines(d, ${JSON.stringify(options)})`);
    },
  },
  {
    type: 'overpass', label: 'Overpass', category: 'data',
    description: 'OpenStreetMap features an Overpass QL query finds, as a table of features: tagged nodes as points, ways as lines or polygons, multipolygon relations. `{{bbox}}` in the query is the bounds as south,west,north,east. The engine fetches once per query; edit it to fetch again.',
    inputs: [], outputs: [out()],
    params: [
      { name: 'query', label: 'Query', kind: 'code', default: '[out:json][timeout:25];\n(\n  way["leisure"="park"]({{bbox}});\n  relation["leisure"="park"]({{bbox}});\n);\nout geom;' },
      { name: 'endpoint', label: 'Endpoint', kind: 'string', default: 'https://overpass.openstreetmap.fr/api/interpreter' },
      { name: 'west', label: 'West', kind: 'float', default: -74.05, min: -180, max: 180, step: 0.01, folder: 'Bounds' },
      { name: 'south', label: 'South', kind: 'float', default: 40.68, min: -90, max: 90, step: 0.01, folder: 'Bounds' },
      { name: 'east', label: 'East', kind: 'float', default: -73.9, min: -180, max: 180, step: 0.01, folder: 'Bounds' },
      { name: 'north', label: 'North', kind: 'float', default: 40.82, min: -90, max: 90, step: 0.01, folder: 'Bounds' },
    ],
    lower(ctx) {
      const bbox = [ctx.num('south'), ctx.num('west'), ctx.num('north'), ctx.num('east')].join(',');
      const query = ctx.str('query').replace(/\{\{bbox\}\}/g, bbox);
      const code = [
        `const res = await fetch(${JSON.stringify(ctx.str('endpoint'))}, { method: 'POST', body: ${JSON.stringify(query)}, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })`,
        'if (!res.ok) throw new Error(`Overpass API error: ${res.status} ${res.statusText}`)',
        'const osm = await res.json()',
        "if (osm.remark?.includes('timeout')) throw new Error('Overpass query timeout: try a smaller area or a simpler query')",
        'return utils.osmToGeoJson(osm)',
      ].join('\n');
      return { nodes: [{ id: ctx.id, type: 'js', code }], outputs: { out: ctx.id } };
    },
  },
];
