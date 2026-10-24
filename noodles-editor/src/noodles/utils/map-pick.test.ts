import { describe, expect, it } from 'vitest'
import { findPickedOperatorId, isClickNotDrag, type PickedLayer, placeLabel } from './map-pick'

const operators = (...ids: string[]) => {
  const known = new Set(ids)
  return (id: string) => known.has(id)
}

describe('findPickedOperatorId', () => {
  it('maps a layer to the operator with the same id', () => {
    const layer = { id: '/scatter' }
    expect(findPickedOperatorId({ layer, sourceLayer: layer }, operators('/scatter'))).toBe(
      '/scatter'
    )
  })

  it('maps a layer inside nested containers by its full path', () => {
    const layer = { id: '/outer/inner/arcs' }
    expect(
      findPickedOperatorId({ layer }, operators('/outer', '/outer/inner', '/outer/inner/arcs'))
    ).toBe('/outer/inner/arcs')
  })

  it('maps a composite sublayer to the top-level layer through its parent chain', () => {
    const layer: PickedLayer = { id: '/group/geojson' }
    const points: PickedLayer = { id: '/group/geojson-points', parent: layer }
    const sourceLayer: PickedLayer = { id: '/group/geojson-points-circle', parent: points }
    expect(findPickedOperatorId({ layer, sourceLayer }, operators('/group/geojson'))).toBe(
      '/group/geojson'
    )
  })

  it('prefers the outermost layer when a sublayer id is also an operator', () => {
    const layer: PickedLayer = { id: '/trips' }
    const sourceLayer: PickedLayer = { id: '/trips-path', parent: layer }
    expect(findPickedOperatorId({ layer, sourceLayer }, operators('/trips', '/trips-path'))).toBe(
      '/trips'
    )
  })

  it('never guesses an operator from a suffixed id', () => {
    // e.g. LayerProps renamed a layer, or a code-built layer with its own id
    expect(findPickedOperatorId({ layer: { id: '/custom-copy' } }, operators('/custom'))).toBeNull()
    expect(
      findPickedOperatorId(
        { sourceLayer: { id: '/group/scatter-points' } },
        operators('/group/scatter')
      )
    ).toBeNull()
  })

  it('returns null for an id the lookup rejects, such as a data node', () => {
    const layerOperators = operators('/scatter')
    expect(findPickedOperatorId({ layer: { id: '/data' } }, layerOperators)).toBeNull()
  })

  it('returns null for layers no operator drew', () => {
    expect(
      findPickedOperatorId({ layer: { id: 'selected-geojson-overlay' } }, operators('/scatter'))
    ).toBeNull()
    expect(findPickedOperatorId({ layer: { id: 'my-layer' } }, operators('/scatter'))).toBeNull()
  })

  it('returns null for an empty pick', () => {
    expect(findPickedOperatorId({ layer: null, sourceLayer: null }, operators('/a'))).toBeNull()
    expect(findPickedOperatorId(null, operators('/a'))).toBeNull()
  })
})

describe('isClickNotDrag', () => {
  it('counts a press and release in place as a click', () => {
    expect(isClickNotDrag({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true)
  })

  it('allows a little jitter', () => {
    expect(isClickNotDrag({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(true)
  })

  it('treats a press that moved the map as a drag', () => {
    expect(isClickNotDrag({ x: 100, y: 100 }, { x: 140, y: 100 })).toBe(false)
    expect(isClickNotDrag({ x: 100, y: 100 }, { x: 104, y: 104 })).toBe(false)
  })

  it('honors a custom tolerance', () => {
    expect(isClickNotDrag({ x: 0, y: 0 }, { x: 8, y: 0 }, 10)).toBe(true)
    expect(isClickNotDrag({ x: 0, y: 0 }, { x: 8, y: 0 }, 2)).toBe(false)
  })

  it('counts a click with no press on record as a click', () => {
    expect(isClickNotDrag(null, { x: 5, y: 5 })).toBe(true)
    expect(isClickNotDrag({ x: 5, y: 5 }, null)).toBe(true)
  })
})

describe('placeLabel', () => {
  const label = { width: 80, height: 20 }
  const bounds = { width: 500, height: 300 }

  it('sits below and right of the pointer', () => {
    expect(placeLabel({ x: 100, y: 100 }, label, bounds, 14)).toEqual({ x: 114, y: 114 })
  })

  it('flips left and up near the right and bottom edges', () => {
    expect(placeLabel({ x: 450, y: 290 }, label, bounds, 14)).toEqual({ x: 356, y: 256 })
  })
})
