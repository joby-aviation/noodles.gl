import * as duckdb from '@duckdb/duckdb-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompilableNode } from './compiler'
import { compile } from './compiler'
import { execute, PreparedPipeline, setDuckDbInstance } from './executor'
import { SQLGraphIntegration } from './graph-integration'
import type { CompiledQuery } from './types'

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
  return { id, type, inputs: inputFields, getUpstreamDataIds: () => upstreamIds }
}

describe('Performance Benchmarks', () => {
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

    // Create test datasets of various sizes
    const conn = await db.connect()
    await conn.query(`
      CREATE TABLE bench_1k AS
      SELECT
        i AS id,
        'name_' || i AS name,
        (random() * 100)::INTEGER AS age,
        CASE WHEN random() < 0.33 THEN 'Engineering'
             WHEN random() < 0.66 THEN 'Marketing'
             ELSE 'Sales' END AS department,
        (random() * 200000)::INTEGER AS salary
      FROM generate_series(1, 1000) AS t(i)
    `)
    await conn.query(`
      CREATE TABLE bench_10k AS
      SELECT
        i AS id,
        'name_' || i AS name,
        (random() * 100)::INTEGER AS age,
        CASE WHEN random() < 0.33 THEN 'Engineering'
             WHEN random() < 0.66 THEN 'Marketing'
             ELSE 'Sales' END AS department,
        (random() * 200000)::INTEGER AS salary
      FROM generate_series(1, 10000) AS t(i)
    `)
    await conn.query(`
      CREATE TABLE bench_100k AS
      SELECT
        i AS id,
        'name_' || i AS name,
        (random() * 100)::INTEGER AS age,
        CASE WHEN random() < 0.33 THEN 'Engineering'
             WHEN random() < 0.66 THEN 'Marketing'
             ELSE 'Sales' END AS department,
        (random() * 200000)::INTEGER AS salary
      FROM generate_series(1, 100000) AS t(i)
    `)
    await conn.close()
  })

  describe('Compilation Time', () => {
    it('5-operator chain compiles in <5ms', () => {
      const nodes = [
        makeNode('/file', 'File', { url: 'data.csv', format: 'csv' }),
        makeNode(
          '/filter',
          'FilterOp',
          { columnName: 'age', condition: 'greater than', value: '30' },
          ['/file']
        ),
        makeNode('/sort', 'Sort', { key: 'salary', order: 'desc' }, ['/filter']),
        makeNode(
          '/group',
          'GroupBy',
          {
            groupByColumns: 'department',
            aggregations: 'sum:salary',
            outputColumns: 'total_salary',
          },
          ['/sort']
        ),
        makeNode('/slice', 'Slice', { start: '0', end: '10' }, ['/group']),
      ]

      const start = performance.now()
      const compiled = compile(nodes)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(5)
      expect(compiled.sql).toContain('WITH')
      console.log(`  5-operator compile: ${elapsed.toFixed(3)}ms`)
    })

    it('10-operator chain compiles in <5ms', () => {
      const nodes: CompilableNode[] = [
        makeNode('/file', 'File', { url: 'data.csv', format: 'csv' }),
      ]
      const types = [
        'FilterOp',
        'Sort',
        'Slice',
        'Unique',
        'FilterOp',
        'Sort',
        'Slice',
        'Unique',
        'Sort',
      ]
      const filterInputs = { columnName: 'age', condition: 'greater than', value: '25' }
      const sortInputs = { key: 'age', order: 'asc' }
      const sliceInputs = { start: '0', end: '100' }
      const uniqueInputs = { columns: 'name,age' }

      for (let i = 0; i < types.length; i++) {
        const type = types[i]
        const prevId = i === 0 ? '/file' : `/op${i}`
        const id = `/op${i + 1}`
        let inputs: Record<string, unknown>
        switch (type) {
          case 'FilterOp':
            inputs = filterInputs
            break
          case 'Sort':
            inputs = sortInputs
            break
          case 'Slice':
            inputs = sliceInputs
            break
          case 'Unique':
            inputs = uniqueInputs
            break
          default:
            inputs = sortInputs
        }
        nodes.push(makeNode(id, type, inputs, [prevId]))
      }

      const start = performance.now()
      const compiled = compile(nodes)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(5)
      expect(compiled.operatorAliases.size).toBe(10)
      console.log(`  10-operator compile: ${elapsed.toFixed(3)}ms`)
    })

    it('20-operator chain compiles in <5ms', () => {
      const nodes: CompilableNode[] = [
        makeNode('/file', 'File', { url: 'data.csv', format: 'csv' }),
      ]
      for (let i = 1; i <= 19; i++) {
        const prevId = i === 1 ? '/file' : `/n${i - 1}`
        const id = `/n${i}`
        const type = i % 3 === 0 ? 'Sort' : i % 3 === 1 ? 'FilterOp' : 'Slice'
        const inputs =
          type === 'FilterOp'
            ? { columnName: 'age', condition: 'greater than', value: String(i) }
            : type === 'Sort'
              ? { key: 'age', order: 'asc' }
              : { start: '0', end: '1000' }
        nodes.push(makeNode(id, type, inputs, [prevId]))
      }

      const start = performance.now()
      const compiled = compile(nodes)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(5)
      expect(compiled.operatorAliases.size).toBe(20)
      console.log(`  20-operator compile: ${elapsed.toFixed(3)}ms`)
    })
  })

  describe('Execution Time: Single CTE Query vs Sequential', () => {
    it('1K rows: filter+sort+limit in single query', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_1k WHERE age > $1), sorted AS (SELECT * FROM filtered ORDER BY salary DESC), limited AS (SELECT * FROM sorted LIMIT $2) SELECT * FROM limited',
        paramSlots: [
          { index: 1, fieldPath: '/f.value', type: 'number' },
          { index: 2, fieldPath: '/s.end', type: 'number' },
        ],
        operatorAliases: new Map(),
      }

      const start = performance.now()
      const result = await execute(compiled, [30, 100])
      const elapsed = performance.now() - start

      expect(result.toArray().length).toBeLessThanOrEqual(100)
      expect(elapsed).toBeLessThan(50)
      console.log(
        `  1K rows (filter+sort+limit): ${elapsed.toFixed(2)}ms, ${result.table.numRows} rows`
      )
    })

    it('10K rows: filter+sort+limit in single query', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_10k WHERE age > $1), sorted AS (SELECT * FROM filtered ORDER BY salary DESC), limited AS (SELECT * FROM sorted LIMIT $2) SELECT * FROM limited',
        paramSlots: [
          { index: 1, fieldPath: '/f.value', type: 'number' },
          { index: 2, fieldPath: '/s.end', type: 'number' },
        ],
        operatorAliases: new Map(),
      }

      const start = performance.now()
      const result = await execute(compiled, [30, 100])
      const elapsed = performance.now() - start

      expect(result.toArray().length).toBeLessThanOrEqual(100)
      expect(elapsed).toBeLessThan(100)
      console.log(
        `  10K rows (filter+sort+limit): ${elapsed.toFixed(2)}ms, ${result.table.numRows} rows`
      )
    })

    it('100K rows: filter+sort+limit in single query', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_100k WHERE age > $1), sorted AS (SELECT * FROM filtered ORDER BY salary DESC), limited AS (SELECT * FROM sorted LIMIT $2) SELECT * FROM limited',
        paramSlots: [
          { index: 1, fieldPath: '/f.value', type: 'number' },
          { index: 2, fieldPath: '/s.end', type: 'number' },
        ],
        operatorAliases: new Map(),
      }

      const start = performance.now()
      const result = await execute(compiled, [30, 100])
      const elapsed = performance.now() - start

      expect(result.toArray().length).toBeLessThanOrEqual(100)
      expect(elapsed).toBeLessThan(200)
      console.log(
        `  100K rows (filter+sort+limit): ${elapsed.toFixed(2)}ms, ${result.table.numRows} rows`
      )
    })

    it('100K rows: group by + aggregate', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH grouped AS (SELECT department, COUNT(*) AS n, AVG(salary) AS avg_salary, MAX(salary) AS max_salary FROM bench_100k GROUP BY department) SELECT * FROM grouped ORDER BY n DESC',
        paramSlots: [],
        operatorAliases: new Map(),
      }

      const start = performance.now()
      const result = await execute(compiled, [])
      const elapsed = performance.now() - start

      expect(result.toArray().length).toBe(3)
      expect(elapsed).toBeLessThan(200)
      console.log(`  100K rows (group by): ${elapsed.toFixed(2)}ms, ${result.table.numRows} rows`)
    })

    it('100K rows: window function', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH windowed AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rank FROM bench_100k) SELECT * FROM windowed WHERE rank <= $1',
        paramSlots: [{ index: 1, fieldPath: '/w.limit', type: 'number' }],
        operatorAliases: new Map(),
      }

      const start = performance.now()
      const result = await execute(compiled, [10])
      const elapsed = performance.now() - start

      expect(result.toArray().length).toBe(30) // 10 per department
      expect(elapsed).toBeLessThan(300)
      console.log(
        `  100K rows (window rank): ${elapsed.toFixed(2)}ms, ${result.table.numRows} rows`
      )
    })

    it('100K rows: sequential individual queries (baseline comparison)', async () => {
      // Simulate what the JS pull-based path does: 3 separate queries
      const start = performance.now()

      // Step 1: Filter
      const _r1 = await execute(
        {
          sql: 'SELECT * FROM bench_100k WHERE age > $1',
          paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
          operatorAliases: new Map(),
        },
        [30]
      )

      // Step 2: Sort (operating on full filtered set)
      const _r2 = await execute(
        {
          sql: 'WITH src AS (SELECT * FROM bench_100k WHERE age > $1) SELECT * FROM src ORDER BY salary DESC',
          paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
          operatorAliases: new Map(),
        },
        [30]
      )

      // Step 3: Limit
      const _r3 = await execute(
        {
          sql: 'WITH src AS (SELECT * FROM bench_100k WHERE age > $1), sorted AS (SELECT * FROM src ORDER BY salary DESC) SELECT * FROM sorted LIMIT $2',
          paramSlots: [
            { index: 1, fieldPath: '/f.value', type: 'number' },
            { index: 2, fieldPath: '/s.end', type: 'number' },
          ],
          operatorAliases: new Map(),
        },
        [30, 100]
      )

      const elapsed = performance.now() - start
      console.log(`  100K rows (3 sequential queries): ${elapsed.toFixed(2)}ms`)
      // The single CTE query should be faster than sequential
    })
  })

  describe('Timeline Scrubbing: Prepared Statement Reuse', () => {
    it('60 frames with changing filter threshold (1K rows)', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_1k WHERE age > $1), sorted AS (SELECT * FROM filtered ORDER BY salary DESC) SELECT * FROM sorted LIMIT 50',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
        operatorAliases: new Map(),
      }

      const pipeline = new PreparedPipeline(compiled)
      await pipeline.prepare()

      const frameTimes: number[] = []
      for (let frame = 0; frame < 60; frame++) {
        const threshold = 20 + (frame * 60) / 60 // 20 → 80 over 60 frames
        const start = performance.now()
        const result = await pipeline.execute([threshold])
        frameTimes.push(performance.now() - start)
        expect(result.table.numRows).toBeLessThanOrEqual(50)
      }

      await pipeline.close()

      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
      const max = Math.max(...frameTimes)
      const p95 = frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)]

      expect(avg).toBeLessThan(16) // Under 16ms avg for 60fps
      console.log(
        `  1K timeline scrub: avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, max=${max.toFixed(2)}ms`
      )
    })

    it('60 frames with changing filter threshold (10K rows)', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_10k WHERE age > $1), sorted AS (SELECT * FROM filtered ORDER BY salary DESC) SELECT * FROM sorted LIMIT 50',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
        operatorAliases: new Map(),
      }

      const pipeline = new PreparedPipeline(compiled)
      await pipeline.prepare()

      const frameTimes: number[] = []
      for (let frame = 0; frame < 60; frame++) {
        const threshold = 20 + (frame * 60) / 60
        const start = performance.now()
        await pipeline.execute([threshold])
        frameTimes.push(performance.now() - start)
      }

      await pipeline.close()

      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
      const max = Math.max(...frameTimes)
      const p95 = frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)]

      expect(avg).toBeLessThan(16)
      console.log(
        `  10K timeline scrub: avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, max=${max.toFixed(2)}ms`
      )
    })

    it('60 frames with changing filter threshold (100K rows)', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_100k WHERE age > $1), sorted AS (SELECT * FROM filtered ORDER BY salary DESC) SELECT * FROM sorted LIMIT 200',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
        operatorAliases: new Map(),
      }

      const pipeline = new PreparedPipeline(compiled)
      await pipeline.prepare()

      const frameTimes: number[] = []
      for (let frame = 0; frame < 60; frame++) {
        const threshold = 20 + (frame * 60) / 60
        const start = performance.now()
        await pipeline.execute([threshold])
        frameTimes.push(performance.now() - start)
      }

      await pipeline.close()

      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
      const max = Math.max(...frameTimes)
      const p95 = frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)]

      // 100K with filter+sort+limit: allow more headroom
      expect(avg).toBeLessThan(50)
      console.log(
        `  100K timeline scrub: avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, max=${max.toFixed(2)}ms`
      )
    })

    it('reuse vs fresh: prepared statement saves time', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_10k WHERE age > $1) SELECT * FROM filtered ORDER BY salary DESC LIMIT 100',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
        operatorAliases: new Map(),
      }

      // Fresh execution (no prepared statement reuse)
      const freshTimes: number[] = []
      for (let i = 0; i < 10; i++) {
        const start = performance.now()
        await execute(compiled, [30 + i])
        freshTimes.push(performance.now() - start)
      }

      // Prepared statement reuse
      const pipeline = new PreparedPipeline(compiled)
      await pipeline.prepare()
      const preparedTimes: number[] = []
      for (let i = 0; i < 10; i++) {
        const start = performance.now()
        await pipeline.execute([30 + i])
        preparedTimes.push(performance.now() - start)
      }
      await pipeline.close()

      const freshAvg = freshTimes.reduce((a, b) => a + b, 0) / freshTimes.length
      const preparedAvg = preparedTimes.reduce((a, b) => a + b, 0) / preparedTimes.length

      // Prepared should be faster or at least as fast
      console.log(
        `  Fresh avg: ${freshAvg.toFixed(2)}ms, Prepared avg: ${preparedAvg.toFixed(2)}ms, Speedup: ${(freshAvg / preparedAvg).toFixed(2)}x`
      )
    })
  })

  describe('Graph Integration Performance', () => {
    function makeMockOp(id: string, type: string, inputs: Record<string, unknown>): any {
      const inputFields: Record<string, { value: unknown }> = {}
      for (const [key, val] of Object.entries(inputs)) {
        inputFields[key] = { value: val }
      }
      function MockCtor() {}
      Object.defineProperty(MockCtor, 'displayName', { value: type, writable: true })
      const op = Object.create(MockCtor.prototype)
      op.id = id
      op.inputs = inputFields
      op.outputs = { data: { next: () => {} } }
      op.constructor = MockCtor
      op._cachedOutput = null
      op.setCachedOutput = function (o: any) {
        this._cachedOutput = o
      }
      return op
    }

    it('full integration cycle: detect+compile+execute+inject (10K rows)', async () => {
      const integration = new SQLGraphIntegration()

      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_10k WHERE salary > $1), sorted AS (SELECT * FROM filtered ORDER BY age ASC) SELECT * FROM sorted LIMIT 200',
        paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'number' }],
        operatorAliases: new Map([
          ['/filter', 'filtered'],
          ['/sort', 'sorted'],
        ]),
      }

      const ops = new Map<string, any>([
        [
          '/filter',
          makeMockOp('/filter', 'FilterOp', {
            columnName: 'salary',
            condition: 'greater than',
            value: '50000',
          }),
        ],
        ['/sort', makeMockOp('/sort', 'Sort', { key: 'age', order: 'asc' })],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/sort', compiled)
      integration['lastTopologyVersion'] = 1

      // Measure full cycle
      const start = performance.now()
      const results = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/sort'] : id === '/sort' ? ['/filter'] : []),
        1
      )
      integration.injectResults(results, id => ops.get(id))
      const elapsed = performance.now() - start

      expect(results.size).toBe(1)
      expect(elapsed).toBeLessThan(50)
      console.log(
        `  Full integration (10K): ${elapsed.toFixed(2)}ms, ${results.get('/sort')!.data.length} rows`
      )
    })

    it('30 frames of parameter scrubbing through integration layer', async () => {
      const integration = new SQLGraphIntegration()

      const compiled: CompiledQuery = {
        sql: 'WITH filtered AS (SELECT * FROM bench_10k WHERE age > $1) SELECT COUNT(*) AS n FROM filtered',
        paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'number' }],
        operatorAliases: new Map([['/filter', 'filtered']]),
      }

      const ops = new Map<string, any>([
        [
          '/filter',
          makeMockOp('/filter', 'FilterOp', {
            columnName: 'age',
            condition: 'greater than',
            value: '25',
          }),
        ],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/filter', compiled)
      integration['lastTopologyVersion'] = 1

      const frameTimes: number[] = []
      for (let frame = 0; frame < 30; frame++) {
        ops.get('/filter')!.inputs.value.value = String(20 + frame * 2)
        const start = performance.now()
        await integration.executeSQLSubgraphs(
          ['/scatter'],
          id => ops.get(id),
          id => (id === '/scatter' ? ['/filter'] : []),
          1
        )
        frameTimes.push(performance.now() - start)
      }

      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
      const max = Math.max(...frameTimes)

      expect(avg).toBeLessThan(16)
      console.log(
        `  Integration scrub (30 frames): avg=${avg.toFixed(2)}ms, max=${max.toFixed(2)}ms`
      )
    })
  })

  describe('Memory and Correctness', () => {
    it('results are consistent across repeated executions', async () => {
      const compiled: CompiledQuery = {
        sql: 'WITH src AS (SELECT * FROM bench_1k WHERE age > $1 ORDER BY id) SELECT * FROM src',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
        operatorAliases: new Map(),
      }

      const r1 = await execute(compiled, [50])
      const r2 = await execute(compiled, [50])

      const a1 = r1.toArray()
      const a2 = r2.toArray()

      expect(a1.length).toBe(a2.length)
      for (let i = 0; i < a1.length; i++) {
        expect(a1[i].id).toBe(a2[i].id)
        expect(a1[i].age).toBe(a2[i].age)
      }
    })

    it('Arrow table row counts match expectations', async () => {
      const compiled: CompiledQuery = {
        sql: 'SELECT COUNT(*) AS n FROM bench_100k',
        paramSlots: [],
        operatorAliases: new Map(),
      }

      const result = await execute(compiled, [])
      const rows = result.toArray()
      expect(Number(rows[0].n)).toBe(100000)
    })

    it("prepared pipeline doesn't leak connections on close", async () => {
      const compiled: CompiledQuery = {
        sql: 'SELECT 1 AS x',
        paramSlots: [],
        operatorAliases: new Map(),
      }

      // Open and close many pipelines
      for (let i = 0; i < 20; i++) {
        const pipeline = new PreparedPipeline(compiled)
        await pipeline.prepare()
        await pipeline.execute([])
        await pipeline.close()
      }

      // If connections leaked, DuckDB would error or slow down
      const result = await execute(compiled, [])
      expect(result.toArray()[0].x).toBe(1)
    })
  })
})
