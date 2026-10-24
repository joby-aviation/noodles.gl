// Noodles' turf operators converted to the planner's geometry operators, run on DuckDB.
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import { MigrationError, type NoodlesEdge, type NoodlesNode, toEditorDoc } from './to-editor-doc'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
  const square = (x: number, y: number, name: string) => ({
    type: 'Feature',
    properties: { name },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + 1, y],
          [x + 1, y + 1],
          [x, y + 1],
          [x, y],
        ],
      ],
    },
  })
  const point = (x: number, y: number, id: number) => ({
    type: 'Feature',
    properties: { id },
    geometry: { type: 'Point', coordinates: [x, y] },
  })
  duck.registerText(
    'zones.geojson',
    JSON.stringify({ type: 'FeatureCollection', features: [square(0, 0, 'a'), square(5, 5, 'b')] })
  )
  duck.registerText(
    'stops.geojson',
    JSON.stringify({
      type: 'FeatureCollection',
      features: [point(0.5, 0.5, 1), point(9, 9, 2), point(0.2, 0.8, 3)],
    })
  )
}, 30_000)

const file = (id: string, url: string): NoodlesNode => ({
  id,
  type: 'FileOp',
  data: { inputs: { format: 'geojson', url } },
})
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

/** A project drawing one GeoJsonLayer of what `last.out` is, through a DeckRenderer. */
function project(
  nodes: NoodlesNode[],
  edges: NoodlesEdge[],
  last: string,
  out = 'featureCollection'
) {
  return {
    version: 19,
    nodes: [
      ...nodes,
      op('/layer', 'GeoJsonLayerOp'),
      op('/deck', 'DeckRendererOp'),
      op('/out', 'OutOp'),
    ],
    edges: [
      ...edges,
      wire(last, out, '/layer', 'data'),
      wire('/layer', 'layer', '/deck', 'layers'),
      wire('/deck', 'vis', '/out', 'vis'),
    ],
  }
}

async function draw(p: ReturnType<typeof project>) {
  const { doc } = toEditorDoc(p)
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  const layers = Object.fromEntries(runtime.layers().map(l => [l.id, l.data?.rows ?? 0]))
  return { doc, layers, runtime }
}

describe('turf operators as geometry operators', () => {
  it('buffers a file’s features by a radius a Number drives, and draws them', async () => {
    const { doc, layers } = await draw(
      project(
        [
          file('/zones', 'zones.geojson'),
          op('/radius', 'NumberOp', { val: 20 }),
          op('/buffer', 'BufferOp', { steps: 4 }),
        ],
        [wire('/zones', 'data', '/buffer', 'geojson'), wire('/radius', 'val', '/buffer', 'radius')],
        '/buffer'
      )
    )
    expect(doc.nodes.find(n => n.id === '/buffer')).toMatchObject({
      op: 'buffer',
      params: { radius: 1, units: 'kilometers', steps: 4 },
    })
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/radius', target: '/buffer', targetPort: 'par:radius' })
    )
    // Two buffered squares: rounded corners add vertices beyond the squares' five each
    expect(layers['/layer']).toBeGreaterThan(10)
  })

  it('chains operators, and splits points by a polygon, inverted', async () => {
    const nodes = [
      file('/zones', 'zones.geojson'),
      file('/stops', 'stops.geojson'),
      op('/union', 'UnionOp'),
      op('/split', 'PointInPolygonOp', { invert: true }),
    ]
    const edges = [
      wire('/zones', 'data', '/union', 'geojson'),
      wire('/stops', 'data', '/split', 'points'),
      wire('/union', 'featureCollection', '/split', 'polygon'),
    ]
    // Inverted, `inside` is the points outside every zone
    const { layers } = await draw(project(nodes, edges, '/split', 'inside'))
    expect(layers['/layer-points']).toBe(1)
  })

  it('joins zones onto stops and aggregates stops into zones', async () => {
    const joined = await draw(
      project(
        [
          file('/zones', 'zones.geojson'),
          file('/stops', 'stops.geojson'),
          op('/join', 'SpatialJoinOp'),
        ],
        [wire('/stops', 'data', '/join', 'target'), wire('/zones', 'data', '/join', 'join')],
        '/join'
      )
    )
    const rows = await joined.runtime.query(
      `SELECT id, name FROM ${joined.runtime.program()!.relations.find(r => r.id === '/join')!.ref} ORDER BY id`
    )
    expect(rows).toEqual([
      { id: 1, name: 'a' },
      { id: 2, name: null },
      { id: 3, name: 'a' },
    ])
    const counted = await draw(
      project(
        [
          file('/zones', 'zones.geojson'),
          file('/stops', 'stops.geojson'),
          op('/count', 'AggregateOp'),
        ],
        [wire('/zones', 'data', '/count', 'polygons'), wire('/stops', 'data', '/count', 'points')],
        '/count'
      )
    )
    const counts = await counted.runtime.query(
      `SELECT name, count_points FROM ${counted.runtime.program()!.relations.find(r => r.id === '/count')!.ref} ORDER BY name`
    )
    expect(counts).toEqual([
      { name: 'a', count_points: 2 },
      { name: 'b', count_points: 0 },
    ])
  })

  it('makes features from parameters: points gathered by GeoJson, a rectangle, a drawn shape', async () => {
    const points = await draw(
      project(
        [
          op('/a', 'PointOp', { coordinates: [1, 2], properties: { name: 'a' } }),
          op('/b', 'PointOp', { coordinates: { lng: 3, lat: 4 } }),
          op('/all', 'GeoJsonOp'),
        ],
        [wire('/a', 'feature', '/all', 'features'), wire('/b', 'feature', '/all', 'features')],
        '/all'
      )
    )
    expect(points.layers['/layer-points']).toBe(2)
    const rect = await draw(
      project([op('/rect', 'RectangleOp', { width: 2, height: 1 })], [], '/rect', 'feature')
    )
    expect(rect.doc.nodes.find(n => n.id === '/rect')?.params).toMatchObject({
      lng: -74.006,
      lat: 40.7128,
      width: 2,
      height: 1,
      properties: '{"altitude":0}',
    })
    // Four corners: a vertex row per corner, the ring's closing vertex dropped
    expect(rect.layers['/layer']).toBe(4)
    const drawn = await draw(
      project(
        [op('/drawn', 'GeoEditorOp', { geojson: ['{"type":"Point","coordinates":[1,1]}'] })],
        [],
        '/drawn'
      )
    )
    expect(drawn.layers['/layer-points']).toBe(1)
  })

  it('refuses what has no planner port, and turf options it has no equivalent for', () => {
    const area = project(
      [file('/zones', 'zones.geojson'), op('/area', 'AreaOp')],
      [wire('/zones', 'data', '/area', 'geojson')],
      '/area',
      'totalArea'
    )
    expect(() => toEditorDoc(area)).toThrow(MigrationError)
    expect(() => toEditorDoc(area)).toThrow(/totalArea output is not converted/)
    const corner = project(
      [
        file('/zones', 'zones.geojson'),
        op('/scale', 'TransformScaleOp', { factor: 2, origin: 'sw' }),
      ],
      [wire('/zones', 'data', '/scale', 'geojson')],
      '/scale'
    )
    expect(() => toEditorDoc(corner)).toThrow(/scaling about 'sw' is not converted/)
  })
})
