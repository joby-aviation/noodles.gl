import { describe, it, expect, beforeAll } from 'vitest'
import * as duckdb from '@duckdb/duckdb-wasm'
import { adaptOperator, detectCompilableSubgraphs, resolveParamValues, SQLExecutionCache } from './subgraph-detector'
import { setDuckDbInstance } from './executor'
import { templateRegistry } from './templates'

// Create a mock operator with a unique constructor per type so displayName works
function makeMockOp(id: string, type: string, inputs: Record<string, unknown>): any {
  const inputFields: Record<string, { value: unknown }> = {}
  for (const [key, val] of Object.entries(inputs)) {
    inputFields[key] = { value: val }
  }
  // Each operator type gets its own constructor function so displayName is per-type
  function MockCtor() {}
  Object.defineProperty(MockCtor, 'displayName', { value: type, writable: true })
  const op = Object.create(MockCtor.prototype)
  op.id = id
  op.inputs = inputFields
  op.constructor = MockCtor
  return op
}

describe('adaptOperator', () => {
  it('adapts a compilable operator', () => {
    const op = makeMockOp('/file', 'File', { url: 'data.csv', format: 'csv' })
    const adapted = adaptOperator(op, () => [])
    expect(adapted).toBeDefined()
    expect(adapted!.id).toBe('/file')
    expect(adapted!.type).toBe('File')
    expect(adapted!.inputs.url.value).toBe('data.csv')
  })

  it('returns undefined for non-compilable operators', () => {
    const op = makeMockOp('/code', 'CodeOp', { code: 'return 1' })
    const adapted = adaptOperator(op, () => [])
    expect(adapted).toBeUndefined()
  })

  it('passes upstream IDs through', () => {
    const op = makeMockOp('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' })
    const adapted = adaptOperator(op, (id) => id === '/filter' ? ['/file'] : [])
    expect(adapted!.getUpstreamDataIds()).toEqual(['/file'])
  })
})

describe('detectCompilableSubgraphs', () => {
  const operators = new Map<string, any>()
  const upstreamMap = new Map<string, string[]>()

  beforeAll(() => {
    // Build a test graph:
    // /file → /filter → /sort → /scatterplot (non-compilable sink)
    operators.set('/file', makeMockOp('/file', 'File', { url: 'data.csv', format: 'csv' }))
    operators.set('/filter', makeMockOp('/filter', 'FilterOp', { columnName: 'age', condition: 'greater than', value: '25' }))
    operators.set('/sort', makeMockOp('/sort', 'Sort', { key: 'age', order: 'desc' }))
    operators.set('/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] }))
    operators.set('/code', makeMockOp('/code', 'CodeOp', { code: 'return data' }))

    upstreamMap.set('/filter', ['/file'])
    upstreamMap.set('/sort', ['/filter'])
    upstreamMap.set('/scatter', ['/sort'])
    upstreamMap.set('/code', ['/file'])
  })

  it('detects compilable subgraph feeding into a non-compilable sink', () => {
    const result = detectCompilableSubgraphs(
      ['/scatter'],
      id => operators.get(id),
      id => upstreamMap.get(id) || [],
    )
    // Should compile /file → /filter → /sort into one query
    expect(result.has('/sort')).toBe(true)
    const compiled = result.get('/sort')!
    expect(compiled.sql).toContain('read_csv_auto')
    expect(compiled.sql).toContain('WHERE')
    expect(compiled.sql).toContain('ORDER BY')
  })

  it('does not compile non-compilable operator chains', () => {
    const ops = new Map<string, any>([
      ['/code1', makeMockOp('/code1', 'CodeOp', { code: 'return []' })],
      ['/code2', makeMockOp('/code2', 'CodeOp', { code: 'return data' })],
    ])
    const upstream = new Map<string, string[]>([
      ['/code2', ['/code1']],
    ])
    const result = detectCompilableSubgraphs(
      ['/code2'],
      id => ops.get(id),
      id => upstream.get(id) || [],
    )
    expect(result.size).toBe(0)
  })

  it('handles mixed compilable/non-compilable chains', () => {
    // /file → /code → /filter → /sort
    // Only /filter → /sort is compilable (code breaks the chain)
    const ops = new Map<string, any>([
      ['/file', makeMockOp('/file', 'File', { url: 'x.csv', format: 'csv' })],
      ['/code', makeMockOp('/code', 'CodeOp', { code: 'return data' })],
      ['/filter', makeMockOp('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' })],
      ['/sort', makeMockOp('/sort', 'Sort', { key: 'x', order: 'asc' })],
      ['/sink', makeMockOp('/sink', 'ScatterplotLayerOp', { data: [] })],
    ])
    const upstream = new Map<string, string[]>([
      ['/code', ['/file']],
      ['/filter', ['/code']],
      ['/sort', ['/filter']],
      ['/sink', ['/sort']],
    ])
    const result = detectCompilableSubgraphs(
      ['/sink'],
      id => ops.get(id),
      id => upstream.get(id) || [],
    )
    // filter depends on code (non-compilable), so chain breaks there
    expect(result.size).toBe(0)
  })
})

describe('resolveParamValues', () => {
  it('resolves field values from operators', () => {
    const ops = new Map<string, any>([
      ['/file', makeMockOp('/file', 'File', { url: 'data.csv', format: 'csv' })],
      ['/filter', makeMockOp('/filter', 'FilterOp', { columnName: 'age', condition: 'gt', value: '30' })],
    ])
    const compiled = {
      sql: 'SELECT * FROM read_csv_auto($1) WHERE age > $2',
      paramSlots: [
        { index: 1, fieldPath: '/file.url', type: 'string' as const },
        { index: 2, fieldPath: '/filter.value', type: 'string' as const },
      ],
      operatorAliases: new Map(),
    }
    const values = resolveParamValues(compiled, id => ops.get(id))
    expect(values).toEqual(['data.csv', '30'])
  })

  it('handles missing operators gracefully', () => {
    const compiled = {
      sql: 'SELECT * WHERE x > $1',
      paramSlots: [{ index: 1, fieldPath: '/missing.value', type: 'string' as const }],
      operatorAliases: new Map(),
    }
    const values = resolveParamValues(compiled, () => undefined)
    expect(values).toEqual([''])
  })

  it('handles missing fields gracefully', () => {
    const ops = new Map<string, any>([
      ['/op', makeMockOp('/op', 'FilterOp', { columnName: 'x', condition: 'eq', value: '1' })],
    ])
    const compiled = {
      sql: 'SELECT * WHERE x > $1',
      paramSlots: [{ index: 1, fieldPath: '/op.nonexistent', type: 'string' as const }],
      operatorAliases: new Map(),
    }
    const values = resolveParamValues(compiled, id => ops.get(id))
    expect(values).toEqual([''])
  })
})

describe('SQLExecutionCache', () => {
  beforeAll(async () => {
    const DUCKDB_BUNDLES = await duckdb.selectBundle({
      mvp: {
        mainModule: new URL('@aspect-build/aspect-duckdb-wasm/dist/duckdb-mvp.wasm', import.meta.url).href,
        mainWorker: new URL('@aspect-build/aspect-duckdb-wasm/dist/duckdb-browser-mvp.worker.js', import.meta.url).href,
      },
      eh: {
        mainModule: new URL('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm', import.meta.url).href,
        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js', import.meta.url).href,
      },
    })
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const worker = new Worker(DUCKDB_BUNDLES.mainWorker!)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(DUCKDB_BUNDLES.mainModule)
    setDuckDbInstance(db)

    const conn = await db.connect()
    await conn.query(`
      CREATE TABLE cache_test AS SELECT * FROM (VALUES
        (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd'), (5, 'e')
      ) AS t(id, name)
    `)
    await conn.close()
  })

  it('caches and reuses compiled queries', async () => {
    const cache = new SQLExecutionCache()
    const compiled = {
      sql: 'WITH src AS (SELECT * FROM cache_test WHERE id > $1) SELECT * FROM src',
      paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' as const }],
      operatorAliases: new Map<string, string>(),
    }
    cache.setCompiledQuery('/sort', compiled)
    expect(cache.getCompiledQuery('/sort')).toBe(compiled)

    // Execute multiple times with same prepared statement
    const result1 = await cache.executeCompiled('/sort', compiled, [2])
    expect(result1.toArray()).toHaveLength(3)

    const result2 = await cache.executeCompiled('/sort', compiled, [4])
    expect(result2.toArray()).toHaveLength(1)

    cache.invalidate()
  })

  it('invalidate clears all cached pipelines', async () => {
    const cache = new SQLExecutionCache()
    const compiled = {
      sql: 'WITH src AS (SELECT * FROM cache_test) SELECT * FROM src',
      paramSlots: [],
      operatorAliases: new Map<string, string>(),
    }
    cache.setCompiledQuery('/a', compiled)
    cache.invalidate()
    expect(cache.getCompiledQuery('/a')).toBeUndefined()
  })

  it('handles rapid execution cycles (simulating animation)', async () => {
    const cache = new SQLExecutionCache()
    const compiled = {
      sql: 'WITH src AS (SELECT * FROM cache_test WHERE id <= $1) SELECT COUNT(*) as n FROM src',
      paramSlots: [{ index: 1, fieldPath: '/threshold.value', type: 'number' as const }],
      operatorAliases: new Map<string, string>(),
    }

    const start = performance.now()
    for (let i = 1; i <= 30; i++) {
      const result = await cache.executeCompiled('/sink', compiled, [i % 5 + 1])
      expect(result.table.numRows).toBe(1)
    }
    const elapsed = performance.now() - start
    expect(elapsed / 30).toBeLessThan(16) // Under 16ms per frame

    cache.invalidate()
  })
})
