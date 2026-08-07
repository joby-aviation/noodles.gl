import type { Node } from '@xyflow/react'
import { repairLegacyForLoopGroups } from '../utils/for-loop-group-utils'
import type { NoodlesProjectJSON } from '../utils/serialization'

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const nodes = repairLegacyForLoopGroups(project.nodes as Node[], project.edges)
  if (nodes === project.nodes) return project
  return { ...project, nodes }
}

// The repaired representation is valid in v15, and the original malformed
// parent assignments cannot be reconstructed safely.
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
