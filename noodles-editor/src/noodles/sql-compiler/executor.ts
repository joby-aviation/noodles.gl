import type * as arrow from 'apache-arrow'
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import type { AsyncDuckDBConnection, AsyncPreparedStatement } from '@duckdb/duckdb-wasm'
import type { CompiledQuery, ExecutionResult, ParamSlot } from './types'
import { attributeError, enrichErrorContext } from './error-attribution'

let duckDbInstance: AsyncDuckDB | null = null

export function setDuckDbInstance(db: AsyncDuckDB) {
  duckDbInstance = db
}

export function getDuckDbInstance(): AsyncDuckDB | null {
  return duckDbInstance
}

// Collect current parameter values from operator fields at execution time.
// This is the key function for timeline scrubbing — it reads live field values.
export function collectParamValues(
  paramSlots: ParamSlot[],
  getFieldValue: (fieldPath: string, slot?: ParamSlot) => unknown
): unknown[] {
  const values: unknown[] = new Array(paramSlots.length)
  for (let i = 0; i < paramSlots.length; i++) {
    const slot = paramSlots[i]
    // If slot has a direct value, use it (already coerced)
    if (slot.value !== undefined) {
      values[i] = slot.value
      continue
    }
    let value = getFieldValue(slot.fieldPath, slot)
    // Coerce to expected type
    switch (slot.type) {
      case 'number':
        value = Number(value)
        break
      case 'boolean':
        value = Boolean(value)
        break
      case 'json':
        value = typeof value === 'string' ? value : JSON.stringify(value)
        break
      default:
        value = String(value ?? '')
        break
    }
    values[i] = value
  }
  return values
}

// Execute a compiled query with the given parameter values.
// Returns an Arrow table (zero-copy from DuckDB).
export async function execute(
  compiled: CompiledQuery,
  paramValues: unknown[]
): Promise<ExecutionResult> {
  if (!duckDbInstance) throw new Error('DuckDB not initialized. Call setDuckDbInstance() first.')

  const conn = await duckDbInstance.connect()
  try {
    let table: arrow.Table
    if (paramValues.length > 0) {
      const stmt = await conn.prepare(compiled.sql)
      table = await stmt.query(...paramValues)
      await stmt.close()
    } else {
      table = await conn.query(compiled.sql)
    }
    return {
      table,
      toArray() {
        return table.toArray().map((row) => ({ ...row }))
      },
    }
  } catch (error) {
    // Attribute SQL errors to specific operators
    const opError = attributeError(error as Error, compiled)
    throw enrichErrorContext(opError, compiled, paramValues)
  } finally {
    await conn.close()
  }
}

// Cached prepared statement for repeated execution (timeline scrubbing)
export class PreparedPipeline {
  private conn: AsyncDuckDBConnection | null = null
  private stmt: AsyncPreparedStatement | null = null
  private _compiled: CompiledQuery

  constructor(compiled: CompiledQuery) {
    this._compiled = compiled
  }

  get compiled(): CompiledQuery {
    return this._compiled
  }

  async prepare(): Promise<void> {
    if (!duckDbInstance) throw new Error('DuckDB not initialized.')
    this.conn = await duckDbInstance.connect()
    this.stmt = await this.conn.prepare(this._compiled.sql)
  }

  async execute(paramValues: unknown[]): Promise<ExecutionResult> {
    if (!this.stmt) await this.prepare()
    try {
      const table: arrow.Table =
        paramValues.length > 0 ? await this.stmt.query(...paramValues) : await this.stmt.query()
      return {
        table,
        toArray() {
          return table.toArray().map((row) => ({ ...row }))
        },
      }
    } catch (error) {
      // Attribute SQL errors to specific operators
      const opError = attributeError(error as Error, this._compiled)
      throw enrichErrorContext(opError, this._compiled, paramValues)
    }
  }

  async close(): Promise<void> {
    if (this.stmt) {
      await this.stmt.close()
      this.stmt = null
    }
    if (this.conn) {
      await this.conn.close()
      this.conn = null
    }
  }
}
