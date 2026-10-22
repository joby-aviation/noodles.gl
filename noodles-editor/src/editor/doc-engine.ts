// The planner engine, driven by the editor's store: a new document lowers and routes through
// `setDoc`, a new playhead time through `setTime`. One engine per page, outside React: the
// editor remounts while it opens a project, and the engine (a DuckDB connection, the memo)
// must outlive that.

import type { EditorDoc } from '@noodles.gl/planner'
import { useSyncExternalStore } from 'react'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { DeckProjectAssetResolver } from '../noodles/utils/deck-project-asset-resolver'
import { instantiateDeckView } from '../noodles/utils/deck-view'
import { instantiateLayer, instantiateWidget } from '../noodles/utils/instantiate-vis'
import { DuckDbEngine } from '../runtime/duckdb'
import { Engine, type EngineVis } from '../runtime/engine'
import { registerHostOperators } from '../runtime/host/host-ops'
import { HostRunner } from '../runtime/host/host-runner'
import type { DocStore } from './doc-store'

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

function openEngine(readAsset: (name: string) => Promise<Uint8Array>): Promise<Engine> {
  engine ??= DuckDbEngine.open().then(sql => {
    registerHostOperators()
    const e = new Engine(sql, {
      readAsset,
      registerFile: (n, b) => sql.registerFile(n, b),
      host: {
        runner: new HostRunner({ resolveOutputs: resolveAssets }),
        layer: instantiateLayer,
        widget: instantiateWidget,
        view: v => instantiateDeckView(v as never),
      },
    })
    e.onChange(vis => publish({ vis, errors: errorsOf(e) }))
    Object.assign(window as unknown as Record<string, unknown>, { plannerEngine: e })
    return e
  })
  return engine
}

function errorsOf(e: Engine): NodeError[] {
  const program = e.runtime.program()?.errors ?? []
  return [...(e.lowering()?.errors ?? []), ...e.errors(), ...program]
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
  void sync()
  return () => {
    stopped = true
    unsubscribe()
  }
}

/** Resolves when everything the last change set in motion has finished: for export frames. */
export async function settleEngine(): Promise<void> {
  await (await engine)?.settle()
}
