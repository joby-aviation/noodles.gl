// Shared geometry utilities for edge hit-testing

import type { Node as ReactFlowNode, XYPosition } from '@xyflow/react'

const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 100

export function getNodeCenter(node: ReactFlowNode): XYPosition {
  const width = node.measured?.width ?? DEFAULT_NODE_WIDTH
  const height = node.measured?.height ?? DEFAULT_NODE_HEIGHT
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  }
}

export function pointToLineDistance(
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
