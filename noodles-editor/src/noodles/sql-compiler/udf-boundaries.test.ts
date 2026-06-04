import { describe, it, expect, beforeAll } from 'vitest'
import * as duckdb from '@duckdb/duckdb-wasm'
import { execute, setDuckDbInstance, getDuckDbInstance } from './executor'
import { templateRegistry } from './templates'
import { collectSubgraph, isCompilable, compile } from './compiler'
import type { CompilableNode } from './compiler'
import type { CompiledQuery } from './types'

// Phase 5: UDF / Boundary Operator Exploration
//
// Decision: Use Path B (design around AsyncDuckDB's UDF limitation).
//
// AsyncDuckDB (worker mode) does NOT support createScalarFunction() because
// JS functions can't be serialized across worker boundaries. Moving DuckDB
// to the main thread would block UI rendering during queries.
//
// Boundary classification:
//   - ColorRampOp: per-row d3 interpolation, remains JS boundary
//   - AccessorOp: function generator, fundamentally incompatible with SQL
//   - ExpressionOp: arbitrary JS, remains boundary (could detect pure subsets later)
//   - BezierCurveOp: pure math, can use CREATE MACRO (SQL-only, no JS callback)
//   - All Deck.gl layers: consume data, produce layer props (always JS)
//
// The SQL chain breaks at these operators. Each SQL segment compiles independently.
// Boundary operators receive Arrow Tables (or .toArray() for POJO consumers).

function makeNode(id: string, type: string, inputs: Record<string, unknown>, upstreamIds: string[] = []): CompilableNode {
  const inputFields: Record<string, { value: unknown }> = {}
  for (const [key, val] of Object.entries(inputs)) {
    inputFields[key] = { value: val }
  }
  return { id, type, inputs: inputFields, getUpstreamDataIds: () => upstreamIds }
}

describe('UDF Boundary Architecture', () => {
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
      CREATE TABLE udf_test AS SELECT * FROM (VALUES
        (1, 0.0::DOUBLE), (2, 0.25::DOUBLE), (3, 0.5::DOUBLE), (4, 0.75::DOUBLE), (5, 1.0::DOUBLE)
      ) AS t(id, factor)
    `)
    await conn.close()
  })

  describe('Boundary operators are not compilable', () => {
    it('CodeOp is not compilable', () => {
      const node = makeNode('/code', 'CodeOp', { code: 'return data' })
      expect(isCompilable(node)).toBe(false)
    })

    it('AccessorOp is not compilable', () => {
      const node = makeNode('/acc', 'AccessorOp', { expression: 'd.x' })
      expect(isCompilable(node)).toBe(false)
    })

    it('ExpressionOp is not compilable', () => {
      const node = makeNode('/expr', 'ExpressionOp', { expression: 'data.length' })
      expect(isCompilable(node)).toBe(false)
    })

    it('ColorRampOp is not compilable', () => {
      const node = makeNode('/ramp', 'ColorRampOp', { colorScheme: 'viridis' })
      expect(isCompilable(node)).toBe(false)
    })

    it('ScatterplotLayerOp is not compilable', () => {
      const node = makeNode('/scatter', 'ScatterplotLayerOp', { data: [] })
      expect(isCompilable(node)).toBe(false)
    })

    it('DeckRendererOp is not compilable', () => {
      const node = makeNode('/deck', 'DeckRendererOp', {})
      expect(isCompilable(node)).toBe(false)
    })
  })

  describe('Chain breaks at boundary operators', () => {
    it('collectSubgraph stops when hitting CodeOp', () => {
      const nodes = new Map<string, CompilableNode>([
        ['/file', makeNode('/file', 'File', { url: 'x.csv', format: 'csv' })],
        ['/code', makeNode('/code', 'CodeOp', { code: 'return data' }, ['/file'])],
        ['/filter', makeNode('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }, ['/code'])],
      ])

      const subgraph = collectSubgraph('/filter', (id) => nodes.get(id))
      // FilterOp depends on CodeOp (non-compilable), chain breaks
      expect(subgraph.length).toBe(0)
    })

    it('collectSubgraph compiles chain before boundary', () => {
      const nodes = new Map<string, CompilableNode>([
        ['/file', makeNode('/file', 'File', { url: 'x.csv', format: 'csv' })],
        ['/filter', makeNode('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }, ['/file'])],
        ['/sort', makeNode('/sort', 'Sort', { key: 'x', order: 'asc' }, ['/filter'])],
      ])

      const subgraph = collectSubgraph('/sort', (id) => nodes.get(id))
      expect(subgraph.length).toBe(3) // file, filter, sort
      expect(subgraph.map(n => n.type)).toEqual(['File', 'FilterOp', 'Sort'])
    })

    it('two compilable segments separated by CodeOp produce independent queries', () => {
      // Segment 1: FileOp → FilterOp (compiles)
      const seg1Nodes = [
        makeNode('/file', 'File', { url: 'data.csv', format: 'csv' }),
        makeNode('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }, ['/file']),
      ]
      const compiled1 = compile(seg1Nodes)
      expect(compiled1.sql).toContain('read_csv_auto')
      expect(compiled1.sql).toContain('WHERE')

      // Segment 2: SortOp → SliceOp (would compile if given upstream)
      // In practice, after the CodeOp boundary, the second segment
      // receives data as a table reference injected by the graph executor
      const seg2Nodes = [
        makeNode('/sort', 'Sort', { key: 'y', order: 'desc' }),
        makeNode('/slice', 'Slice', { start: '0', end: '10' }, ['/sort']),
      ]
      const compiled2 = compile(seg2Nodes)
      expect(compiled2.sql).toContain('ORDER BY')
      expect(compiled2.sql).toContain('LIMIT')
    })
  })

  describe('SQL MACRO workaround for pure-math operators', () => {
    it('cubic bezier can be expressed as a DuckDB MACRO', async () => {
      const db = getDuckDbInstance()!
      const conn = await db.connect()

      // Register cubic bezier as a SQL macro (works in async mode!)
      await conn.query(`
        CREATE OR REPLACE MACRO cubic_bezier(t, p0, p1, p2, p3) AS
          (1-t)*(1-t)*(1-t)*p0 + 3*(1-t)*(1-t)*t*p1 + 3*(1-t)*t*t*p2 + t*t*t*p3
      `)
      await conn.close()

      // Use the macro in a compiled query
      const result = await execute({
        sql: `WITH src AS (SELECT * FROM udf_test)
              SELECT *, cubic_bezier(factor, 0.0, 0.3, 0.7, 1.0) AS bezier_val
              FROM src ORDER BY id`,
        paramSlots: [],
        operatorAliases: new Map(),
      }, [])

      const rows = result.toArray()
      expect(rows.length).toBe(5)
      // factor=0 → bezier_val=0, factor=1 → bezier_val=1
      expect(Number(rows[0].bezier_val)).toBeCloseTo(0, 5)
      expect(Number(rows[4].bezier_val)).toBeCloseTo(1, 5)
      // factor=0.5 → should be between 0 and 1
      expect(Number(rows[2].bezier_val)).toBeGreaterThan(0)
      expect(Number(rows[2].bezier_val)).toBeLessThan(1)
    })

    it('bezier macro performs well on 10K rows', async () => {
      const db = getDuckDbInstance()!
      const conn = await db.connect()
      await conn.query(`
        CREATE OR REPLACE MACRO cubic_bezier(t, p0, p1, p2, p3) AS
          (1-t)*(1-t)*(1-t)*p0 + 3*(1-t)*(1-t)*t*p1 + 3*(1-t)*t*t*p2 + t*t*t*p3
      `)
      await conn.query(`
        CREATE OR REPLACE TABLE bezier_perf AS
        SELECT i::FLOAT / 10000 AS t FROM generate_series(0, 9999) AS s(i)
      `)
      await conn.close()

      const start = performance.now()
      const result = await execute({
        sql: `SELECT t, cubic_bezier(t, 0.0, 0.42, 0.58, 1.0) AS eased FROM bezier_perf`,
        paramSlots: [],
        operatorAliases: new Map(),
      }, [])
      const elapsed = performance.now() - start

      expect(result.table.numRows).toBe(10000)
      expect(elapsed).toBeLessThan(50)
    })

    it('linear interpolation macro (for color ramp approximation)', async () => {
      const db = getDuckDbInstance()!
      const conn = await db.connect()
      await conn.query(`
        CREATE OR REPLACE MACRO lerp(t, a, b) AS a + t * (b - a)
      `)
      await conn.close()

      const result = await execute({
        sql: `WITH src AS (SELECT * FROM udf_test)
              SELECT *, lerp(factor, 0, 255)::INTEGER AS intensity FROM src ORDER BY id`,
        paramSlots: [],
        operatorAliases: new Map(),
      }, [])

      const rows = result.toArray()
      expect(rows[0].intensity).toBe(0)     // factor=0 → 0
      expect(rows[4].intensity).toBe(255)   // factor=1 → 255
      expect(rows[2].intensity).toBeGreaterThanOrEqual(127) // factor=0.5 → 127 or 128
      expect(rows[2].intensity).toBeLessThanOrEqual(128)
    })
  })

  describe('AsyncDuckDB UDF limitation verification', () => {
    it('confirms createScalarFunction is not available on async connection', async () => {
      const db = getDuckDbInstance()!
      const conn = await db.connect()
      // The async connection doesn't expose createScalarFunction
      expect((conn as any).createScalarFunction).toBeUndefined()
      await conn.close()
    })

    it('CREATE MACRO works as UDF alternative', async () => {
      const db = getDuckDbInstance()!
      const conn = await db.connect()
      await conn.query(`CREATE OR REPLACE MACRO double_val(x) AS x * 2`)
      const result = await conn.query(`SELECT double_val(21) AS answer`)
      const rows = result.toArray()
      expect(rows[0].answer).toBe(42)
      await conn.close()
    })
  })
})
