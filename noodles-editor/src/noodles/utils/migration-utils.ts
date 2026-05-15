// Lightweight utilities for schema migrations
// This file must have NO dependencies on store, operators, or UI components

import type { Edge as ReactFlowEdge } from '@xyflow/react'

// Generate edge ID from connection
export function edgeId(connection: Omit<ReactFlowEdge, 'id'>) {
  return `${connection.source}.${connection.sourceHandle}->${connection.target}.${connection.targetHandle}`
}

// Parse a handle ID into its components
// Handle format: namespace.fieldName (e.g., "par.data", "out.result")
export function parseHandleId(handleId: string):
  | {
      namespace: 'par' | 'out'
      fieldName: string
    }
  | undefined {
  if (!handleId) {
    return undefined
  }

  // Parse namespace.fieldName format
  if (handleId.startsWith('par.') || handleId.startsWith('out.')) {
    const [namespace, ...fieldParts] = handleId.split('.')
    const fieldName = fieldParts.join('.')

    if ((namespace === 'par' || namespace === 'out') && fieldName) {
      return {
        namespace: namespace as 'par' | 'out',
        fieldName,
      }
    }
  }

  return undefined
}
