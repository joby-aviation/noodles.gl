// R-tree spatial index for fast edge proximity queries
// Uses rbush library for efficient 2D spatial indexing

import RBush from 'rbush'
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { getNodeCenter } from './edge-geometry'

export interface EdgeBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  edge: ReactFlowEdge
}

export class EdgeSpatialIndex {
  private tree: RBush<EdgeBounds>
  private nodeMap: Map<string, ReactFlowNode>

  constructor() {
    this.tree = new RBush<EdgeBounds>()
    this.nodeMap = new Map()
  }

  // Build or rebuild the spatial index from current nodes and edges
  build(nodes: ReactFlowNode[], edges: ReactFlowEdge[]): void {
    this.tree.clear()
    this.nodeMap.clear()

    // Build node map for O(1) lookups
    for (const node of nodes) {
      this.nodeMap.set(node.id, node)
    }

    // Insert edges into R-tree with their bounding boxes
    const items: EdgeBounds[] = []

    for (const edge of edges) {
      const sourceNode = this.nodeMap.get(edge.source)
      const targetNode = this.nodeMap.get(edge.target)

      if (!sourceNode || !targetNode) continue

      const sourceCenter = getNodeCenter(sourceNode)
      const targetCenter = getNodeCenter(targetNode)

      // Create bounding box around the edge with some padding
      const minX = Math.min(sourceCenter.x, targetCenter.x)
      const minY = Math.min(sourceCenter.y, targetCenter.y)
      const maxX = Math.max(sourceCenter.x, targetCenter.x)
      const maxY = Math.max(sourceCenter.y, targetCenter.y)

      items.push({
        minX,
        minY,
        maxX,
        maxY,
        edge,
      })
    }

    // Bulk insert for better performance than individual inserts
    this.tree.load(items)
  }

  // Query edges near a position with a given radius
  queryRadius(x: number, y: number, radius: number): ReactFlowEdge[] {
    const results = this.tree.search({
      minX: x - radius,
      minY: y - radius,
      maxX: x + radius,
      maxY: y + radius,
    })

    return results.map(item => item.edge)
  }

  // Check if the index needs rebuilding (e.g., on node/edge changes)
  // Returns true if node count or edge count changed
  needsRebuild(nodes: ReactFlowNode[], edges: ReactFlowEdge[]): boolean {
    return this.nodeMap.size !== nodes.length || this.tree.all().length !== edges.length
  }

  // Get the node for an edge endpoint (from cached map)
  getNode(nodeId: string): ReactFlowNode | undefined {
    return this.nodeMap.get(nodeId)
  }
}
