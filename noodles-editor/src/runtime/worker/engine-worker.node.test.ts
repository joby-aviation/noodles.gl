// The engine worker's protocol, end to end in one process: an Engine on the proxy, the host on
// a real DuckDB, a MessageChannel between them, so data really is cloned and transferred.

import { MessageChannel } from 'node:worker_threads'
import type { EditorDoc } from '@noodles.gl/planner'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { Engine } from '../engine'
import { EngineHost } from './engine-host'
import type { Envelope, Message } from './protocol'
import { RuntimeProxy } from './runtime-proxy'

let duck: NodeDuck
let channel: MessageChannel
let proxy: RuntimeProxy
beforeAll(async () => {
  duck = await openNodeDuck()
  channel = new MessageChannel()
  const host = new EngineHost(duck, {
    postMessage: (m: Message, transfer?: Transferable[]) =>
      channel.port1.postMessage(m, transfer as never),
  })
  channel.port1.on('message', (m: Envelope) => void host.handle(m))
  const port2 = channel.port2
  proxy = new RuntimeProxy({
    postMessage: (m: Envelope, transfer?: Transferable[]) =>
      port2.postMessage(m, transfer as never),
    addEventListener: (_type, listener) =>
      port2.on('message', (data: Message) => listener({ data } as MessageEvent<Message>)),
  })
}, 60_000)
afterAll(() => channel.port1.close())

const doc = (radiusScale: number): EditorDoc => ({
  version: 1,
  name: 'worker',
  nodes: [
    {
      id: 'src',
      op: 'sql',
      x: 0,
      y: 0,
      params: { query: 'SELECT i * 1.0 AS x, i * 2.0 AS y FROM range(1000) t(i)' },
    },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]', radiusScale } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
  ],
  edges: [
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
})

describe('the engine worker protocol', () => {
  it('draws a document whose runtime is in another thread', async () => {
    const engine = new Engine(proxy)
    await engine.setDoc(doc(2))
    await engine.settle()
    const layer = engine.runtime.layers()[0]
    expect(layer.data?.rows).toBe(1000)
    const position = layer.data?.attributes.get(layer.plan.plan.layer?.bindings[0].attribute ?? '')
    expect(position?.data).toBeInstanceOf(Float32Array)
    expect(engine.vis().deckProps.layers).toHaveLength(1)

    // A prop-only edit moves the prop and keeps the data: nothing to upload again
    const data = layer.data
    await engine.setDoc(doc(5))
    await engine.settle()
    const after = engine.runtime.layers()[0]
    expect(after.props.radiusScale).toBe(5)
    expect(after.data).toBe(data)
    expect(proxy.counters.compiles).toBe(1)
  })

  it('reads rows and previews through the worker', async () => {
    expect(await proxy.query('SELECT 41 + 1 AS answer')).toEqual([{ answer: 42 }])
    const preview = await proxy.preview('src', 3)
    expect(preview.total).toBe(1000)
    expect(preview.rows).toHaveLength(3)
  })

  it('reports a failed request as an error, not a hang', async () => {
    await expect(proxy.query('SELECT * FROM no_such_table')).rejects.toThrow(/no_such_table/)
  })

  it('runs a JS function DuckDB calls per row, with a vector result and a text argument', async () => {
    const engine = new Engine(proxy)
    await engine.setDoc({
      version: 1,
      name: 'udf',
      nodes: [
        {
          id: 'src',
          op: 'sql',
          x: 0,
          y: 0,
          params: { query: "SELECT i * 1.0 AS x, 'ab' || i AS label FROM range(4) t(i)" },
        },
        {
          id: 'f',
          op: 'js-function',
          x: 0,
          y: 0,
          params: {
            name: 'spiral',
            params: 'x, label: text',
            width: 2,
            body: 'return [Math.cos(x) * label.length, Math.sin(x) * label.length]',
          },
        },
        {
          id: 'p',
          op: 'attribute',
          x: 0,
          y: 0,
          params: { name: 'P', expression: 'spiral(x, label)' },
        },
        { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: 'P' } },
        { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
      ],
      edges: [
        { id: 'e1', source: 'src', sourcePort: 'out', target: 'p', targetPort: 'in' },
        { id: 'e2', source: 'p', sourcePort: 'out', target: 'dots', targetPort: 'in' },
        { id: 'e3', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
      ],
    })
    await engine.settle()
    expect(engine.lowering()?.errors).toEqual([])
    expect(engine.runtime.error()).toBeUndefined()
    expect(engine.runtime.program()?.errors).toEqual([])
    const layer = engine.runtime.layers()[0]
    expect(layer.error).toBeUndefined()
    const position = layer.data?.attributes.get('P')?.data
    // Row 1: x = 1, label 'ab1' (3 characters)
    expect([position?.[2], position?.[3]].map(v => Number(v?.toFixed(4)))).toEqual([
      Number((Math.cos(1) * 3).toFixed(4)),
      Number((Math.sin(1) * 3).toFixed(4)),
    ])
  })
})
