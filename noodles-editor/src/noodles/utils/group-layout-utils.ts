import type { Node } from '@xyflow/react'

const GROUP_PADDING = 40
const MIN_GROUP_WIDTH = 200
const MIN_GROUP_HEIGHT = 100

type Position = { x: number; y: number }

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nodeSize(node: Node): { width: number; height: number } | undefined {
  const width =
    finiteNumber(node.measured?.width) ??
    finiteNumber(node.width) ??
    finiteNumber(node.style?.width)
  const height =
    finiteNumber(node.measured?.height) ??
    finiteNumber(node.height) ??
    finiteNumber(node.style?.height)
  return width !== undefined && height !== undefined ? { width, height } : undefined
}

function styledSize(node: Node): { width: number; height: number } | undefined {
  const width = finiteNumber(node.style?.width)
  const height = finiteNumber(node.style?.height)
  return width !== undefined && height !== undefined ? { width, height } : undefined
}

function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * Applies parent assignments and fits groups around their direct children. Absolute
 * canvas positions are preserved while parent-relative coordinates are recalculated.
 */
export function layoutGroups<TNode extends Node>(
  nodes: TNode[],
  groupIds: Set<string>,
  desiredParent: Map<string, string | undefined>
): TNode[] {
  if (groupIds.size === 0) return nodes

  const nodesById = new Map(nodes.map(node => [node.id, node]))
  const originalAbsolute = new Map<string, Position>()
  const getOriginalAbsolute = (nodeId: string, visiting = new Set<string>()): Position => {
    const cached = originalAbsolute.get(nodeId)
    if (cached) return cached
    const node = nodesById.get(nodeId)
    if (!node || visiting.has(nodeId)) return { x: 0, y: 0 }
    visiting.add(nodeId)
    const parent = node.parentId ? getOriginalAbsolute(node.parentId, visiting) : { x: 0, y: 0 }
    const absolute = { x: parent.x + node.position.x, y: parent.y + node.position.y }
    originalAbsolute.set(nodeId, absolute)
    return absolute
  }
  for (const node of nodes) getOriginalAbsolute(node.id)

  const nextAbsolute = new Map(originalAbsolute)
  const nextGroupSize = new Map<string, { width: number; height: number }>()
  const laidOutGroups = new Set<string>()

  const layoutGroup = (groupId: string, visiting = new Set<string>()) => {
    if (laidOutGroups.has(groupId) || visiting.has(groupId)) return
    visiting.add(groupId)

    const children = nodes.filter(node => desiredParent.get(node.id) === groupId)
    for (const child of children) {
      if (groupIds.has(child.id)) layoutGroup(child.id, visiting)
    }

    const childRects = children.map(child => {
      const position = nextAbsolute.get(child.id)!
      const size = nextGroupSize.get(child.id) ?? nodeSize(child)
      return size ? { position, size } : undefined
    })

    // Wait until React Flow has measured every direct child before shrinking. This
    // prevents a newly created, unmeasured node from being clipped out of the group.
    if (childRects.length > 0 && childRects.every(rect => rect !== undefined)) {
      const rects = childRects as Array<{
        position: Position
        size: { width: number; height: number }
      }>
      const minX = Math.min(...rects.map(rect => rect.position.x))
      const minY = Math.min(...rects.map(rect => rect.position.y))
      const maxX = Math.max(...rects.map(rect => rect.position.x + rect.size.width))
      const maxY = Math.max(...rects.map(rect => rect.position.y + rect.size.height))
      nextAbsolute.set(groupId, { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING })
      nextGroupSize.set(groupId, {
        width: Math.max(MIN_GROUP_WIDTH, maxX - minX + GROUP_PADDING * 2),
        height: Math.max(MIN_GROUP_HEIGHT, maxY - minY + GROUP_PADDING * 2),
      })
    } else {
      const group = nodesById.get(groupId)!
      // Group style is the canonical persisted size. React Flow's width and
      // measured fields are runtime caches and can still contain the old bounds.
      const size = styledSize(group) ?? nodeSize(group)
      if (size) nextGroupSize.set(groupId, size)
    }

    laidOutGroups.add(groupId)
    visiting.delete(groupId)
  }

  for (const groupId of groupIds) layoutGroup(groupId)

  const nextNodes = nodes.map(node => {
    const parentId = desiredParent.get(node.id)
    const absolute = nextAbsolute.get(node.id)!
    const parentAbsolute = parentId ? nextAbsolute.get(parentId) : undefined
    const position = parentAbsolute
      ? { x: absolute.x - parentAbsolute.x, y: absolute.y - parentAbsolute.y }
      : absolute
    const groupSize = nextGroupSize.get(node.id)
    const wasInGroup = groupIds.has(node.parentId ?? '')
    const nextExpandParent =
      parentId && groupIds.has(parentId) ? true : wasInGroup ? undefined : node.expandParent
    const parentChanged = node.parentId !== parentId
    const positionChanged = !samePosition(node.position, position)
    const expandParentChanged = node.expandParent !== nextExpandParent
    const sizeChanged =
      groupSize !== undefined &&
      (finiteNumber(node.style?.width) !== groupSize.width ||
        finiteNumber(node.style?.height) !== groupSize.height ||
        finiteNumber(node.width) !== groupSize.width ||
        finiteNumber(node.height) !== groupSize.height ||
        finiteNumber(node.measured?.width) !== groupSize.width ||
        finiteNumber(node.measured?.height) !== groupSize.height)

    if (!parentChanged && !positionChanged && !expandParentChanged && !sizeChanged) return node

    return {
      ...node,
      parentId,
      expandParent: nextExpandParent,
      position,
      ...(groupSize
        ? {
            width: groupSize.width,
            height: groupSize.height,
            measured: { ...node.measured, ...groupSize },
            style: { ...node.style, width: groupSize.width, height: groupSize.height },
          }
        : {}),
    } as TNode
  })

  // React Flow requires parents to occur before their children in the node array.
  // This matters when an older node is later assigned to a newly created group.
  const nextNodesById = new Map(nextNodes.map(node => [node.id, node]))
  const orderedNodes: TNode[] = []
  const appended = new Set<string>()
  const appendWithParent = (node: TNode, visiting = new Set<string>()) => {
    if (appended.has(node.id) || visiting.has(node.id)) return
    visiting.add(node.id)
    const parentId = desiredParent.get(node.id)
    const parent = parentId ? nextNodesById.get(parentId) : undefined
    if (parent) appendWithParent(parent, visiting)
    orderedNodes.push(node)
    appended.add(node.id)
  }
  for (const node of nextNodes) appendWithParent(node)

  return orderedNodes.every((node, index) => node === nodes[index]) ? nodes : orderedNodes
}
