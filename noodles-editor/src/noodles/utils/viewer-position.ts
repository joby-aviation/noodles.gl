import type { Node as ReactFlowNode } from '@xyflow/react'

// Gap between the source node's right edge and the viewer's left edge
export const VIEWER_GAP = 50

// Default node width used when the node hasn't been measured yet
export const DEFAULT_NODE_WIDTH = 200

// Get the width of a React Flow node.
// Prefers the measured width, falls back to the width property, then to a default.
export function getNodeWidth(node: ReactFlowNode): number {
  return node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH
}

// Calculate the position for a new Viewer operator based on a source node.
// Places the viewer to the right of the source node with a small gap.
export function calculateViewerPosition(sourceNode: ReactFlowNode): { x: number; y: number } {
  const nodeWidth = getNodeWidth(sourceNode)
  return {
    x: sourceNode.position.x + nodeWidth + VIEWER_GAP,
    y: sourceNode.position.y,
  }
}
