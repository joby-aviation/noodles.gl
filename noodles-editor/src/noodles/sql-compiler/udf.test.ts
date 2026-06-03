import * as duckdb from '@duckdb/duckdb-wasm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// DuckDB returns BigInt for integer columns and DecimalBigNum for SUM results.
// This helper coerces to Number for easier assertions.
function num(val: unknown): number {
  if (typeof val === 'bigint') return Number(val)
  if (val && typeof val === 'object' && Symbol.toPrimitive in val) return Number(val)
  if (val && typeof val === 'object' && 'length' in val) {
    // DecimalBigNum (Uint32Array-like): convert to number
    const arr = val as ArrayLike<number>
    let result = 0
    for (let i = arr.length - 1; i >= 0; i--) {
      result = result * 2 ** 32 + arr[i]
    }
    return result
  }
  return Number(val)
}

// Test the SQL compilation strategy: CTEs + prepared statements.
// This validates the core architecture without UDFs.
//
// UDF support requires the synchronous (blocking) DuckDB bindings which
// can't be used via the worker-based AsyncDuckDB. For now, complex JS
// operations (ColorRamp, custom accessors) will be handled at the boundary
// rather than as inline UDFs. Pure SQL operations cover 90%+ of the
// data transformation use cases.
describe('DuckDB SQL Compilation Strategy', () => {
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

  describe('CTE-based pipeline compilation', () => {
    it('single CTE: simulates FileOp → SELECT *', async () => {
      const conn = await db.connect()
      try {
        const result = await conn.query(`
          WITH file_op AS (
            SELECT unnest([1, 2, 3, 4, 5]) as id,
                   unnest(['a', 'b', 'c', 'd', 'e']) as name
          )
          SELECT * FROM file_op
        `)
        const rows = result.toArray()
        expect(rows).toHaveLength(5)
        expect(num(rows[0].id)).toBe(1)
        expect(rows[0].name).toBe('a')
      } finally {
        await conn.close()
      }
    })

    it('multi-CTE pipeline: source → filter → sort', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT unnest(generate_series(1, 10)) as id,
                     unnest(generate_series(10, 100, 10)) as value
            ),
            filtered AS (
              SELECT * FROM source WHERE value > 30
            ),
            sorted AS (
              SELECT * FROM filtered ORDER BY value DESC
            )
          SELECT * FROM sorted
        `
        const result = await conn.query(sql)
        const rows = result.toArray()
        expect(rows).toHaveLength(7)
        expect(num(rows[0].value)).toBe(100)
        expect(num(rows[6].value)).toBe(40)
      } finally {
        await conn.close()
      }
    })

    it('complex pipeline: source → filter → group by → sort', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT * FROM (VALUES
                ('A', 10), ('A', 20), ('A', 30),
                ('B', 40), ('B', 50),
                ('C', 60)
              ) AS t(category, value)
            ),
            filtered AS (
              SELECT * FROM source WHERE value > 15
            ),
            grouped AS (
              SELECT category, COUNT(*) as cnt, SUM(value) as total, AVG(value) as avg_val
              FROM filtered GROUP BY category
            ),
            sorted AS (
              SELECT * FROM grouped ORDER BY total DESC
            )
          SELECT * FROM sorted
        `
        const result = await conn.query(sql)
        const rows = result.toArray()
        expect(rows).toHaveLength(3)
        // Sort is DESC by total so B(90) > C(60) > A(50)
        const byTotal = [...rows].sort((a: any, b: any) => num(b.total) - num(a.total))
        expect(byTotal[0].category).toBe('B')
        expect(num(byTotal[0].total)).toBe(90)
        expect(byTotal[2].category).toBe('A')
        expect(num(byTotal[2].cnt)).toBe(2)
      } finally {
        await conn.close()
      }
    })

    it('join pipeline: two sources joined', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            flights AS (
              SELECT * FROM (VALUES
                ('UA100', 'SFO', 'LAX', 45),
                ('UA200', 'SFO', 'JFK', 120),
                ('DL300', 'ATL', 'ORD', 30)
              ) AS t(flight, origin, dest, delay)
            ),
            airports AS (
              SELECT * FROM (VALUES
                ('SFO', 'San Francisco', 37.6213),
                ('LAX', 'Los Angeles', 33.9425),
                ('JFK', 'New York', 40.6413),
                ('ATL', 'Atlanta', 33.6407),
                ('ORD', 'Chicago', 41.9742)
              ) AS t(code, city, lat)
            ),
            joined AS (
              SELECT f.flight, f.delay, a.city as origin_city, a.lat as origin_lat
              FROM flights f
              LEFT JOIN airports a ON f.origin = a.code
            )
          SELECT * FROM joined ORDER BY flight
        `
        const result = await conn.query(sql)
        const rows = result.toArray()
        expect(rows).toHaveLength(3)
        expect(rows[0].origin_city).toBe('Atlanta')
        expect(rows[1].origin_city).toBe('San Francisco')
      } finally {
        await conn.close()
      }
    })

    it('pivot operation', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT * FROM (VALUES
                ('Jan', 'sales', 100),
                ('Jan', 'costs', 60),
                ('Feb', 'sales', 150),
                ('Feb', 'costs', 70)
              ) AS t(month, category, amount)
            ),
            pivoted AS (
              PIVOT source ON category USING SUM(amount) GROUP BY month
            )
          SELECT * FROM pivoted ORDER BY month
        `
        const result = await conn.query(sql)
        const rows = result.toArray()
        expect(rows).toHaveLength(2)
        const feb = rows.find((r: any) => r.month === 'Feb')
        expect(num(feb.sales)).toBe(150)
        expect(num(feb.costs)).toBe(70)
      } finally {
        await conn.close()
      }
    })

    it('window functions', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT unnest(generate_series(1, 5)) as id,
                     unnest([10, 30, 20, 50, 40]) as value
            ),
            windowed AS (
              SELECT id, value,
                     ROW_NUMBER() OVER (ORDER BY value DESC) as rank,
                     LAG(value) OVER (ORDER BY id) as prev_value,
                     SUM(value) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) as rolling_sum
              FROM source
            )
          SELECT * FROM windowed ORDER BY id
        `
        const result = await conn.query(sql)
        const rows = result.toArray()
        expect(num(rows[0].rank)).toBe(5)
        expect(rows[0].prev_value).toBeNull()
        expect(num(rows[1].rolling_sum)).toBe(40) // 10 + 30
      } finally {
        await conn.close()
      }
    })
  })

  describe('Prepared statements for timeline parameters', () => {
    it('parameterized filter threshold', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT unnest(generate_series(1, 100)) as value
            ),
            filtered AS (
              SELECT * FROM source WHERE value > $1 AND value < $2
            )
          SELECT COUNT(*) as cnt FROM filtered
        `
        const stmt = await conn.prepare(sql)

        // Simulate timeline at t=0: filter 10-50
        const r1 = await stmt.query(10, 50)
        expect(num(r1.toArray()[0].cnt)).toBe(39)

        // Simulate timeline at t=1: filter 60-90
        const r2 = await stmt.query(60, 90)
        expect(num(r2.toArray()[0].cnt)).toBe(29)

        await stmt.close()
      } finally {
        await conn.close()
      }
    })

    it('parameterized sort and limit', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT unnest(generate_series(1, 100)) as id,
                     unnest(generate_series(100, 1, -1)) as value
            ),
            sliced AS (
              SELECT * FROM source LIMIT $1 OFFSET $2
            )
          SELECT * FROM sliced
        `
        const stmt = await conn.prepare(sql)

        const r1 = await stmt.query(5, 0)
        expect(r1.toArray()).toHaveLength(5)
        expect(num(r1.toArray()[0].id)).toBe(1)

        const r2 = await stmt.query(3, 10)
        expect(r2.toArray()).toHaveLength(3)
        expect(num(r2.toArray()[0].id)).toBe(11)

        await stmt.close()
      } finally {
        await conn.close()
      }
    })

    it('parameterized GROUP BY with dynamic aggregation threshold', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT * FROM (VALUES
                ('A', 10), ('A', 20), ('A', 30),
                ('B', 40), ('B', 50), ('B', 60),
                ('C', 70), ('C', 80)
              ) AS t(grp, val)
            ),
            filtered AS (
              SELECT * FROM source WHERE val > $1
            ),
            grouped AS (
              SELECT grp, SUM(val) as total, COUNT(*) as cnt
              FROM filtered GROUP BY grp
            )
          SELECT * FROM grouped ORDER BY grp
        `
        const stmt = await conn.prepare(sql)

        // Timeline at t=0: include all above 0
        const r1 = await stmt.query(0)
        expect(r1.toArray()).toHaveLength(3)

        // Timeline at t=1: only values > 50
        const r2 = await stmt.query(50)
        const rows = r2.toArray()
        expect(rows).toHaveLength(2) // Only B and C have values > 50
        expect(rows[0].grp).toBe('B')
        expect(num(rows[0].total)).toBe(60)

        await stmt.close()
      } finally {
        await conn.close()
      }
    })

    it('multiple parameters simulating multiple keyframed inputs', async () => {
      const conn = await db.connect()
      try {
        // Simulates: FileOp($1=url) → Filter(value > $2) → Slice(LIMIT $3)
        const sql = `
          WITH
            source AS (
              SELECT unnest(generate_series(1, 1000)) as id,
                     random() * $1 as value
            ),
            filtered AS (
              SELECT * FROM source WHERE value > $2
            ),
            limited AS (
              SELECT * FROM filtered LIMIT $3
            )
          SELECT COUNT(*) as cnt FROM limited
        `
        const stmt = await conn.prepare(sql)

        // Different parameter combinations (simulating timeline scrubbing)
        const r1 = await stmt.query(100, 50, 10)
        expect(num(r1.toArray()[0].cnt)).toBeLessThanOrEqual(10)

        const r2 = await stmt.query(100, 90, 5)
        expect(num(r2.toArray()[0].cnt)).toBeLessThanOrEqual(5)

        await stmt.close()
      } finally {
        await conn.close()
      }
    })
  })

  describe('String operations in SQL', () => {
    it('regex, case, trim operations', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT * FROM (VALUES
                ('  Hello World  '),
                ('foo-bar-baz'),
                ('UA1234-SFO-LAX')
              ) AS t(text)
            ),
            transformed AS (
              SELECT
                text,
                TRIM(text) as trimmed,
                UPPER(TRIM(text)) as upper_trimmed,
                regexp_extract(text, '([A-Z]{2}\\d+)', 1) as flight_code
              FROM source
            )
          SELECT * FROM transformed
        `
        const result = await conn.query(sql)
        const rows = result.toArray()
        expect(rows[0].trimmed).toBe('Hello World')
        expect(rows[0].upper_trimmed).toBe('HELLO WORLD')
        expect(rows[2].flight_code).toBe('UA1234')
      } finally {
        await conn.close()
      }
    })
  })

  describe('Data types and casting', () => {
    it('CAST operations', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (
              SELECT * FROM (VALUES
                ('42', '3.14', '2024-01-15', 'true'),
                ('100', '2.71', '2024-06-30', 'false')
              ) AS t(int_str, float_str, date_str, bool_str)
            ),
            casted AS (
              SELECT
                CAST(int_str AS INTEGER) as int_val,
                CAST(float_str AS DOUBLE) as float_val,
                CAST(date_str AS DATE) as date_val,
                CAST(bool_str AS BOOLEAN) as bool_val
              FROM source
            )
          SELECT * FROM casted
        `
        const result = await conn.query(sql)
        const rows = result.toArray()
        expect(num(rows[0].int_val)).toBe(42)
        expect(num(rows[0].float_val)).toBeCloseTo(3.14)
        expect(rows[0].bool_val).toBe(true)
      } finally {
        await conn.close()
      }
    })
  })

  describe('Performance: prepared statement reuse', () => {
    it('executing same prepared statement 100 times is fast', async () => {
      const conn = await db.connect()
      try {
        const sql = `
          WITH
            source AS (SELECT unnest(generate_series(1, 1000)) as val),
            filtered AS (SELECT * FROM source WHERE val > $1 AND val < $2)
          SELECT COUNT(*) as cnt, AVG(val) as avg_val FROM filtered
        `
        const stmt = await conn.prepare(sql)

        const start = performance.now()
        for (let i = 0; i < 100; i++) {
          const lo = i * 5
          const hi = lo + 200
          await stmt.query(lo, hi)
        }
        const elapsed = performance.now() - start

        // 100 executions should complete in reasonable time (< 5s)
        expect(elapsed).toBeLessThan(5000)

        await stmt.close()
      } finally {
        await conn.close()
      }
    })
  })
})
