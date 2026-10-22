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
  deckProps: {
    layers: Layer[]
    viewState: Record<string, unknown>
    views?: unknown[]
    widgets?: unknown[]
    effects?: unknown[]
  }
  mapProps?: Record<string, unknown>
  maplibreLayers?: unknown[]
}

/** Host-side pieces the engine needs but must not import (they pull in the operator library). */
export interface EngineHost {
  runner: {
    run(
      doc: EditorDoc,
      inputs: HostRunInputs
    ): Promise<{ errors: { nodeId: string; message: string }[] }>
    output(nodeId: string, port: string): unknown
    idle(): Promise<void>
  }
  /** A layer operator's plain-object output as a deck layer. */
  layer(description: { type: string; [key: string]: unknown }): Layer
  widget(description: { type: string; [key: string]: unknown }): unknown
  view(description: unknown): unknown
}

export interface HostRunInputs {
  planner(nodeId: string, port: string): unknown
  slots: ReadonlyMap<string, unknown>
  time: number
}

export interface EngineOptions {
  /** Runs the document's host operators. Without it, host nodes draw nothing. */
  host?: EngineHost
  /** Bytes of a project asset, for file nodes that read `@/name`. */
  readAsset?: (name: string) => Promise<Uint8Array>
  /** Make bytes readable by DuckDB under a file name. */
  registerFile?: (name: string, bytes: Uint8Array) => Promise<void>
  /** Bytes of a remote file. Defaults to `fetch`. */
  fetchBytes?: (url: string) => Promise<Uint8Array>
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
  private slots: ReadonlyMap<string, unknown> = new Map()
  private pending: Promise<unknown> = Promise.resolve()
  private built = new Map<string, Layer[]>()
  private hostErrors: { nodeId: string; message: string }[] = []

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

  /** Host operators that failed on the last run. */
  errors(): { nodeId: string; message: string }[] {
    return this.hostErrors
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
    await this.options.host?.runner.idle()
  }

  vis(): EngineVis {
    this.buildPlannerLayers()
    const deck = this.deckNode()
    const host = this.options.host
    const into = (port: string) =>
      (this.doc?.edges ?? [])
        .filter(e => deck && e.target === deck.id && e.targetPort === port)
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const hostValues = (port: string) =>
      into(port).flatMap(e => {
        const v = host?.runner.output(e.source, e.sourcePort)
        return v === undefined ? [] : Array.isArray(v) ? v : [v]
      })

    // Draw order is the deck's edge order, planner and host layers alike.
    const layers = into('layers').flatMap(e => {
      const planned = this.built.get(e.source)
      if (planned) return planned
      const v = host?.runner.output(e.source, e.sourcePort)
      return (Array.isArray(v) ? v : v ? [v] : []).flatMap(item => this.asLayer(item))
    })
    const viewStateEdge = into('viewState')[0]
    const hostView = viewStateEdge
      ? (host?.runner.output(viewStateEdge.source, viewStateEdge.sourcePort) as Record<
          string,
          unknown
        >)
      : undefined
    const view = { ...this.runtime.view(), ...(hostView ?? {}) }
    const mapStyle = deck ? styleOf(deck) : undefined
    const views = hostValues('views').map(v => host?.view(v))
    const widgets = hostValues('widgets').map(w => host?.widget(w as { type: string }))
    const effects = hostValues('effects')
    return {
      deckProps: {
        layers,
        viewState: view,
        ...(views.length ? { views } : {}),
        ...(widgets.length ? { widgets } : {}),
        ...(effects.length ? { effects } : {}),
      },
      mapProps: mapStyle
        ? { mapStyle, projection: String(deck?.params.projection ?? 'mercator'), ...view }
        : undefined,
      maplibreLayers: hostValues('maplibreLayers'),
    }
  }

  private asLayer(item: unknown): Layer[] {
    if (!item || typeof item !== 'object') return []
    if ('type' in item && typeof (item as { type: unknown }).type === 'string') {
      return this.options.host ? [this.options.host.layer(item as { type: string })] : []
    }
    // Already a deck layer: a planner layer passed through a host switch, say.
    return [item as Layer]
  }

  private buildPlannerLayers(): void {
    this.built = this.builder.build(
      this.runtime.layers().map(l => ({
        id: l.id,
        kind: l.plan.kind,
        data: l.data,
        bindings: l.plan.plan.layer?.bindings ?? [],
        props: l.props,
      }))
    )
  }

  private deckNode(): DocNode | undefined {
    return this.doc?.nodes.find(n => n.op === 'deck' && !n.flags?.bypass)
  }

  private update(): Promise<void> {
    const lowered = this.lowered
    if (!lowered) return Promise.resolve()
    const fps = this.doc?.timeline?.fps ?? 30
    const { values, slots } = parameterValues(lowered, {
      T: this.time,
      F: Math.round(this.time * fps),
    })
    this.slots = slots
    const key = structureKey(lowered.graph)
    const work =
      key !== this.structure
        ? this.registerAssets().then(() => {
            this.structure = key
            return this.runtime.setGraph(lowered.graph, values)
          })
        : this.runtime.setValues(values)
    const all = work.then(() => this.runHost())
    this.pending = all.catch(() => undefined)
    return all
  }

  /** Host operators, after the planner: they may read planner layers and scalar slots. */
  private async runHost(): Promise<void> {
    const host = this.options.host
    if (!host || !this.doc) return
    await this.runtime.idle()
    this.buildPlannerLayers()
    const report = await host.runner.run(this.doc, {
      planner: nodeId => this.built.get(nodeId)?.[0],
      slots: this.slots,
      time: this.time,
    })
    this.hostErrors = report.errors
    this.emit()
  }

  /**
   * Files a compile reads, made readable by DuckDB first: project assets under their `@/` name,
   * and spatial files (GeoJSON...) under their URL, since DuckDB spatial's ST_Read reads files
   * DuckDB-Wasm holds rather than fetching them itself.
   */
  private async registerAssets(): Promise<void> {
    const { readAsset, registerFile } = this.options
    if (!registerFile) return
    const fetchBytes =
      this.options.fetchBytes ??
      (async (url: string) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
        return new Uint8Array(await res.arrayBuffer())
      })
    for (const n of this.doc?.nodes ?? []) {
      const url = n.op === 'file' || n.op === 'geojson' ? String(n.params.url ?? '') : ''
      if (!url || this.registered.has(url)) continue
      if (url.startsWith('@/')) {
        if (!readAsset) continue
        await registerFile(url, await readAsset(url.slice(2)))
      } else if (n.op === 'geojson') {
        await registerFile(url, await fetchBytes(url))
      } else {
        continue
      }
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
