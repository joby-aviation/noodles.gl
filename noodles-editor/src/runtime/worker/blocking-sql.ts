// The planner's SQL engine over DuckDB-Wasm's synchronous bindings: the build that runs in
// the engine worker (and in Node for tests), and the only one with JS scalar UDFs.

import type { QueryTiming, SqlEngine } from '@noodles.gl/planner'
import type { Table } from 'apache-arrow'

export interface BlockingConnection {
  query(sql: string): Table
  prepare(sql: string): { query(...binds: unknown[]): Table; close(): void }
}

export interface BlockingDb {
  registerFileText(name: string, text: string): void
  registerFileBuffer(name: string, buffer: Uint8Array): void
}

export interface BlockingSql extends SqlEngine {
  /** Make bytes readable by DuckDB under a file name. */
  registerFile(name: string, bytes: Uint8Array): void
  registerText(name: string, text: string): void
  /** Rows of a query as plain objects. */
  rows(sql: string, binds?: (number | string)[]): Promise<Record<string, unknown>[]>
  readonly counters: { executions: number; prepares: number; execs: number }
}

export function blockingSql(db: BlockingDb, conn: BlockingConnection): BlockingSql {
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
    registerFile(name, bytes) {
      db.registerFileBuffer(name, bytes)
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
