// Hook to handle dropping a dragged connection line onto an existing edge
// When a user drags from a source handle and drops on an existing connection,
// the existing edge's source is replaced with the dragged connection's source

import type {
  Connection,
  OnConnectEnd,
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
  XYPosition,
} from '@xyflow/react'
import { useCallback, useRef } from 'react'
import { analytics } from '../../utils/analytics'
import type { ConnectionDragState } from '../store'
import { getNodeCenter, pointToLineDistance } from '../utils/edge-geometry'
import type { EdgeSpatialIndex } from '../utils/spatial-index'

// Distance threshold in pixels for considering a drop position "on" an edge
const EDGE_DROP_THRESHOLD = 50
// Smaller threshold used when the dragged source is incompatible with the target edge
const EDGE_DROP_THRESHOLD_WEAK = 20

interface UseConnectionDropOnEdgeOptions {
  getNodes: () => ReactFlowNode[]
  getEdges: () => ReactFlowEdge[]
  onConnect: (connection: Connection) => void
  getConnectionDragState: () => ConnectionDragState | null
  screenToFlowPosition: (position: XYPosition) => XYPosition
}

// Find the edge closest to a flow-space point, skipping edges from the dragging source.
// compatibleEdgeIds: edges whose target field is type-compatible with the dragged source.
// Incompatible edges use a smaller threshold, making them harder to accidentally target.
// Uses spatial index if provided for O(log n) queries, otherwise falls back to linear search.
export function findEdgeAtPosition(
  flowPos: XYPosition,
  sourceNodeId: string,
  getNodes: () => ReactFlowNode[],
  getEdges: () => ReactFlowEdge[],
  compatibleEdgeIds?: Set<string>,
  spatialIndex?: EdgeSpatialIndex
): ReactFlowEdge | null {
  const nodes = getNodes()
  const edges = getEdges()

  // Use spatial index if available (O(log n) query)
  let candidateEdges: ReactFlowEdge[]
  if (spatialIndex) {
    // Query edges near the position
    candidateEdges = spatialIndex.queryRadius(flowPos.x, flowPos.y, EDGE_DROP_THRESHOLD)
  } else {
    // Fallback to all edges (linear search)
    candidateEdges = edges
  }

  // Quick win: Create a Map for O(1) node lookups instead of O(n) find() calls
  const nodeMap = new Map<string, ReactFlowNode>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  let closestEdge: ReactFlowEdge | null = null
  let closestDistance = EDGE_DROP_THRESHOLD

  for (const edge of candidateEdges) {
    // Skip reference edges (not data connections)
    if (edge.type === 'ReferenceEdge') continue
    // Skip edges originating from or targeting the node being dragged (no self-connections)
    if (edge.source === sourceNodeId) continue
    if (edge.target === sourceNodeId) continue

    // Quick win: Use Map.get() instead of Array.find() for O(1) lookup
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)

    if (!sourceNode || !targetNode) continue

    const sourceCenter = getNodeCenter(sourceNode)
    const targetCenter = getNodeCenter(targetNode)
    const distance = pointToLineDistance(flowPos, sourceCenter, targetCenter)

    const threshold =
      compatibleEdgeIds == null || compatibleEdgeIds.has(edge.id)
        ? EDGE_DROP_THRESHOLD
        : EDGE_DROP_THRESHOLD_WEAK

    if (distance < threshold && distance < closestDistance) {
      closestDistance = distance
      closestEdge = edge

      // Quick win: Early exit if we found a very close edge (within 5 pixels)
      if (closestDistance < 5) {
        break
      }
    }
  }

  return closestEdge
}

export function useConnectionDropOnEdge(options: UseConnectionDropOnEdgeOptions) {
  const { getNodes, getEdges, onConnect, getConnectionDragState, screenToFlowPosition } = options

  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, connectionState) => {
      // Only act when the drag didn't land on a valid handle
      if (connectionState.toHandle !== null) return
      // Need a valid drop position
      if (!connectionState.to) return

      const dragState = getConnectionDragState()
      if (!dragState) return

      const { sourceNodeId, sourceHandleId } = dragState

      // connectionState.to is in screen/container coordinates — convert to flow space
      const flowPos = screenToFlowPosition(connectionState.to)
      const edge = findEdgeAtPosition(
        flowPos,
        sourceNodeId,
        getNodes,
        getEdges,
        dragState.compatibleEdgeIds
      )
      if (!edge) return

      // Call onConnect with the swapped source — this handles field wiring and replaces
      // any existing connection to the same target input automatically
      onConnect({
        source: sourceNodeId,
        sourceHandle: sourceHandleId,
        target: edge.target,
        targetHandle: edge.targetHandle || null,
      })

      analytics.track('connection_swapped_on_edge', {
        sourceNode: sourceNodeId,
        replacedSource: edge.source,
        targetNode: edge.target,
      })
    },
    [getNodes, getEdges, onConnect, getConnectionDragState, screenToFlowPosition]
  )

  return { onConnectEnd }
}
