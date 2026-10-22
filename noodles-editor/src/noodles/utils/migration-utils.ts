// Lightweight utilities for schema migrations
// This file must have NO dependencies on store, operators, or UI components

import type { Edge as ReactFlowEdge } from '@xyflow/react'

// Generate edge ID from connection
export function edgeId(connection: Omit<ReactFlowEdge, 'id'>) {
  return `${connection.source}.${connection.sourceHandle}->${connection.target}.${connection.targetHandle}`
}
