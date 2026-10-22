import { fitBounds } from '@math.gl/web-mercator'
import { autoType, csvParse } from 'd3'
import type { Geometry, Position } from 'geojson'
import { parseWkt } from '../../../utils/wkt'

// Finds where the points are in an imported table so a dropped file can go
// straight to a map, with no LLM and no manual wiring. Pure functions only:
// the import hook parses the file, asks for a detection, and builds a graph from it.

export type Row = Record<string, unknown>

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

// A numeric column worth sizing points by, with its range so the accessor can normalize
export interface SizeColumn {
  column: string
  min: number
  max: number
}

// How a geometry column stores its shapes
export type GeometryEncoding = 'wkt' | 'geojson_string' | 'geojson_object'

export type CoordinateDetection =
  | {
      kind: 'lat_lng'
      lngColumn: string
      latColumn: string
      // Longitude comes first in the file ("x, y"), so messages list it first too
      lngFirst: boolean
      // Rows with a usable position
      rowCount: number
      bounds: Bounds
      sizeColumn?: SizeColumn
    }
  | {
      kind: 'geometry'
      column: string
      encoding: GeometryEncoding
      // Every geometry is a Point, so a ScatterplotLayer can draw it
      pointsOnly: boolean
      rowCount: number
      bounds: Bounds
      sizeColumn?: SizeColumn
    }
  | {
      // A GeoJSON file: nothing to detect, but its bounds still frame the camera
      kind: 'geojson'
      rowCount: number
      bounds: Bounds
    }
  | {
      kind: 'none'
      // no_rows: nothing parsed. no_columns: no column looks like a coordinate.
      // out_of_range: columns were named like coordinates but held other values.
      reason: 'no_rows' | 'no_columns' | 'out_of_range'
      rowCount: number
    }

export type DetectedCoordinates = Exclude<CoordinateDetection, { kind: 'none' }>

export function hasCoordinates(
  detection: CoordinateDetection | undefined
): detection is DetectedCoordinates {
  return detection !== undefined && detection.kind !== 'none'
}

// Parse a CSV or JSON array the same way FileOp will (d3.autoType for CSV), so the
// columns and types detected here match what the graph sees at runtime
export function parseTabularRows(
  contents: string,
  format: 'csv' | 'json'
): { columns: string[]; rows: Row[] } | null {
  try {
    if (format === 'csv') {
      const rows = csvParse(contents, autoType)
      return { columns: rows.columns, rows: rows as unknown as Row[] }
    }
    const parsed = JSON.parse(contents)
    if (!Array.isArray(parsed)) return null
    const rows = parsed.filter(
      (row): row is Row => typeof row === 'object' && row !== null && !Array.isArray(row)
    )
    if (rows.length === 0) return null
    const columns = new Set<string>()
    for (const row of rows.slice(0, 100)) {
      for (const key of Object.keys(row)) columns.add(key)
    }
    return { columns: [...columns], rows }
  } catch {
    return null
  }
}

// Column name matching

type Axis = 'lat' | 'lng'

const AXIS_WORDS: Record<Axis, string[]> = {
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
}
const AXIS_LETTERS: Record<Axis, string[]> = {
  lat: ['y', 'ycoord'],
  lng: ['x', 'xcoord'],
}

// Tokens that commonly sit next to a coordinate name without changing what it means
const NOISE_TOKENS = new Set([
  'dd',
  'deg',
  'degree',
  'degrees',
  'decimal',
  'wgs84',
  'wgs',
  '84',
  '4326',
  'epsg',
  'coord',
  'coords',
  'coordinate',
  'coordinates',
  'point',
  'gps',
  'geo',
])

// "decimalLatitude" -> ["decimal", "latitude"], "LAT_DD" -> ["lat", "dd"]
export function columnTokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

interface AxisCandidate {
  column: string
  index: number
  // 3: only the coordinate word (plus noise like "dd"), 2: coordinate word with a
  // prefix ("pickup_latitude"), 1: a bare x / y letter alongside other words
  score: number
  style: 'word' | 'letter'
  // Remaining tokens, so "pickup_lat" pairs with "pickup_lng" and not "dropoff_lng"
  qualifier: string
}

function axisCandidate(column: string, index: number, axis: Axis): AxisCandidate | null {
  const tokens = columnTokens(column)
  const words = AXIS_WORDS[axis]
  const letters = AXIS_LETTERS[axis]
  const hit = tokens.findIndex(t => words.includes(t) || letters.includes(t))
  if (hit === -1) return null

  const style = words.includes(tokens[hit]) ? 'word' : 'letter'
  const rest = tokens.filter((t, i) => i !== hit && !NOISE_TOKENS.has(t))
  // Another axis word in the same name ("lat_long") means it isn't a single axis
  const otherAxis = axis === 'lat' ? 'lng' : 'lat'
  if (rest.some(t => AXIS_WORDS[otherAxis].includes(t))) return null

  let score: number
  if (rest.length === 0) score = 3
  else if (style === 'word') score = 2
  else score = 1
  return { column, index, score, style, qualifier: rest.join(' ') }
}

interface PairCandidate {
  lat: AxisCandidate
  lng: AxisCandidate
  score: number
}

function candidatePairs(columns: string[]): PairCandidate[] {
  const lats = columns
    .map((c, i) => axisCandidate(c, i, 'lat'))
    .filter((c): c is AxisCandidate => c !== null)
  const lngs = columns
    .map((c, i) => axisCandidate(c, i, 'lng'))
    .filter((c): c is AxisCandidate => c !== null)

  const pairs: PairCandidate[] = []
  for (const lat of lats) {
    for (const lng of lngs) {
      if (lat.column === lng.column) continue
      let score = Math.min(lat.score, lng.score)
      if (lat.qualifier === lng.qualifier) score += 1
      // "latitude" goes with "longitude", "y" with "x"; words beat bare letters
      if (lat.style !== lng.style) score -= 2
      else if (lat.style === 'word') score += 1
      pairs.push({ lat, lng, score })
    }
  }
  // Best score first, then whichever pair appears earliest in the table
  return pairs.sort(
    (a, b) =>
      b.score - a.score ||
      Math.min(a.lat.index, a.lng.index) - Math.min(b.lat.index, b.lng.index) ||
      a.lat.index + a.lng.index - (b.lat.index + b.lng.index)
  )
}

// Value checks

// At least this share of non-empty rows has to be a valid position
const MIN_VALID_SHARE = 0.9

function toNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(value)) {
    return Number(value)
  }
  return null
}

function emptyBounds(): Bounds {
  return { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
}

function extend(bounds: Bounds, lng: number, lat: number) {
  if (lng < bounds.west) bounds.west = lng
  if (lng > bounds.east) bounds.east = lng
  if (lat < bounds.south) bounds.south = lat
  if (lat > bounds.north) bounds.north = lat
}

function checkPair(rows: Row[], latColumn: string, lngColumn: string) {
  const bounds = emptyBounds()
  let nonEmpty = 0
  let valid = 0
  for (const row of rows) {
    const lat = toNumber(row[latColumn])
    const lng = toNumber(row[lngColumn])
    if (lat === undefined || lng === undefined) continue
    nonEmpty++
    if (lat === null || lng === null) continue
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
    valid++
    extend(bounds, lng, lat)
  }
  const ok = valid > 0 && valid / nonEmpty >= MIN_VALID_SHARE
  return { ok, valid, bounds }
}

// Geometry columns

const GEOMETRY_NAMES = new Set([
  'geometry',
  'geom',
  'the_geom',
  'wkt',
  'geojson',
  'shape',
  'location',
  'footprint',
  'boundary',
])

const GEOJSON_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
])

function isGeoJsonGeometry(value: unknown): value is Geometry {
  if (typeof value !== 'object' || value === null) return false
  const { type, coordinates, geometries } = value as Record<string, unknown>
  return (
    typeof type === 'string' &&
    GEOJSON_TYPES.has(type) &&
    (Array.isArray(coordinates) || Array.isArray(geometries))
  )
}

function readGeometry(value: unknown): { geometry: Geometry; encoding: GeometryEncoding } | null {
  if (isGeoJsonGeometry(value)) return { geometry: value, encoding: 'geojson_object' }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      return isGeoJsonGeometry(parsed) ? { geometry: parsed, encoding: 'geojson_string' } : null
    } catch {
      return null
    }
  }
  if (!/^(SRID=\d+;\s*)?[A-Za-z]+/.test(text)) return null
  const geometry = parseWkt(text)
  return geometry ? { geometry, encoding: 'wkt' } : null
}

function extendWithGeometry(bounds: Bounds, geometry: Geometry) {
  const visit = (coords: unknown) => {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords as Position
      if (Number.isFinite(lng) && Number.isFinite(lat)) extend(bounds, lng, lat)
      return
    }
    for (const c of coords) visit(c)
  }
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries) extendWithGeometry(bounds, g)
  } else {
    visit(geometry.coordinates)
  }
}

function inLngLatRange(bounds: Bounds) {
  return bounds.west >= -180 && bounds.east <= 180 && bounds.south >= -90 && bounds.north <= 90
}

const GEOMETRY_SAMPLE = 100

function detectGeometryColumn(columns: string[], rows: Row[]) {
  // Named columns first, then any other column that happens to hold geometries
  const ordered = [
    ...columns.filter(c => GEOMETRY_NAMES.has(c.toLowerCase())),
    ...columns.filter(c => !GEOMETRY_NAMES.has(c.toLowerCase())),
  ]
  for (const column of ordered) {
    const sample: unknown[] = []
    for (const row of rows) {
      const value = row[column]
      if (value !== null && value !== undefined && value !== '') sample.push(value)
      if (sample.length === GEOMETRY_SAMPLE) break
    }
    if (sample.length === 0) continue
    const read = sample.map(readGeometry)
    const parsed = read.filter(r => r !== null)
    if (parsed.length / sample.length < MIN_VALID_SHARE) continue

    const encoding = parsed[0].encoding
    const bounds = emptyBounds()
    let rowCount = 0
    let pointsOnly = true
    for (const row of rows) {
      const result = readGeometry(row[column])
      if (!result) continue
      rowCount++
      if (result.geometry.type !== 'Point') pointsOnly = false
      extendWithGeometry(bounds, result.geometry)
    }
    if (rowCount === 0 || !inLngLatRange(bounds)) continue
    return { column, encoding, pointsOnly, rowCount, bounds }
  }
  return null
}

// Size column

// Names that obviously mean "how much", in priority order
const SIZE_WORDS = [
  'magnitude',
  'mag',
  'population',
  'pop',
  'count',
  'value',
  'amount',
  'total',
  'size',
  'weight',
  'intensity',
  'capacity',
  'score',
]
const ID_WORDS = new Set(['id', 'fid', 'objectid', 'index', 'year', 'zip', 'code', 'rank'])

export function detectSizeColumn(
  columns: string[],
  rows: Row[],
  exclude: string[] = []
): SizeColumn | undefined {
  const candidates = columns
    .filter(c => !exclude.includes(c))
    .map(column => {
      const tokens = columnTokens(column)
      if (tokens.some(t => ID_WORDS.has(t))) return null
      const priority = SIZE_WORDS.findIndex(word => tokens.includes(word))
      return priority === -1 ? null : { column, priority }
    })
    .filter((c): c is { column: string; priority: number } => c !== null)
    .sort((a, b) => a.priority - b.priority)

  for (const { column } of candidates) {
    let min = Infinity
    let max = -Infinity
    let nonEmpty = 0
    let numeric = 0
    for (const row of rows) {
      const value = toNumber(row[column])
      if (value === undefined) continue
      nonEmpty++
      if (value === null) continue
      numeric++
      if (value < min) min = value
      if (value > max) max = value
    }
    if (numeric > 0 && numeric / nonEmpty >= MIN_VALID_SHARE && min < max) {
      return { column, min, max }
    }
  }
  return undefined
}

export function detectCoordinates(columns: string[], rows: Row[]): CoordinateDetection {
  if (rows.length === 0) return { kind: 'none', reason: 'no_rows', rowCount: 0 }

  const pairs = candidatePairs(columns)
  for (const { lat, lng } of pairs) {
    const check = checkPair(rows, lat.column, lng.column)
    if (!check.ok) continue
    return {
      kind: 'lat_lng',
      latColumn: lat.column,
      lngColumn: lng.column,
      lngFirst: lng.index < lat.index,
      rowCount: check.valid,
      bounds: check.bounds,
      sizeColumn: detectSizeColumn(columns, rows, [lat.column, lng.column]),
    }
  }

  const geometry = detectGeometryColumn(columns, rows)
  if (geometry) {
    return {
      kind: 'geometry',
      ...geometry,
      sizeColumn: detectSizeColumn(columns, rows, [geometry.column]),
    }
  }

  return {
    kind: 'none',
    reason: pairs.length > 0 ? 'out_of_range' : 'no_columns',
    rowCount: rows.length,
  }
}

// Bounds of a GeoJSON FeatureCollection, Feature or bare geometry
export function detectGeoJsonBounds(json: unknown): CoordinateDetection {
  const obj = json as { type?: string; features?: unknown[]; geometry?: unknown } | null
  const features = obj && Array.isArray(obj.features) ? obj.features : [obj]
  const bounds = emptyBounds()
  let rowCount = 0
  for (const feature of features) {
    const geometry = (feature as { geometry?: unknown } | null)?.geometry ?? feature
    if (!isGeoJsonGeometry(geometry)) continue
    rowCount++
    extendWithGeometry(bounds, geometry)
  }
  if (rowCount === 0 || !Number.isFinite(bounds.west) || !inLngLatRange(bounds)) {
    return { kind: 'none', reason: rowCount === 0 ? 'no_rows' : 'out_of_range', rowCount }
  }
  return { kind: 'geojson', rowCount, bounds }
}

// Find where the points are in a text file, given the format detectFormat picked
export function detectFileCoordinates(
  format: string,
  contents: string
): CoordinateDetection | undefined {
  if (format === 'geojson') {
    try {
      return detectGeoJsonBounds(JSON.parse(contents))
    } catch {
      return undefined
    }
  }
  if (format !== 'csv' && format !== 'json') return undefined
  const table = parseTabularRows(contents, format)
  return table ? detectCoordinates(table.columns, table.rows) : undefined
}

// Camera that frames the bounds in a map of the given size
export function viewStateForBounds(
  bounds: Bounds,
  size: { width: number; height: number },
  // Padding as a share of the shorter side, so large points at the edge stay in view
  { paddingRatio = 0.08, maxZoom = 14 } = {}
): { longitude: number; latitude: number; zoom: number } {
  // A single point (or a row of points on one line) has no area to fit
  const minSpan = 0.01
  let { west, south, east, north } = bounds
  if (east - west < minSpan) {
    west -= minSpan / 2
    east += minSpan / 2
  }
  if (north - south < minSpan) {
    south -= minSpan / 2
    north += minSpan / 2
  }
  // Web Mercator can't show the poles
  south = Math.max(south, -85)
  north = Math.min(north, 85)

  const width = Math.max(size.width, 1)
  const height = Math.max(size.height, 1)
  const fitPadding = Math.floor(Math.min(width, height) * paddingRatio)
  const { longitude, latitude, zoom } = fitBounds({
    width,
    height,
    bounds: [
      [west, south],
      [east, north],
    ],
    padding: fitPadding,
    maxZoom,
  })
  return { longitude, latitude, zoom: Math.max(0, zoom) }
}

// Coarse row count for analytics, never the exact number
export function rowCountBucket(count: number): string {
  if (count === 0) return '0'
  if (count < 100) return '1-99'
  if (count < 1_000) return '100-999'
  if (count < 10_000) return '1k-10k'
  if (count < 100_000) return '10k-100k'
  return '100k+'
}

// One-line explanation for the user: 'found' before an import, 'mapped' after it
export function describeDetection(
  detection: CoordinateDetection,
  tense: 'found' | 'mapped' = 'mapped'
): string {
  const count = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`
  const [verb, from] = tense === 'found' ? ['Found', 'in'] : ['Mapped', 'from']
  switch (detection.kind) {
    case 'lat_lng': {
      const { latColumn, lngColumn, lngFirst } = detection
      const columns = lngFirst ? `${lngColumn} and ${latColumn}` : `${latColumn} and ${lngColumn}`
      return `${verb} ${count(detection.rowCount, 'point')} ${from} ${columns}`
    }
    case 'geometry':
      return `${verb} ${count(detection.rowCount, detection.pointsOnly ? 'point' : 'shape')} ${from} ${detection.column}`
    case 'geojson':
      return `${verb} ${count(detection.rowCount, 'feature')}`
    case 'none':
      if (detection.reason === 'no_rows') return 'The file has no rows to map'
      if (detection.reason === 'out_of_range') {
        return 'Coordinate columns found, but their values are not longitude and latitude'
      }
      return 'No latitude/longitude or geometry column found'
  }
}
