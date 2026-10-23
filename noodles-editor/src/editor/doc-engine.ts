// The planner engine, driven by the editor's store: a new document lowers and routes through
// `setDoc`, a new playhead time through `setTime`. One engine per page, outside React: the
// editor remounts while it opens a project, and the engine (a DuckDB connection, the memo)
// must outlive that.

import type { EditorDoc, Lowered } from '@noodles.gl/planner'
import { useSyncExternalStore } from 'react'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { setOpResolver } from '../noodles/op-resolver'
import { DeckProjectAssetResolver } from '../noodles/utils/deck-project-asset-resolver'
import { instantiateDeckView } from '../noodles/utils/deck-view'
import {
  instantiateExtensions,
  instantiateLayer,
  instantiateWidget,
} from '../noodles/utils/instantiate-vis'
import { Engine, type EngineVis } from '../runtime/engine'
import { registerHostOperators } from '../runtime/host/host-ops'
import { HostRunner } from '../runtime/host/host-runner'
import type { ProgramView } from '../runtime/worker/protocol'
import { RuntimeProxy } from '../runtime/worker/runtime-proxy'
import type { DocStore } from './doc-store'
import { opView } from './op-view'

/** What a node's badge shows: why it drew nothing. */
export interface NodeError {
  nodeId: string
  message: string
}

/** What a layer drew, for a node's badge and the parameter pane. */
export interface LayerSummary {
  id: string
  kind: string
  rows: number
  paths?: number
  queryMs: number
  evalMs: number
  error?: string
  sql?: string
  bindings: { channel: string; attribute: string }[]
}

export interface EngineState {
  vis?: EngineVis
  errors: NodeError[]
  /** The engine has started and drawn the current document at least once. */
  ready: boolean
  lowered?: Lowered
  program?: ProgramView
  layers: LayerSummary[]
  /** Parameter values at the playhead, by `nodeId.param`. */
  slots: ReadonlyMap<string, unknown>
}

let state: EngineState = { errors: [], ready: false, layers: [], slots: new Map() }
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

/** The engine's state outside React: the agent bench reads it. */
export const engineState = (): EngineState => state

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
        // Extension operators' { extension, props }: the extensions, and their props merged
        extensions: values => {
          const list = values as { extension: unknown; props?: Record<string, unknown> }[]
          return {
            extensions: instantiateExtensions(list.map(v => v.extension)) ?? [],
            props: Object.assign({}, ...list.map(v => v.props ?? {})),
          }
        },
        view: v => instantiateDeckView(v as never),
      },
    })
    opened = e
    e.onChange(vis => publish({ vis, errors: errorsOf(e), ...detailsOf(e) }))
    Object.assign(window as unknown as Record<string, unknown>, { plannerEngine: e })
    return e
  })
  return engine
}

/** The lowering, the program and what each layer drew, as the editor shows them. */
function detailsOf(e: Engine): Pick<EngineState, 'lowered' | 'program' | 'layers' | 'slots'> {
  return {
    lowered: e.lowering(),
    program: e.runtime.program(),
    slots: e.slotValues(),
    layers: e.runtime.layers().map(l => ({
      id: l.id,
      kind: l.plan.kind,
      rows: l.data?.rows ?? 0,
      paths: l.data?.starts?.length,
      queryMs: l.queryMs,
      evalMs: l.evalMs,
      error: l.error,
      sql: l.plan.plan.sql,
      bindings: l.plan.plan.layer?.bindings ?? [],
    })),
  }
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
 * Every node's errors, by document node id: lowering and host errors, a relation that failed,
 * a layer that drew nothing. What the parameter pane shows a user, for tools to read.
 */
export function nodeErrors(e: Engine): { id: string; error: string }[] {
  const program = e.runtime.program()
  const errors = errorsOf(e).map(x => ({ id: x.nodeId, error: x.message }))
  for (const [id, irs] of Object.entries(e.lowering()?.irNodes ?? {})) {
    for (const ir of irs) {
      const error = program?.nodes[ir]?.error
      if (error) errors.push({ id, error })
    }
  }
  for (const l of e.runtime.layers()) if (l.error) errors.push({ id: l.id, error: l.error })
  return errors.filter((x, i) => errors.findIndex(y => y.id === x.id && y.error === x.error) === i)
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
    // The store's first document is a placeholder until a project opens: compiling it would
    // be a wasted compile on every load
    if (s.loadId === 0) return
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
  // DuckDB-Wasm takes a second or more to start: start it while the project is still loading
  void openEngine(readAsset)
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
