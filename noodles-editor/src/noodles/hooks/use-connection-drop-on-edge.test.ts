import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { NumberOp, SliceOp } from '../operators'
import { clearOps, setOp } from '../store'
import { canConnect } from '../utils/can-connect'
import { findEdgeAtPosition } from './use-connection-drop-on-edge'

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

describe('useConnectionDropOnEdge logic', () => {
  beforeEach(() => {
    clearOps()
  })

  describe('findEdgeAtPosition', () => {
    it('returns null when drop is far from all edges', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 })
      const nodeB = createMockNode('/b', { x: 200, y: 0 })
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data')
      const nodes = [nodeA, nodeB]
      const edges = [edge]

      const result = findEdgeAtPosition(
        { x: 100, y: 200 },
        '/c',
        () => nodes,
        () => edges
      )
      expect(result).toBeNull()
    })

    it('returns the closest edge when drop is within threshold', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 }) // center: (100, 50)
      const nodeB = createMockNode('/b', { x: 200, y: 0 }) // center: (300, 50)
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data')
      const nodes = [nodeA, nodeB]
      const edges = [edge]

      const result = findEdgeAtPosition(
        { x: 200, y: 55 },
        '/c',
        () => nodes,
        () => edges
      )
      expect(result).toBe(edge)
    })

    it('skips edges originating from the dragging source node', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 })
      const nodeB = createMockNode('/b', { x: 200, y: 0 })
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data')
      const nodes = [nodeA, nodeB]
      const edges = [edge]

      const result = findEdgeAtPosition(
        { x: 200, y: 50 },
        '/a',
        () => nodes,
        () => edges
      )
      expect(result).toBeNull()
    })

    it('skips ReferenceEdge type edges', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 })
      const nodeB = createMockNode('/b', { x: 200, y: 0 })
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data', 'ReferenceEdge')
      const nodes = [nodeA, nodeB]
      const edges = [edge]

      const result = findEdgeAtPosition(
        { x: 200, y: 50 },
        '/c',
        () => nodes,
        () => edges
      )
      expect(result).toBeNull()
    })

    it('returns null when source or target node is missing', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 })
      const edge = createMockEdge('/a', '/b', 'out.val', 'par.data')
      const nodes = [nodeA]
      const edges = [edge]

      const result = findEdgeAtPosition(
        { x: 200, y: 50 },
        '/c',
        () => nodes,
        () => edges
      )
      expect(result).toBeNull()
    })

    it('returns closest edge when multiple edges are nearby', () => {
      const nodeA = createMockNode('/a', { x: 0, y: 0 }) // center: (100, 50)
      const nodeB = createMockNode('/b', { x: 200, y: 0 }) // center: (300, 50)
      const nodeC = createMockNode('/c', { x: 0, y: 200 }) // center: (100, 250)
      const nodeD = createMockNode('/d', { x: 200, y: 200 }) // center: (300, 250)

      const edgeAB = createMockEdge('/a', '/b', 'out.val', 'par.data')
      const edgeCD = createMockEdge('/c', '/d', 'out.val', 'par.data')
      const nodes = [nodeA, nodeB, nodeC, nodeD]
      const edges = [edgeAB, edgeCD]

      const result = findEdgeAtPosition(
        { x: 200, y: 55 },
        '/e',
        () => nodes,
        () => edges
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

      expect(canConnect(numberOpA.outputs.val, sliceOp.inputs.start)).toBe(true)
      expect(canConnect(numberOpB.outputs.val, sliceOp.inputs.start)).toBe(true)
    })
  })
})
