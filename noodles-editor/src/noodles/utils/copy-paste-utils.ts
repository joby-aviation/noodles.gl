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
 * Given selected nodes, expands the set to include all descendant children
 * and internal edges of any ContainerOp nodes. Recurses into nested containers
 * so that `/container/nested/child` is collected when `/container` is selected.
 * Container children use path-based nesting (ID prefix), not ReactFlow's parentId.
 */
export function collectContainerChildren<N extends CopyPasteNode, E extends CopyPasteEdge>(
  selectedNodes: N[],
  allNodes: N[],
  allEdges: E[]
): { additionalNodes: N[]; additionalEdges: E[] } {
  const additionalNodes: N[] = []
  const additionalEdges: E[] = []
  const visitedIds = new Set(selectedNodes.map(n => n.id))

  const queue = selectedNodes.filter(n => n.type === 'ContainerOp')
  while (queue.length > 0) {
    const container = queue.shift()!
    const children = allNodes.filter(
      childNode => getParentPath(childNode.id) === container.id && !visitedIds.has(childNode.id)
    )

    for (const child of children) {
      visitedIds.add(child.id)
      additionalNodes.push(child)
      if (child.type === 'ContainerOp') {
        queue.push(child)
      }
    }

    const containerAndChildrenIds = new Set([container.id, ...children.map(c => c.id)])
    for (const edge of allEdges) {
      if (containerAndChildrenIds.has(edge.source) && containerAndChildrenIds.has(edge.target)) {
        additionalEdges.push(edge)
      }
    }
  }

  return { additionalNodes, additionalEdges }
}

/**
 * Given a set of nodes to copy, finds any parent group nodes (ForLoop visual
 * grouping) that should be included, plus their internal edges.
 * Pure function — does not mutate the input set.
 */
export function collectGroupParents<N extends CopyPasteNode, E extends CopyPasteEdge>(
  nodesToCopy: ReadonlySet<N>,
  allGraphNodes: N[],
  allGraphEdges: E[]
): { additionalNodes: N[]; additionalEdges: E[] } {
  const additionalNodes: N[] = []
  const additionalEdges: E[] = []
  const includedIds = new Set([...nodesToCopy].map(n => n.id))

  let addedParent = true
  while (addedParent) {
    addedParent = false
    for (const node of [...nodesToCopy, ...additionalNodes]) {
      if (node.parentId && !includedIds.has(node.parentId)) {
        const parent = allGraphNodes.find(n => n.id === node.parentId)
        if (parent && parent.type === 'group') {
          includedIds.add(parent.id)
          additionalNodes.push(parent)
          addedParent = true
        }
      }
    }
  }

  const allIncluded = [...nodesToCopy, ...additionalNodes]
  for (const node of allIncluded) {
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
 * Expand a set of node IDs to include all path-based descendants at any depth.
 * Used by deletion paths to cascade container deletion to children.
 * Mutates and returns the input set.
 */
export function expandDeleteSet(
  nodeIds: Set<string>,
  allNodes: { id: string }[]
): Set<string> {
  let expanded = true
  while (expanded) {
    expanded = false
    for (const node of allNodes) {
      if (nodeIds.has(node.id)) continue
      const pathParent = getParentPath(node.id)
      if (pathParent && pathParent !== '/' && nodeIds.has(pathParent)) {
        nodeIds.add(node.id)
        expanded = true
      }
    }
  }
  return nodeIds
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
  const reverseIdMap = new Map<string, string>()
  for (const [original, remapped] of idMap) {
    reverseIdMap.set(remapped, original)
  }

  const containerChildIds = new Set<string>()
  for (const node of pastedNodes) {
    if (!node.parentId) {
      const originalId = reverseIdMap.get(node.id)
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
