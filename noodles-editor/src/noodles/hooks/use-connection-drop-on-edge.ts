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
import { useCallback } from 'react'
import { analytics } from '../../utils/analytics'
import type { ConnectionDragState } from '../store'
import { getOp } from '../store'
import { canConnect } from '../utils/can-connect'
import { getNodeCenter, pointToLineDistance } from '../utils/edge-geometry'
import { parseHandleId } from '../utils/path-utils'

// Distance threshold in pixels for considering a drop position "on" an edge
const EDGE_DROP_THRESHOLD = 50

interface UseConnectionDropOnEdgeOptions {
  getNodes: () => ReactFlowNode[]
  getEdges: () => ReactFlowEdge[]
  onConnect: (connection: Connection) => void
  getConnectionDragState: () => ConnectionDragState | null
  screenToFlowPosition: (position: XYPosition) => XYPosition
}

// Find the edge closest to a flow-space point, skipping edges from the dragging source
export function findEdgeAtPosition(
  flowPos: XYPosition,
  sourceNodeId: string,
  getNodes: () => ReactFlowNode[],
  getEdges: () => ReactFlowEdge[]
): ReactFlowEdge | null {
  const nodes = getNodes()
  const edges = getEdges()

  let closestEdge: ReactFlowEdge | null = null
  let closestDistance = EDGE_DROP_THRESHOLD

  for (const edge of edges) {
    // Skip reference edges (not data connections)
    if (edge.type === 'ReferenceEdge') continue
    // Skip edges originating from the node being dragged
    if (edge.source === sourceNodeId) continue

    const sourceNode = nodes.find(n => n.id === edge.source)
    const targetNode = nodes.find(n => n.id === edge.target)

    if (!sourceNode || !targetNode) continue

    const sourceCenter = getNodeCenter(sourceNode)
    const targetCenter = getNodeCenter(targetNode)
    const distance = pointToLineDistance(flowPos, sourceCenter, targetCenter)

    if (distance < closestDistance) {
      closestDistance = distance
      closestEdge = edge
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
      const edge = findEdgeAtPosition(flowPos, sourceNodeId, getNodes, getEdges)
      if (!edge) return

      // Parse the dragged source handle to get the field
      const sourceHandleInfo = parseHandleId(sourceHandleId)
      if (!sourceHandleInfo) return

      const sourceOp = getOp(sourceNodeId)
      if (!sourceOp) return

      const sourceField = sourceOp.outputs[sourceHandleInfo.fieldName]
      if (!sourceField) return

      // Parse the existing edge's target handle to check compatibility
      const targetHandleInfo = parseHandleId(edge.targetHandle || '')
      if (!targetHandleInfo) return

      const targetOp = getOp(edge.target)
      if (!targetOp) return

      const targetField = targetOp.inputs[targetHandleInfo.fieldName]
      if (!targetField) return

      if (!canConnect(sourceField, targetField)) return

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
