import type { Node as ReactFlowNode } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import {
  calculateViewerPosition,
  DEFAULT_NODE_WIDTH,
  getAbsolutePosition,
  getNodeWidth,
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
  })
})
