import type { Edge, Node } from '@xyflow/react'

export type LayoutOptions = {
  nodeWidth?: number
  nodeHeight?: number
  nodeSpacing?: number
}

const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 100
const DEFAULT_NODE_SPACING = 50

/**
 * Layout nodes in semantic columns (data, transforms, layers, deck, out).
 * Returns new nodes with updated positions.
 */
export function layoutNodes(nodes: Node[], edges: Edge[], options: LayoutOptions = {}): Node[] {
  // Comments stay where the user put them, next to the nodes they describe
  const comments = nodes.filter(node => node.type === 'CommentOp')
  if (comments.length > 0) {
    const others = nodes.filter(node => node.type !== 'CommentOp')
    return [...layoutNodes(others, edges, options), ...comments]
  }
  if (nodes.length === 0) return nodes

  const {
    nodeWidth = DEFAULT_NODE_WIDTH,
    nodeHeight = DEFAULT_NODE_HEIGHT,
    nodeSpacing = DEFAULT_NODE_SPACING,
  } = options

  return resolveOverlaps(
    layoutWithSemanticColumns(nodes, edges, { nodeWidth, nodeHeight, nodeSpacing }),
    nodeSpacing
  )
}

type SemanticOptions = {
  nodeWidth: number
  nodeHeight: number
  nodeSpacing: number
}

enum LayoutTier {
  DATA_SOURCE = 0,
  TRANSFORM = 1,
  ENHANCEMENT = 2,
  VIEW = 2.5,
  BASEMAP = 3.5, // Must differ from LAYER: tiers are grouped by value
  LAYER = 3,
  SWITCH = 4,
  EXTENSION = 4.5,
  RENDER = 5,
  OUTPUT = 6,
  WIDGET = 5.5,
}

function getNodeWidth(node: Node): number {
  return node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH
}

function getNodeHeight(node: Node): number {
  return node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT
}

// Categorize operators by semantic type to determine layout tier
function categorizeOperatorByType(nodeType: string): LayoutTier {
  // Layer operators (all end with LayerOp)
  if (nodeType.endsWith('LayerOp')) return LayoutTier.LAYER

  // Rendering operators
  if (nodeType === 'DeckRendererOp') return LayoutTier.RENDER
  if (nodeType === 'OutOp') return LayoutTier.OUTPUT
  if (nodeType === 'MaplibreBasemapOp') return LayoutTier.BASEMAP

  // Data source operators
  if (
    [
      'FileOp',
      'DuckDbOp',
      'JSONOp',
      'GeocoderOp',
      'DirectionsOp',
      'NetworkOp',
      'TableEditorOp',
    ].includes(nodeType)
  )
    return LayoutTier.DATA_SOURCE

  // Transform operators
  if (
    [
      'AccessorOp',
      'FilterOp',
      'CodeOp',
      'ExpressionOp',
      'SliceOp',
      'SortOp',
      'ProjectOp',
      'UnprojectOp',
      'SelectOp',
      'ConcatOp',
      'MergeOp',
      'CrossOp',
      'SimplifyOp',
      'SmoothOp',
      'GeoJsonOp',
      'GeoJsonTransformOp',
      'TimeSeriesOp',
    ].includes(nodeType)
  )
    return LayoutTier.TRANSFORM

  // Enhancement operators
  if (
    [
      'ColorOp',
      'ColorRampOp',
      'CategoricalColorRampOp',
      'MapRangeOp',
      'MathOp',
      'BlendingOp',
      'BezierCurveOp',
      'RampOp',
      'HSLOp',
      'RandomizeAttributeOp',
      'LayerPropsOp',
    ].includes(nodeType)
  )
    return LayoutTier.ENHANCEMENT

  // View operators
  if (
    [
      'MapViewOp',
      'GlobeViewOp',
      'OrbitViewOp',
      'FirstPersonViewOp',
      'OrthographicViewOp',
      'MapViewStateOp',
    ].includes(nodeType)
  )
    return LayoutTier.VIEW

  // Switch operator
  if (nodeType === 'SwitchOp') return LayoutTier.SWITCH

  // Extension operators
  if (nodeType.endsWith('ExtensionOp')) return LayoutTier.EXTENSION

  // Widget operators
  if (nodeType.endsWith('WidgetOp') || nodeType === 'ViewerOp') return LayoutTier.WIDGET

  // Default: infer from topology
  return LayoutTier.TRANSFORM
}

function layoutWithSemanticColumns(nodes: Node[], edges: Edge[], options: SemanticOptions): Node[] {
  const { nodeWidth, nodeHeight, nodeSpacing } = options

  // Phase 1: Categorize nodes by semantic tier
  const nodeTiers = new Map<string, LayoutTier>()
  const nodeIds = new Set(nodes.map(n => n.id))

  for (const node of nodes) {
    nodeTiers.set(node.id, categorizeOperatorByType(node.type ?? ''))
  }

  // Phase 2: Calculate topological depth for each node (for horizontal positioning within tiers)
  const nodeDepths = new Map<string, number>()
  const calculateDepth = (nodeId: string, visited = new Set<string>()): number => {
    if (nodeDepths.has(nodeId)) return nodeDepths.get(nodeId)!
    if (visited.has(nodeId)) return 0 // Break cycles

    visited.add(nodeId)
    const incomingEdges = edges.filter(e => e.target === nodeId && nodeIds.has(e.source))

    if (incomingEdges.length === 0) {
      nodeDepths.set(nodeId, 0)
      return 0
    }

    const maxParentDepth = Math.max(...incomingEdges.map(e => calculateDepth(e.source, visited)))
    const depth = maxParentDepth + 1
    nodeDepths.set(nodeId, depth)
    return depth
  }

  for (const node of nodes) {
    calculateDepth(node.id)
  }

  // Base X-coordinates for each tier
  const TIER_BASE_X: Record<number, number> = {
    [LayoutTier.DATA_SOURCE]: 0,
    [LayoutTier.TRANSFORM]: 350,
    [LayoutTier.ENHANCEMENT]: 600,
    [LayoutTier.VIEW]: 450,
    [LayoutTier.BASEMAP]: 900,
    [LayoutTier.LAYER]: 900,
    [LayoutTier.SWITCH]: 1200,
    [LayoutTier.EXTENSION]: 1350,
    [LayoutTier.RENDER]: 1500,
    [LayoutTier.WIDGET]: 1650,
    [LayoutTier.OUTPUT]: 1800,
  }

  const DEPTH_SPACING = 250 // Horizontal spacing for chained nodes within a tier

  // Group nodes by tier
  const tierGroups = new Map<LayoutTier, Node[]>()
  for (const node of nodes) {
    const tier = nodeTiers.get(node.id) ?? LayoutTier.TRANSFORM
    if (!tierGroups.has(tier)) tierGroups.set(tier, [])
    tierGroups.get(tier)!.push(node)
  }

  // Helper: Calculate X position based on tier and depth
  const getNodeX = (node: Node): number => {
    const tier = nodeTiers.get(node.id) ?? LayoutTier.TRANSFORM
    const depth = nodeDepths.get(node.id) ?? 0
    const baseX = TIER_BASE_X[tier]

    // For certain tiers (LAYER, RENDER, OUTPUT, BASEMAP), use fixed column positions
    if (
      tier === LayoutTier.LAYER ||
      tier === LayoutTier.RENDER ||
      tier === LayoutTier.OUTPUT ||
      tier === LayoutTier.BASEMAP
    ) {
      return baseX
    }

    // For other tiers, add depth-based spacing to create horizontal chains
    return baseX + depth * DEPTH_SPACING
  }

  // Phase 3: Assign Y-coordinates with semantic alignment
  const positionedNodes = new Map<string, { x: number; y: number }>()

  // 3a. Position layer column first (the visual anchor)
  const layerNodes = tierGroups.get(LayoutTier.LAYER) ?? []
  const layerYSpacing = 150
  let layerMinY = 0
  let layerMaxY = 0

  if (layerNodes.length > 0) {
    const totalLayerHeight = layerNodes.reduce(
      (sum, node, i) => sum + getNodeHeight(node) + (i > 0 ? layerYSpacing : 0),
      0
    )
    layerMinY = -totalLayerHeight / 2

    let currentY = layerMinY
    for (const node of layerNodes) {
      const x = getNodeX(node)
      positionedNodes.set(node.id, { x, y: currentY })
      currentY += getNodeHeight(node) + layerYSpacing
    }
    layerMaxY = currentY - layerYSpacing
  }

  // 3b. Position DeckRendererOp (vertically centered between layers)
  const renderNodes = tierGroups.get(LayoutTier.RENDER) ?? []
  for (const node of renderNodes) {
    const x = getNodeX(node)
    const y = layerNodes.length > 0 ? (layerMinY + layerMaxY) / 2 - getNodeHeight(node) / 2 : 0
    positionedNodes.set(node.id, { x, y })
  }

  // 3c. Position OutOp (same Y as DeckRendererOp)
  const outputNodes = tierGroups.get(LayoutTier.OUTPUT) ?? []
  for (const node of outputNodes) {
    const x = getNodeX(node)
    const renderY = renderNodes[0] ? (positionedNodes.get(renderNodes[0].id)?.y ?? 0) : 0
    positionedNodes.set(node.id, { x, y: renderY })
  }

  // 3d. Position MaplibreBasemapOp (below layers in same column)
  const basemapNodes = tierGroups.get(LayoutTier.BASEMAP) ?? []
  for (const node of basemapNodes) {
    const x = getNodeX(node)
    const y = layerNodes.length > 0 ? layerMaxY + 200 : 400
    positionedNodes.set(node.id, { x, y })
  }

  // 3e. Position SwitchOp (between layers and renderer, vertically centered)
  const switchNodes = tierGroups.get(LayoutTier.SWITCH) ?? []
  for (const node of switchNodes) {
    const x = getNodeX(node)
    const y = layerNodes.length > 0 ? (layerMinY + layerMaxY) / 2 - getNodeHeight(node) / 2 : 0
    positionedNodes.set(node.id, { x, y })
  }

  // 3f. Position Extensions (between switch and renderer)
  const extensionNodes = tierGroups.get(LayoutTier.EXTENSION) ?? []
  let extensionY = layerNodes.length > 0 ? (layerMinY + layerMaxY) / 2 : 0
  for (const node of extensionNodes) {
    const x = getNodeX(node)
    positionedNodes.set(node.id, { x, y: extensionY })
    extensionY += getNodeHeight(node) + nodeSpacing
  }

  // 3g. Position Widgets (near output)
  const widgetNodes = tierGroups.get(LayoutTier.WIDGET) ?? []
  let widgetY = layerNodes.length > 0 ? layerMinY : 0
  for (const node of widgetNodes) {
    const x = getNodeX(node)
    positionedNodes.set(node.id, { x, y: widgetY })
    widgetY += getNodeHeight(node) + nodeSpacing
  }

  // 3h. Position data sources (aligned with vertical midpoint of consumers)
  const dataSourceNodes = tierGroups.get(LayoutTier.DATA_SOURCE) ?? []
  const getConsumers = (nodeId: string): string[] => {
    return edges.filter(e => e.source === nodeId && nodeIds.has(e.target)).map(e => e.target)
  }

  for (const node of dataSourceNodes) {
    const consumers = getConsumers(node.id)
    const x = getNodeX(node)

    if (consumers.length === 0) {
      positionedNodes.set(node.id, { x, y: 0 })
    } else {
      const consumerMidpoints = consumers
        .map(cId => {
          const cPos = positionedNodes.get(cId)
          const cNode = nodes.find(n => n.id === cId)
          if (!cPos || !cNode) return null
          return cPos.y + getNodeHeight(cNode) / 2
        })
        .filter((y): y is number => y !== null)

      if (consumerMidpoints.length > 0) {
        const avgMidpoint = consumerMidpoints.reduce((a, b) => a + b, 0) / consumerMidpoints.length
        const y = avgMidpoint - getNodeHeight(node) / 2
        positionedNodes.set(node.id, { x, y })
      } else {
        positionedNodes.set(node.id, { x, y: 0 })
      }
    }
  }

  // 3i. Position remaining tiers (transforms, enhancements, views) with topological layout
  const remainingTiers = [LayoutTier.TRANSFORM, LayoutTier.ENHANCEMENT, LayoutTier.VIEW]

  for (const tier of remainingTiers) {
    const tierNodes = tierGroups.get(tier) ?? []
    if (tierNodes.length === 0) continue

    // Try to align with consumers where possible
    for (const node of tierNodes) {
      const consumers = getConsumers(node.id)
      const x = getNodeX(node)

      if (consumers.length === 0) {
        // No consumers - place near top
        const existingPositions = Array.from(positionedNodes.values())
        const minY = existingPositions.length > 0 ? Math.min(...existingPositions.map(p => p.y)) : 0
        positionedNodes.set(node.id, { x, y: minY - 100 })
      } else {
        // For nodes with multiple consumers (especially AccessorOps shared between layers),
        // position them to split the vertical space between consumers
        const consumerPositions = consumers
          .map(cId => {
            const cPos = positionedNodes.get(cId)
            const cNode = nodes.find(n => n.id === cId)
            if (!cPos || !cNode) return null
            return { y: cPos.y, height: getNodeHeight(cNode) }
          })
          .filter((p): p is { y: number; height: number } => p !== null)

        if (consumerPositions.length > 0) {
          // Sort consumers by Y position
          consumerPositions.sort((a, b) => a.y - b.y)

          if (consumerPositions.length === 1) {
            // Single consumer: align with its midpoint
            const midY = consumerPositions[0].y + consumerPositions[0].height / 2
            const y = midY - getNodeHeight(node) / 2
            positionedNodes.set(node.id, { x, y })
          } else {
            // Multiple consumers: position between the extremes to minimize edge length
            const firstMidY = consumerPositions[0].y + consumerPositions[0].height / 2
            const lastMidY =
              consumerPositions[consumerPositions.length - 1].y +
              consumerPositions[consumerPositions.length - 1].height / 2
            const centerY = (firstMidY + lastMidY) / 2 - getNodeHeight(node) / 2
            positionedNodes.set(node.id, { x, y: centerY })
          }
        } else {
          positionedNodes.set(node.id, { x, y: 0 })
        }
      }
    }
  }

  // Apply positions to nodes
  return nodes.map(node => {
    const pos = positionedNodes.get(node.id)
    if (!pos) return node
    return { ...node, position: { x: pos.x, y: pos.y } }
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
