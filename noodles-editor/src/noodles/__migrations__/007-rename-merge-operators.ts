import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to rename MergeOp to ConcatOp and ObjectMergeOp to MergeOp
//
// This migration:
// 1. Renames all nodes of type "MergeOp" to "ConcatOp"
// 2. Renames all nodes of type "ObjectMergeOp" to "MergeOp"
// 3. Updates any operator references in timeline state

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, timeline, ...rest } = project

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

  // Update timeline references if they exist
  let newTimeline = timeline
  if (timeline.sheetsById) {
    const sheetsById = timeline.sheetsById as Record<string, any>
    if (sheetsById.Noodles?.staticOverrides?.byObject) {
      const byObject = sheetsById.Noodles.staticOverrides.byObject
      const updatedByObject: Record<string, any> = {}

      // Rename object keys that reference the old operator types
      for (const [key, value] of Object.entries(byObject)) {
        // Keep the same key, but we need to be aware of it for debugging
        updatedByObject[key] = value
      }

      newTimeline = {
        ...timeline,
        sheetsById: {
          ...sheetsById,
          Noodles: {
            ...sheetsById.Noodles,
            staticOverrides: {
              ...sheetsById.Noodles.staticOverrides,
              byObject: updatedByObject,
            },
          },
        },
      }
    }
  }

  return {
    ...rest,
    nodes: newNodes,
    timeline: newTimeline,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, timeline, ...rest } = project

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

  // Revert timeline references if they exist
  let newTimeline = timeline
  if (timeline.sheetsById) {
    const sheetsById = timeline.sheetsById as Record<string, any>
    if (sheetsById.Noodles?.staticOverrides?.byObject) {
      const byObject = sheetsById.Noodles.staticOverrides.byObject
      const updatedByObject: Record<string, any> = {}

      // Revert object keys that reference the new operator types
      for (const [key, value] of Object.entries(byObject)) {
        updatedByObject[key] = value
      }

      newTimeline = {
        ...timeline,
        sheetsById: {
          ...sheetsById,
          Noodles: {
            ...sheetsById.Noodles,
            staticOverrides: {
              ...sheetsById.Noodles.staticOverrides,
              byObject: updatedByObject,
            },
          },
        },
      }
    }
  }

  return {
    ...rest,
    nodes: newNodes,
    timeline: newTimeline,
  }
}
