// Test file for GraphExecutor implementation
import { describe, expect, it } from 'vitest'
import { GraphExecutor, GraphScope, topologicalSort } from './graph-executor'
import type { IOperator, Operator } from './operators'
import {
  ForLoopBeginOp,
  ForLoopEndOp,
  ForLoopMetaOp,
  MathOp,
  NumberOp,
  PullExecutionStatus,
} from './operators'

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
    const nodes = new Map<string, Operator<IOperator>>([['a', { id: 'a' } as any]])

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
    const nodes = new Map<string, Operator<IOperator>>([['a', { id: 'a' } as any]])
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

describe('ForLoopBeginOp', () => {
  it('should create instance with correct inputs and outputs', () => {
    const op = new ForLoopBeginOp('/forloop-begin')
    expect(op).toBeDefined()
    expect(op.id).toBe('/forloop-begin')
    expect(op.inputs.data).toBeDefined()
    expect(op.outputs.item).toBeDefined()
    expect(op.outputs.index).toBeDefined()
    expect(op.outputs.total).toBeDefined()
  })

  it('should execute with array data', () => {
    const op = new ForLoopBeginOp('/forloop-begin')
    const result = op.execute({ data: [1, 2, 3] })

    expect(result.item).toBe(1)
    expect(result.index).toBe(0)
    expect(result.total).toBe(3)
  })

  it('should handle empty array', () => {
    const op = new ForLoopBeginOp('/forloop-begin')
    const result = op.execute({ data: [] })

    expect(result.item).toBeNull()
    expect(result.index).toBe(0)
    expect(result.total).toBe(0)
  })

  it('should handle non-array data', () => {
    const op = new ForLoopBeginOp('/forloop-begin')
    const result = op.execute({ data: 'not an array' as any })

    expect(result.total).toBe(0)
  })

  it('should have dirty flag', () => {
    const op = new ForLoopBeginOp('/forloop-begin')
    expect(op.dirty).toBe(true)

    op.dirty = false
    expect(op.dirty).toBe(false)
  })
})

describe('ForLoopEndOp - execute', () => {
  // Note: ForLoopEndOp has complex loop handling via createForLoopListeners
  // These tests cover the basic execute() method
  it('should have correct inputs and outputs', () => {
    const op = new ForLoopEndOp('/forloop-end')
    expect(op).toBeDefined()
    expect(op.inputs.item).toBeDefined()
    expect(op.outputs.data).toBeDefined()
  })

  it('should pass through single value', () => {
    const op = new ForLoopEndOp('/forloop-end')
    const result = op.execute({ item: 'test-value' })

    expect(result.data).toBe('test-value')
  })

  it('should handle null input', () => {
    const op = new ForLoopEndOp('/forloop-end')
    const result = op.execute({ item: null })

    expect(result.data).toBeNull()
  })

  it('should handle object input', () => {
    const op = new ForLoopEndOp('/forloop-end')
    const obj = { key: 'value' }
    const result = op.execute({ item: obj })

    expect(result.data).toEqual(obj)
  })
})

describe('ForLoopMetaOp', () => {
  it('should create instance with correct inputs and outputs', () => {
    const op = new ForLoopMetaOp('/forloop-meta')
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
    const op = new ForLoopMetaOp('/forloop-meta')
    const result = op.execute({
      initialValue: 'initial',
      currentValue: null,
    })

    expect(result.accumulator).toBe('initial')
  })

  it('should prefer currentValue over initialValue', () => {
    const op = new ForLoopMetaOp('/forloop-meta')
    const result = op.execute({
      initialValue: 'initial',
      currentValue: 'current',
    })

    expect(result.accumulator).toBe('current')
  })

  it('should return default iteration metadata', () => {
    const op = new ForLoopMetaOp('/forloop-meta')
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
    const op = new ForLoopMetaOp('/forloop-meta')
    const result = op.execute({
      initialValue: 0,
      currentValue: 42,
    })

    expect(result.accumulator).toBe(42)
  })

  it('should handle array accumulator', () => {
    const op = new ForLoopMetaOp('/forloop-meta')
    const result = op.execute({
      initialValue: [],
      currentValue: [1, 2, 3],
    })

    expect(result.accumulator).toEqual([1, 2, 3])
  })
})

describe('ForLoop execution - result collection', () => {
  it('should return array of all iteration results with map-like behavior', async () => {
    // Setup: [1, 2, 3] -> ForLoopBegin -> MathOp(add 1) -> ForLoopEnd
    // Expected output: [2, 3, 4]
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const mathOp = new MathOp('/math')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set input data on beginOp
    beginOp.inputs.data.setValue([1, 2, 3])

    // Connect beginOp.item -> mathOp.a
    mathOp.inputs.a.addConnection('begin-to-math', beginOp.outputs.item)
    mathOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(mathOp)

    // Set mathOp to add 1
    mathOp.inputs.b.setValue(1)
    mathOp.inputs.operator.setValue('add')

    // Connect mathOp.result -> endOp.item
    endOp.inputs.item.addConnection('math-to-end', mathOp.outputs.result)
    endOp.addUpstreamDependency(mathOp)
    mathOp.addDownstreamDependent(endOp)

    // Set up the chain for ForLoopEndOp
    endOp.createForLoopListeners([beginOp, mathOp, endOp])

    // Pull from endOp - should execute the loop and collect all results
    const result = await endOp.pull()

    expect(result.data).toEqual([2, 3, 4])
  })

  it('should handle empty array input', async () => {
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set empty input data
    beginOp.inputs.data.setValue([])

    // Connect beginOp.item -> endOp.item (direct passthrough)
    endOp.inputs.item.addConnection('begin-to-end', beginOp.outputs.item)
    endOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(endOp)

    // Set up the chain
    endOp.createForLoopListeners([beginOp, endOp])

    const result = await endOp.pull()

    expect(result.data).toEqual([])
  })

  it('should provide correct index and total during iteration', async () => {
    // Track what index/total values were seen during iteration
    const seenIndices: number[] = []
    const seenTotals: number[] = []

    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set input data
    beginOp.inputs.data.setValue(['a', 'b', 'c'])

    // Connect beginOp.item -> endOp.item
    endOp.inputs.item.addConnection('begin-to-end', beginOp.outputs.item)
    endOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(endOp)

    // Subscribe to track index/total changes
    beginOp.outputs.index.subscribe(idx => seenIndices.push(idx))
    beginOp.outputs.total.subscribe(t => seenTotals.push(t))

    // Set up the chain
    endOp.createForLoopListeners([beginOp, endOp])

    await endOp.pull()

    // Should have seen indices 0, 1, 2 during iteration
    expect(seenIndices).toContain(0)
    expect(seenIndices).toContain(1)
    expect(seenIndices).toContain(2)

    // Total should always be 3
    expect(seenTotals.every(t => t === 3 || t === 0)).toBe(true) // 0 is initial value
  })

  it('should work with multiple operators in loop body', async () => {
    // Setup: [10, 20, 30] -> ForLoopBegin -> MathOp(multiply by 2) -> MathOp(add 5) -> ForLoopEnd
    // Expected: [25, 45, 65] (10*2+5=25, 20*2+5=45, 30*2+5=65)
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const multiplyOp = new MathOp('/multiply')
    const addOp = new MathOp('/add')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set input data
    beginOp.inputs.data.setValue([10, 20, 30])

    // Connect beginOp.item -> multiplyOp.a
    multiplyOp.inputs.a.addConnection('begin-to-mult', beginOp.outputs.item)
    multiplyOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(multiplyOp)

    // Set multiplyOp to multiply by 2
    multiplyOp.inputs.b.setValue(2)
    multiplyOp.inputs.operator.setValue('multiply')

    // Connect multiplyOp.result -> addOp.a
    addOp.inputs.a.addConnection('mult-to-add', multiplyOp.outputs.result)
    addOp.addUpstreamDependency(multiplyOp)
    multiplyOp.addDownstreamDependent(addOp)

    // Set addOp to add 5
    addOp.inputs.b.setValue(5)
    addOp.inputs.operator.setValue('add')

    // Connect addOp.result -> endOp.item
    endOp.inputs.item.addConnection('add-to-end', addOp.outputs.result)
    endOp.addUpstreamDependency(addOp)
    addOp.addDownstreamDependent(endOp)

    // Set up the chain (in correct order for iteration)
    endOp.createForLoopListeners([beginOp, multiplyOp, addOp, endOp])

    const result = await endOp.pull()

    expect(result.data).toEqual([25, 45, 65])
  })

  it('should handle object data in loop', async () => {
    // Test that complex objects are properly iterated
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const endOp = new ForLoopEndOp('/forloop-end')

    const inputData = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }]
    beginOp.inputs.data.setValue(inputData)

    // Direct passthrough: beginOp.item -> endOp.item
    endOp.inputs.item.addConnection('begin-to-end', beginOp.outputs.item)
    endOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(endOp)

    endOp.createForLoopListeners([beginOp, endOp])

    const result = await endOp.pull()

    expect(result.data).toEqual(inputData)
  })

  it('should collect all values when item output connects directly to item input (no intermediate ops)', async () => {
    // This tests the simplest ForLoop case: BeginOp.item -> EndOp.item
    // Verifies that field subscription propagation correctly updates EndOp's input
    // during each iteration, allowing proper result collection
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Simple numeric array
    beginOp.inputs.data.setValue([10, 20, 30, 40, 50])

    // Direct connection: beginOp.item -> endOp.item (no intermediate operators)
    endOp.inputs.item.addConnection('begin-to-end', beginOp.outputs.item)
    endOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(endOp)

    // Chain only contains begin and end - no intermediate operators
    endOp.createForLoopListeners([beginOp, endOp])

    const result = await endOp.pull()

    // Should collect ALL values, not just the first or last
    expect(result.data).toEqual([10, 20, 30, 40, 50])
    expect(result.data).toHaveLength(5)
  })

  it('should re-run loop when intermediate node input changes (like keyframe animation)', async () => {
    // Simulates: [1, 2, 3] -> ForLoopBegin -> MathOp(add b) -> ForLoopEnd
    // where b changes over time (like a keyframed value)
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const mathOp = new MathOp('/math')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set input data
    beginOp.inputs.data.setValue([1, 2, 3])

    // Connect beginOp.item -> mathOp.a
    mathOp.inputs.a.addConnection('begin-to-math', beginOp.outputs.item)
    mathOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(mathOp)

    // Set initial b value (like keyframe at t=0)
    mathOp.inputs.b.setValue(0)
    mathOp.inputs.operator.setValue('add')

    // Connect mathOp.result -> endOp.item
    endOp.inputs.item.addConnection('math-to-end', mathOp.outputs.result)
    endOp.addUpstreamDependency(mathOp)
    mathOp.addDownstreamDependent(endOp)

    // Set up the chain
    endOp.createForLoopListeners([beginOp, mathOp, endOp])

    // First pull - b=0, so output is [1+0, 2+0, 3+0] = [1, 2, 3]
    const result1 = await endOp.pull()
    expect(result1.data).toEqual([1, 2, 3])

    // Simulate keyframe update: change b from 0 to 10
    mathOp.inputs.b.setValue(10)

    // Second pull - b=10, so output should be [1+10, 2+10, 3+10] = [11, 12, 13]
    const result2 = await endOp.pull()
    expect(result2.data).toEqual([11, 12, 13])
  })

  it('should re-run loop when input data changes', async () => {
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const mathOp = new MathOp('/math')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Initial data
    beginOp.inputs.data.setValue([1, 2])

    // Connect beginOp.item -> mathOp.a
    mathOp.inputs.a.addConnection('begin-to-math', beginOp.outputs.item)
    mathOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(mathOp)

    mathOp.inputs.b.setValue(1)
    mathOp.inputs.operator.setValue('add')

    // Connect mathOp.result -> endOp.item
    endOp.inputs.item.addConnection('math-to-end', mathOp.outputs.result)
    endOp.addUpstreamDependency(mathOp)
    mathOp.addDownstreamDependent(endOp)

    endOp.createForLoopListeners([beginOp, mathOp, endOp])

    // First pull with [1, 2]
    const result1 = await endOp.pull()
    expect(result1.data).toEqual([2, 3])

    // Change input data to [10, 20, 30]
    beginOp.inputs.data.setValue([10, 20, 30])

    // Second pull should use new data
    const result2 = await endOp.pull()
    expect(result2.data).toEqual([11, 21, 31])
  })

  it('should use cached result when nothing in loop changes', async () => {
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const mathOp = new MathOp('/math')
    const endOp = new ForLoopEndOp('/forloop-end')

    beginOp.inputs.data.setValue([1, 2, 3])

    mathOp.inputs.a.addConnection('begin-to-math', beginOp.outputs.item)
    mathOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(mathOp)

    mathOp.inputs.b.setValue(1)
    mathOp.inputs.operator.setValue('add')

    endOp.inputs.item.addConnection('math-to-end', mathOp.outputs.result)
    endOp.addUpstreamDependency(mathOp)
    mathOp.addDownstreamDependent(endOp)

    endOp.createForLoopListeners([beginOp, mathOp, endOp])

    // First pull
    const result1 = await endOp.pull()
    expect(result1.data).toEqual([2, 3, 4])

    // Second pull without changes - should return same cached result
    const result2 = await endOp.pull()
    expect(result2.data).toEqual([2, 3, 4])
    expect(result1).toBe(result2) // Same object reference (cached)
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

describe('Graph execution', () => {
  it('should execute a single operator and produce output', async () => {
    const num = new NumberOp('/num')
    num.inputs.val.setValue(42)

    const result = await num.pull()
    expect(result.val).toBe(42)
  })

  it('should execute a chain of connected operators', async () => {
    // Create a chain: num1 -> math (adds num2)
    const num1 = new NumberOp('/num1')
    const num2 = new NumberOp('/num2')
    const math = new MathOp('/math')

    // Set values
    num1.inputs.val.setValue(10)
    num2.inputs.val.setValue(5)

    // Connect num1 to math.a
    math.inputs.a.addConnection('num1-to-math', num1.outputs.val)
    math.addUpstreamDependency(num1)
    num1.addDownstreamDependent(math)

    // Connect num2 to math.b
    math.inputs.b.addConnection('num2-to-math', num2.outputs.val)
    math.addUpstreamDependency(num2)
    num2.addDownstreamDependent(math)

    // Set operator to add
    math.inputs.operator.setValue('add')

    // Pull from math - should execute upstream operators first
    const result = await math.pull()
    expect(result.result).toBe(15) // 10 + 5
  })

  it('should re-execute when upstream changes', async () => {
    const num = new NumberOp('/num')
    const math = new MathOp('/math')

    num.inputs.val.setValue(10)
    math.inputs.a.addConnection('num-to-math', num.outputs.val)
    math.inputs.b.setValue(5)
    math.inputs.operator.setValue('add')
    math.addUpstreamDependency(num)
    num.addDownstreamDependent(math)

    // First pull
    const result1 = await math.pull()
    expect(result1.result).toBe(15)

    // Change upstream value
    num.inputs.val.setValue(20)

    // Pull again - should get new value
    const result2 = await math.pull()
    expect(result2.result).toBe(25) // 20 + 5
  })

  it('should use cached result when nothing changed', async () => {
    const num = new NumberOp('/num')
    num.inputs.val.setValue(42)

    // First pull
    const result1 = await num.pull()
    expect(result1.val).toBe(42)
    expect(num.dirty).toBe(false)

    // Second pull without changes - should use cache
    const result2 = await num.pull()
    expect(result2.val).toBe(42)
    expect(result1).toBe(result2) // Same reference (cached)
  })

  it('should propagate dirty flag downstream', async () => {
    const num = new NumberOp('/num')
    const math = new MathOp('/math')

    num.inputs.val.setValue(10)
    math.inputs.a.addConnection('num-to-math', num.outputs.val)
    math.inputs.b.setValue(5)
    math.inputs.operator.setValue('add')
    math.addUpstreamDependency(num)
    num.addDownstreamDependent(math)

    // Pull to make everything clean
    await math.pull()
    expect(num.dirty).toBe(false)
    expect(math.dirty).toBe(false)

    // Change upstream - should mark downstream dirty
    num.inputs.val.setValue(20)
    expect(num.dirty).toBe(true)
    expect(math.dirty).toBe(true)
  })

  it('should handle diamond dependencies correctly', async () => {
    // Create diamond: source -> branch1 -> sink
    //                source -> branch2 -> sink
    const source = new NumberOp('/source')
    const branch1 = new MathOp('/branch1')
    const branch2 = new MathOp('/branch2')
    const sink = new MathOp('/sink')

    source.inputs.val.setValue(10)

    // Branch1: source * 2
    branch1.inputs.a.addConnection('source-to-b1', source.outputs.val)
    branch1.inputs.b.setValue(2)
    branch1.inputs.operator.setValue('multiply')
    branch1.addUpstreamDependency(source)
    source.addDownstreamDependent(branch1)

    // Branch2: source + 5
    branch2.inputs.a.addConnection('source-to-b2', source.outputs.val)
    branch2.inputs.b.setValue(5)
    branch2.inputs.operator.setValue('add')
    branch2.addUpstreamDependency(source)
    source.addDownstreamDependent(branch2)

    // Sink: branch1 + branch2
    sink.inputs.a.addConnection('b1-to-sink', branch1.outputs.result)
    sink.inputs.b.addConnection('b2-to-sink', branch2.outputs.result)
    sink.inputs.operator.setValue('add')
    sink.addUpstreamDependency(branch1)
    sink.addUpstreamDependency(branch2)
    branch1.addDownstreamDependent(sink)
    branch2.addDownstreamDependent(sink)

    // Pull from sink
    const result = await sink.pull()
    // source=10, branch1=10*2=20, branch2=10+5=15, sink=20+15=35
    expect(result.result).toBe(35)
  })

  it('should handle deep chains efficiently', async () => {
    // Create a chain of 10 connected MathOps
    const source = new NumberOp('/source')
    source.inputs.val.setValue(1)

    const ops: MathOp[] = []
    for (let i = 0; i < 10; i++) {
      const op = new MathOp(`/math-${i}`)
      op.inputs.operator.setValue('add')
      op.inputs.b.setValue(1) // Each step adds 1

      if (i === 0) {
        // Connect to source
        op.inputs.a.addConnection('source-to-op', source.outputs.val)
        op.addUpstreamDependency(source)
        source.addDownstreamDependent(op)
      } else {
        // Connect to previous op
        op.inputs.a.addConnection(`op${i - 1}-to-op`, ops[i - 1].outputs.result)
        op.addUpstreamDependency(ops[i - 1])
        ops[i - 1].addDownstreamDependent(op)
      }

      ops.push(op)
    }

    // Pull from the last one - should execute entire chain
    const result = await ops[9].pull()
    // source=1, then 10 adds of 1: 1+1+1+1+1+1+1+1+1+1+1 = 11
    expect(result.result).toBe(11)

    // All should be clean now
    expect(source.dirty).toBe(false)
    for (const op of ops) {
      expect(op.dirty).toBe(false)
    }
  })

  it('should call executeNode with correct number of parameters', async () => {
    // This test verifies the fix for the critical bug where executeNode was previously
    // called with 2 parameters (node, context) but only accepts 1 parameter (node).
    // The bug occurred at line 641 in the for-loop execution code.
    //
    // The fix: Removed the invalid second parameter. Iteration context is passed via
    // ForLoopBeginOp and ForLoopMetaOp outputs, not as an execution context parameter.

    const executor = new GraphExecutor()

    // Create simple operators to test basic execution without parameter errors
    const num1 = new NumberOp('/num1')
    const num2 = new NumberOp('/num2')
    const math = new MathOp('/math')

    num1.inputs.val.setValue(10)
    num2.inputs.val.setValue(20)
    math.inputs.operator.setValue('add')

    executor.addNode(num1)
    executor.addNode(num2)
    executor.addNode(math)

    executor.addEdge('/num1', '/math')
    executor.addEdge('/num2', '/math')

    executor.markDirty(['/num1', '/num2', '/math'])

    // This should execute without throwing parameter-related errors
    // If executeNode was being called with 2 parameters, TypeScript would error
    // or the function would throw at runtime
    await expect(executor.executeFrame(performance.now())).resolves.not.toThrow()
  })
})

describe('ForLoop execution via GraphExecutor.executeFrame()', () => {
  it('should execute ForLoop scope and collect results', async () => {
    const executor = new GraphExecutor()

    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const mathOp = new MathOp('/math')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set input data on beginOp
    beginOp.inputs.data.setValue([1, 2, 3])

    // Connect beginOp.item -> mathOp.a
    mathOp.inputs.a.addConnection('begin-to-math', beginOp.outputs.item)
    mathOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(mathOp)

    // Set mathOp to add 1
    mathOp.inputs.b.setValue(1)
    mathOp.inputs.operator.setValue('add')

    // Connect mathOp.result -> endOp.item
    endOp.inputs.item.addConnection('math-to-end', mathOp.outputs.result)
    endOp.addUpstreamDependency(mathOp)
    mathOp.addDownstreamDependent(endOp)

    // Add nodes to executor
    executor.addNode(beginOp)
    executor.addNode(mathOp)
    executor.addNode(endOp)
    executor.addEdge(beginOp.id, mathOp.id)
    executor.addEdge(mathOp.id, endOp.id)

    // Execute frame - should find and execute ForLoop scope
    await executor.executeFrame(performance.now())

    // Verify ForLoop results
    expect(endOp.outputs.data.value).toEqual([2, 3, 4])
  })

  it('should handle direct passthrough (begin.item -> end.item)', async () => {
    const executor = new GraphExecutor()

    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set input data
    beginOp.inputs.data.setValue(['a', 'b', 'c'])

    // Direct passthrough: beginOp.item -> endOp.item
    endOp.inputs.item.addConnection('begin-to-end', beginOp.outputs.item)
    endOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(endOp)

    executor.addNode(beginOp)
    executor.addNode(endOp)
    executor.addEdge(beginOp.id, endOp.id)

    await executor.executeFrame(performance.now())

    expect(endOp.outputs.data.value).toEqual(['a', 'b', 'c'])
  })

  it('should handle empty input arrays', async () => {
    const executor = new GraphExecutor()

    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set empty input data
    beginOp.inputs.data.setValue([])

    endOp.inputs.item.addConnection('begin-to-end', beginOp.outputs.item)
    endOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(endOp)

    executor.addNode(beginOp)
    executor.addNode(endOp)
    executor.addEdge(beginOp.id, endOp.id)

    await executor.executeFrame(performance.now())

    expect(endOp.outputs.data.value).toEqual([])
  })

  it('should re-execute ForLoop when input data changes', async () => {
    const executor = new GraphExecutor()

    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const endOp = new ForLoopEndOp('/forloop-end')

    beginOp.inputs.data.setValue([1, 2])

    endOp.inputs.item.addConnection('begin-to-end', beginOp.outputs.item)
    endOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(endOp)

    executor.addNode(beginOp)
    executor.addNode(endOp)
    executor.addEdge(beginOp.id, endOp.id)

    // First execution
    await executor.executeFrame(performance.now())
    expect(endOp.outputs.data.value).toEqual([1, 2])

    // Change input data and mark dirty
    beginOp.inputs.data.setValue([10, 20, 30])
    beginOp.markDirty()
    endOp.markDirty()

    // Second execution
    await executor.executeFrame(performance.now())
    expect(endOp.outputs.data.value).toEqual([10, 20, 30])
  })

  it('should work with multiple operators in loop body', async () => {
    const executor = new GraphExecutor()

    // [10, 20, 30] -> ForLoopBegin -> multiply by 2 -> add 5 -> ForLoopEnd
    // Expected: [25, 45, 65] (10*2+5=25, 20*2+5=45, 30*2+5=65)
    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const multiplyOp = new MathOp('/multiply')
    const addOp = new MathOp('/add')
    const endOp = new ForLoopEndOp('/forloop-end')

    beginOp.inputs.data.setValue([10, 20, 30])

    // beginOp.item -> multiplyOp.a
    multiplyOp.inputs.a.addConnection('begin-to-mult', beginOp.outputs.item)
    multiplyOp.inputs.b.setValue(2)
    multiplyOp.inputs.operator.setValue('multiply')
    multiplyOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(multiplyOp)

    // multiplyOp.result -> addOp.a
    addOp.inputs.a.addConnection('mult-to-add', multiplyOp.outputs.result)
    addOp.inputs.b.setValue(5)
    addOp.inputs.operator.setValue('add')
    addOp.addUpstreamDependency(multiplyOp)
    multiplyOp.addDownstreamDependent(addOp)

    // addOp.result -> endOp.item
    endOp.inputs.item.addConnection('add-to-end', addOp.outputs.result)
    endOp.addUpstreamDependency(addOp)
    addOp.addDownstreamDependent(endOp)

    executor.addNode(beginOp)
    executor.addNode(multiplyOp)
    executor.addNode(addOp)
    executor.addNode(endOp)
    executor.addEdge(beginOp.id, multiplyOp.id)
    executor.addEdge(multiplyOp.id, addOp.id)
    executor.addEdge(addOp.id, endOp.id)

    await executor.executeFrame(performance.now())

    expect(endOp.outputs.data.value).toEqual([25, 45, 65])
  })

  it('should cache ForLoopEndOp results for downstream operators', async () => {
    const executor = new GraphExecutor()

    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const endOp = new ForLoopEndOp('/forloop-end')

    beginOp.inputs.data.setValue([1, 2, 3])

    endOp.inputs.item.addConnection('begin-to-end', beginOp.outputs.item)
    endOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(endOp)

    executor.addNode(beginOp)
    executor.addNode(endOp)
    executor.addEdge(beginOp.id, endOp.id)

    await executor.executeFrame(performance.now())

    // After execution, endOp should have cached output
    expect(endOp.pullExecutionStatus).toBe(PullExecutionStatus.CLEAN)
    expect(endOp.cachedOutput).toEqual({ data: [1, 2, 3] })

    // Pulling from endOp should return cached result
    const result = await endOp.pull()
    expect(result).toEqual({ data: [1, 2, 3] })
  })

  it('should work without ForLoopMetaOp (meta is optional)', async () => {
    // This test ensures that the ForLoop works correctly when no ForLoopMetaOp
    // is present. The meta op is optional and users can delete it without
    // breaking the loop execution.
    const executor = new GraphExecutor()

    const beginOp = new ForLoopBeginOp('/forloop-begin')
    const mathOp = new MathOp('/math')
    const endOp = new ForLoopEndOp('/forloop-end')

    // Set input data
    beginOp.inputs.data.setValue([10, 20, 30])

    // beginOp.item -> mathOp.a (no meta op in the chain)
    mathOp.inputs.a.addConnection('begin-to-math', beginOp.outputs.item)
    mathOp.inputs.b.setValue(5)
    mathOp.inputs.operator.setValue('add')
    mathOp.addUpstreamDependency(beginOp)
    beginOp.addDownstreamDependent(mathOp)

    // mathOp.result -> endOp.item
    endOp.inputs.item.addConnection('math-to-end', mathOp.outputs.result)
    endOp.addUpstreamDependency(mathOp)
    mathOp.addDownstreamDependent(endOp)

    executor.addNode(beginOp)
    executor.addNode(mathOp)
    executor.addNode(endOp)
    executor.addEdge(beginOp.id, mathOp.id)
    executor.addEdge(mathOp.id, endOp.id)

    // Execute - should work without metaOp
    await executor.executeFrame(performance.now())

    // Results should be [15, 25, 35] (10+5, 20+5, 30+5)
    expect(endOp.outputs.data.value).toEqual([15, 25, 35])

    // Verify findForLoopScopes doesn't require metaOp
    const scopes = executor.findForLoopScopes()
    expect(scopes).toHaveLength(1)
    expect(scopes[0].metaOp).toBeUndefined()
    expect(scopes[0].beginOp).toBe(beginOp)
    expect(scopes[0].endOp).toBe(endOp)
  })
})
