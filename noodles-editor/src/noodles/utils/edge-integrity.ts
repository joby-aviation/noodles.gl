import type { Edge as ReactFlowEdge } from '@xyflow/react'

function edgeConnectionKey(
  edge: Pick<ReactFlowEdge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>
): string {
  return JSON.stringify([edge.source, edge.sourceHandle, edge.target, edge.targetHandle])
}

export function insertUniqueEdge<E extends ReactFlowEdge>(
  edges: E[],
  edge: E,
  insert: (current: E[], candidate: E) => E[] = (current, candidate) => [
    ...current,
    candidate,
  ]
): E[] {
  const connectionKey = edgeConnectionKey(edge)
  if (edges.some(existing => edgeConnectionKey(existing) === connectionKey)) {
    return edges
  }
  if (edges.some(existing => existing.id === edge.id)) {
    throw new Error(
      `Cannot add edge "${edge.id}": that ID already belongs to a different connection`
    )
  }

  return insert(edges, edge)
}

export function appendUniqueEdges<E extends ReactFlowEdge>(edges: E[], candidates: E[]): E[] {
  return candidates.reduce((current, edge) => insertUniqueEdge(current, edge), edges)
}
