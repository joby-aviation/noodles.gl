// colmin() and colmax() in a layer channel: a ramp fitted to the column's extent over the
// layer's rows, as a Color control's Auto range writes it.
import { type EditorDoc, lowerDocument, parameterValues, RAMP_STOPS } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

// v runs 5, 15, ... 45, so a fixed 0–1 domain would put every row at the ramp's end
const doc: EditorDoc = {
  version: 1,
  name: 'column-extent',
  nodes: [
    {
      id: 'rows',
      op: 'sql',
      x: 0,
      y: 0,
      params: { query: 'SELECT CAST(i * 10 + 5 AS DOUBLE) AS v FROM range(5) t(i)' },
    },
    {
      id: 'dots',
      op: 'scatter',
      x: 0,
      y: 0,
      params: { position: '[v, 0.0]', color: 'ramp(fit(v, colmin(v), colmax(v), 0, 1))' },
    },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'rows', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
}

it('fits a ramp to the column’s extent over the layer’s rows', async () => {
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])

  const layer = runtime.layers().find(l => l.id === 'dots')
  expect(layer?.error).toBeUndefined()
  const bound = layer?.plan.plan.layer?.bindings.find(b => b.channel === 'color')
  const color = bound && layer?.data?.attributes.get(bound.attribute)
  expect(color).toBeDefined()
  const { data, width } = color as { data: Float32Array; width: number }
  const rows = layer?.data?.rows ?? 0
  expect(rows).toBe(5)
  // The smallest v is the ramp's start, the largest its end
  const viridis = RAMP_STOPS.viridis
  const at = (row: number) => Array.from(data.slice(row * width, row * width + 3))
  for (const [c, v] of at(0).entries()) expect(v).toBeCloseTo(viridis[0][c], 2)
  for (const [c, v] of at(rows - 1).entries())
    expect(v).toBeCloseTo(viridis[viridis.length - 1][c], 2)
})

// A column an upstream Attribute node computes, rather than one the source has
it('fits a ramp to a column an Attribute node computes', async () => {
  const computed: EditorDoc = {
    ...doc,
    nodes: [
      doc.nodes[0],
      { id: 'doubled', op: 'attribute', x: 0, y: 0, params: { name: 'w', expression: 'v * 2' } },
      {
        id: 'dots',
        op: 'scatter',
        x: 0,
        y: 0,
        params: { position: '[w, 0.0]', color: 'ramp(fit(w, colmin(w), colmax(w), 0, 1))' },
      },
      doc.nodes[2],
    ],
    edges: [
      { id: 'e1', source: 'rows', sourcePort: 'out', target: 'doubled', targetPort: 'in' },
      { id: 'e2', source: 'doubled', sourcePort: 'out', target: 'dots', targetPort: 'in' },
      { id: 'e3', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
    ],
  }
  const lowered = lowerDocument(computed)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  const layer = runtime.layers().find(l => l.id === 'dots')
  expect(layer?.error).toBeUndefined()
  const bound = layer?.plan.plan.layer?.bindings.find(b => b.channel === 'color')
  const color = bound && layer?.data?.attributes.get(bound.attribute)
  const { data, width } = color as { data: Float32Array; width: number }
  const viridis = RAMP_STOPS.viridis
  for (const [c, v] of Array.from(data.slice(0, 3)).entries())
    expect(v).toBeCloseTo(viridis[0][c], 2)
  const last = (layer?.data?.rows ?? 1) - 1
  for (const [c, v] of Array.from(data.slice(last * width, last * width + 3)).entries())
    expect(v).toBeCloseTo(viridis[viridis.length - 1][c], 2)
})
