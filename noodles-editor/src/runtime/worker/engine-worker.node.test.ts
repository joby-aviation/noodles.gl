// The engine worker's protocol, end to end in one process: an Engine on the proxy, the host on
// a real DuckDB, a MessageChannel between them, so data really is cloned and transferred.

import { MessageChannel } from 'node:worker_threads'
import type { EditorDoc } from '@noodles.gl/planner'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { Engine } from '../engine'
import { EngineHost } from './engine-host'
import type { Envelope, Message } from './protocol'
import { RuntimeProxy, type WorkerPort as RuntimeProxyPort } from './runtime-proxy'

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
    addEventListener: ((type: string, listener: (event: MessageEvent<Message>) => void) => {
      if (type === 'message')
        port2.on('message', (data: Message) => listener({ data } as MessageEvent<Message>))
    }) as RuntimeProxyPort['addEventListener'],
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

describe('dragging a value the CPU pass reads', () => {
  // A column drawn as it is shares its buffer with the query result the CPU pass reads again.
  // Transferring that buffer would empty the worker's copy and fail the next post.
  const ramped = (inMax: number): EditorDoc => ({
    version: 1,
    name: 'ramped',
    nodes: [
      {
        id: 'src',
        op: 'sql',
        x: 0,
        y: 0,
        params: { query: 'SELECT i * 1.0 AS x, i * 2.0 AS y, i * 1.0 AS v FROM range(100) t(i)' },
      },
      {
        id: 'range',
        op: 'map-range',
        x: 0,
        y: 0,
        params: { input: 'v', name: 't', inMin: 0, inMax, outMin: 0, outMax: 1 },
      },
      {
        id: 'ramp',
        op: 'color-ramp',
        x: 0,
        y: 0,
        params: { input: 't', ramp: 'viridis', name: 'c' },
      },
      { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]', color: 'c' } },
      { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
    ],
    edges: [
      { id: 'e1', source: 'src', sourcePort: 'out', target: 'range', targetPort: 'in' },
      { id: 'e2', source: 'range', sourcePort: 'out', target: 'ramp', targetPort: 'in' },
      { id: 'e3', source: 'ramp', sourcePort: 'out', target: 'dots', targetPort: 'in' },
      { id: 'e4', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
    ],
  })

  it('keeps drawing the positions after every step', async () => {
    const engine = new Engine(proxy)
    await engine.setDoc(ramped(100))
    await engine.settle()
    for (const inMax of [80, 60, 40, 60, 100]) {
      await engine.setDoc(ramped(inMax))
      await engine.settle()
      expect(engine.runtime.error()).toBeUndefined()
      const layer = engine.runtime.layers()[0]
      expect(layer.error).toBeUndefined()
      expect(layer.data?.rows).toBe(100)
      const binding = layer.plan.plan.layer?.bindings.find(b => b.channel === 'position')
      const position = layer.data?.attributes.get(binding?.attribute ?? '')?.data
      // Row 3 is (3, 6)
      expect([position?.[6], position?.[7]]).toEqual([3, 6])
    }
  })
})
