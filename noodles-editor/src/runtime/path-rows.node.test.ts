// Path rows: layers drawing a whole path per row, from a list of positions or a geometry,
// with no vertex rows in SQL.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from './__tests__/duckdb-node'
import { flattenPaths, flattenPoints } from './path-rows'
import { ProgramRuntime } from './program-runtime'
import { registerNoodlesRamps } from './ramps'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 60_000)

const doc = (query: string, layer: EditorDoc['nodes'][number], extra: EditorDoc['nodes'] = []) =>
  ({
    version: 1,
    name: 'paths',
    nodes: [
      { id: 'src', op: 'sql', x: 0, y: 0, params: { query } },
      ...extra,
      layer,
      { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
    ],
    edges: [
      {
        id: 'e1',
        source: extra.length ? extra[extra.length - 1].id : 'src',
        sourcePort: 'out',
        target: layer.id,
        targetPort: 'in',
      },
      ...extra.map((n, i) => ({
        id: `x${i}`,
        source: i === 0 ? 'src' : extra[i - 1].id,
        sourcePort: 'out',
        target: n.id,
        targetPort: 'in',
      })),
      { id: 'e2', source: layer.id, sourcePort: 'out', target: 'map', targetPort: 'layers' },
    ],
  }) as EditorDoc

async function draw(d: EditorDoc) {
  const lowered = lowerDocument(d)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.program()?.errors).toEqual([])
  const [layer] = runtime.layers()
  expect(layer.error).toBeUndefined()
  return { layer, data: layer.data!, sql: layer.plan.plan.sql }
}

const FLIGHTS = `SELECT * FROM (VALUES
  (1, [[0, 0, 0], [1, 1, 100], [2, 0, NULL]]::DOUBLE[3][], [10, 20, 30]::DOUBLE[], 0.25),
  (2, [[5, 5, 0], [6, 6, 0]]::DOUBLE[3][], [1, 2]::DOUBLE[], 1.0)
) t(id, path, ts, v)`

describe('path rows', () => {
  it('draws trips from a list of positions and a list of timestamps, one row per path', async () => {
    const { data, sql } = await draw(
      doc(FLIGHTS, {
        id: 'trips',
        op: 'trips',
        x: 0,
        y: 0,
        params: { position: 'path', timestamp: 'ts', color: '[v, 0, 0]' },
      })
    )
    // The lists are selected whole: no unnest, no ORDER BY
    expect(sql).not.toMatch(/unnest|ORDER BY/i)
    expect(data.rows).toBe(5)
    expect([...data.starts!]).toEqual([0, 3])
    const position = data.attributes.get('path')!
    expect(position.width).toBe(3)
    // A missing altitude is the ground
    expect([...position.data]).toEqual([0, 0, 0, 1, 1, 100, 2, 0, 0, 5, 5, 0, 6, 6, 0])
    expect([...data.attributes.get('ts')!.data]).toEqual([10, 20, 30, 1, 2])
    // A per-row color repeats along its path
    const reds = data.attributes.values().find(a => a.width >= 3 && a !== position)!
    expect(Array.from({ length: 5 }, (_, i) => reds.data[i * reds.width])).toEqual([
      0.25, 0.25, 0.25, 1, 1,
    ])
  })

  it('keeps only the rows a filter keeps', async () => {
    const { data } = await draw(
      doc(FLIGHTS, { id: 'paths', op: 'path', x: 0, y: 0, params: { position: 'path' } }, [
        {
          id: 'f',
          op: 'filter',
          x: 0,
          y: 0,
          params: { mode: 'expression', expression: 'v > 0.5' },
        },
      ])
    )
    expect(data.rows).toBe(2)
    expect([...data.starts!]).toEqual([0])
  })

  it('draws lines and polygons from a geometry, each layer taking its own kind', async () => {
    const shapes = `SELECT * FROM (VALUES
      (ST_GeomFromText('MULTILINESTRING ((0 0, 1 1), (2 2, 3 3, 4 4))'), 1.0),
      (ST_GeomFromText('POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1))'), 2.0),
      (ST_GeomFromText('POINT (9 9)'), 3.0),
      (NULL, 4.0)
    ) t(geom, w)`
    const lines = await draw(
      doc(shapes, { id: 'lines', op: 'path', x: 0, y: 0, params: { position: 'geom', width: 'w' } })
    )
    expect(lines.sql).not.toMatch(/ST_AsWKB/)
    expect(lines.data.rows).toBe(5)
    expect([...lines.data.starts!]).toEqual([0, 2])
    expect([...lines.data.attributes.get('w')!.data]).toEqual([1, 1, 1, 1, 1])

    const polygons = await draw(
      doc(shapes, { id: 'fill', op: 'polygon', x: 0, y: 0, params: { position: 'geom' } })
    )
    // Rings without their closing vertex: 4 for the outline, 3 for the hole
    expect(polygons.data.rows).toBe(7)
    expect([...polygons.data.starts!]).toEqual([0])
    expect([...polygons.data.rings!]).toEqual([0, 4])
  })

  it('draws a mark per point of a geometry, its row values repeated', async () => {
    const { data } = await draw(
      doc(
        `SELECT * FROM (VALUES
          (ST_GeomFromText('MULTIPOINT ((1 2), (3 4))'), 5.0),
          (ST_GeomFromText('LINESTRING (0 0, 1 1)'), 6.0),
          (ST_GeomFromText('POINT (7 8)'), 9.0)
        ) t(geom, r)`,
        { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: 'geom', radius: 'r' } }
      )
    )
    expect(data.rows).toBe(3)
    expect([...data.attributes.get('geom')!.data]).toEqual([1, 2, 0, 3, 4, 0, 7, 8, 0])
    expect([...data.attributes.get('r')!.data]).toEqual([5, 5, 9])
  })

  it('says when a row has more timestamps than positions', async () => {
    const lowered = lowerDocument(
      doc('SELECT [[0, 0], [1, 1]]::DOUBLE[2][] AS path, [1, 2, 3]::DOUBLE[] AS ts', {
        id: 'trips',
        op: 'trips',
        x: 0,
        y: 0,
        params: { position: 'path', timestamp: 'ts' },
      })
    )
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.layers()[0].error).toMatch(/3 values for 2 positions/)
  })

  it('samples each path row at a time, holding its ends, with no segment table', async () => {
    const at = async (time: number) => {
      const lowered = lowerDocument({
        version: 1,
        name: 'heads',
        nodes: [
          { id: 'src', op: 'sql', x: 0, y: 0, params: { query: FLIGHTS } },
          {
            id: 'ts',
            op: 'time-series',
            x: 0,
            y: 0,
            params: {
              rows: 'paths',
              path: 'path',
              timestamps: 'ts',
              values: 'lng, lat, alt',
              time,
            },
          },
        ],
        edges: [{ id: 'e', source: 'src', sourcePort: 'out', target: 'ts', targetPort: 'in' }],
      })
      expect(lowered.errors).toEqual([])
      const runtime = new ProgramRuntime(duck)
      await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
      const preview = await runtime.preview('ts')
      expect(preview.note).toBeUndefined()
      return preview.rows.map(r => {
        const { id, lng, lat, alt } = r as Record<string, unknown>
        return { id, lng, lat, alt }
      })
    }
    expect(await at(15)).toEqual([
      { id: 1, lng: 0.5, lat: 0.5, alt: 50 },
      { id: 2, lng: 6, lat: 6, alt: 0 },
    ])
    // Before its first time a path holds its first vertex
    expect((await at(0))[0]).toMatchObject({ lng: 0, lat: 0 })
    // After its last, its last: the missing altitude stays missing
    expect((await at(99))[0]).toMatchObject({ lng: 2, lat: 0, alt: null })
  })

  it("reads DuckDB's own geometry bytes as it reads their WKB", async () => {
    const shapes = [
      'POINT (1 2)',
      'POINT Z (1 2 3)',
      'POINT EMPTY',
      'LINESTRING (0 0, 1 1, 2 2)',
      'LINESTRING Z (0 0 5, 1 1 6)',
      'LINESTRING M (0 0 5, 1 1 6)',
      'LINESTRING ZM (0 0 5 7, 1 1 6 8)',
      'LINESTRING EMPTY',
      'POLYGON ((0 0, 4 0, 4 4, 0 0))',
      'POLYGON ((0 0, 4 0, 4 4, 0 0), (1 1, 2 1, 2 2, 1 1))',
      'POLYGON ((0 0, 4 0, 4 4, 0 0), (1 1, 2 1, 2 2, 1 1), (3 3, 3.5 3, 3.5 3.5, 3 3))',
      'POLYGON Z ((0 0 1, 4 0 1, 4 4 1, 0 0 1))',
      'POLYGON EMPTY',
      'MULTIPOINT ((1 2), (3 4))',
      'MULTILINESTRING ((0 0, 1 1), (2 2, 3 3, 4 4))',
      'MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5), (5.1 5.1, 5.2 5.1, 5.2 5.2, 5.1 5.1)))',
      'GEOMETRYCOLLECTION (POINT (5 5), LINESTRING (0 0, 1 1), POLYGON ((0 0, 1 0, 1 1, 0 0)))',
    ]
    const { table } = await duck.run(
      `SELECT g, ST_AsWKB(g) AS w FROM (VALUES ${shapes.map(w => `(ST_GeomFromText('${w}'))`).join(', ')}) t(g)`
    )
    const all = Uint32Array.from(shapes, (_, i) => i)
    const as = (column: 'g' | 'w') => ({
      channel: 'position',
      column: 'position',
      kind: 'geometry' as const,
      vector: table.getChild(column)!,
      wkb: column === 'w',
    })
    for (const kind of ['path', 'polygon'] as const) {
      const own = flattenPaths([as('g')], all, kind)
      const wkb = flattenPaths([as('w')], all, kind)
      expect([...own.starts]).toEqual([...wkb.starts])
      expect([...(own.rings ?? [])]).toEqual([...(wkb.rings ?? [])])
      expect([...own.rowOf]).toEqual([...wkb.rowOf])
      expect([...own.values.get('position')!.data]).toEqual([...wkb.values.get('position')!.data])
      expect(own.vertices).toBeGreaterThan(0)
    }
    const own = flattenPoints(table.getChild('g')!, all)
    const wkb = flattenPoints(table.getChild('w')!, all, true)
    expect([...own.rowOf]).toEqual([...wkb.rowOf])
    expect([...own.position.data]).toEqual([...wkb.position.data])
    expect(own.rowOf.length).toBe(5)
  })
})
