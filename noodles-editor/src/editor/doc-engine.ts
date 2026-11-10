// The planner engine, driven by the editor's store: a new document lowers and routes through
// `setDoc`, a new playhead time through `setTime`. One engine per page, outside React: the
// editor remounts while it opens a project, and the engine (a DuckDB connection, the memo)
// must outlive that.

import type { EditorDoc, Lowered } from '@noodles.gl/planner'
import { useSyncExternalStore } from 'react'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { agentBench, externalControl } from '../noodles/globals'
import { setOpResolver } from '../noodles/op-resolver'
import { onAssetWritten } from '../noodles/storage'
import { DeckProjectAssetResolver } from '../noodles/utils/deck-project-asset-resolver'
import { instantiateDeckView } from '../noodles/utils/deck-view'
import {
  instantiateExtensions,
  instantiateLayer,
  instantiateWidget,
} from '../noodles/utils/instantiate-vis'
import { onKeyChange } from '../noodles/utils/key-dependencies'
import { subscribeToRenderSurfaceSize } from '../render/render-surface-size'
import { Engine, type EngineVis } from '../runtime/engine'
import { registerHostOperators } from '../runtime/host/host-ops'
import { HostRunner } from '../runtime/host/host-runner'
import type { RuntimeCounters } from '../runtime/program-runtime'
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

/**
 * Where the engine is with the store's document. `loadId` names the project (the store's
 * `loadId`) the status is about.
 */
export type EngineStatus =
  /** No project has opened, or the engine is still starting. */
  | { kind: 'waiting' }
  /** A change to the document or the playhead is on its way to the screen. */
  | { kind: 'drawing'; loadId: number }
  /** The engine drew the document and time the store holds now. */
  | { kind: 'drawn'; loadId: number }
  /** The last change didn't draw; `errors` says why. */
  | { kind: 'failed'; loadId: number; error: string }

export interface EngineState {
  vis?: EngineVis
  errors: NodeError[]
  status: EngineStatus
  lowered?: Lowered
  program?: ProgramView
  /** What changes have cost since the engine started: compiles, layer queries, CPU passes. */
  counters?: RuntimeCounters
  layers: LayerSummary[]
  /** Parameter values at the playhead, by `nodeId.param`. */
  slots: ReadonlyMap<string, unknown>
}

let state: EngineState = { errors: [], status: { kind: 'waiting' }, layers: [], slots: new Map() }
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

// Click-to-edit (map-click-to-edit.tsx) picks features, so layers are pickable in the editor
// unless they say otherwise. Off when an agent drives the editor, as click-to-edit is.
const EDITOR_PICKING = !externalControl && !agentBench

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
      pickable: EDITOR_PICKING,
      registerFile: (n, b) => runtime.registerFile(n, b),
      host: {
        runner: new HostRunner({ resolveOutputs: resolveAssets }),
        layer: d => instantiateLayer(EDITOR_PICKING ? { pickable: true, ...d } : d),
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
function detailsOf(
  e: Engine
): Pick<EngineState, 'lowered' | 'program' | 'counters' | 'layers' | 'slots'> {
  return {
    lowered: e.lowering(),
    program: e.runtime.program(),
    counters: { ...e.runtime.counters },
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
 * The bound editor's steps, counted: `target` is the step that hands (or handed) the engine
 * the store as it is now, `done` the steps finished. 0 when nothing is left to hand.
 */
interface Steps {
  target(): number
  done(): number
}
let steps: Steps | undefined
// Callers of `whenDrawn`, each waiting for one step to finish
let drawnWaiters: { step: number; resolve: () => void }[] = []

function resolveDrawn() {
  const done = steps?.done() ?? Number.POSITIVE_INFINITY
  const ready = drawnWaiters.filter(w => w.step <= done)
  drawnWaiters = drawnWaiters.filter(w => w.step > done)
  for (const w of ready) w.resolve()
}

const withTimeout = async <T>(work: Promise<T>, ms: number, otherwise: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(otherwise), ms)
  })
  const result = await Promise.race([work, timeout])
  clearTimeout(timer)
  return result
}

export async function whenDrawn(timeoutMs = 15_000): Promise<boolean> {
  // No editor bound to an engine: nothing will draw
  if (!steps) return true
  // An edit reaches the binding on the store's listener, which has run by now. Later changes,
  // the playhead moving on, say, are not waited for.
  const step = steps.target()
  const drawn = new Promise<void>(resolve => {
    drawnWaiters.push({ step, resolve })
    resolveDrawn()
  })
  return withTimeout(
    drawn.then(async () => {
      await opened?.settle()
      return true
    }),
    timeoutMs,
    false
  )
}

/**
 * `whenDrawn`, and then the view has committed what the engine drew and the canvas has
 * painted it: what a screenshot waits for. A view that doesn't commit within a second (the
 * editor hidden) doesn't hold it up.
 */
export async function whenShown(timeoutMs = 15_000): Promise<boolean> {
  // No editor bound to an engine: no view draws either
  if (!steps) return true
  const drawn = await whenDrawn(timeoutMs)
  const { vis } = state
  if (vis && vis !== lastCommitted) {
    await withTimeout(
      new Promise<void>(resolve => committedWaiters.set(vis, resolve)),
      1000,
      undefined
    )
    committedWaiters.delete(vis)
  }
  // Deck draws the committed layers on the next animation frame
  for (let i = 0; i < 2; i++) {
    await withTimeout(new Promise<void>(r => requestAnimationFrame(() => r())), 100, undefined)
  }
  return drawn
}

/**
 * Run the store's document on the engine until the returned function is called. Edits and
 * playhead moves are passed on as they happen; the engine decides what each one costs.
 *
 * One step at a time: a step hands the engine the store's document and time as they are when
 * it starts, and changes that arrive meanwhile wait for the next step, which reads the store
 * again. So a project switch can't interleave with the last project's edits, and `status`
 * says which state of the store the screen shows.
 */
export function bindEngine(
  store: DocStore,
  readAsset: (name: string) => Promise<Uint8Array>
): () => void {
  // What the engine has been handed
  let doc: EditorDoc | undefined
  let time: number | undefined
  let loadId: number | undefined
  let stopped = false
  let stepping = false
  // The store changed while a step was under way
  let again = false
  // Steps started and finished
  let started = 0
  let finished = 0

  // Nothing left to hand the engine: the store holds what it was last handed
  const handed = () => {
    const s = store.get()
    return s.loadId === 0 || (s.loadId === loadId && s.doc === doc && s.time === time)
  }
  const stepsHere: Steps = {
    // The step that was handed the store as it is, or the one that will be: a change during a
    // step always gets one more (`again`)
    target: () => (stopped || store.get().loadId === 0 ? 0 : handed() ? started : started + 1),
    done: () => (stopped ? Number.POSITIVE_INFINITY : finished),
  }
  steps = stepsHere

  const step = async () => {
    started++
    const s = store.get()
    const docChanged = s.doc !== doc
    // Another project: the engine forgets the last one's files and relations first
    const projectChanged = loadId !== undefined && s.loadId !== loadId
    loadId = s.loadId
    doc = s.doc
    time = s.time
    publish({ status: { kind: 'drawing', loadId: s.loadId } })
    try {
      const e = await openEngine(readAsset)
      if (stopped) return
      if (projectChanged) {
        // Asset URLs are cached by `@/` name, which the next project's files repeat
        for (const r of resolvers.values()) r.dispose()
        resolvers.clear()
      }
      const opening = projectChanged ? e.openProject() : undefined
      await (docChanged || projectChanged ? e.setDoc(s.doc, s.time) : e.setTime(s.time))
      await opening
      publish({ vis: e.vis(), errors: errorsOf(e), status: { kind: 'drawn', loadId: s.loadId } })
    } catch (error) {
      console.error('[engine]', error)
      const message = (error as Error).message
      publish({
        errors: [{ nodeId: '', message }],
        status: { kind: 'failed', loadId: s.loadId, error: message },
      })
    }
  }

  const sync = async () => {
    // The store's first document is a placeholder until a project opens: compiling it would
    // be a wasted compile on every load
    if (stopped || handed()) return resolveDrawn()
    if (stepping) {
      again = true
      return
    }
    stepping = true
    try {
      do {
        again = false
        await step()
        finished++
        resolveDrawn()
      } while (again && !stopped && !handed())
    } finally {
      stepping = false
      resolveDrawn()
    }
  }
  // DuckDB-Wasm takes a second or more to start: start it while the project is still loading
  void openEngine(readAsset)
  // A camera fitted to the render surface (BoundingBox) refits when it resizes
  const surface = subscribeToRenderSurfaceSize(() => {
    // The engine publishes what it drew through onChange
    if (!stopped && store.get().loadId !== 0) void opened?.refresh()
  })
  // An uploaded or rewritten project file a layer draws (an icon atlas) is read again
  const assets = onAssetWritten(name => {
    if (!stopped) void opened?.assetChanged(name)
  })
  // An operator that sends requests with an API key (Geocoder, Google 3D tiles) runs again
  // once the user changes that key
  const keys = onKeyChange(() => {
    if (!stopped && store.get().loadId !== 0) void opened?.refresh()
  })
  const unsubscribe = store.subscribe(() => void sync())
  setOpResolver((path, contextId) => opView(store, currentEngine, path, contextId))
  void sync()
  return () => {
    stopped = true
    unsubscribe()
    assets()
    surface.unsubscribe()
    keys()
    setOpResolver(undefined)
    resolveDrawn()
    // A binding made since (the editor remounted) answers for itself
    if (steps === stepsHere) steps = undefined
  }
}

// Export waits for a frame's layers to reach the screen: `settleEngine` resolves once the view
// has committed the visualization it published.
const committedWaiters = new Map<EngineVis, () => void>()
let lastCommitted: EngineVis | undefined

/** The view calls this after committing a visualization. */
export function visCommitted(vis: EngineVis | undefined): void {
  if (!vis) return
  lastCommitted = vis
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
