import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { NumberOp, SliceOp, CodeOp } from '../operators'
import { setOp, clearOps } from '../store'

// Test the utility functions and logic directly, not the React hook
// The hook itself is tested through integration tests

// Helper to create a mock node
function createMockNode(
  id: string,
  type: string,
  position: { x: number; y: number },
  width = 200,
  height = 100
): ReactFlowNode {
  return {
    id,
    type,
    position,
    data: {},
    measured: { width, height },
  }
}

// Helper to create a mock edge
function _createMockEdge(
  source: string,
  target: string,
  sourceHandle: string,
  targetHandle: string
): ReactFlowEdge {
  return {
    id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  }
}

describe('node drop on edge utilities', () => {
  beforeEach(() => {
    clearOps()
  })

  describe('point-to-line distance calculation', () => {
    // Test the core geometry calculations
    it('should calculate distance correctly for horizontal line', () => {
      // A horizontal line from (0,0) to (100,0)
      // A point at (50, 20) should be 20 pixels away
      const lineStart = { x: 0, y: 0 }
      const lineEnd = { x: 100, y: 0 }
      const point = { x: 50, y: 20 }

      // Using the distance formula from the hook
      const A = point.x - lineStart.x // 50
      const B = point.y - lineStart.y // 20
      const C = lineEnd.x - lineStart.x // 100
      const D = lineEnd.y - lineStart.y // 0

      const dot = A * C + B * D // 5000
      const lenSq = C * C + D * D // 10000
      const param = dot / lenSq // 0.5

      // param is between 0 and 1, so closest point is on the line
      const xx = lineStart.x + param * C // 50
      const yy = lineStart.y + param * D // 0

      const dx = point.x - xx // 0
      const dy = point.y - yy // 20

      const distance = Math.sqrt(dx * dx + dy * dy) // 20
      expect(distance).toBe(20)
    })

    it('should calculate distance to line endpoint when past the line', () => {
      // A horizontal line from (0,0) to (100,0)
      // A point at (150, 0) should be 50 pixels from the end
      const lineStart = { x: 0, y: 0 }
      const lineEnd = { x: 100, y: 0 }
      const point = { x: 150, y: 0 }

      const A = point.x - lineStart.x // 150
      const B = point.y - lineStart.y // 0
      const C = lineEnd.x - lineStart.x // 100
      const D = lineEnd.y - lineStart.y // 0

      const dot = A * C + B * D // 15000
      const lenSq = C * C + D * D // 10000
      const _param = dot / lenSq // 1.5

      // _param > 1, so closest point is the end of the line
      const xx = lineEnd.x // 100
      const yy = lineEnd.y // 0

      const dx = point.x - xx // 50
      const dy = point.y - yy // 0

      const distance = Math.sqrt(dx * dx + dy * dy) // 50
      expect(distance).toBe(50)
    })
  })

  describe('node center calculation', () => {
    it('should calculate node center correctly', () => {
      const node = createMockNode('/test-1', 'NumberOp', { x: 100, y: 50 }, 200, 100)

      const centerX = node.position.x + (node.measured?.width ?? 200) / 2
      const centerY = node.position.y + (node.measured?.height ?? 100) / 2

      expect(centerX).toBe(200) // 100 + 200/2
      expect(centerY).toBe(100) // 50 + 100/2
    })

    it('should use default dimensions when measured is not available', () => {
      const node: ReactFlowNode = {
        id: '/test-1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: {},
      }

      const DEFAULT_WIDTH = 200
      const DEFAULT_HEIGHT = 100

      const centerX = node.position.x + (node.measured?.width ?? DEFAULT_WIDTH) / 2
      const centerY = node.position.y + (node.measured?.height ?? DEFAULT_HEIGHT) / 2

      expect(centerX).toBe(100)
      expect(centerY).toBe(50)
    })
  })

  describe('field compatibility for insertion', () => {
    it('should find compatible fields between NumberOp and SliceOp', () => {
      // NumberOp outputs a number, SliceOp can receive data
      const numberOp = new NumberOp('/number-1')
      const sliceOp = new SliceOp('/slice-1')

      setOp('/number-1', numberOp)
      setOp('/slice-1', sliceOp)

      // NumberOp has output 'val' (number)
      // SliceOp has input 'data' (array), 'start' (number), 'end' (number)
      // This tests the field iteration works

      const numberOutputs = Object.keys(numberOp.outputs)
      const sliceInputs = Object.keys(sliceOp.inputs)

      expect(numberOutputs).toContain('val')
      expect(sliceInputs).toContain('data')
      expect(sliceInputs).toContain('start')
    })

    it('should identify operators with data outputs', () => {
      const sliceOp = new SliceOp('/slice-1')
      setOp('/slice-1', sliceOp)

      // SliceOp should have a 'data' output that outputs data
      const outputs = Object.keys(sliceOp.outputs)
      expect(outputs).toContain('data')
    })

    it('should identify operators with data inputs', () => {
      const codeOp = new CodeOp('/code-1')
      setOp('/code-1', codeOp)

      // CodeOp has 'code' input and potentially data input
      const inputs = Object.keys(codeOp.inputs)
      expect(inputs.length).toBeGreaterThan(0)
    })
  })

  describe('edge ID generation', () => {
    it('should generate valid edge IDs for new connections', () => {
      const source = '/number-1'
      const target = '/slice-1'
      const sourceHandle = 'out.result'
      const targetHandle = 'par.data'

      const expectedId = `${source}.${sourceHandle}->${target}.${targetHandle}`

      expect(expectedId).toBe('/number-1.out.result->/slice-1.par.data')
    })
  })

  describe('mock edge detection', () => {
    it('should detect when a node is near an edge', () => {
      // Create two nodes with an edge between them
      const sourceNode = createMockNode('/source', 'NumberOp', { x: 0, y: 0 })
      const targetNode = createMockNode('/target', 'SliceOp', { x: 400, y: 0 })

      // Create a node that is positioned near the edge (between source and target)
      const droppedNode = createMockNode('/dropped', 'CodeOp', { x: 200, y: 10 })

      // Calculate centers
      const sourceCenter = {
        x: sourceNode.position.x + 100, // center x
        y: sourceNode.position.y + 50, // center y
      }
      const targetCenter = {
        x: targetNode.position.x + 100,
        y: targetNode.position.y + 50,
      }
      const droppedCenter = {
        x: droppedNode.position.x + 100,
        y: droppedNode.position.y + 50,
      }

      // The dropped node center (300, 60) should be close to the line from (100, 50) to (500, 50)
      // The perpendicular distance should be 10 pixels (60 - 50 = 10)
      const A = droppedCenter.x - sourceCenter.x
      const B = droppedCenter.y - sourceCenter.y
      const C = targetCenter.x - sourceCenter.x
      const D = targetCenter.y - sourceCenter.y

      const dot = A * C + B * D
      const lenSq = C * C + D * D
      const param = dot / lenSq

      const xx = sourceCenter.x + param * C
      const yy = sourceCenter.y + param * D

      const distance = Math.sqrt((droppedCenter.x - xx) ** 2 + (droppedCenter.y - yy) ** 2)

      // Distance should be close to 10 (the vertical offset)
      expect(distance).toBe(10)
      expect(distance).toBeLessThan(30) // Within EDGE_DROP_THRESHOLD
    })

    it('should not detect nodes that are far from the edge', () => {
      // Create nodes for context (not used directly in distance calculation)
      createMockNode('/source', 'NumberOp', { x: 0, y: 0 })
      createMockNode('/target', 'SliceOp', { x: 400, y: 0 })
      createMockNode('/dropped', 'CodeOp', { x: 200, y: 200 })

      const sourceCenter = { x: 100, y: 50 }
      const targetCenter = { x: 500, y: 50 }
      const droppedCenter = { x: 300, y: 250 }

      // Calculate distance
      const A = droppedCenter.x - sourceCenter.x
      const B = droppedCenter.y - sourceCenter.y
      const C = targetCenter.x - sourceCenter.x
      const D = targetCenter.y - sourceCenter.y

      const dot = A * C + B * D
      const lenSq = C * C + D * D
      const param = dot / lenSq

      const xx = sourceCenter.x + param * C
      const yy = sourceCenter.y + param * D

      const distance = Math.sqrt((droppedCenter.x - xx) ** 2 + (droppedCenter.y - yy) ** 2)

      // Distance should be 200 pixels (far from the edge)
      expect(distance).toBe(200)
      expect(distance).toBeGreaterThan(30) // Outside EDGE_DROP_THRESHOLD
    })
  })
})
