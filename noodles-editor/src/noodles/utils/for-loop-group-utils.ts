import type { Node } from '@xyflow/react'
import { layoutGroups } from './group-layout-utils'

type GraphEdge = { source: string; target: string }
export type GraphNode = { id: string; type?: string; parentId?: string }

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

function distancesFrom(startId: string, adjacency: Map<string, Set<string>>): Map<string, number> {
  const distances = new Map([[startId, 0]])
  const queue = [startId]
  while (queue.length > 0) {
    const id = queue.shift()!
    const distance = distances.get(id)!
    for (const nextId of adjacency.get(id) ?? []) {
      if (distances.has(nextId)) continue
      distances.set(nextId, distance + 1)
      queue.push(nextId)
    }
  }
  return distances
}

function absolutePosition(
  nodeId: string,
  nodesById: Map<string, Node>,
  visiting = new Set<string>()
): { x: number; y: number } {
  const node = nodesById.get(nodeId)
  if (!node || visiting.has(nodeId)) return { x: 0, y: 0 }
  visiting.add(nodeId)
  const parent = node.parentId
    ? absolutePosition(node.parentId, nodesById, visiting)
    : { x: 0, y: 0 }
  return { x: parent.x + node.position.x, y: parent.y + node.position.y }
}

function uniqueLoopGroupId(beginId: string, usedIds: Set<string>): string {
  const slashIndex = beginId.lastIndexOf('/')
  const containerId = slashIndex > 0 ? beginId.slice(0, slashIndex) : ''
  const baseId = `${containerId}/for-loop-body`
  let id = baseId
  let suffix = 1
  while (usedIds.has(id)) id = `${baseId}-${suffix++}`
  usedIds.add(id)
  return id
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

/**
 * Repairs loop groups produced before loop body IDs were unique. The repair is
 * based on operator types and graph topology so renamed markers are supported.
 * Innermost Begin operators are paired first with their nearest reachable End;
 * equal-distance candidates are left untouched rather than guessed.
 */
export function repairLegacyForLoopGroups<TNode extends Node>(
  nodes: TNode[],
  edges: GraphEdge[]
): TNode[] {
  const nodesById = new Map(nodes.map(node => [node.id, node]))
  const existingDefinitions = findForLoopDefinitions(nodes)
  const definedBeginIds = new Set(existingDefinitions.map(definition => definition.beginId))
  const definedEndIds = new Set(existingDefinitions.map(definition => definition.endId))
  const definedMetaIds = new Set(existingDefinitions.flatMap(definition => definition.metaIds))
  const definedGroupIds = new Set(existingDefinitions.map(definition => definition.groupId))
  const adjacency = new Map<string, Set<string>>()
  const reverseAdjacency = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set())
    if (!reverseAdjacency.has(edge.target)) reverseAdjacency.set(edge.target, new Set())
    adjacency.get(edge.source)!.add(edge.target)
    reverseAdjacency.get(edge.target)!.add(edge.source)
  }

  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]))
  const begins = nodes.filter(
    node => node.type === 'ForLoopBeginOp' && !definedBeginIds.has(node.id)
  )
  const ends = nodes.filter(node => node.type === 'ForLoopEndOp' && !definedEndIds.has(node.id))
  const beginIds = new Set(begins.map(node => node.id))
  const distancesByBeginId = new Map(
    begins.map(begin => [begin.id, distancesFrom(begin.id, adjacency)])
  )
  const orderedBegins = [...begins].sort((a, b) => {
    const nestedBeginCount = (begin: TNode) =>
      [...(distancesByBeginId.get(begin.id)?.keys() ?? [])].filter(
        id => id !== begin.id && beginIds.has(id)
      ).length
    return nestedBeginCount(a) - nestedBeginCount(b) || nodeOrder.get(a.id)! - nodeOrder.get(b.id)!
  })

  const assignedEndIds = new Set<string>()
  const pairs: Array<{
    begin: TNode
    end: TNode
    meta?: TNode
    scopeNodeIds: Set<string>
  }> = []
  for (const begin of orderedBegins) {
    const distances = distancesByBeginId.get(begin.id)!
    const candidates = ends
      .filter(end => !assignedEndIds.has(end.id) && distances.has(end.id))
      .sort(
        (a, b) =>
          distances.get(a.id)! - distances.get(b.id)! || nodeOrder.get(a.id)! - nodeOrder.get(b.id)!
      )
    if (candidates.length === 0) continue
    if (candidates[1] && distances.get(candidates[0].id) === distances.get(candidates[1].id)) {
      continue
    }

    const end = candidates[0]
    assignedEndIds.add(end.id)
    const downstream = reachableFrom(begin.id, adjacency)
    const upstream = reachableFrom(end.id, reverseAdjacency)
    pairs.push({
      begin,
      end,
      scopeNodeIds: new Set([...downstream].filter(id => upstream.has(id))),
    })
  }
  if (pairs.length === 0) return nodes

  // Meta operators are intentionally unconnected in many projects. Prefer a
  // connected Meta when present, otherwise assign the nearest unused Meta to
  // the visual center of the paired boundaries.
  const availableMetas = nodes.filter(
    node => node.type === 'ForLoopMetaOp' && !definedMetaIds.has(node.id)
  )
  const assignedMetaIds = new Set<string>()
  for (const pair of pairs) {
    const beginPosition = absolutePosition(pair.begin.id, nodesById)
    const endPosition = absolutePosition(pair.end.id, nodesById)
    const center = {
      x: (beginPosition.x + endPosition.x) / 2,
      y: (beginPosition.y + endPosition.y) / 2,
    }
    const metas = availableMetas
      .filter(meta => !assignedMetaIds.has(meta.id))
      .sort((a, b) => {
        const aConnected = pair.scopeNodeIds.has(a.id) ? 0 : 1
        const bConnected = pair.scopeNodeIds.has(b.id) ? 0 : 1
        if (aConnected !== bConnected) return aConnected - bConnected
        const distance = (meta: TNode) => {
          const position = absolutePosition(meta.id, nodesById)
          return (position.x - center.x) ** 2 + (position.y - center.y) ** 2
        }
        return distance(a) - distance(b) || nodeOrder.get(a.id)! - nodeOrder.get(b.id)!
      })
    if (metas[0]) {
      pair.meta = metas[0]
      assignedMetaIds.add(metas[0].id)
    }
  }

  const loopMarkerTypes = new Set(['ForLoopBeginOp', 'ForLoopEndOp', 'ForLoopMetaOp'])
  const reusableGroups = nodes.filter(
    group =>
      group.type === 'group' &&
      !definedGroupIds.has(group.id) &&
      (nodes.some(child => child.parentId === group.id && loopMarkerTypes.has(child.type ?? '')) ||
        (group.selectable === false && group.draggable === false))
  )
  const unusedReusableGroups = new Set(reusableGroups.map(group => group.id))
  const usedIds = new Set(nodes.map(node => node.id))
  const repairedNodes = [...nodes]
  const desiredParent = new Map(nodes.map(node => [node.id, node.parentId]))
  const loopGroupIds = new Set(existingDefinitions.map(definition => definition.groupId))
  const assignedLegacyGroupIds = new Set<string>()

  for (const pair of pairs) {
    const currentMarkers = new Set([pair.begin.id, pair.end.id, pair.meta?.id].filter(Boolean))
    const reusableGroup = reusableGroups
      .filter(group => unusedReusableGroups.has(group.id))
      .sort((a, b) => {
        const markerCount = (group: TNode) =>
          nodes.filter(node => node.parentId === group.id && currentMarkers.has(node.id)).length
        return markerCount(b) - markerCount(a) || nodeOrder.get(a.id)! - nodeOrder.get(b.id)!
      })[0]
    const groupId = reusableGroup?.id ?? uniqueLoopGroupId(pair.begin.id, usedIds)
    let group = reusableGroup
    if (group) {
      unusedReusableGroups.delete(group.id)
    } else {
      group = {
        id: groupId,
        type: 'group',
        data: {},
        selectable: false,
        draggable: false,
        parentId: pair.begin.parentId,
        position: { ...pair.begin.position },
        style: { width: 1200, height: 400 },
      } as TNode
      repairedNodes.push(group)
      nodesById.set(groupId, group)
      desiredParent.set(groupId, pair.begin.parentId)
    }

    loopGroupIds.add(groupId)
    assignedLegacyGroupIds.add(groupId)
    for (const marker of [pair.begin, pair.end, pair.meta]) {
      if (!marker) continue
      desiredParent.set(marker.id, groupId)
    }
  }

  const seededNodes = layoutGroups(repairedNodes, loopGroupIds, desiredParent)
  const reconciledNodes = reconcileForLoopGroups(seededNodes, edges)

  // Drop only redundant legacy group shells that became empty after their loop
  // markers and connected bodies were reassigned. Groups retaining any child
  // are preserved to avoid deleting user-authored visual structure.
  return reconciledNodes.filter(
    group =>
      group.type !== 'group' ||
      assignedLegacyGroupIds.has(group.id) ||
      !unusedReusableGroups.has(group.id) ||
      reconciledNodes.some(node => node.parentId === group.id)
  )
}
