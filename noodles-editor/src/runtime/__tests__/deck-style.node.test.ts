// A deck draws its basemap from style JSON pasted into its URL, and from its own style changes,
// without a Map Style node.
import type { EditorDoc } from '@noodles.gl/planner'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Engine } from '../engine'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)
afterEach(() => vi.unstubAllGlobals())

const base = {
  version: 8,
  sources: {},
  layers: [{ id: 'water', type: 'fill', source: 'x', paint: { 'fill-color': '#00f' } }],
}

const doc = (params: Record<string, unknown>): EditorDoc => ({
  version: 1,
  name: 'style',
  nodes: [{ id: 'map', op: 'deck', x: 0, y: 0, params: params as never }],
  edges: [],
})

const styleOf = (engine: Engine) => engine.vis().mapProps?.mapStyle as Record<string, unknown>

it('draws pasted style JSON as one style object, frame after frame', async () => {
  const engine = new Engine(duck)
  await engine.setDoc(doc({ mapStyle: JSON.stringify(base) }))
  await engine.settle()
  expect(styleOf(engine)).toEqual(base)
  // The same object each time, so the map doesn't re-diff its style
  expect(styleOf(engine)).toBe(styleOf(engine))
})

it('applies the deck’s own style changes once the base style is fetched', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => base }) as unknown as Response)
  )
  const engine = new Engine(duck)
  const changed = new Promise<void>(resolve => engine.onChange(() => resolve()))
  const overrides = {
    layers: [{ layerId: 'water', paintOverrides: { 'fill-color': '#f00' } }],
    global: {},
  }
  await engine.setDoc(
    doc({ mapStyle: 'https://example.com/style.json', styleOverrides: JSON.stringify(overrides) })
  )
  await engine.settle()
  await changed
  await vi.waitFor(() => expect(typeof styleOf(engine)).toBe('object'))
  const layers = styleOf(engine).layers as { paint: Record<string, unknown> }[]
  expect(layers[0].paint['fill-color']).toBe('#f00')
})
