import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from './__tests__/duckdb-node'
import { DeckLayerBuilder } from './deck-layers'
import { geojsonToTables, loadGeojson } from './geojson'
import { ProgramRuntime } from './program-runtime'
import { registerNoodlesRamps } from './ramps'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 30_000)

const square = (x: number, y: number) => [
  [x, y],
  [x + 1, y],
  [x + 1, y + 1],
  [x, y + 1],
  [x, y],
]

describe('geojsonToTables', () => {
  it('splits geometry into vertex rows per kind, with properties as columns', () => {
    const t = geojsonToTables({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'a', pop: 10, id: 7 },
          geometry: { type: 'Polygon', coordinates: [square(0, 0), square(0.2, 0.2)] },
        },
        {
          type: 'Feature',
          properties: { name: 'b', pop: null },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[square(5, 5)], [square(9, 9)]],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'c' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
              [2, 0],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'd' },
          geometry: { type: 'Point', coordinates: [3, 4] },
        },
      ],
    })
    const rows = (k: 'polygons' | 'lines' | 'points') =>
      t[k].toArray().map((r: { toJSON(): Record<string, unknown> }) => r.toJSON())
    const polygons = rows('polygons')
    // Closing vertices are dropped: 4 vertices per ring, two rings, then two polygons of one.
    expect(polygons).toHaveLength(16)
    expect(polygons.map(r => r.id)).toEqual([
      ...Array(8).fill(0),
      ...Array(4).fill(1),
      ...Array(4).fill(2),
    ])
    expect(polygons.slice(0, 8).map(r => r.ring)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
    expect(polygons[0]).toMatchObject({
      feature: 0,
      vertex: 0,
      lng: 0,
      lat: 0,
      name: 'a',
      pop: 10,
      p_id: 7,
    })
    expect(polygons[8]).toMatchObject({ feature: 1, name: 'b', pop: null })
    expect(rows('lines').map(r => [r.id, r.vertex, r.lng])).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [0, 2, 2],
    ])
    expect(rows('points')).toEqual([
      expect.objectContaining({ id: 0, feature: 3, lng: 3, lat: 4, name: 'd' }),
    ])
  })

  it('refuses something that is not GeoJSON', () => {
    expect(() => geojsonToTables({ hello: 1 })).toThrow(/Not GeoJSON/)
  })
})

describe('a geojson source feeding a planner polygon layer', () => {
  it('draws every US county, colored by a property that one county lacks', async () => {
    const url = '@/data.geojson'
    const text = readFileSync(resolve('src/examples/us-county-unemployment/data.geojson'), 'utf8')
    const loaded = await loadGeojson(url, text, (name, ipc) => duck.insertArrow(name, ipc))
    expect(loaded.lines).toBe(0)

    const doc: EditorDoc = {
      version: 1,
      name: 'counties',
      nodes: [
        { id: 'counties', op: 'geojson', x: 0, y: 0, params: { url } },
        {
          id: 'rate',
          op: 'color-ramp',
          x: 0,
          y: 0,
          params: {
            input: 'coalesce(unemployment_rate, 0.0)',
            ramp: 'viridis',
            min: 0,
            max: 10,
            name: 'Cd',
          },
        },
        {
          id: 'fill',
          op: 'polygon',
          x: 0,
          y: 0,
          params: {
            position: '[lng, lat]',
            pathId: 'id',
            ringId: 'ring',
            order: 'vertex',
            color: 'Cd',
          },
        },
        { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
      ],
      edges: [
        { id: 'e1', source: 'counties', sourcePort: 'polygons', target: 'rate', targetPort: 'in' },
        { id: 'e2', source: 'rate', sourcePort: 'out', target: 'fill', targetPort: 'in' },
        { id: 'e3', source: 'fill', sourcePort: 'out', target: 'map', targetPort: 'layers' },
      ],
    }
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.program()?.errors).toEqual([])
    const layer = runtime.layers()[0]
    expect(layer.error).toBeUndefined()
    expect(layer.data?.rows).toBe(loaded.polygons)

    // One deck polygon per GeoJSON polygon, triangulated without a single skipped ring.
    const { rows: polygonCount } = (
      await duck.rows(
        `SELECT count(DISTINCT id)::INTEGER AS rows FROM "${runtime.program()?.relations[0].table}"`
      )
    )[0] as { rows: number }
    expect(layer.data?.starts?.length).toBe(polygonCount)
    const builder = new DeckLayerBuilder()
    const built = builder.build([
      {
        id: layer.id,
        kind: layer.plan.kind,
        data: layer.data,
        bindings: layer.plan.plan.layer?.bindings ?? [],
        props: layer.props,
      },
    ])
    expect(built.get('fill')).toHaveLength(1)
    expect(builder.metrics().triangles).toBeGreaterThan(polygonCount)

    // No color is NaN: the county without a rate takes the coalesced 0.
    const color = layer.data?.attributes.get('Cd')
    expect(color && [...color.data].some(Number.isNaN)).toBe(false)
  })
})
