// @vitest-environment node
import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { type LayoutOptions, layoutNodes, resolveOverlaps } from './auto-layout'

const createNode = (
  id: string,
  x = 0,
  y = 0,
  width = 200,
  height = 100,
  type?: string
): Node => ({
  id,
  position: { x, y },
  data: {},
  type,
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

describe('layoutNodes with semantic algorithm', () => {
  const semanticOptions: LayoutOptions = {
    enabled: true,
    algorithm: 'semantic',
    direction: 'LR',
  }

  it('returns empty array for empty input', () => {
    const result = layoutNodes([], [], semanticOptions)
    expect(result).toEqual([])
  })

  it('returns single node with position', () => {
    const nodes = [createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp')]
    const result = layoutNodes(nodes, [], semanticOptions)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('layer1')
    expect(typeof result[0].position.x).toBe('number')
    expect(typeof result[0].position.y).toBe('number')
  })

  it('groups all layer operators in the same X column', () => {
    const nodes = [
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('layer2', 100, 100, 200, 100, 'ArcLayerOp'),
      createNode('layer3', 200, 200, 200, 100, 'PathLayerOp'),
    ]
    const result = layoutNodes(nodes, [], semanticOptions)

    const layerX = result.find(n => n.id === 'layer1')!.position.x
    expect(result.find(n => n.id === 'layer2')!.position.x).toBe(layerX)
    expect(result.find(n => n.id === 'layer3')!.position.x).toBe(layerX)
  })

  it('places DeckRendererOp to the right of layers', () => {
    const nodes = [
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('deck', 0, 0, 200, 100, 'DeckRendererOp'),
    ]
    const result = layoutNodes(nodes, [], semanticOptions)

    const layerX = result.find(n => n.id === 'layer1')!.position.x
    const deckX = result.find(n => n.id === 'deck')!.position.x
    expect(deckX).toBeGreaterThan(layerX)
  })

  it('places OutOp to the right of DeckRendererOp at same Y', () => {
    const nodes = [
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('deck', 0, 0, 200, 100, 'DeckRendererOp'),
      createNode('out', 0, 0, 200, 100, 'OutOp'),
    ]
    const result = layoutNodes(nodes, [], semanticOptions)

    const deckNode = result.find(n => n.id === 'deck')!
    const outNode = result.find(n => n.id === 'out')!

    expect(outNode.position.x).toBeGreaterThan(deckNode.position.x)
    expect(outNode.position.y).toBe(deckNode.position.y)
  })

  it('vertically centers DeckRendererOp between layers', () => {
    const nodes = [
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('layer2', 0, 0, 200, 100, 'ArcLayerOp'),
      createNode('layer3', 0, 0, 200, 100, 'PathLayerOp'),
      createNode('deck', 0, 0, 200, 100, 'DeckRendererOp'),
    ]
    const result = layoutNodes(nodes, [], semanticOptions)

    const layerNodes = result.filter(n => n.id.startsWith('layer'))
    const deckNode = result.find(n => n.id === 'deck')!

    const minLayerY = Math.min(...layerNodes.map(n => n.position.y))
    const maxLayerY = Math.max(...layerNodes.map(n => n.position.y + (n.measured?.height ?? 100)))
    const centerY = (minLayerY + maxLayerY) / 2

    // DeckRenderer's midpoint should be near the center
    const deckMidY = deckNode.position.y + (deckNode.measured?.height ?? 100) / 2
    expect(Math.abs(deckMidY - centerY)).toBeLessThan(5)
  })

  it('places MaplibreBasemapOp below layers in same X column', () => {
    const nodes = [
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('layer2', 0, 0, 200, 100, 'ArcLayerOp'),
      createNode('basemap', 0, 0, 200, 100, 'MaplibreBasemapOp'),
    ]
    const result = layoutNodes(nodes, [], semanticOptions)

    const layerX = result.find(n => n.id === 'layer1')!.position.x
    const basemapNode = result.find(n => n.id === 'basemap')!

    expect(basemapNode.position.x).toBe(layerX)

    const layerNodes = result.filter(n => n.id.startsWith('layer'))
    const maxLayerY = Math.max(...layerNodes.map(n => n.position.y + (n.measured?.height ?? 100)))
    expect(basemapNode.position.y).toBeGreaterThan(maxLayerY)
  })

  it('places data sources to the left of layers', () => {
    const nodes = [
      createNode('file', 0, 0, 200, 100, 'FileOp'),
      createNode('layer', 0, 0, 200, 100, 'ScatterplotLayerOp'),
    ]
    const edges = [createEdge('file', 'layer')]
    const result = layoutNodes(nodes, edges, semanticOptions)

    const fileX = result.find(n => n.id === 'file')!.position.x
    const layerX = result.find(n => n.id === 'layer')!.position.x
    expect(fileX).toBeLessThan(layerX)
  })

  it('aligns data sources with vertical midpoint of consumers', () => {
    const nodes = [
      createNode('file', 0, 0, 200, 100, 'FileOp'),
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('layer2', 0, 0, 200, 100, 'ArcLayerOp'),
    ]
    const edges = [createEdge('file', 'layer1'), createEdge('file', 'layer2')]
    const result = layoutNodes(nodes, edges, semanticOptions)

    const fileNode = result.find(n => n.id === 'file')!
    const layer1Node = result.find(n => n.id === 'layer1')!
    const layer2Node = result.find(n => n.id === 'layer2')!

    const layer1Mid = layer1Node.position.y + (layer1Node.measured?.height ?? 100) / 2
    const layer2Mid = layer2Node.position.y + (layer2Node.measured?.height ?? 100) / 2
    const avgMid = (layer1Mid + layer2Mid) / 2
    const fileMid = fileNode.position.y + (fileNode.measured?.height ?? 100) / 2

    expect(Math.abs(fileMid - avgMid)).toBeLessThan(10)
  })

  it('places AccessorOp between data sources and layers', () => {
    const nodes = [
      createNode('file', 0, 0, 200, 100, 'FileOp'),
      createNode('accessor', 0, 0, 200, 100, 'AccessorOp'),
      createNode('layer', 0, 0, 200, 100, 'ScatterplotLayerOp'),
    ]
    const edges = [createEdge('file', 'accessor'), createEdge('accessor', 'layer')]
    const result = layoutNodes(nodes, edges, semanticOptions)

    const fileX = result.find(n => n.id === 'file')!.position.x
    const accessorX = result.find(n => n.id === 'accessor')!.position.x
    const layerX = result.find(n => n.id === 'layer')!.position.x

    expect(fileX).toBeLessThan(accessorX)
    expect(accessorX).toBeLessThan(layerX)
  })

  it('positions shared AccessorOp between multiple layers vertically', () => {
    const nodes = [
      createNode('accessor', 0, 0, 200, 100, 'AccessorOp'),
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('layer2', 0, 0, 200, 100, 'ArcLayerOp'),
      createNode('layer3', 0, 0, 200, 100, 'PathLayerOp'),
    ]
    const edges = [
      createEdge('accessor', 'layer1'),
      createEdge('accessor', 'layer2'),
      createEdge('accessor', 'layer3'),
    ]
    const result = layoutNodes(nodes, edges, semanticOptions)

    const accessorNode = result.find(n => n.id === 'accessor')!
    const layerNodes = result.filter(n => n.id.startsWith('layer'))

    const layerMids = layerNodes.map(n => n.position.y + (n.measured?.height ?? 100) / 2)
    const minMid = Math.min(...layerMids)
    const maxMid = Math.max(...layerMids)
    const accessorMid = accessorNode.position.y + (accessorNode.measured?.height ?? 100) / 2

    // AccessorOp should be positioned between the first and last layer's midpoints
    expect(accessorMid).toBeGreaterThanOrEqual(minMid - 10)
    expect(accessorMid).toBeLessThanOrEqual(maxMid + 10)
  })

  it('produces non-overlapping nodes', () => {
    const nodes = [
      createNode('file', 0, 0, 200, 100, 'FileOp'),
      createNode('accessor1', 0, 0, 200, 100, 'AccessorOp'),
      createNode('accessor2', 0, 0, 200, 100, 'AccessorOp'),
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('layer2', 0, 0, 200, 100, 'ArcLayerOp'),
      createNode('deck', 0, 0, 200, 100, 'DeckRendererOp'),
      createNode('out', 0, 0, 200, 100, 'OutOp'),
    ]
    const edges = [
      createEdge('file', 'accessor1'),
      createEdge('file', 'accessor2'),
      createEdge('accessor1', 'layer1'),
      createEdge('accessor2', 'layer2'),
      createEdge('layer1', 'deck'),
      createEdge('layer2', 'deck'),
      createEdge('deck', 'out'),
    ]
    const result = layoutNodes(nodes, edges, semanticOptions)
    const margin = 50

    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const n1 = result[i]
        const n2 = result[j]
        const w1 = n1.measured?.width ?? 200
        const h1 = n1.measured?.height ?? 100
        const w2 = n2.measured?.width ?? 200
        const h2 = n2.measured?.height ?? 100

        const overlapX =
          Math.min(n1.position.x + w1, n2.position.x + w2) - Math.max(n1.position.x, n2.position.x) + margin
        const overlapY =
          Math.min(n1.position.y + h1, n2.position.y + h2) - Math.max(n1.position.y, n2.position.y) + margin

        expect(overlapX > 0 && overlapY > 0).toBe(false)
      }
    }
  })

  it('handles complete typical graph structure', () => {
    // Typical Noodles.gl graph: FileOp → AccessorOp → Layers → DeckRenderer → Out
    //                              ↓                    ↓
    //                         ColorOp              MaplibreBasemap
    const nodes = [
      createNode('file', 0, 0, 200, 100, 'FileOp'),
      createNode('accessor', 0, 0, 200, 100, 'AccessorOp'),
      createNode('color', 0, 0, 200, 100, 'ColorOp'),
      createNode('layer1', 0, 0, 200, 100, 'ScatterplotLayerOp'),
      createNode('layer2', 0, 0, 200, 100, 'ArcLayerOp'),
      createNode('basemap', 0, 0, 200, 100, 'MaplibreBasemapOp'),
      createNode('deck', 0, 0, 200, 100, 'DeckRendererOp'),
      createNode('out', 0, 0, 200, 100, 'OutOp'),
    ]
    const edges = [
      createEdge('file', 'accessor'),
      createEdge('accessor', 'layer1'),
      createEdge('accessor', 'layer2'),
      createEdge('color', 'layer1'),
      createEdge('layer1', 'deck'),
      createEdge('layer2', 'deck'),
      createEdge('basemap', 'deck'),
      createEdge('deck', 'out'),
    ]
    const result = layoutNodes(nodes, edges, semanticOptions)

    // Check tier ordering
    const fileX = result.find(n => n.id === 'file')!.position.x
    const accessorX = result.find(n => n.id === 'accessor')!.position.x
    const colorX = result.find(n => n.id === 'color')!.position.x
    const layer1X = result.find(n => n.id === 'layer1')!.position.x
    const layer2X = result.find(n => n.id === 'layer2')!.position.x
    const basemapX = result.find(n => n.id === 'basemap')!.position.x
    const deckX = result.find(n => n.id === 'deck')!.position.x
    const outX = result.find(n => n.id === 'out')!.position.x

    // Verify X ordering
    expect(fileX).toBeLessThan(accessorX)
    expect(accessorX).toBeLessThan(layer1X)
    expect(colorX).toBeGreaterThan(fileX)
    expect(colorX).toBeLessThan(layer1X)
    expect(layer1X).toBe(layer2X) // Layers in same column
    expect(basemapX).toBe(layer1X) // Basemap in same column as layers
    expect(deckX).toBeGreaterThan(layer1X)
    expect(outX).toBeGreaterThan(deckX)

    // Verify basemap is below layers
    const layer1Y = result.find(n => n.id === 'layer1')!.position.y
    const layer2Y = result.find(n => n.id === 'layer2')!.position.y
    const basemapY = result.find(n => n.id === 'basemap')!.position.y
    expect(basemapY).toBeGreaterThan(Math.max(layer1Y, layer2Y))

    // Verify OutOp same Y as DeckRenderer
    const deckY = result.find(n => n.id === 'deck')!.position.y
    const outY = result.find(n => n.id === 'out')!.position.y
    expect(outY).toBe(deckY)
  })
})
