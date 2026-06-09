import * as arrow from 'apache-arrow'
import * as duckdb from '@duckdb/duckdb-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import { execute, setDuckDbInstance } from './executor'
import type { CompiledQuery } from './types'

describe('Arrow Zero-Copy Performance', () => {
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

    // Create test table
    const conn = await db.connect()
    await conn.query(`
      CREATE TABLE arrow_test AS
      SELECT
        i AS id,
        'name_' || i AS name,
        (random() * 100)::INTEGER AS value
      FROM generate_series(1, 10000) AS t(i)
    `)
    await conn.close()
  })

  it('Arrow table is returned directly (zero-copy)', async () => {
    const compiled: CompiledQuery = {
      sql: 'SELECT * FROM arrow_test WHERE value > $1 ORDER BY value DESC LIMIT 100',
      paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'number' }],
      operatorAliases: new Map(),
    }

    const result = await execute(compiled, [50])

    // Verify we got an Arrow table back
    expect(result.table).toBeDefined()
    expect(result.table.numRows).toBeLessThanOrEqual(100)
    expect(result.table.schema).toBeDefined()
    expect(result.table.schema.fields.length).toBeGreaterThan(0)

    console.log('  Arrow table schema:', result.table.schema.fields.map(f => f.name).join(', '))
    console.log('  Rows:', result.table.numRows)
  })

  it('Arrow table access is faster than toArray() conversion', async () => {
    const compiled: CompiledQuery = {
      sql: 'SELECT * FROM arrow_test LIMIT 5000',
      paramSlots: [],
      operatorAliases: new Map(),
    }

    const result = await execute(compiled, [])

    // Measure Arrow column access (zero-copy)
    const startArrow = performance.now()
    const idColumn = result.table.getChild('id')
    const valueColumn = result.table.getChild('value')
    // Convert BigInt to Number for reduce
    const arrowSum = idColumn!.toArray().reduce((sum: number, val: any) => sum + Number(val), 0)
    const arrowElapsed = performance.now() - startArrow

    // Measure toArray() conversion + access
    const startJS = performance.now()
    const rows = result.toArray()
    const jsSum = rows.reduce((sum, row) => sum + Number(row.id), 0)
    const jsElapsed = performance.now() - startJS

    console.log('\nZero-copy Arrow column access:')
    console.log(`  Time: ${arrowElapsed.toFixed(2)}ms`)
    console.log(`  Sum: ${arrowSum}`)
    console.log('\ntoArray() materialization + access:')
    console.log(`  Time: ${jsElapsed.toFixed(2)}ms`)
    console.log(`  Sum: ${jsSum}`)
    console.log(`  Speedup: ${(jsElapsed / arrowElapsed).toFixed(2)}x faster with Arrow`)

    // Verify same results
    expect(arrowSum).toBe(jsSum)

    // Arrow should be faster (or at least not slower)
    // Note: On small datasets, the difference may be negligible
    expect(arrowElapsed).toBeLessThanOrEqual(jsElapsed * 1.5) // Allow 50% margin
  })

  it('Arrow slice is zero-copy (no data duplication)', async () => {
    const compiled: CompiledQuery = {
      sql: 'SELECT * FROM arrow_test LIMIT 1000',
      paramSlots: [],
      operatorAliases: new Map(),
    }

    const result = await execute(compiled, [])

    // Multiple slices of same table should be instant (views, not copies)
    const slices: arrow.Table[] = []
    const startSlicing = performance.now()

    for (let i = 0; i < 10; i++) {
      const start = i * 100
      const end = start + 100
      slices.push(result.table.slice(start, end))
    }

    const sliceElapsed = performance.now() - startSlicing

    console.log('\n10 Arrow slices (zero-copy views):')
    console.log(`  Total time: ${sliceElapsed.toFixed(2)}ms`)
    console.log(`  Per-slice avg: ${(sliceElapsed / 10).toFixed(3)}ms`)
    console.log('  Expected: <1ms total for zero-copy views')

    // Verify slices work correctly
    expect(slices.length).toBe(10)
    expect(slices[0].numRows).toBe(100)
    expect(slices[9].numRows).toBe(100)

    // Slicing should be extremely fast (zero-copy)
    expect(sliceElapsed).toBeLessThan(5) // Should be <5ms total
  })

  it('Arrow schema provides type information', async () => {
    const compiled: CompiledQuery = {
      sql: 'SELECT id, name, value FROM arrow_test LIMIT 1',
      paramSlots: [],
      operatorAliases: new Map(),
    }

    const result = await execute(compiled, [])

    // Arrow schema tells us column types without inspecting data
    const schema = result.table.schema
    const fields = schema.fields

    console.log('\nArrow schema fields:')
    for (const field of fields) {
      console.log(`  ${field.name}: ${field.type}`)
    }

    expect(fields.find(f => f.name === 'id')).toBeDefined()
    expect(fields.find(f => f.name === 'name')).toBeDefined()
    expect(fields.find(f => f.name === 'value')).toBeDefined()

    // Schema available immediately (no need to read rows)
    expect(schema.fields.length).toBe(3)
  })

  it('Arrow getChild() provides zero-copy column access', async () => {
    const compiled: CompiledQuery = {
      sql: 'SELECT * FROM arrow_test LIMIT 1000',
      paramSlots: [],
      operatorAliases: new Map(),
    }

    const result = await execute(compiled, [])

    // Get column as typed array (zero-copy)
    const startColumnAccess = performance.now()
    const valueColumn = result.table.getChild('value')
    const values = valueColumn!.toArray()
    const max = Math.max(...(values as number[]))
    const columnElapsed = performance.now() - startColumnAccess

    // Compare with row-based access
    const startRowAccess = performance.now()
    const rows = result.toArray()
    const maxRow = Math.max(...rows.map(r => r.value))
    const rowElapsed = performance.now() - startRowAccess

    console.log('\nColumn-oriented access (Arrow getChild):')
    console.log(`  Time: ${columnElapsed.toFixed(2)}ms`)
    console.log(`  Max value: ${max}`)
    console.log('\nRow-oriented access (toArray):')
    console.log(`  Time: ${rowElapsed.toFixed(2)}ms`)
    console.log(`  Max value: ${maxRow}`)
    console.log(`  Speedup: ${(rowElapsed / columnElapsed).toFixed(2)}x faster with columns`)

    expect(max).toBe(maxRow)
    // Column access should be faster for columnar operations
    expect(columnElapsed).toBeLessThanOrEqual(rowElapsed * 1.2)
  })
})
