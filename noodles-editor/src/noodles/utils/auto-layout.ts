import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import * as d3 from 'd3'

import type { AutoLayoutSettings } from './serialization'

export type LayoutOptions = AutoLayoutSettings & {
  nodeWidth?: number
  nodeHeight?: number
  nodeSpacing?: number
  rankSpacing?: number
}

const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 100
const DEFAULT_NODE_SPACING = 50
const DEFAULT_RANK_SPACING = 100

/**
 * Layout nodes using the specified algorithm.
 * Returns new nodes with updated positions.
 */
export function layoutNodes(nodes: Node[], edges: Edge[], options: LayoutOptions): Node[] {
  if (nodes.length === 0) return nodes

  const {
    algorithm,
    direction,
    nodeWidth = DEFAULT_NODE_WIDTH,
    nodeHeight = DEFAULT_NODE_HEIGHT,
    nodeSpacing = DEFAULT_NODE_SPACING,
    rankSpacing = DEFAULT_RANK_SPACING,
  } = options

  if (algorithm === 'dagre') {
    return resolveOverlaps(
      layoutWithDagre(nodes, edges, { direction, nodeWidth, nodeHeight, nodeSpacing, rankSpacing }),
      nodeSpacing
    )
  }
  return resolveOverlaps(
    layoutWithD3Force(nodes, edges, { direction, nodeWidth, nodeHeight, nodeSpacing }),
    nodeSpacing
  )
}

type DagreOptions = {
  direction: 'LR' | 'TB'
  nodeWidth: number
  nodeHeight: number
  nodeSpacing: number
  rankSpacing: number
}

function layoutWithDagre(nodes: Node[], edges: Edge[], options: DagreOptions): Node[] {
  const { direction, nodeWidth, nodeHeight, nodeSpacing, rankSpacing } = options

  // Create a new dagre graph
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSpacing,
    ranksep: rankSpacing,
    marginx: 20,
    marginy: 20,
  })

  // Add nodes to the graph
  for (const node of nodes) {
    const width = node.measured?.width ?? node.width ?? nodeWidth
    const height = node.measured?.height ?? node.height ?? nodeHeight
    g.setNode(node.id, { width, height })
  }

  // Add edges to the graph (only edges between nodes in our set)
  const nodeIds = new Set(nodes.map(n => n.id))
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  }

  // Run the layout algorithm
  dagre.layout(g)

  // Map positions back to React Flow nodes
  return nodes.map(node => {
    const nodeWithPosition = g.node(node.id)
    if (!nodeWithPosition) return node

    // Dagre returns center coordinates, React Flow expects top-left
    const width = node.measured?.width ?? node.width ?? nodeWidth
    const height = node.measured?.height ?? node.height ?? nodeHeight

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    }
  })
}

type D3ForceOptions = {
  direction: 'LR' | 'TB'
  nodeWidth: number
  nodeHeight: number
  nodeSpacing: number
}

type SimNode = d3.SimulationNodeDatum & {
  id: string
  width: number
  height: number
  rank: number
}

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  source: string | SimNode
  target: string | SimNode
}

function layoutWithD3Force(nodes: Node[], edges: Edge[], options: D3ForceOptions): Node[] {
  const { direction, nodeWidth, nodeHeight, nodeSpacing } = options

  // Calculate topological rank for each node to guide directional layout
  const ranks = calculateTopologicalRanks(nodes, edges)

  // Create simulation nodes
  const simNodes: SimNode[] = nodes.map(node => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? nodeWidth,
    height: node.measured?.height ?? node.height ?? nodeHeight,
    rank: ranks.get(node.id) ?? 0,
  }))

  // Create links for edges between our nodes
  const nodeIds = new Set(nodes.map(n => n.id))
  const simLinks: SimLink[] = edges
    .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map(e => ({
      source: e.source,
      target: e.target,
    }))

  // Create the simulation
  const simulation = d3
    .forceSimulation<SimNode>(simNodes)
    .force(
      'link',
      d3
        .forceLink<SimNode, SimLink>(simLinks)
        .id(d => d.id)
        .distance(nodeSpacing * 2)
        .strength(0.5)
    )
    .force('charge', d3.forceManyBody().strength(-300))
    .force(
      'collide',
      d3.forceCollide<SimNode>().radius(d => Math.max(d.width, d.height) / 2 + nodeSpacing / 2)
    )
    .force('center', d3.forceCenter(0, 0))

  // Add directional force based on topological rank
  const maxRank = Math.max(...Array.from(ranks.values()), 1)
  if (direction === 'LR') {
    simulation.force(
      'x',
      d3.forceX<SimNode>(d => (d.rank / maxRank) * nodes.length * nodeSpacing * 1.5).strength(0.8)
    )
    simulation.force('y', d3.forceY<SimNode>(0).strength(0.1))
  } else {
    simulation.force(
      'y',
      d3.forceY<SimNode>(d => (d.rank / maxRank) * nodes.length * nodeSpacing * 1.5).strength(0.8)
    )
    simulation.force('x', d3.forceX<SimNode>(0).strength(0.1))
  }

  // Run simulation to completion
  simulation.stop()
  for (let i = 0; i < 300; i++) {
    simulation.tick()
  }

  // Map positions back to React Flow nodes
  const nodeMap = new Map(simNodes.map(n => [n.id, n]))
  return nodes.map(node => {
    const simNode = nodeMap.get(node.id)
    if (!simNode || simNode.x === undefined || simNode.y === undefined) return node

    return {
      ...node,
      position: {
        x: simNode.x,
        y: simNode.y,
      },
    }
  })
}

type Rect = { id: string; x: number; y: number; width: number; height: number }

// Resolve overlapping nodes using the naive pairwise algorithm described in
// https://xyflow.com/blog/node-collision-detection-algorithms.
// Iteratively pushes overlapping node pairs apart along the smaller-overlap axis
// until no overlaps remain or maxIterations is reached.
export function resolveOverlaps(nodes: Node[], margin: number, maxIterations = 50): Node[] {
  if (nodes.length < 2) return nodes

  const rects: Rect[] = nodes.map(node => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH,
    height: node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT,
  }))

  for (let iter = 0; iter < maxIterations; iter++) {
    let overlapFound = false
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        // Positive value means overlap exists on that axis (including margin gap)
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + margin
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + margin
        if (overlapX > 0 && overlapY > 0) {
          overlapFound = true
          // Resolve along the axis with less overlap to minimize displacement.
          // Push direction is determined by center positions so nodes always move apart.
          if (overlapX <= overlapY) {
            const shift = overlapX / 2
            if (a.x + a.width / 2 <= b.x + b.width / 2) {
              a.x -= shift
              b.x += shift
            } else {
              a.x += shift
              b.x -= shift
            }
          } else {
            const shift = overlapY / 2
            if (a.y + a.height / 2 <= b.y + b.height / 2) {
              a.y -= shift
              b.y += shift
            } else {
              a.y += shift
              b.y -= shift
            }
          }
        }
      }
    }
    if (!overlapFound) break
  }

  const posMap = new Map(rects.map(r => [r.id, { x: r.x, y: r.y }]))
  return nodes.map(node => ({ ...node, position: posMap.get(node.id) ?? node.position }))
}

// Calculate topological rank for each node based on graph structure.
// Nodes with no incoming edges have rank 0, others have rank = max(parent ranks) + 1.
function calculateTopologicalRanks(nodes: Node[], edges: Edge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map(n => n.id))
  const ranks = new Map<string, number>()

  // Build adjacency lists
  const incomingEdges = new Map<string, string[]>()
  for (const node of nodes) {
    incomingEdges.set(node.id, [])
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      incomingEdges.get(edge.target)?.push(edge.source)
    }
  }

  // Calculate ranks using BFS-like approach
  const queue = nodes.filter(n => incomingEdges.get(n.id)?.length === 0).map(n => n.id)
  for (const id of queue) {
    ranks.set(id, 0)
  }

  // Process nodes level by level
  const visited = new Set<string>()
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    const incoming = incomingEdges.get(nodeId) ?? []
    const parentRanks = incoming.map(p => ranks.get(p) ?? 0)
    const rank = parentRanks.length > 0 ? Math.max(...parentRanks) + 1 : 0
    ranks.set(nodeId, rank)

    // Add children to queue
    for (const edge of edges) {
      if (edge.source === nodeId && nodeIds.has(edge.target) && !visited.has(edge.target)) {
        queue.push(edge.target)
      }
    }
  }

  // Handle any remaining unvisited nodes (disconnected or cycles)
  for (const node of nodes) {
    if (!ranks.has(node.id)) {
      ranks.set(node.id, 0)
    }
  }

  return ranks
}
