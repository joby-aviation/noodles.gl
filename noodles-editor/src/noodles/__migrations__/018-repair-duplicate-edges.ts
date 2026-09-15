import { repairDuplicateEdges } from '../utils/edge-integrity'
import type { NoodlesProjectJSON } from '../utils/serialization'

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const edges = repairDuplicateEdges(project.edges)
  return edges === project.edges ? project : { ...project, edges }
}

// Duplicate records removed by this repair cannot be reconstructed.
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
