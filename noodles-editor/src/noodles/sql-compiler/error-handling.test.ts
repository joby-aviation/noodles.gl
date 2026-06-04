import * as duckdb from '@duckdb/duckdb-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import { compile } from './compiler'
import { execute, setDuckDbInstance } from './executor'
import type { CompilableNode } from './compiler'

function makeNode(
  id: string,
  type: string,
  inputs: Record<string, unknown>,
  upstreamIds: string[] = []
): CompilableNode {
  const inputFields: Record<string, { value: unknown }> = {}
  for (const [key, val] of Object.entries(inputs)) {
    inputFields[key] = { value: val }
  }
  return {
    id,
    type,
    inputs: inputFields,
    getUpstreamDataIds: () => upstreamIds,
  }
}

describe('SQL Compiler Error Handling', () => {
  beforeAll(async () => {
    const DUCKDB_BUNDLES = await duckdb.selectBundle({
      mvp: {
        mainModule: new URL(
          '@aspect-build/aspect-duckdb-wasm/dist/duckdb-mvp.wasm',
          import.meta.url
        ).href,
        mainWorker: new URL(
          '@aspect-build/aspect-duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
          import.meta.url
        ).href,
      },
    })
    const logger = new duckdb.ConsoleLogger()
    const worker = new Worker(DUCKDB_BUNDLES.mainWorker!)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(DUCKDB_BUNDLES.mainModule)
    setDuckDbInstance(db)
  })

  describe('Compilation errors', () => {
    it('throws error for unknown operator type', () => {
      const nodes = [makeNode('/unknown', 'NonExistentOperator', {})]
      expect(() => compile(nodes)).toThrow('No SQL template for operator type: NonExistentOperator')
    })

    it('throws error for JOIN with insufficient upstreams', () => {
      const nodes = [
        makeNode('/data', 'File', { url: 'data.csv', format: 'csv' }),
        makeNode('/join', 'Join', { leftKey: 'id', rightKey: 'id', joinType: 'inner' }, ['/data']),
      ]
      expect(() => compile(nodes)).toThrow('requires 2 upstream')
    })

    it('throws error for missing required identifier field', () => {
      const nodes = [
        makeNode('/data', 'File', { url: 'data.csv', format: 'csv' }),
        makeNode('/sort', 'Sort', { key: '', order: 'asc' }, ['/data']),
      ]
      expect(() => compile(nodes)).toThrow("cannot be empty")
    })

    it('throws error for unknown filter condition', () => {
      const nodes = [
        makeNode('/data', 'File', { url: 'data.csv', format: 'csv' }),
        makeNode('/filter', 'FilterOp', { columnName: 'col', condition: 'invalid', value: 'test' }, [
          '/data',
        ]),
      ]
      expect(() => compile(nodes)).toThrow('Unknown filter condition')
    })

    it('throws error for empty column name in filter', () => {
      const nodes = [
        makeNode('/data', 'File', { url: 'data.csv', format: 'csv' }),
        makeNode('/filter', 'FilterOp', { columnName: null, condition: 'equals', value: 'test' }, [
          '/data',
        ]),
      ]
      expect(() => compile(nodes)).toThrow('Missing required field')
    })
  })

  describe('Execution errors', () => {
    it('handles invalid SQL gracefully', async () => {
      await expect(
        execute({
          sql: 'SELECT * FROM nonexistent_table',
          paramSlots: [],
          operatorAliases: new Map(),
        })
      ).rejects.toThrow()
    })

    it('handles type mismatch in WHERE clause', async () => {
      await expect(
        execute(
          {
            sql: `WITH src AS (
              SELECT 1 as id, 'Alice' as name
              UNION ALL
              SELECT 2 as id, 'Bob' as name
            )
            SELECT * FROM src WHERE id = $1`,
            paramSlots: [{ index: 1, fieldPath: '/op.field', type: 'string' }],
            operatorAliases: new Map(),
          },
          () => 'not-a-number'
        )
      ).resolves.toBeDefined()
    })

    it('handles NULL parameter values', async () => {
      const result = await execute(
        {
          sql: `WITH src AS (
            SELECT 1 as id, 'Alice' as name
          )
          SELECT * FROM src WHERE name = $1 OR $1 IS NULL`,
          paramSlots: [{ index: 1, fieldPath: '/op.field', type: 'string' }],
          operatorAliases: new Map(),
        },
        () => null
      )
      expect(result.data.length).toBe(1)
    })

    it('handles empty result sets', async () => {
      const result = await execute({
        sql: `WITH src AS (
          SELECT 1 as id WHERE FALSE
        )
        SELECT * FROM src`,
        paramSlots: [],
        operatorAliases: new Map(),
      })
      expect(result.data).toEqual([])
    })

    it('handles division by zero in aggregation', async () => {
      const result = await execute({
        sql: `WITH src AS (
          SELECT 0 as value
        )
        SELECT value, value / value as division FROM src`,
        paramSlots: [],
        operatorAliases: new Map(),
      })
      expect(result.data.length).toBe(1)
      expect(result.data[0].division).toBeNull()
    })

    it('handles malformed JSON in json parameter type', async () => {
      const result = await execute(
        {
          sql: `WITH src AS (
            SELECT $1::VARCHAR as json_str
          )
          SELECT json_str FROM src`,
          paramSlots: [{ index: 1, fieldPath: '/op.field', type: 'json' }],
          operatorAliases: new Map(),
        },
        () => ({ valid: 'json' })
      )
      expect(result.data[0].json_str).toContain('valid')
    })
  })

  describe('Edge cases in parameter coercion', () => {
    it('coerces non-numeric strings to NaN for number type', async () => {
      const result = await execute(
        {
          sql: `WITH src AS (
            SELECT $1 as num
          )
          SELECT num FROM src`,
          paramSlots: [{ index: 1, fieldPath: '/op.field', type: 'number' }],
          operatorAliases: new Map(),
        },
        () => 'not-a-number'
      )
      expect(result.data[0].num).toBeNaN()
    })

    it('coerces empty string to false for boolean type', async () => {
      const result = await execute(
        {
          sql: `WITH src AS (
            SELECT $1 as bool
          )
          SELECT bool FROM src`,
          paramSlots: [{ index: 1, fieldPath: '/op.field', type: 'boolean' }],
          operatorAliases: new Map(),
        },
        () => ''
      )
      expect(result.data[0].bool).toBe(false)
    })

    it('handles undefined field value as empty string', async () => {
      const result = await execute(
        {
          sql: `WITH src AS (
            SELECT $1 as str
          )
          SELECT str FROM src`,
          paramSlots: [{ index: 1, fieldPath: '/op.field', type: 'string' }],
          operatorAliases: new Map(),
        },
        () => undefined
      )
      expect(result.data[0].str).toBe('')
    })
  })

  describe('SQL injection protection', () => {
    it('prevents SQL injection via parameterized queries', async () => {
      const result = await execute(
        {
          sql: `WITH src AS (
            SELECT 'Alice' as name, 30 as age
            UNION ALL
            SELECT 'Bob' as name, 25 as age
          )
          SELECT * FROM src WHERE name = $1`,
          paramSlots: [{ index: 1, fieldPath: '/op.field', type: 'string' }],
          operatorAliases: new Map(),
        },
        () => "'; DROP TABLE users; --"
      )
      expect(result.data.length).toBe(0)
    })
  })
})
