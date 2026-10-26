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
