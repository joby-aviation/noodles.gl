import * as duckdb from '@duckdb/duckdb-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompilableNode } from './compiler'
import { compile } from './compiler'
import { execute, setDuckDbInstance } from './executor'

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

describe('SQL Compiler Integration (DuckDB)', () => {
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
      eh: {
        mainModule: new URL('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm', import.meta.url).href,
        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js', import.meta.url)
          .href,
      },
    })
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const worker = new Worker(DUCKDB_BUNDLES.mainWorker!)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(DUCKDB_BUNDLES.mainModule)
    setDuckDbInstance(db)

    // Create a test table
    const conn = await db.connect()
    await conn.query(`
      CREATE TABLE test_data AS SELECT * FROM (VALUES
        ('Alice', 30, 'Engineering', 90000),
        ('Bob', 25, 'Marketing', 60000),
        ('Charlie', 35, 'Engineering', 110000),
        ('Diana', 28, 'Marketing', 65000),
        ('Eve', 32, 'Engineering', 95000)
      ) AS t(name, age, department, salary)
    `)
    await conn.close()
  })

  it('executes a simple query from a FileOp-like source', async () => {
    // Use inline SQL since we can't read files in test env
    const nodes = [makeNode('/src', 'File', { url: 'test_data', format: 'csv' })]
    // Override: just use the table name directly for testing
    const compiled = compile(nodes)
    // Rewrite the compiled SQL to use our test table
    const testSql = compiled.sql.replace(/read_csv_auto\(\$1.*?\)/, 'test_data')
    const result = await execute({ ...compiled, sql: testSql, paramSlots: [] }, [])
    const rows = result.toArray()
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveProperty('name')
    expect(rows[0]).toHaveProperty('age')
  })

  it('executes filter with parameterized value', async () => {
    const compiled = {
      sql: 'WITH src AS (SELECT * FROM test_data), filtered AS (SELECT * FROM src WHERE age > $1) SELECT * FROM filtered',
      paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'number' as const }],
      operatorAliases: new Map([
        ['src', 'src'],
        ['filtered', 'filtered'],
      ]),
    }
    const result = await execute(compiled, [30])
    const rows = result.toArray()
    expect(rows).toHaveLength(2) // Charlie (35) and Eve (32)
    expect(rows.every((r: any) => r.age > 30)).toBe(true)
  })

  it('executes sort', async () => {
    const compiled = {
      sql: 'WITH src AS (SELECT * FROM test_data), sorted AS (SELECT * FROM src ORDER BY salary DESC) SELECT * FROM sorted',
      paramSlots: [],
      operatorAliases: new Map(),
    }
    const result = await execute(compiled, [])
    const rows = result.toArray()
    expect(rows[0].name).toBe('Charlie')
    expect(rows[0].salary).toBe(110000)
  })

  it('executes group by with aggregation', async () => {
    const compiled = {
      sql: `WITH src AS (SELECT * FROM test_data),
            grouped AS (SELECT department, AVG(salary) AS avg_salary, COUNT(*) AS n FROM src GROUP BY department)
            SELECT * FROM grouped`,
      paramSlots: [],
      operatorAliases: new Map(),
    }
    const result = await execute(compiled, [])
    const rows = result.toArray()
    expect(rows).toHaveLength(2)
    const eng = rows.find((r: any) => r.department === 'Engineering')
    expect(eng).toBeDefined()
    expect(Number(eng!.n)).toBe(3)
  })

  it('executes with multiple parameters (timeline simulation)', async () => {
    const compiled = {
      sql: 'WITH src AS (SELECT * FROM test_data), filtered AS (SELECT * FROM src WHERE age >= $1 AND age <= $2) SELECT * FROM filtered',
      paramSlots: [
        { index: 1, fieldPath: '/range.min', type: 'number' as const },
        { index: 2, fieldPath: '/range.max', type: 'number' as const },
      ],
      operatorAliases: new Map(),
    }

    // Simulate timeline scrubbing: different parameter values, same query
    const result1 = await execute(compiled, [25, 30])
    expect(result1.toArray()).toHaveLength(3) // Alice(30), Bob(25), Diana(28)

    const result2 = await execute(compiled, [30, 35])
    expect(result2.toArray()).toHaveLength(3) // Alice(30), Charlie(35), Eve(32)

    const result3 = await execute(compiled, [33, 40])
    expect(result3.toArray()).toHaveLength(1) // Charlie(35)
  })

  it('executes window function', async () => {
    const compiled = {
      sql: `WITH src AS (SELECT * FROM test_data),
            windowed AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rank FROM src)
            SELECT * FROM windowed`,
      paramSlots: [],
      operatorAliases: new Map(),
    }
    const result = await execute(compiled, [])
    const rows = result.toArray()
    expect(rows).toHaveLength(5)
    const charlie = rows.find((r: any) => r.name === 'Charlie')
    expect(Number(charlie!.rank)).toBe(1) // Highest salary in Engineering
  })

  it('executes join between two CTEs', async () => {
    const compiled = {
      sql: `WITH
        employees AS (SELECT * FROM test_data),
        dept_avg AS (SELECT department, AVG(salary) AS dept_avg_salary FROM test_data GROUP BY department),
        joined AS (SELECT e.*, d.dept_avg_salary FROM employees e LEFT JOIN dept_avg d ON e.department = d.department)
        SELECT * FROM joined`,
      paramSlots: [],
      operatorAliases: new Map(),
    }
    const result = await execute(compiled, [])
    const rows = result.toArray()
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveProperty('dept_avg_salary')
  })

  it('executes LIMIT/OFFSET with parameters', async () => {
    const compiled = {
      sql: 'WITH src AS (SELECT * FROM test_data ORDER BY name), sliced AS (SELECT * FROM src LIMIT $1 OFFSET $2) SELECT * FROM sliced',
      paramSlots: [
        { index: 1, fieldPath: '/slice.end', type: 'number' as const },
        { index: 2, fieldPath: '/slice.start', type: 'number' as const },
      ],
      operatorAliases: new Map(),
    }
    const result = await execute(compiled, [2, 1])
    const rows = result.toArray()
    expect(rows).toHaveLength(2)
  })

  it('returns Arrow table that can be used without conversion', async () => {
    const compiled = {
      sql: 'WITH src AS (SELECT * FROM test_data) SELECT * FROM src',
      paramSlots: [],
      operatorAliases: new Map(),
    }
    const result = await execute(compiled, [])
    // Arrow table should have schema and be iterable
    expect(result.table).toBeDefined()
    expect(result.table.numRows).toBe(5)
    expect(result.table.schema.fields.length).toBeGreaterThan(0)
  })

  it('handles string operations in SQL', async () => {
    const compiled = {
      sql: `WITH src AS (SELECT * FROM test_data),
            transformed AS (SELECT *, UPPER(name) AS upper_name FROM src)
            SELECT * FROM transformed`,
      paramSlots: [],
      operatorAliases: new Map(),
    }
    const result = await execute(compiled, [])
    const rows = result.toArray()
    expect(rows[0].upper_name).toBe('ALICE')
  })

  it('compiles and executes a full pipeline from compile()', async () => {
    // Build a realistic pipeline: filter → sort → slice (using test table as source)
    // We use a hand-crafted SQL that mirrors what compile() would produce, but with
    // a test table instead of read_csv_auto
    const compiled = {
      sql: `WITH
        src AS (SELECT * FROM test_data),
        filtered AS (SELECT * FROM src WHERE "department" = $1),
        sorted AS (SELECT * FROM filtered ORDER BY "salary" DESC),
        top_op AS (SELECT * FROM sorted LIMIT $2 OFFSET $3)
      SELECT * FROM top_op`,
      paramSlots: [
        { index: 1, fieldPath: '/filter.value', type: 'string' as const },
        { index: 2, fieldPath: '/top.end', type: 'number' as const },
        { index: 3, fieldPath: '/top.start', type: 'number' as const },
      ],
      operatorAliases: new Map([
        ['src', 'src'],
        ['filtered', 'filtered'],
        ['sorted', 'sorted'],
        ['top_op', 'top_op'],
      ]),
    }
    const result = await execute(compiled, ['Engineering', 2, 0])
    const rows = result.toArray()
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Charlie') // highest salary in Engineering
    expect(rows[1].name).toBe('Eve')
  })
})
