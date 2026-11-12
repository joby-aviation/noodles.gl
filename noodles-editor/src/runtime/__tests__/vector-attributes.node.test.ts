// A vector attribute (a position, a color) is one value wherever it is read: whole (`c`), by
// index (`c[0]`) or swizzled (`c.r`), in an expression or a code node's `d`. Inside a relation
// it is stored as component columns (`c_0, c_1, c_2`), whether it was computed above the node
// reading it or arrived from an upstream relation.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 60_000)

const attr = (id: string, expression: string) => ({
  id,
  op: 'attribute',
  x: 0,
  y: 0,
  params: { name: id, expression },
})

// rows → upstream nodes → the reading chain → a code node, each drawn so the program compiles
function doc(upstream: EditorDoc['nodes'], chain: EditorDoc['nodes'], code: string): EditorDoc {
  const nodes = [
    {
      id: 'rows',
      op: 'sql',
      x: 0,
      y: 0,
      params: { query: 'SELECT CAST(i AS DOUBLE) AS x FROM range(3) t(i)' },
    },
    ...upstream,
    ...chain,
    { id: 'code', op: 'code', x: 0, y: 0, params: { code } },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, 0.0]' } },
    { id: 'more', op: 'scatter', x: 0, y: 0, params: { position: '[0.0, 0.0]' } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ]
  const line = ['rows', ...upstream.map(n => n.id), ...chain.map(n => n.id)]
  const edges = line.slice(1).map((id, i) => ({
    id: `l${i}`,
    source: line[i],
    sourcePort: 'out',
    target: id,
    targetPort: nodes.find(n => n.id === id)?.op === 'sql' ? 'in0' : 'in',
  }))
  const last = line.at(-1) as string
  return {
    version: 1,
    name: 'vectors',
    nodes,
    edges: [
      ...edges,
      { id: 'c1', source: last, sourcePort: 'out', target: 'code', targetPort: 'in' },
      { id: 'c2', source: last, sourcePort: 'out', target: 'dots', targetPort: 'in' },
      { id: 'c3', source: 'code', sourcePort: 'out', target: 'more', targetPort: 'in' },
      {
        id: 'c4',
        source: 'dots',
        sourcePort: 'out',
        target: 'map',
        targetPort: 'layers',
        index: 0,
      },
      {
        id: 'c5',
        source: 'more',
        sourcePort: 'out',
        target: 'map',
        targetPort: 'layers',
        index: 1,
      },
    ],
  }
}

async function rowsOf(d: EditorDoc, id: string) {
  const lowered = lowerDocument(d)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.program()?.errors).toEqual([])
  const ir = lowered.outputs[id]?.out ?? lowered.irNodes[id]?.at(-1)
  return (await runtime.preview(ir as string, 3)).rows as Record<string, unknown>[]
}

const code =
  'return d.map(r => ({ first: r.c[0], red: r.c.r, whole: r.c, keys: Object.keys(r).join() }))'

it('reads a vector from an upstream relation whole, by index and swizzled', async () => {
  const d = doc(
    [
      attr('c', '[x / 4.0, 0.5, 1.0]'),
      { id: 'cut', op: 'sql', x: 0, y: 0, params: { query: 'SELECT * FROM {{input0}}' } },
    ],
    [attr('twice', 'c[0] * 2'), attr('rg', 'c.r + c.g'), attr('copy', 'c')],
    code
  )
  const rows = await rowsOf(d, 'copy')
  expect(rows[1]).toMatchObject({ twice: 0.5, rg: 0.75, copy_0: 0.25, copy_1: 0.5, copy_2: 1 })
  const coded = await rowsOf(d, 'code')
  // A code node's `d` holds the vector as one array, which also reads as .r
  expect(coded[1]).toMatchObject({ first: 0.25, red: 0.25, whole: [0.25, 0.5, 1] })
  expect(String(coded[1].keys).split(',')).not.toContain('c_0')
})

it('reads a color a ramp computes above it in the same relation', async () => {
  const d = doc(
    [
      {
        id: 'color',
        op: 'color-ramp',
        x: 0,
        y: 0,
        params: { input: 'x / 2.0', ramp: 'viridis', name: 'c' },
      },
    ],
    [attr('rg', 'c.r + c[1]')],
    code
  )
  const rows = await rowsOf(d, 'rg')
  expect(rows[0].rg).toBeCloseTo(Number(rows[0].c_0) + Number(rows[0].c_1))
  const coded = await rowsOf(d, 'code')
  expect(coded[0].red).toBe(rows[0].c_0)
  expect(coded[0].whole).toEqual([rows[0].c_0, rows[0].c_1, rows[0].c_2])
})

it('keeps a vector a code node passes on readable by component in the next code node', async () => {
  const d = doc(
    [
      attr('c', '[x / 4.0, 0.5, 1.0]'),
      { id: 'first', op: 'code', x: 0, y: 0, params: { code: 'return d' } },
    ],
    [],
    code
  )
  const coded = await rowsOf(d, 'code')
  expect(coded[1]).toMatchObject({ first: 0.25, red: 0.25, whole: [0.25, 0.5, 1] })
})

it('leaves numbered columns no vector made as they are, for code to read by name', async () => {
  const d = doc(
    [
      {
        id: 'cut',
        op: 'sql',
        x: 0,
        y: 0,
        params: { query: 'SELECT x, x AS value_0, x * 2 AS value_1 FROM {{input0}}' },
      },
    ],
    [],
    'return d.map(r => ({ sum: r.value_0 + r.value_1, keys: Object.keys(r).join() }))'
  )
  const coded = await rowsOf(d, 'code')
  expect(coded[1]).toMatchObject({ sum: 3, keys: 'x,value_0,value_1' })
})
