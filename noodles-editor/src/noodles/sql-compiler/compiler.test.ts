import { describe, expect, it } from 'vitest'
import { compilePipeline, createCompilationContext } from './compiler'
import type { CompilationContext, SQLCompilable, SQLFragment } from './types'
import { operatorIdToAlias } from './utils'

// Mock operator that implements SQLCompilable for testing
class MockSQLOp {
  id: string
  _upstreamDependencies: Set<MockSQLOp> = new Set()
  private sqlFn: (ctx: CompilationContext) => SQLFragment

  constructor(id: string, sqlFn: (ctx: CompilationContext) => SQLFragment) {
    this.id = id
    this.sqlFn = sqlFn
  }

  toSQL(ctx: CompilationContext): SQLFragment {
    return this.sqlFn(ctx)
  }
}

describe('operatorIdToAlias', () => {
  it('converts operator IDs to valid SQL aliases', () => {
    expect(operatorIdToAlias('/data-loader')).toBe('data_loader')
    expect(operatorIdToAlias('/my/nested/op')).toBe('my_nested_op')
    expect(operatorIdToAlias('/filter-1')).toBe('filter_1')
    expect(operatorIdToAlias('/CamelCase')).toBe('camelcase')
  })
})

describe('createCompilationContext', () => {
  it('increments parameter indices', () => {
    const ctx = createCompilationContext()
    expect(ctx.nextParamIndex()).toBe(1)
    expect(ctx.nextParamIndex()).toBe(2)
    expect(ctx.nextParamIndex()).toBe(3)
  })

  it('tracks aliases', () => {
    const ctx = createCompilationContext()
    ctx.aliases.set('/source', 'source')
    expect(ctx.getUpstreamAlias('/source')).toBe('source')
    expect(ctx.getUpstreamAlias('/missing')).toBeNull()
  })
})

describe('compilePipeline', () => {
  it('compiles a single operator to a CTE', () => {
    const source = new MockSQLOp('/source', (ctx) => ({
      alias: operatorIdToAlias('/source'),
      cte: "SELECT * FROM read_csv_auto('/data.csv')",
      params: [],
      udfs: [],
    }))

    const result = compilePipeline([source as any])

    expect(result.sql).toContain('WITH')
    expect(result.sql).toContain('source AS')
    expect(result.sql).toContain("read_csv_auto('/data.csv')")
    expect(result.sql).toContain('SELECT * FROM source')
    expect(result.sinkAlias).toBe('source')
  })

  it('compiles a chain of operators to multiple CTEs', () => {
    const source = new MockSQLOp('/source', (ctx) => ({
      alias: 'source',
      cte: "SELECT * FROM read_csv_auto('/data.csv')",
      params: [],
      udfs: [],
    }))

    const filter = new MockSQLOp('/filter', (ctx) => {
      const upstream = ctx.getUpstreamAlias('/source')
      return {
        alias: 'filter_1',
        cte: `SELECT * FROM ${upstream} WHERE value > 50`,
        params: [],
        udfs: [],
      }
    })

    const sort = new MockSQLOp('/sort', (ctx) => {
      const upstream = ctx.getUpstreamAlias('/filter')
      return {
        alias: 'sort_1',
        cte: `SELECT * FROM ${upstream} ORDER BY value DESC`,
        params: [],
        udfs: [],
      }
    })

    // Register aliases as they would be during compilation
    const result = compilePipeline([source, filter, sort] as any[])

    expect(result.sql).toContain('source AS')
    expect(result.sql).toContain('filter_1 AS')
    expect(result.sql).toContain('sort_1 AS')
    expect(result.sql).toContain('SELECT * FROM sort_1')
    expect(result.sinkAlias).toBe('sort_1')
  })

  it('collects parameters from all operators', () => {
    const source = new MockSQLOp('/source', (ctx) => {
      const idx = ctx.nextParamIndex()
      return {
        alias: 'source',
        cte: `SELECT * FROM read_csv_auto($${idx})`,
        params: [{ index: idx, fieldPath: '/source.par.url', value: '/data.csv' }],
        udfs: [],
      }
    })

    const filter = new MockSQLOp('/filter', (ctx) => {
      const idx = ctx.nextParamIndex()
      const upstream = ctx.getUpstreamAlias('/source')
      return {
        alias: 'filter_1',
        cte: `SELECT * FROM ${upstream} WHERE value > $${idx}`,
        params: [{ index: idx, fieldPath: '/threshold.par.value', value: 50 }],
        udfs: [],
      }
    })

    const result = compilePipeline([source, filter] as any[])

    expect(result.params).toHaveLength(2)
    expect(result.params[0].fieldPath).toBe('/source.par.url')
    expect(result.params[0].value).toBe('/data.csv')
    expect(result.params[1].fieldPath).toBe('/threshold.par.value')
    expect(result.params[1].value).toBe(50)
    expect(result.sql).toContain('$1')
    expect(result.sql).toContain('$2')
  })

  it('handles empty operator list gracefully', () => {
    const result = compilePipeline([])
    expect(result.sql).toBe('SELECT 1')
    expect(result.params).toHaveLength(0)
  })

  it('compiles join with two upstream sources', () => {
    const flights = new MockSQLOp('/flights', (ctx) => ({
      alias: 'flights',
      cte: "SELECT * FROM read_csv_auto('/flights.csv')",
      params: [],
      udfs: [],
    }))

    const airports = new MockSQLOp('/airports', (ctx) => ({
      alias: 'airports',
      cte: "SELECT * FROM read_csv_auto('/airports.csv')",
      params: [],
      udfs: [],
    }))

    const join = new MockSQLOp('/join', (ctx) => {
      const left = ctx.getUpstreamAlias('/flights')
      const right = ctx.getUpstreamAlias('/airports')
      return {
        alias: 'joined',
        cte: `SELECT f.*, a.city FROM ${left} f LEFT JOIN ${right} a ON f.origin = a.code`,
        params: [],
        udfs: [],
      }
    })

    const result = compilePipeline([flights, airports, join] as any[])

    expect(result.sql).toContain('flights AS')
    expect(result.sql).toContain('airports AS')
    expect(result.sql).toContain('joined AS')
    expect(result.sql).toContain('LEFT JOIN airports')
    expect(result.sinkAlias).toBe('joined')
  })
})
