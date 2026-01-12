import type { Node as ReactFlowNode } from '@xyflow/react'

// Gap between the source node's right edge and the viewer's left edge
export const VIEWER_GAP = 50

// Default node width used when the node hasn't been measured yet
export const DEFAULT_NODE_WIDTH = 200

// Get the width of a React Flow node.
// Prefers the measured width, falls back to the width property, then to a default.
// Returns DEFAULT_NODE_WIDTH for zero/unmeasured widths to prevent viewer overlap.
export function getNodeWidth(node: ReactFlowNode): number {
  const width = node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH
  return width > 0 ? width : DEFAULT_NODE_WIDTH
}

// Calculate the absolute position of a node by summing up parent positions.
// For nodes without parentId, returns their position directly.
export function getAbsolutePosition(
  node: ReactFlowNode,
  nodes: ReactFlowNode[]
): { x: number; y: number } {
  let x = node.position.x
  let y = node.position.y
  let currentNode = node

  while (currentNode.parentId) {
    const parent = nodes.find(n => n.id === currentNode.parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    currentNode = parent
  }

  return { x, y }
}

// Calculate the position for a new Viewer operator based on a source node.
// Places the viewer to the right of the source node with a small gap.
// Uses absolute position to handle nodes inside containers (with parentId).
export function calculateViewerPosition(
  sourceNode: ReactFlowNode,
  nodes: ReactFlowNode[]
): { x: number; y: number } {
  const nodeWidth = getNodeWidth(sourceNode)
  const absolutePosition = getAbsolutePosition(sourceNode, nodes)
  return {
    x: absolutePosition.x + nodeWidth + VIEWER_GAP,
    y: absolutePosition.y,
  }
}
