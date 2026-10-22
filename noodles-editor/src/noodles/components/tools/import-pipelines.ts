import type { NodeJSON } from '@xyflow/react'
import type { OpType } from '../../operators'
import { edgeId, nodeId } from '../../utils/id-utils'
import {
  type CoordinateDetection,
  type DetectedCoordinates,
  hasCoordinates,
  type SizeColumn,
  viewStateForBounds,
} from './detect-coordinates'

// Turns an imported file or URL into a working graph. Kept free of React and the
// operator store so the format detection, layout and wiring can be tested directly.
// Shared by the Import Data dialog and by dropping a file onto the canvas.

export type DetectedFormat = 'csv' | 'json' | 'geojson' | 'shapefile' | 'geoparquet' | 'pmtiles'

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
  tsv: 'csv',
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

const DEFAULT_POSITION = '[d.lng, d.lat]'

type GeometryDetection = Extract<DetectedCoordinates, { kind: 'geometry' }>

// `d.name` when the column is a plain identifier, `d["lat (deg)"]` otherwise
export function propertyAccess(column: string, variable = 'd'): string {
  return /^[A-Za-z_$][\w$]*$/.test(column)
    ? `${variable}.${column}`
    : `${variable}[${JSON.stringify(column)}]`
}

function geometryExpression(detection: GeometryDetection, row = 'd') {
  const value = propertyAccess(detection.column, row)
  if (detection.encoding === 'wkt') return `utils.parseWkt(${value})`
  if (detection.encoding === 'geojson_string') return `JSON.parse(${value})`
  return value
}

export function positionExpression(detection?: CoordinateDetection): string {
  if (detection?.kind === 'lat_lng') {
    return `[${propertyAccess(detection.lngColumn)}, ${propertyAccess(detection.latColumn)}]`
  }
  if (detection?.kind === 'geometry') return `${geometryExpression(detection)}.coordinates`
  return DEFAULT_POSITION
}

// Point radius in map pixels. The map is drawn at the render size (3840 wide by
// default) and shown scaled down in the editor, so this is larger than it looks.
// Fewer points can be bigger without hiding each other.
function baseRadius(rowCount: number) {
  if (rowCount < 1_000) return 16
  if (rowCount < 10_000) return 8
  return 4
}

// From one to three times the base radius. Square root so a point's area, not its
// radius, tracks the value. Rows with a missing or non-numeric value keep the base
// radius rather than a NaN that would hide the point.
export function radiusExpression({ column, min, max }: SizeColumn, rowCount: number): string {
  const base = baseRadius(rowCount)
  const value = propertyAccess(column)
  return `Number.isFinite(Number(${value})) ? ${base} + ${base * 2} * Math.sqrt(Math.max(0, (${value} - ${min}) / ${max - min})) : ${base}`
}

// Column names come from the imported file, so they only ever reach generated code
// through propertyAccess, never as raw text (a newline in a comment would end it)
export function toGeoJsonCode(detection: GeometryDetection) {
  const value = propertyAccess(detection.column, 'row')
  // Detection allows up to 10% unreadable cells, so one bad cell must not throw
  const read =
    detection.encoding === 'wkt'
      ? `const read = row => utils.parseWkt(${value})`
      : detection.encoding === 'geojson_string'
        ? `const read = row => {\n  try {\n    return JSON.parse(${value})\n  } catch {\n    return null\n  }\n}`
        : `const read = row => ${value}`
  return [
    "// Turn each row's geometry column into a GeoJSON feature, skipping unreadable cells",
    read,
    'return {',
    "  type: 'FeatureCollection',",
    '  features: d',
    "    .map(row => ({ type: 'Feature', geometry: read(row), properties: row }))",
    '    .filter(feature => feature.geometry?.type),',
    '}',
  ].join('\n')
}

const POINT_STYLE = { getFillColor: '#f59e0b', opacity: 0.8 }

interface SourceSpec {
  nodeName: string
  type: OpType
  // Handle carrying geometry or rows into a layer
  output: string
  inputs: (url: string) => Record<string, unknown>
  // Tabular sources go to a ScatterplotLayer via an accessor; geo sources to a GeoJsonLayer
  shape: 'tabular' | 'geojson' | 'source-only'
}

const SOURCES: Record<DetectedFormat, SourceSpec> = {
  csv: {
    nodeName: 'data',
    type: 'FileOp',
    output: 'out.data',
    inputs: url => ({ format: 'csv', url }),
    shape: 'tabular',
  },
  json: {
    nodeName: 'data',
    type: 'FileOp',
    output: 'out.data',
    inputs: url => ({ format: 'json', url }),
    shape: 'tabular',
  },
  geojson: {
    nodeName: 'data',
    type: 'FileOp',
    output: 'out.data',
    inputs: url => ({ format: 'json', url }),
    shape: 'geojson',
  },
  shapefile: {
    nodeName: 'shapefile',
    type: 'ShapefileOp',
    output: 'out.featureCollection',
    inputs: url => ({ url }),
    shape: 'geojson',
  },
  geoparquet: {
    nodeName: 'geoparquet',
    type: 'GeoParquetOp',
    output: 'out.featureCollection',
    inputs: url => ({ url }),
    shape: 'geojson',
  },
  // PMTiles emits a MapLibre source config, which no layer operator consumes yet.
  // Create the configured node on its own rather than wiring a broken pipeline.
  pmtiles: {
    nodeName: 'pmtiles',
    type: 'PMTilesOp',
    output: 'out.sourceConfig',
    inputs: url => ({ url }),
    shape: 'source-only',
  },
}

const GEOJSON_LAYER_STYLE = {
  stroked: true,
  filled: true,
  getFillColor: '#3b82f6',
  getLineColor: '#1e40af',
  getLineWidth: 2,
  getPointRadius: 5,
}

interface Connection {
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

export interface BuiltPipeline {
  nodes: NodeJSON<OpType>[]
  edges: (Connection & { id: string })[]
  // The source node, so callers can select and frame the thing worth editing
  primaryNodeId: string
  // Camera framing the data, when its bounds are known. Already set on a scaffolded
  // basemap; callers reusing a renderer can apply it to the existing basemap.
  viewState?: { longitude: number; latitude: number; zoom: number }
}

export interface ImportPipelineOptions {
  url: string
  format: DetectedFormat
  basePosition: { x: number; y: number }
  // Where the points are, from detectCoordinates. Absent for URL imports, which
  // are never downloaded here, and for binary formats.
  detection?: CoordinateDetection
  // Size of the map the camera is fitted to
  mapSize?: { width: number; height: number }
  // Renderer already in the graph. When absent, one is scaffolded with a basemap.
  rendererId?: string | null
  // Injectable so tests do not need the operator store
  makeNodeId?: (baseName: string) => string
}

export function createImportPipeline({
  url,
  format,
  basePosition,
  detection,
  mapSize = { width: 1280, height: 800 },
  rendererId,
  makeNodeId = baseName => nodeId(baseName, '/'),
}: ImportPipelineOptions): BuiltPipeline {
  const source = SOURCES[format]
  const sourceId = makeNodeId(source.nodeName)
  const at = (dx: number, dy: number) => ({ x: basePosition.x + dx, y: basePosition.y + dy })

  const nodes: NodeJSON<OpType>[] = [
    {
      id: sourceId,
      type: source.type,
      data: { inputs: source.inputs(url) },
      position: basePosition,
    },
  ]
  const connections: Connection[] = []
  const connect = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
    connections.push({ source, sourceHandle, target, targetHandle })

  if (source.shape === 'source-only') {
    return { nodes, edges: [], primaryNodeId: sourceId }
  }

  const found = hasCoordinates(detection) ? detection : undefined
  const viewState = found ? viewStateForBounds(found.bounds, mapSize) : undefined

  // Rows whose geometry column holds lines or polygons become GeoJSON features;
  // rows of points, by column or by WKT / GeoJSON point, go to a ScatterplotLayer
  const tabularShapes =
    source.shape === 'tabular' && found?.kind === 'geometry' && !found.pointsOnly ? found : null
  const drawsPoints = source.shape === 'tabular' && !tabularShapes

  let layerId: string
  if (drawsPoints) {
    layerId = makeNodeId('scatter')
    const accessorId = makeNodeId('scatter-position')
    nodes.push({
      id: accessorId,
      type: 'AccessorOp',
      data: { inputs: { expression: positionExpression(found) } },
      position: at(300, 200),
    })

    const sizeColumn = found && 'sizeColumn' in found ? found.sizeColumn : undefined
    const layerInputs: Record<string, unknown> = found
      ? { ...POINT_STYLE, getRadius: baseRadius(found.rowCount) }
      : { getLineColor: '#000000', getFillColor: '#ffffff' }
    if (found && sizeColumn) {
      delete layerInputs.getRadius
      const radiusId = makeNodeId('scatter-radius')
      nodes.push({
        id: radiusId,
        type: 'AccessorOp',
        data: { inputs: { expression: radiusExpression(sizeColumn, found.rowCount) } },
        position: at(300, 400),
      })
      connect(radiusId, 'out.accessor', layerId, 'par.getRadius')
    }
    nodes.push({
      id: layerId,
      type: 'ScatterplotLayerOp',
      data: { inputs: layerInputs },
      position: at(600, 0),
    })
    connect(accessorId, 'out.accessor', layerId, 'par.getPosition')
    connect(sourceId, source.output, layerId, 'par.data')
  } else {
    layerId = makeNodeId('geojson-layer')
    let layerSource = { id: sourceId, handle: source.output }
    if (tabularShapes) {
      const codeId = makeNodeId('to-geojson')
      nodes.push({
        id: codeId,
        type: 'CodeOp',
        data: { inputs: { code: toGeoJsonCode(tabularShapes) } },
        position: at(300, 0),
      })
      connect(sourceId, source.output, codeId, 'par.data')
      layerSource = { id: codeId, handle: 'out.data' }
    }
    nodes.push({
      id: layerId,
      type: 'GeoJsonLayerOp',
      data: { inputs: GEOJSON_LAYER_STYLE },
      position: at(600, 0),
    })
    connect(layerSource.id, layerSource.handle, layerId, 'par.data')
  }

  // Reuse the existing renderer when there is one; otherwise scaffold a renderer
  // and basemap so the import is visible without further wiring
  let deckId = rendererId
  if (!deckId) {
    const basemapId = makeNodeId('basemap')
    deckId = makeNodeId('deck')
    nodes.push({
      id: basemapId,
      type: 'MaplibreBasemapOp',
      data: { inputs: viewState ? { viewState } : {} },
      position: at(600, 400),
    })
    nodes.push({
      id: deckId,
      type: 'DeckRendererOp',
      data: { inputs: {} },
      position: at(950, 160),
    })
    connect(basemapId, 'out.maplibre', deckId, 'par.basemap')

    // Without detected bounds, fall back to fitting the camera at runtime. Only
    // tabular sources expose an array of points that BoundingBox can read.
    if (!viewState && source.shape === 'tabular') {
      const bboxId = makeNodeId('bbox')
      nodes.push({
        id: bboxId,
        type: 'BoundingBoxOp',
        data: { inputs: {} },
        position: at(300, 400),
      })
      connect(sourceId, source.output, bboxId, 'par.data')
      connect(bboxId, 'out.viewState', basemapId, 'par.viewState')
    }
  }

  connect(layerId, 'out.layer', deckId, 'par.layers')

  return {
    nodes,
    edges: connections.map(connection => ({ ...connection, id: edgeId(connection) })),
    primaryNodeId: sourceId,
    viewState,
  }
}
