import type { NodeJSON } from '@xyflow/react'
import type { OpType } from '../../operators'
import { edgeId, nodeId } from '../../utils/id-utils'

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

function extensionOf(filename: string): string {
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

const LNG_PATTERNS = ['lng', 'lon', 'longitude', 'long', 'x']
const LAT_PATTERNS = ['lat', 'latitude', 'y']

const DEFAULT_POSITION = '[d.lng, d.lat]'

export function detectPositionAccessor(contents?: string): string {
  const firstLine = contents?.split('\n')[0]
  if (!firstLine) return DEFAULT_POSITION

  const columns = firstLine.split(/[,\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''))
  const lower = columns.map(c => c.toLowerCase())

  const lngCol = columns.find((_, i) => LNG_PATTERNS.includes(lower[i]))
  const latCol = columns.find((_, i) => LAT_PATTERNS.includes(lower[i]))

  if (lngCol && latCol) return `[d["${lngCol}"], d["${latCol}"]]`
  return DEFAULT_POSITION
}

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
}

export interface ImportPipelineOptions {
  url: string
  format: DetectedFormat
  basePosition: { x: number; y: number }
  // First line of a text file, used to guess longitude/latitude columns
  contents?: string
  // Renderer already in the graph. When absent, one is scaffolded with a basemap.
  rendererId?: string | null
  // Injectable so tests do not need the operator store
  makeNodeId?: (baseName: string) => string
}

export function createImportPipeline({
  url,
  format,
  basePosition,
  contents,
  rendererId,
  makeNodeId = baseName => nodeId(baseName, '/'),
}: ImportPipelineOptions): BuiltPipeline {
  const source = SOURCES[format]
  const sourceId = makeNodeId(source.nodeName)

  const nodes: NodeJSON<OpType>[] = [
    {
      id: sourceId,
      type: source.type,
      data: { inputs: source.inputs(url) },
      position: basePosition,
    },
  ]
  const connections: Connection[] = []

  if (source.shape === 'source-only') {
    return { nodes, edges: [], primaryNodeId: sourceId }
  }

  // Layer
  const layerId = makeNodeId(source.shape === 'tabular' ? 'scatter' : 'geojson-layer')
  if (source.shape === 'tabular') {
    const accessorId = makeNodeId('scatter-position')
    nodes.push({
      id: accessorId,
      type: 'AccessorOp',
      data: { inputs: { expression: detectPositionAccessor(contents) } },
      position: { x: basePosition.x + 300, y: basePosition.y + 200 },
    })
    nodes.push({
      id: layerId,
      type: 'ScatterplotLayerOp',
      data: { inputs: { getLineColor: '#000000', getFillColor: '#ffffff' } },
      position: { x: basePosition.x + 600, y: basePosition.y },
    })
    connections.push({
      source: accessorId,
      target: layerId,
      sourceHandle: 'out.accessor',
      targetHandle: 'par.getPosition',
    })
  } else {
    nodes.push({
      id: layerId,
      type: 'GeoJsonLayerOp',
      data: { inputs: GEOJSON_LAYER_STYLE },
      position: { x: basePosition.x + 600, y: basePosition.y },
    })
  }
  connections.push({
    source: sourceId,
    target: layerId,
    sourceHandle: source.output,
    targetHandle: 'par.data',
  })

  // Reuse the existing renderer when there is one; otherwise scaffold a renderer
  // and basemap so the import is visible without further wiring
  let deckId = rendererId
  if (!deckId) {
    const basemapId = makeNodeId('basemap')
    deckId = makeNodeId('deck')
    nodes.push({
      id: basemapId,
      type: 'MaplibreBasemapOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 600, y: basePosition.y + 400 },
    })
    nodes.push({
      id: deckId,
      type: 'DeckRendererOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 950, y: basePosition.y + 160 },
    })
    connections.push({
      source: basemapId,
      target: deckId,
      sourceHandle: 'out.maplibre',
      targetHandle: 'par.basemap',
    })

    // Only tabular sources expose an array of points that BoundingBox can fit a
    // camera to. Wiring it lets the new basemap frame the data on first render.
    if (source.shape === 'tabular') {
      const bboxId = makeNodeId('bbox')
      nodes.push({
        id: bboxId,
        type: 'BoundingBoxOp',
        data: { inputs: {} },
        position: { x: basePosition.x + 300, y: basePosition.y + 400 },
      })
      connections.push({
        source: sourceId,
        target: bboxId,
        sourceHandle: source.output,
        targetHandle: 'par.data',
      })
      connections.push({
        source: bboxId,
        target: basemapId,
        sourceHandle: 'out.viewState',
        targetHandle: 'par.viewState',
      })
    }
  }

  connections.push({
    source: layerId,
    target: deckId,
    sourceHandle: 'out.layer',
    targetHandle: 'par.layers',
  })

  return {
    nodes,
    edges: connections.map(connection => ({ ...connection, id: edgeId(connection) })),
    primaryNodeId: sourceId,
  }
}
