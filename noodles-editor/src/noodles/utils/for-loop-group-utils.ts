import type { Node } from '@xyflow/react'
import { layoutGroups } from './group-layout-utils'

type GraphEdge = { source: string; target: string }
type GraphNode = { id: string; type?: string; parentId?: string }

export type ForLoopDefinition = {
  groupId: string
  beginId: string
  endId: string
  metaIds: string[]
}

type LoopGroup = {
  groupId: string
  beginId: string
  endId: string
  metaIds: string[]
  scopeNodeIds: Set<string>
}

function reachableFrom(startId: string, adjacency: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>()
  const queue = [startId]

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    queue.push(...(adjacency.get(id) ?? []))
  }

  return visited
}

export function findForLoopDefinitions(nodes: GraphNode[]): ForLoopDefinition[] {
  const definitions: ForLoopDefinition[] = []

  for (const group of nodes) {
    if (group.type !== 'group') continue
    const children = nodes.filter(node => node.parentId === group.id)
    const begins = children.filter(node => node.type === 'ForLoopBeginOp')
    const ends = children.filter(node => node.type === 'ForLoopEndOp')
    if (begins.length !== 1 || ends.length !== 1) continue

    definitions.push({
      groupId: group.id,
      beginId: begins[0].id,
      endId: ends[0].id,
      metaIds: children.filter(node => node.type === 'ForLoopMetaOp').map(node => node.id),
    })
  }

  return definitions
}

function findLoopGroups(nodes: Node[], edges: GraphEdge[]): LoopGroup[] {
  const adjacency = new Map<string, Set<string>>()
  const reverseAdjacency = new Map<string, Set<string>>()

  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set())
    if (!reverseAdjacency.has(edge.target)) reverseAdjacency.set(edge.target, new Set())
    adjacency.get(edge.source)!.add(edge.target)
    reverseAdjacency.get(edge.target)!.add(edge.source)
  }

  const groups: LoopGroup[] = []
  for (const definition of findForLoopDefinitions(nodes)) {
    const { groupId, beginId, endId, metaIds } = definition
    const downstream = reachableFrom(beginId, adjacency)
    const upstream = reachableFrom(endId, reverseAdjacency)
    const scopeNodeIds = new Set([...downstream].filter(id => upstream.has(id)))

    groups.push({
      groupId,
      beginId,
      endId,
      metaIds,
      scopeNodeIds,
    })
  }

  return groups
}

function chooseOwner(node: Node, candidates: LoopGroup[]): string | undefined {
  if (candidates.length === 0) return undefined
  if (node.parentId && candidates.some(candidate => candidate.groupId === node.parentId)) {
    return node.parentId
  }

  return [...candidates].sort(
    (a, b) => a.scopeNodeIds.size - b.scopeNodeIds.size || a.groupId.localeCompare(b.groupId)
  )[0].groupId
}

/**
 * Makes visual ForLoop membership match the directed Begin-to-End subgraph and fits
 * each visual group around its direct children. Screen positions are preserved when
 * nodes enter or leave a group.
 */
export function reconcileForLoopGroups<TNode extends Node>(
  nodes: TNode[],
  edges: GraphEdge[]
): TNode[] {
  const loopGroups = findLoopGroups(nodes, edges)
  const loopMarkerTypes = new Set(['ForLoopBeginOp', 'ForLoopEndOp', 'ForLoopMetaOp'])
  const loopGroupIds = new Set(
    nodes
      .filter(
        group =>
          group.type === 'group' &&
          nodes.some(node => node.parentId === group.id && loopMarkerTypes.has(node.type ?? ''))
      )
      .map(group => group.id)
  )
  if (loopGroupIds.size === 0) return nodes

  const nodesById = new Map(nodes.map(node => [node.id, node]))
  const candidatesByNodeId = new Map<string, LoopGroup[]>()

  for (const group of loopGroups) {
    for (const nodeId of group.scopeNodeIds) {
      const candidates = candidatesByNodeId.get(nodeId) ?? []
      candidates.push(group)
      candidatesByNodeId.set(nodeId, candidates)
    }
  }

  const desiredParent = new Map<string, string | undefined>()
  for (const node of nodes) {
    desiredParent.set(node.id, node.parentId)
    if (node.type === 'group') {
      if (loopGroupIds.has(node.parentId ?? '')) desiredParent.set(node.id, undefined)
      continue
    }

    const ownLoop = loopGroups.find(
      group =>
        group.beginId === node.id || group.endId === node.id || group.metaIds.includes(node.id)
    )
    if (ownLoop) {
      desiredParent.set(node.id, ownLoop.groupId)
      continue
    }

    const owner = chooseOwner(node, candidatesByNodeId.get(node.id) ?? [])
    if (owner || loopGroupIds.has(node.parentId ?? '')) {
      desiredParent.set(node.id, owner)
    }
  }

  // A nested loop is represented by its group inside the outer group. Its operators
  // remain direct children of the inner group.
  for (const loop of loopGroups) {
    const groupNode = nodesById.get(loop.groupId)!
    const outerCandidates = (candidatesByNodeId.get(loop.beginId) ?? []).filter(
      candidate => candidate.groupId !== loop.groupId
    )
    const owner = chooseOwner(groupNode, outerCandidates)
    if (owner || loopGroupIds.has(groupNode.parentId ?? '')) {
      desiredParent.set(loop.groupId, owner)
    }
  }

  return layoutGroups(nodes, loopGroupIds, desiredParent)
}
