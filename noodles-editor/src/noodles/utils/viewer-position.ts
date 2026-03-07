import type { Node as ReactFlowNode } from '@xyflow/react'

// Gap between the source node's right edge and the viewer's left edge
export const VIEWER_GAP = 50

// Default node width used when the node hasn't been measured yet
export const DEFAULT_NODE_WIDTH = 200

// Default node height used when the node hasn't been measured yet
export const DEFAULT_NODE_HEIGHT = 100

// Maximum attempts to find a non-colliding position
const MAX_PLACEMENT_ATTEMPTS = 10

// Vertical step when trying alternative positions
const VERTICAL_STEP = 120

// Get the width of a React Flow node.
// Prefers the measured width, falls back to the width property, then to a default.
// Returns DEFAULT_NODE_WIDTH for zero/unmeasured widths to prevent viewer overlap.
export function getNodeWidth(node: ReactFlowNode): number {
  const width = node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH
  return width > 0 ? width : DEFAULT_NODE_WIDTH
}

// Get the height of a React Flow node.
// Prefers the measured height, falls back to the height property, then to a default.
// Returns DEFAULT_NODE_HEIGHT for zero/unmeasured heights.
export function getNodeHeight(node: ReactFlowNode): number {
  const height = node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT
  return height > 0 ? height : DEFAULT_NODE_HEIGHT
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

// Check if two rectangles overlap.
// Returns true if the rectangles intersect, false if they are separate or just touching.
export function rectanglesOverlap(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  )
}

// Check if a proposed position for a new node would collide with any existing nodes.
// Uses absolute positions to correctly handle nodes inside containers.
export function positionCollidesWithNodes(
  position: { x: number; y: number },
  nodeWidth: number,
  nodeHeight: number,
  nodes: ReactFlowNode[],
  excludeNodeId?: string
): boolean {
  const proposedBounds = {
    x: position.x,
    y: position.y,
    width: nodeWidth,
    height: nodeHeight,
  }

  return nodes.some(node => {
    if (excludeNodeId && node.id === excludeNodeId) return false
    // Skip group nodes (containers) as viewers can be placed inside them
    if (node.type === 'group') return false

    const absolutePos = getAbsolutePosition(node, nodes)
    const nodeBounds = {
      x: absolutePos.x,
      y: absolutePos.y,
      width: getNodeWidth(node),
      height: getNodeHeight(node),
    }
    return rectanglesOverlap(proposedBounds, nodeBounds)
  })
}

// Calculate the position for a new Viewer operator based on a source node.
// Places the viewer to the right of the source node with a small gap.
// Uses absolute position to handle nodes inside containers (with parentId).
// Includes collision detection to avoid overlapping existing nodes.
export function calculateViewerPosition(
  sourceNode: ReactFlowNode,
  nodes: ReactFlowNode[]
): { x: number; y: number } {
  const nodeWidth = getNodeWidth(sourceNode)
  const absolutePosition = getAbsolutePosition(sourceNode, nodes)

  const baseX = absolutePosition.x + nodeWidth + VIEWER_GAP
  const baseY = absolutePosition.y

  // Viewer dimensions (use defaults since it's a new node)
  const viewerWidth = DEFAULT_NODE_WIDTH
  const viewerHeight = DEFAULT_NODE_HEIGHT

  // Try the initial position first
  let position = { x: baseX, y: baseY }

  // If initial position collides, try moving down incrementally
  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    if (!positionCollidesWithNodes(position, viewerWidth, viewerHeight, nodes)) {
      return position
    }
    // Move down by VERTICAL_STEP for next attempt
    position = { x: baseX, y: baseY + (attempt + 1) * VERTICAL_STEP }
  }

  // If all attempts fail, return the last tried position
  return position
}
