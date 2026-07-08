import type { Node as ReactFlowNode } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import {
  calculateViewerPosition,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  getAbsolutePosition,
  getNodeHeight,
  getNodeWidth,
  positionCollidesWithNodes,
  rectanglesOverlap,
  VIEWER_GAP,
} from './viewer-position'

describe('viewer-position', () => {
  describe('getNodeWidth', () => {
    it('returns measured width when available', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
        measured: { width: 300, height: 150 },
      } as ReactFlowNode

      expect(getNodeWidth(node)).toBe(300)
    })

    it('falls back to width property when measured is not available', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
        width: 250,
      } as ReactFlowNode

      expect(getNodeWidth(node)).toBe(250)
    })

    it('prefers measured width over width property', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
        width: 250,
        measured: { width: 300, height: 150 },
      } as ReactFlowNode

      expect(getNodeWidth(node)).toBe(300)
    })

    it('returns default width when neither measured nor width is available', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
      } as ReactFlowNode

      expect(getNodeWidth(node)).toBe(DEFAULT_NODE_WIDTH)
    })

    it('returns default width for zero measured width to prevent overlap', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
        measured: { width: 0, height: 150 },
      } as ReactFlowNode

      // Zero width falls back to default to prevent viewer overlap
      expect(getNodeWidth(node)).toBe(DEFAULT_NODE_WIDTH)
    })
  })

  describe('getNodeHeight', () => {
    it('returns measured height when available', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
        measured: { width: 300, height: 150 },
      } as ReactFlowNode

      expect(getNodeHeight(node)).toBe(150)
    })

    it('falls back to height property when measured is not available', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
        height: 180,
      } as ReactFlowNode

      expect(getNodeHeight(node)).toBe(180)
    })

    it('returns default height when neither measured nor height is available', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
      } as ReactFlowNode

      expect(getNodeHeight(node)).toBe(DEFAULT_NODE_HEIGHT)
    })

    it('returns default height for zero measured height', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
        measured: { width: 200, height: 0 },
      } as ReactFlowNode

      expect(getNodeHeight(node)).toBe(DEFAULT_NODE_HEIGHT)
    })
  })

  describe('getAbsolutePosition', () => {
    it('returns position directly for nodes without parentId', () => {
      const node = {
        id: '/test',
        position: { x: 100, y: 200 },
      } as ReactFlowNode

      const position = getAbsolutePosition(node, [node])

      expect(position.x).toBe(100)
      expect(position.y).toBe(200)
    })

    it('sums parent position for nodes with parentId', () => {
      const parentNode = {
        id: '/for-loop-body',
        type: 'group',
        position: { x: 500, y: 300 },
      } as ReactFlowNode

      const childNode = {
        id: '/for-loop-begin',
        position: { x: 0, y: 100 },
        parentId: '/for-loop-body',
      } as ReactFlowNode

      const nodes = [parentNode, childNode]
      const position = getAbsolutePosition(childNode, nodes)

      expect(position.x).toBe(500 + 0) // parent.x + child.x
      expect(position.y).toBe(300 + 100) // parent.y + child.y
    })

    it('handles nested containers (multi-level parentId)', () => {
      const grandparentNode = {
        id: '/outer-container',
        type: 'group',
        position: { x: 100, y: 50 },
      } as ReactFlowNode

      const parentNode = {
        id: '/for-loop-body',
        type: 'group',
        position: { x: 200, y: 100 },
        parentId: '/outer-container',
      } as ReactFlowNode

      const childNode = {
        id: '/for-loop-begin',
        position: { x: 10, y: 20 },
        parentId: '/for-loop-body',
      } as ReactFlowNode

      const nodes = [grandparentNode, parentNode, childNode]
      const position = getAbsolutePosition(childNode, nodes)

      // 100 + 200 + 10 = 310
      expect(position.x).toBe(310)
      // 50 + 100 + 20 = 170
      expect(position.y).toBe(170)
    })

    it('handles missing parent gracefully', () => {
      const childNode = {
        id: '/orphan',
        position: { x: 50, y: 75 },
        parentId: '/non-existent-parent',
      } as ReactFlowNode

      const position = getAbsolutePosition(childNode, [childNode])

      // Should return the node's own position when parent not found
      expect(position.x).toBe(50)
      expect(position.y).toBe(75)
    })
  })

  describe('rectanglesOverlap', () => {
    it('returns true for overlapping rectangles', () => {
      const rect1 = { x: 0, y: 0, width: 100, height: 100 }
      const rect2 = { x: 50, y: 50, width: 100, height: 100 }
      expect(rectanglesOverlap(rect1, rect2)).toBe(true)
    })

    it('returns false for non-overlapping rectangles (horizontally separated)', () => {
      const rect1 = { x: 0, y: 0, width: 100, height: 100 }
      const rect2 = { x: 150, y: 0, width: 100, height: 100 }
      expect(rectanglesOverlap(rect1, rect2)).toBe(false)
    })

    it('returns false for non-overlapping rectangles (vertically separated)', () => {
      const rect1 = { x: 0, y: 0, width: 100, height: 100 }
      const rect2 = { x: 0, y: 150, width: 100, height: 100 }
      expect(rectanglesOverlap(rect1, rect2)).toBe(false)
    })

    it('returns false for rectangles that touch but do not overlap', () => {
      const rect1 = { x: 0, y: 0, width: 100, height: 100 }
      const rect2 = { x: 100, y: 0, width: 100, height: 100 }
      expect(rectanglesOverlap(rect1, rect2)).toBe(false)
    })

    it('returns true when one rectangle contains another', () => {
      const rect1 = { x: 0, y: 0, width: 200, height: 200 }
      const rect2 = { x: 50, y: 50, width: 50, height: 50 }
      expect(rectanglesOverlap(rect1, rect2)).toBe(true)
    })

    it('returns true for rectangles with partial horizontal overlap', () => {
      const rect1 = { x: 0, y: 0, width: 100, height: 100 }
      const rect2 = { x: 50, y: 0, width: 100, height: 100 }
      expect(rectanglesOverlap(rect1, rect2)).toBe(true)
    })

    it('returns true for rectangles with partial vertical overlap', () => {
      const rect1 = { x: 0, y: 0, width: 100, height: 100 }
      const rect2 = { x: 0, y: 50, width: 100, height: 100 }
      expect(rectanglesOverlap(rect1, rect2)).toBe(true)
    })
  })

  describe('positionCollidesWithNodes', () => {
    it('returns true when position overlaps with an existing node', () => {
      const nodes = [
        {
          id: '/existing',
          position: { x: 400, y: 200 },
          measured: { width: 200, height: 100 },
        } as ReactFlowNode,
      ]

      // Position that would overlap with existing node
      const collides = positionCollidesWithNodes({ x: 350, y: 150 }, 200, 100, nodes)
      expect(collides).toBe(true)
    })

    it('returns false when position does not overlap with any node', () => {
      const nodes = [
        {
          id: '/existing',
          position: { x: 0, y: 0 },
          measured: { width: 200, height: 100 },
        } as ReactFlowNode,
      ]

      const collides = positionCollidesWithNodes({ x: 500, y: 0 }, 200, 100, nodes)
      expect(collides).toBe(false)
    })

    it('excludes specified node from collision check', () => {
      const nodes = [
        {
          id: '/source',
          position: { x: 0, y: 0 },
          measured: { width: 200, height: 100 },
        } as ReactFlowNode,
      ]

      // Position overlaps, but we exclude the node
      const collides = positionCollidesWithNodes({ x: 50, y: 50 }, 200, 100, nodes, '/source')
      expect(collides).toBe(false)
    })

    it('ignores group nodes (containers)', () => {
      const nodes = [
        {
          id: '/container',
          type: 'group',
          position: { x: 0, y: 0 },
          style: { width: 1200, height: 400 },
        } as ReactFlowNode,
      ]

      const collides = positionCollidesWithNodes({ x: 100, y: 100 }, 200, 100, nodes)
      expect(collides).toBe(false)
    })

    it('handles nodes inside containers using absolute positions', () => {
      const parentNode = {
        id: '/container',
        type: 'group',
        position: { x: 500, y: 300 },
      } as ReactFlowNode

      const childNode = {
        id: '/child',
        position: { x: 0, y: 0 }, // Relative position
        parentId: '/container',
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const nodes = [parentNode, childNode]

      // Should collide because child's absolute position is (500, 300)
      const collides = positionCollidesWithNodes({ x: 450, y: 250 }, 200, 100, nodes)
      expect(collides).toBe(true)

      // Should not collide - far from absolute position
      const doesNotCollide = positionCollidesWithNodes({ x: 0, y: 0 }, 200, 100, nodes)
      expect(doesNotCollide).toBe(false)
    })

    it('returns false for empty nodes array', () => {
      const collides = positionCollidesWithNodes({ x: 100, y: 100 }, 200, 100, [])
      expect(collides).toBe(false)
    })
  })

  describe('calculateViewerPosition', () => {
    it('positions viewer to the right of source node with measured width', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 100, y: 200 },
        measured: { width: 300, height: 150 },
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode, [sourceNode])

      expect(position.x).toBe(100 + 300 + VIEWER_GAP) // 450
      expect(position.y).toBe(200)
    })

    it('positions viewer using width property when measured is not available', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 50, y: 100 },
        width: 250,
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode, [sourceNode])

      expect(position.x).toBe(50 + 250 + VIEWER_GAP) // 350
      expect(position.y).toBe(100)
    })

    it('positions viewer using default width when node has no width info', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 0, y: 0 },
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode, [sourceNode])

      expect(position.x).toBe(DEFAULT_NODE_WIDTH + VIEWER_GAP) // 250
      expect(position.y).toBe(0)
    })

    it('handles negative positions', () => {
      const sourceNode = {
        id: '/source',
        position: { x: -500, y: -300 },
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode, [sourceNode])

      expect(position.x).toBe(-500 + 200 + VIEWER_GAP) // -250
      expect(position.y).toBe(-300)
    })

    it('preserves y position exactly', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 100, y: 456.789 },
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode, [sourceNode])

      expect(position.y).toBe(456.789)
    })

    it('uses absolute position for nodes inside containers', () => {
      const parentNode = {
        id: '/for-loop-body',
        type: 'group',
        position: { x: 500, y: 300 },
      } as ReactFlowNode

      const childNode = {
        id: '/for-loop-begin',
        position: { x: 0, y: 100 },
        parentId: '/for-loop-body',
        measured: { width: 200, height: 150 },
      } as ReactFlowNode

      const nodes = [parentNode, childNode]
      const position = calculateViewerPosition(childNode, nodes)

      // Absolute x = 500 + 0 = 500, then + 200 + 50 = 750
      expect(position.x).toBe(500 + 0 + 200 + VIEWER_GAP)
      // Absolute y = 300 + 100 = 400
      expect(position.y).toBe(400)
    })

    it('moves viewer down when initial position collides with existing node', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 100, y: 200 },
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const blockingNode = {
        id: '/blocking',
        position: { x: 350, y: 200 }, // Right where viewer would go
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const nodes = [sourceNode, blockingNode]
      const position = calculateViewerPosition(sourceNode, nodes)

      // Should have moved down by VERTICAL_STEP (120)
      expect(position.x).toBe(100 + 200 + VIEWER_GAP)
      expect(position.y).toBe(200 + 120)
    })

    it('continues moving down until non-colliding position found', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 100, y: 200 },
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      // Two blocking nodes stacked vertically
      const blockingNode1 = {
        id: '/blocking1',
        position: { x: 350, y: 200 },
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const blockingNode2 = {
        id: '/blocking2',
        position: { x: 350, y: 320 }, // 200 + 120 = 320
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const nodes = [sourceNode, blockingNode1, blockingNode2]
      const position = calculateViewerPosition(sourceNode, nodes)

      // Should skip both blocking nodes
      expect(position.x).toBe(100 + 200 + VIEWER_GAP)
      expect(position.y).toBe(200 + 240) // Two steps down: 200 + 2*120 = 440
    })

    it('returns initial position when no collision', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 100, y: 200 },
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const farNode = {
        id: '/far',
        position: { x: 1000, y: 1000 }, // Far away
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const nodes = [sourceNode, farNode]
      const position = calculateViewerPosition(sourceNode, nodes)

      // Initial position should work
      expect(position.x).toBe(100 + 200 + VIEWER_GAP)
      expect(position.y).toBe(200)
    })
  })
})
