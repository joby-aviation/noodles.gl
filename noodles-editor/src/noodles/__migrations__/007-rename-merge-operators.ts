import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to rename MergeOp to ConcatOp and ObjectMergeOp to MergeOp
//
// This migration:
// 1. Renames all nodes of type "MergeOp" to "ConcatOp"
// 2. Renames all nodes of type "ObjectMergeOp" to "MergeOp"
//
// Note: Timeline keyframes reference operators by ID (e.g., "/merge-1"), not by type,
// so no timeline updates are needed. The operator type change is transparent to the timeline.

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, ...rest } = project

  // Rename node types
  const newNodes = nodes.map(node => {
    if (node.type === 'MergeOp') {
      return { ...node, type: 'ConcatOp' }
    }
    if (node.type === 'ObjectMergeOp') {
      return { ...node, type: 'MergeOp' }
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
    if (node.type === 'ConcatOp') {
      return { ...node, type: 'MergeOp' }
    }
    if (node.type === 'MergeOp') {
      return { ...node, type: 'ObjectMergeOp' }
    }
    return node
  })

  return {
    ...rest,
    nodes: newNodes,
  }
}
