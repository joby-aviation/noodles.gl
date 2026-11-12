// Shapes older projects wire their operators in, converted: whole-value expressions, switches
// over tables and values, features and numbers that code reads, and code both a layer and a
// host operator read. Run on DuckDB where they draw.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { registerHostOperators } from '../host/host-ops'
import { jsRows } from '../plain-rows'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import {
  CONVERTED_SCHEMA,
  type NoodlesEdge,
  type NoodlesNode,
  type NoodlesProject,
  toEditorDoc,
  translateAccessor,
} from './to-editor-doc'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  registerHostOperators()
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
const project = (nodes: NoodlesNode[], edges: NoodlesEdge[]): NoodlesProject => ({
  version: CONVERTED_SCHEMA,
  nodes: [...nodes, op('/deck', 'DeckRendererOp'), op('/out', 'OutOp')],
  edges: [...edges, wire('/deck', 'vis', '/out', 'vis')],
})
// A scatter layer of `from`'s rows at [lng, lat], drawn by the deck
const dots = (from: string, out = 'data') => ({
  nodes: [
    op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
    op('/dots', 'ScatterplotLayerOp'),
  ],
  edges: [
    wire(from, out, '/dots', 'data'),
    wire('/where', 'accessor', '/dots', 'getPosition'),
    wire('/dots', 'layer', '/deck', 'layers'),
  ],
})

async function draw(p: NoodlesProject) {
  const { doc, warnings } = toEditorDoc(p)
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  for (const l of runtime.layers()) expect(l.error).toBeUndefined()
  return { doc, warnings, runtime, lowered }
}

const node = (doc: EditorDoc, id: string) => doc.nodes.find(n => n.id === id)

describe('switches', () => {
  const tables = (
    index: Record<string, unknown>,
    extra: NoodlesNode[] = [],
    edges: NoodlesEdge[] = []
  ) => {
    const d = dots('/pick', 'value')
    return project(
      [
        op('/a', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 1.0 AS lat' }),
        op('/b', 'DuckDbOp', { query: 'SELECT 2.0 AS lng, 2.0 AS lat UNION ALL SELECT 3.0, 3.0' }),
        op('/pick', 'SwitchOp', index),
        ...extra,
        ...d.nodes,
      ],
      [
        wire('/a', 'data', '/pick', 'values'),
        wire('/b', 'data', '/pick', 'values'),
        ...edges,
        ...d.edges,
      ]
    )
  }

  it('passes the table at its index through, as a parameter when a number drives it', async () => {
    const second = await draw(tables({ index: 1 }))
    expect(node(second.doc, '/pick')).toMatchObject({ op: 'switch', params: { index: 1 } })
    expect(second.runtime.layers()[0].data?.rows).toBe(2)
    // Clamped, as Switch clamped it
    expect((await draw(tables({ index: 9 }))).runtime.layers()[0].data?.rows).toBe(2)

    const driven = await draw(
      tables({}, [op('/n', 'NumberOp', { val: 0 })], [wire('/n', 'val', '/pick', 'index')])
    )
    expect(node(driven.doc, '/pick')).toMatchObject({ op: 'switch-rows' })
    expect(driven.doc.edges).toContainEqual(
      expect.objectContaining({ source: '/n', target: '/pick', targetPort: 'par:index' })
    )
    expect(driven.runtime.layers()[0].data?.rows).toBe(1)
    // A new index rebinds: no new graph, the same layer, the other table's rows
    const doc = structuredClone(driven.doc)
    ;(node(doc, '/n') as { params: Record<string, unknown> }).params.value = 1
    const again = lowerDocument(doc)
    await driven.runtime.setValues(parameterValues(again, { T: 0, F: 0 }).values)
    expect(driven.runtime.layers()[0].data?.rows).toBe(2)
  })

  it('chooses between view states on the host, blending a fractional index', () => {
    const { doc } = toEditorDoc(
      project(
        [
          op('/near', 'MapViewStateOp', { zoom: 10 }),
          op('/far', 'MapViewStateOp', { zoom: 2 }),
          op('/camera', 'SwitchOp', { index: 0.5, blend: true }),
          op('/map', 'MaplibreBasemapOp'),
        ],
        [
          wire('/near', 'viewState', '/camera', 'values'),
          wire('/far', 'viewState', '/camera', 'values'),
          wire('/camera', 'value', '/map', 'viewState'),
          wire('/map', 'basemap', '/deck', 'basemap'),
        ]
      )
    )
    expect(node(doc, '/camera')).toMatchObject({ op: 'switch-value', params: { blend: true } })
    const into = doc.edges
      .filter(e => e.target === '/camera')
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    expect(into.map(e => [e.source, e.targetPort])).toEqual([
      ['/near', 'par:values'],
      ['/far', 'par:values'],
    ])
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/camera', target: '/deck' })
    )
  })
})

describe('whole-value expressions', () => {
  it('runs an expression of its input as code, and a bare `d` as the wire it is', () => {
    const d = dots('/same')
    const { doc } = toEditorDoc(
      project(
        [
          op('/rows', 'DuckDbOp', { query: 'SELECT 1.0 AS longitude, 2.0 AS latitude' }),
          op('/renamed', 'ExpressionOp', {
            expression: 'd.map(r => ({ ...r, lng: r.longitude, lat: r.latitude }))',
          }),
          op('/same', 'ExpressionOp', { expression: 'd' }),
          ...d.nodes,
        ],
        [
          wire('/rows', 'data', '/renamed', 'data'),
          wire('/renamed', 'data', '/same', 'data'),
          ...d.edges,
        ]
      )
    )
    expect(node(doc, '/renamed')).toMatchObject({
      op: 'code',
      params: { code: 'return (d.map(r => ({ ...r, lng: r.longitude, lat: r.latitude })))' },
    })
    expect(node(doc, '/same')).toBeUndefined()
    expect(doc.edges.some(e => e.source === '/renamed' && e.target.startsWith('/'))).toBe(true)
  })

  it('draws a path per row of bare coordinate lists, as `d` read them', async () => {
    const { runtime } = await draw(
      project(
        [
          op('/paths', 'DuckDbOp', {
            query:
              'SELECT [[0.0, 0.0], [1.0, 1.0]] AS value UNION ALL SELECT [[2.0, 2.0], [3.0, 2.0], [4.0, 3.0]]',
          }),
          op('/each', 'AccessorOp', { expression: 'd' }),
          op('/lines', 'PathLayerOp'),
        ],
        [
          wire('/paths', 'data', '/lines', 'data'),
          wire('/each', 'accessor', '/lines', 'getPath'),
          wire('/lines', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(runtime.layers()[0].data?.starts?.length).toBe(2)
    expect(runtime.layers()[0].data?.rows).toBe(5)
  })
})

describe('what code reads', () => {
  it('hands code the one feature a Point made, from the point node', () => {
    const d = dots('/at')
    const { doc } = toEditorDoc(
      project(
        [
          op('/origin', 'PointOp', { coordinates: { lng: 3, lat: 4 } }),
          op('/at', 'CodeOp', {
            code: 'const [lng, lat] = d.geometry.coordinates\nreturn [{ lng, lat }]',
          }),
          ...d.nodes,
        ],
        [wire('/origin', 'feature', '/at', 'data'), ...d.edges]
      )
    )
    expect(node(doc, '/origin')).toMatchObject({ op: 'point', params: { lng: 3, lat: 4 } })
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/origin', target: '/at', targetPort: 'par:data' })
    )
    // The host hands over a FeatureCollection; the code reads its one feature as before
    const code = String(node(doc, '/at')?.params.code)
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [3, 4] },
      properties: {},
    }
    const data = [{ type: 'FeatureCollection', features: [feature] }]
    expect(new Function('data', 'd', code)(data, data[0])).toEqual([{ lng: 3, lat: 4 }])
  })

  it('keeps a Number code reads by op(), its val now the number node’s value', () => {
    const d = dots('/at')
    const { doc, warnings } = toEditorDoc(
      project(
        [
          op('/lng', 'NumberOp', { val: 5 }),
          op('/at', 'CodeOp', {
            code: "return [{ lng: op('/lng').par.val, lat: op('/lng').out.val }]",
          }),
          ...d.nodes,
        ],
        d.edges
      )
    )
    expect(node(doc, '/lng')).toMatchObject({ op: 'number', params: { value: 5 } })
    expect(node(doc, '/at')?.params.code).toBe(
      "return [{ lng: op('/lng').par.value, lat: op('/lng').out.val }]"
    )
    expect(warnings.join('\n')).not.toMatch(/dropped NumberOp/)
  })

  it('makes code a layer and a host operator both read one node', () => {
    const d = dots('/rows')
    const { doc } = toEditorDoc(
      project(
        [
          op('/rows', 'CodeOp', { code: 'return [{ lng: 1, lat: 2 }]' }),
          // op() keeps this one on the host
          op('/moved', 'CodeOp', {
            code: "return d.map(r => ({ ...r, lng: r.lng + op('/rows').out.data.length }))",
          }),
          op('/more', 'ScatterplotLayerOp'),
          ...d.nodes,
        ],
        [
          wire('/rows', 'data', '/moved', 'data'),
          wire('/moved', 'data', '/more', 'data'),
          wire('/where', 'accessor', '/more', 'getPosition'),
          wire('/more', 'layer', '/deck', 'layers'),
          ...d.edges,
        ]
      )
    )
    // One node, whichever reader converted it first; a host may read any value, so a host
    // reader keeps it on the host
    expect(doc.nodes.filter(n => n.id === '/rows')).toHaveLength(1)
    expect(node(doc, '/moved')).toMatchObject({ op: 'CodeOp' })
    const readers = doc.edges.filter(e => e.source === '/rows').map(e => e.target)
    expect(readers).toHaveLength(2)
    expect(readers).toContain('/moved')
    expect(lowerDocument(doc, { hostTable: () => 'SELECT 1.0 AS lng, 2.0 AS lat' }).errors).toEqual(
      []
    )
  })

  it('names an attribute for a numbered accessor by its whole name', () => {
    const { doc } = toEditorDoc(
      project(
        [
          op('/rows', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat, 3.0 AS r' }),
          op('/accessor-1', 'AccessorOp', { expression: 'd.r * 2' }),
          ...dots('/rows').nodes,
        ],
        [...dots('/rows').edges, wire('/accessor-1', 'accessor', '/dots', 'getRadius')]
      )
    )
    const names = doc.nodes.filter(n => n.op === 'attribute').map(n => n.params.name)
    expect(names).toContain('accessor_1')
    expect(lowerDocument(doc).errors).toEqual([])
  })
})

describe('rows that are lists of rows', () => {
  const VERTICES =
    'SELECT * FROM (VALUES (0.0, 0.0, 10.0, 1.0), (1.0, 1.0, 20.0, 2.0), (2.0, 0.0, 30.0, 3.0), (3.0, 1.0, 40.0, 4.0)) AS t(lng, lat, alt, time)'

  it('draws one path from all the rows, wrapped as one row and mapped', async () => {
    const { runtime } = await draw(
      project(
        [
          op('/points', 'DuckDbOp', { query: VERTICES }),
          op('/one', 'ExpressionOp', { expression: '[d]' }),
          op('/along', 'AccessorOp', { expression: 'd.map(row => [row.lng, row.lat, row.alt])' }),
          op('/line', 'PathLayerOp'),
        ],
        [
          wire('/points', 'data', '/one', 'data'),
          wire('/one', 'data', '/line', 'data'),
          wire('/along', 'accessor', '/line', 'getPath'),
          wire('/line', 'layer', '/deck', 'layers'),
        ]
      )
    )
    const line = runtime.layers()[0]
    expect(line.data?.starts?.length).toBe(1)
    expect(line.data?.rows).toBe(4)
  })

  it('draws a trip per list of rows, its path and times mapped from each', async () => {
    const { doc, runtime } = await draw(
      project(
        [
          op('/points', 'DuckDbOp', { query: VERTICES }),
          op('/legs', 'CodeOp', {
            code: 'return [d.filter(r => r.time <= 2), d.filter(r => r.time > 2)]',
          }),
          op('/path', 'AccessorOp', { expression: 'd?.map(r => [r.lng, r.lat, r.alt])' }),
          op('/times', 'AccessorOp', { expression: 'd?.map(r => r.time)' }),
          op('/trips', 'TripsLayerOp'),
        ],
        [
          wire('/points', 'data', '/legs', 'data'),
          wire('/legs', 'data', '/trips', 'data'),
          wire('/path', 'accessor', '/trips', 'getPath'),
          wire('/times', 'accessor', '/trips', 'getTimestamps'),
          wire('/trips', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(node(doc, '/trips')).toMatchObject({ params: { position: 'path', timestamp: 'times' } })
    expect(runtime.layers()[0].data?.starts?.length).toBe(2)
  })
})

describe('rows that are values', () => {
  it('places a mark at each row that is a position', async () => {
    const { runtime } = await draw(
      project(
        [
          op('/spots', 'DuckDbOp', {
            query: 'SELECT [1.0, 2.0] AS value UNION ALL SELECT [3.0, 4.0]',
          }),
          op('/at', 'AccessorOp', { expression: 'd' }),
          op('/marks', 'ScatterplotLayerOp'),
        ],
        [
          wire('/spots', 'data', '/marks', 'data'),
          wire('/at', 'accessor', '/marks', 'getPosition'),
          wire('/marks', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(runtime.layers()[0].data?.rows).toBe(2)
  })

  it('wraps each input whole when a Concat flattens nothing, and hands JS its values back bare', () => {
    const { doc } = toEditorDoc(
      project(
        [
          op('/a', 'CodeOp', { code: 'return [[0, 0], [1, 1]]' }),
          op('/each', 'ConcatOp', { depth: 0 }),
          op('/along', 'AccessorOp', { expression: 'd' }),
          op('/line', 'PathLayerOp'),
        ],
        [
          wire('/a', 'data', '/each', 'values'),
          wire('/each', 'data', '/line', 'data'),
          wire('/along', 'accessor', '/line', 'getPath'),
          wire('/line', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(node(doc, '/each')).toMatchObject({ params: { code: 'return data.flat(0)' } })
    expect(jsRows([{ value: [0, 0] }, { value: [1, 1] }])).toEqual([
      [0, 0],
      [1, 1],
    ])
    expect(jsRows([{ value: 1, other: 2 }])).toEqual([{ value: 1, other: 2 }])
  })
})

describe('numbers that drive parameters', () => {
  it('scales a Number into a range for a Slice end, as an expression it requeries by', async () => {
    const d = dots('/first')
    const { doc, runtime } = await draw(
      project(
        [
          op('/rows', 'DuckDbOp', {
            query: 'SELECT i * 1.0 AS lng, i * 1.0 AS lat FROM range(4) t(i)',
          }),
          op('/progress', 'NumberOp', { val: 0.5 }),
          op('/scale', 'MapRangeOp', { inMin: 0, inMax: 1, outMin: 0, outMax: 4 }),
          op('/first', 'SliceOp', { start: 0 }),
          ...d.nodes,
        ],
        [
          wire('/rows', 'data', '/first', 'data'),
          wire('/progress', 'val', '/scale', 'val'),
          wire('/scale', 'scaled', '/first', 'end'),
          ...d.edges,
        ]
      )
    )
    expect(node(doc, '/scale')).toMatchObject({
      op: 'expression',
      params: { expression: '0.0 + (a - 0.0) * 4.0' },
    })
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/progress', target: '/scale', targetPort: 'par:a' })
    )
    expect(runtime.layers()[0].data?.rows).toBe(2)
  })
})

describe('more inputs that were values', () => {
  it('parses text code wrote as a File, and text written into one', () => {
    const d = dots('/parsed')
    const { doc } = toEditorDoc(
      project(
        [
          op('/write', 'CodeOp', { code: 'return `lng\tlat\n1\t2`' }),
          op('/parsed', 'FileOp', { format: 'tsv' }),
          op('/inline', 'FileOp', { format: 'csv', text: 'lng,lat\n3,4' }),
          op('/more', 'ScatterplotLayerOp'),
          ...d.nodes,
        ],
        [
          { ...wire('/write', 'data', '/parsed', 'text') },
          wire('/inline', 'data', '/more', 'data'),
          wire('/where', 'accessor', '/more', 'getPosition'),
          wire('/more', 'layer', '/deck', 'layers'),
          ...d.edges,
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/parsed')?.params.code).toBe(
      'return d3.tsvParse(d, d3.autoType)'
    )
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/write', target: '/parsed', targetPort: 'par:data' })
    )
    expect(doc.nodes.find(n => n.id === '/inline')?.params.code).toBe(
      'return d3.csvParse("lng,lat\\n3,4", d3.autoType)'
    )
  })

  it('places an Arc between two Points, and reads a basemap style file by its URL', () => {
    const { doc } = toEditorDoc(
      project(
        [
          op('/from', 'PointOp', { coordinates: { lng: 1, lat: 2 } }),
          op('/to', 'PointOp', { coordinates: [3, 4] }),
          op('/arc', 'ArcOp', { apexAlt: 100 }),
          op('/style', 'FileOp', { url: 'https://example.com/style.json', format: 'json' }),
          op('/map', 'MaplibreBasemapOp'),
          ...dots('/arc').nodes,
        ],
        [
          wire('/from', 'feature', '/arc', 'source'),
          wire('/to', 'feature', '/arc', 'target'),
          wire('/style', 'data', '/map', 'mapStyle'),
          wire('/map', 'basemap', '/deck', 'basemap'),
          ...dots('/arc').edges,
        ]
      )
    )
    const code = String(doc.nodes.find(n => n.id === '/arc')?.params.code)
    expect(code).toContain('"source":{"alt":0,"lng":1,"lat":2}')
    expect(code).toContain('"target":{"alt":0,"lng":3,"lat":4}')
    expect(doc.nodes.find(n => n.op === 'deck')?.params.mapStyle).toBe(
      'https://example.com/style.json'
    )
  })

  it('drives a parameter from code that reads op(), and from a Number passing one on', () => {
    const { doc } = toEditorDoc(
      project(
        [
          op('/rows', 'DuckDbOp', {
            query: 'SELECT [[0.0, 0.0], [1.0, 1.0]] AS path, [0.0, 1.0] AS timestamps',
          }),
          op('/clock', 'NumberOp', { val: 3 }),
          op('/later', 'CodeOp', { code: "return op('/clock').par.val * 2" }),
          op('/round', 'MathOp', { operator: 'round' }),
          op('/pass', 'NumberOp'),
          op('/trips', 'TripsLayerOp'),
        ],
        [
          wire('/rows', 'data', '/trips', 'data'),
          wire('/later', 'data', '/round', 'a'),
          wire('/round', 'result', '/pass', 'val'),
          wire('/pass', 'val', '/trips', 'currentTime'),
          wire('/trips', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(node(doc, '/round')).toMatchObject({
      op: 'expression',
      params: { expression: 'round(a)' },
    })
    expect(node(doc, '/pass')).toMatchObject({ op: 'expression', params: { expression: 'a' } })
    expect(doc.edges).toContainEqual(
      expect.objectContaining({
        source: '/later',
        sourcePort: 'data',
        target: '/round',
        targetPort: 'par:a',
      })
    )
    expect(lowerDocument(doc).errors).toEqual([])
  })

  it('reads optional chaining and a nullish default inside a position', () => {
    expect(translateAccessor('[d?.lng ?? 0, d?.lat ?? 0]')).toBe(
      '[coalesce(lng, 0.0), coalesce(lat, 0.0)]'
    )
  })

  it('skips a node saved with no id or type', () => {
    const p = project(dots('/rows').nodes, dots('/rows').edges)
    p.nodes.push(op('/rows', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat' }))
    p.nodes.push({ data: {} } as never)
    const { warnings } = toEditorDoc(p)
    expect(warnings).toContain('dropped 1 node saved with no id or type')
  })
})

describe('properties some files lack', () => {
  it('reads a cell id from whichever of several columns the rows have', async () => {
    const { doc, runtime } = await draw(
      project(
        [
          op('/cells', 'DuckDbOp', { query: "SELECT '8828308281fffff' AS hex, 3.0 AS count" }),
          op('/id', 'AccessorOp', { expression: 'd.h3 || d.hex || d.h3index' }),
          op('/height', 'AccessorOp', { expression: '+d.value || +d.count || 1' }),
          op('/hexes', 'H3HexagonLayerOp', { extruded: true }),
        ],
        [
          wire('/cells', 'data', '/hexes', 'data'),
          wire('/id', 'accessor', '/hexes', 'getHexagon'),
          wire('/height', 'accessor', '/hexes', 'getElevation'),
          wire('/hexes', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(doc.nodes.some(n => n.params.expression === 'present(h3, hex, h3index)')).toBe(true)
    expect(runtime.layers()[0].data?.starts?.length).toBe(1)
  })

  it('labels each row at its own angle, offset and anchor, a missing one falling back', async () => {
    const { doc, runtime } = await draw(
      project(
        [
          op('/places', 'DuckDbOp', {
            query:
              "SELECT 'a' AS name, 1.0 AS lng, 2.0 AS lat, [10.0, -5.0] AS pixelOffset, 'start' AS anchor",
          }),
          op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
          op('/what', 'AccessorOp', { expression: 'd.name' }),
          op('/turn', 'AccessorOp', { expression: 'd.angle || 0' }),
          op('/shift', 'AccessorOp', { expression: 'd.pixelOffset' }),
          op('/align', 'AccessorOp', { expression: 'd.anchor || "middle"' }),
          op('/labels', 'TextLayerOp'),
        ],
        [
          wire('/places', 'data', '/labels', 'data'),
          wire('/where', 'accessor', '/labels', 'getPosition'),
          wire('/what', 'accessor', '/labels', 'getText'),
          wire('/turn', 'accessor', '/labels', 'getAngle'),
          wire('/shift', 'accessor', '/labels', 'getPixelOffset'),
          wire('/align', 'accessor', '/labels', 'getTextAnchor'),
          wire('/labels', 'layer', '/deck', 'layers'),
        ]
      )
    )
    const labels = node(doc, '/labels') as { params: Record<string, unknown> }
    expect(labels.params.offsetBy).toBe('[item(pixelOffset, 0.0), item(pixelOffset, 1.0)]')
    expect(labels.params.angleBy).toBeTruthy()
    expect(labels.params.anchorBy).toBeTruthy()
    const layer = runtime.layers()[0]
    expect(layer.data?.rows).toBe(1)
    const bound = (channel: string) =>
      layer.plan.plan.layer?.bindings.find(b => b.channel === channel)?.attribute as string
    expect(layer.data?.strings.get(bound('anchor'))).toEqual(['start'])
    expect(Array.from(layer.data?.attributes.get(bound('offset'))?.data ?? [])).toEqual([10, -5])
    expect(Array.from(layer.data?.attributes.get(bound('angle'))?.data ?? [])).toEqual([0])
  })

  it('drops a layer with no data, which drew nothing', () => {
    const { doc, warnings } = toEditorDoc(
      project(
        [op('/model', 'ScenegraphLayerOp', { scenegraph: '@/model.glb' })],
        [wire('/model', 'layer', '/deck', 'layers')]
      )
    )
    expect(node(doc, '/model')).toBeUndefined()
    expect(warnings).toContain('/model: dropped; it has no data, so it drew nothing')
  })
})
