// Dependency graph for pull-based execution model
// Manages operator dependencies and topological sorting

import type { OpId } from './utils/id-utils'
import { getAllOps, getOp } from './store'

export interface Edge {
  id: string
  source: OpId
  target: OpId
  sourceHandle: string
  targetHandle: string
}

// DependencyGraph manages the directed acyclic graph of operator dependencies
// and provides topological sorting for execution order
export class DependencyGraph {
  private upstream: Map<OpId, Set<OpId>> = new Map()
  private downstream: Map<OpId, Set<OpId>> = new Map()
  private sortedOrder: OpId[] = []
  private sortDirty: boolean = true

  constructor() {
    this.upstream = new Map()
    this.downstream = new Map()
    this.sortedOrder = []
    this.sortDirty = true
  }

  // Add an edge (connection) between two operators
  addEdge(sourceId: OpId, targetId: OpId): void {
    // Add to downstream map
    if (!this.downstream.has(sourceId)) {
      this.downstream.set(sourceId, new Set())
    }
    this.downstream.get(sourceId)!.add(targetId)

    // Add to upstream map
    if (!this.upstream.has(targetId)) {
      this.upstream.set(targetId, new Set())
    }
    this.upstream.get(targetId)!.add(sourceId)

    this.sortDirty = true
  }

  // Remove an edge between two operators
  removeEdge(sourceId: OpId, targetId: OpId): void {
    this.downstream.get(sourceId)?.delete(targetId)
    this.upstream.get(targetId)?.delete(sourceId)
    this.sortDirty = true
  }

  // Get all upstream dependencies for an operator
  getUpstream(opId: OpId): Set<OpId> {
    return this.upstream.get(opId) || new Set()
  }

  // Get all downstream dependents for an operator
  getDownstream(opId: OpId): Set<OpId> {
    return this.downstream.get(opId) || new Set()
  }

  // Clear all edges
  clear(): void {
    this.upstream.clear()
    this.downstream.clear()
    this.sortedOrder = []
    this.sortDirty = true
  }

  // Topological sort with cycle detection using depth-first search
  getTopologicalOrder(): OpId[] {
    if (!this.sortDirty) {
      return this.sortedOrder
    }

    const sorted: OpId[] = []
    const visiting = new Set<OpId>()
    const visited = new Set<OpId>()

    const visit = (nodeId: OpId): void => {
      if (visited.has(nodeId)) {
        return
      }
      if (visiting.has(nodeId)) {
        throw new Error(`Cycle detected in dependency graph involving operator: ${nodeId}`)
      }

      visiting.add(nodeId)

      // Visit all upstream dependencies first
      const upstreamDeps = this.upstream.get(nodeId) || []
      for (const depId of upstreamDeps) {
        visit(depId)
      }

      visiting.delete(nodeId)
      visited.add(nodeId)
      sorted.push(nodeId)
    }

    // Get all nodes in the graph
    const allNodes = new Set<OpId>()
    for (const node of this.upstream.keys()) {
      allNodes.add(node)
    }
    for (const node of this.downstream.keys()) {
      allNodes.add(node)
    }

    // Visit all nodes
    for (const nodeId of allNodes) {
      if (!visited.has(nodeId)) {
        visit(nodeId)
      }
    }

    this.sortedOrder = sorted
    this.sortDirty = false
    return sorted
  }

  // Get operators that can be executed in parallel (no dependencies between them)
  getParallelExecutionLevels(): OpId[][] {
    const sorted = this.getTopologicalOrder()
    const levels: OpId[][] = []
    const executed = new Set<OpId>()

    while (executed.size < sorted.length) {
      const currentLevel: OpId[] = []

      for (const opId of sorted) {
        if (executed.has(opId)) {
          continue
        }

        // Check if all dependencies have been executed
        const deps = this.getUpstream(opId)
        const allDepsExecuted = Array.from(deps).every(id => executed.has(id))

        if (allDepsExecuted) {
          currentLevel.push(opId)
        }
      }

      if (currentLevel.length === 0 && executed.size < sorted.length) {
        throw new Error('Unable to determine execution order - possible circular dependency')
      }

      for (const opId of currentLevel) {
        executed.add(opId)
      }

      if (currentLevel.length > 0) {
        levels.push(currentLevel)
      }
    }

    return levels
  }

  // Update operator dependency sets based on the graph
  updateOperatorDependencies(): void {
    const ops = getAllOps()

    for (const op of ops) {
      // Clear existing dependencies
      op.removeUpstreamDependency && op['_upstreamDependencies']?.clear()
      op.removeDownstreamDependent && op['_downstreamDependents']?.clear()

      // Add upstream dependencies
      const upstreamIds = this.getUpstream(op.id)
      for (const upstreamId of upstreamIds) {
        const upstreamOp = getOp(upstreamId)
        if (upstreamOp) {
          op.addUpstreamDependency(upstreamOp)
        }
      }

      // Add downstream dependents
      const downstreamIds = this.getDownstream(op.id)
      for (const downstreamId of downstreamIds) {
        const downstreamOp = getOp(downstreamId)
        if (downstreamOp) {
          op.addDownstreamDependent(downstreamOp)
        }
      }
    }
  }

  // Build dependency graph from edges
  buildFromEdges(edges: Edge[]): void {
    this.clear()

    for (const edge of edges) {
      this.addEdge(edge.source, edge.target)
    }

    this.updateOperatorDependencies()
  }

  // Get all root operators (no upstream dependencies)
  getRootOperators(): OpId[] {
    const roots: OpId[] = []
    const allNodes = new Set<OpId>()

    // Collect all nodes
    for (const node of this.upstream.keys()) {
      allNodes.add(node)
    }
    for (const node of this.downstream.keys()) {
      allNodes.add(node)
    }

    // Find nodes with no upstream dependencies
    for (const nodeId of allNodes) {
      const upstream = this.getUpstream(nodeId)
      if (upstream.size === 0) {
        roots.push(nodeId)
      }
    }

    return roots
  }

  // Get all leaf operators (no downstream dependents)
  getLeafOperators(): OpId[] {
    const leaves: OpId[] = []
    const allNodes = new Set<OpId>()

    // Collect all nodes
    for (const node of this.upstream.keys()) {
      allNodes.add(node)
    }
    for (const node of this.downstream.keys()) {
      allNodes.add(node)
    }

    // Find nodes with no downstream dependents
    for (const nodeId of allNodes) {
      const downstream = this.getDownstream(nodeId)
      if (downstream.size === 0) {
        leaves.push(nodeId)
      }
    }

    return leaves
  }

  // Check if adding an edge would create a cycle
  wouldCreateCycle(sourceId: OpId, targetId: OpId): boolean {
    // Temporarily add the edge
    this.addEdge(sourceId, targetId)

    try {
      // Try to get topological order - will throw if cycle exists
      this.getTopologicalOrder()
      return false
    } catch {
      return true
    } finally {
      // Remove the temporary edge
      this.removeEdge(sourceId, targetId)
    }
  }

  // Get statistics about the graph
  getStatistics(): {
    nodeCount: number
    edgeCount: number
    rootCount: number
    leafCount: number
    maxDepth: number
  } {
    const allNodes = new Set<OpId>()
    let edgeCount = 0

    for (const [_, targets] of this.downstream) {
      edgeCount += targets.size
    }

    for (const node of this.upstream.keys()) {
      allNodes.add(node)
    }
    for (const node of this.downstream.keys()) {
      allNodes.add(node)
    }

    const roots = this.getRootOperators()
    const leaves = this.getLeafOperators()

    // Calculate max depth
    let maxDepth = 0
    const depths = new Map<OpId, number>()

    const calculateDepth = (nodeId: OpId, currentDepth: number = 0): number => {
      if (depths.has(nodeId)) {
        return depths.get(nodeId)!
      }

      const upstream = this.getUpstream(nodeId)
      if (upstream.size === 0) {
        depths.set(nodeId, 0)
        return 0
      }

      let maxUpstreamDepth = 0
      for (const upId of upstream) {
        const upDepth = calculateDepth(upId, currentDepth + 1)
        maxUpstreamDepth = Math.max(maxUpstreamDepth, upDepth)
      }

      const depth = maxUpstreamDepth + 1
      depths.set(nodeId, depth)
      maxDepth = Math.max(maxDepth, depth)
      return depth
    }

    for (const nodeId of allNodes) {
      calculateDepth(nodeId)
    }

    return {
      nodeCount: allNodes.size,
      edgeCount,
      rootCount: roots.length,
      leafCount: leaves.length,
      maxDepth,
    }
  }
}