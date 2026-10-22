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
  OPERATOR_INDEX,
  parameterValues,
  type SqlEngine,
  targetCaps,
} from '@noodles.gl/planner'
import { DeckLayerBuilder } from './deck-layers'
import { flatRow, isFeatureCollection } from './plain-rows'
import {
  type Preview,
  ProgramRuntime,
  type RuntimeCounters,
  type UpdateReport,
} from './program-runtime'
import { registerNoodlesRamps } from './ramps'
import type { LayerView, ProgramView, Values } from './worker/protocol'

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

/** A planner output a host operator reads that does not exist yet: the operator waits. */
export const PENDING = Symbol.for('noodles.planner.pending')

export interface HostRunInputs {
  /** A layer, a relation's rows (possibly still loading), or `PENDING`. */
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

/**
 * What the engine needs of a runtime: a ProgramRuntime in this thread (tests, Node), or the
 * engine worker's proxy (the app).
 */
export interface RuntimeLike {
  readonly counters: RuntimeCounters
  setGraph(graph: Graph, values: Values): Promise<unknown>
  setValues(values: Values): Promise<unknown>
  idle(): Promise<void>
  layers(): LayerView[]
  program(): ProgramView | undefined
  view(): Record<string, number>
  error(): string | undefined
  preview(nodeId: string, limit?: number): Promise<Preview>
  /** Rows of a query as plain objects. */
  query(sql: string): Promise<Record<string, unknown>[]>
  /** A relation's rows as plain objects, decimals and 64-bit integers as numbers. */
  relationRows(relation: string): Promise<Record<string, unknown>[]>
  onUpdate(listener: (report: UpdateReport) => void): () => void
}

/** A runtime in this thread, over an SQL engine. */
export function localRuntime(sql: SqlEngine): RuntimeLike {
  return new ProgramRuntime(sql, { caps: targetCaps('deck-webgl2', undefined) })
}

export class Engine {
  readonly runtime: RuntimeLike
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
  /** `nodeId.port` -> the query reading rows a host operator handed to planner nodes. */
  private readonly hostTables = new Map<string, string>()
  private readonly tableFiles = new WeakMap<object, string>()
  private tableCount = 0

  constructor(
    backend: SqlEngine | RuntimeLike,
    private readonly options: EngineOptions = {}
  ) {
    registerNoodlesRamps()
    this.runtime = 'setGraph' in backend ? backend : localRuntime(backend)
    this.runtime.onUpdate(report => this.emit(report))
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  lowering(): Lowered | undefined {
    return this.lowered
  }

  /** A host operator's output after its last run. */
  hostOutput(nodeId: string, port: string): unknown {
    return this.options.host?.runner.output(nodeId, port)
  }

  /** Host operators that failed on the last run. */
  errors(): { nodeId: string; message: string }[] {
    return this.hostErrors
  }

  /** Show a document: a structural edit recompiles, a value edit only rebinds. */
  setDoc(doc: EditorDoc, time = this.time): Promise<void> {
    this.doc = doc
    this.time = time
    this.lower()
    return this.update()
  }

  private lower(): void {
    if (!this.doc) return
    this.lowered = lowerDocument(this.doc, {
      hostTable: (nodeId, port) => this.hostTables.get(`${nodeId}.${port}`),
    })
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
      // A planner node's output is the IR layer it lowered to: a switch's is the one it chose.
      const planned = this.built.get(this.lowered?.outputs[e.source]?.[e.sourcePort] ?? e.source)
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
    // A deck with its own views and no map (an OrbitView, say) keeps the view's own camera:
    // the deck node's longitude and latitude mean nothing to it.
    const geographic = !!(deck && styleOf(deck)) || into('views').length === 0
    const view = { ...(geographic ? this.runtime.view() : {}), ...(hostView ?? {}) }
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
    if (!this.lowered) return Promise.resolve()
    const all = (async () => {
      // Host operators the planner reads (a geocoder whose location a query binds, a CodeOp
      // whose rows a layer draws) first; the ones that read planner output wait for the second
      // pass.
      await this.runHost(false)
      if (await this.bridgeHostTables()) this.lower()
      const lowered = this.lowered
      if (!lowered) return
      const key = structureKey(lowered.graph)
      const structural = key !== this.structure
      if (structural) await this.registerAssets()
      const fps = this.doc?.timeline?.fps ?? 30
      const clock = { T: this.time, F: Math.round(this.time * fps) }
      const { values, slots } = parameterValues(lowered, clock, this.hostValues())
      this.slots = slots
      if (structural) {
        this.structure = key
        await this.runtime.setGraph(lowered.graph, values)
      } else {
        await this.runtime.setValues(values)
      }
      await this.runtime.idle()
      await this.runHost(true)
    })()
    this.pending = all.catch(() => undefined)
    return all
  }

  /**
   * Rows host operators hand to planner nodes, made DuckDB tables: written once per output
   * (a host operator that did not re-run hands over the same array) as JSON DuckDB reads.
   * True when any query changed, so the document lowers again.
   */
  private async bridgeHostTables(): Promise<boolean> {
    const { host, registerFile } = this.options
    if (!host || !registerFile || !this.doc) return false
    const opOf = (id: string) =>
      OPERATOR_INDEX.get(this.doc?.nodes.find(n => n.id === id)?.op ?? '')
    const isHost = (id: string) => !!opOf(id) && !opOf(id)?.lower
    // Only a planner node's table input reads rows; a deck's layers port takes the host's layers.
    const readsRows = (id: string, port: string) =>
      opOf(id)?.inputs.find(p => p.name === port)?.type === 'table'
    let changed = false
    const live = new Set<string>()
    for (const e of this.doc.edges) {
      if (!isHost(e.source) || isHost(e.target) || !readsRows(e.target, e.targetPort)) continue
      const key = `${e.source}.${e.sourcePort}`
      if (live.has(key)) continue
      live.add(key)
      const value = host.runner.output(e.source, e.sourcePort)
      // Rows become a JSON table; a GeoJSON FeatureCollection a spatial one DuckDB reads with
      // ST_Read, one row per feature with its geometry as `geom`
      const geojson = isFeatureCollection(value)
      if (!Array.isArray(value) && !geojson) {
        if (this.hostTables.delete(key)) changed = true
        continue
      }
      let file = this.tableFiles.get(value)
      if (!file) {
        file = `__host_${++this.tableCount}.${geojson ? 'geojson' : 'json'}`
        const text = geojson
          ? JSON.stringify(value)
          : JSON.stringify((value as unknown[]).map(flatRow))
        await registerFile(file, new TextEncoder().encode(text))
        this.tableFiles.set(value, file)
      }
      const query = geojson
        ? `SELECT * FROM ST_Read('${file}')`
        : `SELECT * FROM read_json_auto('${file}')`
      if (this.hostTables.get(key) !== query) {
        this.hostTables.set(key, query)
        changed = true
      }
    }
    for (const key of [...this.hostTables.keys()]) {
      if (!live.has(key) && this.hostTables.delete(key)) changed = true
    }
    return changed
  }

  /** Host operator outputs as scalar-program keys: `nodeId.out.location.lat`. */
  private hostValues(): { get(key: string): unknown } {
    const runner = this.options.host?.runner
    return {
      get: (key: string) => {
        const at = key.indexOf('.out.')
        if (!runner || at < 0) return undefined
        const [field, ...path] = key.slice(at + 5).split('.')
        let v = runner.output(key.slice(0, at), field)
        for (const p of path) v = (v as Record<string, unknown> | undefined)?.[p]
        return v
      },
    }
  }

  /**
   * Host operators. Before the planner runs, an operator that reads planner output waits
   * (`PENDING`); after it, it gets the layer it reads, or a relation's rows as JS objects.
   */
  private async runHost(afterPlanner: boolean): Promise<void> {
    const host = this.options.host
    if (!host || !this.doc) return
    if (afterPlanner) this.buildPlannerLayers()
    const report = await host.runner.run(this.doc, {
      planner: (nodeId, port) => {
        if (!afterPlanner) return PENDING
        const ir = this.lowered?.outputs[nodeId]?.[port] ?? nodeId
        const layer = this.built.get(ir)?.[0]
        return layer ?? this.rowsOf(ir)
      },
      slots: this.slots,
      time: this.time,
    })
    this.hostErrors = report.errors
    if (afterPlanner) this.emit()
  }

  private readonly rows = new Map<string, Promise<unknown[]>>()
  private readonly loadedRows = new Map<string, unknown[]>()

  /**
   * A planner node's rows if they have been read, for code that needs them now (`op()`):
   * undefined the first time, which starts the read.
   */
  peekRows(nodeId: string, port = 'out'): unknown[] | undefined {
    const ir = this.lowered?.outputs[nodeId]?.[port]
    const rel = ir ? this.runtime.program()?.relations.find(r => r.id === ir) : undefined
    if (!rel) return undefined
    const loaded = this.loadedRows.get(rel.hash)
    if (loaded) return loaded
    const pending = this.rowsOf(rel.id)
    if (pending !== PENDING) {
      void pending.then(rows => this.loadedRows.set(rel.hash, rows)).catch(() => undefined)
    }
    return undefined
  }

  /**
   * A relation's rows for a host operator that needs JS objects. Read once per relation hash,
   * so an unchanged relation is not read again; DuckDB's BIGINTs become numbers, as the rows
   * Noodles operators were written for had.
   */
  private rowsOf(relationId: string): Promise<unknown[]> | typeof PENDING {
    const rel = this.runtime.program()?.relations.find(r => r.id === relationId)
    if (!rel) return PENDING
    let rows = this.rows.get(rel.hash)
    if (!rows) {
      rows = this.runtime.relationRows(rel.ref)
      this.rows.set(rel.hash, rows)
    }
    return rows
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
      const url = ['file', 'geojson', 'code'].includes(n.op) ? String(n.params.url ?? '') : ''
      if (!url || this.registered.has(url)) continue
      if (url.startsWith('@/')) {
        if (!readAsset) continue
        await registerFile(url, await readAsset(url.slice(2)))
      } else if (n.op === 'geojson' || n.op === 'code') {
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
