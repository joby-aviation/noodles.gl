// GraphExecutor - Execution engine for the operator graph
// Manages operator execution with topological sorting, dirty tracking, and RAF loop

import type { IOperator, Operator } from './operators'
import { getAllOps, getOp } from './store'
import type { OpId } from './utils/id-utils'

// Simple types for execution
export type ComputeState = {
  time: number
  frame: number
  context: Map<string, unknown>
  scope?: GraphScope
}

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

// GraphExecutor - manages execution of the operator graph
export class GraphExecutor {
  private nodes: Map<string, Operator<IOperator>> = new Map()
  private edges: Array<{ source: string; target: string }> = []
  private upstream: Map<string, Set<string>> = new Map()
  private downstream: Map<string, Set<string>> = new Map()
  private sortedOrder: string[] = []
  private executionLevels: string[][] = []
  private isDirty: boolean = true
  private options: Required<ExecutorOptions>

  // RAF loop state
  private rafId: number | null = null
  private isPulling: boolean = false
  private lastFrameTime: number = 0
  private frameInterval: number

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
  private executionCount: number = 0

  constructor(options: ExecutorOptions = {}) {
    this.options = {
      targetFPS: options.targetFPS ?? 60,
      parallel: options.parallel ?? true,
      batchDelay: options.batchDelay ?? 16,
      enableProfiling: options.enableProfiling ?? false,
    }
    this.frameInterval = 1000 / this.options.targetFPS
  }

  // Start the execution loop
  start(): void {
    if (this.rafId !== null) return
    this.lastFrameTime = performance.now()
    this.loop()
  }

  // Stop the execution loop
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.batchTimeout !== null) {
      clearTimeout(this.batchTimeout)
      this.batchTimeout = null
    }
  }

  // Main loop - runs on animation frame
  private loop = (): void => {
    const currentTime = performance.now()
    const deltaTime = currentTime - this.lastFrameTime

    // Throttle to target FPS
    if (deltaTime >= this.frameInterval) {
      this.lastFrameTime = currentTime - (deltaTime % this.frameInterval)

      if (!this.isPulling) {
        this.isPulling = true
        this.executeFrame(currentTime).finally(() => {
          this.isPulling = false
        })
      }
    }

    this.rafId = requestAnimationFrame(this.loop)
  }

  get isRunning(): boolean {
    return this.rafId !== null
  }

  // Add a node to the graph
  addNode(node: Operator<IOperator>): void {
    this.nodes.set(node.id, node)
    this.isDirty = true
  }

  // Remove a node and all its connections
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId)
    this.edges = this.edges.filter(
      edge => edge.source !== nodeId && edge.target !== nodeId
    )
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
    this.edges = this.edges.filter(
      edge => !(edge.source === sourceId && edge.target === targetId)
    )
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
      console.warn('Cycles detected in graph:', cycles)
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

  // Execute a single frame
  async executeFrame(time: number): Promise<Map<string, ComputeResult>> {
    const frameStart = performance.now()
    const results = new Map<string, ComputeResult>()

    this.updateSort()

    // Reset frame metrics
    if (this.options.enableProfiling) {
      this.metrics.executionCount = 0
      this.metrics.dirtyCount = this.dirtyNodes.size
    }

    // Create execution state
    const state: ComputeState = {
      time,
      frame: this.executionCount++,
      context: new Map(),
    }

    // Execute based on parallel option
    if (this.options.parallel) {
      // Execute by levels
      for (const level of this.executionLevels) {
        const levelNodes = level
          .filter(id => this.dirtyNodes.has(id))
          .map(id => this.nodes.get(id))
          .filter((node): node is Operator<IOperator> => node !== undefined)

        if (levelNodes.length > 0) {
          const levelResults = await Promise.all(
            levelNodes.map(node => this.executeNode(node, state))
          )

          levelNodes.forEach((node, i) => {
            results.set(node.id, levelResults[i])
            if (levelResults[i].changed) {
              this.markDownstreamDirty(node.id)
            }
          })
        }
      }
    } else {
      // Execute sequentially
      for (const nodeId of this.sortedOrder) {
        if (this.dirtyNodes.has(nodeId)) {
          const node = this.nodes.get(nodeId)
          if (node) {
            const result = await this.executeNode(node, state)
            results.set(nodeId, result)

            if (result.changed) {
              this.markDownstreamDirty(nodeId)
            }
          }
        }
      }
    }

    // Clear dirty flags for executed nodes
    for (const [nodeId, result] of results) {
      if (!result.error) {
        this.dirtyNodes.delete(nodeId)
        const node = this.nodes.get(nodeId)
        if (node) node.dirty = false
      }
    }

    // Update metrics
    this.metrics.frameTime = performance.now() - frameStart
    this.metrics.executionCount = results.size
    this.metrics.totalOperators = this.nodes.size

    return results
  }

  // Execute a single node
  private async executeNode(
    node: Operator<IOperator>,
    _state: ComputeState
  ): Promise<ComputeResult> {
    try {
      // Get input values
      const inputs = {}
      for (const [key, field] of Object.entries(node.inputs)) {
        inputs[key] = field.value
      }

      // Execute the operator
      const outputs = await node.execute(inputs)

      // Update output fields
      if (outputs) {
        for (const [key, value] of Object.entries(outputs)) {
          if (key in node.outputs) {
            node.outputs[key].setValue(value)
          }
        }
      }

      return {
        value: outputs,
        changed: true,
      }
    } catch (error) {
      console.error(`Error executing node ${node.id}:`, error)
      return {
        value: null,
        changed: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
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

  // Find root operators (sinks - DeckRenderer, Out, Viewer, etc.)
  findRootOperators(): Operator<IOperator>[] {
    const roots: Operator<IOperator>[] = []

    for (const [_, op] of this.nodes) {
      const opType = (op.constructor as any).displayName

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
  async execute(input: unknown, state: ComputeState): Promise<ComputeResult> {
    // Create scoped state
    const scopedState: ComputeState = {
      ...state,
      scope: this,
      context: new Map([...state.context, ...this.context]),
    }

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
  globalExecutor = new GraphExecutor(options)

  if (typeof window !== 'undefined') {
    ;(window as any).__noodlesExecutor = globalExecutor
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

// Update graph from edges
export function updateGraph(edges: Edge[]): void {
  if (!globalExecutor) {
    initializeExecutor()
  }
  globalExecutor?.buildFromEdges(edges)
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