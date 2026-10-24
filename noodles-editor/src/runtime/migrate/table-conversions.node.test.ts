// Noodles' operators on rows converted to planner nodes, run on DuckDB.
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import {
  MigrationError,
  type NoodlesEdge,
  type NoodlesNode,
  type NoodlesProject,
  toEditorDoc,
} from './to-editor-doc'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 30_000)
afterEach(() => vi.unstubAllGlobals())

const op = (id: string, type: string, inputs: Record<string, unknown> = {}): NoodlesNode => ({
  id,
  type,
  data: { inputs },
})
const wire = (source: string, out: string, target: string, field: string): NoodlesEdge => ({
  id: `${source}.${out}->${target}.${field}`,
  source,
  sourceHandle: `out.${out}`,
  target,
  targetHandle: `par.${field}`,
})

const CITIES =
  "SELECT * FROM (VALUES ('nyc', -74.0, 40.7, 8.3), ('sf', -122.4, 37.8, 0.9), ('la', -118.2, 34.1, 3.9), ('chi', -87.6, 41.9, 2.7)) AS t(name, lng, lat, pop)"
const cities = () => op('/cities', 'DuckDbOp', { query: CITIES })

/**
 * A ScatterplotLayer of what `last.out` is, positioned by an accessor, through a DeckRenderer.
 * Its positions are read back as [lng, lat] pairs.
 */
async function scatter(
  nodes: NoodlesNode[],
  edges: NoodlesEdge[],
  last: string,
  { out = 'data', position = '[d.lng, d.lat]' } = {}
) {
  const project: NoodlesProject = {
    version: 19,
    nodes: [
      ...nodes,
      op('/where', 'AccessorOp', { expression: position }),
      op('/dots', 'ScatterplotLayerOp'),
      op('/deck', 'DeckRendererOp'),
      op('/out', 'OutOp'),
    ],
    edges: [
      ...edges,
      wire(last, out, '/dots', 'data'),
      wire('/where', 'accessor', '/dots', 'getPosition'),
      wire('/dots', 'layer', '/deck', 'layers'),
      wire('/deck', 'vis', '/out', 'vis'),
    ],
  }
  const { doc } = toEditorDoc(project)
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  const layer = runtime.layers()[0]
  expect(layer.error).toBeUndefined()
  const attr = layer.data!.attributes.get(layer.plan.plan.layer!.bindings[0].attribute)!
  const positions = Array.from({ length: layer.data!.rows }, (_, r) =>
    [0, 1].map(c => Math.round(attr.data[r * attr.width + c] * 100) / 100)
  )
  return { doc, positions, runtime }
}

const filter = (condition: string, value: string, columnName = 'pop') =>
  scatter(
    [cities(), op('/f', 'FilterOp', { columnName, condition, value })],
    [wire('/cities', 'data', '/f', 'data')],
    '/f'
  )

describe('rows', () => {
  it('filters by a number, by text, by a substring and by a list', async () => {
    const big = await filter('greater than', '3')
    expect(big.positions).toEqual([
      [-74, 40.7],
      [-118.2, 34.1],
    ])
    expect(big.doc.nodes.find(n => n.id === '/f')).toMatchObject({
      op: 'filter',
      params: { mode: 'compare', column: 'pop', op: '>', value: 3 },
    })
    expect((await filter('equals', 'sf', 'name')).positions).toEqual([[-122.4, 37.8]])
    expect((await filter('contains', 'c', 'name')).positions).toHaveLength(2)
    expect((await filter('not in', 'nyc,sf', 'name')).positions).toHaveLength(2)
  })

  it('sorts, slices and selects one row, wrapping', async () => {
    const sorted = await scatter(
      [
        cities(),
        op('/s', 'SortOp', { key: 'pop', order: 'desc' }),
        op('/slice', 'SliceOp', { start: 1, end: 3 }),
      ],
      [wire('/cities', 'data', '/s', 'data'), wire('/s', 'data', '/slice', 'data')],
      '/slice'
    )
    // By population: nyc, la, chi, sf; the second and third
    expect(sorted.positions).toEqual([
      [-118.2, 34.1],
      [-87.6, 41.9],
    ])
    const wrapped = await scatter(
      [cities(), op('/pick', 'SelectOp', { index: 5, wrap: true })],
      [wire('/cities', 'data', '/pick', 'data')],
      '/pick',
      { out: 'value' }
    )
    expect(wrapped.positions).toEqual([[-122.4, 37.8]])
  })

  it('concatenates tables, and pairs rows for accessors that read both', async () => {
    const both = await scatter(
      [
        cities(),
        op('/more', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat' }),
        op('/all', 'ConcatOp'),
      ],
      [wire('/cities', 'data', '/all', 'values'), wire('/more', 'data', '/all', 'values')],
      '/all'
    )
    expect(both.positions).toHaveLength(5)
    const pairs = await scatter(
      [cities(), op('/x', 'CrossOp')],
      [wire('/cities', 'data', '/x', 'data')],
      '/x',
      { out: 'pairs', position: '[d[0].lng, d[1].lat]' }
    )
    // Four rows make six pairs; the first is nyc's longitude with sf's latitude
    expect(pairs.positions).toHaveLength(6)
    expect(pairs.positions[0]).toEqual([-74, 37.8])
    const hub = await scatter(
      [cities(), op('/net', 'NetworkOp', { hub: true })],
      [wire('/cities', 'data', '/net', 'skyports')],
      '/net',
      { out: 'routes', position: 'd.destination' }
    )
    expect(hub.positions).toEqual([
      [-122.4, 37.8],
      [-118.2, 34.1],
      [-87.6, 41.9],
    ])
  })

  it('randomizes an attribute within its range', async () => {
    const { runtime } = await scatter(
      [cities(), op('/r', 'RandomizeAttributeOp', { key: 'jitter', min: 10, max: 20 })],
      [wire('/cities', 'data', '/r', 'data')],
      '/r',
      { position: '[d.jitter, d.lat]' }
    )
    const layer = runtime.layers()[0]
    expect(layer.error).toBeUndefined()
    const attr = layer.data!.attributes.get(layer.plan.plan.layer!.bindings[0].attribute)!
    const xs = Array.from({ length: 4 }, (_, r) => attr.data[r * attr.width])
    expect(xs.every(x => x >= 10 && x <= 20)).toBe(true)
  })
})

describe('rows from parameters', () => {
  it('scatters points over bounds, the same for a seed', async () => {
    const bounds = [
      [10, 20],
      [11, 22],
    ]
    const a = await scatter([op('/pts', 'ScatterOp', { bounds, count: 50, seed: 3 })], [], '/pts', {
      out: 'points',
    })
    expect(a.positions).toHaveLength(50)
    expect(a.positions.every(([x, y]) => x >= 10 && x <= 11 && y >= 20 && y <= 22)).toBe(true)
    const b = await scatter([op('/pts', 'ScatterOp', { bounds, count: 50, seed: 3 })], [], '/pts', {
      out: 'points',
    })
    expect(b.positions).toEqual(a.positions)
  })

  it('writes a table editor’s rows, JSON and an arc as code the engine runs', async () => {
    const rows = [
      { city: 'a', position: [1, 2] },
      { city: 'b', position: [3, 4] },
    ]
    const table = await scatter([op('/t', 'TableEditorOp', { data: rows })], [], '/t', {
      position: 'd.position',
    })
    expect(table.positions).toEqual([
      [1, 2],
      [3, 4],
    ])
    const json = await scatter([op('/j', 'JSONOp', { text: ['[{"lng": 5, "lat": 6}]'] })], [], '/j')
    expect(json.positions).toEqual([[5, 6]])
    const arc = await scatter(
      [
        op('/arc', 'ArcOp', {
          source: { lng: -74, lat: 40.7 },
          target: { lng: -0.1, lat: 51.5 },
          segmentCount: 10,
        }),
      ],
      [],
      '/arc',
      { out: 'path', position: '[d[0], d[1]]' }
    )
    expect(arc.positions.length).toBeGreaterThan(9)
    expect(arc.positions[0]).toEqual([-74, 40.7])
  })

  it('fetches Overpass features in the engine, with Bounds folded into the query', async () => {
    const osm = {
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { leisure: 'park' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
        { type: 'node', id: 2, lat: 5, lon: 6, tags: { amenity: 'bench' } },
      ],
    }
    const fetch = vi.fn(async () => new Response(JSON.stringify(osm)))
    vi.stubGlobal('fetch', fetch)
    const project: NoodlesProject = {
      version: 19,
      nodes: [
        op('/bounds', 'BoundsOp', { southwest: [-74.05, 40.68], northeast: [-73.9, 40.82] }),
        op('/parks', 'OverpassOp'),
        op('/layer', 'GeoJsonLayerOp'),
        op('/deck', 'DeckRendererOp'),
        op('/out', 'OutOp'),
      ],
      edges: [
        wire('/bounds', 'bounds', '/parks', 'bbox'),
        wire('/parks', 'data', '/layer', 'data'),
        wire('/layer', 'layer', '/deck', 'layers'),
        wire('/deck', 'vis', '/out', 'vis'),
      ],
    }
    const { doc } = toEditorDoc(project)
    expect(doc.nodes.some(n => n.id === '/bounds')).toBe(false)
    const lowered = lowerDocument(doc)
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.program()?.errors).toEqual([])
    const body = String(
      (fetch.mock.calls[0] as unknown[])[1] &&
        ((fetch.mock.calls[0] as unknown[])[1] as RequestInit).body
    )
    expect(body).toContain('(40.68,-74.05,40.82,-73.9)')
    const rows = Object.fromEntries(runtime.layers().map(l => [l.id, l.data?.rows ?? 0]))
    expect(rows['/layer']).toBe(3)
    expect(rows['/layer-points']).toBe(1)
  })

  it('reads GeoParquet and shapefiles as features', () => {
    const project = (source: NoodlesNode): NoodlesProject => ({
      version: 19,
      nodes: [source, op('/layer', 'GeoJsonLayerOp'), op('/deck', 'DeckRendererOp')],
      edges: [
        wire(source.id, 'featureCollection', '/layer', 'data'),
        wire('/layer', 'layer', '/deck', 'layers'),
      ],
    })
    const parquet = toEditorDoc(
      project(op('/pq', 'GeoParquetOp', { url: 'https://x/b.parquet', limit: 10 }))
    ).doc
    expect(parquet.nodes.find(n => n.id === '/pq')?.params.query).toBe(
      `SELECT * EXCLUDE ("geometry"), "geometry"::GEOMETRY AS geom FROM read_parquet('https://x/b.parquet') LIMIT 10`
    )
    const shp = toEditorDoc(project(op('/shp', 'ShapefileOp', { url: 'https://x/a.shp' }))).doc
    expect(shp.nodes.find(n => n.id === '/shp')).toMatchObject({
      op: 'geojson',
      params: { url: 'https://x/a.shp' },
    })
    expect(shp.edges).toContainEqual(
      expect.objectContaining({ source: '/shp', sourcePort: 'features', target: '/shp-rows' })
    )
  })

  it('refuses what has no conversion', () => {
    const fromEnd = () =>
      scatter(
        [cities(), op('/s', 'SliceOp', { start: -2 })],
        [wire('/cities', 'data', '/s', 'data')],
        '/s'
      )
    return expect(fromEnd()).rejects.toThrow(MigrationError)
  })
})

describe('BrushableHistogramOp', () => {
  const histogram = (extra: NoodlesEdge[] = []): NoodlesProject => ({
    version: 19,
    nodes: [
      op('/rows', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat, 3.0 AS mag' }),
      op('/hist', 'BrushableHistogramOp', {
        field: 'mag',
        binCount: 30,
        brushMin: 2,
        brushMax: 6,
        brushMode: 'offset',
      }),
      op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
      op('/points', 'ScatterplotLayerOp'),
      op('/deck', 'DeckRendererOp'),
      op('/out', 'OutOp'),
    ],
    edges: [
      wire('/rows', 'data', '/hist', 'data'),
      wire('/hist', 'filteredData', '/points', 'data'),
      wire('/where', 'accessor', '/points', 'getPosition'),
      wire('/points', 'layer', '/deck', 'layers'),
      wire('/deck', 'vis', '/out', 'vis'),
      ...extra,
    ],
  })

  it('converts to the planner histogram on the data path, with its brush', () => {
    const { doc } = toEditorDoc(histogram())
    expect(doc.nodes.find(n => n.id === '/hist')).toMatchObject({
      op: 'brushable-histogram',
      params: { column: 'mag', binCount: 30, brushMin: 2, brushMax: 6, brushMode: 'offset' },
    })
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/rows', target: '/hist', targetPort: 'in' })
    )
    expect(lowerDocument(doc).errors).toEqual([])
  })

  it('refuses wired bins, which are the bins output now', () => {
    const chart = op('/chart', 'ChartOp')
    const project = histogram([wire('/hist', 'binData', '/chart', 'data')])
    project.nodes.push(chart)
    expect(() => toEditorDoc(project)).toThrow(/wired histogram binData is not converted/)
  })
})

describe('TableEditorOp cell keyframes', () => {
  const kf = (id: string, position: number, value: unknown) => ({
    id,
    position,
    connectedRight: true,
    handles: [0.5, 1, 0.5, 0] as [number, number, number, number],
    value,
  })

  it('convert to tracks on the table rows, text included', () => {
    const project: NoodlesProject = {
      version: 19,
      nodes: [
        op('/table', 'TableEditorOp', {
          data: [
            { city: 'Denver', population: 700 },
            { city: 'Boulder', population: 100 },
          ],
        }),
        op('/where', 'AccessorOp', { expression: '[0, 0]' }),
        op('/points', 'ScatterplotLayerOp'),
        op('/deck', 'DeckRendererOp'),
        op('/out', 'OutOp'),
      ],
      edges: [
        wire('/table', 'data', '/points', 'data'),
        wire('/where', 'accessor', '/points', 'getPosition'),
        wire('/points', 'layer', '/deck', 'layers'),
        wire('/deck', 'vis', '/out', 'vis'),
      ],
      timeline: {
        sheetsById: {
          Noodles: {
            sequence: {
              length: 10,
              subUnitsPerUnit: 30,
              tracksByObject: {
                table: {
                  trackIdByPropPath: { 'data / 1 / population': 'a', 'data / 0 / city': 'b' },
                  trackData: {
                    a: {
                      type: 'BasicKeyframedTrack',
                      keyframes: [kf('a0', 0, 100), kf('a1', 10, 300)],
                    },
                    b: { type: 'BasicKeyframedTrack', keyframes: [kf('b0', 0, 'Denver')] },
                  },
                },
              },
            },
          },
        },
      },
    }
    const { doc, warnings } = toEditorDoc(project)
    expect(warnings.filter(w => w.startsWith('timeline'))).toEqual([])
    const tracks = doc.timeline?.tracks ?? []
    expect(tracks.map(t => t.target).sort()).toEqual([
      '/table.rows.0.city',
      '/table.rows.1.population',
    ])
    expect(tracks.find(t => t.target === '/table.rows.0.city')?.keyframes[0]).toMatchObject({
      value: 'Denver',
      interpolation: 'hold',
    })
    expect(lowerDocument(doc).errors).toEqual([])
  })
})
