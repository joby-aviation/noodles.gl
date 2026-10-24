// The brushable histogram on the planner: its bins in SQL, and a brush that filters the rows a
// layer draws without recompiling anything.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

// Magnitudes 0 to 9.9, ten of each whole number
const QUERY = 'SELECT i / 10.0 AS mag, i AS id, [0.0, 0.0] AS position FROM range(100) t(i)'

const doc = (params: Record<string, unknown>): EditorDoc => ({
  version: 1,
  name: 'histogram',
  nodes: [
    { id: 'src', op: 'sql', x: 0, y: 0, params: { query: QUERY } },
    {
      id: 'hist',
      op: 'brushable-histogram',
      x: 0,
      y: 0,
      params: { column: 'mag', binCount: 10, ...params } as EditorDoc['nodes'][0]['params'],
    },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: 'position' } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'hist', targetPort: 'in' },
    { id: 'e2', source: 'hist', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e3', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
})

async function open(params: Record<string, unknown>) {
  const lowered = lowerDocument(doc(params))
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  return { runtime, lowered }
}

const drawn = (runtime: ProgramRuntime) => runtime.layers()[0]?.data?.rows

describe('brushable histogram', () => {
  it('bins the column over its extent, every bin present', async () => {
    const { runtime, lowered } = await open({ brushMin: 0, brushMax: 10 })
    const bins = await runtime.preview(lowered.outputs.hist.bins)
    expect(bins.note).toBeUndefined()
    expect(bins.rows.map(r => r.count)).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 10])
    expect(bins.rows[0]).toMatchObject({ bin: 0, x0: 0 })
    expect(bins.rows[9].x1).toBeCloseTo(9.9)
  })

  it('keeps the rows in the brush, and moves it without recompiling', async () => {
    const { runtime, lowered } = await open({ brushMin: 2, brushMax: 3.95 })
    expect(drawn(runtime)).toBe(20)
    const compiles = runtime.counters.compiles
    const values = parameterValues(lowerDocument(doc({ brushMin: 5, brushMax: 9.9 })), {
      T: 0,
      F: 0,
    }).values
    await runtime.setValues(values)
    await runtime.idle()
    expect(drawn(runtime)).toBe(50)
    expect(runtime.counters.compiles).toBe(compiles)
    expect(lowered.graph.nodes.find(n => n.id === 'hist')).toMatchObject({ type: 'filter' })
  })

  it('needs a column', () => {
    const lowered = lowerDocument(doc({ column: '' }))
    expect(lowered.errors[0]?.message).toMatch(/needs a column/)
  })
})

describe('the rows a pane counts', () => {
  it('lowers only the filters and the column, past a color ramp with no SQL form', async () => {
    const d = doc({ brushMin: 2, brushMax: 3.95 })
    // A color ramp between the rows and the histogram, as california-earthquakes has
    d.nodes.push({
      id: 'tint',
      op: 'color-ramp',
      x: 0,
      y: 0,
      params: { input: 'mag / 10.0', name: 'tint' },
    })
    d.edges = d.edges.filter(e => e.id !== 'e1')
    d.edges.push(
      { id: 'e4', source: 'src', sourcePort: 'out', target: 'tint', targetPort: 'in' },
      { id: 'e5', source: 'tint', sourcePort: 'out', target: 'hist', targetPort: 'in' }
    )
    const lowered = lowerDocument(d)
    expect(lowered.errors).toEqual([])
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    const brushed = await runtime.nodeSql(lowered.outputs.hist.out, ['mag'])
    expect(brushed).toBeDefined()
    const [row] = await runtime.query(`SELECT count(*) AS n FROM (${brushed?.sql})`)
    expect(Number(row.n)).toBe(20)
    // The layer, which reads the ramp, still draws
    expect(runtime.layers()[0]?.error).toBeUndefined()
  })
})
