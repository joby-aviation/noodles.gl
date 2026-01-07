// GraphExecutor - Cleaner execution engine replacing PullRenderer
// Manages operator execution with topological sorting and dirty tracking

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
  parallel?: boolean // Execute independent nodes in parallel
  batchDelay?: number // Delay for batching dirty marks (ms)
  maxExecutionTime?: number // Maximum time per frame (ms)
}

// GraphExecutor - manages execution of the operator graph
export class GraphExecutor {
  private nodes: Map<string, Operator<IOperator>> = new Map()
  private edges: Array<{ source: string; target: string }> = []
  private sortedOrder: string[] = []
  private executionLevels: string[][] = []
  private isDirty: boolean = true
  private options: ExecutorOptions

  // Dirty tracking
  private dirtyNodes: Set<string> = new Set()
  private batchTimeout: number | null = null

  // Performance tracking
  private lastExecutionTime: number = 0
  private executionCount: number = 0

  constructor(options: ExecutorOptions = {}) {
    this.options = {
      parallel: options.parallel ?? true,
      batchDelay: options.batchDelay ?? 16,
      maxExecutionTime: options.maxExecutionTime ?? 50,
    }
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
    this.isDirty = true
  }

  // Remove an edge
  removeEdge(sourceId: string, targetId: string): void {
    this.edges = this.edges.filter(
      edge => !(edge.source === sourceId && edge.target === targetId)
    )
    this.isDirty = true
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

  // Execute a single frame
  async executeFrame(time: number): Promise<Map<string, ComputeResult>> {
    const frameStart = performance.now()
    const results = new Map<string, ComputeResult>()

    this.updateSort()

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
      }
    }

    this.lastExecutionTime = performance.now() - frameStart
    return results
  }

  // Execute a single node
  private async executeNode(
    node: Operator<IOperator>,
    state: ComputeState
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
      }

      if (this.batchTimeout === null) {
        this.batchTimeout = window.setTimeout(() => {
          this.batchTimeout = null
          // Trigger execution after batch delay
        }, this.options.batchDelay)
      }
    } else {
      // Mark immediately
      for (const id of nodeIds) {
        this.dirtyNodes.add(id)
        this.markDownstreamDirty(id)
      }
    }
  }

  // Mark downstream nodes as dirty
  private markDownstreamDirty(nodeId: string): void {
    for (const edge of this.edges) {
      if (edge.source === nodeId) {
        this.dirtyNodes.add(edge.target)
        this.markDownstreamDirty(edge.target) // Recursive
      }
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
      lastExecutionTime: this.lastExecutionTime,
      dirtyCount: this.dirtyNodes.size,
    }
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
      this.nodes.set(nodeId, node) // Keep same ID
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