// The rest of deck's row layers converted to planner layers, run on DuckDB.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import {
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

async function run(project: NoodlesProject) {
  const { doc, warnings } = toEditorDoc(project)
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  for (const l of runtime.layers()) expect(l.error).toBeUndefined()
  return { doc, warnings, layers: Object.fromEntries(runtime.layers().map(l => [l.id, l])) }
}

/** One layer of a type over a query's rows, its accessors given as expressions by input. */
function layer(
  type: string,
  query: string,
  accessors: Record<string, string>,
  inputs: Record<string, unknown> = {}
) {
  const nodes = [
    op('/rows', 'DuckDbOp', { query }),
    op('/layer', type, inputs),
    op('/deck', 'DeckRendererOp'),
  ]
  const edges = [
    wire('/rows', 'data', '/layer', 'data'),
    wire('/layer', 'layer', '/deck', 'layers'),
  ]
  for (const [field, expression] of Object.entries(accessors)) {
    nodes.push(op(`/${field}-of`, 'AccessorOp', { expression }))
    edges.push(wire(`/${field}-of`, 'accessor', '/layer', field))
  }
  return { version: 18, nodes, edges } as NoodlesProject
}

const POINTS =
  "SELECT * FROM (VALUES (-74.0, 40.7, 'a', 3.0), (-73.9, 40.8, 'b', 5.0), (-73.95, 40.75, 'c', 1.0)) AS t(lng, lat, name, value)"

describe('row layers', () => {
  it('converts the table editor demo: points sized by population and their labels', async () => {
    const project = JSON.parse(
      readFileSync(resolve('public/noodles/table-editor-demo.json'), 'utf8')
    ) as NoodlesProject
    const { doc, layers } = await run(project)
    const labels = layers['/labels-layer']
    expect(labels.plan.kind).toBe('text')
    expect(labels.data?.rows).toBe(5)
    expect(doc.nodes.find(n => n.id === '/labels-layer')?.params).toMatchObject({
      text: 'city',
      size: 14,
      offsetX: 0,
      offsetY: -20,
      fontWeight: 600,
    })
    const textAttr =
      labels.plan.plan.layer?.bindings.find(b => b.channel === 'text')?.attribute ?? ''
    expect(labels.data?.strings.get(textAttr)).toContain('New York City')
    expect(layers['/cities-layer'].data?.rows).toBe(5)
  })

  it('draws lines, great circles, columns, grid cells, point clouds and icons from rows', async () => {
    const pairs =
      'SELECT * FROM (VALUES (-74.0, 40.7, -0.1, 51.5, 2.0), (2.3, 48.8, 139.7, 35.7, 1.0)) AS t(lng, lat, to_lng, to_lat, w)'
    const ends = { getSourcePosition: '[d.lng, d.lat]', getTargetPosition: '[d.to_lng, d.to_lat]' }
    const line = await run(layer('LineLayerOp', pairs, { ...ends, getWidth: 'd.w' }))
    expect(line.layers['/layer'].plan.kind).toBe('line')
    expect(line.layers['/layer'].data?.rows).toBe(2)
    const circle = await run(layer('GreatCircleLayerOp', pairs, ends))
    expect(circle.doc.nodes.find(n => n.id === '/layer')?.params).toMatchObject({
      greatCircle: true,
      height: 0,
    })
    const at = { getPosition: '[d.lng, d.lat]' }
    for (const [type, kind] of [
      ['ColumnLayerOp', 'column'],
      ['GridCellLayerOp', 'column'],
      ['PointCloudLayerOp', 'point-cloud'],
      ['ScreenGridLayerOp', 'screen-grid'],
      ['ContourLayerOp', 'contour'],
    ]) {
      const { layers } = await run(layer(type, POINTS, at))
      expect([type, layers['/layer'].plan.kind, layers['/layer'].data?.rows]).toEqual([
        type,
        kind,
        3,
      ])
    }
    const icons = await run(layer('IconLayerOp', POINTS, { ...at, getIcon: 'd.name' }))
    expect(icons.layers['/layer'].plan.kind).toBe('icon')
    expect(icons.doc.nodes.find(n => n.id === '/layer')?.params.icon).toBe('name')
  })

  it('draws a path per row from its coordinate list, and polygons from a ring or rings', async () => {
    const paths = await run(
      layer(
        'PathLayerOp',
        'SELECT 1 AS id, [[0.0, 0.0], [1.0, 1.0], [2.0, 0.0]] AS path UNION ALL SELECT 2, [[5.0, 5.0], [6.0, 6.0]]',
        {
          getPath: 'd.path',
        }
      )
    )
    expect(paths.layers['/layer'].plan.kind).toBe('path')
    expect(paths.layers['/layer'].data?.rows).toBe(5)
    expect(paths.layers['/layer'].data?.starts?.length).toBe(2)
    const ring = '[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]'
    const polygons = await run(
      layer(
        'PolygonLayerOp',
        `SELECT ${ring} AS polygon`,
        { getPolygon: 'd.polygon' },
        { extruded: true }
      )
    )
    expect(polygons.layers['/layer'].plan.kind).toBe('polygon')
    expect(polygons.layers['/layer'].data?.starts?.length).toBe(1)
    const holed = await run(
      layer(
        'SolidPolygonLayerOp',
        'SELECT [[[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 0.0]], [[1.0, 1.0], [2.0, 1.0], [2.0, 2.0], [1.0, 1.0]]] AS polygon',
        { getPolygon: 'd.polygon' }
      )
    )
    expect(holed.layers['/layer'].data?.rings?.length).toBe(2)
    expect(holed.doc.nodes.find(n => n.id === '/layer')?.params.stroked).toBe(false)
  })
})

describe('cell layers', () => {
  it('draws each row’s cell as a polygon, for every grid', async () => {
    const { lonLatToCell, u64ToHex } = await import('a5-js')
    const a5 = u64ToHex(lonLatToCell([-122.4, 37.8], 8))
    const cases: [string, string, string][] = [
      ['H3HexagonLayerOp', 'getHexagon', "'8828308281fffff'"],
      ['S2LayerOp', 'getS2Token', "'80858004'"],
      ['GeohashLayerOp', 'getGeohash', "'9q8yy'"],
      ['QuadkeyLayerOp', 'getQuadkey', "'0231'"],
      ['A5LayerOp', 'getPentagon', `'${a5}'`],
    ]
    for (const [type, field, id] of cases) {
      const { layers } = await run(
        layer(type, `SELECT ${id} AS cell, 3.0 AS value UNION ALL SELECT ${id}, 4.0`, {
          [field]: 'd.cell',
          getFillColor: '[d.value * 50, 0, 0]',
        })
      )
      const polygons = layers['/layer']
      expect([type, polygons.plan.kind, polygons.data?.starts?.length]).toEqual([
        type,
        'polygon',
        2,
      ])
      // Every cell is near San Francisco, but the quadkey's, which is a quarter of North America
      const position = polygons.data?.attributes.get(
        polygons.plan.plan.layer!.bindings[0].attribute
      )
      const [lng, lat] = [position!.data[0], position!.data[1]]
      if (type !== 'QuadkeyLayerOp') {
        // A corner within a degree of the point the cells were made for
        expect([type, Math.abs(lng + 122.4) < 1 && Math.abs(lat - 37.8) < 1]).toEqual([type, true])
      } else {
        expect(lng).toBeLessThan(-80)
      }
    }
  })

  it('outlines an H3 cluster: a list of cells per row, merged', async () => {
    const { layers } = await run(
      layer('H3ClusterLayerOp', "SELECT ['8828308281fffff', '8828308283fffff'] AS cells", {
        getHexagons: 'd.cells',
      })
    )
    expect(layers['/layer'].data?.starts?.length).toBe(1)
    // Two touching hexagons merged: one ring with more corners than either
    expect(layers['/layer'].data?.rows).toBeGreaterThan(6)
  })
})
