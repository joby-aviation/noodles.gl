import { renameHandle } from '../utils/migrate-schema'
import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to rename BoundsOp fields for clarity and consistency with BboxField
//
// This improves clarity by using directional names that match BboxField:
// - point1 -> southwest
// - point2 -> northeast

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  let migrated = project

  // Check if there are any BoundsOp nodes
  const hasBoundsOps = project.nodes.some(node => node.type === 'BoundsOp')
  if (!hasBoundsOps) {
    return project
  }

  // Check if there are edges using the old handles
  const hasPoint1Edges = project.edges.some(
    edge =>
      edge.targetHandle === 'par.point1' &&
      project.nodes.find(n => n.id === edge.target)?.type === 'BoundsOp'
  )
  const hasPoint2Edges = project.edges.some(
    edge =>
      edge.targetHandle === 'par.point2' &&
      project.nodes.find(n => n.id === edge.target)?.type === 'BoundsOp'
  )

  // Rename BoundsOp.point1 -> southwest
  if (hasPoint1Edges) {
    migrated = renameHandle({
      type: 'BoundsOp',
      inOut: 'par',
      oldHandle: 'par.point1',
      newHandle: 'par.southwest',
      project: migrated,
    })
  }

  // Rename BoundsOp.point2 -> northeast
  if (hasPoint2Edges) {
    migrated = renameHandle({
      type: 'BoundsOp',
      inOut: 'par',
      oldHandle: 'par.point2',
      newHandle: 'par.northeast',
      project: migrated,
    })
  }

  return migrated
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  let migrated = project

  // Check if there are any BoundsOp nodes
  const hasBoundsOps = project.nodes.some(node => node.type === 'BoundsOp')
  if (!hasBoundsOps) {
    return project
  }

  // Check if there are edges using the new handles
  const hasSouthwestEdges = project.edges.some(
    edge =>
      edge.targetHandle === 'par.southwest' &&
      project.nodes.find(n => n.id === edge.target)?.type === 'BoundsOp'
  )
  const hasNortheastEdges = project.edges.some(
    edge =>
      edge.targetHandle === 'par.northeast' &&
      project.nodes.find(n => n.id === edge.target)?.type === 'BoundsOp'
  )

  // Revert BoundsOp.southwest -> point1
  if (hasSouthwestEdges) {
    migrated = renameHandle({
      type: 'BoundsOp',
      inOut: 'par',
      oldHandle: 'par.southwest',
      newHandle: 'par.point1',
      project: migrated,
    })
  }

  // Revert BoundsOp.northeast -> point2
  if (hasNortheastEdges) {
    migrated = renameHandle({
      type: 'BoundsOp',
      inOut: 'par',
      oldHandle: 'par.northeast',
      newHandle: 'par.point2',
      project: migrated,
    })
  }

  return migrated
}
