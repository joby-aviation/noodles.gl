// Two layers coloring with two ramps in one document: a Color Ramp node on turbo, and a
// scatter layer whose Color channel calls ramp() on inferno. Each samples its own ramp.
import { type EditorDoc, lowerDocument, parameterValues, RAMP_STOPS } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  // Inferno is one of the ramps the editor registers beside the planner's own
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 60_000)

const doc: EditorDoc = {
  version: 1,
  name: 'two-ramps',
  nodes: [
    {
      id: 'rows',
      op: 'sql',
      x: 0,
      y: 0,
      params: { query: 'SELECT CAST(i AS DOUBLE) AS i FROM range(5) t(i)' },
    },
    { id: 't', op: 'attribute', x: 0, y: 0, params: { name: 't', expression: 'i / 4.0' } },
    {
      id: 'color',
      op: 'color-ramp',
      x: 0,
      y: 0,
      params: { input: 't', ramp: 'turbo', name: 'c' },
    },
    { id: 'byNode', op: 'scatter', x: 0, y: 0, params: { position: '[i, 0.0]', color: 'c' } },
    {
      id: 'byChannel',
      op: 'scatter',
      x: 0,
      y: 0,
      params: { position: '[i, 1.0]', color: 'ramp(fit(i, 0, 4, 0, 1))', ramp: 'inferno' },
    },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'rows', sourcePort: 'out', target: 't', targetPort: 'in' },
    { id: 'e2', source: 't', sourcePort: 'out', target: 'color', targetPort: 'in' },
    { id: 'e3', source: 'color', sourcePort: 'out', target: 'byNode', targetPort: 'in' },
    { id: 'e4', source: 'rows', sourcePort: 'out', target: 'byChannel', targetPort: 'in' },
    { id: 'e5', source: 'byNode', sourcePort: 'out', target: 'map', targetPort: 'layers' },
    {
      id: 'e6',
      source: 'byChannel',
      sourcePort: 'out',
      target: 'map',
      targetPort: 'layers',
      index: 1,
    },
  ],
}

// A layer's color for its first and last rows, 0–1
function ends(runtime: ProgramRuntime, id: string) {
  const layer = runtime.layers().find(l => l.id === id)
  expect(layer?.error, id).toBeUndefined()
  const bound = layer?.plan.plan.layer?.bindings.find(b => b.channel === 'color')
  const color = bound && layer?.data?.attributes.get(bound.attribute)
  expect(color, id).toBeDefined()
  const { data, width } = color as { data: Float32Array; width: number }
  const last = (layer?.data?.rows ?? 1) - 1
  return [Array.from(data.slice(0, 3)), Array.from(data.slice(last * width, last * width + 3))]
}

it('colors each layer with its own ramp', async () => {
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])

  const close = (got: number[], want: number[]) => {
    for (const [c, v] of got.entries()) expect(v).toBeCloseTo(want[c], 2)
  }
  const [nodeFirst, nodeLast] = ends(runtime, 'byNode')
  close(nodeFirst, RAMP_STOPS.turbo[0])
  close(nodeLast, RAMP_STOPS.turbo.at(-1) as number[])
  const [channelFirst, channelLast] = ends(runtime, 'byChannel')
  close(channelFirst, RAMP_STOPS.inferno[0])
  close(channelLast, RAMP_STOPS.inferno.at(-1) as number[])
})
