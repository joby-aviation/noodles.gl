// The planner engine, driven by the editor's store: a new document lowers and routes through
// `setDoc`, a new playhead time through `setTime`. One engine per page, outside React: the
// editor remounts while it opens a project, and the engine (a DuckDB connection, the memo)
// must outlive that.

import type { EditorDoc } from '@noodles.gl/planner'
import { useSyncExternalStore } from 'react'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { setOpResolver } from '../noodles/op-resolver'
import { DeckProjectAssetResolver } from '../noodles/utils/deck-project-asset-resolver'
import { instantiateDeckView } from '../noodles/utils/deck-view'
import { instantiateLayer, instantiateWidget } from '../noodles/utils/instantiate-vis'
import { Engine, type EngineVis } from '../runtime/engine'
import { registerHostOperators } from '../runtime/host/host-ops'
import { HostRunner } from '../runtime/host/host-runner'
import { RuntimeProxy } from '../runtime/worker/runtime-proxy'
import type { DocStore } from './doc-store'
import { opView } from './op-view'

/** What a node's badge shows: why it drew nothing. */
export interface NodeError {
  nodeId: string
  message: string
}

export interface EngineState {
  vis?: EngineVis
  errors: NodeError[]
  /** The engine has started and drawn the current document at least once. */
  ready: boolean
}

let state: EngineState = { errors: [], ready: false }
const listeners = new Set<() => void>()

function publish(patch: Partial<EngineState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useEngineState = (): EngineState => useSyncExternalStore(subscribe, () => state)

/** One asset resolver per host node, so each node's generations stand alone. */
const resolvers = new Map<string, DeckProjectAssetResolver>()

async function resolveAssets(nodeId: string, outputs: Record<string, unknown>) {
  const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(outputs)) {
    const isLayer =
      value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
    if (!isLayer) {
      out[name] = value
      continue
    }
    const resolver = resolvers.get(nodeId) ?? new DeckProjectAssetResolver()
    resolvers.set(nodeId, resolver)
    const resolution = await resolver.resolveLayers([value as { type: string; id: string }], {
      activeStorageType,
      currentProjectName,
    })
    out[name] = resolution && resolver.commit(resolution) ? resolution.layers[0] : value
  }
  return out
}

let engine: Promise<Engine> | undefined
let opened: Engine | undefined

/** The engine once it has started; tools read rows and errors from it. */
export const currentEngine = (): Engine | undefined => opened

function openEngine(readAsset: (name: string) => Promise<Uint8Array>): Promise<Engine> {
  engine ??= Promise.resolve().then(() => {
    // DuckDB and the planner runtime run in their own worker; this thread lowers documents,
    // runs host operators and builds deck layers from the buffers the worker sends
    const worker = new Worker(new URL('../runtime/worker/engine.worker.ts', import.meta.url), {
      type: 'module',
    })
    const runtime = new RuntimeProxy(worker)
    registerHostOperators()
    const e = new Engine(runtime, {
      readAsset,
      registerFile: (n, b) => runtime.registerFile(n, b),
      host: {
        runner: new HostRunner({ resolveOutputs: resolveAssets }),
        layer: instantiateLayer,
        widget: instantiateWidget,
        view: v => instantiateDeckView(v as never),
      },
    })
    opened = e
    e.onChange(vis => publish({ vis, errors: errorsOf(e) }))
    Object.assign(window as unknown as Record<string, unknown>, { plannerEngine: e })
    return e
  })
  return engine
}

export function errorsOf(e: Engine): NodeError[] {
  const program = e.runtime.program()?.errors ?? []
  // A compile that failed outright keeps the last program; say so rather than draw stale layers
  const failed = e.runtime.error()
  return [
    ...(e.lowering()?.errors ?? []),
    ...e.errors(),
    ...program,
    ...(failed ? [{ nodeId: '', message: failed }] : []),
  ]
}

/**
 * Run the store's document on the engine until the returned function is called. Edits and
 * playhead moves are passed on as they happen; the engine decides what each one costs.
 */
export function bindEngine(
  store: DocStore,
  readAsset: (name: string) => Promise<Uint8Array>
): () => void {
  let doc: EditorDoc | undefined
  let time: number | undefined
  let stopped = false
  const sync = async () => {
    const s = store.get()
    if (s.doc === doc && s.time === time) return
    const e = await openEngine(readAsset)
    if (stopped) return
    const docChanged = s.doc !== doc
    doc = s.doc
    time = s.time
    try {
      await (docChanged ? e.setDoc(s.doc, s.time) : e.setTime(s.time))
      publish({ vis: e.vis(), errors: errorsOf(e), ready: true })
    } catch (error) {
      console.error('[engine]', error)
      publish({ errors: [{ nodeId: '', message: (error as Error).message }] })
    }
  }
  const unsubscribe = store.subscribe(() => void sync())
  setOpResolver((path, contextId) => opView(store, currentEngine, path, contextId))
  void sync()
  return () => {
    stopped = true
    unsubscribe()
    setOpResolver(undefined)
  }
}

// Export waits for a frame's layers to reach the screen: `settleEngine` resolves once the view
// has committed the visualization it published.
const committedWaiters = new Map<EngineVis, () => void>()

/** The view calls this after committing a visualization. */
export function visCommitted(vis: EngineVis | undefined): void {
  if (!vis) return
  committedWaiters.get(vis)?.()
  committedWaiters.delete(vis)
}

/**
 * Run the document at `time` and resolve when everything that set in motion has finished and
 * the view has committed the result: a frame for export, never a stale one. A view that does not
 * commit within a second (the editor hidden, say) does not hold the export up.
 */
export async function settleEngine(time: number): Promise<void> {
  const e = await engine
  if (!e) return
  await e.setTime(time)
  await e.settle()
  const vis = e.vis()
  const committed = new Promise<void>(resolve => {
    committedWaiters.set(vis, resolve)
    setTimeout(resolve, 1000)
  })
  publish({ vis, errors: errorsOf(e) })
  await committed
}
