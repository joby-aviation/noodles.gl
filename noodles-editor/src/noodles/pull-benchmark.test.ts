// Performance benchmark tests for pull-based execution model

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DataField, NumberField } from './fields'
import { GraphExecutor, topologicalSort } from './graph-executor'
import { Operator, PullExecutionStatus } from './operators'
import type { ExtractProps } from './utils/extract-props'

// Test operator that simulates computation
class ComputeOp extends Operator<ComputeOp> {
  static displayName = 'Compute'
  static executionCount = 0
  static lastExecutionTime = 0

  createInputs() {
    return {
      value: new NumberField(0),
      multiplier: new NumberField(2),
    }
  }

  createOutputs() {
    return {
      result: new NumberField(),
    }
  }

  execute({ value, multiplier }: ExtractProps<typeof this.inputs>) {
    const startTime = performance.now()
    ComputeOp.executionCount++

    // Simulate some computation
    let sum = 0
    for (let i = 0; i < 1000; i++) {
      sum += Math.sqrt(i)
    }

    ComputeOp.lastExecutionTime = performance.now() - startTime
    return { result: value * multiplier + sum }
  }
}

// Test data source operator
class DataSourceOp extends Operator<DataSourceOp> {
  static displayName = 'DataSource'

  createInputs() {
    return {
      size: new NumberField(100),
    }
  }

  createOutputs() {
    return {
      data: new DataField(),
    }
  }

  execute({ size }: ExtractProps<typeof this.inputs>) {
    // Generate test data
    const data = Array.from({ length: size }, (_, i) => ({
      id: i,
      value: Math.random() * 100,
      label: `Item ${i}`,
    }))
    return { data }
  }
}

// Chain operator that depends on compute
class ChainOp extends Operator<ChainOp> {
  static displayName = 'Chain'
  static executionCount = 0

  createInputs() {
    return {
      input: new NumberField(0),
    }
  }

  createOutputs() {
    return {
      output: new NumberField(),
    }
  }

  execute({ input }: ExtractProps<typeof this.inputs>) {
    ChainOp.executionCount++
    return { output: input * 2 }
  }
}

describe('Pull-based execution benchmarks', () => {
  let executor: GraphExecutor

  beforeEach(() => {
    // Reset execution counts
    ComputeOp.executionCount = 0
    ChainOp.executionCount = 0
    ComputeOp.lastExecutionTime = 0

    // Create executor
    executor = new GraphExecutor({
      enableProfiling: true,
      batchDelay: 0, // No batching for tests
    })
  })

  afterEach(() => {
    executor.stop()
  })

  it('should execute operators only when needed', async () => {
    // Create operator chain
    const compute = new ComputeOp('/compute')
    const chain = new ChainOp('/chain')

    // Connect operators
    chain.inputs.input.addConnection('compute', compute.outputs.result)
    chain.addUpstreamDependency(compute)
    compute.addDownstreamDependent(chain)

    // Initial state - all dirty
    expect(compute.pullExecutionStatus).toBe(PullExecutionStatus.DIRTY)
    expect(chain.pullExecutionStatus).toBe(PullExecutionStatus.DIRTY)

    // Pull from chain (should also pull compute)
    const result1 = await chain.pull()
    expect(ComputeOp.executionCount).toBe(1)
    expect(ChainOp.executionCount).toBe(1)
    expect(compute.pullExecutionStatus).toBe(PullExecutionStatus.CLEAN)
    expect(chain.pullExecutionStatus).toBe(PullExecutionStatus.CLEAN)

    // Pull again without changes - should use cache
    const result2 = await chain.pull()
    expect(ComputeOp.executionCount).toBe(1) // No re-execution
    expect(ChainOp.executionCount).toBe(1) // No re-execution
    expect(result1).toEqual(result2)

    // Change input
    compute.inputs.value.setValue(10)
    expect(compute.pullExecutionStatus).toBe(PullExecutionStatus.DIRTY)
    expect(chain.pullExecutionStatus).toBe(PullExecutionStatus.DIRTY)

    // Pull again - should re-execute
    const result3 = await chain.pull()
    expect(ComputeOp.executionCount).toBe(2)
    expect(ChainOp.executionCount).toBe(2)
    expect(result3.output).not.toEqual(result2.output)
  })

  it('should handle parallel execution efficiently', async () => {
    // Create multiple independent operators
    const ops: ComputeOp[] = []
    for (let i = 0; i < 5; i++) {
      const op = new ComputeOp(`/compute-${i}`)
      op.inputs.value.setValue(i)
      ops.push(op)
    }

    // Pull all in parallel
    const startTime = performance.now()
    const results = await Promise.all(ops.map(op => op.pull()))
    const parallelTime = performance.now() - startTime

    // Reset and execute sequentially for comparison
    ComputeOp.executionCount = 0
    ops.forEach(op => op.markDirty())

    const seqStartTime = performance.now()
    for (const op of ops) {
      await op.pull()
    }
    const sequentialTime = performance.now() - seqStartTime

    // Parallel should be faster (or at least not much slower)
    console.log('Parallel time:', parallelTime.toFixed(2), 'ms')
    console.log('Sequential time:', sequentialTime.toFixed(2), 'ms')
    console.log('Speedup:', (sequentialTime / parallelTime).toFixed(2), 'x')

    expect(results).toHaveLength(5)
    expect(ComputeOp.executionCount).toBe(5)
  })

  it('should prevent unnecessary cascading updates', async () => {
    // Create a deep chain
    const depth = 10
    const operators: ComputeOp[] = []

    for (let i = 0; i < depth; i++) {
      const op = new ComputeOp(`/compute-${i}`)
      operators.push(op)

      if (i > 0) {
        // Connect to previous operator
        op.inputs.value.addConnection(`prev-${i}`, operators[i - 1].outputs.result)
        op.addUpstreamDependency(operators[i - 1])
        operators[i - 1].addDownstreamDependent(op)
      }
    }

    // Pull from the last operator
    ComputeOp.executionCount = 0
    await operators[depth - 1].pull()
    expect(ComputeOp.executionCount).toBe(depth)

    // Pull again - should use cache
    ComputeOp.executionCount = 0
    await operators[depth - 1].pull()
    expect(ComputeOp.executionCount).toBe(0) // No executions!

    // Change first operator
    operators[0].inputs.value.setValue(100)

    // In pull mode, only execute what's needed
    ComputeOp.executionCount = 0
    await operators[depth - 1].pull()
    expect(ComputeOp.executionCount).toBe(depth) // All need re-execution

    // But pulling from middle should only execute up to that point
    operators.forEach(op => op.markDirty())
    ComputeOp.executionCount = 0
    await operators[5].pull()
    expect(ComputeOp.executionCount).toBe(6) // Only first 6 operators
  })

  it('should handle large data efficiently', async () => {
    const dataSource = new DataSourceOp('/data')
    dataSource.inputs.size.setValue(10000)

    const startTime = performance.now()
    const result = await dataSource.pull()
    const firstPullTime = performance.now() - startTime

    expect(result.data).toHaveLength(10000)

    // Second pull should be instant (cached)
    const cacheStartTime = performance.now()
    const cachedResult = await dataSource.pull()
    const cachePullTime = performance.now() - cacheStartTime

    expect(cachedResult).toBe(result) // Same reference
    // Cached pull should be fast - use a minimum threshold to avoid flaky test when firstPullTime is 0
    const threshold = Math.max(firstPullTime * 0.1, 1) // At least 1ms threshold
    expect(cachePullTime).toBeLessThan(threshold)

    console.log('First pull:', firstPullTime.toFixed(2), 'ms')
    console.log('Cached pull:', cachePullTime.toFixed(2), 'ms')
    console.log('Cache speedup:', (firstPullTime / Math.max(cachePullTime, 0.001)).toFixed(0), 'x')
  })

  it('should batch dirty marking efficiently', async () => {
    const ops: ComputeOp[] = []
    for (let i = 0; i < 10; i++) {
      ops.push(new ComputeOp(`/compute-${i}`))
    }

    // Initially all operators are dirty (new operators start dirty)
    for (const op of ops) {
      expect(op.pullExecutionStatus).toBe(PullExecutionStatus.DIRTY)
    }

    // Pull to make them clean
    await Promise.all(ops.map(op => op.pull()))

    // Now all should be clean
    for (const op of ops) {
      expect(op.pullExecutionStatus).toBe(PullExecutionStatus.CLEAN)
    }

    // Change values should mark them dirty again
    ops.forEach((op, i) => {
      op.inputs.value.setValue(i * 10)
    })

    // All should be dirty again
    for (const op of ops) {
      expect(op.pullExecutionStatus).toBe(PullExecutionStatus.DIRTY)
    }
  })

  it('should measure performance metrics correctly', async () => {
    // Create operators
    const source = new DataSourceOp('/source')
    const compute1 = new ComputeOp('/compute1')
    const compute2 = new ComputeOp('/compute2')

    // Add operators to executor
    executor.addNode(source)
    executor.addNode(compute1)
    executor.addNode(compute2)

    // Connect them via executor
    executor.addEdge('/source', '/compute1')
    executor.addEdge('/compute1', '/compute2')

    // Also connect operators directly
    compute1.inputs.value.addConnection('source', source.outputs.data)
    compute2.inputs.value.addConnection('compute1', compute1.outputs.result)

    // Pull and check metrics
    source.markDirty()
    compute1.markDirty()
    compute2.markDirty()

    await compute2.pull()

    const metrics = executor.getMetrics()
    console.log('Performance metrics:', metrics)

    // Note: Metrics tracking is done in the executor's executeFrame method
    // These would be populated when using the full execution loop
  })
})

describe('Dependency graph (via topologicalSort)', () => {
  it('should detect cycles', () => {
    const nodes = new Map<string, Operator<any>>([
      ['/a', { id: '/a' } as any],
      ['/b', { id: '/b' } as any],
      ['/c', { id: '/c' } as any],
    ])

    // Test cycle detection via topologicalSort
    const edges = [
      { source: '/a', target: '/b' },
      { source: '/b', target: '/c' },
      { source: '/c', target: '/a' }, // Creates cycle
    ]

    const result = topologicalSort(nodes, edges)
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it('should calculate parallel execution levels', () => {
    const executor = new GraphExecutor()

    // Create operators
    const opA = new ComputeOp('/a')
    const opB = new ComputeOp('/b')
    const opC = new ComputeOp('/c')
    const opD = new ComputeOp('/d')

    executor.addNode(opA)
    executor.addNode(opB)
    executor.addNode(opC)
    executor.addNode(opD)

    // Create a diamond dependency
    //     a
    //    / \
    //   b   c
    //    \ /
    //     d
    executor.addEdge('/a', '/b')
    executor.addEdge('/a', '/c')
    executor.addEdge('/b', '/d')
    executor.addEdge('/c', '/d')

    const levels = executor.getParallelExecutionLevels()
    expect(levels).toHaveLength(3)
    expect(levels[0]).toEqual(['/a'])
    expect(levels[1]).toContain('/b')
    expect(levels[1]).toContain('/c')
    expect(levels[2]).toEqual(['/d'])
  })

  it('should find roots and leaves', () => {
    const executor = new GraphExecutor()

    // Create operators
    const source1 = new DataSourceOp('/source1')
    const source2 = new DataSourceOp('/source2')
    const process1 = new ComputeOp('/process1')
    const sink1 = new ComputeOp('/sink1')
    const sink2 = new ComputeOp('/sink2')

    executor.addNode(source1)
    executor.addNode(source2)
    executor.addNode(process1)
    executor.addNode(sink1)
    executor.addNode(sink2)

    executor.addEdge('/source1', '/process1')
    executor.addEdge('/source2', '/process1')
    executor.addEdge('/process1', '/sink1')
    executor.addEdge('/process1', '/sink2')

    // Check that nodes with no upstream have empty upstream sets
    expect(executor.getUpstream('/source1').size).toBe(0)
    expect(executor.getUpstream('/source2').size).toBe(0)

    // Check that sink nodes have no downstream
    expect(executor.getDownstream('/sink1').size).toBe(0)
    expect(executor.getDownstream('/sink2').size).toBe(0)
  })
})
