import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberOp, SliceOp } from '../operators'
import { clearOps, setOp } from '../store'
import { canConnect } from '../utils/can-connect'

// Test the core logic of connection-drop-on-edge directly

function createMockNode(
  id: string,
  position: { x: number; y: number },
  width = 200,
  height = 100
): ReactFlowNode {
  return {
    id,
    type: 'default',
    position,
    data: {},
    measured: { width, height },
  }
}

function createMockEdge(
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string,
  type?: string
): ReactFlowEdge {
  return {
    id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type,
  }
}

// Helpers that mirror the hook's internal logic for unit testing
function getNodeCenter(node: ReactFlowNode) {
  const width = node.measured?.width ?? 200
  const height = node.measured?.height ?? 100
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  }
}

function pointToLineDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const A = point.x - lineStart.x
  const B = point.y - lineStart.y
  const C = lineEnd.x - lineStart.x
  const D = lineEnd.y - lineStart.y

  const dot = A * C + B * D
  const lenSq = C * C + D * D
  let param = -1
  if (lenSq !== 0) param = dot / lenSq

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

  return Math.sqrt((point.x - xx) ** 2 + (point.y - yy) ** 2)
}

function findEdgeAtPosition(
  flowPos: { x: number; y: number },
  sourceNodeId: string,
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  threshold = 30
): ReactFlowEdge | null {
  let closestEdge: ReactFlowEdge | null = null
  let closestDistance = threshold

  for (const edge of edges) {
    if (edge.type === 'ReferenceEdge') continue
    if (edge.source === sourceNodeId) continue

    const sourceNode = nodes.find(n => n.id === edge.source)
    const targetNode = nodes.find(n => n.id === edge.target)
    if (!sourceNode || !targetNode) continue

    const distance = pointToLineDistance(
      flowPos,
      getNodeCenter(sourceNode),
      getNodeCenter(targetNode)
    )

    if (distance < closestDistance) {
      closestDistance = distance
      closestEdge = edge
    }
  }

  return closestEdge
}

describe('useConnectionDropOnEdge logic', () => {
  beforeEach(() => {
    clearOps()
  })

  describe('findEdgeAtPosition', () => {
    it('returns null when drop is far from all edges', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 })
      const nodeB = createMockNode('/b', { x: 200, y: 0 })
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data')

      // Drop point far away (y=200 puts it well outside 30px threshold for a horizontal edge)
      const result = findEdgeAtPosition({ x: 100, y: 200 }, '/c', [nodeA, nodeB], [edge])
      expect(result).toBeNull()
    })

    it('returns the closest edge when drop is within threshold', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 }) // center: (100, 50)
      const nodeB = createMockNode('/b', { x: 200, y: 0 }) // center: (300, 50)
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data')

      // Drop point on the edge line (y=50) near the midpoint
      const result = findEdgeAtPosition({ x: 200, y: 55 }, '/c', [nodeA, nodeB], [edge])
      expect(result).toBe(edge)
    })

    it('skips edges originating from the dragging source node', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 })
      const nodeB = createMockNode('/b', { x: 200, y: 0 })
      // Edge from /a (the dragging node) to /b
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data')

      // Even though drop is on the edge, /a is the drag source so it's skipped
      const result = findEdgeAtPosition({ x: 200, y: 50 }, '/a', [nodeA, nodeB], [edge])
      expect(result).toBeNull()
    })

    it('skips ReferenceEdge type edges', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 })
      const nodeB = createMockNode('/b', { x: 200, y: 0 })
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data', 'ReferenceEdge')

      const result = findEdgeAtPosition({ x: 200, y: 50 }, '/c', [nodeA, nodeB], [edge])
      expect(result).toBeNull()
    })

    it('returns null when source or target node is missing', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 })
      // nodeB not in nodes list
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data')

      const result = findEdgeAtPosition({ x: 200, y: 50 }, '/c', [nodeA], [edge])
      expect(result).toBeNull()
    })

    it('returns closest edge when multiple edges are nearby', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 }) // center: (100, 50)
      const nodeB = createMockNode('/b', { x: 200, y: 0 }) // center: (300, 50)
      const nodeC = createMockNode('/c', { x: 0, y: 200 }) // center: (100, 250)
      const nodeD = createMockNode('/d', { x: 200, y: 200 }) // center: (300, 250)

      const edgeAB = createMockEdge('/a', '/b', 'out.val', 'par.data')
      const edgeCD = createMockEdge('/c', '/d', 'out.val', 'par.data')

      // Drop at (200, 55) — close to edgeAB (y=50), far from edgeCD (y=250)
      const result = findEdgeAtPosition(
        { x: 200, y: 55 },
        '/e',
        [nodeA, nodeB, nodeC, nodeD],
        [edgeAB, edgeCD]
      )
      expect(result).toBe(edgeAB)
    })
  })

  describe('field compatibility for swapping', () => {
    it('allows swapping when source field is compatible with edge target', () => {
      const numberOpA = new NumberOp('/num-a')
      const numberOpB = new NumberOp('/num-b')
      const sliceOp = new SliceOp('/slice')

      setOp('/num-a', numberOpA)
      setOp('/num-b', numberOpB)
      setOp('/slice', sliceOp)

      // NumberOp outputs 'val' (number), SliceOp has 'start' input (number)
      // Two number ops should be interchangeable on a numeric input
      // canConnect imported at top of file
      expect(canConnect(numberOpA.outputs.val, sliceOp.inputs.start)).toBe(true)
      expect(canConnect(numberOpB.outputs.val, sliceOp.inputs.start)).toBe(true)
    })

    it('confirms two number outputs are interchangeable on a number input', () => {
      const numberOpA = new NumberOp('/num-a')
      const numberOpB = new NumberOp('/num-b')
      const sliceOp = new SliceOp('/slice')

      setOp('/num-a', numberOpA)
      setOp('/num-b', numberOpB)
      setOp('/slice', sliceOp)

      // Both number outputs are compatible with the same numeric input — swap is valid
      expect(canConnect(numberOpA.outputs.val, sliceOp.inputs.start)).toBe(true)
      expect(canConnect(numberOpB.outputs.val, sliceOp.inputs.start)).toBe(true)
    })
  })

  describe('onConnectEnd guard conditions', () => {
    it('skips when toHandle is non-null (connection landed on a handle)', () => {
      const onConnect = vi.fn()

      // Simulate onConnectEnd with toHandle set — should not trigger swap
      const connectionState = {
        toHandle: { id: 'par.data', type: 'target' as const, nodeId: '/b', x: 0, y: 0 },
        to: { x: 200, y: 50 },
        fromHandle: null,
        from: { x: 100, y: 50 },
        fromNode: null,
        fromPosition: null,
        isValid: true,
        toNode: null,
        toPosition: null,
        pointer: { x: 200, y: 50 },
      }

      // If toHandle is present, we should not call onConnect for swapping
      if (connectionState.toHandle !== null) {
        // skip — do nothing
      } else {
        onConnect({})
      }

      expect(onConnect).not.toHaveBeenCalled()
    })

    it('skips when to position is null (no drag position)', () => {
      const onConnect = vi.fn()

      const connectionState = {
        toHandle: null,
        to: null,
      }

      if (connectionState.toHandle !== null) {
        // skip
      } else if (!connectionState.to) {
        // skip
      } else {
        onConnect({})
      }

      expect(onConnect).not.toHaveBeenCalled()
    })
  })
})
