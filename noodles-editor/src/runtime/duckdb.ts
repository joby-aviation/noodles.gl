// The one DuckDB-Wasm database the app uses, and the planner's SQL engine over it.

import * as duckdb from '@duckdb/duckdb-wasm'
import type { QueryTiming, SqlEngine } from '@noodles.gl/planner'

// The planner's Arrow types, which may be a different apache-arrow copy than DuckDB-Wasm's.
type Table = Awaited<ReturnType<SqlEngine['run']>>['table']

export const duckDbInstance: Promise<duckdb.AsyncDuckDB> = (async () => {
  // Use CDN bundles for Cloudflare Pages (which has a 25 MiB file size limit)
  // Use local bundles for development and GitHub Actions (which can access local files)
  let bundles: duckdb.DuckDBBundles

  // Use import.meta.env directly in the condition for proper tree-shaking
  if (import.meta.env.VITE_USE_CDN_DUCKDB === 'true') {
    // jsdelivr CDN hosts the large WASM files externally
    bundles = duckdb.getJsDelivrBundles()
  } else {
    // Dynamically import the WASM files only when not using CDN
    // Vite will tree-shake this entire branch when VITE_USE_CDN_DUCKDB is 'true'
    const [
      duckdb_wasm,
      mvp_worker,
      duckdb_wasm_eh,
      eh_worker,
      duckdb_wasm_coi,
      coi_worker,
      duckdb_pthread_worker,
    ] = await Promise.all([
      import('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url').then(
        m => m.default
      ),
    ])

    // Bundle the WASM files locally for environments that support it
    bundles = {
      mvp: {
        mainModule: duckdb_wasm,
        mainWorker: mvp_worker,
      },
      eh: {
        mainModule: duckdb_wasm_eh,
        mainWorker: eh_worker,
      },
      coi: {
        mainModule: duckdb_wasm_coi,
        mainWorker: coi_worker,
        pthreadWorker: duckdb_pthread_worker,
      },
    }
  }

  // Select a bundle based on browser checks
  const bundle = await duckdb.selectBundle(bundles)
  const workerUrl = bundle.mainWorker!

  // Handle cross-origin URLs by fetching and creating blob URL
  const isCrossOrigin =
    workerUrl.startsWith('http') && !workerUrl.startsWith(window.location.origin)
  const resolvedWorkerUrl = isCrossOrigin
    ? await fetch(workerUrl).then(async res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch DuckDB worker: ${res.status} ${res.statusText}`)
        }
        const blob = new Blob([await res.text()], { type: 'application/javascript' })
        return URL.createObjectURL(blob)
      })
    : workerUrl

  const worker = new Worker(resolvedWorkerUrl)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)

  const conn = await db.connect()
  await conn.query(`
    SET autoinstall_known_extensions = 1;
    INSTALL spatial;
    LOAD spatial;
    INSTALL httpfs;
    -- Not sure why but this isn't loading. For some reason it still works in the code though
    -- LOAD httpfs;
  `)
  await conn.close()

  return db
})()

/**
 * A `SqlEngine` over one long-lived connection. Temp tables (the program's memoized relations)
 * and prepared statements both belong to a connection, so neither would survive DuckDbOp's
 * open-query-close pattern. Prepared statements are cached by SQL text: a value parameter
 * change rebinds and re-executes without DuckDB planning the query again.
 */
export class DuckDbEngine implements SqlEngine {
  private prepared = new Map<string, duckdb.AsyncPreparedStatement>()

  /** Plan reuse vs re-preparation, and DDL statements, for tests and the inspector. */
  readonly counters = { prepares: 0, executions: 0, execs: 0 }

  private constructor(
    readonly db: duckdb.AsyncDuckDB,
    private readonly conn: duckdb.AsyncDuckDBConnection
  ) {}

  static async open(db: Promise<duckdb.AsyncDuckDB> = duckDbInstance): Promise<DuckDbEngine> {
    const resolved = await db
    return new DuckDbEngine(resolved, await resolved.connect())
  }

  async exec(sql: string): Promise<void> {
    this.counters.execs++
    await this.conn.query(sql)
  }

  async run(
    sql: string,
    binds: (number | string)[] = []
  ): Promise<{ table: Table; timing: QueryTiming }> {
    const started = performance.now()
    let table: Table
    if (binds.length === 0) {
      table = (await this.conn.query(sql)) as unknown as Table
    } else {
      let stmt = this.prepared.get(sql)
      if (!stmt) {
        stmt = await this.conn.prepare(sql)
        this.prepared.set(sql, stmt)
        this.counters.prepares++
      }
      table = (await stmt.query(...binds)) as unknown as Table
    }
    this.counters.executions++
    return { table, timing: { ms: performance.now() - started, rows: table.numRows } }
  }

  async describe(relation: string): Promise<Map<string, string>> {
    const { table } = await this.run(`DESCRIBE SELECT * FROM ${relation}`)
    const out = new Map<string, string>()
    for (const row of table.toArray() as { column_name: string; column_type: string }[]) {
      out.set(String(row.column_name), String(row.column_type))
    }
    return out
  }

  async release(sql: string): Promise<void> {
    const stmt = this.prepared.get(sql)
    if (!stmt) return
    this.prepared.delete(sql)
    await stmt.close()
  }

  async resetPrepared(): Promise<void> {
    for (const stmt of this.prepared.values()) await stmt.close()
    this.prepared.clear()
  }

  /** Make bytes readable by DuckDB under `name`, e.g. a project asset for `read_csv_auto`. */
  async registerFile(name: string, bytes: Uint8Array): Promise<void> {
    await this.db.registerFileBuffer(name, bytes)
  }

  async close(): Promise<void> {
    await this.resetPrepared()
    await this.conn.close()
  }
}
