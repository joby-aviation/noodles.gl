import { renameHandle } from '../utils/migrate-schema'
import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to rename 'd' field to 'item' for ForLoop operators
//
// This improves clarity by using a more descriptive name:
// - ForLoopBeginOp: outputs.d -> outputs.item (the current iteration item)
// - ForLoopEndOp: inputs.d -> inputs.item (the result to collect)

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  let migrated = project

  // Check if there are any ForLoopBeginOp nodes before attempting migration
  const hasBeginOps = project.nodes.some(node => node.type === 'ForLoopBeginOp')
  const hasEndOps = project.nodes.some(node => node.type === 'ForLoopEndOp')

  // Check if there are edges using the old 'd' handles
  const hasOldBeginEdges = project.edges.some(
    edge =>
      edge.sourceHandle === 'out.d' &&
      project.nodes.find(n => n.id === edge.source)?.type === 'ForLoopBeginOp'
  )
  const hasOldEndEdges = project.edges.some(
    edge =>
      edge.targetHandle === 'par.d' &&
      project.nodes.find(n => n.id === edge.target)?.type === 'ForLoopEndOp'
  )

  // Rename ForLoopBeginOp output: d -> item
  if (hasBeginOps && hasOldBeginEdges) {
    migrated = renameHandle({
      type: 'ForLoopBeginOp',
      inOut: 'out',
      oldHandle: 'out.d',
      newHandle: 'out.item',
      project: migrated,
    })
  }

  // Rename ForLoopEndOp input: d -> item
  if (hasEndOps && hasOldEndEdges) {
    migrated = renameHandle({
      type: 'ForLoopEndOp',
      inOut: 'par',
      oldHandle: 'par.d',
      newHandle: 'par.item',
      project: migrated,
    })
  }

  return migrated
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  let migrated = project

  // Check if there are any ForLoop nodes with the new 'item' handles
  const hasBeginOps = project.nodes.some(node => node.type === 'ForLoopBeginOp')
  const hasEndOps = project.nodes.some(node => node.type === 'ForLoopEndOp')

  const hasNewBeginEdges = project.edges.some(
    edge =>
      edge.sourceHandle === 'out.item' &&
      project.nodes.find(n => n.id === edge.source)?.type === 'ForLoopBeginOp'
  )
  const hasNewEndEdges = project.edges.some(
    edge =>
      edge.targetHandle === 'par.item' &&
      project.nodes.find(n => n.id === edge.target)?.type === 'ForLoopEndOp'
  )

  // Rename back: ForLoopBeginOp output item -> d
  if (hasBeginOps && hasNewBeginEdges) {
    migrated = renameHandle({
      type: 'ForLoopBeginOp',
      inOut: 'out',
      oldHandle: 'out.item',
      newHandle: 'out.d',
      project: migrated,
    })
  }

  // Rename back: ForLoopEndOp input item -> d
  if (hasEndOps && hasNewEndEdges) {
    migrated = renameHandle({
      type: 'ForLoopEndOp',
      inOut: 'par',
      oldHandle: 'par.item',
      newHandle: 'par.d',
      project: migrated,
    })
  }

  return migrated
}
