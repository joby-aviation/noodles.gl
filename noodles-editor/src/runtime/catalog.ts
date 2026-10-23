/**
 * The memo: relations as DuckDB temp tables, keyed by structural hash.
 *
 * `compileProgram` hands each relation here in dependency order. A relation marked
 * `materialize` becomes `CREATE TEMP TABLE __m_<hash> AS <sql>` the first time its hash is
 * seen and is reused every time after — across recompiles, across edits elsewhere in the
 * graph, and across a slider dragged away and back, since the old value's table is still
 * here until the LRU drops it. An inlined relation is only described.
 *
 * Tables are evicted least-recently-used beyond `capacity`, never while the current program
 * references them. Dropping a table leaves any prepared statement that read it pointing at
 * nothing, so eviction tells the engine to release statements over it, via the `onDrop` hook.
 */

import {
  type Catalog,
  type CatalogEntry,
  columnTypeOf,
  listLengthsSql,
  parseListLengths,
  parseStatsRow,
  quoteIdent,
  type RelationPlan,
  type RelColumn,
  type SourceStats,
  type SqlEngine,
  statsSql,
} from '@noodles.gl/planner'

export interface CatalogCounters {
  /** Relations created by running their SQL. */
  materialized: number
  /** Relations whose table already existed: the memo working. */
  hits: number
  /** Tables dropped by the LRU. */
  dropped: number
  /** Milliseconds spent creating tables. */
  materializeMs: number
}

export interface CatalogOptions {
  /** Tables kept beyond the ones in use. Defaults to 24. */
  capacity?: number
  /** Compute per-relation statistics for the optimizer. On by default. */
  stats?: boolean
  /** Called after a table is dropped, so statements over it can be released. */
  onDrop?: (table: string) => void | Promise<void>
  /** Fills a JS table's rows (see RelationPlan.js) before its relation is described. */
  jsTables?: (rel: RelationPlan) => Promise<void>
}

interface Entry {
  table: string
  entry: CatalogEntry
  used: number
  materialized: boolean
  lengths?: Record<string, { min: number; max: number }>
}

export class MaterializingCatalog implements Catalog {
  readonly counters: CatalogCounters = { materialized: 0, hits: 0, dropped: 0, materializeMs: 0 }
  private readonly entries = new Map<string, Entry>()
  private clock = 0
  private readonly capacity: number

  constructor(
    private readonly sql: SqlEngine,
    private readonly options: CatalogOptions = {}
  ) {
    this.capacity = options.capacity ?? 24
  }

  async describe(rel: RelationPlan): Promise<CatalogEntry> {
    const existing = this.entries.get(rel.hash)
    if (existing && existing.materialized === rel.materialize) {
      existing.used = ++this.clock
      if (rel.materialize) this.counters.hits++
      return existing.entry
    }

    if (rel.js) {
      if (!this.options.jsTables) throw new Error('Code nodes run in the engine worker')
      await this.options.jsTables(rel)
    }

    let target: string
    if (rel.materialize) {
      const started = performance.now()
      await this.sql.exec(`CREATE OR REPLACE TEMP TABLE ${quoteIdent(rel.table)} AS ${rel.sql}`)
      this.counters.materializeMs += performance.now() - started
      this.counters.materialized++
      target = quoteIdent(rel.table)
    } else {
      target = `(${rel.sql})`
    }

    const described = await this.sql.describe(target)
    const columns: RelColumn[] = [...described].map(([name, duckType]) => ({
      name,
      duckType,
      type: columnTypeOf(duckType),
    }))
    let stats: SourceStats | undefined
    let rows: number | undefined
    if (rel.materialize && this.options.stats !== false) {
      // `min()::DOUBLE` fails on a string or a list, so statistics cover numeric columns only.
      const numeric = columns.filter(c => c.type === 'num').map(c => c.name)
      try {
        const { table } = await this.sql.run(statsSql(target, numeric))
        const row = table.get(0) as Record<string, unknown> | null
        if (row) {
          stats = parseStatsRow(row, numeric, described)
          rows = stats.rows
        }
      } catch {
        // approx_count_distinct is missing from some builds; the optimizer falls back to rules.
      }
    }
    const entry: CatalogEntry = { columns, stats, rows }
    this.entries.set(rel.hash, {
      table: rel.table,
      entry,
      used: ++this.clock,
      materialized: rel.materialize,
    })
    return entry
  }

  async listLengths(
    rel: RelationPlan,
    columns: string[]
  ): Promise<Record<string, { min: number; max: number }>> {
    const e = this.entries.get(rel.hash)
    if (e?.lengths) return e.lengths
    const target = rel.materialize ? quoteIdent(rel.table) : `(${rel.sql})`
    const { table } = await this.sql.run(listLengthsSql(target, columns))
    const row = table.get(0) as Record<string, unknown> | null
    const lengths = row ? parseListLengths(row, columns) : {}
    if (e) e.lengths = lengths
    return lengths
  }

  /** Whether a relation's table currently exists. */
  has(hash: string): boolean {
    return this.entries.get(hash)?.materialized ?? false
  }

  /**
   * Drop least-recently-used tables beyond capacity, sparing every hash in `inUse`. Call after
   * a compile, with the hashes of the relations the new program reads.
   */
  async evict(inUse: ReadonlySet<string>): Promise<void> {
    const candidates = [...this.entries.entries()]
      .filter(([hash, e]) => e.materialized && !inUse.has(hash))
      .sort((a, b) => a[1].used - b[1].used)
    const excess = candidates.length - this.capacity
    for (const [hash, e] of candidates.slice(0, Math.max(0, excess))) {
      await this.sql.exec(`DROP TABLE IF EXISTS ${quoteIdent(e.table)}`)
      this.entries.delete(hash)
      this.counters.dropped++
      await this.options.onDrop?.(e.table)
    }
  }

  /** Forget cached descriptions of inlined relations; tables are untouched. */
  clearInlined(): void {
    for (const [hash, e] of this.entries) if (!e.materialized) this.entries.delete(hash)
  }
}
