import type { Edge as ReactFlowEdge } from '@xyflow/react'

export type OpId = string

// An operator-graph edge's id, as schema 1–18 projects name their edges
export function edgeId(connection: Omit<ReactFlowEdge, 'id'>) {
  return `${connection.source}.${connection.sourceHandle}->${connection.target}.${connection.targetHandle}`
}
