import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { calculateGroupBoundsFromChildren } from './group-utils'

// Helper to create a mock node with position and measured dimensions
function createMockNode(
  id: string,
  parentId: string | undefined,
  position: { x: number; y: number },
  measured?: { width: number; height: number }
): Node {
  return {
    id,
    type: 'TestNode',
    position,
    parentId,
    measured,
    data: {},
  }
}

describe('calculateGroupBoundsFromChildren', () => {
  describe('basic bounds calculation', () => {
    it('calculates bounds for a single child', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child', groupId, { x: 50, y: 50 }, { width: 100, height: 60 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)

      // Content: x=50 to x=150, y=50 to y=110
      // With default padding (40): width = 150 + 80 = 230, height = 110 + 80 = 190
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(230)
      expect(bounds!.height).toBe(190)
    })

    it('calculates bounds for multiple children', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child1', groupId, { x: 0, y: 100 }, { width: 150, height: 80 }),
        createMockNode('/child2', groupId, { x: 900, y: 100 }, { width: 150, height: 80 }),
        createMockNode('/child3', groupId, { x: 450, y: 250 }, { width: 100, height: 50 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)

      // Content spans: x=0 to x=1050 (900+150), y=100 to y=300 (250+50)
      // With padding: width = 1050 + 80 = 1130, height = 300 + 80 = 380
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(1130)
      expect(bounds!.height).toBe(380)
    })
  })

  describe('edge cases', () => {
    it('returns null when there are no children', () => {
      const groupId = '/group'
      const nodes: Node[] = [{ id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} }]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)
      expect(bounds).toBeNull()
    })

    it('returns null when children have no measured dimensions', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child', groupId, { x: 50, y: 50 }, undefined),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)
      expect(bounds).toBeNull()
    })

    it('ignores children without measured dimensions', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child1', groupId, { x: 50, y: 50 }, { width: 100, height: 60 }),
        createMockNode('/child2', groupId, { x: 1000, y: 1000 }, undefined), // No measured
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)

      // Should only consider child1
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(230) // Same as single child test
      expect(bounds!.height).toBe(190)
    })

    it('ignores nodes that are not children of the group', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child', groupId, { x: 50, y: 50 }, { width: 100, height: 60 }),
        createMockNode(
          '/other',
          '/different-group',
          { x: 1000, y: 1000 },
          { width: 500, height: 500 }
        ),
        createMockNode('/root', undefined, { x: 2000, y: 2000 }, { width: 200, height: 200 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)

      // Should only consider the child of this group
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(230)
      expect(bounds!.height).toBe(190)
    })

    it('handles children with negative positions', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child1', groupId, { x: -50, y: -30 }, { width: 100, height: 60 }),
        createMockNode('/child2', groupId, { x: 50, y: 50 }, { width: 100, height: 60 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)

      // Children span from x=-50 to x=150, y=-30 to y=110
      // Content width = 150 - (-50) = 200, content height = 110 - (-30) = 140
      // With padding (40): width = 200 + 80 = 280, height = 140 + 80 = 220
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(280)
      expect(bounds!.height).toBe(220)
    })
  })

  describe('minimum dimensions', () => {
    it('enforces minimum width', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child', groupId, { x: 0, y: 0 }, { width: 50, height: 50 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)

      // Content: 50x50, with padding: 130x130
      // But minimum width is 200
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(200)
      expect(bounds!.height).toBe(130)
    })

    it('enforces minimum height', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child', groupId, { x: 0, y: 0 }, { width: 200, height: 10 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)

      // Content: 200x10, with padding: 280x90
      // But minimum height is 100
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(280)
      expect(bounds!.height).toBe(100)
    })

    it('uses custom minimum dimensions when provided', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child', groupId, { x: 0, y: 0 }, { width: 10, height: 10 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes, {
        minWidth: 500,
        minHeight: 300,
      })

      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(500)
      expect(bounds!.height).toBe(300)
    })
  })

  describe('custom padding', () => {
    it('uses custom padding when provided', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child', groupId, { x: 50, y: 50 }, { width: 100, height: 60 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes, { padding: 20 })

      // Content: x=50 to x=150, y=50 to y=110
      // With padding 20: width = 150 + 40 = 190, height = 110 + 40 = 150
      // But min height is 100, and actual is 150 so no change
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(200) // min width
      expect(bounds!.height).toBe(150)
    })

    it('uses zero padding when specified', () => {
      const groupId = '/group'
      const nodes: Node[] = [
        { id: groupId, type: 'group', position: { x: 0, y: 0 }, data: {} },
        createMockNode('/child', groupId, { x: 50, y: 50 }, { width: 100, height: 60 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes, { padding: 0 })

      // Content: x=50 to x=150, y=50 to y=110
      // No padding: width = 150, height = 110
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(200) // min width
      expect(bounds!.height).toBe(110)
    })
  })

  describe('ForLoop-like scenario', () => {
    it('calculates bounds for typical ForLoop structure', () => {
      const groupId = '/for-loop-body'
      const nodes: Node[] = [
        {
          id: groupId,
          type: 'group',
          position: { x: 100, y: 100 },
          style: { width: 1200, height: 400 },
          data: {},
        },
        // ForLoopBeginOp at relative position (0, 100)
        createMockNode('/for-loop-begin', groupId, { x: 0, y: 100 }, { width: 150, height: 100 }),
        // ForLoopEndOp at relative position (900, 100)
        createMockNode('/for-loop-end', groupId, { x: 900, y: 100 }, { width: 150, height: 100 }),
        // ForLoopMetaOp at relative position (450, 250)
        createMockNode('/for-loop-meta', groupId, { x: 450, y: 250 }, { width: 120, height: 80 }),
      ]

      const bounds = calculateGroupBoundsFromChildren(groupId, nodes)

      // Content spans:
      // x: 0 to 1050 (900 + 150)
      // y: 100 to 330 (250 + 80)
      // With padding (40): width = 1050 + 80 = 1130, height = 330 + 80 = 410
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBe(1130)
      expect(bounds!.height).toBe(410)
    })
  })
})
