import { describe, expect, it } from 'vitest'
import { opTypes } from '../../operators'
import {
  buildRecipe,
  decodeSourceRef,
  defaultValuesFor,
  encodeSourceRef,
  GEO_RECIPES,
  GROUP_LABELS,
  getRecipe,
  RECIPES_BY_GROUP,
} from './geo-recipes'

// Deterministic id generation so tests don't depend on the operator store
function makeCountingNodeId() {
  const counts = new Map<string, number>()
  return (baseName: string, containerId: string) => {
    const count = counts.get(baseName) ?? 0
    counts.set(baseName, count + 1)
    const prefix = containerId === '/' ? '/' : `${containerId}/`
    return count === 0 ? `${prefix}${baseName}` : `${prefix}${baseName}-${count}`
  }
}

const basePosition = { x: 100, y: 200 }

describe('geo recipes', () => {
  it('references only registered operator types', () => {
    for (const recipe of GEO_RECIPES) {
      expect(opTypes, `${recipe.id} -> ${recipe.opType}`).toHaveProperty(recipe.opType)
    }
  })

  it('declares inputs and outputs that exist on the operator', () => {
    for (const recipe of GEO_RECIPES) {
      const OpClass = opTypes[recipe.opType]
      const op = new OpClass(`/test-${recipe.id}`)
      for (const input of recipe.inputs) {
        expect(op.inputs, `${recipe.id}.${input.key}`).toHaveProperty(input.key)
      }
      for (const param of recipe.params) {
        expect(op.inputs, `${recipe.id}.${param.key}`).toHaveProperty(param.key)
      }
      expect(op.outputs, `${recipe.id} -> ${recipe.output}`).toHaveProperty(recipe.output)
    }
  })

  it('has unique ids and a label for every group', () => {
    const ids = GEO_RECIPES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const recipe of GEO_RECIPES) {
      expect(GROUP_LABELS[recipe.group]).toBeTruthy()
    }
  })

  it('groups every recipe exactly once', () => {
    const grouped = RECIPES_BY_GROUP.flatMap(g => g.recipes)
    expect(grouped).toHaveLength(GEO_RECIPES.length)
  })

  it('looks recipes up by id', () => {
    expect(getRecipe('buffer')?.opType).toBe('BufferOp')
    expect(getRecipe('nope')).toBeUndefined()
  })

  it('collects parameter defaults', () => {
    expect(defaultValuesFor(getRecipe('buffer')!)).toEqual({ radius: 1, units: 'kilometers' })
    expect(defaultValuesFor(getRecipe('centroid')!)).toEqual({})
  })
})

describe('source refs', () => {
  it('round-trips a nested node path', () => {
    const ref = { source: '/container/data', sourceHandle: 'out.featureCollection' }
    expect(decodeSourceRef(encodeSourceRef(ref))).toEqual(ref)
  })

  it('rejects malformed values', () => {
    expect(decodeSourceRef('')).toBeNull()
    expect(decodeSourceRef('no-separator')).toBeNull()
    expect(decodeSourceRef('|out.data')).toBeNull()
  })
})

describe('buildRecipe', () => {
  it('creates a single node with the chosen parameters', () => {
    const { nodes, edges, primaryNodeId } = buildRecipe({
      recipe: getRecipe('buffer')!,
      values: { radius: 5, units: 'miles' },
      basePosition,
      makeNodeId: makeCountingNodeId(),
    })

    expect(nodes).toHaveLength(1)
    expect(primaryNodeId).toBe('/buffer')
    expect(nodes[0]).toMatchObject({
      id: '/buffer',
      type: 'BufferOp',
      data: { inputs: { radius: 5, units: 'miles' } },
      position: basePosition,
    })
    expect(edges).toHaveLength(0)
  })

  it('omits parameters the caller left undefined', () => {
    const { nodes } = buildRecipe({
      recipe: getRecipe('buffer')!,
      values: { radius: 3 },
      basePosition,
      makeNodeId: makeCountingNodeId(),
    })
    expect(nodes[0].data.inputs).toEqual({ radius: 3 })
  })

  it('wires selected sources into the matching input handles', () => {
    const { edges } = buildRecipe({
      recipe: getRecipe('difference')!,
      values: {},
      sources: {
        a: { source: '/shape-a', sourceHandle: 'out.featureCollection' },
        b: { source: '/shape-b', sourceHandle: 'out.featureCollection' },
      },
      basePosition,
      makeNodeId: makeCountingNodeId(),
    })

    expect(edges).toHaveLength(2)
    expect(edges[0]).toEqual({
      id: '/shape-a.out.featureCollection->/difference.par.a',
      source: '/shape-a',
      target: '/difference',
      sourceHandle: 'out.featureCollection',
      targetHandle: 'par.a',
    })
    expect(edges[1].targetHandle).toBe('par.b')
  })

  it('leaves handles open when no source is chosen', () => {
    const { edges } = buildRecipe({
      recipe: getRecipe('difference')!,
      values: {},
      sources: { a: { source: '/shape-a', sourceHandle: 'out.featureCollection' }, b: null },
      basePosition,
      makeNodeId: makeCountingNodeId(),
    })
    expect(edges).toHaveLength(1)
    expect(edges[0].targetHandle).toBe('par.a')
  })

  it('attaches a layer to an existing renderer without duplicating it', () => {
    const { nodes, edges } = buildRecipe({
      recipe: getRecipe('centroid')!,
      values: {},
      basePosition,
      addLayer: true,
      rendererId: '/deck',
      makeNodeId: makeCountingNodeId(),
    })

    expect(nodes.map(n => n.type)).toEqual(['CentroidOp', 'GeoJsonLayerOp'])
    expect(edges).toEqual([
      {
        id: '/centroid.out.featureCollection->/centroid-layer.par.data',
        source: '/centroid',
        target: '/centroid-layer',
        sourceHandle: 'out.featureCollection',
        targetHandle: 'par.data',
      },
      {
        id: '/centroid-layer.out.layer->/deck.par.layers',
        source: '/centroid-layer',
        target: '/deck',
        sourceHandle: 'out.layer',
        targetHandle: 'par.layers',
      },
    ])
  })

  it('scaffolds a renderer and basemap when the graph has none', () => {
    const { nodes, edges } = buildRecipe({
      recipe: getRecipe('centroid')!,
      values: {},
      basePosition,
      addLayer: true,
      rendererId: null,
      makeNodeId: makeCountingNodeId(),
    })

    expect(nodes.map(n => n.type)).toEqual([
      'CentroidOp',
      'GeoJsonLayerOp',
      'MaplibreBasemapOp',
      'DeckRendererOp',
    ])
    expect(edges.map(e => e.targetHandle)).toEqual(['par.data', 'par.basemap', 'par.layers'])
  })

  it('uses the recipe output handle when feeding the layer', () => {
    const { edges } = buildRecipe({
      recipe: getRecipe('point-in-polygon')!,
      values: {},
      basePosition,
      addLayer: true,
      rendererId: '/deck',
      makeNodeId: makeCountingNodeId(),
    })
    expect(edges[0].sourceHandle).toBe('out.inside')
  })

  it('skips the layer for sources that do not output GeoJSON', () => {
    const { nodes, edges } = buildRecipe({
      recipe: getRecipe('pmtiles')!,
      values: { url: 'https://example.com/t.pmtiles' },
      basePosition,
      addLayer: true,
      rendererId: '/deck',
      makeNodeId: makeCountingNodeId(),
    })
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
  })

  it('places nodes inside the current container', () => {
    const { primaryNodeId, nodes } = buildRecipe({
      recipe: getRecipe('centroid')!,
      values: {},
      basePosition,
      containerId: '/analysis',
      addLayer: true,
      rendererId: '/deck',
      makeNodeId: makeCountingNodeId(),
    })
    expect(primaryNodeId).toBe('/analysis/centroid')
    expect(nodes[1].id).toBe('/analysis/centroid-layer')
  })
})
