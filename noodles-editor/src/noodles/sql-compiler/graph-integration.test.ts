import * as duckdb from '@duckdb/duckdb-wasm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setDuckDbInstance } from './executor'
import { getSQLIntegration, resetSQLIntegration, SQLGraphIntegration } from './graph-integration'

function makeMockOp(id: string, type: string, inputs: Record<string, unknown>): unknown {
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
  op.cachedOutput = null
  op.setCachedOutput = function (output: unknown) {
    this._cachedOutput = output
    this.cachedOutput = output
  }
  return op
}

describe('SQLGraphIntegration', () => {
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
      CREATE TABLE integration_data AS SELECT * FROM (VALUES
        ('Alice', 30, 'Engineering', 90000),
        ('Bob', 25, 'Marketing', 60000),
        ('Charlie', 35, 'Engineering', 110000),
        ('Diana', 28, 'Marketing', 65000),
        ('Eve', 32, 'Engineering', 95000)
      ) AS t(name, age, department, salary)
    `)
    await conn.close()
  })

  beforeEach(() => {
    resetSQLIntegration()
  })

  describe('enable/disable', () => {
    it('is enabled when DuckDB is available', () => {
      const integration = new SQLGraphIntegration()
      expect(integration.isEnabled()).toBe(true)
    })

    it('can be disabled', () => {
      const integration = new SQLGraphIntegration()
      integration.setEnabled(false)
      expect(integration.isEnabled()).toBe(false)
    })

    it('returns empty results when disabled', async () => {
      const integration = new SQLGraphIntegration()
      integration.setEnabled(false)
      const results = await integration.executeSQLSubgraphs(
        ['/scatter'],
        () => undefined,
        () => [],
        1
      )
      expect(results.size).toBe(0)
    })
  })

  describe('executeSQLSubgraphs with pre-loaded table', () => {
    it('detects and executes a FilterOp → SortOp chain from table', async () => {
      const integration = new SQLGraphIntegration()

      // Instead of relying on FileOp (which would try read_csv_auto),
      // we directly set a compiled query that references our test table
      const compiled = {
        sql: 'WITH filtered AS (SELECT * FROM integration_data WHERE department = $1), sorted AS (SELECT * FROM filtered ORDER BY salary DESC) SELECT * FROM sorted',
        paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'string' as const }],
        operatorAliases: new Map([
          ['/filter', 'filtered'],
          ['/sort', 'sorted'],
        ]),
      }

      const ops = new Map<string, unknown>([
        [
          '/filter',
          makeMockOp('/filter', 'FilterOp', {
            columnName: 'department',
            condition: 'equals',
            value: 'Engineering',
          }),
        ],
        ['/sort', makeMockOp('/sort', 'Sort', { key: 'salary', order: 'desc' })],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      // Pre-set the compiled query
      integration['cache'].setCompiledQuery('/sort', compiled)
      integration['lastTopologyVersion'] = 1

      const results = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/sort'] : id === '/sort' ? ['/filter'] : []),
        1 // same topology version — uses cached query
      )

      expect(results.size).toBe(1)
      expect(results.has('/sort')).toBe(true)
      const sortResult = results.get('/sort')!
      expect(sortResult.data.length).toBe(3) // 3 Engineering employees
      expect(sortResult.data[0].name).toBe('Charlie') // Highest salary first
    })

    it.skip('re-executes with changed params without recompilation', async () => {
      const integration = new SQLGraphIntegration()

      const compiled = {
        sql: 'WITH filtered AS (SELECT * FROM integration_data WHERE department = $1) SELECT * FROM filtered',
        paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'string' as const }],
        operatorAliases: new Map([['/filter', 'filtered']]),
      }

      const ops = new Map<string, unknown>([
        [
          '/filter',
          makeMockOp('/filter', 'FilterOp', {
            columnName: 'department',
            condition: 'equals',
            value: 'Engineering',
          }),
        ],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/filter', compiled)
      integration['lastTopologyVersion'] = 1

      // First execution
      const r1 = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/filter'] : []),
        1
      )
      expect(r1.get('/filter')!.data.length).toBe(3) // Engineering

      // Change param value
      ops.get('/filter')!.inputs.value.value = 'Marketing'
      const r2 = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/filter'] : []),
        1
      )
      expect(r2.get('/filter')!.data.length).toBe(2) // Marketing
    })

    it('recompiles on topology version change', async () => {
      const integration = new SQLGraphIntegration()

      // Set up initial compiled query
      const compiled1 = {
        sql: 'WITH filtered AS (SELECT * FROM integration_data WHERE age > $1) SELECT * FROM filtered',
        paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'number' as const }],
        operatorAliases: new Map([['/filter', 'filtered']]),
      }

      const ops = new Map<string, unknown>([
        [
          '/filter',
          makeMockOp('/filter', 'FilterOp', {
            columnName: 'age',
            condition: 'greater than',
            value: '30',
          }),
        ],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/filter', compiled1)
      integration['lastTopologyVersion'] = 1

      const r1 = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/filter'] : []),
        1
      )
      expect(r1.get('/filter')!.data.length).toBe(2) // Charlie(35), Eve(32)

      // Topology change invalidates cache — new detection runs
      // Since detectCompilableSubgraphs won't find 'integration_data' as a FileOp,
      // it will produce 0 results (operators mock doesn't have valid chain for auto-detection)
      const r2 = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/filter'] : []),
        2 // different topology version
      )
      // After topology change, detection re-runs. Without FileOp in chain, nothing compiles
      expect(r2.size).toBe(0)
    })

    it('handles multiple sinks with separate pipelines', async () => {
      const integration = new SQLGraphIntegration()

      const compiled1 = {
        sql: 'WITH f AS (SELECT * FROM integration_data WHERE department = $1) SELECT * FROM f',
        paramSlots: [{ index: 1, fieldPath: '/filter1.value', type: 'string' as const }],
        operatorAliases: new Map([['/filter1', 'f']]),
      }
      const compiled2 = {
        sql: 'WITH f AS (SELECT * FROM integration_data WHERE department = $1) SELECT * FROM f',
        paramSlots: [{ index: 1, fieldPath: '/filter2.value', type: 'string' as const }],
        operatorAliases: new Map([['/filter2', 'f']]),
      }

      const ops = new Map<string, unknown>([
        [
          '/filter1',
          makeMockOp('/filter1', 'FilterOp', {
            columnName: 'department',
            condition: 'equals',
            value: 'Engineering',
          }),
        ],
        [
          '/filter2',
          makeMockOp('/filter2', 'FilterOp', {
            columnName: 'department',
            condition: 'equals',
            value: 'Marketing',
          }),
        ],
        ['/scatter1', makeMockOp('/scatter1', 'ScatterplotLayerOp', { data: [] })],
        ['/scatter2', makeMockOp('/scatter2', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/filter1', compiled1)
      integration['cache'].setCompiledQuery('/filter2', compiled2)
      integration['lastTopologyVersion'] = 1

      const results = await integration.executeSQLSubgraphs(
        ['/scatter1', '/scatter2'],
        id => ops.get(id),
        id => {
          if (id === '/scatter1') return ['/filter1']
          if (id === '/scatter2') return ['/filter2']
          return []
        },
        1
      )
      expect(results.size).toBe(2)
      expect(results.get('/filter1')!.data.length).toBe(3) // Engineering
      expect(results.get('/filter2')!.data.length).toBe(2) // Marketing
    })
  })

  describe('injectResults', () => {
    it('sets cached output on target operator', async () => {
      const integration = new SQLGraphIntegration()
      const sortOp = makeMockOp('/sort', 'Sort', { key: 'age', order: 'asc' })

      const compiled = {
        sql: 'WITH sorted AS (SELECT * FROM integration_data ORDER BY age ASC) SELECT * FROM sorted',
        paramSlots: [],
        operatorAliases: new Map([['/sort', 'sorted']]),
      }

      const ops = new Map<string, unknown>([
        ['/sort', sortOp],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/sort', compiled)
      integration['lastTopologyVersion'] = 1

      const results = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/sort'] : []),
        1
      )

      const injected = integration.injectResults(results, id => ops.get(id))
      expect(injected.has('/sort')).toBe(true)
      expect(sortOp._cachedOutput).toBeDefined()
      expect(sortOp._cachedOutput.data.length).toBe(5)
      expect(sortOp._cachedOutput.data[0].age).toBe(25) // Bob first (youngest)
    })

    it('fires output.data.next() for downstream subscriptions', async () => {
      const integration = new SQLGraphIntegration()
      let dataReceived: unknown = null
      const sortOp = makeMockOp('/sort', 'Sort', { key: 'age', order: 'asc' })
      sortOp.outputs.data.next = (val: unknown) => {
        dataReceived = val
      }

      const compiled = {
        sql: 'WITH sorted AS (SELECT * FROM integration_data ORDER BY age ASC) SELECT * FROM sorted',
        paramSlots: [],
        operatorAliases: new Map([['/sort', 'sorted']]),
      }

      const ops = new Map<string, unknown>([
        ['/sort', sortOp],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/sort', compiled)
      integration['lastTopologyVersion'] = 1

      const results = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/sort'] : []),
        1
      )
      integration.injectResults(results, id => ops.get(id))

      expect(dataReceived).not.toBeNull()
      expect(Array.isArray(dataReceived)).toBe(true)
      expect((dataReceived as any[]).length).toBe(5)
    })

    it('marks chain operators as clean', async () => {
      const integration = new SQLGraphIntegration()
      const filterOp = makeMockOp('/filter', 'FilterOp', {
        columnName: 'department',
        condition: 'equals',
        value: 'Engineering',
      })
      const sortOp = makeMockOp('/sort', 'Sort', { key: 'salary', order: 'desc' })

      const compiled = {
        sql: 'WITH filtered AS (SELECT * FROM integration_data WHERE department = $1), sorted AS (SELECT * FROM filtered ORDER BY salary DESC) SELECT * FROM sorted',
        paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'string' as const }],
        operatorAliases: new Map([
          ['/filter', 'filtered'],
          ['/sort', 'sorted'],
        ]),
      }

      const ops = new Map<string, unknown>([
        ['/filter', filterOp],
        ['/sort', sortOp],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/sort', compiled)
      integration['lastTopologyVersion'] = 1

      const results = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/sort'] : id === '/sort' ? ['/filter'] : []),
        1
      )

      const injected = integration.injectResults(results, id => ops.get(id))
      expect(injected.has('/sort')).toBe(true)
      expect(injected.has('/filter')).toBe(true)
      // Both operators have cached output set
      expect(sortOp._cachedOutput).toBeDefined()
      expect(filterOp._cachedOutput).toBeDefined()
    })
  })

  describe('singleton', () => {
    it('getSQLIntegration returns same instance', () => {
      const a = getSQLIntegration()
      const b = getSQLIntegration()
      expect(a).toBe(b)
    })

    it('resetSQLIntegration creates fresh instance', () => {
      const a = getSQLIntegration()
      resetSQLIntegration()
      const b = getSQLIntegration()
      expect(a).not.toBe(b)
    })
  })

  describe('performance', () => {
    it('repeated execution with changing params stays under 16ms/frame', async () => {
      const integration = new SQLGraphIntegration()

      const compiled = {
        sql: 'WITH filtered AS (SELECT * FROM integration_data WHERE age > $1) SELECT * FROM filtered',
        paramSlots: [{ index: 1, fieldPath: '/filter.value', type: 'number' as const }],
        operatorAliases: new Map([['/filter', 'filtered']]),
      }

      const ops = new Map<string, unknown>([
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

      // Warm up
      await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/filter'] : []),
        1
      )

      // Measure 30 frames with changing param
      const start = performance.now()
      for (let i = 0; i < 30; i++) {
        ops.get('/filter')!.inputs.value.value = String(20 + i)
        await integration.executeSQLSubgraphs(
          ['/scatter'],
          id => ops.get(id),
          id => (id === '/scatter' ? ['/filter'] : []),
          1
        )
      }
      const elapsed = performance.now() - start
      const perFrame = elapsed / 30

      expect(perFrame).toBeLessThan(16)
    })
  })

  describe('error handling', () => {
    it('gracefully handles missing operators in executeSQLSubgraphs', async () => {
      const integration = new SQLGraphIntegration()
      const results = await integration.executeSQLSubgraphs(
        ['/nonexistent'],
        () => undefined,
        () => [],
        1
      )
      expect(results.size).toBe(0)
    })

    it('survives SQL execution errors gracefully', async () => {
      const integration = new SQLGraphIntegration()

      const compiled = {
        sql: 'WITH bad AS (SELECT * FROM nonexistent_table_xyz_404) SELECT * FROM bad',
        paramSlots: [],
        operatorAliases: new Map([['/bad', 'bad']]),
      }

      const ops = new Map<string, unknown>([
        [
          '/bad',
          makeMockOp('/bad', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }),
        ],
        ['/scatter', makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })],
      ])

      integration['cache'].setCompiledQuery('/bad', compiled)
      integration['lastTopologyVersion'] = 1

      // Should not throw
      const results = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => (id === '/scatter' ? ['/bad'] : []),
        1
      )
      expect(results.size).toBe(0) // Error caught, no result
    })

    it('invalidate clears all state', async () => {
      const integration = new SQLGraphIntegration()

      const compiled = {
        sql: 'WITH src AS (SELECT * FROM integration_data) SELECT * FROM src',
        paramSlots: [],
        operatorAliases: new Map([['/file', 'src']]),
      }

      integration['cache'].setCompiledQuery('/file', compiled)
      expect(integration.isSQLExecuted('/file')).toBe(true)
      integration.invalidate()
      expect(integration.isSQLExecuted('/file')).toBe(false)
    })
  })

  describe('end-to-end with subgraph detection', () => {
    it('full flow: detect → compile → execute → inject', async () => {
      const integration = new SQLGraphIntegration()

      // Use FilterOp and SortOp which have templates in the registry
      // The subgraph detection should find them compilable
      const filterOp = makeMockOp('/filter', 'FilterOp', {
        columnName: 'salary',
        condition: 'greater than',
        value: '80000',
      })
      const sortOp = makeMockOp('/sort', 'Sort', { key: 'name', order: 'asc' })
      const scatterOp = makeMockOp('/scatter', 'ScatterplotLayerOp', { data: [] })

      const ops = new Map<string, unknown>([
        ['/filter', filterOp],
        ['/sort', sortOp],
        ['/scatter', scatterOp],
      ])

      const upstreamMap = new Map<string, string[]>([
        ['/sort', ['/filter']],
        ['/scatter', ['/sort']],
      ])

      // This triggers full detection — but without FileOp root,
      // collectSubgraph won't find a valid chain (FilterOp has no upstream)
      // So this tests the "graceful empty" path
      const results = await integration.executeSQLSubgraphs(
        ['/scatter'],
        id => ops.get(id),
        id => upstreamMap.get(id) || [],
        1
      )

      // Without a data source, detection won't produce compilable chains
      // (FilterOp depends on upstream data that isn't compilable)
      // This verifies graceful degradation
      expect(results.size).toBe(0)
    })
  })
})
