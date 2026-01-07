// Test file for GraphExecutor implementation
import { describe, it, expect } from 'vitest'
import { GraphExecutor, GraphScope, topologicalSort } from './graph-executor'
import {
  ForEachBeginOp,
  ForEachEndOp,
  ForEachMetaOp,
  NumberOp,
  MathOp,
} from './operators'
import type { Operator, IOperator } from './operators'

describe('topologicalSort', () => {
  it('should sort a linear chain correctly', () => {
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

  it('should handle diamond dependencies', () => {
    // a -> b -> d
    // a -> c -> d
    const nodes = new Map<string, Operator<IOperator>>([
      ['a', { id: 'a' } as any],
      ['b', { id: 'b' } as any],
      ['c', { id: 'c' } as any],
      ['d', { id: 'd' } as any],
    ])

    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ]

    const result = topologicalSort(nodes, edges)
    expect(result.cycles).toEqual([])
    // 'a' must come first, 'd' must come last
    expect(result.sorted[0]).toBe('a')
    expect(result.sorted[3]).toBe('d')
    // b and c can be in either order
    expect(result.sorted.slice(1, 3).sort()).toEqual(['b', 'c'])
  })

  it('should handle independent subgraphs', () => {
    const nodes = new Map<string, Operator<IOperator>>([
      ['a', { id: 'a' } as any],
      ['b', { id: 'b' } as any],
      ['x', { id: 'x' } as any],
      ['y', { id: 'y' } as any],
    ])

    const edges = [
      { source: 'a', target: 'b' },
      { source: 'x', target: 'y' },
    ]

    const result = topologicalSort(nodes, edges)
    expect(result.cycles).toEqual([])
    expect(result.sorted).toHaveLength(4)
    // a before b, x before y
    expect(result.sorted.indexOf('a')).toBeLessThan(result.sorted.indexOf('b'))
    expect(result.sorted.indexOf('x')).toBeLessThan(result.sorted.indexOf('y'))
  })

  it('should detect simple cycles', () => {
    const nodes = new Map<string, Operator<IOperator>>([
      ['a', { id: 'a' } as any],
      ['b', { id: 'b' } as any],
      ['c', { id: 'c' } as any],
    ])

    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' },
    ]

    const result = topologicalSort(nodes, edges)
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it('should detect self-loops', () => {
    const nodes = new Map<string, Operator<IOperator>>([
      ['a', { id: 'a' } as any],
    ])

    const edges = [{ source: 'a', target: 'a' }]

    const result = topologicalSort(nodes, edges)
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it('should handle empty graph', () => {
    const nodes = new Map<string, Operator<IOperator>>()
    const edges: Array<{ source: string; target: string }> = []

    const result = topologicalSort(nodes, edges)
    expect(result.sorted).toEqual([])
    expect(result.cycles).toEqual([])
  })

  it('should handle single node with no edges', () => {
    const nodes = new Map<string, Operator<IOperator>>([
      ['a', { id: 'a' } as any],
    ])
    const edges: Array<{ source: string; target: string }> = []

    const result = topologicalSort(nodes, edges)
    expect(result.sorted).toEqual(['a'])
    expect(result.cycles).toEqual([])
  })
})

describe('GraphExecutor', () => {
  it('should create a GraphExecutor instance with default options', () => {
    const executor = new GraphExecutor()
    expect(executor).toBeDefined()
    expect(executor.getStats()).toEqual({
      nodeCount: 0,
      edgeCount: 0,
      lastExecutionTime: 0,
      dirtyCount: 0,
    })
  })

  it('should create a GraphExecutor with custom options', () => {
    const executor = new GraphExecutor({
      parallel: false,
      batchDelay: 32,
      maxExecutionTime: 100,
    })
    expect(executor).toBeDefined()
  })

  it('should add and remove nodes', () => {
    const executor = new GraphExecutor()
    const op = new NumberOp('/number-1')

    executor.addNode(op)
    expect(executor.getStats().nodeCount).toBe(1)

    executor.removeNode('/number-1')
    expect(executor.getStats().nodeCount).toBe(0)
  })

  it('should add edges between nodes', () => {
    const executor = new GraphExecutor()
    const num1 = new NumberOp('/num-1')
    const num2 = new NumberOp('/num-2')
    const math = new MathOp('/math-1')

    executor.addNode(num1)
    executor.addNode(num2)
    executor.addNode(math)

    executor.addEdge('/num-1', '/math-1')
    executor.addEdge('/num-2', '/math-1')

    expect(executor.getStats().edgeCount).toBe(2)
  })

  it('should throw when adding edge that creates cycle', () => {
    const executor = new GraphExecutor()
    const op1 = new NumberOp('/op-1')
    const op2 = new NumberOp('/op-2')

    executor.addNode(op1)
    executor.addNode(op2)

    executor.addEdge('/op-1', '/op-2')

    expect(() => {
      executor.addEdge('/op-2', '/op-1')
    }).toThrow(/cycle/)
  })

  it('should remove edges', () => {
    const executor = new GraphExecutor()
    const op1 = new NumberOp('/op-1')
    const op2 = new NumberOp('/op-2')

    executor.addNode(op1)
    executor.addNode(op2)
    executor.addEdge('/op-1', '/op-2')

    expect(executor.getStats().edgeCount).toBe(1)

    executor.removeEdge('/op-1', '/op-2')
    expect(executor.getStats().edgeCount).toBe(0)
  })

  it('should mark nodes as dirty', () => {
    const executor = new GraphExecutor({ batchDelay: 0 })
    const op1 = new NumberOp('/op-1')
    const op2 = new NumberOp('/op-2')

    executor.addNode(op1)
    executor.addNode(op2)

    executor.markDirty(['/op-1'])
    expect(executor.getStats().dirtyCount).toBeGreaterThan(0)
  })

  it('should create a GraphScope', () => {
    const executor = new GraphExecutor()
    const scope = executor.createScope('test-scope')
    expect(scope).toBeDefined()
    expect(scope).toBeInstanceOf(GraphScope)
  })

  it('should get node by id', () => {
    const executor = new GraphExecutor()
    const op = new NumberOp('/number-1')

    executor.addNode(op)
    expect(executor.getNode('/number-1')).toBe(op)
    expect(executor.getNode('/nonexistent')).toBeUndefined()
  })

  it('should get all edges', () => {
    const executor = new GraphExecutor()
    const op1 = new NumberOp('/op-1')
    const op2 = new NumberOp('/op-2')

    executor.addNode(op1)
    executor.addNode(op2)
    executor.addEdge('/op-1', '/op-2')

    const edges = executor.getEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0]).toEqual({ source: '/op-1', target: '/op-2' })
  })
})

describe('GraphScope', () => {
  it('should set and get context values with namespacing', () => {
    const executor = new GraphExecutor()
    const scope = executor.createScope('test-scope')

    scope.setContext('myKey', 'myValue')
    expect(scope.getContext('myKey')).toBe('myValue')
  })

  it('should clone a scope', () => {
    const executor = new GraphExecutor()
    const scope = executor.createScope('test-scope')
    scope.setContext('key', 'value')

    const cloned = scope.clone()
    expect(cloned).toBeDefined()
    expect(cloned).not.toBe(scope)
  })

  it('should mark parent as dirty', () => {
    const executor = new GraphExecutor({ batchDelay: 0 })
    const parentOp = new NumberOp('/parent')
    executor.addNode(parentOp)

    const scope = executor.createScope('/parent')
    scope.markParentDirty()

    expect(executor.getStats().dirtyCount).toBeGreaterThan(0)
  })
})

describe('ForEachBeginOp', () => {
  it('should create instance with correct inputs and outputs', () => {
    const op = new ForEachBeginOp('/foreach-begin')
    expect(op).toBeDefined()
    expect(op.id).toBe('/foreach-begin')
    expect(op.inputs.data).toBeDefined()
    expect(op.outputs.item).toBeDefined()
    expect(op.outputs.index).toBeDefined()
    expect(op.outputs.total).toBeDefined()
  })

  it('should execute with array data', () => {
    const op = new ForEachBeginOp('/foreach-begin')
    const result = op.execute({ data: [1, 2, 3] })

    expect(result.item).toBe(1)
    expect(result.index).toBe(0)
    expect(result.total).toBe(3)
  })

  it('should handle empty array', () => {
    const op = new ForEachBeginOp('/foreach-begin')
    const result = op.execute({ data: [] })

    expect(result.item).toBeNull()
    expect(result.index).toBe(0)
    expect(result.total).toBe(0)
  })

  it('should handle non-array data', () => {
    const op = new ForEachBeginOp('/foreach-begin')
    const result = op.execute({ data: 'not an array' as any })

    expect(result.total).toBe(0)
  })

  it('should have dirty flag', () => {
    const op = new ForEachBeginOp('/foreach-begin')
    expect(op.dirty).toBe(true)

    op.dirty = false
    expect(op.dirty).toBe(false)
  })
})

describe('ForEachEndOp', () => {
  it('should create instance with correct inputs and outputs', () => {
    const op = new ForEachEndOp('/foreach-end')
    expect(op).toBeDefined()
    expect(op.inputs.result).toBeDefined()
    expect(op.outputs.results).toBeDefined()
  })

  it('should wrap single result in array', () => {
    const op = new ForEachEndOp('/foreach-end')
    const result = op.execute({ result: 'test-value' })

    expect(result.results).toEqual(['test-value'])
  })

  it('should handle null result', () => {
    const op = new ForEachEndOp('/foreach-end')
    const result = op.execute({ result: null })

    expect(result.results).toEqual([null])
  })

  it('should handle object result', () => {
    const op = new ForEachEndOp('/foreach-end')
    const obj = { key: 'value' }
    const result = op.execute({ result: obj })

    expect(result.results).toEqual([obj])
  })
})

describe('ForEachMetaOp', () => {
  it('should create instance with correct inputs and outputs', () => {
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

  it('should use initialValue when currentValue is null', () => {
    const op = new ForEachMetaOp('/foreach-meta')
    const result = op.execute({
      initialValue: 'initial',
      currentValue: null,
    })

    expect(result.accumulator).toBe('initial')
  })

  it('should prefer currentValue over initialValue', () => {
    const op = new ForEachMetaOp('/foreach-meta')
    const result = op.execute({
      initialValue: 'initial',
      currentValue: 'current',
    })

    expect(result.accumulator).toBe('current')
  })

  it('should return default iteration metadata', () => {
    const op = new ForEachMetaOp('/foreach-meta')
    const result = op.execute({
      initialValue: 0,
      currentValue: null,
    })

    expect(result.index).toBe(0)
    expect(result.total).toBe(0)
    expect(result.isFirst).toBe(true)
    expect(result.isLast).toBe(true)
  })

  it('should handle numeric accumulator', () => {
    const op = new ForEachMetaOp('/foreach-meta')
    const result = op.execute({
      initialValue: 0,
      currentValue: 42,
    })

    expect(result.accumulator).toBe(42)
  })

  it('should handle array accumulator', () => {
    const op = new ForEachMetaOp('/foreach-meta')
    const result = op.execute({
      initialValue: [],
      currentValue: [1, 2, 3],
    })

    expect(result.accumulator).toEqual([1, 2, 3])
  })
})

describe('Operator dirty flag', () => {
  it('should initialize with dirty = true', () => {
    const op = new NumberOp('/number-1')
    expect(op.dirty).toBe(true)
  })

  it('should be settable', () => {
    const op = new NumberOp('/number-1')
    op.dirty = false
    expect(op.dirty).toBe(false)

    op.dirty = true
    expect(op.dirty).toBe(true)
  })

  it('should be marked dirty via markDirty method', async () => {
    const op = new NumberOp('/number-1')
    // First, pull to make the operator clean
    await op.pull()
    expect(op.dirty).toBe(false)

    // Now markDirty should set dirty to true
    op.markDirty()
    expect(op.dirty).toBe(true)
  })
})
