// The engine's bridge from host operators to the planner: rows into DuckDB, layers to deck.
import { type EditorDoc, registerOperator } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from './__tests__/duckdb-node'
import { Engine, type EngineHost } from './engine'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
  registerOperator({
    type: 'RowsTestOp',
    label: 'Rows',
    category: 'host',
    description: '',
    inputs: [],
    outputs: [{ name: 'data', type: 'value' }],
    params: [],
  })
}, 60_000)

const doc: EditorDoc = {
  version: 1,
  name: 'bridge',
  nodes: [
    { id: '/rows', op: 'RowsTestOp', x: 0, y: 0, params: {} },
    { id: '/dots', op: 'scatter', x: 0, y: 0, params: { position: '[lng, lat]' } },
    { id: '/map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
  ],
  edges: [
    { id: 'e1', source: '/rows', sourcePort: 'data', target: '/dots', targetPort: 'in' },
    {
      id: 'e2',
      source: '/dots',
      sourcePort: 'out',
      target: '/map',
      targetPort: 'layers',
      index: 0,
    },
    // The same output into the deck's layers: host layers pass through, never into DuckDB.
    {
      id: 'e3',
      source: '/rows',
      sourcePort: 'data',
      target: '/map',
      targetPort: 'layers',
      index: 1,
    },
  ],
}

describe('Engine host bridge', () => {
  it('hands host rows to a planner table input once, flattening GeoJSON-style properties', async () => {
    const rows = [
      { lng: 1, lat: 2, properties: { name: 'a' } },
      { lng: 3, lat: 4, properties: { name: 'b', lng: 'clash' } },
    ]
    const files: string[] = []
    let runs = 0
    const host: EngineHost = {
      runner: {
        run: async () => {
          runs++
          return { errors: [] }
        },
        output: (id, port) => (id === '/rows' && port === 'data' ? rows : undefined),
        idle: async () => undefined,
      },
      layer: d => d as never,
      widget: d => d,
      view: d => d,
    }
    const engine = new Engine(duck, {
      host,
      registerFile: async (name, bytes) => {
        files.push(name)
        duck.registerText(name, new TextDecoder().decode(bytes))
      },
    })
    await engine.setDoc(doc)
    await engine.settle()
    expect(engine.lowering()?.errors).toEqual([])
    expect(files).toEqual(['__host_1.json'])
    expect(engine.runtime.error()).toBeUndefined()
    expect(engine.runtime.program()?.errors).toEqual([])
    const layer = engine.runtime.layers().find(l => l.id === '/dots')
    expect(layer?.data?.rows).toBe(2)
    const rel = engine.runtime.program()?.relations.find(r => r.id === '/rows#data')
    expect(await duck.rows(`SELECT name, p_lng FROM ${rel?.ref} ORDER BY name`)).toEqual([
      { name: 'a', p_lng: null },
      { name: 'b', p_lng: 'clash' },
    ])

    // The same output again (the host operator was reused) writes nothing.
    await engine.setTime(1)
    await engine.settle()
    expect(runs).toBeGreaterThan(1)
    expect(files).toEqual(['__host_1.json'])
  })

  it('hands a host FeatureCollection to DuckDB spatial, for a geojson node to draw', async () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'a' },
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
        },
      ],
    }
    const host: EngineHost = {
      runner: {
        run: async () => ({ errors: [] }),
        output: (id, port) => (id === '/reader' && port === 'data' ? collection : undefined),
        idle: async () => undefined,
      },
      layer: d => d as never,
      widget: d => d,
      view: d => d,
    }
    const engine = new Engine(duck, {
      host,
      registerFile: async (name, bytes) => duck.registerText(name, new TextDecoder().decode(bytes)),
    })
    await engine.setDoc({
      version: 1,
      name: 'features',
      nodes: [
        { id: '/reader', op: 'RowsTestOp', x: 0, y: 0, params: {} },
        { id: '/shapes', op: 'geojson', x: 0, y: 0, params: {} },
        {
          id: '/fill',
          op: 'polygon',
          x: 0,
          y: 0,
          params: { position: '[lng, lat]', pathId: 'id', ringId: 'ring', order: 'vertex' },
        },
        { id: '/map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
      ],
      edges: [
        { id: 'e1', source: '/reader', sourcePort: 'data', target: '/shapes', targetPort: 'in' },
        { id: 'e2', source: '/shapes', sourcePort: 'polygons', target: '/fill', targetPort: 'in' },
        { id: 'e3', source: '/fill', sourcePort: 'out', target: '/map', targetPort: 'layers' },
      ],
    })
    await engine.settle()
    expect(engine.lowering()?.errors).toEqual([])
    expect(engine.runtime.layers().find(l => l.id === '/fill')?.data?.rows).toBe(3)
  })
})
