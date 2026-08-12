// GraphExecutor - Execution engine for the operator graph
// Manages operator execution with topological sorting, dirty tracking, and a worker timer loop

import { debugExecutor, debugExecutorFrame } from '../utils/debug'
import { visibilityAdaptiveLoop } from '../utils/worker-timer'
import type { Field } from './fields'
import type { ForLoopBeginOp, ForLoopEndOp, ForLoopMetaOp, IOperator, Operator } from './operators'
import { getAllOps } from './store'
import {
  type ForLoopDefinition,
  findForLoopDefinitions,
  type GraphNode,
} from './utils/for-loop-group-utils'
import type { OpId } from './utils/id-utils'

export type ComputeResult<T = unknown> = {
  value: T
  changed: boolean
  error?: Error
}

// Edge type for graph connections
export type Edge = {
  id: string
  source: OpId
  target: OpId
  sourceHandle: string
  targetHandle: string
}

// Simple topological sort with cycle detection
export function topologicalSort(
  nodes: Map<string, Operator<IOperator>>,
  edges: Array<{ source: string; target: string }>
): {
  sorted: string[]
  cycles: string[][]
} {
  const adjacency = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()

  // Initialize
  for (const [id] of nodes) {
    adjacency.set(id, new Set())
    inDegree.set(id, 0)
  }

  // Build adjacency list and in-degree counts
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = []
  const sorted: string[] = []

  // Find all nodes with no incoming edges
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id)
    }
  }

  while (queue.length > 0) {
    const node = queue.shift()!
    sorted.push(node)

    // Process neighbors
    for (const neighbor of adjacency.get(node) || []) {
      const degree = (inDegree.get(neighbor) || 0) - 1
      inDegree.set(neighbor, degree)

      if (degree === 0) {
        queue.push(neighbor)
      }
    }
  }

  // Detect cycles
  const cycles: string[][] = []
  if (sorted.length !== nodes.size) {
    // Find nodes that weren't visited (part of cycles)
    const unvisited = new Set(nodes.keys())
    for (const node of sorted) {
      unvisited.delete(node)
    }

    // Simple cycle detection - find strongly connected components
    for (const start of unvisited) {
      const cycle = findCycle(start, adjacency, new Set())
      if (cycle.length > 0) {
        cycles.push(cycle)
      }
    }
  }

  return { sorted, cycles }
}

// Helper to find a cycle starting from a node
function findCycle(
  node: string,
  adjacency: Map<string, Set<string>>,
  visited: Set<string>,
  path: string[] = []
): string[] {
  if (visited.has(node)) {
    const cycleStart = path.indexOf(node)
    return cycleStart >= 0 ? path.slice(cycleStart) : []
  }

  visited.add(node)
  path.push(node)

  for (const neighbor of adjacency.get(node) || []) {
    const cycle = findCycle(neighbor, adjacency, visited, [...path])
    if (cycle.length > 0) {
      return cycle
    }
  }

  return []
}

// Execution options
export type ExecutorOptions = {
  targetFPS?: number // Target frame rate (default 60)
  parallel?: boolean // Execute independent nodes in parallel
  batchDelay?: number // Delay for batching dirty marks (ms)
  enableProfiling?: boolean // Enable performance monitoring
}

// Performance metrics
export type PerformanceMetrics = {
  frameTime: number
  executionCount: number
  dirtyCount: number
  totalOperators: number
}

type ForLoopScope = {
  beginOp: ForLoopBeginOp
  endOp: ForLoopEndOp
  metaOp?: ForLoopMetaOp
  scopeNodeIds: string[]
}

// GraphExecutor - manages execution of the operator graph
export class GraphExecutor {
  private nodes: Map<string, Operator<IOperator>> = new Map()
  private edges: Array<{ source: string; target: string }> = []
  private upstream: Map<string, Set<string>> = new Map()
  private downstream: Map<string, Set<string>> = new Map()
  private sortedOrder: string[] = []
  private executionLevels: string[][] = []
  private forLoopDefinitions: ForLoopDefinition[] = []
  private isDirty = true
  private options: Required<ExecutorOptions>
  // Track nodes added directly via addNode() (not from store sync)
  private manuallyAddedNodes: Set<string> = new Set()

  // Loop cancel function — RAF when visible, worker timer when hidden
  private cancelLoop: (() => void) | null = null
  private isPulling = false
  private lastFrameTime = 0
  private frameInterval: number
  // Prevent unchanged or failed ForLoop scopes from rerunning every RAF frame.
  private executedForLoopScopes = new Map<string, string>()

  // Dirty tracking
  private dirtyNodes: Set<string> = new Set()
  private batchTimeout: number | null = null

  // Performance tracking
  private metrics: PerformanceMetrics = {
    frameTime: 0,
    executionCount: 0,
    dirtyCount: 0,
    totalOperators: 0,
  }

  constructor(options: ExecutorOptions = {}) {
    this.options = {
      targetFPS: options.targetFPS ?? 60,
      parallel: options.parallel ?? true,
      batchDelay: options.batchDelay ?? 16,
      enableProfiling: options.enableProfiling ?? false,
    }
    this.frameInterval = 1000 / this.options.targetFPS
  }

  setForLoopDefinitions(definitions: ForLoopDefinition[]): void {
    this.forLoopDefinitions = definitions
  }

  // Start the execution loop
  start(): void {
    if (this.cancelLoop !== null) return
    this.lastFrameTime = performance.now()
    this.cancelLoop = visibilityAdaptiveLoop(this.loop, this.frameInterval)
  }

  // Stop the execution loop
  stop(): void {
    this.cancelLoop?.()
    this.cancelLoop = null
    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
  }

  // Main loop - runs via RAF when visible (vsync-coordinated), worker timer when hidden
  private loop = (currentTime: number): void => {
    const deltaTime = currentTime - this.lastFrameTime

    // Guard against the interval firing more frequently than expected
    if (deltaTime >= this.frameInterval) {
      this.lastFrameTime = currentTime - (deltaTime % this.frameInterval)

      if (!this.isPulling) {
        this.isPulling = true
        this.executeFrame(currentTime).finally(() => {
          this.isPulling = false
        })
      }
    }
  }

  get isRunning(): boolean {
    return this.cancelLoop !== null
  }

  // Add a node to the graph
  addNode(node: Operator<IOperator>): void {
    this.nodes.set(node.id, node)
    this.manuallyAddedNodes.add(node.id) // Track manually added nodes
    this.isDirty = true
  }

  // Remove a node and all its connections
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId)
    this.manuallyAddedNodes.delete(nodeId) // Also remove from tracking
    this.edges = this.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId)
    this.upstream.delete(nodeId)
    this.downstream.delete(nodeId)
    for (const set of this.upstream.values()) set.delete(nodeId)
    for (const set of this.downstream.values()) set.delete(nodeId)
    this.isDirty = true
  }

  // Add an edge between nodes
  addEdge(sourceId: string, targetId: string): void {
    // Check for cycle
    const testEdges = [...this.edges, { source: sourceId, target: targetId }]
    const { cycles } = topologicalSort(this.nodes, testEdges)

    if (cycles.length > 0) {
      throw new Error(`Adding edge would create cycle: ${cycles[0].join(' -> ')}`)
    }

    this.edges.push({ source: sourceId, target: targetId })

    // Update upstream/downstream maps
    if (!this.downstream.has(sourceId)) this.downstream.set(sourceId, new Set())
    this.downstream.get(sourceId)!.add(targetId)

    if (!this.upstream.has(targetId)) this.upstream.set(targetId, new Set())
    this.upstream.get(targetId)!.add(sourceId)

    this.isDirty = true
  }

  // Remove an edge
  removeEdge(sourceId: string, targetId: string): void {
    this.edges = this.edges.filter(edge => !(edge.source === sourceId && edge.target === targetId))
    this.downstream.get(sourceId)?.delete(targetId)
    this.upstream.get(targetId)?.delete(sourceId)
    this.isDirty = true
  }

  // Build graph from edges array
  buildFromEdges(edges: Edge[]): void {
    this.edges = []
    this.upstream.clear()
    this.downstream.clear()

    for (const edge of edges) {
      // Skip self-referencing parameter edges (not true cycles - output depends on input value)
      const isSelfParameterReference =
        edge.source === edge.target && edge.sourceHandle?.startsWith('par.')

      if (isSelfParameterReference) {
        continue
      }

      this.edges.push({ source: edge.source, target: edge.target })

      if (!this.downstream.has(edge.source)) this.downstream.set(edge.source, new Set())
      this.downstream.get(edge.source)!.add(edge.target)

      if (!this.upstream.has(edge.target)) this.upstream.set(edge.target, new Set())
      this.upstream.get(edge.target)!.add(edge.source)
    }

    this.isDirty = true
  }

  // Get upstream dependencies for a node
  getUpstream(nodeId: string): Set<string> {
    return this.upstream.get(nodeId) || new Set()
  }

  // Get downstream dependents for a node
  getDownstream(nodeId: string): Set<string> {
    return this.downstream.get(nodeId) || new Set()
  }

  // Check if adding an edge would create a cycle
  wouldCreateCycle(sourceId: string, targetId: string): boolean {
    const testEdges = [...this.edges, { source: sourceId, target: targetId }]
    const { cycles } = topologicalSort(this.nodes, testEdges)
    return cycles.length > 0
  }

  // Update topological sort and execution levels
  private updateSort(): void {
    if (!this.isDirty) return

    const { sorted, cycles } = topologicalSort(this.nodes, this.edges)

    if (cycles.length > 0) {
      debugExecutor('Cycles detected in graph:', cycles)
    }

    this.sortedOrder = sorted
    this.executionLevels = this.computeExecutionLevels(sorted)
    this.isDirty = false
  }

  // Compute parallel execution levels
  private computeExecutionLevels(sorted: string[]): string[][] {
    const levels: string[][] = []
    const nodeLevel = new Map<string, number>()

    for (const nodeId of sorted) {
      // Find max level of dependencies
      let maxLevel = -1
      for (const edge of this.edges) {
        if (edge.target === nodeId) {
          const sourceLevel = nodeLevel.get(edge.source) || 0
          maxLevel = Math.max(maxLevel, sourceLevel)
        }
      }

      const level = maxLevel + 1
      nodeLevel.set(nodeId, level)

      if (!levels[level]) {
        levels[level] = []
      }
      levels[level].push(nodeId)
    }

    return levels
  }

  // Get execution order for debugging
  getExecutionOrder(): string[] {
    this.updateSort()
    return [...this.sortedOrder]
  }

  // Get parallel execution levels
  getParallelExecutionLevels(): string[][] {
    this.updateSort()
    return this.executionLevels.map(level => [...level])
  }

  // Execute a single frame - uses pull-based execution from root operators
  async executeFrame(_time: number): Promise<Map<string, ComputeResult>> {
    const frameStart = performance.now()
    const results = new Map<string, ComputeResult>()

    // Sync nodes from store to ensure we have latest operators
    this.syncNodesFromStore()
    this.updateSort()

    // Nothing to execute yet — skip silently until the graph is populated
    if (this.nodes.size === 0) return results

    debugExecutorFrame(
      'executeFrame: nodes=%d, edges=%d, dirty=%d',
      this.nodes.size,
      this.edges.length,
      this.dirtyNodes.size
    )

    // Reset frame metrics
    if (this.options.enableProfiling) {
      this.metrics.executionCount = 0
      this.metrics.dirtyCount = this.dirtyNodes.size
    }

    // Find and execute ForLoop scopes first
    // ForLoop scopes need to complete their iterations before downstream operators can pull their results
    const forLoopScopes = this.findForLoopScopes()
    const activeForLoopEndIds = new Set(forLoopScopes.map(scope => scope.endOp.id))
    for (const endOpId of this.executedForLoopScopes.keys()) {
      if (!activeForLoopEndIds.has(endOpId)) this.executedForLoopScopes.delete(endOpId)
    }

    const nestedBeginIds = new Set(
      forLoopScopes.flatMap(parentScope =>
        forLoopScopes
          .filter(scope => this.isNestedForLoopScope(parentScope, scope))
          .map(scope => scope.beginOp.id)
      )
    )

    for (const scope of forLoopScopes.filter(scope => !nestedBeginIds.has(scope.beginOp.id))) {
      const scopeIsDirty = scope.scopeNodeIds.some(id => this.nodes.get(id)?.dirty)
      const scopeSignature = this.getForLoopScopeSignature(scope.scopeNodeIds)
      if (this.executedForLoopScopes.get(scope.endOp.id) === scopeSignature && !scopeIsDirty) {
        continue
      }

      try {
        const loopResults = await this.executeForLoopScope(
          scope.beginOp,
          scope.endOp,
          scope.scopeNodeIds,
          scope.metaOp,
          forLoopScopes
        )
        results.set(scope.endOp.id, { value: { data: loopResults }, changed: true })
      } catch (error) {
        // pull() leaves a failed operator in ERROR state. Clear only the public
        // dirty bit so the RAF loop does not immediately retry it; a real input
        // change calls markDirty() and makes the scope eligible again.
        for (const id of scope.scopeNodeIds) {
          const op = this.nodes.get(id)
          if (op) op.dirty = false
        }
        // Keep the last completed output cached so downstream root pulls do not
        // enter ForLoopEndOp's fallback iterator and retry within this frame.
        scope.endOp.setCachedOutput({ data: scope.endOp.outputs.data.value })
        console.error('[Noodles] ForLoop execution error:', error)
        results.set(scope.endOp.id, {
          value: null,
          changed: false,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      } finally {
        this.executedForLoopScopes.set(scope.endOp.id, scopeSignature)
      }
    }

    // Find root operators to pull from (sinks like DeckRenderer, Viewer, etc.)
    // ForLoopEndOp may have downstream roots that will pull from its cached results
    const roots = this.findRootOperators()

    debugExecutorFrame(
      'Pulling roots: %d dirty nodes, %d roots %O',
      this.dirtyNodes.size,
      roots.length,
      roots.map(op => op.id)
    )

    // Pull from roots - this recursively executes all upstream dependencies
    if (this.options.parallel) {
      await Promise.all(
        roots.map(async op => {
          try {
            const output = await op.pull()
            results.set(op.id, { value: output, changed: true })
          } catch (error) {
            results.set(op.id, {
              value: null,
              changed: false,
              error: error instanceof Error ? error : new Error(String(error)),
            })
          }
        })
      )
    } else {
      for (const op of roots) {
        try {
          const output = await op.pull()
          results.set(op.id, { value: output, changed: true })
        } catch (error) {
          results.set(op.id, {
            value: null,
            changed: false,
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      }
    }

    // Update metrics
    this.metrics.frameTime = performance.now() - frameStart
    this.metrics.executionCount = results.size
    this.metrics.totalOperators = this.nodes.size

    debugExecutorFrame('Frame complete: %dms', this.metrics.frameTime.toFixed(2))

    return results
  }

  // Mark specific nodes as dirty
  markDirty(nodeIds: string[]): void {
    if (this.options.batchDelay && this.options.batchDelay > 0) {
      // Batch dirty marks
      for (const id of nodeIds) {
        this.dirtyNodes.add(id)
        const node = this.nodes.get(id)
        if (node) node.dirty = true
      }

      if (this.batchTimeout === null) {
        this.batchTimeout = window.setTimeout(() => {
          this.batchTimeout = null
        }, this.options.batchDelay)
      }
    } else {
      // Mark immediately
      for (const id of nodeIds) {
        this.dirtyNodes.add(id)
        const node = this.nodes.get(id)
        if (node) node.dirty = true
        this.markDownstreamDirty(id)
      }
    }
  }

  // Mark downstream nodes as dirty
  private markDownstreamDirty(nodeId: string): void {
    for (const edge of this.edges) {
      if (edge.source === nodeId) {
        this.dirtyNodes.add(edge.target)
        const node = this.nodes.get(edge.target)
        if (node) node.dirty = true
        this.markDownstreamDirty(edge.target)
      }
    }
  }

  // Force update all nodes
  forceUpdate(): void {
    for (const [id, node] of this.nodes) {
      this.dirtyNodes.add(id)
      node.dirty = true
    }
  }

  // Get execution statistics
  getStats(): {
    nodeCount: number
    edgeCount: number
    lastExecutionTime: number
    dirtyCount: number
  } {
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      lastExecutionTime: this.metrics.frameTime,
      dirtyCount: this.dirtyNodes.size,
    }
  }

  // Get performance metrics
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics }
  }

  // Create a sub-graph scope for control flow operations
  createScope(parentId: string): GraphScope {
    return new GraphScope(this, parentId)
  }

  // Get a node by ID
  getNode(nodeId: string): Operator<IOperator> | undefined {
    return this.nodes.get(nodeId)
  }

  // Get all edges
  getEdges(): Array<{ source: string; target: string }> {
    return [...this.edges]
  }

  // Sync nodes from the operator store
  syncNodesFromStore(): void {
    const ops = getAllOps()

    let changed = false
    let replacedNode = false

    // Remove nodes that no longer exist in store (but preserve manually added nodes)
    for (const [id] of this.nodes) {
      // Don't remove nodes that were manually added via addNode()
      if (!this.manuallyAddedNodes.has(id) && !ops.find(op => op.id === id)) {
        this.nodes.delete(id)
        changed = true
      }
    }

    // Add/update nodes from store. A project reload can reuse operator IDs while
    // replacing every operator instance, so identity changes must invalidate
    // execution caches even when the graph topology is unchanged.
    for (const op of ops) {
      const existing = this.nodes.get(op.id)
      if (!existing) {
        this.nodes.set(op.id, op)
        // New nodes are dirty by default
        if (op.dirty) {
          this.dirtyNodes.add(op.id)
        }
        changed = true
      } else if (existing !== op && !this.manuallyAddedNodes.has(op.id)) {
        this.nodes.set(op.id, op)
        this.dirtyNodes.add(op.id)
        changed = true
        replacedNode = true
      }
    }

    if (replacedNode) this.executedForLoopScopes.clear()
    if (changed) this.isDirty = true
  }

  // Find root operators (sinks - DeckRenderer, Out, Viewer, etc.)
  findRootOperators(): Operator<IOperator>[] {
    const roots: Operator<IOperator>[] = []

    for (const [_, op] of this.nodes) {
      const opType = (op.constructor as { displayName?: string }).displayName

      if (
        opType === 'DeckRenderer' ||
        opType === 'Out' ||
        opType === 'Viewer' ||
        opType === 'ConsoleOp'
      ) {
        roots.push(op)
      } else {
        // Also include operators with no downstream dependents
        const downstream = this.getDownstream(op.id)
        if (downstream.size === 0) {
          const upstream = this.getUpstream(op.id)
          if (upstream.size > 0) {
            roots.push(op)
          }
        }
      }
    }

    return roots
  }

  // Execute a ForLoop scope - handles iteration with accumulator (reduce-like semantics)
  // Uses pull-based execution with caching to ensure correct iteration values propagate
  async executeForLoopScope(
    beginOp: ForLoopBeginOp,
    endOp: ForLoopEndOp,
    scopeNodeIds: string[],
    metaOp?: ForLoopMetaOp,
    allScopes?: ForLoopScope[]
  ): Promise<unknown[]> {
    // First pull beginOp to get the input data
    await beginOp.pull()

    const data = beginOp.inputs.data.value
    if (!Array.isArray(data) || data.length === 0) {
      endOp.outputs.data.next([])
      endOp.setCachedOutput({ data: [] })
      return []
    }

    const total = data.length
    const results: unknown[] = []

    const currentScope: ForLoopScope = {
      beginOp,
      endOp,
      metaOp,
      scopeNodeIds,
    }
    const loopScopes = allScopes ?? this.findForLoopScopes()
    const nestedScopes = this.findDirectNestedForLoopScopes(currentScope, loopScopes)
    const nestedScopeByNodeId = new Map<string, ForLoopScope>()
    for (const nestedScope of nestedScopes) {
      for (const nodeId of nestedScope.scopeNodeIds) {
        nestedScopeByNodeId.set(nodeId, nestedScope)
      }
    }

    // Sort the complete path so nested loops can execute atomically at the point
    // where their Begin boundary occurs in the parent's execution order.
    const executionNodeIds = scopeNodeIds.filter(
      id => id !== beginOp.id && id !== endOp.id && id !== metaOp?.id
    )
    const scopeNodes = new Map(
      executionNodeIds
        .map(id => [id, this.nodes.get(id)] as const)
        .filter((entry): entry is [string, Operator<IOperator>] => entry[1] !== undefined)
    )
    const scopeEdges = this.edges.filter(e => scopeNodes.has(e.source) && scopeNodes.has(e.target))
    const { sorted } = topologicalSort(scopeNodes, scopeEdges)
    const executionOrder = sorted

    // Get initial accumulator value if meta op exists
    let accumulator: unknown = metaOp?.inputs.initialValue.value ?? null

    // Hoist edge lookup out of the loop for O(1) per-iteration performance
    // Instead of calling getOutputValueForField() every iteration (O(edges) scan)
    const targetHandle = this.getFieldHandle(endOp.inputs.item)
    const connectingEdge = this.edges.find(
      edge => edge.target === endOp.id && edge.targetHandle === targetHandle
    )
    const resultSourceOp = connectingEdge ? this.nodes.get(connectingEdge.source) : undefined
    let resultOutputKey: string | null = null
    if (!targetHandle) {
      console.warn(
        `[GraphExecutor] getFieldHandle returned empty for endOp.inputs.item in ForLoop ${beginOp.id}`
      )
    }
    if (connectingEdge) {
      resultOutputKey = connectingEdge.sourceHandle.split('.')[1] || null
    }

    for (let index = 0; index < total; index++) {
      const item = data[index]
      const isFirst = index === 0
      const isLast = index === total - 1

      // Set iteration values on ForLoopBeginOp outputs
      beginOp.outputs.item.next(item)
      beginOp.outputs.index.next(index)
      beginOp.outputs.total.next(total)

      // CRITICAL: Cache BeginOp so downstream pulls return iteration values
      // Without this, pulling intermediate ops re-executes BeginOp and gets arr[0]
      beginOp.setCachedOutput({ item, index, total })

      // Set iteration metadata on ForLoopMetaOp if present
      if (metaOp) {
        metaOp.outputs.accumulator.next(accumulator)
        metaOp.outputs.index.next(index)
        metaOp.outputs.total.next(total)
        metaOp.outputs.isFirst.next(isFirst)
        metaOp.outputs.isLast.next(isLast)
        metaOp.setCachedOutput({ accumulator, index, total, isFirst, isLast })
      }

      // Mark intermediate operators dirty for this iteration
      for (const nodeId of executionOrder) {
        this.nodes.get(nodeId)?.markDirty()
      }

      // Pull ordinary operators in order. A nested loop executes once, as an
      // atomic operation, when its Begin boundary is reached; the parent skips
      // the rest of that loop's internal nodes.
      const executedNestedScopes = new Set<string>()
      for (const nodeId of executionOrder) {
        const nestedScope = nestedScopeByNodeId.get(nodeId)
        if (nestedScope) {
          if (
            nodeId === nestedScope.beginOp.id &&
            !executedNestedScopes.has(nestedScope.beginOp.id)
          ) {
            await this.executeForLoopScope(
              nestedScope.beginOp,
              nestedScope.endOp,
              nestedScope.scopeNodeIds,
              nestedScope.metaOp,
              loopScopes
            )
            executedNestedScopes.add(nestedScope.beginOp.id)
          }
          continue
        }
        await this.nodes.get(nodeId)?.pull()
      }

      // Collect result from this iteration using pre-computed output key
      const resultValue =
        resultSourceOp && resultOutputKey && resultSourceOp._cachedOutput
          ? (resultSourceOp._cachedOutput[resultOutputKey] ?? endOp.inputs.item.value)
          : executionOrder.length > 0
            ? endOp.inputs.item.value
            : beginOp.outputs.item.value
      results.push(resultValue)

      // Update accumulator from meta op's currentValue input for next iteration
      if (metaOp) {
        accumulator = metaOp.inputs.currentValue.value
      }
    }

    // Set final results on ForLoopEndOp
    endOp.outputs.data.next(results)
    endOp.setCachedOutput({ data: results })

    return results
  }

  private getForLoopScopeSignature(scopeNodeIds: string[]): string {
    const nodeIds = [...new Set(scopeNodeIds)].sort()
    const nodeIdSet = new Set(nodeIds)
    const edges = this.edges
      .filter(edge => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
      .map(edge => `${edge.source}->${edge.target}`)
      .sort()

    return `${nodeIds.join('|')}::${edges.join('|')}`
  }

  private isNestedForLoopScope(parent: ForLoopScope, child: ForLoopScope): boolean {
    return (
      parent.beginOp !== child.beginOp &&
      parent.scopeNodeIds.includes(child.beginOp.id) &&
      parent.scopeNodeIds.includes(child.endOp.id)
    )
  }

  private findDirectNestedForLoopScopes(
    parent: ForLoopScope,
    scopes: ForLoopScope[]
  ): ForLoopScope[] {
    const nestedScopes = scopes.filter(scope => this.isNestedForLoopScope(parent, scope))
    return nestedScopes.filter(
      child =>
        !nestedScopes.some(
          possibleParent =>
            possibleParent !== child && this.isNestedForLoopScope(possibleParent, child)
        )
    )
  }

  // Find ForLoop scopes in the graph. A scope contains only nodes that are both
  // downstream of Begin and upstream of its paired End (nodes on a Begin-to-End path).
  findForLoopScopes(): ForLoopScope[] {
    const scopes: ForLoopScope[] = []

    const reachable = (startId: string, graph: Map<string, Set<string>>): Set<string> => {
      const visited = new Set<string>()
      const queue = [startId]
      while (queue.length > 0) {
        const id = queue.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        queue.push(...(graph.get(id) ?? []))
      }
      return visited
    }
    const definitionByBeginId = new Map(
      this.forLoopDefinitions.map(definition => [definition.beginId, definition])
    )

    // Find all ForLoopBeginOp nodes
    for (const [_, op] of this.nodes) {
      const opType = (op.constructor as { displayName?: string }).displayName
      if (opType === 'ForLoopBegin') {
        const definition = definitionByBeginId.get(op.id)
        const downstream = reachable(op.id, this.downstream)
        const configuredEnd = definition ? this.nodes.get(definition.endId) : undefined
        const inferredEnd = [...downstream]
          .map(id => this.nodes.get(id))
          .find(
            candidate =>
              (candidate?.constructor as { displayName?: string } | undefined)?.displayName ===
              'ForLoopEnd'
          )
        const endOp = (configuredEnd ?? inferredEnd) as ForLoopEndOp | undefined

        if (endOp) {
          const upstream = reachable(endOp.id, this.upstream)
          const scopeNodeIds = [...this.nodes.keys()].filter(
            id => downstream.has(id) && upstream.has(id)
          )
          const configuredMeta = definition?.metaIds
            .map(id => this.nodes.get(id))
            .find(candidate => candidate && scopeNodeIds.includes(candidate.id))
          const inferredMeta = scopeNodeIds
            .map(id => this.nodes.get(id))
            .find(
              candidate =>
                (candidate?.constructor as { displayName?: string } | undefined)?.displayName ===
                'ForLoopMeta'
            )
          const metaOp = (configuredMeta ?? inferredMeta) as ForLoopMetaOp | undefined

          scopes.push({
            beginOp: op as ForLoopBeginOp,
            endOp,
            metaOp,
            scopeNodeIds,
          })
        }
      }
    }

    return scopes
  }

  // Helper to get the field handle string for a given field
  private getFieldHandle(field: Field<unknown>): string {
    // Fields are stored in operator.inputs or operator.outputs
    // The handle format is "par.fieldName" or "out.fieldName"
    const op = field.op
    if (!op) {
      console.warn('[GraphExecutor] getFieldHandle called with field that has no op reference')
      return ''
    }

    // Check inputs
    for (const [key, f] of Object.entries(op.inputs)) {
      if (f === field) return `par.${key}`
    }
    // Check outputs
    for (const [key, f] of Object.entries(op.outputs)) {
      if (f === field) return `out.${key}`
    }

    // Field not found in enumerable properties - could be non-enumerable, Map-stored, or inherited
    console.warn(
      `[GraphExecutor] getFieldHandle could not find field in operator ${op.id} inputs/outputs. ` +
        'This may indicate non-enumerable properties or unconventional field storage.'
    )
    return ''
  }
}

// GraphScope for control flow operations
export class GraphScope {
  private parentGraph: GraphExecutor
  private parentId: string
  private nodes: Map<string, Operator<IOperator>> = new Map()
  private edges: Array<{ source: string; target: string }> = []
  private context: Map<string, unknown> = new Map()
  private namespace: string

  constructor(parentGraph: GraphExecutor, parentId: string, namespace?: string) {
    this.parentGraph = parentGraph
    this.parentId = parentId
    this.namespace = namespace || parentId
  }

  // Reference nodes from parent graph - scopes don't rename nodes
  addNodeReference(nodeId: string): void {
    const node = this.parentGraph.getNode(nodeId)
    if (node) {
      this.nodes.set(nodeId, node)
    }
  }

  // Add edge within scope
  addEdge(sourceId: string, targetId: string): void {
    this.edges.push({ source: sourceId, target: targetId })
  }

  // Execute this scope with given input
  async execute(input: unknown): Promise<ComputeResult> {
    // Set input in context
    this.setContext('input', input)

    // Sort nodes for this scope
    const { sorted } = topologicalSort(this.nodes, this.edges)

    // Execute nodes in order
    let lastResult: ComputeResult = { value: input, changed: false }

    for (const nodeId of sorted) {
      const node = this.nodes.get(nodeId)
      if (node) {
        // Get input values
        const inputs = {}
        for (const [key, field] of Object.entries(node.inputs)) {
          inputs[key] = field.value
        }

        // Execute the operator
        const outputs = await node.execute(inputs)
        lastResult = { value: outputs, changed: true }

        // Store intermediate results in context
        this.setContext(`${nodeId}_result`, lastResult.value)
      }
    }

    return lastResult
  }

  // Clone this scope for iterative execution
  clone(): GraphScope {
    const cloned = new GraphScope(this.parentGraph, this.parentId, this.namespace)

    // Copy node references
    for (const [id, node] of this.nodes) {
      cloned.nodes.set(id, node)
    }

    // Copy edges
    cloned.edges = [...this.edges]

    // Share context (with namespace)
    cloned.context = new Map(this.context)

    return cloned
  }

  // Get a value from the namespaced context
  getContext<T>(key: string): T | undefined {
    const namespacedKey = `${this.namespace}:${key}`
    return this.context.get(namespacedKey) as T | undefined
  }

  // Set a value in the namespaced context
  setContext(key: string, value: unknown): void {
    const namespacedKey = `${this.namespace}:${key}`
    this.context.set(namespacedKey, value)
  }

  // Mark parent dirty when scope execution changes something
  markParentDirty(): void {
    this.parentGraph.markDirty([this.parentId])
  }
}

// Global executor instance
let globalExecutor: GraphExecutor | null = null

// Initialize the execution system
export function initializeExecutor(options?: ExecutorOptions): GraphExecutor {
  // Stop the previous executor before replacing it to prevent RAF leaks
  globalExecutor?.stop()
  globalExecutor = new GraphExecutor(options)

  if (typeof window !== 'undefined') {
    ;(window as Window & { __noodlesExecutor?: GraphExecutor }).__noodlesExecutor = globalExecutor
  }

  return globalExecutor
}

// Get the global executor
export function getExecutor(): GraphExecutor | null {
  return globalExecutor
}

// Start the executor
export function startExecutor(): void {
  if (!globalExecutor) {
    initializeExecutor()
  }
  globalExecutor?.start()
}

// Stop the executor
export function stopExecutor(): void {
  globalExecutor?.stop()
}

// Update graph from edges - syncs nodes from the store
export function updateGraph(nodes: GraphNode[], edges: Edge[]): void {
  if (!globalExecutor) {
    initializeExecutor()
  }
  if (globalExecutor) {
    // Sync nodes from store
    globalExecutor.syncNodesFromStore()
    // Build edge relationships
    globalExecutor.buildFromEdges(edges)
    globalExecutor.setForLoopDefinitions(findForLoopDefinitions(nodes))
    // Start the RAF loop if not already running
    if (!globalExecutor.isRunning) {
      globalExecutor.start()
    }
  }
}

// Force update all operators
export function forceUpdate(): void {
  globalExecutor?.forceUpdate()
}

// Get performance metrics
export function getPerformanceMetrics(): PerformanceMetrics | null {
  return globalExecutor?.getMetrics() ?? null
}

// Check if adding an edge would create a cycle
export function wouldCreateCycle(sourceId: string, targetId: string): boolean {
  return globalExecutor?.wouldCreateCycle(sourceId, targetId) ?? false
}

// Get execution order for debugging
export function getExecutionOrder(): string[] | null {
  return globalExecutor?.getExecutionOrder() ?? null
}
