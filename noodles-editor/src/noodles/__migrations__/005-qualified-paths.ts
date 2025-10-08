import type { Edge, Node } from '@xyflow/react'
import { getFieldReferences } from '../fields'
import { edgeId } from '../utils/id-utils'
import { isAbsolutePath } from '../utils/path-utils'
import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to convert simple operator IDs to fully qualified paths
//
// This migration:
// 1. Detects old-format projects with simple IDs (not starting with '/')
// 2. Converts simple IDs to qualified paths by adding '/' prefix for root level
// 3. Updates all edge references to use qualified paths
// 4. Updates handle IDs in edges to use qualified format

// Convert simple ID to qualified path
// For now, all operators are treated as root-level since we don't have
// container hierarchy information in the old format
function convertToQualifiedPath(simpleId: string): string {
  // If already qualified, return as-is
  if (isAbsolutePath(simpleId)) {
    return simpleId
  }

  // Convert simple ID to root-level qualified path
  return `/${simpleId}`
}

// Convert old handle format to short handle format
// Old format: "fieldName"
// New format: "namespace.fieldName"
function convertHandleId(
  edge: Edge,
  nodes: Node[],
  sourceOrTarget: 'source' | 'target',
  operatorId: string
): string | null {
  // Special handling for ReferenceEdge source handles
  if (edge.type === 'ReferenceEdge' && sourceOrTarget === 'source') {
    const node = nodes.find(node => node.id === convertToQualifiedPath(edge.target))!
    const codeOrQuery = node.data.inputs.code || node.data.inputs.query
    if (!codeOrQuery) {
      throw new Error(`No code or query field found for ReferenceEdge: ${JSON.stringify(edge)}`)
    }
    const joined = codeOrQuery.join('\n')
    const references = getFieldReferences(joined, operatorId)
    const reference = references.find(
      ref => ref.fieldPath === edge.sourceHandle && ref.opId === convertToQualifiedPath(edge.source)
    )
    if (!reference) {
      throw new Error(`Reference not found: ${JSON.stringify(edge)}`)
    }
    return reference.handleId
  }

  // For all other cases (including ReferenceEdge target), use standard handle conversion
  const oldHandleId = edge[sourceOrTarget === 'source' ? 'sourceHandle' : 'targetHandle']

  if (!oldHandleId) {
    return null
  }

  if (sourceOrTarget === 'source') {
    return `out.${oldHandleId}`
  }

  if (sourceOrTarget === 'target') {
    return `par.${oldHandleId}`
  }

  throw new Error(`Invalid sourceOrTarget: ${sourceOrTarget}`)
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, edges, ...rest } = project

  // Create mapping from old IDs to new qualified paths
  const idMapping = new Map<string, string>()

  // First pass: create ID mapping
  for (const node of nodes) {
    if (node.id) {
      const qualifiedPath = convertToQualifiedPath(node.id)
      idMapping.set(node.id, qualifiedPath)
    }
  }

  // Second pass: update nodes with qualified paths
  const newNodes = nodes.map(node => {
    if (!node.id) {
      return node
    }

    const qualifiedPath = idMapping.get(node.id)
    if (!qualifiedPath) {
      return node
    }

    let parentId = node.parentId
    if (parentId) {
      parentId = idMapping.get(parentId) || parentId
    }

    delete node.containerId

    return {
      ...node,
      id: qualifiedPath,
      ...(parentId ? { parentId } : {}),
    }
  })

  // Third pass: update edges with qualified paths and handle IDs
  const newEdges = edges
    .map(edge => {
      const newSource = idMapping.get(edge.source)
      const newTarget = idMapping.get(edge.target)

      // Skip orphaned edges that reference non-existent nodes
      if (!newSource || !newTarget) {
        console.warn(`Skipping orphaned edge: ${edge.id} (${edge.source} -> ${edge.target})`)
        return null
      }

      // Convert handle IDs to qualified format
      const newSourceHandle = convertHandleId(edge, newNodes, 'source', newTarget)
      const newTargetHandle = convertHandleId(edge, newNodes, 'target', newTarget)

      const connection = {
        ...edge,
        source: newSource,
        target: newTarget,
        sourceHandle: newSourceHandle,
        targetHandle: newTargetHandle,
      }

      // ReferenceEdges can have null targetHandle, but other edges cannot have null handles
      if (edge.type !== 'ReferenceEdge' && (newSourceHandle === null || newTargetHandle === null)) {
        throw new Error(`Invalid connection: ${JSON.stringify(connection)}`)
      }

      return {
        ...connection,
        id: edgeId(connection),
      }
    })
    .filter((edge): edge is NonNullable<typeof edge> => edge !== null)

  return {
    ...rest,
    nodes: newNodes,
    edges: newEdges,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, edges, ...rest } = project

  // Create mapping from qualified paths back to simple IDs
  const idMapping = new Map<string, string>()

  // First pass: create reverse ID mapping
  for (const node of nodes) {
    if (node.id && isAbsolutePath(node.id)) {
      // Extract simple ID by removing the leading '/' and any path separators
      // For now, we assume all operators were at root level in old format
      const simpleId = node.id.substring(1) // Remove leading '/'

      // If the path has multiple segments, take the last one
      const segments = simpleId.split('/')
      const lastSegment = segments[segments.length - 1]

      idMapping.set(node.id, lastSegment)
    }
  }

  // Second pass: update nodes with simple IDs
  const newNodes = nodes.map(node => {
    if (!node.id) {
      return node
    }

    const simpleId = idMapping.get(node.id)
    if (!simpleId) {
      return node
    }

    return {
      ...node,
      id: simpleId,
    }
  })

  // Third pass: update edges with simple IDs and handle IDs
  const newEdges = edges.map(edge => {
    const newSource = idMapping.get(edge.source) || edge.source
    const newTarget = idMapping.get(edge.target) || edge.target

    // Remove namespace from handle IDs
    // "namespace.fieldName" -> "fieldName"
    const newSourceHandle = edge.sourceHandle?.replace(/^par\./, '').replace(/^out\./, '')
    const newTargetHandle = edge.targetHandle?.replace(/^par\./, '').replace(/^out\./, '')

    const newEdge = {
      ...edge,
      source: newSource,
      target: newTarget,
      sourceHandle: newSourceHandle,
      targetHandle: newTargetHandle,
    }
    return {
      ...newEdge,
      id: edgeId(newEdge),
    }
  })

  return {
    ...rest,
    nodes: newNodes,
    edges: newEdges,
  }
}
