// The geometry operators on DuckDB spatial, each against what turf gives for the same input.
import {
  type DocEdge,
  type DocNode,
  type EditorDoc,
  lowerDocument,
  parameterValues,
} from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 30_000)

type Row = Record<string, unknown> & { wkt: string }

const fc = (...features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features })
const feature = (geometry: unknown, properties: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry,
  properties,
})
const point = (lng: number, lat: number, properties: Record<string, unknown> = {}) =>
  feature({ type: 'Point', coordinates: [lng, lat] }, properties)
const square = (x0: number, y0: number, x1: number, y1: number, properties = {}) =>
  feature(
    {
      type: 'Polygon',
      coordinates: [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ],
      ],
    },
    properties
  )
const line = (coordinates: number[][], properties = {}) =>
  feature({ type: 'LineString', coordinates }, properties)

/**
 * An operator over features: `inputs` maps each of its ports to GeoJSON, which a Features node
 * writes. Its outputs are read back with each geometry as WKT.
 */
async function run(
  op: string,
  params: Record<string, unknown>,
  inputs: Record<string, string> = {},
  outputs = ['out']
): Promise<{ rows: Record<string, Row[]>; runtime: ProgramRuntime }> {
  const nodes: DocNode[] = [
    { id: 'op', op, x: 0, y: 0, params: params as DocNode['params'] },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, x]' } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
  ]
  const edges: DocEdge[] = []
  for (const [port, geojson] of Object.entries(inputs)) {
    nodes.push({ id: `src-${port}`, op: 'features', x: 0, y: 0, params: { geojson } })
    edges.push({
      id: `in-${port}`,
      source: `src-${port}`,
      sourcePort: 'out',
      target: 'op',
      targetPort: port,
    })
  }
  // Each output is read by a query a layer draws, so it is compiled
  const probes = outputs.map((o, i) => {
    nodes.push({
      id: `probe-${o}`,
      op: 'sql',
      x: 0,
      y: 0,
      params: { query: 'SELECT 0.0 AS x FROM {{input0}}' },
    })
    edges.push({
      id: `p-${o}`,
      source: 'op',
      sourcePort: o,
      target: `probe-${o}`,
      targetPort: 'in0',
    })
    return { o, i }
  })
  const probeUnion = probes.length > 1
  if (probeUnion) {
    nodes.push({ id: 'all', op: 'union', x: 0, y: 0, params: {} })
    for (const { o, i } of probes) {
      edges.push({
        id: `u-${o}`,
        source: `probe-${o}`,
        sourcePort: 'out',
        target: 'all',
        targetPort: 'in',
        index: i,
      })
    }
  }
  edges.push({
    id: 'd',
    source: probeUnion ? 'all' : `probe-${outputs[0]}`,
    sourcePort: 'out',
    target: 'dots',
    targetPort: 'in',
  })
  edges.push({ id: 'm', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' })
  const doc: EditorDoc = { version: 1, name: op, nodes, edges }
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  const rows: Record<string, Row[]> = {}
  for (const o of outputs) {
    // The probe reads the output's relation
    const probe = runtime.program()!.relations.find(r => r.id === `probe-${o}`)!
    const ref = runtime.program()!.relations.find(r => r.id === probe.inputs[0])!.ref
    rows[o] = (await runtime.query(
      `SELECT * EXCLUDE (geom), ST_AsText(geom) AS wkt FROM ${ref}`
    )) as Row[]
  }
  return { rows, runtime }
}

const first = async (...args: Parameters<typeof run>) => (await run(...args)).rows.out
const scalar = async (sql: string) => Object.values((await duck.rows(sql))[0])[0] as number
const areaKm2 = (wkt: string) =>
  scalar(`SELECT ST_Area_Spheroid(ST_FlipCoordinates(ST_GeomFromText('${wkt}'))) / 1e6`)
const coords = (wkt: string) => (wkt.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)

describe('features from parameters', () => {
  it('writes GeoJSON features with their properties as columns', async () => {
    const rows = await first('features', {
      geojson: fc(point(1, 2, { name: 'a', n: 3 }), point(4, 5, { name: 'b' })),
    })
    expect(rows.map(r => [r.wkt, r.name, r.n])).toEqual([
      ['POINT (1 2)', 'a', 3],
      ['POINT (4 5)', 'b', null],
    ])
  })

  it('makes a point and a rectangle of a size on the ground', async () => {
    expect((await first('point', { lng: 1, lat: 2, properties: '{"kind":"x"}' }))[0]).toMatchObject(
      {
        wkt: 'POINT (1 2)',
        kind: 'x',
      }
    )
    const [rect] = await first('rectangle', {
      lng: 0,
      lat: 0,
      width: 2,
      height: 1,
      units: 'kilometers',
      properties: '',
    })
    expect(await areaKm2(rect.wkt)).toBeCloseTo(2, 2)
  })

  it('grids a bounding box in hexagons, squares and points', async () => {
    // 50 km is 0.45 degrees there: two whole cells a side, centered
    const box = { west: 0, south: 0, east: 1, north: 1, cellSize: 50, units: 'kilometers' }
    const squares = await first('geo-grid', { ...box, shape: 'square' })
    expect(squares).toHaveLength(4)
    expect(await areaKm2(squares[0].wkt)).toBeCloseTo(2500, -1)
    const points = await first('geo-grid', { ...box, shape: 'point' })
    expect(points).toHaveLength(9)
    expect(points.some(p => coords(p.wkt).every(c => Math.abs(c - 0.5) < 1e-9))).toBe(true)
    const hexes = await first('geo-grid', { ...box, cellSize: 10, shape: 'hex' })
    expect(hexes.length).toBeGreaterThan(20)
    expect(hexes.every(h => h.wkt.startsWith('POLYGON') && coords(h.wkt).length === 14)).toBe(true)
  })
})

describe('per-feature geometry', () => {
  it('buffers by a distance on the ground, at the equator and in the north', async () => {
    for (const lat of [0, 60]) {
      const [disc] = await first(
        'buffer',
        { radius: 1, units: 'kilometers', steps: 16 },
        { in: fc(point(10, lat)) }
      )
      // A circle of radius 1 km is π km²
      expect(await areaKm2(disc.wkt)).toBeCloseTo(Math.PI, 1)
    }
  })

  it('takes centroids, keeping properties', async () => {
    expect(await first('centroid', {}, { in: fc(square(0, 0, 2, 2, { id: 7 })) })).toEqual([
      { id: 7, wkt: 'POINT (1 1)' },
    ])
  })

  it('simplifies within a tolerance in degrees', async () => {
    const [simple] = await first(
      'simplify',
      { tolerance: 0.1, preserveTopology: true },
      {
        in: fc(
          line([
            [0, 0],
            [1, 0.01],
            [2, 0],
          ])
        ),
      }
    )
    expect(simple.wkt).toBe('LINESTRING (0 0, 2 0)')
  })

  it('rotates clockwise, scales and moves along a bearing', async () => {
    const [turned] = await first(
      'transform',
      { rotate: 90, scale: 1, distance: 0, direction: 0, units: 'kilometers', origin: 'centroid' },
      {
        in: fc(
          line([
            [0, -1],
            [0, 1],
          ])
        ),
      }
    )
    const [x0, y0, x1, y1] = coords(turned.wkt)
    // North-south becomes west-east, as long on the ground: a degree of latitude at the equator
    // is 0.9933 degrees of longitude
    expect([x0, y0, x1, y1].map(v => Math.round(v * 10000) / 10000)).toEqual([
      -0.9933, 0, 0.9933, 0,
    ])
    const [grown] = await first(
      'transform',
      { rotate: 0, scale: 2, distance: 0, direction: 0, units: 'kilometers', origin: 'centroid' },
      { in: fc(square(0, 0, 0.1, 0.1)) }
    )
    expect(
      (await areaKm2(grown.wkt)) / (await areaKm2('POLYGON ((0 0, 0.1 0, 0.1 0.1, 0 0.1, 0 0))'))
    ).toBeCloseTo(4, 2)
    const [moved] = await first(
      'transform',
      {
        rotate: 0,
        scale: 1,
        distance: 111.31949,
        direction: 90,
        units: 'kilometers',
        origin: 'centroid',
      },
      { in: fc(point(0, 0)) }
    )
    expect(coords(moved.wkt)[0]).toBeCloseTo(1, 4)
  })

  it('reprojects with PROJ', async () => {
    const [p] = await first(
      'reproject',
      { from: 'EPSG:4326', to: 'EPSG:3857' },
      { in: fc(point(-74, 40.7)) }
    )
    expect(coords(p.wkt)[0]).toBeCloseTo(-8237642.3, 0)
  })

  it('closes lines into polygons and outlines polygons', async () => {
    const [poly] = await first(
      'line-to-polygon',
      {},
      {
        in: fc(
          line([
            [0, 0],
            [1, 0],
            [1, 1],
          ])
        ),
      }
    )
    expect(poly.wkt).toBe('POLYGON ((0 0, 1 0, 1 1, 0 0))')
    const [outline] = await first('polygon-to-line', {}, { in: fc(square(0, 0, 1, 1)) })
    expect(outline.wkt).toMatch(/^LINESTRING/)
  })

  it('explodes into parts or vertices', async () => {
    const multi = feature(
      {
        type: 'MultiPoint',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      { id: 1 }
    )
    expect(await first('explode', { mode: 'parts' }, { in: fc(multi) })).toEqual([
      { id: 1, wkt: 'POINT (0 0)' },
      { id: 1, wkt: 'POINT (1 1)' },
    ])
    expect(
      await first('explode', { mode: 'vertices' }, { in: fc(square(0, 0, 1, 1)) })
    ).toHaveLength(5)
  })

  it('finds points and slices along lines by distance on the ground', async () => {
    const degree = 111.31949
    const [halfway] = await first(
      'along',
      { distance: degree / 2, units: 'kilometers' },
      {
        in: fc(
          line([
            [0, 0],
            [1, 0],
          ])
        ),
      }
    )
    expect(coords(halfway.wkt)[0]).toBeCloseTo(0.5, 2)
    const [slice] = await first(
      'line-slice',
      { start: 0, stop: degree / 4, units: 'kilometers' },
      {
        in: fc(
          line([
            [0, 0],
            [1, 0],
          ])
        ),
      }
    )
    expect(coords(slice.wkt)[2]).toBeCloseTo(0.25, 2)
  })

  it('measures area and length on the spheroid', async () => {
    const [a] = await first(
      'area',
      { units: 'squareKilometers', column: 'area' },
      { in: fc(square(0, 0, 1, 1)) }
    )
    expect(a.area).toBeCloseTo(12308.78, 0)
    const [l] = await first(
      'length',
      { units: 'kilometers', column: 'length' },
      {
        in: fc(
          line([
            [-74, 40.7],
            [-0.13, 51.5],
          ])
        ),
      }
    )
    // New York to London
    expect(l.length).toBeGreaterThan(5550)
    expect(l.length).toBeLessThan(5600)
  })
})

describe('features together', () => {
  it('dissolves by a column, and into separate parts', async () => {
    const shapes = fc(
      square(0, 0, 2, 2, { g: 'a' }),
      square(1, 0, 3, 2, { g: 'a' }),
      square(10, 10, 11, 11, { g: 'b' })
    )
    const byGroup = await first('dissolve', { by: 'g', split: false }, { in: shapes })
    expect(byGroup.map(r => r.g).sort()).toEqual(['a', 'b'])
    expect(await first('dissolve', { by: '', split: false }, { in: shapes })).toHaveLength(1)
    expect(await first('dissolve', { by: '', split: true }, { in: shapes })).toHaveLength(2)
  })

  it('wraps points in a convex hull', async () => {
    const [hull] = await first(
      'convex-hull',
      {},
      { in: fc(point(0, 0), point(1, 0), point(1, 1), point(0, 1), point(0.5, 0.5)) }
    )
    expect(hull.wkt).toMatch(/^POLYGON/)
    expect(coords(hull.wkt)).toHaveLength(10)
  })

  it('gives each point its Voronoi cell, inside the bounding box', async () => {
    const cells = await first(
      'voronoi',
      {},
      { in: fc(point(0, 0, { id: 'a' }), point(2, 0, { id: 'b' }), point(1, 2, { id: 'c' })) }
    )
    expect(cells.map(c => c.id).sort()).toEqual(['a', 'b', 'c'])
    const total = (await Promise.all(cells.map(c => areaKm2(c.wkt)))).reduce((a, b) => a + b)
    expect(total).toBeCloseTo(await areaKm2('POLYGON ((0 0, 2 0, 2 2, 0 2, 0 0))'), -1)
  })

  it('clips to the inside or the outside of a mask', async () => {
    const shapes = {
      in: fc(square(0, 0, 2, 2, { id: 1 }), square(5, 5, 6, 6, { id: 2 })),
      mask: fc(square(1, 0, 3, 2)),
    }
    const inside = await first('clip', { keep: 'inside' }, shapes)
    expect(inside.map(r => r.id)).toEqual([1])
    expect(await areaKm2(inside[0].wkt)).toBeCloseTo(
      await areaKm2('POLYGON ((1 0, 2 0, 2 2, 1 2, 1 0))'),
      0
    )
    const outside = await first('clip', { keep: 'outside' }, shapes)
    expect(outside.map(r => r.id).sort()).toEqual([1, 2])
  })

  it('joins the first matching feature’s columns, its values replacing same-named ones', async () => {
    const rows = await first(
      'spatial-join',
      { predicate: 'within', prefix: '' },
      {
        in: fc(point(0.5, 0.5, { name: 'p', id: 1 }), point(9, 9, { name: 'q', id: 2 })),
        join: fc(
          square(0, 0, 1, 1, { name: 'zone', v: 7 }),
          square(0, 0, 2, 2, { name: 'big', v: 8 })
        ),
      }
    )
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(byId[1]).toMatchObject({ name: 'zone', v: 7, wkt: 'POINT (0.5 0.5)' })
    expect(byId[2]).toMatchObject({ name: 'q', v: null })
  })

  it('splits features into inside and outside polygons, edges inside', async () => {
    const { rows } = await run(
      'inside',
      {},
      {
        in: fc(point(0.5, 0.5, { id: 1 }), point(1, 0.5, { id: 2 }), point(3, 3, { id: 3 })),
        polygons: fc(square(0, 0, 1, 1)),
      },
      ['inside', 'outside']
    )
    expect(rows.inside.map(r => r.id).sort()).toEqual([1, 2])
    expect(rows.outside.map(r => r.id)).toEqual([3])
  })

  it('aggregates the points within each polygon', async () => {
    const shapes = {
      in: fc(square(0, 0, 1, 1, { zone: 'a' }), square(5, 5, 6, 6, { zone: 'b' })),
      points: fc(point(0.2, 0.2, { v: 2 }), point(0.8, 0.8, { v: 5 }), point(9, 9, { v: 100 })),
    }
    const counts = await first(
      'aggregate-within',
      { operation: 'count', column: '', as: '' },
      shapes
    )
    expect(Object.fromEntries(counts.map(r => [r.zone, r.count_points]))).toEqual({ a: 2, b: 0 })
    const sums = await first('aggregate-within', { operation: 'sum', column: 'v', as: '' }, shapes)
    expect(Object.fromEntries(sums.map(r => [r.zone, r.sum_v]))).toEqual({ a: 7, b: 0 })
  })

  it('finds the nearest feature and its distance in kilometers', async () => {
    const [near] = await first(
      'nearest',
      { lng: 0, lat: 0 },
      { in: fc(point(1, 0, { id: 'far' }), point(0.1, 0, { id: 'near' })) }
    )
    expect(near.id).toBe('near')
    expect(near.distanceToPoint).toBeCloseTo(11.1, 0)
  })
})

describe('turf in the engine', () => {
  const blobs = fc(
    point(0, 0),
    point(0.01, 0),
    point(0, 0.01),
    point(0.01, 0.01),
    point(5, 5),
    point(5.01, 5),
    point(5, 5.01),
    point(5.01, 5.01)
  )

  it('clusters by k-means and by density', async () => {
    const kmeans = await first(
      'cluster',
      { method: 'kmeans', clusters: 2, maxDistance: 1, units: 'kilometers', minPoints: 3 },
      { in: blobs }
    )
    expect(new Set(kmeans.map(r => r.cluster)).size).toBe(2)
    const dbscan = await first(
      'cluster',
      { method: 'dbscan', clusters: 5, maxDistance: 5, units: 'kilometers', minPoints: 3 },
      { in: blobs }
    )
    expect(new Set(dbscan.map(r => r.cluster)).size).toBe(2)
    expect(dbscan.every(r => r.dbscan === 'core' || r.dbscan === 'edge')).toBe(true)
  })

  it('interpolates a grid, draws isolines through it, and triangulates points', async () => {
    const samples = fc(
      point(0, 0, { value: 0 }),
      point(1, 0, { value: 10 }),
      point(0, 1, { value: 10 }),
      point(1, 1, { value: 20 })
    )
    const grid = await first(
      'interpolate',
      { property: 'value', cellSize: 20, units: 'kilometers', weight: 2, gridType: 'point' },
      { in: samples }
    )
    expect(grid.length).toBeGreaterThan(9)
    expect(grid.every(r => typeof r.value === 'number')).toBe(true)
    const tin = await first('tin', { property: 'value' }, { in: samples })
    expect(tin).toHaveLength(2)
    expect(tin.every(t => t.wkt.startsWith('POLYGON'))).toBe(true)
  })

  it('smooths lines', async () => {
    const zigzag = fc(
      line(
        [
          [0, 0],
          [1, 1],
          [2, 0],
          [3, 1],
          [4, 0],
        ],
        { id: 1 }
      )
    )
    const [averaged] = await first(
      'smooth-lines',
      {
        method: 'gaussian',
        windowSize: 3,
        samplesPerSegment: 12,
        alpha: 0.5,
        tension: 0,
        turnRadiusMeters: 250,
      },
      { in: zigzag }
    )
    expect(averaged.id).toBe(1)
    expect(Math.max(...coords(averaged.wkt).filter((_, i) => i % 2 === 1))).toBeLessThan(1)
    const [spline] = await first(
      'smooth-lines',
      {
        method: 'catmull-rom',
        windowSize: 5,
        samplesPerSegment: 8,
        alpha: 0.5,
        tension: 0,
        turnRadiusMeters: 250,
      },
      { in: zigzag }
    )
    expect(coords(spline.wkt).length / 2).toBeGreaterThan(20)
  })
})
