import { describe, expect, it } from 'vitest'
import {
  CastOp,
  CoalesceOp,
  FillNullsOp,
  GroupByOp,
  JoinOp,
  PivotOp,
  StringTransformOp,
  UniqueOp,
  UnpivotOp,
  WindowOp,
} from '../operators'
import { isSQLCompilable } from './types'
import { createCompilationContext } from './compiler'
import { operatorIdToAlias } from './utils'

describe('SQL-Native Operators: execute() (POJO fallback)', () => {
  it('GroupByOp groups and aggregates', () => {
    const op = new GroupByOp('/group' as any, {
      groupByColumns: 'category',
      aggregations: 'sum(price) as total; count(*) as n',
    } as any)
    op.inputs.data.next([
      { category: 'A', price: 10 },
      { category: 'A', price: 20 },
      { category: 'B', price: 5 },
    ])
    const result = op.execute(op.data)
    expect(result.data).toHaveLength(2)
    const a = result.data.find((r: any) => r.category === 'A')
    expect(a.total).toBe(30)
    expect(a.n).toBe(2)
  })

  it('JoinOp performs left join', () => {
    const op = new JoinOp('/join' as any, {
      leftKey: 'id',
      rightKey: 'user_id',
      joinType: 'left',
    } as any)
    op.inputs.left.next([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])
    op.inputs.right.next([{ user_id: 1, score: 100 }])
    const result = op.execute(op.data)
    expect(result.data).toHaveLength(2)
    expect(result.data[0].score).toBe(100)
    expect(result.data[1].score).toBeUndefined()
  })

  it('UniqueOp removes duplicates', () => {
    const op = new UniqueOp('/unique' as any, { columns: '' } as any)
    op.inputs.data.next([{ a: 1 }, { a: 1 }, { a: 2 }])
    const result = op.execute(op.data)
    expect(result.data).toHaveLength(2)
  })

  it('PivotOp pivots rows to columns', () => {
    const op = new PivotOp('/pivot' as any, {
      pivotColumn: 'month',
      valueColumn: 'amount',
      indexColumn: 'product',
      aggregation: 'sum',
    } as any)
    op.inputs.data.next([
      { product: 'X', month: 'Jan', amount: 10 },
      { product: 'X', month: 'Feb', amount: 20 },
      { product: 'Y', month: 'Jan', amount: 5 },
    ])
    const result = op.execute(op.data)
    expect(result.data).toHaveLength(2)
    const x = result.data.find((r: any) => r.product === 'X')
    expect(x.Jan).toBe(10)
    expect(x.Feb).toBe(20)
  })

  it('UnpivotOp converts columns to rows', () => {
    const op = new UnpivotOp('/unpivot' as any, {
      valueColumns: 'Jan,Feb',
      variableName: 'month',
      valueName: 'amount',
    } as any)
    op.inputs.data.next([{ product: 'X', Jan: 10, Feb: 20 }])
    const result = op.execute(op.data)
    expect(result.data).toHaveLength(2)
    expect(result.data[0].month).toBe('Jan')
    expect(result.data[0].amount).toBe(10)
    expect(result.data[1].month).toBe('Feb')
  })

  it('WindowOp computes row_number', () => {
    const op = new WindowOp('/window' as any, {
      column: 'val',
      function: 'row_number',
      partitionBy: '',
      orderBy: 'val',
      order: 'asc',
      windowSize: 0,
      outputColumn: 'rn',
    } as any)
    op.inputs.data.next([{ val: 30 }, { val: 10 }, { val: 20 }])
    const result = op.execute(op.data)
    expect(result.data).toHaveLength(3)
    expect(result.data[0].rn).toBe(1)
    expect(result.data[0].val).toBe(10)
  })

  it('WindowOp computes rolling sum', () => {
    const op = new WindowOp('/window' as any, {
      column: 'val',
      function: 'sum',
      partitionBy: '',
      orderBy: 'val',
      order: 'asc',
      windowSize: 2,
      outputColumn: 'rolling',
    } as any)
    op.inputs.data.next([{ val: 1 }, { val: 2 }, { val: 3 }])
    const result = op.execute(op.data)
    expect(result.data[0].rolling).toBe(1)
    expect(result.data[1].rolling).toBe(3)
    expect(result.data[2].rolling).toBe(5)
  })

  it('CastOp casts to INTEGER', () => {
    const op = new CastOp('/cast' as any, {
      column: 'val',
      targetType: 'INTEGER',
      outputColumn: 'int_val',
    } as any)
    op.inputs.data.next([{ val: '42.7' }, { val: '3.14' }])
    const result = op.execute(op.data)
    expect(result.data[0].int_val).toBe(43)
    expect(result.data[1].int_val).toBe(3)
  })

  it('StringTransformOp applies upper', () => {
    const op = new StringTransformOp('/str' as any, {
      column: 'name',
      operation: 'upper',
      pattern: '',
      replacement: '',
      outputColumn: 'upper_name',
    } as any)
    op.inputs.data.next([{ name: 'hello' }, { name: 'world' }])
    const result = op.execute(op.data)
    expect(result.data[0].upper_name).toBe('HELLO')
  })

  it('CoalesceOp returns first non-null', () => {
    const op = new CoalesceOp('/coalesce' as any, {
      columns: 'a,b,c',
      outputColumn: 'result',
    } as any)
    op.inputs.data.next([
      { a: null, b: null, c: 3 },
      { a: 1, b: 2, c: 3 },
    ])
    const result = op.execute(op.data)
    expect(result.data[0].result).toBe(3)
    expect(result.data[1].result).toBe(1)
  })

  it('FillNullsOp forward fills', () => {
    const op = new FillNullsOp('/fill' as any, {
      column: 'val',
      strategy: 'forward',
      constantValue: '',
      orderBy: '',
    } as any)
    op.inputs.data.next([{ val: 1 }, { val: null }, { val: null }, { val: 4 }])
    const result = op.execute(op.data)
    expect(result.data[1].val).toBe(1)
    expect(result.data[2].val).toBe(1)
    expect(result.data[3].val).toBe(4)
  })
})

describe('SQL-Native Operators: toSQL()', () => {
  it('all SQL-native operators implement SQLCompilable', () => {
    const ops = [
      new GroupByOp('/g' as any),
      new JoinOp('/j' as any),
      new UniqueOp('/u' as any),
      new PivotOp('/p' as any),
      new UnpivotOp('/up' as any),
      new WindowOp('/w' as any),
      new CastOp('/c' as any),
      new StringTransformOp('/st' as any),
      new CoalesceOp('/co' as any),
      new FillNullsOp('/fn' as any),
    ]
    for (const op of ops) {
      expect(isSQLCompilable(op)).toBe(true)
    }
  })

  it('GroupByOp.toSQL generates correct SQL', () => {
    const op = new GroupByOp('/sales-by-cat' as any, {
      groupByColumns: 'category',
      aggregations: 'sum(price) as total; count(*) as n',
    } as any)
    const ctx = createCompilationContext()
    ctx.aliases.set('/source', 'source')

    // Simulate upstream
    ;(op as any)._upstreamDependencies = new Set([{ id: '/source' }])
    const fragment = op.toSQL(ctx)

    expect(fragment.alias).toBe('sales_by_cat')
    expect(fragment.cte).toContain('GROUP BY')
    expect(fragment.cte).toContain('SUM')
    expect(fragment.cte).toContain('COUNT')
    expect(fragment.cte).toContain('FROM source')
  })

  it('WindowOp.toSQL generates window function SQL', () => {
    const op = new WindowOp('/windowed' as any, {
      column: 'val',
      function: 'sum',
      partitionBy: 'grp',
      orderBy: 'val',
      order: 'asc',
      windowSize: 3,
      outputColumn: 'rolling_sum',
    } as any)
    const ctx = createCompilationContext()
    ctx.aliases.set('/data', 'data')
    ;(op as any)._upstreamDependencies = new Set([{ id: '/data' }])
    const fragment = op.toSQL(ctx)

    expect(fragment.cte).toContain('SUM("val") OVER')
    expect(fragment.cte).toContain('PARTITION BY "grp"')
    expect(fragment.cte).toContain('ORDER BY "val" ASC')
    expect(fragment.cte).toContain('ROWS BETWEEN 2 PRECEDING AND CURRENT ROW')
    expect(fragment.cte).toContain('AS "rolling_sum"')
  })

  it('CastOp.toSQL generates CAST expression', () => {
    const op = new CastOp('/typed' as any, {
      column: 'age',
      targetType: 'INTEGER',
      outputColumn: '',
    } as any)
    const ctx = createCompilationContext()
    ctx.aliases.set('/src', 'src')
    ;(op as any)._upstreamDependencies = new Set([{ id: '/src' }])
    const fragment = op.toSQL(ctx)

    expect(fragment.cte).toContain('CAST("age" AS INTEGER)')
    expect(fragment.cte).toContain('REPLACE')
  })
})
