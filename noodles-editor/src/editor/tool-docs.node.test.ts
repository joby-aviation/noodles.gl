// The map tools and the GIS wizard on documents: what each adds lowers, and draws.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { defaultValuesFor, GEO_RECIPES } from '../noodles/components/tools/geo-recipes'
import { type NodeDuck, openNodeDuck } from '../runtime/__tests__/duckdb-node'
import { registerDeckOperators } from '../runtime/deck-ops'
import { ProgramRuntime } from '../runtime/program-runtime'
import { drawingDoc, measurementDoc, pointDoc, recipeDoc, sourceOptions } from './tool-docs'

let duck: NodeDuck
beforeAll(async () => {
  registerDeckOperators()
  duck = await openNodeDuck()
}, 30_000)

const square = {
  type: 'Feature' as const,
  properties: { name: 'a' },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
}

const withBuilt = (
  doc: EditorDoc,
  built: { nodes: EditorDoc['nodes']; edges: EditorDoc['edges'] }
) => ({
  ...doc,
  nodes: [...doc.nodes, ...built.nodes],
  edges: [...doc.edges, ...built.edges],
})

const EMPTY: EditorDoc = { version: 1, name: 'tools', nodes: [], edges: [] }
const at = { x: 0, y: 0 }

describe('map tools', () => {
  it('draw features into a new deck, and draw them', async () => {
    const built = drawingDoc({ doc: EMPTY, basePosition: at }, [square])
    const doc = withBuilt(EMPTY, built)
    expect(doc.nodes.find(n => n.id === built.primaryNodeId)?.op).toBe('features')
    expect(doc.nodes.filter(n => n.op === 'deck')).toHaveLength(1)
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.program()?.errors).toEqual([])
    const rows = runtime.layers().map(l => [l.plan.kind, l.data?.rows])
    expect(rows).toContainEqual(['polygon', 4])
  })

  it('add a measurement to the deck a document has, after its layers', () => {
    const first = withBuilt(EMPTY, drawingDoc({ doc: EMPTY, basePosition: at }, [square]))
    const built = measurementDoc(
      { doc: first, basePosition: at },
      [
        { lng: 0, lat: 0 },
        { lng: 1, lat: 1 },
      ],
      false
    )
    expect(built.nodes.some(n => n.op === 'deck')).toBe(false)
    const deck = first.nodes.find(n => n.op === 'deck')?.id
    expect(built.edges.filter(e => e.target === deck).map(e => e.index)).toEqual([3, 4, 5])
    expect(String(built.nodes[0].params.geojson)).toContain('LineString')
  })

  it('place a point', () => {
    const built = pointDoc({ doc: EMPTY, basePosition: at }, -74, 40.7)
    expect(built.nodes).toEqual([
      expect.objectContaining({ op: 'point', params: { lng: -74, lat: 40.7 } }),
    ])
  })
})

describe('the GIS wizard', () => {
  it.each(GEO_RECIPES.map(r => [r.id, r] as const))(
    '%s builds and lowers with its defaults',
    (_id, recipe) => {
      // Every input reads the drawn features
      const base = withBuilt(EMPTY, drawingDoc({ doc: EMPTY, basePosition: at }, [square]))
      const drawn = base.nodes.find(n => n.op === 'features')!.id
      const sources = Object.fromEntries(
        recipe.inputs.map(i => [i.key, { source: drawn, sourceHandle: 'out' }])
      )
      const built = recipeDoc({
        doc: base,
        basePosition: at,
        recipe,
        // A reader's URL is the one answer with no default
        values: {
          ...defaultValuesFor(recipe),
          ...(recipe.params.some(p => p.key === 'url') ? { url: 'https://x/data.shp' } : {}),
        },
        sources,
        addLayer: recipe.layerable,
      })
      const doc = withBuilt(base, built)
      expect(lowerDocument(doc).errors).toEqual([])
      expect(built.edges.filter(e => e.source === drawn)).toHaveLength(recipe.inputs.length)
    }
  )

  it('offers features first among the outputs a recipe can read', () => {
    const doc = withBuilt(EMPTY, drawingDoc({ doc: EMPTY, basePosition: at }, [square]))
    const options = sourceOptions(
      doc,
      (id, port) => port === 'out' && doc.nodes.find(n => n.id === id)?.op === 'features'
    )
    expect(options[0]).toMatchObject({ geometry: true, label: 'drawing1 → out' })
    expect(options.length).toBeGreaterThan(4)
  })
})
