// Noodles' GeoJSON operators (turf) as the planner's geometry operators, which run the same
// work as DuckDB spatial SQL over tables of features (see packages/planner/src/gis.ts).
//
// Each conversion names the planner operator, which Noodles GeoJSON input feeds which planner
// port, the parameters from the Noodles inputs (defaults included, as noodles.json stores only
// what differs), and which Noodles outputs have a planner port. An output with none, such as
// AreaOp's totalArea, is a migration error when something reads it.

import type { ParamValue } from '@noodles.gl/planner'

type Inputs = Record<string, unknown>

export interface GisConversion {
  op: string
  // Noodles GeoJSON input → planner port
  inputs: Record<string, string>
  // Noodles inputs, schema 20 defaults, for those `params` reads
  defaults: Inputs
  params: (i: Inputs) => Record<string, ParamValue>
  // Noodles number inputs a NumberOp may drive → planner parameter
  numbers?: Record<string, string>
  // Noodles output → planner port
  outputs: Record<string, string> | ((i: Inputs) => Record<string, string>)
}

export class GisConversionError extends Error {}

const n = (v: unknown, fallback = 0): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : fallback
}
const s = (v: unknown, fallback = ''): string =>
  Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v : fallback

// A Point2D field's value: { lng, lat } or [lng, lat]
function lngLat(v: unknown, owner: string): [number, number] {
  if (Array.isArray(v)) return [n(v[0]), n(v[1])]
  if (v && typeof v === 'object' && 'lng' in v) {
    const p = v as { lng: unknown; lat: unknown }
    return [n(p.lng), n(p.lat)]
  }
  throw new GisConversionError(`${owner}: a point must be [lng, lat] or { lng, lat }`)
}

// A Bbox field's value as west, south, east, north
function bounds(v: unknown, owner: string): Record<string, number> {
  const b = v as { southwest?: unknown; northeast?: unknown } | unknown[]
  const [sw, ne] = Array.isArray(b) ? b : [b?.southwest, b?.northeast]
  const [west, south] = lngLat(sw, owner)
  const [east, north] = lngLat(ne, owner)
  return { west, south, east, north }
}

// Properties a DataField held, as the JSON a Point or Rectangle writes into columns
function propertiesJson(v: unknown, extra: Inputs = {}): string {
  const props = v && typeof v === 'object' && !Array.isArray(v) ? (v as Inputs) : {}
  const all = { ...extra, ...props }
  return Object.keys(all).length ? JSON.stringify(all) : ''
}

const FEATURES = { featureCollection: 'out' }
const FEATURE = { feature: 'out' }
const BBOX = { southwest: { lng: -180, lat: -90 }, northeast: { lng: 180, lat: 90 } }

// turf's Transform operators pivot about a centroid or a bounding-box center; corners convert
// to neither
function origin(v: unknown, owner: string): string {
  const o = s(v, 'centroid')
  if (o === 'centroid' || o === 'center') return o
  throw new GisConversionError(`${owner}: scaling about '${o}' is not converted`)
}

const grid =
  (shape: 'hex' | 'square' | 'point') =>
  (i: Inputs): Record<string, ParamValue> => ({
    shape,
    cellSize: n(i.cellSize, 10),
    units: s(i.units, 'kilometers'),
    ...bounds(i.bbox, `${shape} grid`),
  })

export const GIS_CONVERSIONS: Record<string, GisConversion> = {
  BufferOp: {
    op: 'buffer',
    inputs: { geojson: 'in' },
    defaults: { radius: 1, units: 'kilometers', steps: 64 },
    params: i => ({
      radius: n(i.radius, 1),
      units: s(i.units, 'kilometers'),
      steps: Math.min(64, n(i.steps, 64)),
    }),
    numbers: { radius: 'radius' },
    outputs: FEATURES,
  },
  CentroidOp: {
    op: 'centroid',
    inputs: { geojson: 'in' },
    defaults: {},
    params: () => ({}),
    outputs: FEATURES,
  },
  ConvexHullOp: {
    op: 'convex-hull',
    inputs: { geojson: 'in' },
    defaults: {},
    params: () => ({}),
    outputs: FEATURES,
  },
  VoronoiOp: {
    op: 'voronoi',
    inputs: { geojson: 'in' },
    defaults: {},
    params: () => ({}),
    outputs: FEATURES,
  },
  LineToPolygonOp: {
    op: 'line-to-polygon',
    inputs: { geojson: 'in' },
    defaults: {},
    params: () => ({}),
    outputs: FEATURES,
  },
  PolygonToLineOp: {
    op: 'polygon-to-line',
    inputs: { geojson: 'in' },
    defaults: {},
    params: () => ({}),
    outputs: FEATURES,
  },
  // turf takes the first feature of each side; the planner cuts every feature by the whole mask
  DifferenceOp: {
    op: 'clip',
    inputs: { a: 'in', b: 'mask' },
    defaults: {},
    params: () => ({ keep: 'outside' }),
    outputs: FEATURES,
  },
  IntersectOp: {
    op: 'clip',
    inputs: { a: 'in', b: 'mask' },
    defaults: {},
    params: () => ({ keep: 'inside' }),
    outputs: FEATURES,
  },
  ClipOp: {
    op: 'clip',
    inputs: { geojson: 'in', mask: 'mask' },
    defaults: {},
    params: () => ({ keep: 'inside' }),
    outputs: FEATURES,
  },
  // turf.dissolve merges touching polygons and keeps separate ones apart
  DissolveOp: {
    op: 'dissolve',
    inputs: { geojson: 'in' },
    defaults: { propertyName: '' },
    params: i => ({ by: s(i.propertyName), split: true }),
    outputs: FEATURES,
  },
  UnionOp: {
    op: 'dissolve',
    inputs: { geojson: 'in' },
    defaults: {},
    params: () => ({ by: '', split: false }),
    outputs: FEATURES,
  },
  ExplodeOp: {
    op: 'explode',
    inputs: { geojson: 'in' },
    defaults: { mode: 'vertices' },
    params: i => ({ mode: s(i.mode, 'vertices') === 'vertices' ? 'vertices' : 'parts' }),
    outputs: FEATURES,
  },
  SimplifyOp: {
    op: 'simplify',
    inputs: { feature: 'in' },
    defaults: { tolerance: 0.01, highQuality: false },
    // turf.simplify does not keep polygons valid; the conversion does as it does
    params: i => ({ tolerance: n(i.tolerance, 0.01), preserveTopology: false }),
    numbers: { tolerance: 'tolerance' },
    outputs: FEATURE,
  },
  TransformRotateOp: {
    op: 'transform',
    inputs: { geojson: 'in' },
    defaults: { angle: 0, pivot: 'centroid' },
    params: i => ({ rotate: n(i.angle), origin: origin(i.pivot, 'TransformRotate') }),
    numbers: { angle: 'rotate' },
    outputs: FEATURES,
  },
  TransformScaleOp: {
    op: 'transform',
    inputs: { geojson: 'in' },
    defaults: { factor: 1, origin: 'centroid' },
    params: i => ({ scale: n(i.factor, 1), origin: origin(i.origin, 'TransformScale') }),
    numbers: { factor: 'scale' },
    outputs: FEATURES,
  },
  TransformTranslateOp: {
    op: 'transform',
    inputs: { geojson: 'in' },
    defaults: { distance: 0, direction: 0, units: 'kilometers' },
    params: i => ({
      distance: n(i.distance),
      direction: n(i.direction),
      units: s(i.units, 'kilometers'),
    }),
    numbers: { distance: 'distance', direction: 'direction' },
    outputs: FEATURES,
  },
  // Rotate, then scale, then move east and north by kilometers: one move along a bearing
  GeoJsonTransformOp: {
    op: 'transform',
    inputs: { feature: 'in' },
    defaults: { scale: 1, translateX: 0, translateY: 0, rotate: 0 },
    params: i => {
      const x = n(i.translateX)
      const y = n(i.translateY)
      return {
        rotate: n(i.rotate),
        scale: n(i.scale, 1),
        distance: Math.hypot(x, y),
        direction: (Math.atan2(x, y) * 180) / Math.PI,
        units: 'kilometers',
        origin: 'centroid',
      }
    },
    numbers: { rotate: 'rotate', scale: 'scale' },
    outputs: FEATURE,
  },
  ReprojectOp: {
    op: 'reproject',
    inputs: { geojson: 'in' },
    defaults: { from: 'EPSG:4326', to: 'EPSG:3857' },
    params: i => ({ from: s(i.from, 'EPSG:4326'), to: s(i.to, 'EPSG:3857') }),
    outputs: FEATURES,
  },
  AlongOp: {
    op: 'along',
    inputs: { geojson: 'in' },
    defaults: { distance: 1, units: 'kilometers' },
    params: i => ({ distance: n(i.distance, 1), units: s(i.units, 'kilometers') }),
    numbers: { distance: 'distance' },
    outputs: FEATURES,
  },
  LineSliceOp: {
    op: 'line-slice',
    inputs: { geojson: 'in' },
    defaults: { startDistance: 0, stopDistance: 1, units: 'kilometers' },
    params: i => ({
      start: n(i.startDistance),
      stop: n(i.stopDistance, 1),
      units: s(i.units, 'kilometers'),
    }),
    numbers: { startDistance: 'start', stopDistance: 'stop' },
    outputs: FEATURES,
  },
  AreaOp: {
    op: 'area',
    inputs: { geojson: 'in' },
    defaults: { units: 'squareKilometers' },
    params: i => ({ units: s(i.units, 'squareKilometers'), column: 'area' }),
    outputs: FEATURES,
  },
  LengthOp: {
    op: 'length',
    inputs: { geojson: 'in' },
    defaults: { units: 'kilometers' },
    params: i => ({ units: s(i.units, 'kilometers'), column: 'length' }),
    outputs: FEATURES,
  },
  NearestPointOp: {
    op: 'nearest',
    inputs: { points: 'in' },
    defaults: { targetPoint: { lng: 0, lat: 0 } },
    params: i => {
      const [lng, lat] = lngLat(i.targetPoint, 'NearestPoint')
      return { lng, lat }
    },
    outputs: { nearest: 'out' },
  },
  PointInPolygonOp: {
    op: 'inside',
    inputs: { points: 'in', polygon: 'polygons' },
    defaults: { invert: false },
    params: () => ({}),
    outputs: i =>
      i.invert === true
        ? { inside: 'outside', outside: 'inside' }
        : { inside: 'inside', outside: 'outside' },
  },
  SpatialJoinOp: {
    op: 'spatial-join',
    inputs: { target: 'in', join: 'join' },
    defaults: { relationship: 'within' },
    params: i => ({ predicate: s(i.relationship, 'within'), prefix: '' }),
    outputs: FEATURES,
  },
  AggregateOp: {
    op: 'aggregate-within',
    inputs: { polygons: 'in', points: 'points' },
    defaults: { field: '', operation: 'count' },
    params: i => ({ operation: s(i.operation, 'count'), column: s(i.field), as: '' }),
    outputs: FEATURES,
  },
  HexGridOp: {
    op: 'geo-grid',
    inputs: {},
    defaults: { bbox: BBOX, cellSize: 10, units: 'kilometers' },
    params: grid('hex'),
    numbers: { cellSize: 'cellSize' },
    outputs: FEATURES,
  },
  PointGridOp: {
    op: 'geo-grid',
    inputs: {},
    defaults: { bbox: BBOX, cellSize: 10, units: 'kilometers' },
    params: grid('point'),
    numbers: { cellSize: 'cellSize' },
    outputs: FEATURES,
  },
  SquareGridOp: {
    op: 'geo-grid',
    inputs: {},
    defaults: { bbox: BBOX, cellSize: 10, units: 'kilometers' },
    params: grid('square'),
    numbers: { cellSize: 'cellSize' },
    outputs: FEATURES,
  },
  PointOp: {
    op: 'point',
    inputs: {},
    defaults: { coordinates: { lng: 0, lat: 0 }, properties: [] },
    params: i => {
      const [lng, lat] = lngLat(i.coordinates, 'Point')
      return { lng, lat, properties: propertiesJson(i.properties) }
    },
    outputs: FEATURE,
  },
  // RectangleOp sizes are kilometers (turf.destination's default) and add an altitude property
  RectangleOp: {
    op: 'rectangle',
    inputs: {},
    defaults: {
      center: { lng: -74.006, lat: 40.7128 },
      altitude: 0,
      width: 10,
      height: 10,
      properties: [],
    },
    params: i => {
      const [lng, lat] = lngLat(i.center, 'Rectangle')
      return {
        lng,
        lat,
        width: n(i.width, 10),
        height: n(i.height, 10),
        units: 'kilometers',
        properties: propertiesJson(i.properties, { altitude: n(i.altitude) }),
      }
    },
    numbers: { width: 'width', height: 'height' },
    outputs: FEATURE,
  },
  GeoEditorOp: {
    op: 'features',
    inputs: {},
    defaults: { geojson: ['{', '  "type": "FeatureCollection",', '  "features": []', '}'] },
    params: i => ({ geojson: s(i.geojson, '{"type":"FeatureCollection","features":[]}') }),
    outputs: FEATURES,
  },
  DBScanClusterOp: {
    op: 'cluster',
    inputs: { geojson: 'in' },
    defaults: { maxDistance: 1, units: 'kilometers', minPoints: 3 },
    params: i => ({
      method: 'dbscan',
      maxDistance: n(i.maxDistance, 1),
      units: s(i.units, 'kilometers'),
      minPoints: n(i.minPoints, 3),
    }),
    outputs: FEATURES,
  },
  KMeansClusterOp: {
    op: 'cluster',
    inputs: { geojson: 'in' },
    defaults: { numberOfClusters: 5 },
    params: i => ({ method: 'kmeans', clusters: n(i.numberOfClusters, 5) }),
    outputs: FEATURES,
  },
  InterpolateOp: {
    op: 'interpolate',
    inputs: { geojson: 'in' },
    defaults: { cellSize: 1, property: 'value', units: 'kilometers', weight: 2 },
    params: i => ({
      property: s(i.property, 'value'),
      cellSize: n(i.cellSize, 1),
      units: s(i.units, 'kilometers'),
      weight: n(i.weight, 2),
      gridType: 'point',
    }),
    outputs: FEATURES,
  },
  IsolineOp: {
    op: 'isolines',
    inputs: { geojson: 'in' },
    defaults: { zProperty: 'elevation', breaks: [100, 200, 500, 1000, 2000] },
    params: i => ({
      property: s(i.zProperty, 'elevation'),
      breaks: (Array.isArray(i.breaks) ? i.breaks : []).map(b => n(b)).join(', '),
    }),
    outputs: FEATURES,
  },
  TinOp: {
    op: 'tin',
    inputs: { geojson: 'in' },
    defaults: { zProperty: '' },
    params: i => ({ property: s(i.zProperty) }),
    outputs: FEATURES,
  },
  SmoothOp: {
    op: 'smooth-lines',
    inputs: { feature: 'in' },
    defaults: { windowSize: 5, method: 'gaussian' },
    params: i => ({ method: s(i.method, 'gaussian'), windowSize: n(i.windowSize, 5) }),
    outputs: FEATURE,
  },
  LineInterpolationOp: {
    op: 'smooth-lines',
    inputs: { feature: 'in' },
    defaults: {
      method: 'catmull-rom',
      samplesPerSegment: 12,
      alpha: 0.5,
      tension: 0,
      turnRadiusMeters: 250,
    },
    params: i => ({
      method: s(i.method, 'catmull-rom'),
      samplesPerSegment: n(i.samplesPerSegment, 12),
      alpha: n(i.alpha, 0.5),
      tension: n(i.tension),
      turnRadiusMeters: n(i.turnRadiusMeters, 250),
    }),
    outputs: FEATURE,
  },
}
