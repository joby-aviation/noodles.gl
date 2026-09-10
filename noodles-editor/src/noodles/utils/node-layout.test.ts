import type { Node as ReactFlowNode } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { findClearOffset, LAYOUT_GAP, resolveNodeOverlaps } from './node-layout'
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from './viewer-position'

function existingNode(id: string, x: number, y: number, width = 200, height = 100): ReactFlowNode {
  return {
    id,
    type: 'NumberOp',
    position: { x, y },
    data: {},
    measured: { width, height },
  }
}

function incoming(positions: Array<[number, number]>) {
  return positions.map(([x, y], i) => ({ id: `/new-${i}`, position: { x, y } }))
}

describe('findClearOffset', () => {
  it('does not move a block that lands in empty space', () => {
    const offset = findClearOffset(incoming([[0, 0]]), [existingNode('/a', 2000, 2000)])
    expect(offset).toBe(0)
  })

  it('returns zero when the graph is empty', () => {
    expect(findClearOffset(incoming([[0, 0]]), [])).toBe(0)
  })

  it('drops the block below a node it lands on top of', () => {
    const offset = findClearOffset(incoming([[0, 0]]), [existingNode('/a', 0, 0, 200, 100)])
    // Block top starts at -LAYOUT_GAP after inflation, so it must clear
    // the obstacle bottom (100) plus a gap on each side
    expect(offset).toBe(100 + LAYOUT_GAP * 2)
  })

  it('clears a whole stack of overlapping nodes in a bounded number of passes', () => {
    const stack = Array.from({ length: 20 }, (_, i) => existingNode(`/a${i}`, 0, i * 60))
    const offset = findClearOffset(incoming([[0, 0]]), stack)
    const blockTop = 0 + offset - LAYOUT_GAP
    const lastBottom = 19 * 60 + 100
    expect(blockTop).toBeGreaterThanOrEqual(lastBottom)
  })

  it('accounts for the full width and height of a multi-node block', () => {
    // A block spanning three columns must clear an obstacle under its far column,
    // even though the first node of the block is nowhere near it
    const far = existingNode('/far', 900, 0)
    const offset = findClearOffset(
      incoming([
        [0, 0],
        [450, 0],
        [900, 0],
      ]),
      [far]
    )
    expect(offset).toBeGreaterThan(0)
  })

  it('ignores hidden nodes', () => {
    const hidden = { ...existingNode('/a', 0, 0), hidden: true }
    expect(findClearOffset(incoming([[0, 0]]), [hidden])).toBe(0)
  })
})

describe('resolveNodeOverlaps', () => {
  it('preserves the relative layout of the block it shifts', () => {
    const nodes = incoming([
      [0, 0],
      [450, 280],
    ])
    const moved = resolveNodeOverlaps(nodes, [existingNode('/a', 0, 0)])
    expect(moved[1].position.x - moved[0].position.x).toBe(450)
    expect(moved[1].position.y - moved[0].position.y).toBe(280)
  })

  it('returns the same objects when nothing overlaps', () => {
    const nodes = incoming([[0, 0]])
    expect(resolveNodeOverlaps(nodes, [])).toBe(nodes)
  })

  it('leaves nodes inside containers alone, since they move with their parent', () => {
    const child = { id: '/box/child', position: { x: 10, y: 10 }, parentId: '/box' }
    const root = { id: '/root', position: { x: 0, y: 0 } }
    const moved = resolveNodeOverlaps([root, child], [existingNode('/a', 0, 0)])
    expect(moved[1].position).toEqual({ x: 10, y: 10 })
    expect(moved[0].position.y).toBeGreaterThan(0)
  })

  it('shifts far enough that the block no longer overlaps', () => {
    const existing = [existingNode('/a', 0, 0), existingNode('/b', 450, 120)]
    const moved = resolveNodeOverlaps(
      incoming([
        [0, 0],
        [450, 0],
      ]),
      existing
    )
    for (const node of moved) {
      for (const other of existing) {
        const overlaps =
          node.position.x < other.position.x + 200 &&
          node.position.x + DEFAULT_NODE_WIDTH > other.position.x &&
          node.position.y < other.position.y + 100 &&
          node.position.y + DEFAULT_NODE_HEIGHT > other.position.y
        expect(overlaps).toBe(false)
      }
    }
  })
})
