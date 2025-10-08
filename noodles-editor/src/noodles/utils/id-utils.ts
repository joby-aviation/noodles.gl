import type { Edge as ReactFlowEdge } from '@xyflow/react'

import { opMap } from '../store'
import { generateQualifiedPath, getBaseName } from './path-utils'

export type OpId = string

// Generate a unique node ID within a container context
export function nodeId(baseName: string, containerId = '/'): OpId {
  const baseQualifiedPath = generateQualifiedPath(baseName, containerId)

  if (!opMap.has(baseQualifiedPath)) {
    return baseQualifiedPath
  }

  // If it exists, find a unique variant by appending a number
  const containerPrefix = containerId.startsWith('/') ? containerId : `/${containerId}`
  const pathPrefix = containerPrefix === '/' ? '/' : `${containerPrefix}/`

  // Find existing operators in the same container with the same base name
  const existing = Array.from(opMap.keys()).filter(key => {
    if (!key.startsWith(pathPrefix)) return false
    const keyBaseName = getBaseName(key)
    return keyBaseName === baseName || keyBaseName.startsWith(`${baseName}-`)
  })

  // Find the next available number
  let i = 1
  for (; i < 100_000; i++) {
    const candidatePath = generateQualifiedPath(`${baseName}-${i}`, containerId)
    if (!existing.includes(candidatePath)) {
      return candidatePath
    }
  }

  // Fallback (should rarely happen)
  return generateQualifiedPath(`${baseName}-${i}`, containerId)
}

export function edgeId(connection: Omit<ReactFlowEdge, 'id'>) {
  return `${connection.source}.${connection.sourceHandle}->${connection.target}.${connection.targetHandle}`
}
