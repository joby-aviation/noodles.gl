import { hasOp } from '../store'
import { edgeId, nodeId } from './id-utils'
import { generateQualifiedPath, getBaseName, getParentPath } from './path-utils'

export type CopyPasteNode = {
  id: string
  type?: string
  parentId?: string
  position: { x: number; y: number }
  [key: string]: unknown
}

export type CopyPasteEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  [key: string]: unknown
}

/**
 * Given selected nodes, expands the set to include container children and
 * internal edges. Container children use path-based nesting (ID prefix),
 * not ReactFlow's parentId. They live in a different scope and must be
 * found from the full node/edge arrays.
 */
export function collectContainerChildren<N extends CopyPasteNode, E extends CopyPasteEdge>(
  selectedNodes: N[],
  allNodes: N[],
  allEdges: E[]
): { additionalNodes: N[]; additionalEdges: E[] } {
  const additionalNodes: N[] = []
  const additionalEdges: E[] = []

  for (const node of selectedNodes) {
    if (node.type === 'ContainerOp') {
      const children = allNodes.filter(childNode => getParentPath(childNode.id) === node.id)
      additionalNodes.push(...children)

      const containerAndChildrenIds = new Set([node.id, ...children.map(c => c.id)])
      for (const edge of allEdges) {
        if (containerAndChildrenIds.has(edge.source) && containerAndChildrenIds.has(edge.target)) {
          additionalEdges.push(edge)
        }
      }
    }
  }

  return { additionalNodes, additionalEdges }
}

/**
 * Given selected nodes, expands the set to include parent group nodes
 * (for ForLoop visual grouping) and their internal edges.
 */
export function collectGroupParents<N extends CopyPasteNode, E extends CopyPasteEdge>(
  nodesToCopy: Set<N>,
  allGraphNodes: N[],
  allGraphEdges: E[]
): { additionalNodes: N[]; additionalEdges: E[] } {
  const additionalNodes: N[] = []
  const additionalEdges: E[] = []

  let addedParent = true
  while (addedParent) {
    addedParent = false
    for (const node of nodesToCopy) {
      if (node.parentId) {
        const parent = allGraphNodes.find(n => n.id === node.parentId)
        if (parent && parent.type === 'group' && !nodesToCopy.has(parent)) {
          nodesToCopy.add(parent)
          additionalNodes.push(parent)
          addedParent = true
        }
      }
    }
  }

  for (const node of nodesToCopy) {
    if (node.type === 'group') {
      const children = allGraphNodes.filter(childNode => childNode.parentId === node.id)
      const groupAndChildrenIds = new Set([node.id, ...children.map(c => c.id)])
      for (const edge of allGraphEdges) {
        if (groupAndChildrenIds.has(edge.source) && groupAndChildrenIds.has(edge.target)) {
          additionalEdges.push(edge)
        }
      }
    }
  }

  return { additionalNodes, additionalEdges }
}

/**
 * Generate a unique node ID, checking both the operator store and a set
 * of existing node IDs (which includes non-operator nodes like groups).
 */
export function uniqueNodeId(
  baseName: string,
  containerId: string | undefined,
  existingNodeIds: Set<string>
): string {
  const newId = nodeId(baseName, containerId)

  if (!existingNodeIds.has(newId)) {
    return newId
  }

  for (let i = 1; i < 100_000; i++) {
    const candidatePath = generateQualifiedPath(`${baseName}-${i}`, containerId ?? '/')
    if (!existingNodeIds.has(candidatePath) && !hasOp(candidatePath)) {
      return candidatePath
    }
  }

  return newId
}

/**
 * Sort nodes so containers/groups come before their children.
 * This ensures parent IDs are populated in the idMap before children need them.
 * Uses path depth as primary sort key to handle arbitrary nesting levels.
 */
export function sortParentsFirst<N extends CopyPasteNode>(nodes: N[]): N[] {
  return [...nodes].sort((a, b) => {
    if (a.type === 'group' && b.type !== 'group') return -1
    if (b.type === 'group' && a.type !== 'group') return 1
    if (a.parentId === b.id) return 1
    if (b.parentId === a.id) return -1
    // Sort by path depth so ancestors always precede descendants
    const depthA = a.id.split('/').length
    const depthB = b.id.split('/').length
    if (depthA !== depthB) return depthA - depthB
    return 0
  })
}

export type RemapResult<N extends CopyPasteNode, E extends CopyPasteEdge> = {
  nodes: N[]
  edges: E[]
  idMap: Map<string, string>
}

/**
 * Remap node and edge IDs to avoid conflicts when pasting.
 * Container children get namespaced under the new container ID.
 * Group (ForLoop) children stay as siblings.
 */
export function remapPastedIds<N extends CopyPasteNode, E extends CopyPasteEdge>(
  nodes: N[],
  edges: E[],
  currentContainerId: string | undefined,
  existingNodeIds: Set<string>
): RemapResult<N, E> {
  const sortedNodes = sortParentsFirst(nodes)

  const nodeTypeMap = new Map(sortedNodes.map(n => [n.id, n.type]))
  const copiedNodeIds = new Set(sortedNodes.map(n => n.id))

  const idMap = new Map<string, string>()
  const mutableExisting = new Set(existingNodeIds)

  for (const node of sortedNodes) {
    const baseName = getBaseName(node.id).replace(/-\d+$/, '')

    let containerId = currentContainerId
    if (node.parentId && idMap.has(node.parentId)) {
      const parentType = nodeTypeMap.get(node.parentId)
      if (parentType === 'ContainerOp') {
        containerId = idMap.get(node.parentId)!
      }
    } else {
      const pathParent = getParentPath(node.id)
      if (
        pathParent &&
        pathParent !== '/' &&
        copiedNodeIds.has(pathParent) &&
        idMap.has(pathParent)
      ) {
        const parentType = nodeTypeMap.get(pathParent)
        if (parentType === 'ContainerOp') {
          containerId = idMap.get(pathParent)!
        }
      }
    }

    const newId = uniqueNodeId(baseName, containerId, mutableExisting)
    idMap.set(node.id, newId)
    mutableExisting.add(newId)
  }

  const remappedNodes = sortedNodes.map(node => {
    const newId = idMap.get(node.id)!
    const newParentId = node.parentId ? idMap.get(node.parentId) : undefined
    return { ...node, id: newId, parentId: newParentId }
  })

  const remappedEdges = edges.map(edge => {
    const source = idMap.get(edge.source) || edge.source
    const target = idMap.get(edge.target) || edge.target
    return {
      ...edge,
      id: edgeId({ ...edge, source, target }),
      source,
      target,
    }
  })

  return { nodes: remappedNodes, edges: remappedEdges, idMap }
}

/**
 * Identify which pasted nodes are container children (path-based, no parentId).
 * These should not be repositioned during paste — they keep their relative position.
 */
export function identifyContainerChildren(
  pastedNodes: CopyPasteNode[],
  idMap: Map<string, string>,
  copiedNodeIds: Set<string>
): Set<string> {
  const containerChildIds = new Set<string>()
  for (const node of pastedNodes) {
    if (!node.parentId) {
      const originalId = [...idMap.entries()].find(([_, v]) => v === node.id)?.[0]
      if (originalId) {
        const pathParent = getParentPath(originalId)
        if (pathParent && pathParent !== '/' && copiedNodeIds.has(pathParent)) {
          containerChildIds.add(node.id)
        }
      }
    }
  }
  return containerChildIds
}
