import type { Node as ReactFlowNode } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import {
  calculateViewerPosition,
  DEFAULT_NODE_WIDTH,
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

  describe('calculateViewerPosition', () => {
    it('positions viewer to the right of source node with measured width', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 100, y: 200 },
        measured: { width: 300, height: 150 },
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode)

      expect(position.x).toBe(100 + 300 + VIEWER_GAP) // 450
      expect(position.y).toBe(200)
    })

    it('positions viewer using width property when measured is not available', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 50, y: 100 },
        width: 250,
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode)

      expect(position.x).toBe(50 + 250 + VIEWER_GAP) // 350
      expect(position.y).toBe(100)
    })

    it('positions viewer using default width when node has no width info', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 0, y: 0 },
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode)

      expect(position.x).toBe(DEFAULT_NODE_WIDTH + VIEWER_GAP) // 250
      expect(position.y).toBe(0)
    })

    it('handles negative positions', () => {
      const sourceNode = {
        id: '/source',
        position: { x: -500, y: -300 },
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode)

      expect(position.x).toBe(-500 + 200 + VIEWER_GAP) // -250
      expect(position.y).toBe(-300)
    })

    it('preserves y position exactly', () => {
      const sourceNode = {
        id: '/source',
        position: { x: 100, y: 456.789 },
        measured: { width: 200, height: 100 },
      } as ReactFlowNode

      const position = calculateViewerPosition(sourceNode)

      expect(position.y).toBe(456.789)
    })
  })
})
