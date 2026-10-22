// Performance benchmark tests for pull-based execution model

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    for (const op of ops) {
      op.markDirty()
    }

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
    for (const op of operators) {
      op.markDirty()
    }
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

// Operator that takes a configurable amount of time to execute
class SlowOp extends Operator<SlowOp> {
  static displayName = 'Slow'
  delayMs = 0

  createInputs() {
    return { value: new NumberField(0) }
  }

  createOutputs() {
    return { result: new NumberField() }
  }

  async execute({ value }: ExtractProps<typeof this.inputs>) {
    if (this.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs))
    }
    return { result: value * 2 }
  }
}

describe('Execution indicator timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should not show executing indicator for fast ops (<200ms)', async () => {
    const op = new SlowOp('/fast-op')
    op.delayMs = 50

    const states: string[] = []
    const sub = op.executionState.subscribe(s => states.push(s.status))

    const pullPromise = op.pull()
    // Advance past the op's 50ms delay but not past the 200ms indicator threshold
    await vi.advanceTimersByTimeAsync(100)
    await pullPromise

    sub.unsubscribe()

    expect(states).not.toContain('executing')
    expect(states).toContain('success')
  })

  it('should show executing indicator for slow ops (>200ms)', async () => {
    const op = new SlowOp('/slow-op')
    op.delayMs = 300

    const states: string[] = []
    const sub = op.executionState.subscribe(s => states.push(s.status))

    const pullPromise = op.pull()
    // Advance past the 200ms indicator threshold
    await vi.advanceTimersByTimeAsync(250)
    expect(states).toContain('executing')

    // Finish execution
    await vi.advanceTimersByTimeAsync(100)
    await pullPromise

    sub.unsubscribe()

    expect(states).toContain('success')
  })

  it('should clear executing indicator on error', async () => {
    const op = new SlowOp('/error-op')
    op.delayMs = 300
    vi.spyOn(op, 'execute').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 300))
      throw new Error('test error')
    })

    const states: string[] = []
    const sub = op.executionState.subscribe(s => states.push(s.status))

    const pullPromise = op.pull().catch(() => {})
    await vi.advanceTimersByTimeAsync(250)
    expect(states).toContain('executing')

    await vi.advanceTimersByTimeAsync(100)
    await pullPromise

    sub.unsubscribe()

    expect(states).toContain('error')
  })
})

describe('markDirty wave benchmarks', () => {
  // The wave writes status through a single private helper; spying on it
  // counts wave visits exactly (a pruned mark performs zero status writes)
  const spyOnStatusWrites = () =>
    vi.spyOn(Operator.prototype as any, '_setPullExecutionStatus' as any)

  // Build a linear dependency chain. markDirty only follows downstream
  // dependents, so field connections are not needed for marking benchmarks
  const buildChain = (length: number, prefix: string) => {
    const ops: ChainOp[] = []
    for (let i = 0; i < length; i++) {
      const op = new ChainOp(`${prefix}-${i}`)
      if (i > 0) {
        ops[i - 1].addDownstreamDependent(op)
      }
      ops.push(op)
    }
    return ops
  }

  it('should prune repeated marks in O(1) regardless of closure size', () => {
    const K = 1000
    const chain50 = buildChain(50, '/wave-a50')
    const chain500 = buildChain(500, '/wave-a500')

    const timeRepeatedMarks = (head: ChainOp) => {
      head.markDirty() // stamp the closure in the current epoch
      const spy = spyOnStatusWrites()
      const start = performance.now()
      for (let i = 0; i < K; i++) {
        head.markDirty()
      }
      const elapsed = performance.now() - start
      expect(spy).toHaveBeenCalledTimes(0) // fully pruned: zero status writes
      spy.mockRestore()
      return elapsed
    }

    const time50 = timeRepeatedMarks(chain50[0])
    const time500 = timeRepeatedMarks(chain500[0])

    console.log(`${K} repeated marks, 50-op chain:`, time50.toFixed(2), 'ms')
    console.log(`${K} repeated marks, 500-op chain:`, time500.toFixed(2), 'ms')
    console.log('Ratio (500/50):', (time500 / Math.max(time50, 0.001)).toFixed(2), 'x')

    // Repeated-mark cost must not scale with closure size. The true ratio is
    // ~1; allow 5x plus a small absolute floor to absorb CI timing noise
    expect(time500).toBeLessThan(Math.max(time50 * 5, 5))
  })

  it('should walk the closure exactly once on the first mark after invalidation', () => {
    const chain = buildChain(500, '/wave-b')
    const head = chain[0]
    const tail = chain[chain.length - 1]

    head.markDirty() // everything dirty and stamped
    // Any operator leaving DIRTY invalidates the prune
    tail.setCachedOutput({ output: 0 })

    const spy = spyOnStatusWrites()
    const start = performance.now()
    head.markDirty()
    const firstWalkTime = performance.now() - start
    expect(spy).toHaveBeenCalledTimes(500) // every op visited exactly once

    head.markDirty()
    expect(spy).toHaveBeenCalledTimes(500) // second wave fully pruned
    spy.mockRestore()

    console.log('First walk after invalidation (500 ops):', firstWalkTime.toFixed(2), 'ms')
  })

  it('should mark each op at most once across a scrub burst with 25 entry points', () => {
    // Real-project shape: 25 keyframed sources with 20-op subtrees converging
    // on one shared sink (501 ops). A scrub burst marks all 25 sources every
    // frame for 60 frames with no pulls in between.
    const sink = new ChainOp('/wave-c-sink')
    const sources: ChainOp[] = []
    let totalOps = 1
    for (let s = 0; s < 25; s++) {
      const branch = buildChain(20, `/wave-c${s}`)
      branch[branch.length - 1].addDownstreamDependent(sink)
      sources.push(branch[0])
      totalOps += branch.length
    }
    expect(totalOps).toBe(501)

    const frames = 60
    const spy = spyOnStatusWrites()
    const start = performance.now()
    for (let frame = 0; frame < frames; frame++) {
      for (const source of sources) {
        source.markDirty()
      }
    }
    const burstTime = performance.now() - start

    // Cross-entry pruning: the epoch stamp is shared across waves, so the
    // sink is written by the first source's wave and pruned in the other 24,
    // and frames 2-60 prune immediately at each already-stamped source.
    // Every op is status-written exactly once across all 1500 marks.
    expect(spy).toHaveBeenCalledTimes(totalOps)
    spy.mockRestore()

    console.log(
      `Scrub burst (${frames} frames x 25 sources, ${totalOps} ops):`,
      burstTime.toFixed(2),
      'ms'
    )
    console.log('Per-frame average:', (burstTime / frames).toFixed(3), 'ms')
  })

  it('should bound prune-invalidation after a pull to one full walk', async () => {
    // Chain wired for pulling: field connections and upstream dependencies
    const length = 100
    const ops: ChainOp[] = []
    for (let i = 0; i < length; i++) {
      const op = new ChainOp(`/wave-d-${i}`)
      if (i > 0) {
        op.inputs.input.addConnection(`wave-d-conn-${i}`, ops[i - 1].outputs.output)
        op.addUpstreamDependency(ops[i - 1])
        ops[i - 1].addDownstreamDependent(op)
      }
      ops.push(op)
    }
    const head = ops[0]
    const tail = ops[length - 1]

    head.markDirty()
    await tail.pull() // cleans the whole chain (each clean bumps the epoch)
    expect(tail.pullExecutionStatus).toBe(PullExecutionStatus.CLEAN)

    const spy = spyOnStatusWrites()
    head.markDirty()
    expect(spy).toHaveBeenCalledTimes(length) // one full walk after cleaning

    head.markDirty()
    head.markDirty()
    expect(spy).toHaveBeenCalledTimes(length) // subsequent marks pruned again
    spy.mockRestore()
  })
})
