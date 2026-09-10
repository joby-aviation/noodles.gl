import { describe, expect, it } from 'vitest'
import { opTypes } from '../../operators'
import { createDrawingGraph, createMeasurementGraph } from './map-tool-pipelines'

const basePosition = { x: 100, y: 200 }

// Deterministic ids so tests don't depend on the operator store
function makeCountingNodeId() {
  const counts = new Map<string, number>()
  return (baseName: string) => {
    const count = counts.get(baseName) ?? 0
    counts.set(baseName, count + 1)
    return count === 0 ? `/${baseName}` : `/${baseName}-${count}`
  }
}

const square: GeoJSON.Feature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  properties: {},
}

function drawing(rendererId?: string | null) {
  return createDrawingGraph({
    features: [square],
    basePosition,
    makeNodeId: makeCountingNodeId(),
    rendererId,
  })
}

describe('createDrawingGraph', () => {
  it('scaffolds editor, layer, basemap and renderer for an empty project', () => {
    const { nodes, primaryNodeId } = drawing(null)
    expect(nodes.map(n => n.type)).toEqual([
      'GeoEditorOp',
      'GeoJsonLayerOp',
      'MaplibreBasemapOp',
      'DeckRendererOp',
    ])
    expect(primaryNodeId).toBe('/geo-editor')
  })

  it('attaches to an existing renderer instead of scaffolding another', () => {
    const { nodes, edges } = drawing('/deck')
    expect(nodes.map(n => n.type)).toEqual(['GeoEditorOp', 'GeoJsonLayerOp'])
    expect(edges.at(-1)).toEqual({
      id: '/drawn-layer.out.layer->/deck.par.layers',
      source: '/drawn-layer',
      target: '/deck',
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    })
  })

  it('serializes the drawn features into the editor as a FeatureCollection', () => {
    const { nodes } = drawing('/deck')
    const parsed = JSON.parse(nodes[0].data.inputs.geojson as string)
    expect(parsed.type).toBe('FeatureCollection')
    expect(parsed.features).toEqual([square])
  })

  it('references only registered operator types with handles that exist', () => {
    const { nodes, edges } = drawing(null)
    const byId = new Map(nodes.map(n => [n.id, n]))
    for (const node of nodes) {
      expect(opTypes, node.type).toHaveProperty(node.type)
      const op = new opTypes[node.type](`/probe-${node.type}`)
      for (const key of Object.keys(node.data.inputs)) {
        expect(op.inputs, `${node.type}.${key}`).toHaveProperty(key)
      }
    }
    for (const edge of edges) {
      const sourceNode = byId.get(edge.source)
      const targetNode = byId.get(edge.target)
      expect(sourceNode, `missing source ${edge.source}`).toBeDefined()
      expect(targetNode, `missing target ${edge.target}`).toBeDefined()
      const sourceOp = new opTypes[sourceNode!.type](`/probe-src-${edge.id}`)
      const targetOp = new opTypes[targetNode!.type](`/probe-tgt-${edge.id}`)
      expect(sourceOp.outputs, edge.id).toHaveProperty(edge.sourceHandle.replace('out.', ''))
      expect(targetOp.inputs, edge.id).toHaveProperty(edge.targetHandle.replace('par.', ''))
    }
  })

  it('generates unique edge ids and lays nodes out left to right', () => {
    const { nodes, edges } = drawing(null)
    expect(new Set(edges.map(e => e.id)).size).toBe(edges.length)
    const editor = nodes.find(n => n.type === 'GeoEditorOp')!
    const layer = nodes.find(n => n.type === 'GeoJsonLayerOp')!
    const renderer = nodes.find(n => n.type === 'DeckRendererOp')!
    expect(editor.position).toEqual(basePosition)
    expect(editor.position.x).toBeLessThan(layer.position.x)
    expect(layer.position.x).toBeLessThan(renderer.position.x)
  })
})

describe('createMeasurementGraph', () => {
  const points = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0 },
    { lng: 1, lat: 1 },
  ]

  it('writes an open measurement as a LineString', () => {
    const { nodes } = createMeasurementGraph({
      points,
      closed: false,
      basePosition,
      makeNodeId: makeCountingNodeId(),
      rendererId: '/deck',
    })
    const feature = JSON.parse(nodes[0].data.inputs.geojson as string).features[0]
    expect(feature.geometry.type).toBe('LineString')
    expect(feature.geometry.coordinates).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ])
    expect(feature.properties.source).toBe('measure')
  })

  it('closes an area measurement into a valid ring', () => {
    const { nodes } = createMeasurementGraph({
      points,
      closed: true,
      basePosition,
      makeNodeId: makeCountingNodeId(),
      rendererId: '/deck',
    })
    const ring = JSON.parse(nodes[0].data.inputs.geojson as string).features[0].geometry
      .coordinates[0]
    // A GeoJSON ring repeats its first position last
    expect(ring).toHaveLength(4)
    expect(ring[0]).toEqual(ring[3])
  })

  it('uses a distinct colour so measurements read differently from drawings', () => {
    const measured = createMeasurementGraph({
      points,
      closed: false,
      basePosition,
      makeNodeId: makeCountingNodeId(),
      rendererId: '/deck',
    })
    expect(measured.nodes[1].data.inputs.getLineColor).toBe('#f59e0b')
    expect(drawing('/deck').nodes[1].data.inputs.getLineColor).toBe('#1e40af')
  })
})
