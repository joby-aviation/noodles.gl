// A Column Layer added over plain rows draws: its Elevation starts empty, every column the
// Elevation scale tall, rather than reading an `n` column only a count makes.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { DeckLayerBuilder } from '../deck-layers'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

const doc = (params: EditorDoc['nodes'][0]['params']): EditorDoc => ({
  version: 1,
  name: 'columns',
  nodes: [
    {
      id: 'rows',
      op: 'sql',
      x: 0,
      y: 0,
      params: { query: 'SELECT CAST(i AS DOUBLE) AS i FROM range(3) t(i)' },
    },
    { id: 'bars', op: 'column', x: 0, y: 0, params: { position: '[i, 0.0]', ...params } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'a', source: 'rows', sourcePort: 'out', target: 'bars', targetPort: 'in' },
    { id: 'b', source: 'bars', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
})

async function run(d: EditorDoc) {
  const lowered = lowerDocument(d)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.program()?.errors).toEqual([])
  const built = new DeckLayerBuilder().build(
    runtime.layers().map(l => ({
      id: l.id,
      kind: l.plan.kind,
      data: l.data,
      bindings: l.plan.plan.layer?.bindings ?? [],
      props: l.props,
    }))
  )
  return built.get('bars')?.[0]?.props as unknown as {
    getElevation: unknown
    data: { length: number; attributes: Record<string, { value: ArrayLike<number> }> }
  }
}

it('draws a new column layer over rows without a count', async () => {
  const bars = await run(doc({}))
  expect(bars.data.length).toBe(3)
  expect(bars.getElevation).toBe(1)
})

it('still raises each column by a per-row elevation', async () => {
  const bars = await run(doc({ elevation: 'i + 1' }))
  expect(Array.from(bars.data.attributes.getElevation.value)).toEqual([1, 2, 3])
})
