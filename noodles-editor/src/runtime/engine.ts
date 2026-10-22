// The engine: a document on one side, DuckDB and deck on the other.
//
// On every change it decides how much work the change is, as d-d-d's editor engine does:
//
//   - a new document is lowered (pure, fast) and its graph compared structurally with the
//     last one. Same structure: only values moved, so `runtime.setValues` routes each one.
//     Different structure: `runtime.setGraph`, which recompiles through the memo.
//   - a new time reuses the lowered document and only re-evaluates the scalar program.
//
// Its output is the visualization object the editor's renderer already draws: deck props with
// layer instances, and MapLibre props for the basemap.

import type { Layer } from '@deck.gl/core'
import {
  canonicalJson,
  type DocNode,
  type EditorDoc,
  type Graph,
  type Lowered,
  lowerDocument,
  parameterValues,
  type SqlEngine,
  targetCaps,
} from '@noodles.gl/planner'
import { DeckLayerBuilder } from './deck-layers'
import { ProgramRuntime, type UpdateReport } from './program-runtime'
import { registerNoodlesRamps } from './ramps'

/** Named basemaps the deck node offers, when it has no map style URL of its own. */
export const BASEMAPS: Record<string, string | undefined> = {
  'dark-matter': 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  positron: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  voyager: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  none: undefined,
}

export interface EngineVis {
  deckProps: { layers: Layer[]; viewState: Record<string, number> }
  mapProps?: Record<string, unknown>
}

export interface EngineOptions {
  /** Bytes of a project asset, for file nodes that read `@/name`. */
  readAsset?: (name: string) => Promise<Uint8Array>
  /** Make bytes readable by DuckDB under a file name. */
  registerFile?: (name: string, bytes: Uint8Array) => Promise<void>
}

type Listener = (vis: EngineVis, report?: UpdateReport) => void

/** Structure of a graph: everything except parameter values, which route without a recompile. */
function structureKey(graph: Graph): string {
  const specs = Object.fromEntries(
    Object.entries(graph.params ?? {}).map(([k, s]) => [k, { ...s, value: typeof s.value }])
  )
  return canonicalJson({ nodes: graph.nodes, functions: graph.functions, specs })
}

export class Engine {
  readonly runtime: ProgramRuntime
  private readonly builder = new DeckLayerBuilder()
  private readonly listeners = new Set<Listener>()
  private readonly registered = new Set<string>()
  private doc?: EditorDoc
  private lowered?: Lowered
  private structure?: string
  private time = 0
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    sql: SqlEngine,
    private readonly options: EngineOptions = {}
  ) {
    registerNoodlesRamps()
    this.runtime = new ProgramRuntime(sql, { caps: targetCaps('deck-webgl2', undefined) })
    this.runtime.onUpdate(report => this.emit(report))
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  lowering(): Lowered | undefined {
    return this.lowered
  }

  /** Show a document: a structural edit recompiles, a value edit only rebinds. */
  setDoc(doc: EditorDoc): Promise<void> {
    this.doc = doc
    this.lowered = lowerDocument(doc)
    return this.update()
  }

  /** Move the playhead. Only the scalar program re-evaluates; routes decide the rest. */
  setTime(seconds: number): Promise<void> {
    this.time = seconds
    return this.update()
  }

  /** Resolves when everything the last change set in motion has finished. */
  async settle(): Promise<void> {
    await this.pending
    await this.runtime.idle()
  }

  vis(): EngineVis {
    const runtime = this.runtime
    const built = this.builder.build(
      runtime.layers().map(l => ({
        id: l.id,
        kind: l.plan.kind,
        data: l.data,
        bindings: l.plan.plan.layer?.bindings ?? [],
        props: l.props,
      }))
    )
    // Draw order is the program's, which is the deck node's layer order.
    const layers = (runtime.program()?.draw ?? []).flatMap(id => built.get(id) ?? [])
    const view = runtime.view()
    const deck = this.deckNode()
    const mapStyle = deck ? styleOf(deck) : undefined
    return {
      deckProps: { layers, viewState: view },
      mapProps: mapStyle
        ? { mapStyle, projection: String(deck?.params.projection ?? 'mercator'), ...view }
        : undefined,
    }
  }

  private deckNode(): DocNode | undefined {
    return this.doc?.nodes.find(n => n.op === 'deck' && !n.flags?.bypass)
  }

  private update(): Promise<void> {
    const lowered = this.lowered
    if (!lowered) return Promise.resolve()
    const fps = this.doc?.timeline?.fps ?? 30
    const { values } = parameterValues(lowered, { T: this.time, F: Math.round(this.time * fps) })
    const key = structureKey(lowered.graph)
    const work =
      key !== this.structure
        ? this.registerAssets().then(() => {
            this.structure = key
            return this.runtime.setGraph(lowered.graph, values)
          })
        : this.runtime.setValues(values)
    this.pending = work.catch(() => undefined)
    // Props apply synchronously and the runtime reports them with no work behind them.
    return work.then(() => undefined)
  }

  /** Project assets a file node reads, registered with DuckDB under their `@/` name. */
  private async registerAssets(): Promise<void> {
    const { readAsset, registerFile } = this.options
    if (!readAsset || !registerFile) return
    for (const n of this.doc?.nodes ?? []) {
      const url = n.op === 'file' ? String(n.params.url ?? '') : ''
      if (!url.startsWith('@/') || this.registered.has(url)) continue
      await registerFile(url, await readAsset(url.slice(2)))
      this.registered.add(url)
    }
  }

  private emit(report?: UpdateReport): void {
    if (this.listeners.size === 0) return
    const vis = this.vis()
    for (const l of this.listeners) l(vis, report)
  }
}

function styleOf(deck: DocNode): string | undefined {
  const url = String(deck.params.mapStyle ?? '')
  if (url) return url
  const named = String(deck.params.basemap ?? 'dark-matter')
  return named in BASEMAPS ? BASEMAPS[named] : named
}
