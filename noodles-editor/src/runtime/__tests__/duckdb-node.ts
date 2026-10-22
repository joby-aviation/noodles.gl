/**
 * A real DuckDB for node tests: duckdb-wasm's blocking Node build behind the `SqlEngine`
 * interface.
 *
 * Node could only prove the SQL backend *compiles* until now; relational lowering is the part
 * of this repo most likely to produce SQL that compiles and computes the wrong rows — a join on
 * the wrong key, an unnest that pairs a vertex with the next trip's timestamp — so the program
 * tests execute it. Startup is about 0.7 s, paid once per file.
 */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { QueryTiming, SqlEngine } from '@noodles.gl/planner'
import type { Table } from 'apache-arrow'

const require = createRequire(import.meta.url)

interface BlockingConnection {
  query(sql: string): Table
  prepare(sql: string): { query(...binds: unknown[]): Table; close(): void }
  insertArrowFromIPCStream(buffer: Uint8Array, options: { name: string; create: boolean }): void
}
interface BlockingDb {
  instantiate(): Promise<void>
  connect(): BlockingConnection
  registerFileText(name: string, text: string): void
}

export interface NodeDuck extends SqlEngine {
  /** Create (or replace) a table from an Arrow IPC stream. */
  insertArrow(name: string, ipc: Uint8Array): Promise<void>
  /** Make `text` readable as a file called `name`, e.g. by `read_csv_auto('name')`. */
  registerText(name: string, text: string): void
  /** Rows of a query as plain objects. */
  rows(sql: string, binds?: (number | string)[]): Promise<Record<string, unknown>[]>
  readonly counters: { executions: number; prepares: number; execs: number }
}

export async function openNodeDuck(): Promise<NodeDuck> {
  const dist = resolve('node_modules/@duckdb/duckdb-wasm/dist')
  const duckdb = require(`${dist}/duckdb-node-blocking.cjs`) as {
    createDuckDB(bundles: unknown, logger: unknown, runtime: unknown): Promise<BlockingDb>
    VoidLogger: new () => unknown
    NODE_RUNTIME: unknown
  }
  const db = await duckdb.createDuckDB(
    {
      mvp: {
        mainModule: `${dist}/duckdb-mvp.wasm`,
        mainWorker: `${dist}/duckdb-node-mvp.worker.cjs`,
      },
      eh: { mainModule: `${dist}/duckdb-eh.wasm`, mainWorker: `${dist}/duckdb-node-eh.worker.cjs` },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME
  )
  await db.instantiate()
  const conn = db.connect()
  // Extensions (json, spatial) load from extensions.duckdb.org on first use. A test must not
  // depend on the network, and with no network the load hangs rather than failing, so it is
  // switched off: a test that needs JSON builds its rows with SQL instead.
  conn.query('SET autoinstall_known_extensions = false')
  conn.query('SET autoload_known_extensions = false')
  const prepared = new Map<string, ReturnType<BlockingConnection['prepare']>>()
  const counters = { executions: 0, prepares: 0, execs: 0 }

  const run = async (
    sql: string,
    binds: (number | string)[] = []
  ): Promise<{ table: Table; timing: QueryTiming }> => {
    const started = performance.now()
    let table: Table
    if (binds.length === 0) {
      table = conn.query(sql)
    } else {
      let stmt = prepared.get(sql)
      if (!stmt) {
        stmt = conn.prepare(sql)
        prepared.set(sql, stmt)
        counters.prepares++
      }
      table = stmt.query(...binds)
    }
    counters.executions++
    return { table, timing: { ms: performance.now() - started, rows: table.numRows } }
  }

  return {
    counters,
    async exec(sql) {
      counters.execs++
      conn.query(sql)
    },
    run,
    async describe(relation) {
      const table = conn.query(`DESCRIBE SELECT * FROM ${relation}`)
      const out = new Map<string, string>()
      for (const row of table.toArray() as { column_name: string; column_type: string }[]) {
        out.set(String(row.column_name), String(row.column_type))
      }
      return out
    },
    async resetPrepared() {
      for (const s of prepared.values()) s.close()
      prepared.clear()
    },
    async release(sql) {
      prepared.get(sql)?.close()
      prepared.delete(sql)
    },
    async insertArrow(name, ipc) {
      conn.query(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`)
      conn.insertArrowFromIPCStream(ipc, { name, create: true })
    },
    registerText(name, text) {
      db.registerFileText(name, text)
    },
    async rows(sql, binds) {
      const { table } = await run(sql, binds)
      return (table.toArray() as { toJSON(): Record<string, unknown> }[]).map(r => r.toJSON())
    },
  }
}
