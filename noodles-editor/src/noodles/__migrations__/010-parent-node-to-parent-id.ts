import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to convert deprecated ReactFlow v11 `parentNode` property to v12+ `parentId`
//
// ReactFlow renamed `parentNode` to `parentId` in v12. This migration:
// 1. Converts any nodes with `parentNode` to use `parentId` instead
// 2. Removes the deprecated `parentNode` property

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, ...rest } = project

  const newNodes = nodes.map(node => {
    // Check if node has the deprecated parentNode property
    const parentNode = (node as any).parentNode
    if (parentNode === undefined) {
      return node
    }

    // Remove parentNode and add parentId if not already present
    const { parentNode: _, ...nodeWithoutParentNode } = node as any

    return {
      ...nodeWithoutParentNode,
      // Use existing parentId if present, otherwise use parentNode value
      parentId: node.parentId || parentNode,
    }
  })

  return {
    ...rest,
    nodes: newNodes,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, ...rest } = project

  // Convert parentId back to parentNode for backwards compatibility
  const newNodes = nodes.map(node => {
    if (!node.parentId) {
      return node
    }

    const { parentId, ...nodeWithoutParentId } = node

    return {
      ...nodeWithoutParentId,
      parentNode: parentId,
    }
  })

  return {
    ...rest,
    nodes: newNodes,
  }
}
