import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to rename DateOp to DateTimeOp
//
// This migration:
// 1. Renames all nodes of type "DateOp" to "DateTimeOp"
//
// Note: Timeline keyframes reference operators by ID (e.g., "/date-1"), not by type,
// so no timeline updates are needed. The operator type change is transparent to the timeline.

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, ...rest } = project

  // Rename node types
  const newNodes = nodes.map(node => {
    if (node.type === 'DateOp') {
      return { ...node, type: 'DateTimeOp' }
    }
    return node
  })

  return {
    ...rest,
    nodes: newNodes,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, ...rest } = project

  // Revert node types
  const newNodes = nodes.map(node => {
    if (node.type === 'DateTimeOp') {
      return { ...node, type: 'DateOp' }
    }
    return node
  })

  return {
    ...rest,
    nodes: newNodes,
  }
}
