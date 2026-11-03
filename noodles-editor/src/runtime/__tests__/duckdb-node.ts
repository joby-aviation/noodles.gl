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
import {
  type BlockingConnection,
  type BlockingDb,
  type BlockingSql,
  blockingSql,
} from '../worker/blocking-sql'

const require = createRequire(import.meta.url)

interface NodeBlockingDb extends BlockingDb {
  instantiate(): Promise<void>
  connect(): BlockingConnection
}

export type NodeDuck = BlockingSql

export async function openNodeDuck(): Promise<NodeDuck> {
  const dist = resolve('node_modules/@duckdb/duckdb-wasm/dist')
  const duckdb = require(`${dist}/duckdb-node-blocking.cjs`) as {
    createDuckDB(bundles: unknown, logger: unknown, runtime: unknown): Promise<NodeBlockingDb>
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
  // Spatial, as the app loads it. The Node build caches extensions under the home directory
  // and ignores `extension_directory`, so home points at a cache in node_modules while it
  // loads: writable in CI and sandboxes, fetched from extensions.duckdb.org once, read from
  // disk after. Nothing else autoloads, so a test cannot quietly depend on the network.
  conn.query('SET autoinstall_known_extensions = false')
  conn.query('SET autoload_known_extensions = false')
  const home = process.env.HOME
  process.env.HOME = resolve('node_modules/.cache/duckdb-home')
  try {
    conn.query('INSTALL spatial')
    conn.query('LOAD spatial')
    conn.query('INSTALL json')
    conn.query('LOAD json')
  } finally {
    process.env.HOME = home
  }
  return blockingSql(db, conn)
}
