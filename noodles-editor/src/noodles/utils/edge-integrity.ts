import type { Edge as ReactFlowEdge } from '@xyflow/react'
import { edgeId } from './migration-utils'

export function edgeConnectionKey(
  edge: Pick<ReactFlowEdge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>
): string {
  return JSON.stringify([edge.source, edge.sourceHandle, edge.target, edge.targetHandle])
}

export function assertUniqueEdges(
  edges: ReadonlyArray<ReactFlowEdge>,
  context = 'Graph'
): void {
  const connectionIndexes = new Map<string, number>()
  const idIndexes = new Map<string, number>()

  edges.forEach((edge, index) => {
    const connectionKey = edgeConnectionKey(edge)
    const duplicateConnectionIndex = connectionIndexes.get(connectionKey)
    if (duplicateConnectionIndex !== undefined) {
      throw new Error(
        `${context} is corrupted: edges at indexes ${duplicateConnectionIndex} and ${index} describe the same connection (${edge.source}.${edge.sourceHandle} -> ${edge.target}.${edge.targetHandle})`
      )
    }
    connectionIndexes.set(connectionKey, index)

    const duplicateIdIndex = idIndexes.get(edge.id)
    if (duplicateIdIndex !== undefined) {
      throw new Error(
        `${context} is corrupted: edges at indexes ${duplicateIdIndex} and ${index} share the ID "${edge.id}"`
      )
    }
    idIndexes.set(edge.id, index)
  })
}

export function insertUniqueEdge<E extends ReactFlowEdge>(
  edges: E[],
  edge: E,
  insert: (current: E[], candidate: E) => E[] = (current, candidate) => [
    ...current,
    candidate,
  ]
): E[] {
  assertUniqueEdges(edges)

  const connectionKey = edgeConnectionKey(edge)
  if (edges.some(existing => edgeConnectionKey(existing) === connectionKey)) {
    return edges
  }
  if (edges.some(existing => existing.id === edge.id)) {
    throw new Error(
      `Cannot add edge "${edge.id}": that ID already belongs to a different connection`
    )
  }

  const next = insert(edges, edge)
  assertUniqueEdges(next)
  return next
}

export function appendUniqueEdges<E extends ReactFlowEdge>(edges: E[], candidates: E[]): E[] {
  return candidates.reduce((current, edge) => insertUniqueEdge(current, edge), edges)
}

// Repair historical corruption while preserving the first occurrence of each logical
// connection. Non-conflicting stored IDs are intentionally left untouched.
export function repairDuplicateEdges<E extends ReactFlowEdge>(edges: E[]): E[] {
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
