// GeoJSON through DuckDB spatial: ST_Read at the file, vertex rows in SQL, binary attributes out.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from './__tests__/duckdb-node'
import { DeckLayerBuilder } from './deck-layers'
import { ProgramRuntime } from './program-runtime'
import { registerNoodlesRamps } from './ramps'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 60_000)

const square = (x: number, y: number, s = 1) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
]

const doc = (url: string, layers: EditorDoc['nodes'], edges: EditorDoc['edges']): EditorDoc => ({
  version: 1,
  name: 'geo',
  nodes: [
    { id: 'g', op: 'geojson', x: 0, y: 0, params: { url } },
    ...layers,
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges,
})

async function run(d: EditorDoc) {
  const lowered = lowerDocument(d)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.program()?.errors).toEqual([])
  const rows = async (relationId: string, order: string) => {
    const rel = runtime.program()?.relations.find(r => r.id === relationId)
    return duck.rows(`SELECT * EXCLUDE (feature) FROM ${rel?.ref} ORDER BY ${order}`)
  }
  return { runtime, rows }
}

describe('geojson: vertex rows from DuckDB spatial', () => {
  it('splits features into polygon rings, line vertices and points, keeping properties', async () => {
    const url = 'https://example.com/mixed.geojson'
    duck.registerText(
      url,
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'a', pop: 10, id: 'keep-me' },
            geometry: { type: 'Polygon', coordinates: [square(0, 0, 10), square(2, 2)] },
          },
          {
            type: 'Feature',
            properties: { name: 'b', pop: null },
            geometry: { type: 'MultiPolygon', coordinates: [[square(20, 20)], [square(30, 30)]] },
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
    )
    const layer = (id: string, op: string, params: Record<string, string>) => ({
      id,
      op,
      x: 0,
      y: 0,
      params,
    })
    const geo = { position: '[lng, lat]', pathId: 'id', order: 'vertex' }
    const { rows } = await run(
      doc(
        url,
        [
          layer('fill', 'polygon', { ...geo, ringId: 'ring' }),
          layer('paths', 'path', geo),
          layer('dots', 'scatter', { position: '[lng, lat]' }),
        ],
        [
          { id: 'e1', source: 'g', sourcePort: 'polygons', target: 'fill', targetPort: 'in' },
          { id: 'e2', source: 'g', sourcePort: 'lines', target: 'paths', targetPort: 'in' },
          { id: 'e3', source: 'g', sourcePort: 'points', target: 'dots', targetPort: 'in' },
          {
            id: 'e4',
            source: 'fill',
            sourcePort: 'out',
            target: 'map',
            targetPort: 'layers',
            index: 0,
          },
          {
            id: 'e5',
            source: 'paths',
            sourcePort: 'out',
            target: 'map',
            targetPort: 'layers',
            index: 1,
          },
          {
            id: 'e6',
            source: 'dots',
            sourcePort: 'out',
            target: 'map',
            targetPort: 'layers',
            index: 2,
          },
        ]
      )
    )

    const polygons = await rows('g#polygons', 'id, ring, vertex')
    // Closing vertices dropped: 4 per ring; the outline and its hole, then two one-ring parts.
    expect(polygons).toHaveLength(16)
    expect(polygons.map(r => r.id)).toEqual([
      ...Array(8).fill(0),
      ...Array(4).fill(1),
      ...Array(4).fill(2),
    ])
    expect(polygons.slice(0, 8).map(r => r.ring)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
    // A property named like a vertex column is renamed, not dropped.
    expect(polygons[0]).toMatchObject({
      vertex: 0,
      lng: 0,
      lat: 0,
      name: 'a',
      pop: 10,
      p_id: 'keep-me',
    })
    expect(polygons[8]).toMatchObject({ name: 'b', pop: null })

    const lines = await rows('g#lines', 'id, vertex')
    expect(lines.map(r => [r.id, r.vertex, r.lng])).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [0, 2, 2],
    ])
    expect(await rows('g#points', 'id')).toEqual([
      expect.objectContaining({ id: 0, lng: 3, lat: 4, name: 'd' }),
    ])
  })

  it('draws every US county, colored by a property one county lacks', async () => {
    const url = '@/data.geojson'
    duck.registerText(
      url,
      readFileSync(resolve('src/examples/us-county-unemployment/data.geojson'), 'utf8')
    )
    const { runtime } = await run(
      doc(
        url,
        [
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
        ],
        [
          { id: 'e1', source: 'g', sourcePort: 'polygons', target: 'rate', targetPort: 'in' },
          { id: 'e2', source: 'rate', sourcePort: 'out', target: 'fill', targetPort: 'in' },
          { id: 'e3', source: 'fill', sourcePort: 'out', target: 'map', targetPort: 'layers' },
        ]
      )
    )
    const layer = runtime.layers()[0]
    expect(layer.error).toBeUndefined()
    // 3,220 counties as 3,304 polygons: the rows the file's coordinates make.
    expect(layer.data?.rows).toBe(52588)
    expect(layer.data?.starts?.length).toBe(3304)
    const builder = new DeckLayerBuilder()
    builder.build([
      {
        id: layer.id,
        kind: layer.plan.kind,
        data: layer.data,
        bindings: layer.plan.plan.layer?.bindings ?? [],
        props: layer.props,
      },
    ])
    expect(builder.metrics().triangles).toBeGreaterThan(3304)
    // No color is NaN: the county without a rate takes the coalesced 0.
    const color = layer.data?.attributes.get('Cd')
    expect(color && [...color.data].some(Number.isNaN)).toBe(false)
  })
})

describe('hex_color', () => {
  it('reads #rrggbb and #rgb property strings in SQL, with coalesce for a missing one', async () => {
    const url = 'https://example.com/lines.geojson'
    const line = (color: string | null, x: number) => ({
      type: 'Feature',
      properties: { color },
      geometry: {
        type: 'LineString',
        coordinates: [
          [x, 0],
          [x, 1],
        ],
      },
    })
    duck.registerText(
      url,
      JSON.stringify({
        type: 'FeatureCollection',
        features: [line('#ff8000', 0), line('#0F0', 1), line(null, 2)],
      })
    )
    const { runtime } = await run(
      doc(
        url,
        [
          {
            id: 'c',
            op: 'attribute',
            x: 0,
            y: 0,
            params: { name: 'rgb', expression: "hex_color(coalesce(color, '#000'))" },
          },
          {
            id: 'paths',
            op: 'path',
            x: 0,
            y: 0,
            params: { position: '[lng, lat]', pathId: 'id', order: 'vertex', color: 'rgb' },
          },
        ],
        [
          { id: 'e1', source: 'g', sourcePort: 'lines', target: 'c', targetPort: 'in' },
          { id: 'e2', source: 'c', sourcePort: 'out', target: 'paths', targetPort: 'in' },
          { id: 'e3', source: 'paths', sourcePort: 'out', target: 'map', targetPort: 'layers' },
        ]
      )
    )
    const rgb = runtime.layers()[0].data?.attributes.get('rgb')
    // The first vertex of each two-vertex line, in line order.
    const first = (n: number) =>
      [...(rgb?.data.slice(n * 6, n * 6 + 3) ?? [])].map(v => Math.round(v * 255))
    expect([first(0), first(1), first(2)]).toEqual([
      [255, 128, 0],
      [0, 255, 0],
      [0, 0, 0],
    ])
  })
})
