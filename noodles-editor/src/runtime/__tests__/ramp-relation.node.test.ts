// A color ramp upstream of a SQL relation: `ramp(t)` samples a LUT on the GPU and the CPU,
// and inside a relation it is computed from the ramp's stops instead, so a Color Ramp can
// feed a Sort, a Time Series or any other node that runs in SQL.
import { type EditorDoc, lowerDocument, parameterValues, registerRamp } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

const doc: EditorDoc = {
  version: 1,
  name: 'ramp-relation',
  nodes: [
    // Five rows, each with a path
    {
      id: 'rows',
      op: 'sql',
      x: 0,
      y: 0,
      params: {
        query:
          'SELECT CAST(i AS DOUBLE) AS i, [[CAST(i AS DOUBLE), 0.0], [CAST(i AS DOUBLE), 1.0]] AS path FROM range(5) t(i)',
      },
    },
    { id: 't', op: 'attribute', x: 0, y: 0, params: { name: 't', expression: 'i / 4.0' } },
    {
      id: 'color',
      op: 'color-ramp',
      x: 0,
      y: 0,
      params: { input: 't', ramp: 'three-stops', name: 'c' },
    },
    // Sorting makes a relation, which runs in SQL
    { id: 'sorted', op: 'sort', x: 0, y: 0, params: { by: 'i', descending: true } },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[i, i]', color: 'c' } },
    // A path per row, colored per path, as world-flights' trails are
    { id: 'lines', op: 'path', x: 0, y: 0, params: { position: 'path', color: 'c' } },
    // A query that passes the color through, as a Time Series does
    { id: 'query', op: 'sql', x: 0, y: 0, params: { query: 'SELECT * FROM {{input0}}' } },
    { id: 'queried', op: 'scatter', x: 0, y: 0, params: { position: '[i, 1.0]', color: 'c' } },
    // Reads the ramp's color straight from the node the relation reads too
    { id: 'direct', op: 'scatter', x: 0, y: 0, params: { position: '[i, 0.0]', color: 'c' } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'rows', sourcePort: 'out', target: 't', targetPort: 'in' },
    { id: 'e2', source: 't', sourcePort: 'out', target: 'color', targetPort: 'in' },
    { id: 'e3', source: 'color', sourcePort: 'out', target: 'sorted', targetPort: 'in' },
    { id: 'e4', source: 'sorted', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e5', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
    { id: 'e6', source: 'color', sourcePort: 'out', target: 'direct', targetPort: 'in' },
    {
      id: 'e7',
      source: 'direct',
      sourcePort: 'out',
      target: 'map',
      targetPort: 'layers',
      index: 1,
    },
    { id: 'e8', source: 'color', sourcePort: 'out', target: 'query', targetPort: 'in0' },
    { id: 'e9', source: 'query', sourcePort: 'out', target: 'queried', targetPort: 'in' },
    {
      id: 'e10',
      source: 'queried',
      sourcePort: 'out',
      target: 'map',
      targetPort: 'layers',
      index: 2,
    },
    { id: 'e11', source: 'color', sourcePort: 'out', target: 'lines', targetPort: 'in' },
    {
      id: 'e12',
      source: 'lines',
      sourcePort: 'out',
      target: 'map',
      targetPort: 'layers',
      index: 3,
    },
  ],
}

it('computes a color ramp inside a relation from its stops, and keeps it a color', async () => {
  registerRamp('three-stops', [
    [0, 0, 0],
    [1, 0.5, 0],
    [0, 0, 1],
  ])
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  const rows = (await runtime.preview('sorted')).rows as Record<string, number>[]
  // Descending i: t is 1, 0.75, 0.5, 0.25, 0, each channel linear between the two stops around t
  expect(rows.map(r => [r.c_0, r.c_1, r.c_2])).toEqual([
    [0, 0, 1],
    [0.5, 0.25, 0.5],
    [1, 0.5, 0],
    [0.5, 0.25, 0],
    [0, 0, 0],
  ])
  // The path layer flattens its five paths into ten vertices
  for (const [id, drawn] of [
    ['dots', 5],
    ['direct', 5],
    ['queried', 5],
    ['lines', 10],
  ] as const) {
    const layer = runtime.layers().find(l => l.id === id)
    expect(layer?.error, id).toBeUndefined()
    expect(layer?.data?.rows, id).toBe(drawn)
    expect(
      layer?.plan.plan.layer?.bindings.map(b => b.channel),
      id
    ).toContain('color')
  }
})
