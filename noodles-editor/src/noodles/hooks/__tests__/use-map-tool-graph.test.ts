// The Draw tool's follow-ups: the drawing goes into the document on its own, and the
// recipe it was sent to opens with the drawing already wired into its shape input
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { docStore, EMPTY_DOC } from '../../../editor/doc-store'
import { DRAW_FOLLOW_UPS } from '../../components/tools/draw-shapes'
import { useMapToolStore } from '../../components/tools/map-tool-store'
import { useMapToolGraph } from '../use-map-tool-graph'

const square = (x: number): GeoJSON.Feature => ({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
        [x, 1],
        [x, 0],
      ],
    ],
  },
})
const line: GeoJSON.Feature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  },
}
const followUp = (id: string) => DRAW_FOLLOW_UPS.find(f => f.id === id)!

describe('sendDrawingTo', () => {
  beforeEach(() => {
    docStore().load(EMPTY_DOC)
    useMapToolStore.setState({ recipeRequest: null })
  })

  it('writes the shapes the recipe reads, with no layer, and opens it wired in', () => {
    const { result } = renderHook(() => useMapToolGraph())
    result.current.sendDrawingTo(followUp('clip'), [square(0), square(5), line])
    const { nodes, edges } = docStore().get().doc
    expect(nodes.map(n => n.op)).toEqual(['features'])
    expect(edges).toEqual([])
    // Clip reads one boundary: the two squares merged, the line left out
    const drawn = JSON.parse(String(nodes[0].params.geojson))
    expect(drawn.features).toHaveLength(1)
    expect(drawn.features[0].geometry.type).toBe('MultiPolygon')
    expect(useMapToolStore.getState().recipeRequest).toEqual({
      recipeId: 'clip',
      sources: { mask: { source: nodes[0].id, sourceHandle: 'out' } },
    })
  })

  it('does nothing when no shape suits the recipe', () => {
    const { result } = renderHook(() => useMapToolGraph())
    result.current.sendDrawingTo(followUp('along'), [square(0)])
    expect(docStore().get().doc.nodes).toEqual([])
    expect(useMapToolStore.getState().recipeRequest).toBeNull()
  })
})

describe('saveEdits', () => {
  beforeEach(() => docStore().load(EMPTY_DOC))

  it('writes edited shapes back to their node as one undo step', () => {
    docStore().edit(d => {
      d.nodes.push({ id: 'f', op: 'features', x: 0, y: 0, params: {} })
    })
    const { result } = renderHook(() => useMapToolGraph())
    expect(result.current.saveEdits({ nodeId: 'f', kind: 'features' }, [square(2)])).toBe(true)
    const saved = JSON.parse(String(docStore().get().doc.nodes[0].params.geojson))
    expect(saved.features).toEqual([square(2)])
    docStore().undo()
    expect(docStore().get().doc.nodes[0].params).toEqual({})
  })

  it('leaves no undo step when the node cannot take the edit', () => {
    docStore().edit(d => {
      d.nodes.push({ id: 'p', op: 'point', x: 0, y: 0, params: { lng: { expr: 'T' } } })
    })
    const { result } = renderHook(() => useMapToolGraph())
    const before = docStore().get().doc
    expect(result.current.saveEdits({ nodeId: 'p', kind: 'point' }, [square(0)])).toBe(false)
    expect(docStore().get().doc).toBe(before)
    docStore().undo()
    expect(docStore().get().doc.nodes).toEqual([])
  })
})
