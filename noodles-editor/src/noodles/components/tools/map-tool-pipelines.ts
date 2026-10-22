import type { OpType } from '../../operators'
import { edgeId } from '../../utils/id-utils'
import type { LngLat } from './measure-math'

// Turns the output of the on-map tools into real graph nodes. Pure so it can be tested
// without the operator store: ids come in through makeNodeId.

interface BuiltNode {
  id: string
  type: OpType
  data: { inputs: Record<string, unknown> }
  position: { x: number; y: number }
}

interface BuiltEdge {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

export interface BuiltMapToolGraph {
  nodes: BuiltNode[]
  edges: BuiltEdge[]
  primaryNodeId: string
}

export interface MapToolGraphOptions {
  features: GeoJSON.Feature[]
  basePosition: { x: number; y: number }
  makeNodeId: (baseName: string) => string
  // Existing DeckRendererOp to attach the layer to; a new one is scaffolded when null
  rendererId?: string | null
  // Line colour for the generated layer, as hex
  strokeColor?: string
  fillColor?: string
}

const COLUMN_GAP = 450
const ROW_GAP = 280

// Wire a layer into an existing renderer, or scaffold a basemap plus renderer when the
// project has none, so the drawing is visible immediately either way.
function attachToRenderer(
  layerId: string,
  basePosition: { x: number; y: number },
  makeNodeId: (baseName: string) => string,
  rendererId: string | null | undefined
): { nodes: BuiltNode[]; edges: BuiltEdge[] } {
  const nodes: BuiltNode[] = []
  const connections: Omit<BuiltEdge, 'id'>[] = []

  let target = rendererId
  if (!target) {
    const basemapId = makeNodeId('basemap')
    target = makeNodeId('deck')
    nodes.push({
      id: basemapId,
      type: 'MaplibreBasemapOp',
      data: { inputs: {} },
      position: { x: basePosition.x + COLUMN_GAP * 2, y: basePosition.y + ROW_GAP },
    })
    nodes.push({
      id: target,
      type: 'DeckRendererOp',
      data: { inputs: {} },
      position: { x: basePosition.x + COLUMN_GAP * 3, y: basePosition.y },
    })
    connections.push({
      source: basemapId,
      target,
      sourceHandle: 'out.maplibre',
      targetHandle: 'par.basemap',
    })
  }

  connections.push({
    source: layerId,
    target,
    sourceHandle: 'out.layer',
    targetHandle: 'par.layers',
  })

  return { nodes, edges: connections.map(c => ({ ...c, id: edgeId(c) })) }
}

// GeoEditor -> GeoJsonLayer -> renderer. GeoEditor keeps the geometry as editable
// JSON, which is what makes the drawing keyframeable later.
export function createDrawingGraph({
  features,
  basePosition,
  makeNodeId,
  rendererId,
  strokeColor = '#1e40af',
  fillColor = '#3b82f6',
}: MapToolGraphOptions): BuiltMapToolGraph {
  const editorId = makeNodeId('geo-editor')
  const layerId = makeNodeId('drawn-layer')

  const nodes: BuiltNode[] = [
    {
      id: editorId,
      type: 'GeoEditorOp',
      data: {
        inputs: {
          geojson: JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
        },
      },
      position: basePosition,
    },
    {
      id: layerId,
      type: 'GeoJsonLayerOp',
      data: {
        inputs: {
          stroked: true,
          filled: true,
          getFillColor: fillColor,
          getLineColor: strokeColor,
          getLineWidth: 2,
          getPointRadius: 5,
        },
      },
      position: { x: basePosition.x + COLUMN_GAP, y: basePosition.y },
    },
  ]

  const editorToLayer = {
    source: editorId,
    target: layerId,
    sourceHandle: 'out.featureCollection',
    targetHandle: 'par.data',
  }
  const edges: BuiltEdge[] = [{ ...editorToLayer, id: edgeId(editorToLayer) }]

  const attached = attachToRenderer(layerId, basePosition, makeNodeId, rendererId)
  nodes.push(...attached.nodes)
  edges.push(...attached.edges)

  return { nodes, edges, primaryNodeId: editorId }
}

// A saved measurement becomes the same shape as a drawing: the path is geometry the
// user may want to keep, style, or animate. Closed measurements become a Polygon.
export function createMeasurementGraph({
  points,
  closed,
  ...rest
}: Omit<MapToolGraphOptions, 'features'> & {
  points: LngLat[]
  closed: boolean
}): BuiltMapToolGraph {
  const coordinates = points.map(p => [p.lng, p.lat])
  const geometry: GeoJSON.Geometry = closed
    ? { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
    : { type: 'LineString', coordinates }

  return createDrawingGraph({
    ...rest,
    features: [{ type: 'Feature', geometry, properties: { source: 'measure' } }],
    strokeColor: '#f59e0b',
    fillColor: '#f59e0b',
  })
}
