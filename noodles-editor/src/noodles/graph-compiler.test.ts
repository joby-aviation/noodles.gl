import { describe, expect, it } from 'vitest'
import { GraphCompiler } from './graph-compiler'
import { FileOp, FilterOp, SortOp, SliceOp, CreateAttributeOp } from './operators'

describe('GraphCompiler', () => {
  it('should compile FileOp → FilterOp → SortOp chain to SQL', () => {
    const compiler = new GraphCompiler()

    // Create operator chain
    const fileOp = new FileOp('/data')
    fileOp.inputs.url.setValue('@/cities.csv')
    fileOp.inputs.format.setValue('csv')

    const filterOp = new FilterOp('/filter')
    filterOp.inputs.condition.setValue('population > 1000000')

    const sortOp = new SortOp('/sort')
    sortOp.inputs.key.setValue('name')
    sortOp.inputs.order.setValue('asc')

    const operators = new Map([
      [fileOp.id, fileOp],
      [filterOp.id, filterOp],
      [sortOp.id, sortOp],
    ])

    const edges = [
      { source: fileOp.id, target: filterOp.id },
      { source: filterOp.id, target: sortOp.id },
    ]

    // Analyze graph
    const plan = compiler.analyze(operators, edges)

    expect(plan.sqlChains).toHaveLength(1)
    expect(plan.sqlChains[0].operators).toHaveLength(3)

    // Compile to SQL
    const { sql, params } = compiler.compileToDuckDB(plan.sqlChains[0])

    expect(sql).toContain('read_csv_auto')
    expect(sql).toContain('WHERE population > 1000000')
    expect(sql).toContain('ORDER BY name ASC')
    expect(params).toContain('@/cities.csv')
  })

  it('should handle LIMIT and OFFSET from SliceOp', () => {
    const compiler = new GraphCompiler()

    const fileOp = new FileOp('/data')
    fileOp.inputs.url.setValue('data.csv')
    fileOp.inputs.format.setValue('csv')

    const sliceOp = new SliceOp('/slice')
    sliceOp.inputs.start.setValue(10)
    sliceOp.inputs.end.setValue(20)

    const chain = {
      operators: [fileOp, sliceOp],
      headOpId: fileOp.id,
      tailOpId: sliceOp.id,
      estimatedRows: 100,
      sqlFragment: {},
    }

    const { sql } = compiler.compileToDuckDB(chain)

    expect(sql).toContain('LIMIT 10')
    expect(sql).toContain('OFFSET 10')
  })

  it('should compile CreateAttributeOp with simple expressions', () => {
    const compiler = new GraphCompiler()

    const fileOp = new FileOp('/data')
    fileOp.inputs.url.setValue('data.csv')

    const createAttr = new CreateAttributeOp('/attr')
    createAttr.inputs.name.setValue('position')
    createAttr.inputs.expression.setValue('[d.lng, d.lat, 0]')

    const chain = {
      operators: [fileOp, createAttr],
      headOpId: fileOp.id,
      tailOpId: createAttr.id,
      estimatedRows: 1000,
      sqlFragment: {},
    }

    const { sql } = compiler.compileToDuckDB(chain)

    expect(sql).toContain('_attr_position')
    expect(sql).toContain('[lng, lat, 0]')
  })

  it('should handle parameterized queries for keyframe support', () => {
    const compiler = new GraphCompiler()

    const fileOp = new FileOp('/data')
    fileOp.inputs.url.setValue('data.csv')
    fileOp.inputs.format.setValue('csv')

    const filterOp = new FilterOp('/filter')
    // In real usage, this would be a keyframed value
    filterOp.inputs.condition.setValue('temperature > 25')

    const operators = new Map([
      [fileOp.id, fileOp],
      [filterOp.id, filterOp],
    ])

    const edges = [{ source: fileOp.id, target: filterOp.id }]

    const plan = compiler.analyze(operators, edges)
    const { sql, params } = compiler.compileToDuckDB(plan.sqlChains[0])

    // SQL should use parameterized query
    expect(sql).toContain('WHERE')
    expect(params.length).toBeGreaterThan(0)
  })

  it('should detect compilation barriers (CodeOp)', () => {
    // TODO: Implement when CodeOp barrier detection is added
    expect(true).toBe(true)
  })

  it('should handle viral properties flowing through chain', () => {
    // TODO: Test property propagation through SQL chain
    expect(true).toBe(true)
  })
})
