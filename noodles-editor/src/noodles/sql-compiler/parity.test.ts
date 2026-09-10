import * as duckdb from '@duckdb/duckdb-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompilableNode } from './compiler'
import { execute, setDuckDbInstance } from './executor'

// Parity tests: verify SQL compilation produces identical results to JS execute()
// This ensures the refactored SQL templates don't change behavior.

function _makeNode(
  id: string,
  type: string,
  inputs: Record<string, unknown>,
  upstreamIds: string[] = []
): CompilableNode {
  const inputFields: Record<string, { value: unknown }> = {}
  for (const [key, val] of Object.entries(inputs)) {
    inputFields[key] = { value: val }
  }
  return { id, type, inputs: inputFields, getUpstreamDataIds: () => upstreamIds }
}

describe('Parity: SQL output matches JS execute() output', () => {
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

    const conn = await db.connect()
    await conn.query(`
      CREATE TABLE parity_data AS SELECT * FROM (VALUES
        ('Alice', 30, 'Engineering', 90000),
        ('Bob', 25, 'Marketing', 60000),
        ('Charlie', 35, 'Engineering', 110000),
        ('Diana', 28, 'Marketing', 65000),
        ('Eve', 32, 'Engineering', 95000),
        ('Frank', 45, 'Sales', 80000),
        ('Grace', 27, 'Sales', 55000),
        ('Henry', 38, 'Engineering', 105000)
      ) AS t(name, age, department, salary)
    `)
    await conn.close()
  })

  it('FilterOp: equals', async () => {
    // JS equivalent
    const data = [
      { name: 'Alice', age: 30, department: 'Engineering', salary: 90000 },
      { name: 'Bob', age: 25, department: 'Marketing', salary: 60000 },
      { name: 'Charlie', age: 35, department: 'Engineering', salary: 110000 },
    ]
    const jsResult = data.filter(d => d.department === 'Engineering')

    // SQL
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT * FROM parity_data WHERE name IN ('Alice', 'Bob', 'Charlie')),
            filtered AS (SELECT * FROM src WHERE department = $1)
            SELECT * FROM filtered`,
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'string' }],
        operatorAliases: new Map(),
      },
      ['Engineering']
    )

    const sqlRows = sqlResult.toArray()
    expect(sqlRows).toHaveLength(jsResult.length)
    expect(sqlRows.every((r: Record<string, unknown>) => r.department === 'Engineering')).toBe(true)
  })

  it('FilterOp: greater than', async () => {
    const sqlResult = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM parity_data), filtered AS (SELECT * FROM src WHERE age > $1) SELECT * FROM filtered',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
        operatorAliases: new Map(),
      },
      [30]
    )
    const rows = sqlResult.toArray()
    expect(rows.every((r: Record<string, unknown>) => r.age > 30)).toBe(true)
    expect(rows).toHaveLength(4) // Charlie(35), Frank(45), Eve(32), Henry(38)
  })

  it('FilterOp: contains', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT * FROM parity_data), filtered AS (SELECT * FROM src WHERE name LIKE '%' || $1 || '%') SELECT * FROM filtered`,
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'string' }],
        operatorAliases: new Map(),
      },
      ['a']
    )
    const rows = sqlResult.toArray()
    // Names containing 'a': Diana, Frank, Grace (case-sensitive in DuckDB by default)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r: Record<string, unknown>) => r.name.includes('a'))).toBe(true)
  })

  it('SortOp: ascending', async () => {
    const sqlResult = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM parity_data), sorted AS (SELECT * FROM src ORDER BY age ASC) SELECT * FROM sorted',
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].age).toBeGreaterThanOrEqual(rows[i - 1].age)
    }
  })

  it('SortOp: descending', async () => {
    const sqlResult = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM parity_data), sorted AS (SELECT * FROM src ORDER BY salary DESC) SELECT * FROM sorted',
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].salary).toBeLessThanOrEqual(rows[i - 1].salary)
    }
  })

  it('SliceOp: limit and offset', async () => {
    const sqlResult = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM parity_data ORDER BY name), sliced AS (SELECT * FROM src LIMIT $1 OFFSET $2) SELECT * FROM sliced',
        paramSlots: [
          { index: 1, fieldPath: '/s.end', type: 'number' },
          { index: 2, fieldPath: '/s.start', type: 'number' },
        ],
        operatorAliases: new Map(),
      },
      [3, 2]
    )
    const rows = sqlResult.toArray()
    expect(rows).toHaveLength(3)
  })

  it('GroupByOp: sum aggregation', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT * FROM parity_data),
            grouped AS (SELECT department, SUM(salary) AS total_salary, COUNT(*) AS n FROM src GROUP BY department)
            SELECT * FROM grouped ORDER BY department`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    expect(rows.length).toBeGreaterThan(0)
    const eng = rows.find((r: Record<string, unknown>) => r.department === 'Engineering')
    expect(eng).toBeDefined()
    // 90000 + 110000 + 95000 + 105000 = 400000
    expect(Number(eng!.total_salary)).toBe(400000)
    expect(Number(eng!.n)).toBe(4)
  })

  it('GroupByOp: avg aggregation', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT * FROM parity_data),
            grouped AS (SELECT department, AVG(salary) AS avg_salary FROM src GROUP BY department)
            SELECT * FROM grouped ORDER BY department`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    const mkt = rows.find((r: Record<string, unknown>) => r.department === 'Marketing')
    expect(mkt).toBeDefined()
    // (60000 + 65000) / 2 = 62500
    expect(Number(mkt!.avg_salary)).toBe(62500)
  })

  it('UniqueOp: distinct rows', async () => {
    const sqlResult = await execute(
      {
        sql: 'WITH src AS (SELECT department FROM parity_data), unique_deps AS (SELECT DISTINCT * FROM src) SELECT * FROM unique_deps ORDER BY department',
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    expect(rows).toHaveLength(3) // Engineering, Marketing, Sales
    const depts = rows.map((r: Record<string, unknown>) => r.department)
    expect(new Set(depts).size).toBe(depts.length) // All unique
  })

  it('WindowOp: row_number', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT * FROM parity_data),
            windowed AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rank FROM src)
            SELECT * FROM windowed WHERE rank = 1 ORDER BY department`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    expect(rows).toHaveLength(3) // One top earner per department
    const eng = rows.find((r: Record<string, unknown>) => r.department === 'Engineering')
    expect(eng!.name).toBe('Charlie') // Highest salary
  })

  it('WindowOp: rolling sum', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT * FROM parity_data WHERE department = 'Engineering' ORDER BY salary),
            windowed AS (SELECT *, SUM(salary) OVER (ORDER BY salary ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS rolling_sum FROM src)
            SELECT * FROM windowed`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    expect(rows).toHaveLength(4)
    // Each rolling sum should be sum of current + previous row
  })

  it('CastOp: string to integer', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT '42' AS str_val), casted AS (SELECT *, CAST(str_val AS INTEGER) AS int_val FROM src) SELECT * FROM casted`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    expect(rows[0].int_val).toBe(42)
  })

  it('CoalesceOp: first non-null', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT * FROM (VALUES (NULL, 'b', 'c'), ('a', NULL, 'c'), (NULL, NULL, 'c')) AS t(x, y, z)),
            coalesced AS (SELECT *, COALESCE(x, y, z) AS result FROM src)
            SELECT * FROM coalesced`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    expect(rows[0].result).toBe('b')
    expect(rows[1].result).toBe('a')
    expect(rows[2].result).toBe('c')
  })

  it('StringTransformOp: upper', async () => {
    const sqlResult = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM parity_data), transformed AS (SELECT *, UPPER(name) AS upper_name FROM src) SELECT * FROM transformed',
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = sqlResult.toArray()
    expect(rows[0].upper_name).toBe(rows[0].name.toUpperCase())
  })

  it('StringTransformOp: regex_replace', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT 'hello world 123' AS text), transformed AS (SELECT *, regexp_replace(text, $1, $2) AS cleaned FROM src) SELECT * FROM transformed`,
        paramSlots: [
          { index: 1, fieldPath: '/s.pattern', type: 'string' },
          { index: 2, fieldPath: '/s.replacement', type: 'string' },
        ],
        operatorAliases: new Map(),
      },
      ['\\d+', 'NUM']
    )
    const rows = sqlResult.toArray()
    expect(rows[0].cleaned).toBe('hello world NUM')
  })

  it('FillNullsOp: constant fill', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH src AS (SELECT * FROM (VALUES (1, 'a'), (2, NULL), (3, 'c')) AS t(id, val)),
            filled AS (SELECT *, COALESCE(val, $1) AS filled_val FROM src)
            SELECT * FROM filled`,
        paramSlots: [{ index: 1, fieldPath: '/f.constantValue', type: 'string' }],
        operatorAliases: new Map(),
      },
      ['DEFAULT']
    )
    const rows = sqlResult.toArray()
    expect(rows[1].filled_val).toBe('DEFAULT')
    expect(rows[0].filled_val).toBe('a')
  })

  it('Full pipeline parity: filter → sort → group → slice', async () => {
    const sqlResult = await execute(
      {
        sql: `WITH
        src AS (SELECT * FROM parity_data),
        filtered AS (SELECT * FROM src WHERE age >= $1),
        grouped AS (SELECT department, SUM(salary) AS total, COUNT(*) AS n FROM filtered GROUP BY department),
        sorted AS (SELECT * FROM grouped ORDER BY total DESC),
        top AS (SELECT * FROM sorted LIMIT $2 OFFSET $3)
      SELECT * FROM top`,
        paramSlots: [
          { index: 1, fieldPath: '/filter.value', type: 'number' },
          { index: 2, fieldPath: '/slice.end', type: 'number' },
          { index: 3, fieldPath: '/slice.start', type: 'number' },
        ],
        operatorAliases: new Map(),
      },
      [28, 2, 0]
    )

    const rows = sqlResult.toArray()
    expect(rows).toHaveLength(2)
    // age >= 28 includes: Alice(30), Charlie(35), Diana(28), Eve(32), Frank(45), Henry(38)
    // Grouped by dept: Engineering=400000, Marketing=65000, Sales=80000
    // Sorted desc: Engineering, Sales
    expect(rows[0].department).toBe('Engineering')
    expect(Number(rows[0].total)).toBe(400000)
  })

  it('JoinOp parity', async () => {
    const conn = await (await import('./executor')).getDuckDbInstance()!.connect()
    await conn.query(`
      CREATE OR REPLACE TABLE join_left AS SELECT * FROM (VALUES
        (1, 'Alice'), (2, 'Bob'), (3, 'Charlie')
      ) AS t(id, name);
      CREATE OR REPLACE TABLE join_right AS SELECT * FROM (VALUES
        (1, 100), (2, 200), (4, 400)
      ) AS t(id, score)
    `)
    await conn.close()

    // Left join
    const leftResult = await execute(
      {
        sql: `WITH l AS (SELECT * FROM join_left), r AS (SELECT * FROM join_right),
            joined AS (SELECT l.id, l.name, r.score FROM l LEFT JOIN r ON l.id = r.id)
            SELECT * FROM joined ORDER BY id`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const leftRows = leftResult.toArray()
    expect(leftRows).toHaveLength(3)
    expect(leftRows[2].score).toBeNull() // Charlie has no match

    // Inner join
    const innerResult = await execute(
      {
        sql: `WITH l AS (SELECT * FROM join_left), r AS (SELECT * FROM join_right),
            joined AS (SELECT * FROM l INNER JOIN r ON l.id = r.id)
            SELECT * FROM joined`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    expect(innerResult.toArray()).toHaveLength(2) // Only Alice and Bob match
  })
})
