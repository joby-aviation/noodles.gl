import type { Node } from '@xyflow/react'

export interface GroupBounds {
  width: number
  height: number
}

export interface CalculateGroupBoundsOptions {
  padding?: number
  minWidth?: number
  minHeight?: number
}

const DEFAULT_PADDING = 40
const DEFAULT_MIN_WIDTH = 200
const DEFAULT_MIN_HEIGHT = 100

// Calculate the bounds of a group node based on its children.
// Returns the width and height needed to contain all children with padding,
// or null if no valid children found.
//
// IMPORTANT: Requires children to have measured dimensions populated by ReactFlow.
// If called before ReactFlow has measured nodes (e.g., immediately after drag),
// this will return null. Use requestAnimationFrame to defer until measurements are ready.
export function calculateGroupBoundsFromChildren(
  groupId: string,
  allNodes: Node[],
  options?: CalculateGroupBoundsOptions
): GroupBounds | null {
  const {
    padding = DEFAULT_PADDING,
    minWidth = DEFAULT_MIN_WIDTH,
    minHeight = DEFAULT_MIN_HEIGHT,
  } = options ?? {}

  // Find all child nodes belonging to this group
  const children = allNodes.filter(node => node.parentId === groupId)

  if (children.length === 0) {
    return null
  }

  // Filter to only children with measured dimensions
  const measuredChildren = children.filter(
    child => child.measured?.width != null && child.measured?.height != null
  )

  if (measuredChildren.length === 0) {
    // No measured children yet - can't calculate bounds
    return null
  }

  // Calculate bounding box
  // Child positions are relative to the parent group
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const child of measuredChildren) {
    const x = child.position.x
    const y = child.position.y
    const width = child.measured!.width!
    const height = child.measured!.height!

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }

  // Calculate dimensions with padding.
  // Child positions are relative to parent origin (0,0).
  // If minX < 0, we need the full range (maxX - minX) to cover children left of origin.
  // If minX >= 0, we only need up to maxX since all children are right of origin.
  const contentWidth = maxX - Math.min(0, minX)
  const contentHeight = maxY - Math.min(0, minY)

  const width = Math.max(minWidth, contentWidth + padding * 2)
  const height = Math.max(minHeight, contentHeight + padding * 2)

  return { width, height }
}
