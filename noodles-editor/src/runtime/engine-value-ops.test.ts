// The operators that replaced the last small Noodles classes, run by the engine: a camera fit
// computed in DuckDB, props added to a planner layer, merged objects, and the pointer.
import { fitBounds } from '@math.gl/web-mercator'
import type { DocEdge, DocNode, EditorDoc } from '@noodles.gl/planner'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { instantiateLayer, instantiateWidget } from '../noodles/utils/instantiate-vis'
import { setRenderSurfaceSize } from '../render/render-surface-size'
import { DuckDbEngine } from './duckdb'
import { Engine } from './engine'
import { registerHostOperators } from './host/host-ops'
import { HostRunner } from './host/host-runner'

const ROWS = 'SELECT * FROM (VALUES (-105.1, 39.6), (-104.8, 39.9), (-104.9, 39.7)) t(lng, lat)'

const node = (id: string, op: string, params: DocNode['params'] = {}): DocNode => ({
  id,
  op,
  x: 0,
  y: 0,
  params,
})
let n = 0
const edge = (
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
  index?: number
): DocEdge => ({
  id: `e${n++}`,
  source,
  sourcePort,
  target,
  targetPort,
  ...(index !== undefined && { index }),
})
const doc = (nodes: DocNode[], edges: DocEdge[]): EditorDoc => ({
  version: 1,
  name: 'p',
  nodes,
  edges,
})

let sql: DuckDbEngine
let queries: string[]
const open = () => {
  const engine = new Engine(sql, {
    host: {
      runner: new HostRunner(),
      layer: instantiateLayer,
      widget: instantiateWidget,
      view: v => v,
    },
  })
  queries = []
  const query = engine.runtime.query.bind(engine.runtime)
  engine.runtime.query = (text: string) => {
    queries.push(text)
    return query(text)
  }
  return engine
}

beforeAll(async () => {
  registerHostOperators()
  sql = await DuckDbEngine.open()
})
afterAll(() => sql.close())

describe('Fit Bounds', () => {
  it('fits the camera to the rows, from one row of DuckDB, into the render surface', async () => {
    setRenderSurfaceSize({ width: 1200, height: 800 })
    const engine = open()
    await engine.setDoc(
      doc(
        [
          node('rows', 'sql', { query: ROWS }),
          node('position', 'attribute', { name: 'position', expression: '[lng, lat]' }),
          node('dots', 'scatter', { position: 'position' }),
          node('fit', 'fit-bounds', { position: '[lng, lat]', padding: 40 }),
          node('map', 'deck', { basemap: 'none' }),
        ],
        [
          edge('rows', 'out', 'position', 'in'),
          edge('position', 'out', 'dots', 'in'),
          edge('dots', 'out', 'map', 'layers', 0),
          edge('rows', 'out', 'fit', 'par:data'),
          edge('fit', 'viewState', 'map', 'viewState'),
        ]
      )
    )
    await engine.settle()
    const expected = fitBounds({
      bounds: [
        [-105.1, 39.6],
        [-104.8, 39.9],
      ],
      width: 1200,
      height: 800,
      padding: 40,
    })
    const view = engine.vis().deckProps.viewState as Record<string, number>
    expect(view.longitude).toBeCloseTo(expected.longitude, 6)
    expect(view.latitude).toBeCloseTo(expected.latitude, 6)
    expect(view.zoom).toBeCloseTo(expected.zoom, 6)
    // The extent is SQL: min and max, not the rows
    expect(queries.filter(q => q.includes('AS west'))).toHaveLength(1)
  })

  it("drives another node's parameters through its number outputs", async () => {
    const engine = open()
    await engine.setDoc(
      doc(
        [
          node('rows', 'sql', { query: ROWS }),
          node('position', 'attribute', { name: 'position', expression: '[lng, lat]' }),
          node('dots', 'scatter', { position: 'position' }),
          node('fit', 'fit-bounds', { position: 'position' }),
          node('camera', 'view-state', { zoom: 3 }),
          node('map', 'deck', { basemap: 'none' }),
        ],
        [
          edge('rows', 'out', 'position', 'in'),
          edge('position', 'out', 'dots', 'in'),
          edge('dots', 'out', 'map', 'layers', 0),
          edge('position', 'out', 'fit', 'par:data'),
          edge('fit', 'longitude', 'camera', 'par:longitude'),
          edge('fit', 'latitude', 'camera', 'par:latitude'),
          edge('camera', 'viewState', 'map', 'viewState'),
        ]
      )
    )
    await engine.settle()
    const view = engine.vis().deckProps.viewState as Record<string, number>
    expect(view.longitude).toBeCloseTo(-104.95, 6)
    expect(view.zoom).toBe(3)
  })
})

describe('Layer Props', () => {
  it('adds props to the planner layer it is wired between', async () => {
    const engine = open()
    await engine.setDoc(
      doc(
        [
          node('rows', 'sql', { query: ROWS }),
          node('position', 'attribute', { name: 'position', expression: '[lng, lat]' }),
          node('dots', 'scatter', { position: 'position' }),
          node('props', 'layer-props', {
            operation: 'mask',
            additionalProps: '{"pickable": true}',
          }),
          node('map', 'deck', { basemap: 'none' }),
        ],
        [
          edge('rows', 'out', 'position', 'in'),
          edge('position', 'out', 'dots', 'in'),
          edge('dots', 'out', 'props', 'par:layer'),
          edge('props', 'layer', 'map', 'layers', 0),
        ]
      )
    )
    await engine.settle()
    const layers = engine.vis().deckProps.layers as { props: Record<string, unknown> }[]
    expect(layers).toHaveLength(1)
    expect(layers[0].props.operation).toBe('mask')
    expect(layers[0].props.pickable).toBe(true)
  })
})

// #886: which views a layer draws in, as deck's layerFilter
describe('Layer Props views', () => {
  const views = (only: string) =>
    doc(
      [
        node('rows', 'sql', { query: ROWS }),
        node('position', 'attribute', { name: 'position', expression: '[lng, lat]' }),
        node('red', 'scatter', { position: 'position' }),
        node('blue', 'scatter', { position: 'position' }),
        node('props', 'layer-props', { views: only }),
        { ...node('left', 'map-view', { width: '50%' }), name: 'left map' },
        node('right', 'map-view', { x: 960, width: '50%' }),
        node('map', 'deck', { basemap: 'none' }),
      ],
      [
        edge('rows', 'out', 'position', 'in'),
        edge('position', 'out', 'red', 'in'),
        edge('position', 'out', 'blue', 'in'),
        edge('red', 'out', 'props', 'par:layer'),
        edge('props', 'layer', 'map', 'layers', 0),
        edge('blue', 'out', 'map', 'layers', 1),
        edge('left', 'view', 'map', 'views', 0),
        edge('right', 'view', 'map', 'views', 1),
      ]
    )

  it('draws a layer only in the views its Layer Props names, by id or name', async () => {
    const engine = open()
    for (const only of ['left', 'left map', ' left , nowhere ']) {
      await engine.setDoc(views(only), 0)
      await engine.settle()
      const { layers, layerFilter } = engine.vis().deckProps
      expect(layerFilter, only).toBeDefined()
      const [red, blue] = layers
      const draws = (layer: (typeof layers)[0], view: string) =>
        layerFilter?.({ layer, viewport: { id: view } })
      expect(draws(red, 'left'), only).toBe(true)
      expect(draws(red, 'right'), only).toBe(false)
      // A layer no Layer Props limits draws everywhere
      expect(draws(blue, 'right'), only).toBe(true)
    }
    // The same function while the lists don't change, so deck doesn't redraw for it
    expect(engine.vis().deckProps.layerFilter).toBe(engine.vis().deckProps.layerFilter)
  })

  // A basemap's overlay merges props: a filter left out would keep restricting
  it('sets layerFilter to null when no Layer Props names views, and after Views is cleared', async () => {
    const engine = open()
    await engine.setDoc(views('left'), 0)
    await engine.settle()
    expect(engine.vis().deckProps.layerFilter).toBeTypeOf('function')
    await engine.setDoc(views(''), 0)
    await engine.settle()
    expect(engine.vis().deckProps).toHaveProperty('layerFilter', null)
  })

  it('takes views only from Layer Props the deck draws', async () => {
    const engine = open()
    const base = views('')
    // `blue` also feeds a Layer Props wired nowhere, which keeps blue's id
    const unused: EditorDoc = {
      ...base,
      nodes: [...base.nodes, node('stray', 'layer-props', { views: 'left' })],
      edges: [...base.edges, edge('blue', 'out', 'stray', 'par:layer')],
    }
    await engine.setDoc(unused, 0)
    await engine.settle()
    expect(engine.vis().deckProps.layerFilter).toBeNull()
  })

  it("resolves a name against the deck's own views, not another node of that name", async () => {
    const engine = open()
    const base = views('left map')
    // A node elsewhere (a subnet's, say) that shares the view's name, listed first
    const shadowed: EditorDoc = {
      ...base,
      nodes: [{ ...node('elsewhere', 'comment', { text: '' }), name: 'left map' }, ...base.nodes],
    }
    await engine.setDoc(shadowed, 0)
    await engine.settle()
    const { layers, layerFilter } = engine.vis().deckProps
    expect(layerFilter?.({ layer: layers[0], viewport: { id: 'left' } })).toBe(true)
  })
})

describe('Merge', () => {
  it('merges view states, later ones winning', async () => {
    const engine = open()
    await engine.setDoc(
      doc(
        [
          node('a', 'view-state', { longitude: 1, latitude: 2, zoom: 3 }),
          node('b', 'view-state', { longitude: 10, latitude: 20, zoom: 5, pitch: 45 }),
          node('both', 'merge'),
          node('map', 'deck', { basemap: 'none' }),
        ],
        [
          edge('a', 'viewState', 'both', 'par:objects', 0),
          edge('b', 'viewState', 'both', 'par:objects', 1),
          edge('both', 'object', 'map', 'viewState'),
        ]
      )
    )
    await engine.settle()
    expect(engine.vis().deckProps.viewState).toMatchObject({ longitude: 10, pitch: 45, zoom: 5 })
  })
})

describe('Mouse', () => {
  it('re-evaluates what reads the pointer when it moves, and says the document reads it', async () => {
    const engine = open()
    await engine.setDoc(
      doc(
        [
          node('rows', 'sql', { query: ROWS }),
          node('position', 'attribute', { name: 'position', expression: '[lng, lat]' }),
          node('dots', 'scatter', { position: 'position', opacity: { expr: 'MY / 100' } }),
          node('pointer', 'mouse'),
          node('map', 'deck', { basemap: 'none' }),
        ],
        [
          edge('rows', 'out', 'position', 'in'),
          edge('position', 'out', 'dots', 'in'),
          edge('dots', 'out', 'map', 'layers', 0),
          edge('pointer', 'x', 'dots', 'par:radiusScale'),
        ]
      )
    )
    await engine.settle()
    expect(engine.readsPointer()).toBe(true)
    await engine.setPointer(12, 50)
    await engine.settle()
    expect(engine.slotValues().get('dots.radiusScale')).toBe(12)
    expect(engine.slotValues().get('dots.opacity')).toBe(0.5)
  })
})
