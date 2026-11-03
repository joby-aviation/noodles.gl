import type { Edge as ReactFlowEdge } from '@xyflow/react'
import { edgeId } from '../utils/migration-utils'
import type { NoodlesProjectJSON } from '../utils/serialization'

function edgeConnectionKey(
  edge: Pick<ReactFlowEdge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>
): string {
  return JSON.stringify([edge.source, edge.sourceHandle, edge.target, edge.targetHandle])
}

// Repair historical corruption while preserving the first occurrence of each logical
// connection. Non-conflicting stored IDs are intentionally left untouched.
function repairDuplicateEdges<E extends ReactFlowEdge>(edges: E[]): E[] {
  const seenConnections = new Set<string>()
  let changed = false
  const uniqueConnections = edges.filter(edge => {
    const key = edgeConnectionKey(edge)
    if (seenConnections.has(key)) {
      changed = true
      return false
    }
    seenConnections.add(key)
    return true
  })

  const idCounts = new Map<string, number>()
  for (const edge of uniqueConnections) {
    idCounts.set(edge.id, (idCounts.get(edge.id) ?? 0) + 1)
  }

  // Reserve every non-conflicting legacy ID before repairing collisions so a generated ID
  // can never force an otherwise valid legacy edge to be renamed.
  const usedIds = new Set(
    uniqueConnections.filter(edge => idCounts.get(edge.id) === 1).map(edge => edge.id)
  )

  const repaired = uniqueConnections.map(edge => {
    if (idCounts.get(edge.id) === 1) return edge

    const canonicalId = edgeId(edge)
    let repairedId = canonicalId
    let suffix = 2
    while (usedIds.has(repairedId)) {
      repairedId = `${canonicalId}#${suffix}`
      suffix += 1
    }
    usedIds.add(repairedId)
    changed = true
    return { ...edge, id: repairedId }
  })

  return changed ? repaired : edges
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const edges = repairDuplicateEdges(project.edges)
  return edges === project.edges ? project : { ...project, edges }
}

// Duplicate records removed by this repair cannot be reconstructed.
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
