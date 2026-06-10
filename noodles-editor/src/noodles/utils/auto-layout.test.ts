import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { type LayoutOptions, layoutNodes, resolveOverlaps } from './auto-layout'

const createNode = (id: string, x = 0, y = 0, width = 200, height = 100): Node => ({
  id,
  position: { x, y },
  data: {},
  measured: { width, height },
})

const createEdge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
})

describe('layoutNodes', () => {
  describe('with dagre algorithm', () => {
    const dagreOptions: LayoutOptions = {
      enabled: true,
      algorithm: 'dagre',
      direction: 'LR',
    }

    it('returns empty array for empty input', () => {
      const result = layoutNodes([], [], dagreOptions)
      expect(result).toEqual([])
    })

    it('returns single node with same position', () => {
      const nodes = [createNode('a', 100, 100)]
      const result = layoutNodes(nodes, [], dagreOptions)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('a')
    })

    it('layouts connected nodes in a line for LR direction', () => {
      const nodes = [createNode('a'), createNode('b'), createNode('c')]
      const edges = [createEdge('a', 'b'), createEdge('b', 'c')]
      const result = layoutNodes(nodes, edges, dagreOptions)

      expect(result).toHaveLength(3)

      const nodeA = result.find(n => n.id === 'a')!
      const nodeB = result.find(n => n.id === 'b')!
      const nodeC = result.find(n => n.id === 'c')!

      // In LR layout, x positions should increase from a to b to c
      expect(nodeA.position.x).toBeLessThan(nodeB.position.x)
      expect(nodeB.position.x).toBeLessThan(nodeC.position.x)
    })

    it('layouts connected nodes vertically for TB direction', () => {
      const nodes = [createNode('a'), createNode('b'), createNode('c')]
      const edges = [createEdge('a', 'b'), createEdge('b', 'c')]
      const result = layoutNodes(nodes, edges, { ...dagreOptions, direction: 'TB' })

      const nodeA = result.find(n => n.id === 'a')!
      const nodeB = result.find(n => n.id === 'b')!
      const nodeC = result.find(n => n.id === 'c')!

      // In TB layout, y positions should increase from a to b to c
      expect(nodeA.position.y).toBeLessThan(nodeB.position.y)
      expect(nodeB.position.y).toBeLessThan(nodeC.position.y)
    })

    it('handles branching graphs', () => {
      const nodes = [createNode('a'), createNode('b'), createNode('c'), createNode('d')]
      const edges = [
        createEdge('a', 'b'),
        createEdge('a', 'c'),
        createEdge('b', 'd'),
        createEdge('c', 'd'),
      ]
      const result = layoutNodes(nodes, edges, dagreOptions)

      expect(result).toHaveLength(4)

      const nodeA = result.find(n => n.id === 'a')!
      const nodeD = result.find(n => n.id === 'd')!

      // a should be leftmost, d should be rightmost
      expect(nodeA.position.x).toBeLessThan(nodeD.position.x)
    })

    it('produces non-overlapping nodes', () => {
      const nodes = [createNode('a'), createNode('b'), createNode('c')]
      const edges = [createEdge('a', 'b'), createEdge('a', 'c')]
      const result = layoutNodes(nodes, edges, dagreOptions)

      // Check no nodes overlap
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const n1 = result[i]
          const n2 = result[j]
          const w1 = n1.measured?.width ?? 200
          const h1 = n1.measured?.height ?? 100
          const w2 = n2.measured?.width ?? 200
          const h2 = n2.measured?.height ?? 100

          const xOverlap = n1.position.x < n2.position.x + w2 && n1.position.x + w1 > n2.position.x
          const yOverlap = n1.position.y < n2.position.y + h2 && n1.position.y + h1 > n2.position.y

          expect(xOverlap && yOverlap).toBe(false)
        }
      }
    })
  })

  describe('with d3-force algorithm', () => {
    const forceOptions: LayoutOptions = {
      enabled: true,
      algorithm: 'd3-force',
      direction: 'LR',
    }

    it('returns empty array for empty input', () => {
      const result = layoutNodes([], [], forceOptions)
      expect(result).toEqual([])
    })

    it('returns single node', () => {
      const nodes = [createNode('a', 100, 100)]
      const result = layoutNodes(nodes, [], forceOptions)
      expect(result).toHaveLength(1)
    })

    it('layouts connected nodes', () => {
      const nodes = [createNode('a'), createNode('b'), createNode('c')]
      const edges = [createEdge('a', 'b'), createEdge('b', 'c')]
      const result = layoutNodes(nodes, edges, forceOptions)

      expect(result).toHaveLength(3)
      // Each node should have a position
      for (const node of result) {
        expect(typeof node.position.x).toBe('number')
        expect(typeof node.position.y).toBe('number')
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      }
    })

    it('respects direction for topological ordering', () => {
      const nodes = [createNode('a'), createNode('b'), createNode('c')]
      const edges = [createEdge('a', 'b'), createEdge('b', 'c')]
      const result = layoutNodes(nodes, edges, forceOptions)

      const nodeA = result.find(n => n.id === 'a')!
      const nodeC = result.find(n => n.id === 'c')!

      // In LR layout, a should generally be left of c
      expect(nodeA.position.x).toBeLessThan(nodeC.position.x)
    })

    it('produces finite positions for disconnected nodes', () => {
      const nodes = [createNode('a'), createNode('b'), createNode('c')]
      const result = layoutNodes(nodes, [], forceOptions)

      for (const node of result) {
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      }
    })

    it('produces non-overlapping nodes', () => {
      const nodes = [createNode('a'), createNode('b'), createNode('c')]
      const edges = [createEdge('a', 'b'), createEdge('a', 'c')]
      const result = layoutNodes(nodes, edges, forceOptions)
      const margin = 50

      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const n1 = result[i]
          const n2 = result[j]
          const w1 = n1.measured?.width ?? 200
          const h1 = n1.measured?.height ?? 100
          const w2 = n2.measured?.width ?? 200
          const h2 = n2.measured?.height ?? 100

          const overlapX = Math.min(n1.position.x + w1, n2.position.x + w2) - Math.max(n1.position.x, n2.position.x) + margin
          const overlapY = Math.min(n1.position.y + h1, n2.position.y + h2) - Math.max(n1.position.y, n2.position.y) + margin

          expect(overlapX > 0 && overlapY > 0).toBe(false)
        }
      }
    })
  })
})

describe('resolveOverlaps', () => {
  it('returns single node unchanged', () => {
    const nodes = [createNode('a', 10, 20)]
    const result = resolveOverlaps(nodes, 50)
    expect(result).toHaveLength(1)
    expect(result[0].position).toEqual({ x: 10, y: 20 })
  })

  it('returns empty array unchanged', () => {
    expect(resolveOverlaps([], 50)).toEqual([])
  })

  it('returns unchanged nodes when no overlap', () => {
    // nodes are 200x100, placed 400px apart — clearly separated
    const nodes = [createNode('a', 0, 0), createNode('b', 400, 0)]
    const result = resolveOverlaps(nodes, 50)
    expect(result.find(n => n.id === 'a')!.position).toEqual({ x: 0, y: 0 })
    expect(result.find(n => n.id === 'b')!.position).toEqual({ x: 400, y: 0 })
  })

  it('resolves horizontal overlap', () => {
    // two 200x100 nodes at same position — x overlap (200) > y overlap (100), so resolves along Y
    // place them so x-overlap is smaller: offset by 150px on X, 0 on Y
    // overlapX = 200 - 150 + 50 margin = 100, overlapY = 100 + 50 margin = 150 → resolves along X
    const nodes = [createNode('a', 0, 0), createNode('b', 150, 0)]
    const result = resolveOverlaps(nodes, 50)
    const a = result.find(n => n.id === 'a')!
    const b = result.find(n => n.id === 'b')!
    // After resolution, b.x - (a.x + 200) should be >= 50 (margin)
    expect(b.position.x).toBeGreaterThanOrEqual(a.position.x + 200 + 50 - 0.001)
  })

  it('resolves vertical overlap', () => {
    // two 200x100 nodes: large x overlap, small y overlap → resolves along Y
    // place them at (0,0) and (0, 80): overlapX=200+50=250, overlapY=100-80+50=70 → resolves Y
    const nodes = [createNode('a', 0, 0), createNode('b', 0, 80)]
    const result = resolveOverlaps(nodes, 50)
    const a = result.find(n => n.id === 'a')!
    const b = result.find(n => n.id === 'b')!
    // b should be pushed below a with at least margin gap
    expect(b.position.y).toBeGreaterThanOrEqual(a.position.y + 100 + 50 - 0.001)
  })

  it('resolves multiple simultaneous overlaps', () => {
    // three overlapping nodes arranged in a triangle — all pairs overlap
    const nodes = [
      createNode('a', 0, 0),
      createNode('b', 100, 0),  // overlaps a (200px wide, only 100px apart)
      createNode('c', 50, 60),  // overlaps both a and b
    ]
    const margin = 50
    const result = resolveOverlaps(nodes, margin)

    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const n1 = result[i]
        const n2 = result[j]
        const overlapX = Math.min(n1.position.x + 200, n2.position.x + 200) - Math.max(n1.position.x, n2.position.x) + margin
        const overlapY = Math.min(n1.position.y + 100, n2.position.y + 100) - Math.max(n1.position.y, n2.position.y) + margin
        expect(overlapX > 0 && overlapY > 0).toBe(false)
      }
    }
  })

  it('enforces margin gap between touching nodes', () => {
    // nodes placed exactly edge-to-edge (no pixel overlap) but violating the 50px margin
    const nodes = [createNode('a', 0, 0), createNode('b', 200, 0)]
    const result = resolveOverlaps(nodes, 50)
    const a = result.find(n => n.id === 'a')!
    const b = result.find(n => n.id === 'b')!
    expect(b.position.x - (a.position.x + 200)).toBeGreaterThanOrEqual(50 - 0.001)
  })

  it('terminates with maxIterations=1 and does not throw', () => {
    const nodes = [createNode('a', 0, 0), createNode('b', 0, 0), createNode('c', 0, 0)]
    expect(() => resolveOverlaps(nodes, 50, 1)).not.toThrow()
  })

  it('preserves node fields other than position', () => {
    const nodes = [createNode('a', 0, 0), createNode('b', 0, 0)]
    const result = resolveOverlaps(nodes, 50)
    expect(result[0].id).toBe('a')
    expect(result[0].data).toEqual({})
    expect(result[0].measured).toEqual({ width: 200, height: 100 })
  })
})
