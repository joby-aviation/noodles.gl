import type * as arrow from 'apache-arrow'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { CompiledPipeline } from './types'

// Re-use the existing async duckdb instance from operators.ts.
// UDFs are NOT available in async mode (they require the blocking bindings).
// Complex JS operations (ColorRamp, custom accessors) are handled at the
// graph boundary before/after the compiled SQL runs.

let dbRef: AsyncDuckDB | null = null

export function setDuckDbInstance(db: AsyncDuckDB) {
  dbRef = db
}

async function getDb(): Promise<AsyncDuckDB> {
  if (dbRef) return dbRef
  throw new Error('DuckDB instance not set. Call setDuckDbInstance() first.')
}

export interface ExecutionResult {
  table: arrow.Table
  toArray(): Record<string, unknown>[]
}

export async function executePipeline(pipeline: CompiledPipeline): Promise<ExecutionResult> {
  const db = await getDb()
  const conn = await db.connect()

  try {
    const paramValues = pipeline.params.map(p => p.value)
    let table: arrow.Table

    if (paramValues.length > 0) {
      const stmt = await conn.prepare(pipeline.sql)
      table = await stmt.query(...paramValues)
      await stmt.close()
    } else {
      table = await conn.query(pipeline.sql)
    }

    return {
      table,
      toArray() {
        return table.toArray().map((row: any) => ({ ...row }))
      },
    }
  } finally {
    await conn.close()
  }
}

export async function executeWithParams(
  pipeline: CompiledPipeline,
  paramOverrides: Map<string, unknown>
): Promise<ExecutionResult> {
  const updatedPipeline = {
    ...pipeline,
    params: pipeline.params.map(p => ({
      ...p,
      value: paramOverrides.has(p.fieldPath) ? paramOverrides.get(p.fieldPath) : p.value,
    })),
  }
  return executePipeline(updatedPipeline)
}
