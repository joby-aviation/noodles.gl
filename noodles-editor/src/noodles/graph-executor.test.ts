// Test file for GraphExecutor implementation
import { describe, it, expect } from 'vitest'
import { GraphExecutor, topologicalSort } from './graph-executor'
import { ForEachBeginOp, ForEachEndOp, ForEachMetaOp } from './operators'
import type { Operator, IOperator } from './operators'

describe('GraphExecutor', () => {
  it('should create a GraphExecutor instance', () => {
    const executor = new GraphExecutor()
    expect(executor).toBeDefined()
    expect(executor.getStats()).toEqual({
      nodeCount: 0,
      edgeCount: 0,
      lastExecutionTime: 0,
      dirtyCount: 0,
    })
  })

  it('should perform topological sort', () => {
    const nodes = new Map<string, Operator<IOperator>>([
      ['a', { id: 'a' } as any],
      ['b', { id: 'b' } as any],
      ['c', { id: 'c' } as any],
    ])

    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]

    const result = topologicalSort(nodes, edges)
    expect(result.sorted).toEqual(['a', 'b', 'c'])
    expect(result.cycles).toEqual([])
  })

  it('should detect cycles', () => {
    const nodes = new Map<string, Operator<IOperator>>([
      ['a', { id: 'a' } as any],
      ['b', { id: 'b' } as any],
      ['c', { id: 'c' } as any],
    ])

    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' }, // Creates cycle
    ]

    const result = topologicalSort(nodes, edges)
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it('should create a GraphScope', () => {
    const executor = new GraphExecutor()
    const scope = executor.createScope('test-scope')
    expect(scope).toBeDefined()
  })
})

describe('ForEach operators', () => {
  it('should create ForEachBeginOp instance', () => {
    const op = new ForEachBeginOp('/foreach-begin')
    expect(op).toBeDefined()
    expect(op.id).toBe('/foreach-begin')
    expect(op.inputs.data).toBeDefined()
    expect(op.outputs.item).toBeDefined()
    expect(op.outputs.index).toBeDefined()
    expect(op.outputs.total).toBeDefined()
  })

  it('should create ForEachEndOp instance', () => {
    const op = new ForEachEndOp('/foreach-end')
    expect(op).toBeDefined()
    expect(op.inputs.result).toBeDefined()
    expect(op.outputs.results).toBeDefined()
  })

  it('should create ForEachMetaOp instance', () => {
    const op = new ForEachMetaOp('/foreach-meta')
    expect(op).toBeDefined()
    expect(op.inputs.initialValue).toBeDefined()
    expect(op.inputs.currentValue).toBeDefined()
    expect(op.outputs.accumulator).toBeDefined()
    expect(op.outputs.index).toBeDefined()
    expect(op.outputs.total).toBeDefined()
    expect(op.outputs.isFirst).toBeDefined()
    expect(op.outputs.isLast).toBeDefined()
  })
})