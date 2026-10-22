// Development scaffold, removed at the cutover: `localStorage.plannerPreview = '1'` draws the
// open project through the planner engine instead of the operator graph, so the two can be
// compared on one page. (A query parameter would not survive: the app rewrites the URL when it
// opens a project.)

import { useEffect, useSyncExternalStore } from 'react'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { DeckProjectAssetResolver } from '../noodles/utils/deck-project-asset-resolver'
import { instantiateDeckView } from '../noodles/utils/deck-view'
import { instantiateLayer, instantiateWidget } from '../noodles/utils/instantiate-vis'
import type { NoodlesProjectJSON } from '../noodles/utils/serialization'
import { DuckDbEngine } from './duckdb'
import { Engine, type EngineVis } from './engine'
import { registerHostOperators } from './host/host-ops'
import { HostRunner } from './host/host-runner'
import { MigrationError, type NoodlesProject, toEditorDoc } from './migrate/to-editor-doc'

export const plannerPreviewEnabled = () =>
  import.meta.env.DEV && globalThis.localStorage?.getItem('plannerPreview') === '1'

// One engine per page, outside React: the editor remounts while it opens a project, and the
// engine (a DuckDB connection, the memo) must outlive that.
let engine: Promise<Engine> | undefined
let latest: EngineVis | undefined
const subscribers = new Set<() => void>()

function publish(vis: EngineVis) {
  latest = vis
  for (const s of subscribers) s()
}

function subscribe(listener: () => void) {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

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
    if (resolution && resolver.commit(resolution)) out[name] = resolution.layers[0]
    else out[name] = value
  }
  return out
}

function getEngine(readAsset: (name: string) => Promise<Uint8Array>): Promise<Engine> {
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
    e.onChange(publish)
    Object.assign(window as unknown as Record<string, unknown>, { plannerEngine: e })
    return e
  })
  return engine
}

export function usePlannerPreview(
  enabled: boolean,
  getProject: () => NoodlesProjectJSON,
  readAsset: (name: string) => Promise<Uint8Array>,
  revision: unknown
): EngineVis | undefined {
  const vis = useSyncExternalStore(subscribe, () => latest)

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision stands in for the project's nodes and edges
  useEffect(() => {
    if (!enabled) return
    const project = getProject()
    if (!project.nodes.length) return
    let migrated: ReturnType<typeof toEditorDoc>
    try {
      migrated = toEditorDoc(project as unknown as NoodlesProject)
    } catch (error) {
      if (error instanceof MigrationError) console.warn('[planner preview]', error.message)
      else console.error('[planner preview]', error)
      return
    }
    for (const w of migrated.warnings) console.info('[planner preview]', w)
    void getEngine(readAsset)
      .then(async e => {
        await e.setDoc(migrated.doc)
        publish(e.vis())
      })
      .catch(error => console.error('[planner preview]', error))
  }, [enabled, revision])

  return enabled ? vis : undefined
}
