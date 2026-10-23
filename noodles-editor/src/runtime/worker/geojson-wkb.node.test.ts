// GeoJSON features into DuckDB as Arrow with WKB geometries: what ST_Read reads from the file.
import { lowerDocument } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { JsTables } from './js-tables'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 30_000)

const feature = (geometry: unknown, properties: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry,
  properties,
})

const features = [
  feature({ type: 'Point', coordinates: [1, 2] }, { name: 'p', n: 1 }),
  feature({ type: 'Point', coordinates: [1, 2, 3, 99] }, { name: 'pz' }),
  feature(
    {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    { n: 2.5 }
  ),
  feature({
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  }),
  feature({
    type: 'MultiPoint',
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  }),
  feature({
    type: 'MultiLineString',
    coordinates: [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [2, 2],
        [3, 3],
      ],
    ],
  }),
  feature({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    ],
  }),
  feature({
    type: 'GeometryCollection',
    geometries: [
      { type: 'Point', coordinates: [5, 5] },
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    ],
  }),
  feature(null, { name: 'none', geom: 'kept' }),
]

async function load(table: string, data: unknown) {
  const url = `https://example.com/${table}.geojson`
  duck.registerText(url, JSON.stringify(data))
  const lowered = lowerDocument({
    version: 1,
    name: 'g',
    nodes: [{ id: 'g', op: 'geojson', x: 0, y: 0, params: { url } }],
    edges: [],
  })
  const node = lowered.graph.nodes.find(n => n.id === 'g#features')
  expect(node?.type).toBe('js')
  await new JsTables(duck).make({
    js: { table, url, code: (node as { code: string }).code },
  } as never)
}

describe('geojson as WKB', () => {
  it('reads every geometry type, z, null geometries and properties', async () => {
    await load('all_types', { type: 'FeatureCollection', features })
    const rows = await duck.rows(
      'SELECT name, n, p_geom, ST_AsText(geom) AS wkt FROM all_types ORDER BY rowid'
    )
    expect(rows.map(r => r.wkt)).toEqual([
      'POINT (1 2)',
      // A fourth coordinate is dropped; z stays
      'POINT Z (1 2 3)',
      'LINESTRING (0 0, 1 1)',
      'POLYGON ((0 0, 1 0, 1 1, 0 0))',
      'MULTIPOINT (0 0, 1 1)',
      'MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))',
      'MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)))',
      'GEOMETRYCOLLECTION (POINT (5 5), LINESTRING (0 0, 1 1))',
      null,
    ])
    expect(rows[0]).toMatchObject({ name: 'p', n: 1, p_geom: null })
    expect(rows[2]).toMatchObject({ name: null, n: 2.5 })
    expect(rows[8]).toMatchObject({ name: 'none', p_geom: 'kept' })
  })

  it('reads a lone Feature or geometry as one feature', async () => {
    await load('lone_feature', features[0])
    await load('lone_geometry', {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [2, 2],
      ],
    })
    expect(await duck.rows('SELECT name, ST_AsText(geom) AS wkt FROM lone_feature')).toEqual([
      { name: 'p', wkt: 'POINT (1 2)' },
    ])
    expect(await duck.rows('SELECT ST_AsText(geom) AS wkt FROM lone_geometry')).toEqual([
      { wkt: 'LINESTRING (0 0, 2 2)' },
    ])
  })

  it('falls back to ST_Read for properties Arrow cannot type', async () => {
    await load('mixed_props', {
      type: 'FeatureCollection',
      features: [
        feature({ type: 'Point', coordinates: [0, 0] }, { v: 1 }),
        feature({ type: 'Point', coordinates: [1, 1] }, { v: { nested: true } }),
      ],
    })
    const [row] = await duck.rows('SELECT count(*)::INTEGER AS n FROM mixed_props')
    expect(row.n).toBe(2)
  })

  it('leaves formats only GDAL reads to ST_Read', () => {
    const lowered = lowerDocument({
      version: 1,
      name: 'g',
      nodes: [{ id: 'g', op: 'geojson', x: 0, y: 0, params: { url: '@/counties.shp' } }],
      edges: [],
    })
    expect(lowered.graph.nodes.find(n => n.id === 'g#features')?.type).toBe('source')
  })
})
