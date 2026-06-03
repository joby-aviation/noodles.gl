import * as duckdb from '@duckdb/duckdb-wasm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compilePipeline, createCompilationContext } from './compiler'
import {
  castOpToSQL,
  coalesceOpToSQL,
  fillNullsOpToSQL,
  filterOpToSQL,
  groupByOpToSQL,
  joinOpToSQL,
  pivotOpToSQL,
  sliceOpToSQL,
  sortOpToSQL,
  stringTransformOpToSQL,
  uniqueOpToSQL,
  windowOpToSQL,
} from './sql-operators'
import type { CompilationContext, SQLFragment } from './types'
import { operatorIdToAlias } from './utils'

function num(val: unknown): number {
  if (typeof val === 'bigint') return Number(val)
  if (val && typeof val === 'object' && Symbol.toPrimitive in val) return Number(val)
  if (val && typeof val === 'object' && 'length' in val) {
    const arr = val as ArrayLike<number>
    let result = 0
    for (let i = arr.length - 1; i >= 0; i--) {
      result = result * 2 ** 32 + arr[i]
    }
    return result
  }
  return Number(val)
}

// Mock SQL operator for compilation
class SQLOp {
  id: string
  _upstreamDependencies: Set<SQLOp> = new Set()
  private toSQLFn: (ctx: CompilationContext) => SQLFragment

  constructor(id: string, toSQLFn: (ctx: CompilationContext) => SQLFragment) {
    this.id = id
    this.toSQLFn = toSQLFn
  }

  toSQL(ctx: CompilationContext): SQLFragment {
    return this.toSQLFn(ctx)
  }
}

describe('SQL Compiler Integration (end-to-end with DuckDB)', () => {
  let db: duckdb.AsyncDuckDB

  beforeAll(async () => {
    const bundles: duckdb.DuckDBBundles = {
      mvp: {
        mainModule: (await import('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url')).default,
        mainWorker: (await import('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'))
          .default,
      },
      eh: {
        mainModule: (await import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url')).default,
        mainWorker: (await import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'))
          .default,
      },
    }
    const bundle = await duckdb.selectBundle(bundles)
    const worker = new Worker(bundle.mainWorker!)
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule)
  })

  afterAll(async () => {
    if (db) await db.terminate()
  })

  async function runCompiled(operators: SQLOp[]) {
    const pipeline = compilePipeline(operators as any[])
    const conn = await db.connect()
    try {
      if (pipeline.params.length > 0) {
        const stmt = await conn.prepare(pipeline.sql)
        const result = await stmt.query(...pipeline.params.map(p => p.value))
        await stmt.close()
        return result.toArray()
      }
      const result = await conn.query(pipeline.sql)
      return result.toArray()
    } finally {
      await conn.close()
    }
  }

  it('compiles and executes: inline source → filter → sort', async () => {
    const source = new SQLOp('/source', (ctx) => {
      const alias = operatorIdToAlias('/source')
      ctx.aliases.set('/source', alias)
      return {
        alias,
        cte: `SELECT * FROM (VALUES
          (1, 'Alice', 30), (2, 'Bob', 25), (3, 'Charlie', 35),
          (4, 'Diana', 28), (5, 'Eve', 22)
        ) AS t(id, name, age)`,
        params: [],
        udfs: [],
      }
    })

    const filter = new SQLOp('/filter', (ctx) => {
      return filterOpToSQL('/filter', { columnName: 'age', condition: 'greater than', value: '25' }, '/source', ctx)
    })

    const sort = new SQLOp('/sort', (ctx) => {
      return sortOpToSQL('/sort', { key: 'age', order: 'desc' }, '/filter', ctx)
    })

    const rows = await runCompiled([source, filter, sort])

    expect(rows.length).toBe(3)
    expect(rows[0].name).toBe('Charlie')
    expect(num(rows[0].age)).toBe(35)
    expect(rows[2].name).toBe('Diana')
  })

  it('compiles and executes: source → group by with aggregations', async () => {
    const source = new SQLOp('/sales', (ctx) => {
      const alias = operatorIdToAlias('/sales')
      ctx.aliases.set('/sales', alias)
      return {
        alias,
        cte: `SELECT * FROM (VALUES
          ('Electronics', 'TV', 500), ('Electronics', 'Phone', 300),
          ('Electronics', 'Laptop', 1000),
          ('Clothing', 'Shirt', 50), ('Clothing', 'Pants', 80),
          ('Food', 'Pizza', 15), ('Food', 'Burger', 10), ('Food', 'Salad', 12)
        ) AS t(category, item, price)`,
        params: [],
        udfs: [],
      }
    })

    const grouped = new SQLOp('/grouped', (ctx) => {
      return groupByOpToSQL('/grouped', {
        groupByColumns: ['category'],
        aggregations: [
          { column: 'price', function: 'sum', alias: 'total_revenue' },
          { column: 'price', function: 'avg', alias: 'avg_price' },
          { column: '*', function: 'count', alias: 'item_count' },
        ],
      }, '/sales', ctx)
    })

    const rows = await runCompiled([source, grouped])
    const electronics = rows.find((r: any) => r.category === 'Electronics')

    expect(rows.length).toBe(3)
    expect(num(electronics.total_revenue)).toBe(1800)
    expect(num(electronics.item_count)).toBe(3)
  })

  it('compiles and executes: two sources → join', async () => {
    const orders = new SQLOp('/orders', (ctx) => {
      const alias = operatorIdToAlias('/orders')
      ctx.aliases.set('/orders', alias)
      return {
        alias,
        cte: `SELECT * FROM (VALUES
          (1, 'C1', 100), (2, 'C2', 200), (3, 'C1', 150)
        ) AS t(order_id, customer_id, amount)`,
        params: [],
        udfs: [],
      }
    })

    const customers = new SQLOp('/customers', (ctx) => {
      const alias = operatorIdToAlias('/customers')
      ctx.aliases.set('/customers', alias)
      return {
        alias,
        cte: `SELECT * FROM (VALUES
          ('C1', 'Alice'), ('C2', 'Bob'), ('C3', 'Charlie')
        ) AS t(customer_id, name)`,
        params: [],
        udfs: [],
      }
    })

    const joined = new SQLOp('/joined', (ctx) => {
      return joinOpToSQL('/joined', {
        leftKey: 'customer_id',
        rightKey: 'customer_id',
        joinType: 'left',
      }, '/orders', '/customers', ctx)
    })

    const rows = await runCompiled([orders, customers, joined])

    expect(rows.length).toBe(3)
    const aliceOrders = rows.filter((r: any) => r.name === 'Alice')
    expect(aliceOrders.length).toBe(2)
  })

  it('compiles and executes: source → unique', async () => {
    const source = new SQLOp('/dupes', (ctx) => {
      const alias = operatorIdToAlias('/dupes')
      ctx.aliases.set('/dupes', alias)
      return {
        alias,
        cte: `SELECT * FROM (VALUES
          ('a', 1), ('b', 2), ('a', 1), ('c', 3), ('b', 2)
        ) AS t(key, val)`,
        params: [],
        udfs: [],
      }
    })

    const unique = new SQLOp('/unique', (ctx) => {
      return uniqueOpToSQL('/unique', {}, '/dupes', ctx)
    })

    const rows = await runCompiled([source, unique])
    expect(rows.length).toBe(3)
  })

  it('compiles and executes: source → window function', async () => {
    const source = new SQLOp('/data', (ctx) => {
      const alias = operatorIdToAlias('/data')
      ctx.aliases.set('/data', alias)
      return {
        alias,
        cte: `SELECT * FROM (VALUES
          ('A', 10), ('A', 20), ('A', 30),
          ('B', 40), ('B', 50)
        ) AS t(grp, val)`,
        params: [],
        udfs: [],
      }
    })

    const windowed = new SQLOp('/windowed', (ctx) => {
      return windowOpToSQL('/windowed', {
        column: 'val',
        function: 'sum',
        partitionBy: ['grp'],
        orderBy: 'val',
        order: 'asc',
        windowSize: 2,
        outputColumn: 'rolling_sum',
      }, '/data', ctx)
    })

    const rows = await runCompiled([source, windowed])
    expect(rows.length).toBe(5)
    // Check rolling sum within group A
    const groupA = rows.filter((r: any) => r.grp === 'A').sort((a: any, b: any) => num(a.val) - num(b.val))
    expect(num(groupA[0].rolling_sum)).toBe(10) // only first row
    expect(num(groupA[1].rolling_sum)).toBe(30) // 10 + 20
  })

  it('compiles and executes: source → string transform', async () => {
    const source = new SQLOp('/text', (ctx) => {
      const alias = operatorIdToAlias('/text')
      ctx.aliases.set('/text', alias)
      return {
        alias,
        cte: `SELECT * FROM (VALUES
          ('  Hello World  '), ('foo bar'), ('UA1234')
        ) AS t(text)`,
        params: [],
        udfs: [],
      }
    })

    const transformed = new SQLOp('/transformed', (ctx) => {
      return stringTransformOpToSQL('/transformed', {
        column: 'text',
        operation: 'upper',
        outputColumn: 'upper_text',
      }, '/text', ctx)
    })

    const rows = await runCompiled([source, transformed])
    expect(rows[0].upper_text).toBe('  HELLO WORLD  ')
    expect(rows[2].upper_text).toBe('UA1234')
  })

  it('compiles and executes: full pipeline with prepared statement params', async () => {
    const source = new SQLOp('/data', (ctx) => {
      const alias = operatorIdToAlias('/data')
      ctx.aliases.set('/data', alias)
      return {
        alias,
        cte: `SELECT unnest(generate_series(1, 100)) as id, random() * 100 as value`,
        params: [],
        udfs: [],
      }
    })

    const filter = new SQLOp('/filter', (ctx) => {
      return filterOpToSQL('/filter', { columnName: 'value', condition: 'greater than', value: '50' }, '/data', ctx)
    })

    const sliced = new SQLOp('/sliced', (ctx) => {
      return sliceOpToSQL('/sliced', { start: 0, end: 10 }, '/filter', ctx)
    })

    const pipeline = compilePipeline([source, filter, sliced] as any[])

    // Verify the SQL has proper structure
    expect(pipeline.sql).toContain('WITH')
    expect(pipeline.sql).toContain('data AS')
    expect(pipeline.sql).toContain('filter_op AS')
    expect(pipeline.sql).toContain('sliced AS')
    expect(pipeline.params.length).toBeGreaterThan(0)

    // Execute with DuckDB
    const conn = await db.connect()
    try {
      const stmt = await conn.prepare(pipeline.sql)
      const result = await stmt.query(...pipeline.params.map(p => p.value))
      const rows = result.toArray()
      expect(rows.length).toBeLessThanOrEqual(10)
      await stmt.close()
    } finally {
      await conn.close()
    }
  })

  it('compiled pipeline SQL is readable and debuggable', () => {
    const ctx = createCompilationContext()

    // Build a realistic pipeline
    const sourceFragment = {
      alias: 'flights',
      cte: "SELECT * FROM read_csv_auto('/data/flights.csv')",
      params: [] as any[],
      udfs: [] as any[],
    }
    ctx.aliases.set('/flights', 'flights')

    const filterFragment = filterOpToSQL('/filter-delayed', {
      columnName: 'delay',
      condition: 'greater than',
      value: '30',
    }, '/flights', ctx)
    ctx.aliases.set('/filter-delayed', filterFragment.alias)

    const groupFragment = groupByOpToSQL('/by-airline', {
      groupByColumns: ['airline'],
      aggregations: [
        { column: 'delay', function: 'avg', alias: 'avg_delay' },
        { column: '*', function: 'count', alias: 'flight_count' },
      ],
    }, '/filter-delayed', ctx)

    // The compiled SQL should be human-readable
    const pipeline = compilePipeline([
      { id: '/flights', toSQL: () => sourceFragment, _upstreamDependencies: new Set() },
      { id: '/filter-delayed', toSQL: () => filterFragment, _upstreamDependencies: new Set() },
      { id: '/by-airline', toSQL: () => groupFragment, _upstreamDependencies: new Set() },
    ] as any[])

    // Verify structure
    expect(pipeline.sql).toContain('flights AS')
    expect(pipeline.sql).toContain('filter_delayed AS')
    expect(pipeline.sql).toContain('by_airline AS')
    expect(pipeline.sql).toContain('AVG("delay") AS "avg_delay"')
    expect(pipeline.sql).toContain('COUNT(*) AS "flight_count"')
    expect(pipeline.sql).toContain('GROUP BY "airline"')
  })
})
