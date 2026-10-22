import type { DocEdge, DocNode, EditorDoc, ParamValue } from '@noodles.gl/planner'
import { newId, uniqueName } from '../../../editor/doc-ops'
import {
  type CoordinateDetection,
  type DetectedCoordinates,
  hasCoordinates,
  viewStateForBounds,
} from './detect-coordinates'

// Turns an imported file or URL into document nodes that draw it. Kept free of React and
// the editor so the format detection, layout and wiring can be tested directly.
// Shared by the Import Data dialog and by dropping a file onto the canvas.

export type DetectedFormat =
  | 'csv'
  | 'tsv'
  | 'json'
  | 'geojson'
  | 'shapefile'
  | 'geoparquet'
  | 'pmtiles'

// Extensions offered in the file picker and accepted from a canvas drop
export const IMPORTABLE_EXTENSIONS = [
  'csv',
  'tsv',
  'json',
  'geojson',
  'shp',
  'parquet',
  'geoparquet',
  'pmtiles',
]

export const FILE_INPUT_ACCEPT = IMPORTABLE_EXTENSIONS.map(ext => `.${ext}`).join(',')

const EXTENSION_FORMATS: Record<string, DetectedFormat> = {
  csv: 'csv',
  tsv: 'tsv',
  geojson: 'geojson',
  shp: 'shapefile',
  parquet: 'geoparquet',
  geoparquet: 'geoparquet',
  pmtiles: 'pmtiles',
}

// Formats we can only read as bytes, so contents sniffing does not apply
const BINARY_FORMATS = new Set<DetectedFormat>(['shapefile', 'geoparquet', 'pmtiles'])

export function isBinaryFormat(format: DetectedFormat): boolean {
  return BINARY_FORMATS.has(format)
}

export function extensionOf(filename: string): string {
  const withoutQuery = filename.split(/[?#]/)[0]
  const parts = withoutQuery.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

export function isImportable(filename: string): boolean {
  return IMPORTABLE_EXTENSIONS.includes(extensionOf(filename))
}

export function detectFormat(filename: string, contents?: string): DetectedFormat {
  const byExtension = EXTENSION_FORMATS[extensionOf(filename)]
  if (byExtension) return byExtension

  // A .json file may still be GeoJSON, so look at the payload before deciding
  if (contents) {
    try {
      const parsed = JSON.parse(contents)
      if (parsed.type === 'FeatureCollection' || parsed.type === 'Feature' || parsed.features) {
        return 'geojson'
      }
    } catch {}
  }
  return 'json'
}

export function detectFormatFromUrl(url: string): DetectedFormat {
  let path = url
  try {
    path = new URL(url, 'https://placeholder.invalid').pathname
  } catch {}
  return EXTENSION_FORMATS[extensionOf(path)] ?? 'json'
}

type GeometryDetection = Extract<DetectedCoordinates, { kind: 'geometry' }>

// --- the document an import adds ---------------------------------------------------------

/** A column as the expression language names it, when it can: letters, digits, underscores. */
const isIdentifier = (column: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(column)

/** SQL for a column name, quoted. */
const sqlColumn = (column: string) => `"${column.replace(/"/g, '""')}"`

/** A column's geometry in DuckDB spatial, from how the detection found it encoded. */
function geometrySql({ column, encoding }: GeometryDetection): string {
  const c = sqlColumn(column)
  if (encoding === 'wkt') return `TRY(ST_GeomFromText(${c}))`
  if (encoding === 'geojson_string') return `TRY(ST_GeomFromGeoJSON(${c}))`
  return `TRY(ST_GeomFromGeoJSON(to_json(${c})))`
}

// Point radius in pixels. Fewer points can be bigger without hiding each other.
function pointRadius(rowCount: number) {
  if (rowCount < 1_000) return 16
  if (rowCount < 10_000) return 8
  return 4
}

const POINT_FILL = [245, 158, 11]
const SHAPE_FILL = [59, 130, 246]
const SHAPE_LINE = [30, 64, 175]

export interface ImportDoc {
  nodes: DocNode[]
  edges: DocEdge[]
  /** The source node, for callers to select and frame. */
  primaryNodeId: string
  /** The camera framing the data, when its bounds are known. */
  viewState?: { longitude: number; latitude: number; zoom: number }
  /** The deck the layers are wired into, the document's own or a new one. */
  deckId: string
  /** Whether the deck is new, and so already framed. */
  newDeck: boolean
}

export interface ImportDocOptions {
  doc: EditorDoc
  url: string
  format: DetectedFormat
  basePosition: { x: number; y: number }
  /** Where the rows are, from detectCoordinates. Absent for URL imports and binary formats. */
  detection?: CoordinateDetection
  /** Size of the map the camera is fitted to. */
  mapSize?: { width: number; height: number }
}

/**
 * The nodes and wires that read and draw an imported file: a reader, the rows a layer needs
 * (columns renamed, geometry parsed, in SQL), a layer, and the deck it draws in.
 */
export function createImportDoc({
  doc,
  url,
  format,
  basePosition,
  detection,
  mapSize = { width: 1280, height: 800 },
}: ImportDocOptions): ImportDoc {
  const nodes: DocNode[] = []
  const edges: DocEdge[] = []
  const at = (dx: number, dy: number) => ({ x: basePosition.x + dx, y: basePosition.y + dy })
  const add = (
    op: string,
    base: string,
    dx: number,
    dy: number,
    params: Record<string, ParamValue>
  ) => {
    const node: DocNode = {
      id: newId('n'),
      op,
      name: uniqueName({ ...doc, nodes: [...doc.nodes, ...nodes] }, undefined, base),
      ...at(dx, dy),
      params,
    }
    nodes.push(node)
    return node.id
  }
  const wire = (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
    index?: number
  ) =>
    edges.push({
      id: newId('e'),
      source,
      sourcePort,
      target,
      targetPort,
      ...(index !== undefined ? { index } : {}),
    })

  const found = hasCoordinates(detection) ? detection : undefined
  const viewState = found ? viewStateForBounds(found.bounds, mapSize) : undefined
  const existingDeck = doc.nodes.find(n => n.op === 'deck')

  // PMTiles makes a MapLibre source, which no layer draws yet: the reader stands alone
  if (format === 'pmtiles') {
    const reader = add('PMTilesOp', 'pmtiles', 0, 0, { url })
    return { nodes, edges, primaryNodeId: reader, deckId: existingDeck?.id ?? '', newDeck: false }
  }

  // The deck: the document's, else a new one framed on the data
  const deckId =
    existingDeck?.id ??
    add(
      'deck',
      'deck',
      950,
      160,
      viewState
        ? { longitude: viewState.longitude, latitude: viewState.latitude, zoom: viewState.zoom }
        : {}
    )
  let layerIndex =
    Math.max(
      -1,
      ...doc.edges
        .filter(e => e.target === deckId && e.targetPort === 'layers')
        .map(e => e.index ?? 0)
    ) + 1
  const draw = (layer: string) => wire(layer, 'out', deckId, 'layers', layerIndex++)

  // Rows of features with a geometry, drawn by kind: fill, outline and points
  const drawShapes = (features: { id: string; port: string }, dx: number) => {
    const geo = add('geojson', 'shapes', dx, 0, {})
    wire(features.id, features.port, geo, 'in')
    const vertex = { position: '[lng, lat]', pathId: 'id', order: 'vertex' }
    const fill = add('polygon', 'fill', dx + 300, -160, {
      ...vertex,
      ringId: 'ring',
      fillColor: SHAPE_FILL,
      lineColor: SHAPE_LINE,
      lineWidthScale: 2,
      lineWidthUnits: 'pixels',
    })
    const lines = add('path', 'lines', dx + 300, 0, {
      ...vertex,
      lineColor: SHAPE_LINE,
      widthScale: 2,
      widthUnits: 'pixels',
    })
    const points = add('scatter', 'points', dx + 300, 160, {
      position: '[lng, lat]',
      fillColor: SHAPE_FILL,
      radiusScale: 5,
      radiusUnits: 'pixels',
    })
    wire(geo, 'polygons', fill, 'in')
    wire(geo, 'lines', lines, 'in')
    wire(geo, 'points', points, 'in')
    for (const layer of [fill, lines, points]) draw(layer)
    return geo
  }

  // Host readers for the formats DuckDB reads only from files it holds whole
  if (format === 'shapefile' || format === 'geoparquet') {
    const reader = add(format === 'shapefile' ? 'ShapefileOp' : 'GeoParquetOp', format, 0, 0, {
      url,
    })
    drawShapes({ id: reader, port: 'featureCollection' }, 300)
    return { nodes, edges, primaryNodeId: reader, viewState, deckId, newDeck: !existingDeck }
  }

  if (format === 'geojson') {
    const source = add('geojson', 'data', 0, 0, { url })
    const vertex = { position: '[lng, lat]', pathId: 'id', order: 'vertex' }
    const fill = add('polygon', 'fill', 300, -160, {
      ...vertex,
      ringId: 'ring',
      fillColor: SHAPE_FILL,
      lineColor: SHAPE_LINE,
      lineWidthScale: 2,
      lineWidthUnits: 'pixels',
    })
    const lines = add('path', 'lines', 300, 0, {
      ...vertex,
      lineColor: SHAPE_LINE,
      widthScale: 2,
      widthUnits: 'pixels',
    })
    const points = add('scatter', 'points', 300, 160, {
      position: '[lng, lat]',
      fillColor: SHAPE_FILL,
      radiusScale: 5,
      radiusUnits: 'pixels',
    })
    wire(source, 'polygons', fill, 'in')
    wire(source, 'lines', lines, 'in')
    wire(source, 'points', points, 'in')
    for (const layer of [fill, lines, points]) draw(layer)
    return { nodes, edges, primaryNodeId: source, viewState, deckId, newDeck: !existingDeck }
  }

  // Tables: CSV, TSV (DuckDB finds the tab) and JSON rows
  const source = add('file', 'data', 0, 0, { url, format: format === 'json' ? 'json' : 'csv' })
  let rows = { id: source, port: 'out' }
  // Column renames and geometry parsing, in one query when any is needed
  const select: string[] = []
  const name = (column: string, alias: string) => {
    if (isIdentifier(column)) return column
    select.push(`${sqlColumn(column)} AS ${alias}`)
    return alias
  }
  const shapes = found?.kind === 'geometry' && !found.pointsOnly ? found : undefined
  let position = '[lng, lat]'
  if (found?.kind === 'lat_lng') {
    position = `[${name(found.lngColumn, '__lng')}, ${name(found.latColumn, '__lat')}]`
  } else if (found?.kind === 'geometry' && found.pointsOnly) {
    const g = geometrySql(found)
    select.push(`ST_X(${g}) AS __lng`, `ST_Y(${g}) AS __lat`)
    position = '[__lng, __lat]'
  }
  const size = found && 'sizeColumn' in found ? found.sizeColumn : undefined
  const sizeColumn = size ? name(size.column, '__size') : undefined

  if (shapes) {
    const parse = add('sql', 'geometry', 300, 0, {
      query: `SELECT * EXCLUDE (${sqlColumn(shapes.column)}), ${geometrySql(shapes)} AS geom FROM {{input0}}`,
    })
    wire(source, 'out', parse, 'in0')
    drawShapes({ id: parse, port: 'out' }, 600)
    return { nodes, edges, primaryNodeId: source, viewState, deckId, newDeck: !existingDeck }
  }

  if (select.length) {
    const prepared = add('sql', 'columns', 300, 0, {
      query: `SELECT *, ${select.join(', ')} FROM {{input0}}`,
    })
    wire(source, 'out', prepared, 'in0')
    rows = { id: prepared, port: 'out' }
  }

  const base = found ? pointRadius(found.rowCount) : 8
  const params: Record<string, ParamValue> = {
    position,
    fillColor: POINT_FILL,
    opacity: 0.8,
    radiusScale: base,
    radiusUnits: 'pixels',
  }
  if (size && sizeColumn) {
    // From one to three times the base radius, by area; a missing value keeps the base
    const range = size.max - size.min || 1
    params.radius = `coalesce(1.0 + 2.0 * sqrt(max(0.0, (${sizeColumn} - ${size.min}) / ${range})), 1.0)`
  }
  const layer = add('scatter', 'points', 600, 0, params)
  wire(rows.id, rows.port, layer, 'in')
  draw(layer)

  // A new deck with no known bounds fits its camera to the rows when they arrive
  if (!existingDeck && !viewState) {
    const bbox = add('BoundingBoxOp', 'bbox', 300, 400, {})
    wire(rows.id, rows.port, bbox, 'par:data')
    wire(bbox, 'viewState', deckId, 'viewState')
  }
  return { nodes, edges, primaryNodeId: source, viewState, deckId, newDeck: !existingDeck }
}
