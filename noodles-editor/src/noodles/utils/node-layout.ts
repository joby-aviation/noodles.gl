import type { Node as ReactFlowNode } from '@xyflow/react'
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  getAbsolutePosition,
  getNodeHeight,
  getNodeWidth,
  rectanglesOverlap,
} from './viewer-position'

// Keeps scaffolded pipelines from landing on top of the graph the user already has.
// The tools that add nodes (import, recipes, map tools) each lay their nodes out in a
// deliberate left-to-right shape, so this shifts the whole group as a rigid block
// rather than repositioning individual nodes and destroying that shape.

// Clear space left between a placed block and the nodes around it
export const LAYOUT_GAP = 40

// Each pass drops the block below one blocker, so this only bounds pathological graphs
const MAX_SHIFT_ATTEMPTS = 100

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// The minimum a placed node needs to satisfy: an id and a position to shift
export interface PlaceableNode {
  id: string
  position: { x: number; y: number }
  parentId?: string
}

function inflate(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  }
}

// Bounding box of a group of new nodes. New nodes have not been measured yet, so
// every one is assumed to be default size.
function blockBounds(nodes: PlaceableNode[], offsetY: number): Rect {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    const x = node.position.x
    const y = node.position.y + offsetY
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + DEFAULT_NODE_WIDTH)
    maxY = Math.max(maxY, y + DEFAULT_NODE_HEIGHT)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function obstacleRects(existing: ReactFlowNode[]): Rect[] {
  return existing
    .filter(node => !node.hidden)
    .map(node => {
      const { x, y } = getAbsolutePosition(node, existing)
      return { x, y, width: getNodeWidth(node), height: getNodeHeight(node) }
    })
}

// Find how far down a block of new nodes has to move to clear every existing node.
// Returns 0 when the block already fits where it was placed.
export function findClearOffset(incoming: PlaceableNode[], existing: ReactFlowNode[]): number {
  if (incoming.length === 0) return 0
  const obstacles = obstacleRects(existing)
  if (obstacles.length === 0) return 0

  let offsetY = 0
  for (let attempt = 0; attempt < MAX_SHIFT_ATTEMPTS; attempt++) {
    const bounds = inflate(blockBounds(incoming, offsetY), LAYOUT_GAP)
    // Drop below the lowest thing currently in the way, so one pass can clear a
    // whole stack of overlapping nodes instead of stepping through them one by one
    let lowestBottom = Number.NEGATIVE_INFINITY
    for (const obstacle of obstacles) {
      if (rectanglesOverlap(bounds, obstacle)) {
        lowestBottom = Math.max(lowestBottom, obstacle.y + obstacle.height)
      }
    }
    if (lowestBottom === Number.NEGATIVE_INFINITY) return offsetY
    offsetY += lowestBottom + LAYOUT_GAP - bounds.y
  }
  return offsetY
}

// Shift newly built nodes down as one block until they no longer overlap the graph.
// Nodes with a parentId are positioned relative to their container, so they move with
// it and are left alone.
export function resolveNodeOverlaps<T extends PlaceableNode>(
  incoming: T[],
  existing: ReactFlowNode[]
): T[] {
  const movable = incoming.filter(node => !node.parentId)
  if (movable.length === 0) return incoming

  const offsetY = findClearOffset(movable, existing)
  if (offsetY === 0) return incoming

  return incoming.map(node =>
    node.parentId
      ? node
      : { ...node, position: { x: node.position.x, y: node.position.y + offsetY } }
  )
}
