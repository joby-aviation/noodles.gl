// Shapes older projects wire their operators in, converted: whole-value expressions, switches
// over tables and values, features and numbers that code reads, and code both a layer and a
// host operator read. Run on DuckDB where they draw.
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { registerHostOperators } from '../host/host-ops'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import {
  CONVERTED_SCHEMA,
  type NoodlesEdge,
  type NoodlesNode,
  type NoodlesProject,
  toEditorDoc,
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
  for (const l of runtime.layers()) expect(l.error).toBeUndefined()
  return { doc, warnings, runtime, lowered }
}

const node = (doc: { nodes: { id: string }[] }, id: string) => doc.nodes.find(n => n.id === id)

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

  it('passes the table at its index through, as a parameter a number can drive', async () => {
    const second = await draw(tables({ index: 1 }))
    expect(node(second.doc, '/pick')).toMatchObject({ op: 'switch-rows', params: { index: 1 } })
    expect(second.runtime.layers()[0].data?.rows).toBe(2)
    // Clamped, as Switch clamped it
    expect((await draw(tables({ index: 9 }))).runtime.layers()[0].data?.rows).toBe(2)

    const driven = await draw(
      tables({}, [op('/n', 'NumberOp', { val: 0 })], [wire('/n', 'val', '/pick', 'index')])
    )
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
    const code = String(
      node(doc, '/at') && (node(doc, '/at') as { params: { code: string } }).params.code
    )
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
    expect((node(doc, '/at') as { params: { code: string } }).params.code).toBe(
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
