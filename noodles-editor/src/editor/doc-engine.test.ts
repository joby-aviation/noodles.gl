// The binding between the editor's store and the engine: one step at a time, a project switch
// never interleaved with the last project's runs, and `whenDrawn` answering for the store's
// state when it was called. The engine is a fake whose runs finish when the test says so.
import type { EditorDoc } from '@noodles.gl/planner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bindEngine, engineState, whenDrawn } from './doc-engine'
import { DocStore } from './doc-store'

const fake = vi.hoisted(() => {
  const calls: string[] = []
  const runs: (() => void)[] = []
  // A run that finishes when the test calls `finish`
  const run = (name: string) => {
    calls.push(name)
    return new Promise<void>(resolve => runs.push(resolve))
  }
  const engine = {
    setDoc: (doc: { name: string }, time: number) => run(`setDoc ${doc.name} @${time}`),
    setTime: (time: number) => run(`setTime @${time}`),
    openProject: async () => {
      calls.push('openProject')
    },
    refresh: async () => undefined,
    assetChanged: async () => undefined,
    settle: async () => undefined,
    vis: () => ({ deckProps: { layers: [] } }),
    onChange: () => () => undefined,
    errors: () => [],
    lowering: () => undefined,
    slotValues: () => new Map(),
    runtime: { program: () => undefined, error: () => undefined, layers: () => [] },
  }
  return {
    calls,
    engine,
    /** Finish the oldest run still going, and let the binding take its next step. */
    async finish() {
      runs.shift()?.()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    },
    pending: () => runs.length,
  }
})

vi.mock('../runtime/engine', async importOriginal => ({
  ...(await importOriginal<object>()),
  Engine: class {
    constructor() {
      // biome-ignore lint/correctness/noConstructorReturn: the fake stands in for the instance
      return fake.engine
    }
  },
}))
vi.mock('../runtime/worker/runtime-proxy', () => ({ RuntimeProxy: class {} }))
vi.mock('../runtime/host/host-ops', async importOriginal => ({
  ...(await importOriginal<object>()),
  registerHostOperators: () => undefined,
}))

const doc = (name: string): EditorDoc => ({ version: 1, name, nodes: [], edges: [] })
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

let store: DocStore
let unbind: () => void
beforeEach(() => {
  vi.stubGlobal(
    'Worker',
    class {
      postMessage() {}
      addEventListener() {}
    }
  )
  fake.calls.length = 0
  store = new DocStore()
  unbind = bindEngine(store, async () => new Uint8Array())
})
afterEach(async () => {
  unbind()
  while (fake.pending()) await fake.finish()
  vi.unstubAllGlobals()
})

it('is drawn with no project open', async () => {
  expect(await whenDrawn()).toBe(true)
  expect(fake.calls).toEqual([])
})

it('hands the engine the store as it is when each step starts', async () => {
  store.load(doc('a'))
  await flush()
  expect(engineState().status).toEqual({ kind: 'drawing', loadId: 1 })
  // Three playhead moves while the first run is under way: one step follows, at the last time
  store.set({ time: 1 })
  store.set({ time: 2 })
  store.set({ time: 3 })
  await fake.finish()
  await fake.finish()
  expect(fake.calls).toEqual(['setDoc a @0', 'setTime @3'])
  expect(engineState().status).toEqual({ kind: 'drawn', loadId: 1 })
})

it('waits for an edit made while a step is under way', async () => {
  store.load(doc('a'))
  await flush()
  store.edit(() => doc('b'))
  let drawn = false
  void whenDrawn().then(() => {
    drawn = true
  })
  await fake.finish()
  // The edit hasn't drawn yet: the step for it has only started
  expect(drawn).toBe(false)
  expect(fake.calls).toEqual(['setDoc a @0', 'setDoc b @0'])
  await fake.finish()
  await flush()
  expect(drawn).toBe(true)
})

it('opens another project after the last one’s run, and only then runs it', async () => {
  store.load(doc('a'))
  await flush()
  store.set({ time: 1 })
  store.load(doc('b'))
  store.set({ time: 2 })
  await fake.finish()
  expect(fake.calls).toEqual(['setDoc a @0', 'openProject', 'setDoc b @2'])
  await fake.finish()
  expect(engineState().status).toEqual({ kind: 'drawn', loadId: 2 })
})

it('says which project failed to draw', async () => {
  const setDoc = fake.engine.setDoc
  fake.engine.setDoc = async () => {
    throw new Error('no DuckDB')
  }
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    store.load(doc('a'))
    expect(await whenDrawn()).toBe(true)
    expect(engineState().status).toEqual({ kind: 'failed', loadId: 1, error: 'no DuckDB' })
    expect(engineState().errors).toEqual([{ nodeId: '', message: 'no DuckDB' }])
  } finally {
    fake.engine.setDoc = setDoc
    vi.restoreAllMocks()
  }
})
