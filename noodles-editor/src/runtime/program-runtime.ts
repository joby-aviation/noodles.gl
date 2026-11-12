/**
 * The program runtime: a compiled program kept live against DuckDB.
 *
 * Two entry points, for the two speeds an editor changes things at:
 *
 *   `setGraph`   a structural edit. Recompiles — which memoization makes cost only what
 *                changed: an untouched relation is a table that already exists, an untouched
 *                layer keeps its plan and, if nothing it reads moved, its data.
 *   `setValues`  parameter values, every frame while a slider is dragged or the timeline
 *                plays. Each changed parameter is dispatched by its routes, so the work done
 *                is exactly the work the change needs:
 *
 *                  prop           re-resolve that layer's props            (synchronous)
 *                  cpu / uniform  re-run that layer's CPU stage
 *                  requery        re-run that layer's query, then its CPU stage
 *                  rematerialize  recompile: the changed relation and what reads it
 *
 * Props are applied before `setValues` returns and never wait for a query, which is why a
 * trips animation or a keyframed camera stays at frame rate while a requery is in flight
 * elsewhere. Everything slower is serialized and coalesced: if values change again while an
 * update runs, the next update starts from the latest values, not from every intermediate one.
 */

import {
  type CostConstants,
  columnsOf,
  compileProgram,
  type Expr,
  type Graph,
  type GraphNode,
  inputsOf,
  type LayerPlan,
  listComponentColumns,
  type ProgramPlan,
  parseExpr,
  quoteIdent,
  type RelColumn,
  type RelShape,
  type ResolvedProp,
  resolveProps,
  resolveView,
  rowwiseSql,
  type SqlEngine,
  type TargetCaps,
  targetCaps,
  withDerived,
} from '@noodles.gl/planner'
import { MaterializingCatalog } from './catalog'
import {
  evaluateLayer,
  type LayerData,
  type QueriedLayer,
  queryLayer,
  type StatsCache,
} from './execute'
import { plainRow, readPlainRows } from './plain-rows'
import type { BlockingSql } from './worker/blocking-sql'
import { JsTables } from './worker/js-tables'
import { UdfHost } from './worker/udf-host'

export interface LayerState {
  id: string
  plan: LayerPlan
  data?: LayerData
  props: Record<string, ResolvedProp>
  error?: string
  /** Milliseconds of the last query and CPU pass. */
  queryMs: number
  evalMs: number
}

export interface RuntimeCounters {
  compiles: number
  requeries: number
  evaluations: number
  propUpdates: number
}

export interface UpdateReport {
  kind: 'graph' | 'values'
  rematerialized: number
  requeried: string[]
  evaluated: string[]
  props: string[]
  ms: number
}

export interface RuntimeOptions {
  caps?: TargetCaps
  costs?: CostConstants
  capacity?: number
}

export interface NodeSql {
  sql: string
  shape: RelShape
  hash: string
}

export interface Preview {
  columns: RelColumn[]
  rows: Record<string, unknown>[]
  total: number
  sql?: string
  note?: string
}

type Listener = (report: UpdateReport) => void

export class ProgramRuntime {
  readonly catalog: MaterializingCatalog
  readonly counters: RuntimeCounters = { compiles: 0, requeries: 0, evaluations: 0, propUpdates: 0 }
  private readonly caps: TargetCaps
  private readonly cache = new Map<string, LayerPlan>()
  // Nodes kept compiled though nothing draws them, because someone previewed them
  private readonly kept = new Set<string>()
  private graph?: Graph
  private programPlan?: ProgramPlan
  private values: Record<string, number | string> = {}
  private readonly states = new Map<string, LayerState>()
  private readonly queried = new Map<string, QueriedLayer>()
  // Stats results reused across requeries until the relations are rebuilt
  private readonly statsCache: StatsCache = new Map()
  /** Parameter values each layer's data was produced under, to skip work that would repeat. */
  private readonly readWith = new Map<string, string>()
  private chain: Promise<unknown> = Promise.resolve()
  private pendingValues?: Record<string, number | string>
  private readonly listeners = new Set<Listener>()
  private compileError?: string
  /** Registers JS functions, when the SQL engine can (DuckDB-Wasm's synchronous build). */
  private readonly udfs?: UdfHost

  constructor(
    private readonly sql: SqlEngine,
    private readonly options: RuntimeOptions = {}
  ) {
    this.caps = options.caps ?? targetCaps('deck-webgl2', undefined)
    // DuckDB-Wasm's synchronous build runs JS: functions per row, and code nodes' tables
    const blocking = 'createNumberFunction' in sql ? (sql as BlockingSql) : undefined
    if (blocking) this.udfs = new UdfHost(blocking)
    const jsTables = blocking ? new JsTables(blocking) : undefined
    this.catalog = new MaterializingCatalog(sql, {
      capacity: options.capacity,
      jsTables: jsTables ? rel => jsTables.make(rel) : undefined,
      // A dropped table leaves any statement prepared over it stale.
      onDrop: async table => {
        jsTables?.forget(table)
        for (const s of this.states.values()) {
          if (s.plan.plan.sql.includes(table)) await this.sql.release?.(s.plan.plan.sql)
        }
      },
    })
  }

  /** A relation's rows as plain objects, decimals and 64-bit integers as numbers, its vectors as Vecs. */
  relationRows(
    relation: string,
    vectors: readonly { name: string; width: number }[] = []
  ): Promise<Record<string, unknown>[]> {
    return readPlainRows(this.sql, relation, vectors)
  }

  /** Rows of a query as plain objects. */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    const { table } = await this.sql.run(sql)
    return (table.toArray() as { toJSON(): Record<string, unknown> }[]).map(r =>
      plainRow(r.toJSON())
    )
  }

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  program(): ProgramPlan | undefined {
    return this.programPlan
  }

  error(): string | undefined {
    return this.compileError
  }

  /**
   * Buffers the runtime reads again on a later CPU pass: its query results. A layer's data can
   * share them (a column drawn as it is), so they may be copied out but never transferred.
   */
  retainedBuffers(): Set<ArrayBufferLike> {
    const out = new Set<ArrayBufferLike>()
    for (const q of this.queried.values()) {
      for (const u of q.uploads.values()) {
        if (u.data) out.add(u.data.buffer)
        if (u.hiLo) out.add(u.hiLo.buffer)
        for (const c of u.chunks ?? []) out.add(c.buffer)
      }
    }
    return out
  }

  layers(): LayerState[] {
    const order = this.programPlan?.draw ?? []
    return order.map(id => this.states.get(id)).filter((s): s is LayerState => !!s)
  }

  /** The deck view with parameter references resolved. */
  view(): Record<string, number> {
    return resolveView(this.programPlan?.deck?.view, this.values)
  }

  currentValues(): Record<string, number | string> {
    return this.values
  }

  /**
   * Another project is opening: forget its relations, plans and query results, since its files
   * can share names, and so hashes, with this one's. The next setGraph compiles from nothing.
   */
  async forget(): Promise<void> {
    await this.catalog.forget()
    this.cache.clear()
    this.queried.clear()
  }

  /** A structural edit: recompile, keeping everything memoization says is still valid. */
  setGraph(graph: Graph, values: Record<string, number | string>): Promise<UpdateReport> {
    // The graph's JS functions exist in DuckDB before anything compiles against them
    this.udfs?.register(graph.udfs)
    this.graph = graph
    this.values = { ...values }
    this.pendingValues = undefined
    return this.enqueue(() => this.rebuild('graph'))
  }

  /** New parameter values. Props apply now; queries and CPU passes are scheduled. */
  setValues(values: Record<string, number | string>): Promise<UpdateReport | undefined> {
    const program = this.programPlan
    const changed = Object.keys(values).filter(k => values[k] !== this.values[k])
    if (changed.length === 0) return Promise.resolve(undefined)
    const prev = this.values
    this.values = { ...this.values, ...values }
    const props = new Set<string>()
    let heavy = false
    for (const p of changed) {
      for (const r of program?.routes[p] ?? []) {
        if (r.route === 'prop') props.add(r.target)
        else heavy = true
      }
    }
    for (const id of props) {
      const s = this.states.get(id)
      if (s) s.props = resolveProps(s.plan.plan.layer?.props, this.values)
    }
    if (props.size) {
      this.counters.propUpdates++
      this.emit({
        kind: 'values',
        rematerialized: 0,
        requeried: [],
        evaluated: [],
        props: [...props],
        ms: 0,
      })
    }
    if (!heavy) return Promise.resolve(undefined)
    // Coalesce: an update already queued will pick up the newest values when it runs.
    if (this.pendingValues) {
      this.pendingValues = this.values
      return Promise.resolve(undefined)
    }
    this.pendingValues = this.values
    return this.enqueue(async () => {
      const latest = this.pendingValues ?? this.values
      this.pendingValues = undefined
      return this.applyValues(prev, latest)
    })
  }

  /**
   * Resolves once every queued update has run. `setValues` returns early when it coalesces into
   * an update already queued, so a caller that must see the result of its values (a video frame
   * capture) awaits this rather than the promise `setValues` returned.
   */
  idle(): Promise<void> {
    return this.chain.then(() => undefined)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work)
    this.chain = next.catch(() => undefined)
    return next
  }

  private emit(report: UpdateReport): void {
    for (const l of this.listeners) l(report)
  }

  private async rebuild(kind: 'graph' | 'values'): Promise<UpdateReport> {
    const started = performance.now()
    // Rebuilt relations may hold other rows under the same query
    this.statsCache.clear()
    const graph = this.graph
    if (!graph) throw new Error('setGraph first')
    const before = this.catalog.counters.materialized
    let program: ProgramPlan
    try {
      program = await compileProgram(graph, this.catalog, {
        caps: this.caps,
        costs: this.options.costs,
        values: this.values,
        cache: this.cache,
        keep: [...this.kept],
      })
      this.compileError = undefined
    } catch (err) {
      this.compileError = (err as Error).message
      const report: UpdateReport = {
        kind,
        rematerialized: 0,
        requeried: [],
        evaluated: [],
        props: [],
        ms: performance.now() - started,
      }
      this.emit(report)
      return report
    }
    this.counters.compiles++
    this.programPlan = program
    const requeried: string[] = []
    const evaluated: string[] = []
    const live = new Set(program.layers.map(l => l.id))
    for (const id of [...this.states.keys()]) {
      if (!live.has(id)) {
        this.states.delete(id)
        this.queried.delete(id)
        this.readWith.delete(id)
      }
    }
    for (const lp of program.layers) {
      const prev = this.states.get(lp.id)
      const signature = this.signature(lp)
      if (prev && prev.plan === lp && this.readWith.get(lp.id) === signature && prev.data) {
        prev.props = resolveProps(lp.plan.layer?.props, this.values)
        continue
      }
      if (prev && prev.plan !== lp) await this.sql.release?.(prev.plan.plan.sql)
      await this.run(lp, true)
      requeried.push(lp.id)
      evaluated.push(lp.id)
    }
    // Errors on layers that failed to compile are reported on the program; drop stale data.
    await this.catalog.evict(new Set(program.relations.map(r => r.hash)))
    const report: UpdateReport = {
      kind,
      rematerialized: this.catalog.counters.materialized - before,
      requeried,
      evaluated,
      props: [],
      ms: performance.now() - started,
    }
    this.emit(report)
    return report
  }

  private async applyValues(
    prev: Record<string, number | string>,
    values: Record<string, number | string>
  ): Promise<UpdateReport> {
    const program = this.programPlan
    if (!program) return this.rebuild('values')
    const changed = Object.keys(values).filter(k => values[k] !== prev[k])
    const routes = changed.flatMap(p => program.routes[p] ?? [])
    if (routes.some(r => r.route === 'rematerialize')) {
      // New relation hashes; the rebuild requeries exactly the layers whose inputs moved.
      return this.rebuild('values')
    }
    const started = performance.now()
    const requery = new Set(routes.filter(r => r.route === 'requery').map(r => r.target))
    const evaluate = new Set(
      routes.filter(r => r.route === 'cpu' || r.route === 'uniform').map(r => r.target)
    )
    for (const id of requery) evaluate.delete(id)
    for (const lp of program.layers) {
      if (requery.has(lp.id)) await this.run(lp, true)
      else if (evaluate.has(lp.id)) await this.run(lp, false)
    }
    const report: UpdateReport = {
      kind: 'values',
      rematerialized: 0,
      requeried: [...requery],
      evaluated: [...requery, ...evaluate],
      props: [],
      ms: performance.now() - started,
    }
    this.emit(report)
    return report
  }

  /** The values of the parameters a layer's query and CPU stage read. */
  private signature(lp: LayerPlan): string {
    const reads = Object.entries(this.programPlan?.routes ?? {})
      .filter(([, rs]) => rs.some(r => r.target === lp.id && r.route !== 'prop'))
      .map(([p]) => p)
      .sort()
    return JSON.stringify(reads.map(p => this.values[p]))
  }

  private async run(lp: LayerPlan, query: boolean): Promise<void> {
    const state: LayerState = this.states.get(lp.id) ?? {
      id: lp.id,
      plan: lp,
      props: {},
      queryMs: 0,
      evalMs: 0,
    }
    state.plan = lp
    try {
      let q = this.queried.get(lp.id)
      if (query || !q) {
        q = await queryLayer(this.sql, lp, this.values, this.statsCache)
        this.queried.set(lp.id, q)
        this.counters.requeries++
        state.queryMs = q.queryMs
      }
      state.data = evaluateLayer(lp, q, this.values)
      this.counters.evaluations++
      state.evalMs = state.data.evalMs
      state.error = undefined
      this.readWith.set(lp.id, this.signature(lp))
    } catch (err) {
      state.error = (err as Error).message
      state.data = undefined
    }
    state.props = resolveProps(lp.plan.layer?.props, this.values)
    this.states.set(lp.id, state)
  }

  // A node nothing draws is not compiled: compile it now, and keep it so it stays readable
  private async compiled(nodeId: string): Promise<void> {
    if (this.programPlan?.nodes[nodeId]?.role === 'dead' && !this.kept.has(nodeId)) {
      this.kept.add(nodeId)
      await this.enqueue(() => this.rebuild('graph'))
    }
  }

  /**
   * A SELECT of the rows at a node and their shape, for a statistic of them (a camera fit's
   * extent): its relation, or the row-wise nodes over it lowered to SQL. `hash` changes when
   * the rows can. With `columns`, only the filters and the attributes those columns need are
   * lowered: a color ramp with no SQL form, say, does not stop a count of the rows.
   */
  async nodeSql(nodeId: string, columns?: string[]): Promise<NodeSql | undefined> {
    await this.compiled(nodeId)
    const program = this.programPlan
    const graph = this.graph
    const relationId = program?.nodes[nodeId]?.relation
    const relation = program?.relations.find(r => r.id === relationId)
    if (!program || !graph || !relation) return undefined
    if (relation.id === nodeId) {
      return { sql: `SELECT * FROM ${relation.ref}`, shape: relation.shape, hash: relation.hash }
    }
    const byId = new Map(graph.nodes.map(n => [n.id, n]))
    const chain: GraphNode[] = []
    const walk = (id: string) => {
      if (id === relation.id || chain.some(n => n.id === id)) return
      const n = byId.get(id)
      if (!n) return
      for (const i of inputsOf(n)) walk(i)
      chain.push(n)
    }
    walk(nodeId)
    const lowered = columns ? neededChain(chain, columns) : chain
    const { sql, vectors, params } = rowwiseSql(
      lowered,
      relation.ref,
      relation.shape,
      this.values,
      graph,
      nodeId
    )
    const values = params.map(k => `${k}=${this.values[k]}`)
    return {
      sql,
      shape: { columns: relation.shape.columns, vectors },
      hash: `${relation.hash}:${lowered.map(n => n.id).join(',')}:${values.join(',')}`,
    }
  }

  /**
   * Rows at a node, for the spreadsheet. A relation is read directly; a row-wise node is
   * lowered to SQL over its relation when it can be, and otherwise shows its relation's rows
   * with a note saying why.
   */
  async preview(nodeId: string, limit = 100): Promise<Preview> {
    await this.compiled(nodeId)
    const program = this.programPlan
    const graph = this.graph
    if (!program || !graph) return { columns: [], rows: [], total: 0, note: 'not compiled yet' }
    const info = program.nodes[nodeId]
    const relation = info?.relation
      ? program.relations.find(r => r.id === info.relation)
      : undefined
    const layer = this.states.get(nodeId)
    if (layer) {
      const lp = layer.plan
      const bound = withDerived(lp.plan, this.values)
      const binds = lp.plan.sqlParams.map(p => bound[p])
      return this.read(
        `SELECT * FROM (${lp.plan.sql}) LIMIT ${limit}`,
        `SELECT count(*) AS n FROM (${lp.plan.sql})`,
        binds,
        lp.plan.sql,
        'the layer query, before its CPU stage'
      )
    }
    if (!relation)
      return { columns: [], rows: [], total: 0, note: info?.error ?? 'this node has no rows' }
    // A list read as a vector shows as the list, not as its component columns too; a table's
    // row numbers, which its keyframed cells are matched by, are not its data
    const rowNumbers = relation?.shape.columns.some(c => c.name === '__row') ? ['__row'] : []
    const star = (vectorParts: string[]) => {
      const hidden = [...vectorParts, ...rowNumbers]
      return hidden.length ? `* EXCLUDE (${hidden.map(quoteIdent).join(', ')})` : '*'
    }
    const all = star(listComponentColumns(relation.shape))
    if (relation.id === nodeId) {
      return this.read(
        `SELECT ${all} FROM ${relation.ref} LIMIT ${limit}`,
        `SELECT count(*) AS n FROM ${relation.ref}`,
        [],
        relation.sql
      )
    }
    const byId = new Map(graph.nodes.map(n => [n.id, n]))
    const chain: GraphNode[] = []
    const walk = (id: string) => {
      if (id === relation.id || chain.some(n => n.id === id)) return
      const n = byId.get(id)
      if (!n) return
      for (const i of inputsOf(n)) walk(i)
      chain.push(n)
    }
    walk(nodeId)
    try {
      const { sql, vectors } = rowwiseSql(
        chain,
        relation.ref,
        relation.shape,
        this.values,
        graph,
        'the spreadsheet'
      )
      return this.read(
        `SELECT ${star(listComponentColumns(relation.shape, vectors))} FROM (${sql}) LIMIT ${limit}`,
        `SELECT count(*) AS n FROM (${sql})`,
        [],
        sql
      )
    } catch (err) {
      const fallback = await this.read(
        `SELECT ${all} FROM ${relation.ref} LIMIT ${limit}`,
        `SELECT count(*) AS n FROM ${relation.ref}`,
        [],
        relation.sql
      )
      return { ...fallback, note: `showing ${quoteIdent(relation.id)}: ${(err as Error).message}` }
    }
  }

  private async read(
    sql: string,
    count: string,
    binds: (number | string)[],
    shown: string,
    note?: string
  ): Promise<Preview> {
    const { table } = await this.sql.run(sql, binds)
    const { table: n } = await this.sql.run(count, binds)
    // Plain values: lists and structs as arrays and objects, so the rows can leave the worker
    const rows = (table.toArray() as { toJSON(): Record<string, unknown> }[]).map(r =>
      plainRow(r.toJSON())
    )
    const columns: RelColumn[] = table.schema.fields.map(f => ({
      name: f.name,
      duckType: String(f.type),
      type: /^(List|FixedSizeList|Struct|Map)/.test(String(f.type))
        ? 'other'
        : /Utf8/.test(String(f.type))
          ? 'str'
          : /Float|Int|Decimal|Bool/.test(String(f.type))
            ? 'num'
            : 'other',
    }))
    return {
      columns,
      rows,
      total: Number((n.get(0) as { n: unknown } | null)?.n ?? rows.length),
      sql: shown,
      note,
    }
  }
}

// The row-wise nodes a statistic of `columns` needs: every filter, as it decides which rows
// there are, and the attributes that make those columns, with what they read in turn
function neededChain(chain: GraphNode[], columns: string[]): GraphNode[] {
  const needed = new Set(columns)
  const kept: GraphNode[] = []
  for (const n of [...chain].reverse()) {
    const name = (n as { name?: unknown }).name
    const filter = n.type === 'filter'
    if (!filter && !(n.type === 'attribute' && typeof name === 'string' && needed.has(name))) {
      continue
    }
    kept.unshift(n)
    const text = filter ? n.predicate : (n as { expr: unknown }).expr
    try {
      const tree = typeof text === 'string' ? parseExpr(text) : (text as Expr)
      for (const c of columnsOf(tree)) needed.add(c)
    } catch {
      // A predicate the parser cannot read keeps its node and adds nothing
    }
  }
  return kept
}
