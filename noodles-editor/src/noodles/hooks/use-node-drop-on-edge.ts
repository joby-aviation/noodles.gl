// Hook to handle dropping nodes onto edges to insert them into the connection
// This provides a UX similar to Houdini, Blender, and TouchDesigner

import type { Edge as ReactFlowEdge, Node as ReactFlowNode, XYPosition } from '@xyflow/react'
import { useCallback } from 'react'
import { analytics } from '../../utils/analytics'
import type { IOperator, Operator } from '../operators'
import { getOp } from '../store'
import { canConnect } from '../utils/can-connect'
import { edgeId } from '../utils/id-utils'
import { parseHandleId } from '../utils/path-utils'

// Distance threshold in pixels for considering a node "on" an edge
const EDGE_DROP_THRESHOLD = 30

// Minimum measured dimensions for a node (used when measured dimensions are unavailable)
const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 100

interface UseNodeDropOnEdgeOptions {
  getNodes: () => ReactFlowNode[]
  getEdges: () => ReactFlowEdge[]
  setEdges: (edges: ReactFlowEdge[] | ((edges: ReactFlowEdge[]) => ReactFlowEdge[])) => void
}

interface NodeDropResult {
  edge: ReactFlowEdge
  newEdges: ReactFlowEdge[]
}

// Get the center position of a node
function getNodeCenter(node: ReactFlowNode): XYPosition {
  const width = node.measured?.width ?? DEFAULT_NODE_WIDTH
  const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  }
}

// Calculate the distance from a point to a line segment
// This is used to determine if a node is close enough to an edge
function pointToLineDistance(
  point: XYPosition,
  lineStart: XYPosition,
  lineEnd: XYPosition
): number {
  const A = point.x - lineStart.x
  const B = point.y - lineStart.y
  const C = lineEnd.x - lineStart.x
  const D = lineEnd.y - lineStart.y

  const dot = A * C + B * D
  const lenSq = C * C + D * D
  let param = -1

  if (lenSq !== 0) {
    param = dot / lenSq
  }

  let xx: number
  let yy: number

  if (param < 0) {
    xx = lineStart.x
    yy = lineStart.y
  } else if (param > 1) {
    xx = lineEnd.x
    yy = lineEnd.y
  } else {
    xx = lineStart.x + param * C
    yy = lineStart.y + param * D
  }

  const dx = point.x - xx
  const dy = point.y - yy

  return Math.sqrt(dx * dx + dy * dy)
}

// Find the first matching input/output pair between two operators
function findMatchingFields(
  sourceOp: Operator<IOperator>,
  targetOp: Operator<IOperator>
): { sourceHandle: string; targetHandle: string } | null {
  // Try to find a compatible output from source that can connect to an input on target
  for (const [outputKey, outputField] of Object.entries(sourceOp.outputs)) {
    for (const [inputKey, inputField] of Object.entries(targetOp.inputs)) {
      if (canConnect(outputField, inputField)) {
        return {
          sourceHandle: `out.${outputKey}`,
          targetHandle: `par.${inputKey}`,
        }
      }
    }
  }
  return null
}

// Check if we can insert a node into an edge by finding compatible field pairs
function canInsertNode(
  edge: ReactFlowEdge,
  droppedNodeId: string
): {
  canInsert: boolean
  sourceToDropped: { sourceHandle: string; targetHandle: string } | null
  droppedToTarget: { sourceHandle: string; targetHandle: string } | null
} {
  const sourceOp = getOp(edge.source)
  const targetOp = getOp(edge.target)
  const droppedOp = getOp(droppedNodeId)

  if (!sourceOp || !targetOp || !droppedOp) {
    return { canInsert: false, sourceToDropped: null, droppedToTarget: null }
  }

  // Parse the original edge's handles to understand the field types involved
  const sourceHandleInfo = parseHandleId(edge.sourceHandle || '')
  const targetHandleInfo = parseHandleId(edge.targetHandle || '')

  if (!sourceHandleInfo || !targetHandleInfo) {
    return { canInsert: false, sourceToDropped: null, droppedToTarget: null }
  }

  const originalSourceField = sourceOp.outputs[sourceHandleInfo.fieldName]
  const originalTargetField = targetOp.inputs[targetHandleInfo.fieldName]

  if (!originalSourceField || !originalTargetField) {
    return { canInsert: false, sourceToDropped: null, droppedToTarget: null }
  }

  // Strategy 1: Try to match the exact field types from the original edge
  // Look for an input on the dropped node that can accept the source field's type
  let sourceToDropped: { sourceHandle: string; targetHandle: string } | null = null
  let droppedToTarget: { sourceHandle: string; targetHandle: string } | null = null

  // Find an input on the dropped node that's compatible with the original source
  for (const [inputKey, inputField] of Object.entries(droppedOp.inputs)) {
    if (canConnect(originalSourceField, inputField)) {
      sourceToDropped = {
        sourceHandle: edge.sourceHandle!,
        targetHandle: `par.${inputKey}`,
      }
      break
    }
  }

  // Find an output on the dropped node that's compatible with the original target
  for (const [outputKey, outputField] of Object.entries(droppedOp.outputs)) {
    if (canConnect(outputField, originalTargetField)) {
      droppedToTarget = {
        sourceHandle: `out.${outputKey}`,
        targetHandle: edge.targetHandle!,
      }
      break
    }
  }

  // If we found both connections, we can insert
  if (sourceToDropped && droppedToTarget) {
    return { canInsert: true, sourceToDropped, droppedToTarget }
  }

  // Strategy 2: Fall back to finding any matching fields
  sourceToDropped = findMatchingFields(sourceOp, droppedOp)
  droppedToTarget = findMatchingFields(droppedOp, targetOp)

  return {
    canInsert: Boolean(sourceToDropped && droppedToTarget),
    sourceToDropped,
    droppedToTarget,
  }
}

export function useNodeDropOnEdge(options: UseNodeDropOnEdgeOptions) {
  const { getNodes, getEdges, setEdges } = options

  // Find the edge closest to the dropped node, if within threshold
  const findEdgeAtPosition = useCallback(
    (nodeId: string, nodeCenter: XYPosition): ReactFlowEdge | null => {
      const nodes = getNodes()
      const edges = getEdges()

      let closestEdge: ReactFlowEdge | null = null
      let closestDistance = EDGE_DROP_THRESHOLD

      for (const edge of edges) {
        // Skip edges that are already connected to this node
        if (edge.source === nodeId || edge.target === nodeId) {
          continue
        }

        const sourceNode = nodes.find(n => n.id === edge.source)
        const targetNode = nodes.find(n => n.id === edge.target)

        if (!sourceNode || !targetNode) {
          continue
        }

        // Get the center positions of source and target nodes
        const sourceCenter = getNodeCenter(sourceNode)
        const targetCenter = getNodeCenter(targetNode)

        // Calculate distance from the dropped node's center to the edge line
        const distance = pointToLineDistance(nodeCenter, sourceCenter, targetCenter)

        if (distance < closestDistance) {
          closestDistance = distance
          closestEdge = edge
        }
      }

      return closestEdge
    },
    [getNodes, getEdges]
  )

  // Handle the node drop and potentially insert it into an edge
  const handleNodeDropOnEdge = useCallback(
    (node: ReactFlowNode): NodeDropResult | null => {
      const nodeCenter = getNodeCenter(node)
      const edge = findEdgeAtPosition(node.id, nodeCenter)

      if (!edge) {
        return null
      }

      // Check if we can insert this node into the edge
      const { canInsert, sourceToDropped, droppedToTarget } = canInsertNode(edge, node.id)

      if (!canInsert || !sourceToDropped || !droppedToTarget) {
        return null
      }

      // Create the two new edges
      const newEdge1: ReactFlowEdge = {
        id: edgeId({
          source: edge.source,
          sourceHandle: sourceToDropped.sourceHandle,
          target: node.id,
          targetHandle: sourceToDropped.targetHandle,
        }),
        source: edge.source,
        sourceHandle: sourceToDropped.sourceHandle,
        target: node.id,
        targetHandle: sourceToDropped.targetHandle,
      }

      const newEdge2: ReactFlowEdge = {
        id: edgeId({
          source: node.id,
          sourceHandle: droppedToTarget.sourceHandle,
          target: edge.target,
          targetHandle: droppedToTarget.targetHandle,
        }),
        source: node.id,
        sourceHandle: droppedToTarget.sourceHandle,
        target: edge.target,
        targetHandle: droppedToTarget.targetHandle,
      }

      // Remove the old edge and add the new ones
      setEdges(currentEdges => {
        const filteredEdges = currentEdges.filter(e => e.id !== edge.id)
        return [...filteredEdges, newEdge1, newEdge2]
      })

      // Track this action for analytics
      analytics.track('node_inserted_on_edge', {
        nodeType: node.type || 'unknown',
        sourceNode: edge.source,
        targetNode: edge.target,
      })

      return {
        edge,
        newEdges: [newEdge1, newEdge2],
      }
    },
    [findEdgeAtPosition, setEdges]
  )

  // Callback to be used with ReactFlow's onNodeDragStop
  // Returns the result of the drop operation (or null if no insertion happened)
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: ReactFlowNode): NodeDropResult | null => {
      return handleNodeDropOnEdge(node)
    },
    [handleNodeDropOnEdge]
  )

  return {
    onNodeDragStop,
    handleNodeDropOnEdge,
    findEdgeAtPosition,
  }
}
