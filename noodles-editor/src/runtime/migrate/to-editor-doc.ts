// noodles.json (schema 18) -> the planner's EditorDoc.
//
// Noodles graphs pass JS rows between operators, and a layer's per-row values arrive as accessor
// functions built by AccessorOp, MapRange, ColorRamp and Math. The planner passes tables, and a
// layer reads attributes. So the conversion is mostly about accessors: every accessor-producing
// operator a layer reads becomes a row node (attribute, map-range, color-ramp) on the layer's
// data path, keeping its node id and position, and the layer's channel names the attribute it
// writes. Numbers on MapRange and ColorRamp stay parameters, so dragging one still rebinds
// instead of recompiling.
//
// This module is a frozen migration: it must not import operator classes, because those change
// and this conversion must not. Noodles' defaults are written out below for that reason, and
// because noodles.json stores only inputs that differ from them.

import { WebMercatorViewport } from '@math.gl/web-mercator'
import {
  type DocEdge,
  type DocNode,
  type EditorDoc,
  type ParamValue,
  parseExpr,
  type Timeline,
  type Track,
} from '@noodles.gl/planner'
import { hsl } from 'd3'
import { collapseToSubnet } from '../../editor/doc-ops'
import { migrateTimelineData } from '../../timeline/migrate-timeline'
import type { TimelineData } from '../../timeline/types'
import { colorToHex, hexToColor } from '../../utils/color'
import { DECK_OP_FOR, type DeckOp } from '../deck-ops'
import { GIS_CONVERSIONS, GisConversionError } from './gis-conversions'
import { OP_CATALOG } from './op-catalog'

export interface NoodlesNode {
  id: string
  type: string
  position?: { x: number; y: number }
  parentId?: string
  data?: { inputs?: Record<string, unknown>; locked?: boolean }
}

export interface NoodlesEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface NoodlesProject {
  version: number
  nodes: NoodlesNode[]
  edges: NoodlesEdge[]
  viewport?: unknown
  timeline?: unknown
  name?: string
  editorSettings?: unknown
  apiKeys?: unknown
}

export interface Migrated {
  doc: EditorDoc
  /** Inputs and nodes that had no equivalent and were dropped, for the user to review. */
  warnings: string[]
}

export class MigrationError extends Error {}

// ---------------------------------------------------------------------------
// Noodles defaults (schema 18), for the inputs this conversion reads
// ---------------------------------------------------------------------------

export const DEFAULTS: Record<string, Record<string, unknown>> = {
  ScatterplotLayerOp: {
    visible: true,
    opacity: 1,
    getFillColor: '#fff',
    getRadius: 20,
    radiusScale: 1,
    radiusUnits: 'pixels',
  },
  ArcLayerOp: {
    visible: true,
    opacity: 1,
    getSourceColor: '#fff',
    getTargetColor: '#fff',
    widthUnits: 'meters',
    getWidth: 1,
    getHeight: 1,
  },
  GeoJsonLayerOp: {
    visible: true,
    opacity: 1,
    pointType: 'circle',
    getPointRadius: 1,
    pointRadiusUnits: 'meters',
    pointRadiusScale: 1,
    getText: '',
    getTextSize: 32,
    getTextColor: '#000000',
    textSizeScale: 1,
    filled: true,
    getFillColor: '#006ac6',
    stroked: true,
    getLineColor: '#000000',
    getLineWidth: 1,
    lineWidthUnits: 'meters',
    lineWidthScale: 1,
    lineWidthMinPixels: 0,
    extruded: false,
    getElevation: 1000,
    elevationScale: 1,
  },
  HeatmapLayerOp: {
    visible: true,
    opacity: 1,
    getWeight: 1,
    aggregation: 'SUM',
    radiusPixels: 30,
    intensity: 1,
    threshold: 0.05,
  },
  HexagonLayerOp: {
    visible: true,
    opacity: 1,
    radius: 1000,
    getColorWeight: 1,
    colorAggregation: 'SUM',
    upperPercentile: 100,
    lowerPercentile: 0,
    extruded: false,
    getElevationWeight: 1,
    elevationAggregation: 'SUM',
    elevationScale: 1,
  },
  GridLayerOp: {
    visible: true,
    opacity: 1,
    cellSize: 1000,
    getColorWeight: 1,
    colorAggregation: 'SUM',
    upperPercentile: 100,
    lowerPercentile: 0,
    extruded: true,
    getElevationWeight: 1,
    elevationAggregation: 'SUM',
    elevationScale: 1,
  },
  SwitchOp: { index: 0, blend: false },
  FilterOp: { columnName: '', condition: 'equals', value: '' },
  SortOp: { key: '', order: 'asc' },
  SliceOp: { start: 0, end: 10 },
  SelectOp: { index: 0, wrap: false },
  ConcatOp: { depth: 1 },
  NetworkOp: { hub: false },
  RandomizeAttributeOp: { key: '', min: 0, max: 1 },
  ScatterOp: {
    bounds: [
      [-180, -90],
      [180, 90],
    ],
    count: 100,
    seed: 1,
  },
  TableEditorOp: { schema: null },
  JSONOp: { text: ['{}'] },
  ArcOp: {
    source: { lng: 0, lat: 0, alt: 0 },
    target: { lng: 0, lat: 0, alt: 0 },
    altitudeMultiplier: 2,
    apexAlt: 10000,
    smoothHeight: true,
    smoothPosition: true,
    segmentCount: 250,
    tilt: 0,
  },
  GeoParquetOp: { url: '', geometryColumn: 'geometry', limit: 0 },
  ShapefileOp: { url: '', encoding: 'utf-8' },
  OverpassOp: {
    query: [
      '[out:json][timeout:25];',
      '(',
      '  way["leisure"="park"]({{bbox}});',
      '  relation["leisure"="park"]({{bbox}});',
      ');',
      'out geom;',
    ],
    bbox: { southwest: { lng: -74.05, lat: 40.68 }, northeast: { lng: -73.9, lat: 40.82 } },
    pulse: 0,
  },
  TripsLayerOp: {
    visible: true,
    opacity: 1,
    getColor: '#bfcae3',
    getWidth: 8,
    currentTime: 0,
    fadeTrail: false,
    trailLength: 120,
    widthUnits: 'meters',
    widthMinPixels: 2,
    widthScale: 20,
  },
  TimeSeriesOp: { currentTime: 0 },
  H3HexagonLayerOp: { visible: true, opacity: 1, getFillColor: '#ffffffff', getLineWidth: 1 },
  H3ClusterLayerOp: {
    visible: true,
    opacity: 1,
    getLineWidth: 1,
    getFillColor: '#000000ff',
    getElevation: 1000,
  },
  S2LayerOp: {
    visible: true,
    opacity: 1,
    getFillColor: '#000000ff',
    getLineColor: '#000000ff',
    getElevation: 1000,
    getLineWidth: 1,
    elevationScale: 1,
    filled: true,
    stroked: false,
    extruded: false,
  },
  GeohashLayerOp: {
    visible: true,
    opacity: 1,
    getFillColor: '#000000ff',
    getLineColor: '#000000ff',
    getElevation: 1000,
    getLineWidth: 1,
    elevationScale: 1,
    filled: true,
    stroked: false,
    extruded: false,
  },
  QuadkeyLayerOp: {
    visible: true,
    opacity: 1,
    getFillColor: '#000000ff',
    getLineColor: '#000000ff',
    getElevation: 1000,
    getLineWidth: 1,
    elevationScale: 1,
    filled: true,
    stroked: false,
    extruded: false,
  },
  A5LayerOp: {
    visible: true,
    opacity: 1,
    getFillColor: '#ffffffff',
    getElevation: 1000,
    elevationScale: 1,
    extruded: false,
  },
  TextLayerOp: {
    visible: true,
    opacity: 1,
    getPosition: [0, 0, 0],
    getText: '',
    billboard: true,
    fontFamily: 'Inter',
    fontWeight: 400,
    sizeUnits: 'pixels',
    sizeScale: 1,
    getSize: 48,
    getColor: '#f0f0f0ff',
    background: false,
    getBackgroundColor: '#ffffffff',
    outlineWidth: 0,
    outlineColor: '#000000ff',
    getAngle: 0,
    getTextAnchor: 'middle',
    getPixelOffset: [0, 0],
    getAlignmentBaseline: 'center',
  },
  LineLayerOp: {
    visible: true,
    opacity: 1,
    widthUnits: 'pixels',
    widthScale: 1,
    widthMinPixels: 0,
    getSourcePosition: [0, 0, 0],
    getTargetPosition: [0, 0, 0],
    getColor: '#000000ff',
    getWidth: 1,
  },
  PathLayerOp: {
    visible: true,
    opacity: 1,
    getColor: '#006ac6ff',
    getWidth: 8,
    widthUnits: 'meters',
    widthScale: 20,
    widthMinPixels: 2,
  },
  PolygonLayerOp: {
    visible: true,
    opacity: 1,
    filled: true,
    stroked: true,
    extruded: false,
    elevationScale: 1,
    lineWidthUnits: 'meters',
    lineWidthScale: 1,
    lineWidthMinPixels: 0,
    getFillColor: '#000000ff',
    getLineColor: '#000000ff',
    getLineWidth: 1,
    getElevation: 1000,
  },
  SolidPolygonLayerOp: {
    visible: true,
    opacity: 1,
    getFillColor: '#ffffffff',
    getLineColor: '#ffffffff',
    getLineWidth: 0,
  },
  ColumnLayerOp: {
    visible: true,
    opacity: 1,
    diskResolution: 20,
    coverage: 1,
    elevationScale: 1,
    extruded: true,
    radiusUnits: 'meters',
    getPosition: [0, 0, 0],
    getFillColor: '#000000ff',
    getElevation: 1000,
  },
  GridCellLayerOp: {
    visible: true,
    opacity: 1,
    cellSize: 1000,
    coverage: 1,
    elevationScale: 1,
    extruded: true,
    getPosition: [0, 0, 0],
    getColor: '#000000ff',
    getElevation: 1000,
  },
  PointCloudLayerOp: {
    visible: true,
    opacity: 1,
    sizeUnits: 'pixels',
    pointSize: 10,
    getPosition: [0, 0, 0],
    getNormal: [0, 0, 1],
    getColor: '#000000ff',
  },
  IconLayerOp: {
    visible: true,
    opacity: 1,
    getPosition: [0, 0, 0],
    iconAtlas: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png',
    iconMapping:
      'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.json',
    billboard: true,
    getIcon: '',
    getSize: 1,
    sizeUnits: 'pixels',
    sizeScale: 1,
    sizeMinPixels: 0,
    getPixelOffset: [0, 0],
    getColor: '#ffffffff',
    getAngle: 0,
  },
  GreatCircleLayerOp: {
    visible: true,
    opacity: 1,
    numSegments: 20,
    widthUnits: 'pixels',
    widthScale: 1,
    widthMinPixels: 0,
    getSourcePosition: [0, 0],
    getTargetPosition: [0, 0],
    getSourceColor: '#000000ff',
    getTargetColor: '#000000ff',
    getWidth: 1,
  },
  ScreenGridLayerOp: {
    visible: true,
    opacity: 1,
    cellSizePixels: 50,
    cellMarginPixels: 2,
    aggregation: 'SUM',
    getPosition: [0, 0, 0],
    getWeight: 1,
  },
  ContourLayerOp: {
    visible: true,
    opacity: 1,
    cellSize: 1000,
    aggregation: 'SUM',
    contours: [
      { threshold: 1, color: [255, 0, 0] },
      { threshold: 5, color: [0, 255, 0] },
      { threshold: 10, color: [0, 0, 255] },
    ],
    zOffset: 0.005,
    getPosition: [0, 0, 0],
    getWeight: 1,
  },
  CategoricalColorRampOp: { colorScheme: 'accent', steps: 8, value: '' },
  NumberOp: { val: 0 },
  SimpleMeshLayerOp: {
    visible: true,
    opacity: 1,
    mesh: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/humanoid_quad.obj',
    wireframe: false,
    getPosition: [0, 0, 0],
    getColor: '#000000',
    getOrientation: [0, 0, 0],
    getScale: [1, 1, 1],
    sizeScale: 1,
    getTranslation: [0, 0, 0],
  },
  ScenegraphLayerOp: {
    visible: true,
    opacity: 1,
    scenegraph:
      'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/scenegraph-layer/airplane.glb',
    getPosition: [0, 0, 0],
    getOrientation: [0, 0, 0],
    getScale: [1, 1, 1],
    sizeScale: 1,
    sizeMinPixels: 0,
    sizeMaxPixels: 100,
    getColor: '#fff',
    getTranslation: [0, 0, 0],
  },
  MapRangeOp: { val: 0, inMin: 0, inMax: 1, outMin: 0, outMax: 1 },
  ColorRampOp: { colorScheme: 'viridis', value: 0 },
  MathOp: { operator: 'add', a: 0, b: 0 },
  BlendingOp: { mode: 'normal' },
  ColorOp: { color: '#0000ffff' },
  FileOp: { format: 'json' },
  MaplibreBasemapOp: {
    mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
    projection: 'mercator',
    viewState: { latitude: 40.7128, longitude: -74.006, zoom: 12, pitch: 0, bearing: 0 },
  },
  OutOp: {
    display: 'fixed',
    width: 1920,
    height: 1080,
    lod: 2,
    scaleMode: 'fit',
    waitForData: true,
    codec: 'avc',
    bitrateMbps: 10,
    bitrateMode: 'constant',
    scaleControl: 0.3,
    framerate: 30,
    captureDelay: 50,
    rendersDirectory: 'renders',
  },
}

/**
 * Schema 18 operators with accessor inputs. Their per-row work becomes attribute nodes, and the
 * layers among them become planner layers; none of them runs as a host operator.
 */
const ACCESSOR_OPS = new Set(
  (
    'A5LayerOp ArcLayerOp BezierCurveOp BrushingExtensionOp CategoricalColorRampOp ' +
    'CollisionFilterExtensionOp ColorRampOp ColumnLayerOp CombineRGBAOp CombineXYOp CombineXYZOp ' +
    'ContourLayerOp DataFilterExtensionOp ExtentOp FillStyleExtensionOp GeoJsonLayerOp ' +
    'GeohashLayerOp GreatCircleLayerOp GridCellLayerOp GridLayerOp H3ClusterLayerOp ' +
    'H3HexagonLayerOp HSLOp HeatmapLayerOp HexagonLayerOp IconLayerOp LineLayerOp MVTLayerOp ' +
    'MapRangeOp MathOp PathLayerOp PathStyleExtensionOp PointCloudLayerOp PolygonLayerOp ' +
    'QuadkeyLayerOp RampOp S2LayerOp ScatterplotLayerOp ScenegraphLayerOp ScreenGridLayerOp ' +
    'SimpleMeshLayerOp SolidPolygonLayerOp SplitRGBAOp SplitXYOp SplitXYZOp SwitchOp ' +
    'TextLayerOp TimeSeriesOp TripsLayerOp AccessorOp'
  ).split(' ')
)

/** Deck inputs that pass host values through to deck and MapLibre. */
/** Layers and sources the planner draws and reads itself. */
const PLANNER_LAYERS = new Set([
  'ScatterplotLayerOp',
  'ArcLayerOp',
  'GeoJsonLayerOp',
  'HeatmapLayerOp',
  'HexagonLayerOp',
  'GridLayerOp',
  'SimpleMeshLayerOp',
  'ScenegraphLayerOp',
  'TripsLayerOp',
  'TextLayerOp',
  'LineLayerOp',
  'PathLayerOp',
  'PolygonLayerOp',
  'SolidPolygonLayerOp',
  'ColumnLayerOp',
  'GridCellLayerOp',
  'PointCloudLayerOp',
  'IconLayerOp',
  'GreatCircleLayerOp',
  'ScreenGridLayerOp',
  'ContourLayerOp',
  'H3HexagonLayerOp',
  'H3ClusterLayerOp',
  'S2LayerOp',
  'GeohashLayerOp',
  'QuadkeyLayerOp',
  'A5LayerOp',
])

/** Cell layers: the column holding each row's cell id, and the grid it is in. */
const CELL_LAYERS: Record<string, { field: string; fallback: string; kind: string }> = {
  H3HexagonLayerOp: { field: 'getHexagon', fallback: 'hex', kind: 'h3' },
  H3ClusterLayerOp: { field: 'getHexagons', fallback: 'hexIds', kind: 'h3-cluster' },
  S2LayerOp: { field: 'getS2Token', fallback: 'token', kind: 's2' },
  GeohashLayerOp: { field: 'getGeohash', fallback: 'geohash', kind: 'geohash' },
  QuadkeyLayerOp: { field: 'getQuadkey', fallback: 'quadkey', kind: 'quadkey' },
  A5LayerOp: { field: 'getPentagon', fallback: 'pentagon', kind: 'a5' },
}

/** Layers that draw a list column of each row (a path, a polygon) as vertex rows. */
const LIST_LAYERS: Record<string, { field: string; fallback: string; kind: 'line' | 'polygon' }> = {
  PathLayerOp: { field: 'getPath', fallback: 'path', kind: 'line' },
  PolygonLayerOp: { field: 'getPolygon', fallback: 'polygon', kind: 'polygon' },
  SolidPolygonLayerOp: { field: 'getPolygon', fallback: 'polygon', kind: 'polygon' },
}

/** Fixed categorical schemes and their lengths; CategoricalColorRamp slices the first `steps`. */
const CATEGORICAL_SCHEMES: Record<string, number> = {
  accent: 8,
  category10: 10,
  dark: 8,
  paired: 12,
  set1: 9,
  set2: 8,
  set3: 12,
  tableau10: 10,
  joby: 10,
}

/** How a path list column's positions are named once unnested into vertex rows. */
const VERTEX_COMPONENTS = ['lng', 'lat', 'alt']
const PLANNER_SOURCES = new Set(['FileOp', 'DuckDbOp'])

const DECK_VALUE_PORTS = ['views', 'effects', 'widgets', 'viewState', 'maplibreLayers']

/** Inputs every layer has that the planner handles itself, or that change nothing drawn. */
const LAYER_IGNORED = new Set(['data', 'parameters', 'extensions', 'updateTriggers'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const segment = (id: string) => id.slice(id.lastIndexOf('/') + 1)

/** An attribute name from a node path: `/position-accessor` -> `position_accessor`. */
const attributeName = (id: string) =>
  segment(id)
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1')

/** The length of a JSON array literal such as `[null]`, or undefined for any other text. */
function literalLength(text: string): number | undefined {
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v.length : undefined
  } catch {
    return undefined
  }
}

/** A Noodles operator path, relative (`centroid`, `./a`, `../b`) or absolute, from `from`. */
function resolveNoodlesPath(path: string, from: string): string {
  if (path.startsWith('/')) return path
  const parts = from.split('/').slice(0, -1)
  for (const seg of path.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/') || '/'
}

const handleField = (handle: string | null | undefined) =>
  (handle ?? '').replace(/^(par|out)\./, '')

/** `#rrggbb` or `#rrggbbaa` -> [r, g, b] and alpha 0–255. */
function parseHex(value: unknown): { rgb: [number, number, number]; alpha: number } | undefined {
  if (typeof value !== 'string') return undefined
  let hex = value.replace(/^#/, '')
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('')
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return undefined
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16)
  return { rgb: [n(0), n(2), n(4)], alpha: hex.length === 8 ? n(6) : 255 }
}

/**
 * Value operators the conversion computes from their literal inputs and writes into what reads
 * them: a vector split into numbers, a color from channels, a Bounds' box.
 */
const FOLDED = new Set([
  'BooleanOp',
  'StringOp',
  'DateTimeOp',
  'CombineXYOp',
  'SplitXYOp',
  'SplitXYZOp',
  'CombineRGBAOp',
  'HSLOp',
  'SplitRGBAOp',
  'BoundsOp',
  'SplitMapViewStateOp',
  'ProjectOp',
  'UnprojectOp',
])

/** Noodles' curve operators, which become the planner's scalar operators of the same work. */
const CURVES: Record<string, string> = { BezierCurveOp: 'bezier-curve', RampOp: 'ramp' }

class NotFoldable extends Error {}

/** Noodles operators on rows that convert to planner nodes on the data path. */
const TABLE_OPS = new Set([
  'FilterOp',
  'SortOp',
  'SliceOp',
  'SelectOp',
  'ConcatOp',
  'CrossOp',
  'NetworkOp',
  'RandomizeAttributeOp',
  'ScatterOp',
  'TableEditorOp',
  'JSONOp',
  'ArcOp',
  'GeoParquetOp',
])

interface BboxValue {
  southwest: { lng: number; lat: number }
  northeast: { lng: number; lat: number }
}

const sqlString = (v: string) => `'${v.replace(/'/g, "''")}'`
const sqlIdent = (v: string) => `"${v.replace(/"/g, '""')}"`

const num = (v: unknown, fallback: number) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}

/** A number as expression text: always with a decimal point, so the planner reads a float. */
const lit = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x))

/**
 * A Noodles accessor expression in the planner's expression language, or undefined when it
 * uses something the planner can't express (row index, the whole dataset, `op()`, strings,
 * method calls). Per-row JS is `d.column`; the planner reads the column by name.
 */
export function translateAccessor(js: string, indexNames?: string[]): string | undefined {
  let text = js.trim().replace(/;$/, '')
  if (/^return\s/.test(text)) text = text.slice(7)
  // A row that is an array (TimeSeries spreads a position into one): `d[0]` is a named column.
  if (indexNames) text = text.replace(/\bd\[(\d+)\]/g, (m, i) => indexNames[Number(i)] ?? m)
  // colorToHex only respells an RGB array; a color field turns it straight back into one.
  text = text.replace(/\butils\.colorToHex\(/g, '(')
  // Anything beyond column reads and Math is a host expression.
  if (/\bop\(|\bdata\b|\bi\b|=>|`|\.\w+\(/.test(text.replace(/\bMath\.\w+\(/g, '')))
    return undefined
  // Strings are text, and text has no per-row number or color: only a text channel reads it.
  if (/['"]/.test(text)) return undefined
  text = text
    .replace(/\bd\.properties\.([A-Za-z_]\w*)/g, '$1')
    .replace(/\bd\.([A-Za-z_]\w*)/g, '$1')
    .replace(/\b([A-Za-z_]\w*)\[(\d+)\]/g, 'item($1, $2.0)')
    .replace(/\bMath\.PI\b/g, String(Math.PI))
    .replace(/\bMath\.E\b/g, String(Math.E))
    .replace(/\bMath\.log\(/g, 'ln(')
    .replace(/\bMath\.(\w+)\(/g, '$1(')
    .replace(/===/g, '==')
    .replace(/!==/g, '!=')
  if (/\bd\b/.test(text)) return undefined
  // `a ?? b` at the top level: a property some features lack.
  const parts = text.split('??')
  if (parts.length === 2) text = `coalesce(${parts[0].trim()}, ${parts[1].trim()})`
  else if (parts.length > 2) return undefined
  try {
    parseExpr(text)
  } catch {
    return undefined
  }
  return text
}

/**
 * An accessor that returns a string, such as a per-feature `#rrggbb` color: the expression with
 * `a || b` as `coalesce(a, b)`. Only SQL runs strings, so its consumers decide what it becomes
 * (`hex_color` for a color channel).
 */
export function translateStringAccessor(js: string): string | undefined {
  let text = js.trim().replace(/;$/, '')
  if (/^return\s/.test(text)) text = text.slice(7)
  if (/\bop\(|\bdata\b|\bi\b|=>|`|\.\w+\(/.test(text)) return undefined
  text = text
    .replace(/"([^"']*)"/g, "'$1'")
    .replace(/\bd\.properties\.([A-Za-z_]\w*)/g, '$1')
    .replace(/\bd\.([A-Za-z_]\w*)/g, '$1')
  if (/\bd\b/.test(text)) return undefined
  for (const op of ['||', '??']) {
    const parts = text.split(op)
    if (parts.length === 2) text = `coalesce(${parts[0].trim()}, ${parts[1].trim()})`
    else if (parts.length > 2) return undefined
  }
  try {
    parseExpr(text)
  } catch {
    return undefined
  }
  return text
}

/** Components a field's accessor returns: positions and colors are vectors, the rest numbers. */
function widthOf(field: string): number {
  if (/(Position|Color|^getOrientation|^getScale|^getTranslation)$/.test(field)) return 3
  return 1
}

/**
 * An accessor as the body of a JS function DuckDB runs per row: `d.col` reads become the
 * function's parameters, one per column. Undefined when it reads more than columns (the whole
 * row, the row index, the dataset, another operator) or needs the editor's libraries.
 */
export function jsAccessor(js: string): { columns: string[]; body: string } | undefined {
  let text = js.trim().replace(/;$/, '')
  if (/\bop\(|\bdata\b|\bi\b|\bd3\.|\bturf\.|\butils\./.test(text)) return undefined
  const columns: string[] = []
  let unreadable = false
  // A column read becomes a parameter; a name no parameter can have leaves the read in place
  const column = (read: string, name: string) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      unreadable = true
      return read
    }
    if (!columns.includes(name)) columns.push(name)
    return name
  }
  text = text
    .replace(/\bd\.properties\.([A-Za-z_]\w*)/g, (m, c) => column(m, c))
    .replace(/\bd\[(['"])([^'"]+)\1\]/g, (m, _q, c) => column(m, c))
    .replace(/\bd\.([A-Za-z_]\w*)/g, (m, c) => column(m, c))
  if (unreadable || /\bd\b/.test(text) || columns.length === 0) return undefined
  const body = /\breturn\b/.test(text) ? text : `return (${text})`
  try {
    new Function(...columns, body)
  } catch {
    return undefined
  }
  return { columns, body }
}

const MATH: Record<string, (a: string, b: string) => string> = {
  add: (a, b) => `(${a} + ${b})`,
  subtract: (a, b) => `(${a} - ${b})`,
  multiply: (a, b) => `(${a} * ${b})`,
  divide: (a, b) => `(${a} / ${b})`,
  modulo: (a, b) => `(${a} % ${b})`,
  power: (a, b) => `pow(${a}, ${b})`,
  min: (a, b) => `min(${a}, ${b})`,
  max: (a, b) => `max(${a}, ${b})`,
  sine: a => `sin(${a})`,
  cosine: a => `cos(${a})`,
  tan: a => `tan(${a})`,
  log: a => `ln(${a})`,
  sqrt: a => `sqrt(${a})`,
  round: a => `round(${a})`,
  floor: a => `floor(${a})`,
  ceil: a => `ceil(${a})`,
  abs: a => `abs(${a})`,
  rad: a => `(${a} * ${lit(Math.PI / 180)})`,
  deg: a => `(${a} * ${lit(180 / Math.PI)})`,
}

const MATH_JS: Record<string, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b,
  modulo: (a, b) => a % b,
  power: (a, b) => a ** b,
  min: Math.min,
  max: Math.max,
  sine: Math.sin,
  cosine: Math.cos,
  tan: Math.tan,
  log: Math.log,
  sqrt: Math.sqrt,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  rad: a => (a * Math.PI) / 180,
  deg: a => (a * 180) / Math.PI,
}

// ---------------------------------------------------------------------------
// Values a layer input can resolve to
// ---------------------------------------------------------------------------

type Value =
  /** A per-row value: an attribute written by a row node, or an expression over columns. */
  | { kind: 'row'; expr: string }
  | { kind: 'const'; value: unknown }
  /** A shared ColorOp, referenced by its planner node's name. */
  | { kind: 'color'; node: string }

interface RowNode {
  node: DocNode
  /** Attributes it reads, so the chain can be ordered. */
  reads: Set<string>
  attribute: string
  /** Its value is a string; a color channel reads it through `hex_color`. */
  stringValued?: boolean
  /** Already rewritten to a 0–1 color. */
  color?: boolean
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

// A project with its Reroute operators wired through: a reroute is only a bend in a wire
function withoutReroutes(project: NoodlesProject): NoodlesProject {
  const reroutes = new Set(project.nodes.filter(n => n.type === 'RerouteOp').map(n => n.id))
  if (reroutes.size === 0) return project
  const into = new Map(project.edges.filter(e => reroutes.has(e.target)).map(e => [e.target, e]))
  // The edge a wire really starts at, following reroutes of reroutes
  const origin = (e: NoodlesEdge): NoodlesEdge | undefined => {
    if (!reroutes.has(e.source)) return e
    const up = into.get(e.source)
    return up && origin(up)
  }
  const edges = project.edges.flatMap(e => {
    if (reroutes.has(e.target)) return []
    const from = origin(e)
    return from ? [{ ...e, source: from.source, sourceHandle: from.sourceHandle }] : []
  })
  return { ...project, nodes: project.nodes.filter(n => !reroutes.has(n.id)), edges }
}

interface Container {
  id: string
  x: number
  y: number
}

const depth = (id: string) => id.split('/').length
const isChildOf = (id: string, container: string) =>
  id.startsWith(`${container}/`) && !id.slice(container.length + 1).includes('/')

/**
 * A project with its containers taken apart: each value a container's input passed to the
 * GraphInput inside goes straight to what read it, and what fed the GraphOutput goes straight
 * to what read the container. The containers, deepest first, become subnets again once the
 * flat project is converted (see `intoSubnets`).
 */
function withoutContainers(project: NoodlesProject): {
  project: NoodlesProject
  containers: Container[]
} {
  const containers = project.nodes
    .filter(n => n.type === 'ContainerOp')
    .sort((a, b) => depth(b.id) - depth(a.id))
  if (containers.length === 0) return { project, containers: [] }
  let { nodes, edges } = project
  const field = (h: string | null | undefined) => (h ?? '').replace(/^(par|out)\./, '')
  for (const c of containers) {
    const inputs = new Set(
      nodes.filter(n => n.type === 'GraphInputOp' && isChildOf(n.id, c.id)).map(n => n.id)
    )
    const outputs = new Set(
      nodes.filter(n => n.type === 'GraphOutputOp' && isChildOf(n.id, c.id)).map(n => n.id)
    )
    const next: NoodlesEdge[] = []
    for (const e of edges) {
      // The bridges between a container and its GraphInput and GraphOutput go
      if (
        (e.source === c.id && inputs.has(e.target)) ||
        (outputs.has(e.source) && e.target === c.id)
      )
        continue
      if (inputs.has(e.source)) {
        // GraphInput's `value` is the container's `in`; a custom field keeps its name
        const name = field(e.sourceHandle) === 'value' ? 'in' : field(e.sourceHandle)
        for (const outer of edges.filter(
          x => x.target === c.id && field(x.targetHandle) === name
        )) {
          next.push({
            ...e,
            id: `${outer.id}~${e.id}`,
            source: outer.source,
            sourceHandle: outer.sourceHandle,
          })
        }
        continue
      }
      if (e.source === c.id) {
        for (const inner of edges.filter(x => outputs.has(x.target))) {
          next.push({
            ...e,
            id: `${inner.id}~${e.id}`,
            source: inner.source,
            sourceHandle: inner.sourceHandle,
          })
        }
        continue
      }
      if (outputs.has(e.target) || e.target === c.id) continue
      next.push(e)
    }
    edges = next
    nodes = nodes.filter(n => n.id !== c.id && !inputs.has(n.id) && !outputs.has(n.id))
  }
  return {
    project: { ...project, nodes, edges },
    containers: containers.map(c => ({ id: c.id, x: c.position?.x ?? 0, y: c.position?.y ?? 0 })),
  }
}

/**
 * A converted document with each container's nodes (by their paths: `/group/layer`, and the
 * nodes made for them, `/group/layer-lines`) collapsed back into a subnet of the container's
 * id, deepest first. One whose nodes read more than two things from outside stays flat.
 */
function intoSubnets(doc: EditorDoc, containers: Container[], warnings: string[]): void {
  for (const c of containers) {
    const members = doc.nodes.filter(n => n.id.startsWith(`${c.id}/`) && n.parent === undefined)
    if (members.length === 0) continue
    try {
      const sub = collapseToSubnet(
        doc,
        members.map(n => n.id),
        { id: c.id, name: c.id.slice(c.id.lastIndexOf('/') + 1) }
      )
      if (sub) {
        sub.x = c.x
        sub.y = c.y
      }
    } catch (err) {
      warnings.push(`${c.id}: kept flat, as ${(err as Error).message.toLowerCase()}`)
    }
  }
}

export function toEditorDoc(original: NoodlesProject): Migrated {
  if (original.version !== 18) {
    throw new MigrationError(
      `Expected a schema 18 project; migrate it first (got ${original.version})`
    )
  }
  const { project, containers } = withoutContainers(withoutReroutes(original))
  const warnings: string[] = []
  const byId = new Map(project.nodes.map(n => [n.id, n]))
  const inputs = (n: NoodlesNode) => ({ ...DEFAULTS[n.type], ...(n.data?.inputs ?? {}) })
  const incoming = (target: string, field: string) =>
    project.edges.filter(e => e.target === target && handleField(e.targetHandle) === field)
  const incomingOne = (target: string, field: string) => incoming(target, field)[0]
  const position = (n: NoodlesNode) => ({ x: n.position?.x ?? 0, y: n.position?.y ?? 0 })

  const loop = project.nodes.find(n => n.type.startsWith('ForLoop'))
  if (loop) {
    throw new MigrationError(
      `${loop.id}: a ForLoop is not converted; per-item work is a row operation in a document`
    )
  }

  const nodes: DocNode[] = []
  const edges: DocEdge[] = []
  const used = new Set<string>()
  let edgeCount = 0
  const edge = (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
    index?: number
  ) =>
    edges.push({
      id: `e${edgeCount++}`,
      source,
      sourcePort,
      target,
      targetPort,
      ...(index !== undefined ? { index } : {}),
    })

  // --- output: DeckRenderer + Out + MaplibreBasemap -> one deck node ----------------------
  const deckOp = project.nodes.find(n => n.type === 'DeckRendererOp')
  if (!deckOp) throw new MigrationError('No DeckRenderer to convert')
  const outOp = project.nodes.find(n => n.type === 'OutOp')
  const basemapEdge = incomingOne(deckOp.id, 'basemap')
  const basemap = basemapEdge ? byId.get(basemapEdge.source) : undefined
  if (basemap && basemap.type !== 'MaplibreBasemapOp') {
    throw new MigrationError(
      `Basemap ${basemap.id} is a ${basemap.type}; only MaplibreBasemap converts`
    )
  }
  used.add(deckOp.id)
  if (outOp) used.add(outOp.id)
  if (basemap) used.add(basemap.id)
  const deckParams: Record<string, ParamValue> = {}
  if (basemap) {
    const b = inputs(basemap)
    const view = {
      ...(DEFAULTS.MaplibreBasemapOp.viewState as object),
      ...(b.viewState as object),
    } as Record<string, number>
    deckParams.mapStyle = typeof b.mapStyle === 'string' ? b.mapStyle : ''
    deckParams.projection = String(b.projection)
    for (const k of ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'])
      deckParams[k] = num(view[k], 0)
    for (const k of Object.keys(basemap.data?.inputs ?? {})) {
      if (!['mapStyle', 'projection', 'viewState'].includes(k))
        warnings.push(`${basemap.id}: dropped '${k}'`)
    }
  } else {
    deckParams.basemap = 'none'
  }
  if (outOp) {
    const o = inputs(outOp)
    for (const k of Object.keys(DEFAULTS.OutOp)) deckParams[k] = o[k] as ParamValue
  }
  for (const k of Object.keys(deckOp.data?.inputs ?? {}))
    warnings.push(`${deckOp.id}: dropped '${k}'`)
  nodes.push({
    id: deckOp.id,
    op: 'deck',
    name: segment(deckOp.id),
    ...position(deckOp),
    params: deckParams,
  })

  // --- data sources --------------------------------------------------------------------
  /** Operators a query references by `{{…}}`: they must exist in the document too. */
  const referenced = new Set<string>()
  const sources = new Map<string, string>()
  /** The output port a source's rows leave by: `out`, or a GeoJSON source's `all`. */
  const sourcePort = new Map<string, string>()
  /** Column names a source's rows index by position: `d[0]` of a TimeSeries row is `lng`. */
  const indexNames = new Map<string, string[]>()

  /**
   * The column a list accessor reads (`d.path`, `d.timestamps`), or its default when nothing
   * is wired: lists unnest into vertex rows, so only a bare column converts.
   */
  const listColumn = (owner: string, field: string, fallback: string): string => {
    const e = incomingOne(owner, field)
    if (!e) return fallback
    const acc = byId.get(e.source)
    const expr =
      acc?.type === 'AccessorOp' ? translateAccessor(String(inputs(acc).expression)) : undefined
    if (!acc || !expr || !/^[A-Za-z_]\w*$/.test(expr)) {
      throw new MigrationError(`${owner}: ${field} must read a list column, as d.path does`)
    }
    used.add(acc.id)
    return expr
  }

  /**
   * One row per vertex of rows that each hold a path (a list of positions) and its timestamps:
   * what a trips layer draws and a time series samples. Shared by every reader of the same lists.
   */
  const vertexSource = (src: string, path: string, times: string, near: NoodlesNode): string => {
    const id = `${src}-vertices${path === 'path' ? '' : `-${path}`}`
    if (!sources.has(id)) {
      const at = position(near)
      nodes.push({
        id,
        op: 'unnest',
        name: segment(id),
        x: at.x - 260,
        y: at.y,
        params: {
          lists: `${path}, ${times}`,
          split: `${path}: ${VERTEX_COMPONENTS.join(' ')}`,
          rename: `${times}: t`,
          rowId: 'trip',
          index: 'k',
        },
      })
      edge(src, sourcePort.get(src) ?? 'out', id, 'in')
      sources.set(id, id)
    }
    return id
  }

  /**
   * A CodeOp as a code node the engine runs, when its code needs nothing but its input: no
   * `op()`, no timeline values, no per-operator `this`. Its input is a planner source's rows,
   * a JSON file read whole (as FileOp parsed it for CodeOp), or nothing. False leaves it a
   * host operator.
   */
  const codeNode = (n: NoodlesNode): boolean => {
    const i = inputs(n)
    const code = Array.isArray(i.code) ? i.code.join('\n') : String(i.code ?? '')
    if (/\bop\(|\bsequenceTime\b|\bframe\b|\btotalFrames\b|\bsequence\b|\bthis\b/.test(code))
      return false
    const feeds = incoming(n.id, 'data')
    if (feeds.length > 1) return false
    const feed = feeds[0]
    const from = feed ? byId.get(feed.source) : undefined
    const params: Record<string, ParamValue> = { code }
    let input: string | undefined
    if (
      from?.type === 'FileOp' &&
      ['json', 'geojson'].includes(String(inputs(from).format)) &&
      typeof inputs(from).url === 'string'
    ) {
      params.url = String(inputs(from).url)
      used.add(from.id)
    } else if (from && PLANNER_SOURCES.has(from.type)) {
      input = source(from.id)
    } else if (from) {
      return false
    }
    nodes.push({ id: n.id, op: 'code', name: segment(n.id), ...position(n), params })
    if (input) edge(input, sourcePort.get(input) ?? 'out', n.id, 'in')
    return true
  }

  const source = (id: string, geometry = false, port?: string): string => {
    const cached = sources.get(id)
    if (cached) return cached
    const n = byId.get(id)
    if (!n) throw new MigrationError(`Missing node ${id}`)
    const i = inputs(n)
    if (geometry && n.type !== 'FileOp') {
      // GeoJSON an operator makes: its features as the vertex rows a layer draws
      const made = features(id, port)
      const rowsId = `${id}-rows`
      nodes.push({
        id: rowsId,
        op: 'geojson',
        name: segment(rowsId),
        ...position(n),
        y: position(n).y + 160,
        params: { url: '' },
      })
      edge(made.node, made.port, rowsId, 'in')
      sourcePort.set(rowsId, 'all')
      sources.set(id, rowsId)
      return rowsId
    }
    if (geometry) {
      if (!isGeoJsonFile(n)) throw new MigrationError(`${id} (${n.type}) is not a GeoJSON file`)
      nodes.push({
        id,
        op: 'geojson',
        name: segment(id),
        ...position(n),
        params: { url: String(i.url) },
      })
      sourcePort.set(id, 'all')
    } else if (
      n.type === 'ExpressionOp' &&
      literalLength(String(i.expression ?? '')) !== undefined
    ) {
      // A literal array as data: rows to place things at, with nothing in them.
      const count = literalLength(String(i.expression)) as number
      nodes.push({
        id,
        op: 'generate',
        name: segment(id),
        ...position(n),
        params: { count, name: 'i' },
      })
    } else if (n.type === 'FileOp' && i.format === 'json' && typeof i.url === 'string') {
      nodes.push({
        id,
        op: 'file',
        name: segment(id),
        ...position(n),
        params: { url: i.url, format: 'json' },
      })
    } else if (n.type === 'FileOp' && i.format === 'csv' && typeof i.url === 'string') {
      nodes.push({
        id,
        op: 'file',
        name: segment(id),
        ...position(n),
        params: { url: i.url, format: 'csv' },
      })
    } else if (n.type === 'DuckDbOp' && (typeof i.query === 'string' || Array.isArray(i.query))) {
      const text = (Array.isArray(i.query) ? i.query.join('\n') : String(i.query))
        .trim()
        .replace(/;$/, '')
      if (text.split(';').filter(t => t.trim()).length > 1) {
        throw new MigrationError(`${id}: a DuckDB query of several statements is not converted`)
      }
      // `{{op.par.x}}` / `{{op.out.x.y}}` references become ch(), which the planner binds as a
      // parameter of the relation: a change rematerializes it, as DuckDbOp re-ran its query.
      const query = text.replace(
        /\{\{([^.}]+)\.(par|out)\.([\w.-]+)\}\}/g,
        (_m, ref, inOut, path) => {
          const target = resolveNoodlesPath(ref, id)
          referenced.add(target)
          return inOut === 'out'
            ? `ch('${segment(target)}/out.${path}')`
            : `ch('${segment(target)}/${path}')`
        }
      )
      nodes.push({ id, op: 'sql', name: segment(id), ...position(n), params: { query } })
    } else if (n.type === 'TimeSeriesOp') {
      // Each path's interpolated place at the current time, sampled in SQL from vertex rows.
      const data = incomingOne(id, 'data')
      if (!data) throw new MigrationError(`${id} has no data`)
      const up = source(data.source, false, handleField(data.sourceHandle))
      const values = listColumn(id, 'getValues', 'values')
      const verts = vertexSource(up, values, listColumn(id, 'getTimestamps', 'timestamps'), n)
      const props = incomingOne(id, 'getProperties')
      const propsText = props
        ? String(inputs(byId.get(props.source) as NoodlesNode).expression)
        : ''
      // Properties are columns already (host rows flatten `properties`), so they need nothing.
      if (
        props &&
        !/^(d|d\.properties|\{\s*properties:\s*d\.properties\s*\})$/.test(propsText.trim())
      ) {
        throw new MigrationError(`${id}: getProperties '${propsText}' is not converted`)
      }
      if (props) used.add(props.source)
      const params: Record<string, ParamValue> = {
        pathId: 'trip',
        order: 'k',
        timestamp: 't',
        values: VERTEX_COMPONENTS.join(', '),
        time: num(i.currentTime, 0),
      }
      nodes.push({ id, op: 'time-series', name: segment(id), ...position(n), params })
      edge(verts, 'out', id, 'in')
      wiredNumber(id, 'currentTime', id, 'time')
      indexNames.set(id, VERTEX_COMPONENTS)
    } else if (n.type === 'CodeOp' && codeNode(n)) {
      // Rows JavaScript makes, run by the engine and planned over like any table
    } else if (TABLE_OPS.has(n.type)) {
      tableNode(n)
    } else if (!ACCESSOR_OPS.has(n.type) && !PLANNER_SOURCES.has(n.type)) {
      // Rows a host operator makes (a CodeOp's): the engine hands them to DuckDB.
      hostNode(id)
      sourcePort.set(id, port || 'data')
      sources.set(id, id)
      return id
    } else {
      throw new MigrationError(`${id} (${n.type}) is not a CSV file or a plain DuckDB query yet`)
    }
    used.add(id)
    sources.set(id, id)
    return id
  }

  /** How an accessor reads the rows a pairing operator makes: `d.origin.lng` is `origin_lng`. */
  const accessorRewrites = new Map<string, (js: string) => string>()

  /** A Noodles operator on rows as planner nodes under its id, wired from the rows it reads. */
  const tableNode = (n: NoodlesNode): void => {
    const id = n.id
    const i = inputs(n)
    const put = (op: string, params: Record<string, ParamValue>) =>
      nodes.push({ id, op, name: segment(id), ...position(n), params })
    const sql = (query: string) => put('sql', { query })
    // The rows a field reads, wired into a port; what accessors know of them carries over
    const from = (field: string, port = 'in', index?: number, edgeOf = incomingOne(id, field)) => {
      if (!edgeOf) throw new MigrationError(`${id} has no ${field}`)
      const up = source(edgeOf.source, false, handleField(edgeOf.sourceHandle))
      edge(up, sourcePort.get(up) ?? 'out', id, port, index)
      const names = indexNames.get(up)
      if (names) indexNames.set(id, names)
      const rewrite = accessorRewrites.get(up)
      if (rewrite) accessorRewrites.set(id, rewrite)
    }
    const literalOnly = (...fields: string[]) => {
      for (const f of fields) {
        if (incomingOne(id, f)) throw new MigrationError(`${id}: a wired ${f} is not converted`)
      }
    }
    switch (n.type) {
      case 'FilterOp': {
        const column = String(i.columnName ?? '')
        const condition = String(i.condition)
        const value = String(i.value ?? '')
        if (!column) throw new MigrationError(`${id}: a Filter needs a column`)
        const number =
          value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined
        const compare: Record<string, string> = {
          equals: '==',
          'not equals': '!=',
          'greater than': '>',
          'less than': '<',
          'greater than or equal to': '>=',
          'less than or equal to': '<=',
        }
        const bare = /^[A-Za-z_]\w*$/.test(column)
        if (bare && compare[condition] && number !== undefined) {
          // A number compares as a number, where FilterOp compared `===` with the text
          put('filter', { mode: 'compare', column, op: compare[condition], value: number })
          from('data')
        } else if (bare && (condition === 'equals' || condition === 'not equals')) {
          put('filter', { mode: 'match', column, text: value, negate: condition === 'not equals' })
          from('data')
        } else {
          // Text order, substrings and lists are SQL; the expression language has no words for them
          const c = `CAST(${sqlIdent(column)} AS VARCHAR)`
          const list = value.split(',').map(sqlString).join(', ')
          const where: Record<string, string> = {
            equals: `${c} = ${sqlString(value)}`,
            'not equals': `${c} != ${sqlString(value)}`,
            'greater than': `${c} > ${sqlString(value)}`,
            'less than': `${c} < ${sqlString(value)}`,
            'greater than or equal to': `${c} >= ${sqlString(value)}`,
            'less than or equal to': `${c} <= ${sqlString(value)}`,
            contains: `contains(${c}, ${sqlString(value)})`,
            'not contains': `NOT contains(${c}, ${sqlString(value)})`,
            in: `${c} IN (${list})`,
            'not in': `${c} NOT IN (${list})`,
          }
          if (!where[condition])
            throw new MigrationError(`${id}: condition '${condition}' is not converted`)
          sql(`SELECT * FROM {{input0}} WHERE ${where[condition]}`)
          from('data', 'in0')
        }
        return
      }
      case 'SortOp': {
        if (!String(i.key ?? '')) throw new MigrationError(`${id}: a Sort needs a key`)
        put('sort', { by: String(i.key), descending: i.order === 'desc', limit: 0 })
        from('data')
        return
      }
      case 'SliceOp': {
        literalOnly('start', 'end')
        const start = Math.floor(num(i.start, 0))
        const end = i.end === null || i.end === undefined ? undefined : Math.floor(num(i.end, 10))
        if (start < 0 || (end !== undefined && end < 0)) {
          throw new MigrationError(`${id}: a Slice from the end is not converted`)
        }
        if (end === undefined) sql(`SELECT * FROM {{input0}} OFFSET ${start}`)
        else put('limit', { count: Math.max(0, end - start), offset: start })
        from('data', end === undefined ? 'in0' : 'in')
        return
      }
      case 'SelectOp': {
        // One row, by a position that is clamped to the rows or wraps around them
        const wired = incomingOne(id, 'index')
        const src = wired ? byId.get(wired.source) : undefined
        if (wired && src?.type !== 'NumberOp') {
          throw new MigrationError(`${id}: an index from ${src?.type} is not converted`)
        }
        if (src) numberNode(src)
        const index = src ? `ch('${segment(src.id)}/value')` : String(Math.floor(num(i.index, 0)))
        const at = `CAST(floor(${index}) AS BIGINT)`
        const pick =
          i.wrap === true ? `((${at} % __n) + __n) % __n` : `least(greatest(${at}, 0), __n - 1)`
        sql(
          `SELECT * EXCLUDE (__i, __n) FROM (SELECT *, row_number() OVER () - 1 AS __i, count(*) OVER () AS __n FROM {{input0}}) WHERE __i = ${pick}`
        )
        from('data', 'in0')
        return
      }
      case 'ConcatOp': {
        if (num(i.depth, 1) !== 1)
          throw new MigrationError(`${id}: a Concat of depth ${i.depth} is not converted`)
        put('union', {})
        for (const [k, e] of incoming(id, 'values').entries()) from('values', 'in', k, e)
        return
      }
      case 'CrossOp':
      case 'NetworkOp': {
        // Every pair of rows, i < j (or the first row with every other): one row each with
        // both sides' columns, which accessors read by prefix
        const [a, b] = n.type === 'CrossOp' ? ['a', 'b'] : ['origin', 'destination']
        const numbered = 'SELECT *, row_number() OVER () AS __i FROM {{input0}}'
        const on =
          n.type === 'NetworkOp' && i.hub === true ? 'l.__i = 1 AND r.__i > 1' : 'l.__i < r.__i'
        sql(
          `SELECT COLUMNS(l.* EXCLUDE (__i)) AS '${a}_\\0', COLUMNS(r.* EXCLUDE (__i)) AS '${b}_\\0' FROM (${numbered}) AS l JOIN (${numbered}) AS r ON ${on}`
        )
        from(n.type === 'CrossOp' ? 'data' : 'skyports', 'in0')
        accessorRewrites.set(
          id,
          n.type === 'CrossOp'
            ? js => js.replace(/\bd\[0\]\.(\w+)/g, 'd.a_$1').replace(/\bd\[1\]\.(\w+)/g, 'd.b_$1')
            : js =>
                js
                  .replace(/\bd\.(origin|destination)\.(\w+)/g, 'd.$1_$2')
                  .replace(/\bd\.(origin|destination)\b(?![\w.])/g, '[d.$1_lng, d.$1_lat]')
        )
        return
      }
      case 'RandomizeAttributeOp': {
        // Drawn once into a table, as RandomizeAttribute drew them once per run: DuckDB cannot
        // reuse a random() alias within one query, and a requery should not draw again
        literalOnly('min', 'max')
        const key = String(i.key ?? '')
        if (!key) throw new MigrationError(`${id}: Randomize Attribute needs a key`)
        const min = num(i.min, 0)
        const max = num(i.max, 1)
        sql(
          `SELECT COLUMNS(c -> c != ${sqlString(key)}), random() * ${lit(max - min)} + ${lit(min)} AS ${sqlIdent(key)} FROM {{input0}}`
        )
        from('data', 'in0')
        return
      }
      case 'ScatterOp': {
        // Points spread over bounds, the same for a seed: hashes of the row number stand in for
        // ScatterOp's seeded generator, so the points differ from Noodles' but not between runs
        literalOnly('bounds', 'count', 'seed')
        const b = i.bounds as unknown
        const [p, q] = Array.isArray(b)
          ? (b as number[][])
          : [
              [(b as BboxValue).southwest.lng, (b as BboxValue).southwest.lat],
              [(b as BboxValue).northeast.lng, (b as BboxValue).northeast.lat],
            ]
        const [west, east] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])]
        const [south, north] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])]
        const seed = Math.floor(num(i.seed, 1))
        const u = (k: number) => `(hash(i, ${seed}, ${k}) % 1000003) / 1000003.0`
        sql(
          `SELECT ${lit(west)} + ${u(0)} * ${lit(east - west)} AS lng, ${lit(south)} + ${u(1)} * ${lit(north - south)} AS lat FROM range(${Math.max(0, Math.floor(num(i.count, 100)))}) AS t(i)`
        )
        return
      }
      case 'TableEditorOp': {
        if (incomingOne(id, 'data'))
          throw new MigrationError(`${id}: a Table Editor over wired rows is not converted`)
        const rows = Array.isArray(n.data?.inputs?.data) ? n.data?.inputs?.data : []
        const schema = n.data?.inputs?.schema
        put('table', {
          rows: JSON.stringify(rows, null, 2),
          schema: schema ? JSON.stringify(schema) : '',
        })
        return
      }
      case 'JSONOp': {
        const text = Array.isArray(i.text) ? i.text.join('\n') : String(i.text ?? '')
        if (/\{\{[^}]+\}\}/.test(text)) {
          throw new MigrationError(`${id}: JSON with {{…}} references is not converted`)
        }
        put('code', { code: `return (${text})`, url: '' })
        return
      }
      case 'ArcOp': {
        // Its path's points as rows: lng, lat and alt, which d[0]…d[2] read
        literalOnly('source', 'target', 'altitudeMultiplier', 'apexAlt', 'segmentCount', 'tilt')
        const arc = {
          source: { alt: 0, ...(i.source as object) },
          target: { alt: 0, ...(i.target as object) },
          arcHeight: num(i.apexAlt, 10000) * num(i.altitudeMultiplier, 2),
          smoothHeight: i.smoothHeight !== false,
          smoothPosition: i.smoothPosition !== false,
          segmentCount: num(i.segmentCount, 250),
          tilt: num(i.tilt, 0),
        }
        put('code', {
          code: `return utils.getArc(${JSON.stringify(arc)}).map(([lng, lat, alt]) => ({ lng, lat, alt }))`,
          url: '',
        })
        indexNames.set(id, ['lng', 'lat', 'alt'])
        return
      }
      case 'GeoParquetOp': {
        // A table of features: DuckDB reads GeoParquet's geometry, and casts plain WKB to it
        literalOnly('url', 'geometryColumn', 'limit')
        const column = sqlIdent(String(i.geometryColumn || 'geometry'))
        const limit = Math.floor(num(i.limit, 0))
        sql(
          `SELECT * EXCLUDE (${column}), ${column}::GEOMETRY AS geom FROM read_parquet(${sqlString(String(i.url))})${limit > 0 ? ` LIMIT ${limit}` : ''}`
        )
        return
      }
    }
  }

  /**
   * A Bbox input's value: its own, or a Bounds operator's corners when one with literal corners
   * is wired to it, folded into the node that reads them.
   */
  const boundsOf = (owner: string, field: string, own: BboxValue): BboxValue => {
    const e = incomingOne(owner, field)
    if (!e) return own
    const b = byId.get(e.source)
    if (b?.type !== 'BoundsOp' || project.edges.some(x => x.target === b.id)) {
      throw new MigrationError(`${owner}: ${field} from ${b?.type} is not converted`)
    }
    used.add(b.id)
    const corner = (v: unknown) =>
      Array.isArray(v)
        ? { lng: num(v[0], 0), lat: num(v[1], 0) }
        : (v as { lng: number; lat: number })
    const bi = b.data?.inputs ?? {}
    return { southwest: corner(bi.southwest), northeast: corner(bi.northeast) }
  }

  const isGeoJsonFile = (n: NoodlesNode) =>
    n.type === 'FileOp' &&
    ['json', 'geojson'].includes(String(inputs(n).format)) &&
    typeof inputs(n).url === 'string'

  // --- GeoJSON -> tables of features ------------------------------------------------------
  /** Where a Noodles GeoJSON value is in the document: the node and port of its features. */
  const featureTables = new Map<string, { node: string; port: string }>()
  const features = (id: string, port = ''): { node: string; port: string } => {
    const key = `${id}\u0000${port}`
    const cached = featureTables.get(key)
    if (cached) return cached
    const n = byId.get(id)
    if (!n) throw new MigrationError(`Missing node ${id}`)
    let made: { node: string; port: string }
    if (n.type === 'FileOp') {
      // The file's geojson node: `features` here, its vertex rows for layers
      source(id, true)
      made = { node: id, port: 'features' }
    } else if (n.type === 'CodeOp') {
      if (!sources.has(id) && !codeNode(n)) {
        throw new MigrationError(
          `${id}: GeoJSON from a CodeOp that reads op(), the timeline or this is not converted`
        )
      }
      used.add(id)
      sources.set(id, id)
      made = { node: id, port: 'out' }
    } else if (n.type === 'GeoJsonOp') {
      // A FeatureCollection of features other operators made: their rows, together
      used.add(id)
      nodes.push({ id, op: 'union', name: segment(id), ...position(n), params: {} })
      incoming(id, 'features').forEach((e, k) => {
        const from = features(e.source, handleField(e.sourceHandle))
        edge(from.node, from.port, id, 'in', k)
      })
      made = { node: id, port: 'out' }
    } else if (n.type === 'KmlToGeoJsonOp') {
      // DuckDB spatial reads KML itself, from the file the KML text was read from
      const e = incomingOne(id, 'kml')
      const file = e ? byId.get(e.source) : undefined
      const url = file?.type === 'FileOp' ? inputs(file).url : undefined
      if (typeof url !== 'string') {
        throw new MigrationError(`${id}: KML that is not read from a file is not converted`)
      }
      used.add(id)
      if (file) used.add(file.id)
      nodes.push({ id, op: 'geojson', name: segment(id), ...position(n), params: { url } })
      made = { node: id, port: 'features' }
    } else if (n.type === 'GeoParquetOp') {
      made = { node: source(id), port: 'out' }
    } else if (n.type === 'ShapefileOp') {
      // DuckDB spatial reads a shapefile, with its .dbf and .shx beside it for properties
      used.add(id)
      const url = String(inputs(n).url ?? '')
      if (!url) throw new MigrationError(`${id}: a Shapefile needs a URL`)
      nodes.push({ id, op: 'geojson', name: segment(id), ...position(n), params: { url } })
      if (String(inputs(n).encoding ?? 'utf-8').toLowerCase() !== 'utf-8')
        warnings.push(`${id}: encoding '${inputs(n).encoding}' is read as UTF-8`)
      made = { node: id, port: 'features' }
    } else if (n.type === 'OverpassOp') {
      // The query runs in the engine, against the public endpoint unless the node says otherwise
      if (incomingOne(id, 'query'))
        throw new MigrationError(`${id}: a wired query is not converted`)
      used.add(id)
      const i = inputs(n)
      const b = boundsOf(id, 'bbox', i.bbox as BboxValue)
      nodes.push({
        id,
        op: 'overpass',
        name: segment(id),
        ...position(n),
        params: {
          query: Array.isArray(i.query) ? i.query.join('\n') : String(i.query),
          endpoint: 'https://overpass.openstreetmap.fr/api/interpreter',
          west: b.southwest.lng,
          south: b.southwest.lat,
          east: b.northeast.lng,
          north: b.northeast.lat,
        },
      })
      made = { node: id, port: 'out' }
    } else if (GIS_CONVERSIONS[n.type]) {
      made = gisNode(n, port)
    } else {
      throw new MigrationError(`${id}: GeoJSON from ${n.type} is not converted`)
    }
    featureTables.set(key, made)
    return made
  }

  /** A turf operator as the planner's geometry operator, wired from the features it reads. */
  const gisNode = (n: NoodlesNode, port: string): { node: string; port: string } => {
    const c = GIS_CONVERSIONS[n.type]
    const i = { ...c.defaults, ...(n.data?.inputs ?? {}) }
    if (!used.has(n.id)) {
      let params: Record<string, ParamValue>
      try {
        params = c.params(i)
      } catch (err) {
        if (err instanceof GisConversionError) throw new MigrationError(`${n.id}: ${err.message}`)
        throw err
      }
      used.add(n.id)
      nodes.push({ id: n.id, op: c.op, name: segment(n.id), ...position(n), params })
      for (const e of project.edges.filter(x => x.target === n.id)) {
        const field = handleField(e.targetHandle)
        const into = c.inputs[field]
        if (into) {
          const from = features(e.source, handleField(e.sourceHandle))
          edge(from.node, from.port, n.id, into)
        } else if (c.numbers?.[field]) {
          wiredNumber(n.id, field, n.id, c.numbers[field])
        } else {
          throw new MigrationError(`${n.id}: a wired ${field} is not converted`)
        }
      }
    }
    const outputs = typeof c.outputs === 'function' ? c.outputs(i) : c.outputs
    const out = outputs[port || Object.keys(outputs)[0]]
    if (!out) throw new MigrationError(`${n.id}: its ${port} output is not converted`)
    return { node: n.id, port: out }
  }

  // --- accessors -> row nodes, grouped by the data source they read ---------------------
  const chains = new Map<string, Map<string, RowNode>>()
  const chainOf = (src: string) => {
    const existing = chains.get(src)
    if (existing) return existing
    const created = new Map<string, RowNode>()
    chains.set(src, created)
    return created
  }

  const colorNodes = new Set<string>()

  /** What a layer input (or an accessor op's input) is: a literal, or wired from an op. */
  const resolve = (src: string, nodeId: string, field: string, literal: unknown): Value => {
    const e = incomingOne(nodeId, field)
    if (!e) return { kind: 'const', value: literal }
    const from = byId.get(e.source)
    if (from && FOLDED.has(from.type)) {
      return { kind: 'const', value: folded(nodeId, field, from, handleField(e.sourceHandle)) }
    }
    return resolveOutput(src, e.source, widthOf(field))
  }

  /**
   * An ExtentOp as a planner extent: min and max computed in SQL over the source's rows. Its
   * data must be those rows (directly, or ExpressionOp `d.features` of a GeoJSON source) and its
   * accessor an expression the planner can read.
   */
  const extentNode = (src: string, id: string) => {
    if (used.has(id)) return
    const n = byId.get(id) as NoodlesNode
    let data = incomingOne(id, 'data')?.source
    const via = data ? byId.get(data) : undefined
    if (via?.type === 'ExpressionOp' && String(inputs(via).expression).trim() === 'd.features') {
      used.add(via.id)
      data = incomingOne(via.id, 'data')?.source
    }
    if (data !== src) throw new MigrationError(`${id}: an Extent over other rows is not converted`)
    const accessor = byId.get(incomingOne(id, 'accessor')?.source ?? '')
    const expr =
      accessor?.type === 'AccessorOp'
        ? translateAccessor(String(inputs(accessor).expression))
        : undefined
    if (!expr) throw new MigrationError(`${id}: its accessor needs JS the planner can't express`)
    used.add(id)
    nodes.push({ id, op: 'extent', name: segment(id), ...position(n), params: { input: expr } })
    edge(src, sourcePort.get(src) ?? 'out', id, 'in')
  }

  /** JS functions made for accessors, by accessor id: one node each, shared by every chain. */
  const jsFunctions = new Map<string, string>()

  const resolveOutput = (src: string, id: string, width = 1): Value => {
    const n = byId.get(id)
    if (!n) throw new MigrationError(`Missing node ${id}`)
    const chain = chainOf(src)
    const existing = chain.get(id)
    if (existing) return { kind: 'row', expr: existing.attribute }
    const i = inputs(n)
    const attribute = attributeName(id)
    // An accessor read by layers on two sources (a color shared by trails and their heads) is
    // one row node per source; the copies are named for their source.
    const docId = (key: string) =>
      [...chains.values()].some(c => c !== chain && c.has(id)) ? `${key}-${segment(src)}` : key
    const add = (
      op: string,
      params: Record<string, ParamValue>,
      reads: string[],
      key = id,
      name = attribute
    ) => {
      const nodeId = docId(key)
      chain.set(key, {
        node: { id: nodeId, op, name: segment(nodeId), ...position(n), params },
        reads: new Set(reads),
        attribute: name,
      })
      used.add(id)
      return { kind: 'row' as const, expr: name }
    }
    const rowReads = (...vs: Value[]) => vs.flatMap(v => (v.kind === 'row' ? [v.expr] : []))
    const exprOf = (v: Value, what: string): string => {
      if (v.kind === 'row') return v.expr
      if (v.kind === 'const' && typeof v.value === 'number') return lit(v.value)
      throw new MigrationError(`${id}: ${what} is not a number`)
    }

    switch (n.type) {
      case 'AccessorOp': {
        const source = (accessorRewrites.get(src) ?? (x => x))(String(i.expression ?? ''))
        const expr = translateAccessor(source, indexNames.get(src))
        if (expr) return add('attribute', { name: attribute, expression: expr }, [])
        const text = translateStringAccessor(source)
        if (!text) {
          // JS the expression language has no words for runs as a JS function DuckDB calls
          // per row, with the columns it reads as arguments
          const js = jsAccessor(source)
          if (!js) {
            throw new MigrationError(`${id}: '${i.expression}' needs JS the planner can't express`)
          }
          let fn = jsFunctions.get(id)
          if (!fn) {
            fn = `${attribute}_fn`
            jsFunctions.set(id, fn)
            nodes.push({
              id: `${id}-fn`,
              op: 'js-function',
              name: fn,
              x: position(n).x,
              y: position(n).y - 120,
              params: { name: fn, params: js.columns.join(', '), width, body: js.body },
            })
          }
          return add(
            'attribute',
            { name: attribute, expression: `${fn}(${js.columns.join(', ')})` },
            []
          )
        }
        const value = add('attribute', { name: attribute, expression: text }, [])
        const row = chain.get(id)
        if (row) row.stringValued = true
        return value
      }
      case 'MapRangeOp': {
        const val = resolve(src, id, 'val', i.val)
        if (val.kind === 'const') {
          const [a, b, c, d] = ['inMin', 'inMax', 'outMin', 'outMax'].map(k => num(i[k], 0))
          return { kind: 'const', value: c + ((d - c) * (num(val.value, 0) - a)) / (b - a) }
        }
        const params: Record<string, ParamValue> = {
          input: exprOf(val, 'val'),
          name: attribute,
          kind: 'linear',
          // d3's scaleLinear, which MapRange used, does not clamp.
          clamp: false,
        }
        for (const [k, fallback] of [
          ['inMin', 0],
          ['inMax', 1],
          ['outMin', 0],
          ['outMax', 1],
        ] as const) {
          const e = incomingOne(id, k)
          if (e && byId.get(e.source)?.type === 'ExtentOp') {
            extentNode(src, e.source)
            edge(e.source, handleField(e.sourceHandle), id, `par:${k}`)
          } else if (e) {
            throw new MigrationError(
              `${id}: ${k} from ${byId.get(e.source)?.type} is not converted`
            )
          } else {
            params[k] = num(i[k], fallback)
          }
        }
        return add('map-range', params, rowReads(val))
      }
      case 'ColorRampOp': {
        const value = resolve(src, id, 'value', i.value)
        if (value.kind !== 'row')
          throw new MigrationError(`${id}: a constant ColorRamp is not converted yet`)
        return add(
          'color-ramp',
          { input: value.expr, ramp: String(i.colorScheme), min: 0, max: 1, name: attribute },
          rowReads(value)
        )
      }
      case 'CategoricalColorRampOp': {
        const value = resolve(src, id, 'value', i.value)
        if (value.kind !== 'row')
          throw new MigrationError(`${id}: a constant CategoricalColorRamp is not converted yet`)
        const scheme = String(i.colorScheme)
        const size = CATEGORICAL_SCHEMES[scheme]
        if (!size)
          throw new MigrationError(`${id}: the stepped scheme '${scheme}' is not converted yet`)
        // An ordinal scale gives each category one of the first `steps` colors. Here a hash
        // picks the color, so one category always has one color, though not the one d3 picked.
        const steps = Math.min(Math.max(Math.round(num(i.steps, 8)), 3), size)
        const index = `${attribute}_index`
        add(
          'attribute',
          {
            name: index,
            expression: `(category(${value.expr}, ${lit(steps)}) + 0.5) / ${lit(size)}`,
          },
          rowReads(value),
          `${id}-index`,
          index
        )
        return add(
          'color-ramp',
          { input: index, ramp: `categorical-${scheme}`, min: 0, max: 1, name: attribute },
          [index]
        )
      }
      case 'MathOp': {
        const op = String(i.operator)
        const a = resolve(src, id, 'a', i.a)
        const b = resolve(src, id, 'b', i.b)
        if (!MATH[op]) throw new MigrationError(`${id}: Math '${op}' is not converted`)
        if (a.kind === 'const' && b.kind === 'const') {
          return { kind: 'const', value: MATH_JS[op](num(a.value, 0), num(b.value, 0)) }
        }
        return add(
          'attribute',
          { name: attribute, expression: MATH[op](exprOf(a, 'a'), exprOf(b, 'b')) },
          rowReads(a, b)
        )
      }
      case 'ColorOp': {
        if (!colorNodes.has(id)) {
          const c = parseHex(i.color)
          if (!c) throw new MigrationError(`${id}: color '${i.color}' is not a hex color`)
          if (c.alpha !== 255) warnings.push(`${id}: dropped alpha ${c.alpha} from ${i.color}`)
          nodes.push({
            id,
            op: 'color',
            name: segment(id),
            ...position(n),
            params: { color: c.rgb },
          })
          colorNodes.add(id)
          used.add(id)
        }
        return { kind: 'color', node: segment(id) }
      }
      default:
        throw new MigrationError(`${id}: ${n.type} feeding a layer is not converted yet`)
    }
  }

  /** A color input as a planner color channel and a constant color param. */
  const colorInput = (
    v: Value,
    owner: string,
    field: string
  ): { channel?: string; color?: ParamValue } => {
    if (v.kind === 'row') return { channel: v.expr }
    if (v.kind === 'color') return { color: { ref: `${v.node}/color` } }
    if (Array.isArray(v.value)) return { color: (v.value as number[]).slice(0, 3) }
    const c = parseHex(v.value)
    if (!c) throw new MigrationError(`${owner}: ${field} '${v.value}' is not a color`)
    if (c.alpha !== 255) warnings.push(`${owner}: dropped alpha ${c.alpha} from ${field}`)
    return { color: c.rgb }
  }

  // Accessors for colors return 0–255 arrays or hex strings in Noodles, and 0–1 in the planner.
  const colorChannel = (v: Value) => {
    if (v.kind !== 'row') return v
    const writer = [...chains.values()]
      .flatMap(c => [...c.values()])
      .find(r => r.attribute === v.expr)
    if (writer?.stringValued) {
      if (!writer.color) {
        writer.node.params.expression = `hex_color(${writer.node.params.expression})`
        writer.color = true
      }
      return v
    }
    return writer?.node.op === 'attribute'
      ? { kind: 'row' as const, expr: `(${v.expr}) / 255.0` }
      : v
  }

  /**
   * A position channel. An accessor that returns a row's `[lng, lat]` array reads a list column
   * (JSON gives one), which SQL indexes: the attribute becomes `[item(c, 0), item(c, 1)]`.
   */
  const positionOf = (v: Value, owner: string): string => {
    if (v.kind === 'const' && Array.isArray(v.value) && v.value.every(x => typeof x === 'number')) {
      return `[${(v.value as number[]).map(lit).join(', ')}]`
    }
    if (v.kind !== 'row') throw new MigrationError(`${owner}: a constant position is not converted`)
    const writer = [...chains.values()]
      .flatMap(c => [...c.values()])
      .find(r => r.attribute === v.expr)
    const expression = writer?.node.op === 'attribute' ? String(writer.node.params.expression) : ''
    if (/^[A-Za-z_]\w*$/.test(expression) && writer) {
      writer.node.params.expression = `[item(${expression}, 0.0), item(${expression}, 1.0)]`
    }
    return v.expr
  }

  const blendOf = (layer: NoodlesNode): string => {
    const e = incomingOne(layer.id, 'parameters')
    if (!e) return 'normal'
    const b = byId.get(e.source)
    if (b?.type !== 'BlendingOp')
      throw new MigrationError(`${layer.id}: parameters from ${b?.type} are not converted`)
    used.add(b.id)
    const mode = String(inputs(b).mode)
    if (mode === 'custom') {
      warnings.push(`${b.id}: custom blending is not converted; using normal`)
      return 'normal'
    }
    return mode
  }

  /** A layer input that must not vary per row, as a number. */
  const constantOf = (value: Value, owner: string, field: string): number => {
    if (value.kind !== 'const')
      throw new MigrationError(`${owner}: a per-row ${field} is not converted`)
    return num(value.value, 0)
  }
  /** A layer input that must not vary per row, as it is. */
  const literalOf = (value: Value, owner: string, field: string): unknown => {
    if (value.kind !== 'const')
      throw new MigrationError(`${owner}: a per-row ${field} is not converted`)
    return value.value
  }
  /** A pixel offset, [x, y] or { x, y }, that does not vary per row. */
  const offsetOf = (value: Value, owner: string): [number, number] => {
    const o = literalOf(value, owner, 'getPixelOffset')
    if (Array.isArray(o)) return [num(o[0], 0), num(o[1], 0)]
    const xy = (o ?? {}) as { x?: unknown; y?: unknown }
    return [num(xy.x, 0), num(xy.y, 0)]
  }
  /**
   * A string channel: the column an accessor reads (`d.city`), with the attribute that only
   * copied it dropped, or the string attribute SQL computes for it.
   */
  const stringColumn = (value: Value, owner: string, field: string): string => {
    if (value.kind !== 'row') throw new MigrationError(`${owner}: ${field} must read a column`)
    const copy = [...chains.values()]
      .flatMap(c => [...c.entries()])
      .find(([, r]) => r.attribute === value.expr)
    const column =
      copy && copy[1].node.op === 'attribute' ? String(copy[1].node.params.expression) : value.expr
    if (copy && /^[A-Za-z_]\w*$/.test(column) && column !== value.expr) {
      for (const c of chains.values()) c.delete(copy[0])
      used.add(copy[0])
      return column
    }
    return value.expr
  }

  /**
   * Rows whose list column is a path ([[lng, lat], ...]) or a polygon (a ring, or a list of
   * rings) as the vertex rows of the geometry SQL makes of it, as a GeoJSON source has them.
   */
  const listGeometry = (
    src: string,
    column: string,
    kind: 'line' | 'polygon',
    near: NoodlesNode
  ): string => {
    const id = `${src}-${column}-${kind}s`
    if (sources.has(id)) return sources.get(id) as string
    const c = `to_json(${sqlIdent(column)})`
    const coordinates =
      kind === 'line'
        ? c
        : `CASE WHEN json_type(${c}, '$[0][0]') = 'ARRAY' THEN ${c} ELSE json_array(${c}) END`
    const type = kind === 'line' ? 'LineString' : 'Polygon'
    const at = position(near)
    nodes.push({
      id,
      op: 'sql',
      name: segment(id),
      x: at.x - 520,
      y: at.y,
      params: {
        query: `SELECT * EXCLUDE (${sqlIdent(column)}), ST_GeomFromGeoJSON(json_object('type', '${type}', 'coordinates', ${coordinates})) AS geom FROM {{input0}}`,
      },
    })
    edge(src, sourcePort.get(src) ?? 'out', id, 'in0')
    const rowsId = `${id}-rows`
    nodes.push({
      id: rowsId,
      op: 'geojson',
      name: segment(rowsId),
      x: at.x - 260,
      y: at.y,
      params: { url: '' },
    })
    edge(id, 'out', rowsId, 'in')
    sourcePort.set(rowsId, kind === 'line' ? 'lines' : 'polygons')
    sources.set(id, rowsId)
    return rowsId
  }

  /** Rows with a cell id as the vertex rows of their cells' polygons. */
  const cellGeometry = (src: string, column: string, kind: string, near: NoodlesNode): string => {
    const id = `${src}-${column}-cells`
    if (sources.has(id)) return sources.get(id) as string
    const at = position(near)
    nodes.push({
      id,
      op: 'cells',
      name: segment(id),
      x: at.x - 520,
      y: at.y,
      params: { kind, column },
    })
    edge(src, sourcePort.get(src) ?? 'out', id, 'in')
    const rowsId = `${id}-rows`
    nodes.push({
      id: rowsId,
      op: 'geojson',
      name: segment(rowsId),
      x: at.x - 260,
      y: at.y,
      params: { url: '' },
    })
    edge(id, 'out', rowsId, 'in')
    sourcePort.set(rowsId, 'polygons')
    sources.set(id, rowsId)
    return rowsId
  }

  const dropUnmapped = (layer: NoodlesNode, mapped: string[]) => {
    for (const k of Object.keys(layer.data?.inputs ?? {})) {
      if (!mapped.includes(k) && !LAYER_IGNORED.has(k)) warnings.push(`${layer.id}: dropped '${k}'`)
    }
  }

  // --- host operators: their own inputs as parameters, wired by `par:` handles -----------
  const hostNodes = new Set<string>()

  // --- values computed at conversion --------------------------------------------------------
  // A Number the timeline moves is not a constant, whatever its stored value
  const timelineText = JSON.stringify(project.timeline ?? '')
  const animated = (id: string) => timelineText.includes(JSON.stringify(id).slice(1, -1))

  /**
   * A value operator's output computed from literal inputs, or undefined when an input changes
   * while playing (a keyframed Number, a Time) and it cannot be. Marks what it read as converted.
   */
  const foldValue = (id: string, port: string): { value: unknown } | undefined => {
    const n = byId.get(id)
    if (!n) return undefined
    const own = n.data?.inputs ?? {}
    const read = (field: string, fallback: unknown): unknown => {
      const e = incomingOne(id, field)
      if (!e) return own[field] ?? fallback
      const v = foldValue(e.source, handleField(e.sourceHandle))
      if (!v) throw new NotFoldable()
      return v.value
    }
    const n0 = (field: string, fallback: number) => num(read(field, fallback), fallback)
    const point = (v: unknown): { lng: number; lat: number } =>
      Array.isArray(v)
        ? { lng: num(v[0], 0), lat: num(v[1], 0) }
        : (v as { lng: number; lat: number })
    const vec = (v: unknown): Record<string, number> =>
      Array.isArray(v)
        ? { x: num(v[0], 0), y: num(v[1], 0), z: num(v[2], 0) }
        : (v as Record<string, number>)
    const viewport = () =>
      new WebMercatorViewport({
        ...(read('viewState', {
          latitude: 40.7128,
          longitude: -74.006,
          zoom: 12,
          pitch: 0,
          bearing: 0,
        }) as object),
        width: n0('width', 1920),
        height: n0('height', 1080),
      })
    let value: unknown
    try {
      switch (n.type) {
        case 'NumberOp':
          if (animated(id)) return undefined
          value = n0('val', 0)
          break
        case 'BooleanOp':
          value = read('val', false) === true
          break
        case 'StringOp':
          value = String(read('val', ''))
          break
        case 'DateTimeOp':
          value = read('date', '')
          break
        case 'CombineXYOp':
          value = { x: n0('x', 0), y: n0('y', 0) }
          break
        case 'SplitXYOp':
        case 'SplitXYZOp':
          value = vec(read('vec', { x: 0, y: 0, z: 0 }))[port]
          break
        case 'CombineRGBAOp':
          {
            const [r, g, b, a] = ['r', 'g', 'b', 'a'].map((c, i) =>
              Math.round(n0(c, i === 3 ? 1 : 0))
            )
            value = colorToHex([r, g, b, a])
          }
          break
        case 'HSLOp':
          value = hsl(n0('h', 0), n0('s', 0.5), n0('l', 0.8)).formatHex()
          break
        case 'SplitRGBAOp': {
          const c = read('color', null)
          if (typeof c !== 'string') return undefined
          value = Object.fromEntries(['r', 'g', 'b', 'a'].map((k, i) => [k, hexToColor(c)[i]]))[
            port
          ]
          break
        }
        case 'BoundsOp': {
          const sw = point(read('southwest', { lng: 0, lat: 0 }))
          const ne = point(read('northeast', { lng: 0, lat: 0 }))
          value = [
            [Math.min(sw.lng, ne.lng), Math.min(sw.lat, ne.lat)],
            [Math.max(sw.lng, ne.lng), Math.max(sw.lat, ne.lat)],
          ]
          break
        }
        case 'SplitMapViewStateOp':
          value = (read('viewState', {}) as Record<string, unknown>)[port]
          break
        case 'ProjectOp': {
          const p = point(read('position', { lng: 0, lat: 0 }))
          const [x, y] = viewport().project([p.lng, p.lat])
          value = { x, y }
          break
        }
        case 'UnprojectOp': {
          const s = vec(read('screenPosition', { x: 0, y: 0 }))
          const [lng, lat] = viewport().unproject([s.x, s.y])
          value = { lng, lat }
          break
        }
        default:
          return undefined
      }
    } catch (err) {
      if (err instanceof NotFoldable) return undefined
      throw err
    }
    used.add(id)
    return { value }
  }

  /** A value operator's output, written into a parameter: the value, or an error naming why not. */
  const folded = (owner: string, field: string, src: NoodlesNode, port: string): unknown => {
    const v = foldValue(src.id, port)
    if (!v) {
      throw new MigrationError(
        `${owner}: ${field} from ${src.type} changes while playing; it is not converted`
      )
    }
    return v.value
  }

  /** A Bezier Curve or Ramp as the planner scalar operator that computes it. */
  const curveNode = (n: NoodlesNode): void => {
    if (used.has(n.id)) return
    used.add(n.id)
    const own = n.data?.inputs ?? {}
    const params: Record<string, ParamValue> =
      n.type === 'RampOp'
        ? {
            position: num(own.position, 0),
            stops: Array.isArray(own.stops) && own.stops.length ? JSON.stringify(own.stops) : '',
          }
        : {
            factor: num(own.factor, 0.5),
            ...(own.curve ? { curve: own.curve as ParamValue } : {}),
          }
    nodes.push({ id: n.id, op: CURVES[n.type], name: segment(n.id), ...position(n), params })
    wiredNumber(
      n.id,
      n.type === 'RampOp' ? 'position' : 'factor',
      n.id,
      n.type === 'RampOp' ? 'position' : 'factor'
    )
  }

  /**
   * A Noodles view, widget, extension or tile layer as the deck operator that replaces it: the
   * same parameter names, values and wires, and outputs of the same names.
   */
  const deckOpNode = (n: NoodlesNode, deck: DeckOp): void => {
    hostNodes.add(n.id)
    used.add(n.id)
    const own = n.data?.inputs ?? {}
    const names = new Set(deck.def.params.map(p => p.name))
    const params: Record<string, ParamValue> = {}
    for (const [k, v] of Object.entries(own)) {
      if (names.has(k)) params[k] = v as ParamValue
      else if (k !== 'colorRamp') warnings.push(`${n.id}: dropped '${k}'`)
    }
    nodes.push({ id: n.id, op: deck.def.type, name: segment(n.id), ...position(n), params })
    for (const e of project.edges.filter(x => x.target === n.id)) {
      const field = handleField(e.targetHandle)
      const src = byId.get(e.source)
      if (!src) continue
      if (n.type === 'LegendWidgetOp' && field === 'colorRamp') {
        // A legend's ramp is its scheme, by name
        if (src.type !== 'ColorRampOp') {
          throw new MigrationError(`${n.id}: a color ramp from ${src.type} is not converted`)
        }
        params.colorScheme = String(inputs(src).colorScheme)
        used.add(src.id)
        continue
      }
      if (!names.has(field)) throw new MigrationError(`${n.id}: a wired ${field} is not converted`)
      if (src.type === 'AccessorOp') {
        throw new MigrationError(`${n.id}: a per-row ${field} is not converted`)
      }
      if (FOLDED.has(src.type)) {
        params[field] = folded(n.id, field, src, handleField(e.sourceHandle)) as ParamValue
        continue
      }
      if (CURVES[src.type]) curveNode(src)
      else if (src.type === 'NumberOp') numberNode(src)
      if (CURVES[src.type] || src.type === 'NumberOp') {
        edge(src.id, 'out', n.id, `par:${field}`)
        continue
      }
      hostNode(src.id)
      edge(
        src.id,
        handleField(e.sourceHandle),
        n.id,
        `par:${field}`,
        deck.lists?.includes(field)
          ? edges.filter(x => x.target === n.id && x.targetPort === `par:${field}`).length
          : undefined
      )
    }
  }

  const hostNode = (id: string): void => {
    if (hostNodes.has(id)) return
    const n = byId.get(id)
    if (!n) throw new MigrationError(`Missing node ${id}`)
    // A deck operator takes constants where its Noodles class took per-row accessors
    const deck = DECK_OP_FOR.get(n.type)
    if (deck) {
      deckOpNode(n, deck)
      return
    }
    if (ACCESSOR_OPS.has(n.type)) {
      throw new MigrationError(`${id}: ${n.type} takes per-row accessors; it is not converted yet`)
    }
    if (n.type === 'ContainerOp' || n.type.startsWith('ForLoop')) {
      throw new MigrationError(`${id}: ${n.type} is not converted yet`)
    }
    // Only an operator the catalog keeps on the host, or one a later step converts, is one
    const plan = OP_CATALOG[n.type]
    if (!plan) throw new MigrationError(`${id}: ${n.type} has no conversion plan`)
    if (plan.becomes !== 'host' && !plan.hostWhen && !plan.pending) {
      throw new MigrationError(
        `${id}: ${n.type} becomes ${plan.becomes} nodes, not a host operator`
      )
    }
    hostNodes.add(id)
    used.add(id)
    nodes.push({
      id,
      op: n.type,
      name: segment(id),
      ...position(n),
      params: { ...(n.data?.inputs ?? {}) } as Record<string, ParamValue>,
    })
    for (const e of project.edges.filter(x => x.target === id)) {
      const field = handleField(e.targetHandle)
      const src = byId.get(e.source)
      if (!src) continue
      if (FOLDED.has(src.type)) {
        const self = nodes.find(x => x.id === id)
        if (self)
          self.params[field] = folded(id, field, src, handleField(e.sourceHandle)) as ParamValue
        continue
      }
      if (CURVES[src.type]) curveNode(src)
      else if (src.type === 'NumberOp') numberNode(src)
      if (CURVES[src.type] || src.type === 'NumberOp') {
        edge(src.id, 'out', id, `par:${field}`)
        continue
      }
      if (src.type === 'FileOp') {
        // A host operator reads a file as FileOp parsed it (a GeoJSON object, say), so the
        // file is a host FileOp; when planner layers read it too, that one is a second node.
        const plannerReads = project.edges.some(
          x => x.source === src.id && ACCESSOR_OPS.has(byId.get(x.target)?.type ?? '')
        )
        const fileId = plannerReads ? `${src.id}-json` : src.id
        if (!hostNodes.has(fileId)) {
          hostNodes.add(fileId)
          used.add(src.id)
          nodes.push({
            id: fileId,
            op: 'FileOp',
            name: segment(fileId),
            ...position(src),
            y: position(src).y + (plannerReads ? 160 : 0),
            params: { ...(src.data?.inputs ?? {}) } as Record<string, ParamValue>,
          })
        }
        edge(fileId, handleField(e.sourceHandle) || 'data', id, `par:${field}`)
        continue
      }
      if (PLANNER_SOURCES.has(src.type)) {
        // The host operator reads the relation's rows as JS objects.
        source(src.id)
        edge(src.id, sourcePort.get(src.id) ?? 'out', id, `par:${field}`)
        continue
      }
      hostNode(src.id)
      edge(src.id, handleField(e.sourceHandle), id, `par:${field}`)
    }
  }
  const numberNode = (n: NoodlesNode) => {
    if (used.has(n.id)) return
    used.add(n.id)
    nodes.push({
      id: n.id,
      op: 'number',
      name: segment(n.id),
      ...position(n),
      params: { value: num(inputs(n).val, 0) },
    })
  }

  /**
   * A GeoJsonLayer as the planner layers it draws: polygons (fill and outline), lines and
   * points (circles, labels), each reading its kind of row from the source's `all` table through
   * one shared chain of attribute nodes. Its sublayer order is GeoJsonLayer's.
   */
  const geojsonLayer = (
    layer: NoodlesNode,
    src: string,
    i: Record<string, unknown>,
    v: (field: string) => Value,
    common: Record<string, ParamValue>,
    index: number
  ) => {
    const at = position(layer)
    const rows = (kind: 'polygon' | 'line' | 'point', dy: number) => {
      const id = `${layer.id}-${kind}-rows`
      nodes.push({
        id,
        op: 'filter',
        name: segment(id),
        x: at.x - 260,
        y: at.y + dy,
        params: { mode: 'expression', expression: `kind == '${kind}'` },
      })
      layerSource.set(id, src)
      return id
    }
    const draw = (
      id: string,
      op: string,
      from: string,
      dy: number,
      params: Record<string, ParamValue>,
      k: number
    ) => {
      nodes.push({
        id,
        op,
        name: segment(id),
        x: at.x,
        y: at.y + dy,
        params: { ...common, ...params },
      })
      edge(from, 'out', id, 'in')
      edge(id, 'out', deckOp.id, 'layers', index + k)
    }
    const constant = (value: Value, field: string): number => {
      if (value.kind !== 'const')
        throw new MigrationError(`${layer.id}: a per-row ${field} is not converted`)
      return num(value.value, 0)
    }
    const fill = colorInput(colorChannel(v('getFillColor')), layer.id, 'getFillColor')
    const line = colorInput(colorChannel(v('getLineColor')), layer.id, 'getLineColor')
    const lineWidth = constant(v('getLineWidth'), 'getLineWidth') * num(i.lineWidthScale, 1)
    const geo = { position: '[lng, lat]', pathId: 'id', order: 'vertex' }

    const elevation = v('getElevation')
    draw(
      layer.id,
      'polygon',
      rows('polygon', 0),
      0,
      {
        ...geo,
        ringId: 'ring',
        color: fill.channel ?? '',
        ...(fill.color ? { fillColor: fill.color } : {}),
        lineColorChannel: line.channel ?? '',
        ...(line.color ? { lineColor: line.color } : {}),
        filled: i.filled !== false,
        stroked: i.stroked !== false,
        lineWidthScale: lineWidth,
        lineWidthUnits: String(i.lineWidthUnits),
        lineWidthMinPixels: num(i.lineWidthMinPixels, 0),
        extruded: i.extruded === true,
        elevation: elevation.kind === 'row' ? elevation.expr : '',
        elevationScale:
          num(i.elevationScale, 1) *
          (elevation.kind === 'row' ? 1 : constant(elevation, 'getElevation')),
      },
      0
    )
    draw(
      `${layer.id}-lines`,
      'path',
      rows('line', 160),
      160,
      {
        ...geo,
        color: line.channel ?? '',
        ...(line.color ? { lineColor: line.color } : {}),
        widthScale: lineWidth,
        widthUnits: String(i.lineWidthUnits),
        widthMinPixels: num(i.lineWidthMinPixels, 0),
      },
      1
    )
    const pointType = String(i.pointType)
    const points = rows('point', 320)
    if (pointType.includes('circle')) {
      draw(
        `${layer.id}-points`,
        'scatter',
        points,
        320,
        {
          position: '[lng, lat]',
          color: fill.channel ?? '',
          ...(fill.color ? { fillColor: fill.color } : {}),
          radius: '',
          radiusScale: constant(v('getPointRadius'), 'getPointRadius') * num(i.pointRadiusScale, 1),
          radiusUnits: String(i.pointRadiusUnits),
        },
        2
      )
    }
    if (pointType.includes('text')) {
      const text = v('getText')
      if (text.kind !== 'row' || !/^[A-Za-z_]\w*$/.test(text.expr)) {
        throw new MigrationError(`${layer.id}: point text must be a property`)
      }
      // A text channel names a column; drop the attribute node that only copied it.
      const copy = [...chains.values()]
        .flatMap(c => [...c.entries()])
        .find(([, r]) => r.attribute === text.expr)
      const column =
        copy && copy[1].node.op === 'attribute' ? String(copy[1].node.params.expression) : text.expr
      if (copy && column !== text.expr) {
        for (const c of chains.values()) c.delete(copy[0])
        used.add(copy[0])
      }
      const textColor = colorInput(v('getTextColor'), layer.id, 'getTextColor')
      draw(
        `${layer.id}-labels`,
        'text',
        points,
        400,
        {
          position: '[lng, lat]',
          text: column,
          size: constant(v('getTextSize'), 'getTextSize') * num(i.textSizeScale, 1),
          ...(textColor.color ? { textColor: textColor.color } : {}),
          offsetY: 0,
        },
        3
      )
    }
    if (pointType.includes('icon')) warnings.push(`${layer.id}: icon points are not converted`)
    dropUnmapped(layer, [
      'opacity',
      'visible',
      'pointType',
      'getPointRadius',
      'pointRadiusUnits',
      'pointRadiusScale',
      'getText',
      'getTextSize',
      'getTextColor',
      'textSizeScale',
      'filled',
      'getFillColor',
      'stroked',
      'getLineColor',
      'getLineWidth',
      'lineWidthUnits',
      'lineWidthScale',
      'lineWidthMinPixels',
      'extruded',
      'getElevation',
      'elevationScale',
    ])
  }

  // --- layers, in the deck's order -------------------------------------------------------
  const layerEdges = incoming(deckOp.id, 'layers')
  const layerSource = new Map<string, string>()
  /** Where a layer's output goes: the deck's layers, or a switch's inputs. */
  interface Target {
    node: string
    port: string
    index: number
  }
  const migrateLayer = (layerId: string, fromPort: string, target: Target): void => {
    const layer = byId.get(layerId)
    if (!layer) throw new MigrationError(`Missing layer ${layerId}`)
    if (layer.type === 'SwitchOp') {
      switchNode(layer, target)
      return
    }
    if (!PLANNER_LAYERS.has(layer.type)) {
      hostNode(layer.id)
      edge(layer.id, fromPort, target.node, target.port, target.index)
      return
    }
    const dataEdge = incomingOne(layer.id, 'data')
    if (!dataEdge) throw new MigrationError(`${layer.id} has no data`)
    let src = source(
      dataEdge.source,
      layer.type === 'GeoJsonLayerOp',
      handleField(dataEdge.sourceHandle)
    )
    // A trips layer draws vertex rows: its data's path and timestamp lists, unnested.
    if (layer.type === 'TripsLayerOp') {
      src = vertexSource(
        src,
        listColumn(layer.id, 'getPath', 'path'),
        listColumn(layer.id, 'getTimestamps', 'timestamps'),
        layer
      )
    }
    // A path or polygon per row: its coordinate list a geometry, then vertex rows
    const list = LIST_LAYERS[layer.type]
    if (list)
      src = listGeometry(src, listColumn(layer.id, list.field, list.fallback), list.kind, layer)
    // A cell per row: its id the cell's polygon, then vertex rows
    const cell = CELL_LAYERS[layer.type]
    if (cell)
      src = cellGeometry(src, listColumn(layer.id, cell.field, cell.fallback), cell.kind, layer)
    // A DataFilterExtension hides rows outside a range: a filter in SQL, not on the GPU
    for (const e of incoming(layer.id, 'extensions')) {
      const ext = byId.get(e.source)
      if (ext?.type === 'DataFilterExtensionOp') src = dataFilter(ext, src, layer)
    }
    if (layer.type !== 'GeoJsonLayerOp') layerSource.set(layer.id, src)
    const i = inputs(layer)
    const v = (field: string) => resolve(src, layer.id, field, i[field])
    const params: Record<string, ParamValue> = {
      opacity: num(i.opacity, 1),
      blend: blendOf(layer),
    }
    const push = (op: string) =>
      nodes.push({ id: layer.id, op, name: segment(layer.id), ...position(layer), params })
    if (i.visible === false) warnings.push(`${layer.id}: hidden layer converted as visible`)

    switch (layer.type) {
      case 'ScatterplotLayerOp': {
        params.position = positionOf(v('getPosition'), layer.id)
        const fill = colorInput(colorChannel(v('getFillColor')), layer.id, 'getFillColor')
        if (fill.channel) params.color = fill.channel
        else params.color = ''
        if (fill.color) params.fillColor = fill.color
        const radius = v('getRadius')
        const scale = num(i.radiusScale, 1)
        if (radius.kind === 'row') {
          params.radius = radius.expr
          params.radiusScale = scale
        } else if (radius.kind === 'const') {
          // A constant radius is deck's default radius of 1, scaled.
          params.radius = ''
          params.radiusScale = num(radius.value, 20) * scale
        } else {
          throw new MigrationError(`${layer.id}: getRadius from a color is not a radius`)
        }
        params.radiusUnits = String(i.radiusUnits)
        nodes.push({
          id: layer.id,
          op: 'scatter',
          name: segment(layer.id),
          ...position(layer),
          params,
        })
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          'getFillColor',
          'getRadius',
          'radiusScale',
          'radiusUnits',
        ])
        break
      }
      case 'ArcLayerOp': {
        params.source = positionOf(v('getSourcePosition'), layer.id)
        params.target = positionOf(v('getTargetPosition'), layer.id)
        const from = colorInput(colorChannel(v('getSourceColor')), layer.id, 'getSourceColor')
        const to = colorInput(colorChannel(v('getTargetColor')), layer.id, 'getTargetColor')
        params.sourceColor = from.channel ?? ''
        params.targetColor = to.channel ?? ''
        if (from.color) params.fromColor = from.color
        if (to.color) params.toColor = to.color
        const width = v('getWidth')
        if (width.kind === 'row') {
          params.width = width.expr
          params.widthScale = 1
        } else if (width.kind === 'const') {
          params.width = ''
          params.widthScale = num(width.value, 1)
        } else {
          throw new MigrationError(`${layer.id}: getWidth from a color is not a width`)
        }
        params.widthUnits = String(i.widthUnits)
        const height = v('getHeight')
        if (height.kind !== 'const')
          throw new MigrationError(`${layer.id}: a per-row arc height is not converted`)
        params.height = num(height.value, 1)
        nodes.push({ id: layer.id, op: 'arc', name: segment(layer.id), ...position(layer), params })
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getSourcePosition',
          'getTargetPosition',
          'getSourceColor',
          'getTargetColor',
          'getWidth',
          'widthUnits',
          'getHeight',
        ])
        break
      }
      case 'GeoJsonLayerOp': {
        if (target.port !== 'layers') {
          throw new MigrationError(
            `${layer.id}: a GeoJsonLayer into a ${target.port} is not converted`
          )
        }
        geojsonLayer(layer, src, i, v, params, target.index)
        used.add(layer.id)
        wireExtensions(
          layer.id,
          [layer.id, `${layer.id}-lines`, `${layer.id}-points`, `${layer.id}-labels`].filter(id =>
            nodes.some(n => n.id === id)
          )
        )
        return
      }
      case 'TextLayerOp': {
        params.position = positionOf(v('getPosition'), layer.id)
        params.text = stringColumn(v('getText'), layer.id, 'getText')
        const color = colorInput(colorChannel(v('getColor')), layer.id, 'getColor')
        params.color = color.channel ?? ''
        if (color.color) params.textColor = color.color
        const size = v('getSize')
        const scale = num(i.sizeScale, 1)
        params.sizeBy = size.kind === 'row' ? size.expr : ''
        params.size = size.kind === 'row' ? scale : constantOf(size, layer.id, 'getSize') * scale
        params.sizeUnits = String(i.sizeUnits)
        params.angle = constantOf(v('getAngle'), layer.id, 'getAngle')
        ;[params.offsetX, params.offsetY] = offsetOf(v('getPixelOffset'), layer.id)
        params.anchor = String(literalOf(v('getTextAnchor'), layer.id, 'getTextAnchor'))
        params.baseline = String(
          literalOf(v('getAlignmentBaseline'), layer.id, 'getAlignmentBaseline')
        )
        params.fontFamily = String(i.fontFamily)
        params.fontWeight = num(i.fontWeight, 400)
        params.billboard = i.billboard !== false
        params.outlineWidth = num(i.outlineWidth, 0)
        const outline = colorInput(
          i.outlineColor
            ? { kind: 'const', value: i.outlineColor }
            : { kind: 'const', value: '#000000' },
          layer.id,
          'outlineColor'
        )
        if (outline.color) params.outlineColor = outline.color
        params.background = i.background === true
        const background = colorInput(v('getBackgroundColor'), layer.id, 'getBackgroundColor')
        if (background.color) params.backgroundColor = background.color
        push('text')
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          'getText',
          'getColor',
          'getSize',
          'sizeScale',
          'sizeUnits',
          'getAngle',
          'getPixelOffset',
          'getTextAnchor',
          'getAlignmentBaseline',
          'fontFamily',
          'fontWeight',
          'billboard',
          'outlineWidth',
          'outlineColor',
          'background',
          'getBackgroundColor',
        ])
        break
      }
      case 'LineLayerOp':
      case 'GreatCircleLayerOp': {
        params.source = positionOf(v('getSourcePosition'), layer.id)
        params.target = positionOf(v('getTargetPosition'), layer.id)
        const width = v('getWidth')
        params.width = width.kind === 'row' ? width.expr : ''
        params.widthScale =
          num(i.widthScale, 1) *
          (width.kind === 'row' ? 1 : constantOf(width, layer.id, 'getWidth'))
        params.widthUnits = String(i.widthUnits)
        if (layer.type === 'LineLayerOp') {
          const color = colorInput(colorChannel(v('getColor')), layer.id, 'getColor')
          params.color = color.channel ?? ''
          if (color.color) params.lineColor = color.color
          params.widthMinPixels = num(i.widthMinPixels, 0)
          push('line')
        } else {
          // An arc along the great circle, flat: deck's GreatCircleLayer is that ArcLayer
          const from = colorInput(colorChannel(v('getSourceColor')), layer.id, 'getSourceColor')
          const to = colorInput(colorChannel(v('getTargetColor')), layer.id, 'getTargetColor')
          params.sourceColor = from.channel ?? ''
          params.targetColor = to.channel ?? ''
          if (from.color) params.fromColor = from.color
          if (to.color) params.toColor = to.color
          params.greatCircle = true
          params.height = 0
          push('arc')
        }
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getSourcePosition',
          'getTargetPosition',
          'getColor',
          'getSourceColor',
          'getTargetColor',
          'getWidth',
          'widthScale',
          'widthUnits',
          'widthMinPixels',
          'numSegments',
        ])
        break
      }
      case 'PathLayerOp': {
        params.position = '[lng, lat]'
        params.pathId = 'id'
        params.order = 'vertex'
        const color = colorInput(colorChannel(v('getColor')), layer.id, 'getColor')
        params.color = color.channel ?? ''
        if (color.color) params.lineColor = color.color
        const width = v('getWidth')
        params.width = width.kind === 'row' ? width.expr : ''
        params.widthScale =
          num(i.widthScale, 1) *
          (width.kind === 'row' ? 1 : constantOf(width, layer.id, 'getWidth'))
        params.widthUnits = String(i.widthUnits)
        params.widthMinPixels = num(i.widthMinPixels, 0)
        push('path')
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPath',
          'getColor',
          'getWidth',
          'widthScale',
          'widthUnits',
          'widthMinPixels',
        ])
        break
      }
      case 'PolygonLayerOp':
      case 'SolidPolygonLayerOp':
      case 'H3HexagonLayerOp':
      case 'H3ClusterLayerOp':
      case 'S2LayerOp':
      case 'GeohashLayerOp':
      case 'QuadkeyLayerOp':
      case 'A5LayerOp': {
        params.position = '[lng, lat]'
        params.pathId = 'id'
        params.ringId = 'ring'
        params.order = 'vertex'
        const fill = colorInput(colorChannel(v('getFillColor')), layer.id, 'getFillColor')
        params.color = fill.channel ?? ''
        if (fill.color) params.fillColor = fill.color
        const solid = layer.type === 'SolidPolygonLayerOp'
        params.filled = solid || i.filled !== false
        params.stroked = !solid && i.stroked !== false
        if (params.stroked) {
          // Cell layers without a line color draw deck's default, black
          const lineValue: Value =
            'getLineColor' in i ? v('getLineColor') : { kind: 'const', value: '#000000' }
          const line = colorInput(colorChannel(lineValue), layer.id, 'getLineColor')
          params.lineColorChannel = line.channel ?? ''
          if (line.color) params.lineColor = line.color
          params.lineWidthScale =
            constantOf(v('getLineWidth'), layer.id, 'getLineWidth') * num(i.lineWidthScale, 1)
          params.lineWidthUnits = String(i.lineWidthUnits)
          params.lineWidthMinPixels = num(i.lineWidthMinPixels, 0)
        }
        params.extruded = i.extruded === true
        const elevation = v('getElevation')
        params.elevation = elevation.kind === 'row' ? elevation.expr : ''
        params.elevationScale =
          num(i.elevationScale, 1) *
          (elevation.kind === 'row' ? 1 : constantOf(elevation, layer.id, 'getElevation'))
        push('polygon')
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPolygon',
          'getFillColor',
          'getLineColor',
          'getLineWidth',
          'filled',
          'stroked',
          'lineWidthScale',
          'lineWidthUnits',
          'lineWidthMinPixels',
          'extruded',
          'getElevation',
          'elevationScale',
        ])
        break
      }
      case 'ColumnLayerOp':
      case 'GridCellLayerOp': {
        params.position = positionOf(v('getPosition'), layer.id)
        const colorField = layer.type === 'ColumnLayerOp' ? 'getFillColor' : 'getColor'
        const fill = colorInput(colorChannel(v(colorField)), layer.id, colorField)
        params.color = fill.channel ?? ''
        const elevation = v('getElevation')
        params.elevation = elevation.kind === 'row' ? elevation.expr : ''
        params.elevationScale =
          num(i.elevationScale, 1) *
          (elevation.kind === 'row' ? 1 : constantOf(elevation, layer.id, 'getElevation'))
        if (layer.type === 'ColumnLayerOp') {
          if (fill.color) params.columnColor = fill.color
          params.radius = num(i.radius, 1000)
          if (String(i.radiusUnits) !== 'meters')
            warnings.push(`${layer.id}: radius in ${i.radiusUnits} is read as metres`)
          if (i.extruded === false) warnings.push(`${layer.id}: flat columns are drawn extruded`)
          push('column')
        } else {
          if (fill.color) params.cellColor = fill.color
          params.cellSize = num(i.cellSize, 1000)
          params.coverage = num(i.coverage, 1)
          params.extruded = i.extruded !== false
          push('grid-cell')
        }
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          colorField,
          'getElevation',
          'elevationScale',
          'radius',
          'radiusUnits',
          'extruded',
          'cellSize',
          'coverage',
          'diskResolution',
        ])
        break
      }
      case 'PointCloudLayerOp': {
        params.position = positionOf(v('getPosition'), layer.id)
        const normal = v('getNormal')
        params.normal = normal.kind === 'row' ? normal.expr : ''
        const color = colorInput(colorChannel(v('getColor')), layer.id, 'getColor')
        params.color = color.channel ?? ''
        if (color.color) params.pointColor = color.color
        params.pointSize = num(i.pointSize, 10)
        params.sizeUnits = String(i.sizeUnits)
        push('point-cloud')
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          'getNormal',
          'getColor',
          'pointSize',
          'sizeUnits',
        ])
        break
      }
      case 'IconLayerOp': {
        params.position = positionOf(v('getPosition'), layer.id)
        params.icon = stringColumn(v('getIcon'), layer.id, 'getIcon')
        const color = colorInput(colorChannel(v('getColor')), layer.id, 'getColor')
        params.color = color.channel ?? ''
        if (color.color) params.iconColor = color.color
        const size = v('getSize')
        params.size = size.kind === 'row' ? size.expr : ''
        params.sizeScale =
          num(i.sizeScale, 1) * (size.kind === 'row' ? 1 : constantOf(size, layer.id, 'getSize'))
        const angle = v('getAngle')
        params.angle = angle.kind === 'row' ? angle.expr : ''
        if (angle.kind !== 'row' && constantOf(angle, layer.id, 'getAngle') !== 0)
          params.angle = lit(constantOf(angle, layer.id, 'getAngle'))
        ;[params.offsetX, params.offsetY] = offsetOf(v('getPixelOffset'), layer.id)
        params.iconAtlas = String(i.iconAtlas)
        params.iconMapping =
          typeof i.iconMapping === 'string' ? i.iconMapping : JSON.stringify(i.iconMapping ?? {})
        params.sizeUnits = String(i.sizeUnits)
        params.sizeMinPixels = num(i.sizeMinPixels, 0)
        params.billboard = i.billboard !== false
        push('icon')
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          'getIcon',
          'getColor',
          'getSize',
          'sizeScale',
          'getAngle',
          'getPixelOffset',
          'iconAtlas',
          'iconMapping',
          'sizeUnits',
          'sizeMinPixels',
          'billboard',
        ])
        break
      }
      case 'ScreenGridLayerOp':
      case 'ContourLayerOp': {
        params.position = positionOf(v('getPosition'), layer.id)
        const weight = v('getWeight')
        params.weight = weight.kind === 'row' ? weight.expr : ''
        if (weight.kind !== 'row' && constantOf(weight, layer.id, 'getWeight') !== 1) {
          params.weight = lit(constantOf(weight, layer.id, 'getWeight'))
        }
        params.aggregation = String(i.aggregation)
        if (layer.type === 'ScreenGridLayerOp') {
          params.cellSizePixels = num(i.cellSizePixels, 50)
          params.cellMarginPixels = num(i.cellMarginPixels, 2)
          push('screen-grid')
        } else {
          params.cellSize = num(i.cellSize, 1000)
          params.contours = JSON.stringify(i.contours ?? [])
          params.zOffset = num(i.zOffset, 0.005)
          push('contour')
        }
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          'getWeight',
          'aggregation',
          'cellSizePixels',
          'cellMarginPixels',
          'cellSize',
          'contours',
          'zOffset',
          'gpuAggregation',
          'colorRange',
        ])
        break
      }
      case 'TripsLayerOp': {
        // A path's positions may be 2D; its missing altitude is the ground.
        params.position = `[${VERTEX_COMPONENTS[0]}, ${VERTEX_COMPONENTS[1]}, coalesce(${VERTEX_COMPONENTS[2]}, 0.0)]`
        params.timestamp = 't'
        params.pathId = 'trip'
        params.order = 'k'
        const color = colorInput(colorChannel(v('getColor')), layer.id, 'getColor')
        params.color = color.channel ?? ''
        if (color.color) params.lineColor = color.color
        const width = v('getWidth')
        if (width.kind !== 'const')
          throw new MigrationError(`${layer.id}: a per-row trail width is not converted`)
        params.widthScale = num(width.value, 8) * num(i.widthScale, 20)
        params.widthUnits = String(i.widthUnits)
        params.widthMinPixels = num(i.widthMinPixels, 2)
        params.trailLength = num(i.trailLength, 120)
        params.fadeTrail = i.fadeTrail === true
        params.currentTime = num(i.currentTime, 0)
        wiredNumber(layer.id, 'currentTime', layer.id, 'currentTime')
        wiredNumber(layer.id, 'trailLength', layer.id, 'trailLength')
        nodes.push({
          id: layer.id,
          op: 'trips',
          name: segment(layer.id),
          ...position(layer),
          params,
        })
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPath',
          'getTimestamps',
          'getColor',
          'getWidth',
          'widthScale',
          'widthUnits',
          'widthMinPixels',
          'trailLength',
          'fadeTrail',
          'currentTime',
        ])
        break
      }
      case 'HeatmapLayerOp': {
        params.position = positionOf(v('getPosition'), layer.id)
        const weight = v('getWeight')
        params.weight = weight.kind === 'row' ? weight.expr : ''
        if (weight.kind === 'const') params.weightConstant = num(weight.value, 1)
        for (const k of ['aggregation', 'radiusPixels', 'intensity', 'threshold']) {
          params[k] = i[k] as ParamValue
        }
        nodes.push({
          id: layer.id,
          op: 'heatmap',
          name: segment(layer.id),
          ...position(layer),
          params,
        })
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          'getWeight',
          'aggregation',
          'radiusPixels',
          'intensity',
          'threshold',
        ])
        break
      }
      case 'SimpleMeshLayerOp':
      case 'ScenegraphLayerOp': {
        const scenegraph = layer.type === 'ScenegraphLayerOp'
        params.position = positionOf(v('getPosition'), layer.id)
        const color = colorInput(colorChannel(v('getColor')), layer.id, 'getColor')
        params.color = color.channel ?? ''
        if (color.color) params.modelColor = color.color
        for (const [field, param, neutral] of [
          ['getOrientation', 'orientation', 0],
          ['getScale', 'scale', 1],
          ['getTranslation', 'translation', 0],
        ] as const) {
          const w = v(field)
          if (w.kind === 'row') params[param] = w.expr
          else if (
            w.kind === 'const' &&
            Array.isArray(w.value) &&
            w.value.some((x: unknown) => x !== neutral)
          )
            params[param] = positionOf(w, layer.id)
          else params[param] = ''
        }
        const url = scenegraph ? 'scenegraph' : 'mesh'
        params[url] = String(i[url])
        params.sizeScale = num(i.sizeScale, 1)
        const mapped = [
          'opacity',
          'visible',
          'getPosition',
          'getColor',
          'getOrientation',
          'getScale',
          'getTranslation',
          url,
          'sizeScale',
        ]
        if (scenegraph) {
          params.sizeMinPixels = num(i.sizeMinPixels, 0)
          params.sizeMaxPixels = num(i.sizeMaxPixels, 100)
          mapped.push('sizeMinPixels', 'sizeMaxPixels')
        } else {
          params.wireframe = i.wireframe === true
          mapped.push('wireframe')
        }
        nodes.push({
          id: layer.id,
          op: scenegraph ? 'scenegraph' : 'mesh',
          name: segment(layer.id),
          ...position(layer),
          params,
        })
        dropUnmapped(layer, mapped)
        break
      }
      case 'HexagonLayerOp':
      case 'GridLayerOp': {
        const hexagon = layer.type === 'HexagonLayerOp'
        params.position = positionOf(v('getPosition'), layer.id)
        for (const [field, param] of [
          ['getColorWeight', 'colorWeight'],
          ['getElevationWeight', 'elevationWeight'],
        ]) {
          const w = v(field)
          if (w.kind === 'const' && num(w.value, 1) !== 1) {
            warnings.push(
              `${layer.id}: constant ${field} ${w.value} has no effect on a SUM and was dropped`
            )
          }
          params[param] = w.kind === 'row' ? w.expr : ''
        }
        const size = hexagon ? 'radius' : 'cellSize'
        const mapped = [
          size,
          'colorAggregation',
          'upperPercentile',
          'lowerPercentile',
          'extruded',
          'elevationAggregation',
          'elevationScale',
        ]
        for (const k of mapped) params[k] = i[k] as ParamValue
        if (layer.data?.inputs?.colorRange)
          warnings.push(`${layer.id}: a custom colorRange is not converted`)
        nodes.push({
          id: layer.id,
          op: hexagon ? 'hexagon' : 'grid-layer',
          name: segment(layer.id),
          ...position(layer),
          params,
        })
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          'getColorWeight',
          'getElevationWeight',
          'colorRange',
          ...mapped,
        ])
        break
      }
      default:
        throw new MigrationError(`${layer.id}: ${layer.type} is not converted yet`)
    }
    used.add(layer.id)
    wireExtensions(layer.id, [layer.id])
    edge(layer.id, 'out', target.node, target.port, target.index)
  }

  /**
   * A layer's extensions, wired in order to each node that draws it. A DataFilterExtension is
   * a filter on its rows instead (see dataFilter).
   */
  const wireExtensions = (layerId: string, drawn: string[]) => {
    let k = 0
    for (const e of incoming(layerId, 'extensions')) {
      const ext = byId.get(e.source)
      if (!ext || ext.type === 'DataFilterExtensionOp') continue
      hostNode(ext.id)
      for (const id of drawn) edge(ext.id, handleField(e.sourceHandle), id, 'par:extensions', k)
      k++
    }
  }

  /**
   * A DataFilterExtension as a filter on the rows it would hide: rows whose filter value lies
   * outside its range. One value per row, so a filter of several values is not converted.
   */
  const dataFilter = (ext: NoodlesNode, src: string, layer: NoodlesNode): string => {
    const i: Record<string, unknown> = {
      filterEnabled: true,
      filterRange: [
        [0, 1],
        [0, 1],
      ],
      ...(ext.data?.inputs ?? {}),
    }
    used.add(ext.id)
    if (i.filterEnabled === false) return src
    const accessor = byId.get(incomingOne(ext.id, 'getFilterValue')?.source ?? '')
    const value =
      accessor?.type === 'AccessorOp'
        ? translateAccessor(String(inputs(accessor).expression), indexNames.get(src))
        : undefined
    if (!value)
      throw new MigrationError(`${ext.id}: its filter value needs an accessor the planner can read`)
    if (accessor) used.add(accessor.id)
    const range = i.filterRange as unknown
    const [lo, hi] = (
      Array.isArray(range) && Array.isArray(range[0]) ? range[0] : range
    ) as number[]
    if (value.trim().startsWith('[')) {
      throw new MigrationError(`${ext.id}: a filter of several values per row is not converted`)
    }
    if (i.filterSoftRange)
      warnings.push(`${ext.id}: the soft range is dropped; rows outside the range are hidden`)
    const id = `${ext.id}-${segment(layer.id)}`
    const at = position(layer)
    nodes.push({
      id,
      op: 'filter',
      name: segment(id),
      x: at.x - 160,
      y: at.y + 80,
      params: {
        mode: 'expression',
        expression: `(${value}) >= ${lit(num(lo, 0))} && (${value}) <= ${lit(num(hi, 1))}`,
      },
    })
    edge(src, sourcePort.get(src) ?? 'out', id, 'in')
    return id
  }

  /** A SwitchOp choosing among layers: a planner switch, the index structural. */
  /** A number input wired from a NumberOp: the number node, wired to the planner parameter. */
  const wiredNumber = (owner: string, field: string, target: string, param: string) => {
    const e = incomingOne(owner, field)
    if (!e) return
    const src = byId.get(e.source)
    if (src && CURVES[src.type]) {
      curveNode(src)
      edge(src.id, 'out', target, `par:${param}`)
      return
    }
    if (src && FOLDED.has(src.type)) {
      const value = folded(owner, field, src, handleField(e.sourceHandle))
      const node = nodes.find(x => x.id === target)
      if (node) node.params[param] = num(value, 0)
      return
    }
    if (src?.type !== 'NumberOp') {
      throw new MigrationError(`${owner}: ${field} from ${src?.type} is not converted`)
    }
    numberNode(src)
    edge(src.id, 'out', target, `par:${param}`)
  }

  const switchNode = (n: NoodlesNode, target: Target) => {
    if (incomingOne(n.id, 'index'))
      throw new MigrationError(`${n.id}: a wired Switch index is not converted`)
    used.add(n.id)
    nodes.push({
      id: n.id,
      op: 'switch',
      name: segment(n.id),
      ...position(n),
      params: { index: Math.floor(num(inputs(n).index, 0)) },
    })
    if (inputs(n).blend === true) warnings.push(`${n.id}: blending between layers is not converted`)
    incoming(n.id, 'values').forEach((e, k) => {
      migrateLayer(e.source, handleField(e.sourceHandle), { node: n.id, port: 'in', index: k })
    })
    edge(n.id, 'out', target.node, target.port, target.index)
  }

  layerEdges.forEach((le, index) => {
    migrateLayer(le.source, handleField(le.sourceHandle), {
      node: deckOp.id,
      port: 'layers',
      index: index * 10,
    })
  })

  // A camera driven by an operator (MapViewState fitting the data, say) is the deck's view state.
  const cameraEdge = basemap ? incomingOne(basemap.id, 'viewState') : undefined
  if (cameraEdge) {
    hostNode(cameraEdge.source)
    edge(cameraEdge.source, handleField(cameraEdge.sourceHandle), deckOp.id, 'viewState')
  }
  for (const id of referenced) {
    if (!used.has(id)) hostNode(id)
  }

  for (const port of DECK_VALUE_PORTS) {
    incoming(deckOp.id, port).forEach((e, index) => {
      hostNode(e.source)
      edge(e.source, handleField(e.sourceHandle), deckOp.id, port, index)
    })
  }

  // A configured basemap style feeds the deck's map style, as it fed the basemap's
  const styled = basemap ? incomingOne(basemap.id, 'mapStyle') : undefined
  if (styled) {
    hostNode(styled.source)
    edge(styled.source, handleField(styled.sourceHandle), deckOp.id, 'par:mapStyle')
  }

  // --- chains: source -> row nodes in dependency order -> layers ----------------------------
  for (const [src, chain] of chains) {
    const rows = [...chain.values()]
    const byAttr = new Map(rows.map(r => [r.attribute, r]))
    const ordered: RowNode[] = []
    const seen = new Set<RowNode>()
    const visit = (r: RowNode) => {
      if (seen.has(r)) return
      seen.add(r)
      for (const a of r.reads) {
        const dep = byAttr.get(a)
        if (dep) visit(dep)
      }
      ordered.push(r)
    }
    // Attributes that read only source columns first: a string one runs in SQL, and SQL runs
    // before the CPU stage, so it must not follow a CPU-only node in the chain.
    for (const r of [...rows].sort((a, b) => Number(a.reads.size > 0) - Number(b.reads.size > 0))) {
      visit(r)
    }
    let head = src
    let port = sourcePort.get(src) ?? 'out'
    for (const r of ordered) {
      nodes.push(r.node)
      edge(head, port, r.node.id, 'in')
      head = r.node.id
      port = 'out'
    }
    for (const [layer, from] of layerSource) if (from === src) edge(head, port, layer, 'in')
  }
  for (const [layer, src] of layerSource) {
    if (!chains.has(src)) edge(src, sourcePort.get(src) ?? 'out', layer, 'in')
  }

  for (const n of project.nodes) {
    if (!used.has(n.id)) warnings.push(`${n.id}: dropped ${n.type}; nothing drawn reads it`)
  }
  const timeline = project.timeline ? convertTimeline(project.timeline, nodes, warnings) : undefined
  const converted: EditorDoc = { version: 1, name: project.name ?? 'Untitled', nodes, edges }
  intoSubnets(converted, containers, warnings)

  return {
    doc: {
      ...converted,
      ...(timeline ? { timeline } : {}),
      meta: {
        noodlesVersion: project.version,
        ...(project.viewport ? { viewport: project.viewport } : {}),
        ...(project.editorSettings ? { editorSettings: project.editorSettings } : {}),
        ...(project.apiKeys ? { apiKeys: project.apiKeys } : {}),
      },
    },
    warnings,
  }
}

/** Where a Noodles field's keyframes go: the planner parameter that took its value. */
function trackTarget(fieldPath: string, nodes: DocNode[]): string | undefined {
  const at = fieldPath.indexOf('.par.')
  if (at < 0) return undefined
  const id = fieldPath.slice(0, at)
  // Theatre names a property by a JSON path: `["viewState","zoom"]`.
  let field = fieldPath.slice(at + 5)
  try {
    const path = JSON.parse(field)
    if (Array.isArray(path)) field = path.join('.')
  } catch {}
  const node = nodes.find(n => n.id === id)
  // A basemap's camera is the deck's.
  const camera = /^viewState\.(longitude|latitude|zoom|pitch|bearing)$/.exec(field)
  if (camera && !node) {
    const deck = nodes.find(n => n.op === 'deck')
    return deck ? `${deck.id}.${camera[1]}` : undefined
  }
  if (!node) return undefined
  if (node.op === 'number' && field === 'val') return `${id}.value`
  return field in node.params ? `${id}.${field}` : undefined
}

/** Theatre-era keyframes, through the native timeline's migration, as planner tracks. */
function convertTimeline(raw: unknown, nodes: DocNode[], warnings: string[]): Timeline | undefined {
  const native = migrateTimelineData(raw as TimelineData)
  const tracks: Track[] = []
  for (const track of Object.values(native.tracks)) {
    const target = trackTarget(track.fieldPath, nodes)
    const numeric = track.keyframes.every(k => typeof k.value === 'number')
    if (!target || !numeric) {
      warnings.push(`timeline: keyframes on ${track.fieldPath} are not converted`)
      continue
    }
    tracks.push({
      target,
      keyframes: track.keyframes.map(k => ({
        id: k.id,
        time: k.position,
        value: k.value as number,
        interpolation: k.interpolation,
        ...(k.handles ? { handles: { left: k.handles.left, right: k.handles.right } } : {}),
      })),
    })
  }
  if (tracks.length === 0) return undefined
  return { length: native.sequence.length, fps: native.sequence.fps, tracks }
}
