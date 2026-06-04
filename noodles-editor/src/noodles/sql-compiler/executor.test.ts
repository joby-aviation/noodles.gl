import * as duckdb from '@duckdb/duckdb-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectParamValues, PreparedPipeline, setDuckDbInstance } from './executor'
import type { ParamSlot } from './types'

describe('collectParamValues', () => {
  it('collects values from field paths', () => {
    const slots: ParamSlot[] = [
      { index: 1, fieldPath: '/file.url', type: 'string' },
      { index: 2, fieldPath: '/filter.value', type: 'number' },
      { index: 3, fieldPath: '/toggle.enabled', type: 'boolean' },
    ]
    const fieldValues: Record<string, unknown> = {
      '/file.url': 'data.csv',
      '/filter.value': '42',
      '/toggle.enabled': 1,
    }
    const values = collectParamValues(slots, path => fieldValues[path])
    expect(values).toEqual(['data.csv', 42, true])
  })

  it('coerces types correctly', () => {
    const slots: ParamSlot[] = [
      { index: 1, fieldPath: '/a', type: 'number' },
      { index: 2, fieldPath: '/b', type: 'string' },
      { index: 3, fieldPath: '/c', type: 'json' },
    ]
    const values = collectParamValues(slots, path => {
      if (path === '/a') return '3.14'
      if (path === '/b') return 123
      if (path === '/c') return { x: 1 }
      return null
    })
    expect(values[0]).toBe(3.14)
    expect(values[1]).toBe('123')
    expect(values[2]).toBe('{"x":1}')
  })

  it('handles null/undefined values', () => {
    const slots: ParamSlot[] = [{ index: 1, fieldPath: '/missing', type: 'string' }]
    const values = collectParamValues(slots, () => undefined)
    expect(values[0]).toBe('')
  })
})

describe('PreparedPipeline (timeline scrubbing)', () => {
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
      CREATE TABLE timeline_data AS SELECT * FROM (VALUES
        (1, 10), (2, 20), (3, 30), (4, 40), (5, 50),
        (6, 60), (7, 70), (8, 80), (9, 90), (10, 100)
      ) AS t(id, value)
    `)
    await conn.close()
  })

  it('reuses prepared statement across multiple executions', async () => {
    const pipeline = new PreparedPipeline({
      sql: 'WITH src AS (SELECT * FROM timeline_data WHERE value > $1) SELECT * FROM src',
      paramSlots: [{ index: 1, fieldPath: '/threshold.value', type: 'number' }],
      operatorAliases: new Map(),
    })

    try {
      // Simulate 10 frames of timeline scrubbing
      for (let threshold = 10; threshold <= 100; threshold += 10) {
        const result = await pipeline.execute([threshold])
        const rows = result.toArray()
        const expectedCount = 10 - threshold / 10
        expect(rows).toHaveLength(expectedCount)
      }
    } finally {
      await pipeline.close()
    }
  })

  it('handles changing parameters without recompilation', async () => {
    const pipeline = new PreparedPipeline({
      sql: 'WITH src AS (SELECT * FROM timeline_data WHERE id >= $1 AND id <= $2) SELECT * FROM src',
      paramSlots: [
        { index: 1, fieldPath: '/range.start', type: 'number' },
        { index: 2, fieldPath: '/range.end', type: 'number' },
      ],
      operatorAliases: new Map(),
    })

    try {
      const result1 = await pipeline.execute([1, 5])
      expect(result1.toArray()).toHaveLength(5)

      const result2 = await pipeline.execute([3, 7])
      expect(result2.toArray()).toHaveLength(5)

      const result3 = await pipeline.execute([8, 10])
      expect(result3.toArray()).toHaveLength(3)
    } finally {
      await pipeline.close()
    }
  })

  it('performs well across many rapid executions', async () => {
    const pipeline = new PreparedPipeline({
      sql: 'WITH src AS (SELECT * FROM timeline_data WHERE value > $1) SELECT COUNT(*) as n FROM src',
      paramSlots: [{ index: 1, fieldPath: '/t.value', type: 'number' }],
      operatorAliases: new Map(),
    })

    try {
      const start = performance.now()
      const iterations = 100
      for (let i = 0; i < iterations; i++) {
        await pipeline.execute([i % 100])
      }
      const elapsed = performance.now() - start
      const perFrame = elapsed / iterations
      // Should be well under 16ms per frame for this simple query
      expect(perFrame).toBeLessThan(16)
    } finally {
      await pipeline.close()
    }
  })
})
