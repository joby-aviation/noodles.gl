// The engine worker: DuckDB-Wasm's synchronous build, the planner runtime over it, and (for
// JS scalar UDFs) the only place functions can be registered with DuckDB. Requests that
// arrive while DuckDB starts wait for it.

import { getJsDelivrBundles } from '@duckdb/duckdb-wasm'
import { targetCaps } from '@noodles.gl/planner'
import * as duckdb from 'duckdb-browser-blocking'
import { registerNoodlesRamps } from '../ramps'
import { type BlockingConnection, type BlockingDb, blockingSql } from './blocking-sql'
import { EngineHost } from './engine-host'
import type { Envelope, Message } from './protocol'

const scope = self as unknown as {
  postMessage(message: Message, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<Envelope>) => void) | null
}

// DuckDB's WebAssembly, over 30 MB a build: from the jsDelivr CDN where the host limits file
// sizes (Cloudflare Pages, 25 MiB), bundled otherwise. Vite drops the branch it doesn't take.
async function wasmModules(): Promise<{ mvp: string; eh: string }> {
  if (import.meta.env.VITE_USE_CDN_DUCKDB === 'true') {
    const cdn = getJsDelivrBundles()
    return { mvp: cdn.mvp.mainModule, eh: cdn.eh?.mainModule ?? cdn.mvp.mainModule }
  }
  const [mvp, eh] = await Promise.all([
    import('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url').then(m => m.default),
    import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url').then(m => m.default),
  ])
  return { mvp, eh }
}

async function start(): Promise<EngineHost> {
  // The planner evaluates ramps here, so it needs the editor's
  registerNoodlesRamps()
  const modules = await wasmModules()
  const db = (await duckdb.createDuckDB(
    {
      mvp: { mainModule: modules.mvp, mainWorker: '' },
      eh: { mainModule: modules.eh, mainWorker: '' },
    },
    new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
    duckdb.BROWSER_RUNTIME
  )) as unknown as BlockingDb & { instantiate(): Promise<void>; connect(): BlockingConnection }
  await db.instantiate()
  const conn = db.connect()
  for (const statement of ['INSTALL spatial', 'LOAD spatial', 'INSTALL json', 'LOAD json']) {
    conn.query(statement)
  }
  return new EngineHost(blockingSql(db, conn), scope, {
    caps: targetCaps('deck-webgl2', undefined),
  })
}

const host = start()
// One request at a time, in order: the runtime coalesces work itself
let chain: Promise<unknown> = Promise.resolve()
scope.onmessage = event => {
  chain = chain.then(async () => {
    try {
      await (await host).handle(event.data)
    } catch (error) {
      scope.postMessage({
        type: 'result',
        id: event.data.id,
        error: `The engine did not start: ${error instanceof Error ? error.message : error}`,
      })
    }
  })
}
