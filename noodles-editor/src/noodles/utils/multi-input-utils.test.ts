import type { Edge as ReactFlowEdge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import {
  MULTI_INPUT_EDGE_TYPE,
  SLOT_SPACING,
  insertEdgeAtGroupIndex,
  insertionIndexFromPointerY,
  moveEdgeWithinGroup,
  normalizeMultiInputEdges,
  orderedEdgeIdsForHandle,
  slotOffsetY,
} from './multi-input-utils'

// Test resolver: any edge into a 'par.layers' handle is a multi-input edge
const isMulti = (e: Pick<ReactFlowEdge, 'target' | 'targetHandle'>) =>
  e.targetHandle === 'par.layers'

const edge = (
  id: string,
  target = '/deck',
  targetHandle = 'par.layers',
  extra: Partial<ReactFlowEdge> = {}
): ReactFlowEdge => ({
  id,
  source: `/src-${id}`,
  target,
  sourceHandle: 'out.result',
  targetHandle,
  ...extra,
})

describe('normalizeMultiInputEdges', () => {
  it('assigns orderIndex and groupSize in array order', () => {
    const edges = [edge('a'), edge('b'), edge('c')]
    const result = normalizeMultiInputEdges(edges, isMulti)

    expect(result.map(e => e.type)).toEqual(Array(3).fill(MULTI_INPUT_EDGE_TYPE))
    expect(result.map(e => e.data?.orderIndex)).toEqual([0, 1, 2])
    expect(result.map(e => e.data?.groupSize)).toEqual([3, 3, 3])
  })

  it('handles interleaved groups independently', () => {
    const edges = [
      edge('a', '/deck-1'),
      edge('x', '/deck-2'),
      edge('b', '/deck-1'),
      edge('y', '/deck-2'),
    ]
    const result = normalizeMultiInputEdges(edges, isMulti)

    expect(result.map(e => e.data?.orderIndex)).toEqual([0, 0, 1, 1])
    expect(result.map(e => e.data?.groupSize)).toEqual([2, 2, 2, 2])
  })

  it('leaves non-multi-input edges untouched', () => {
    const plain = edge('p', '/viewer', 'par.data')
    const result = normalizeMultiInputEdges([plain, edge('a')], isMulti)

    expect(result[0]).toBe(plain)
    expect(result[0].type).toBeUndefined()
    expect(result[1].type).toBe(MULTI_INPUT_EDGE_TYPE)
  })

  it('strips stale multi-input type and data from edges that left a multi-input target', () => {
    const stale = edge('s', '/viewer', 'par.data', {
      type: MULTI_INPUT_EDGE_TYPE,
      data: { orderIndex: 2, groupSize: 3, keep: 'me' },
    })
    const result = normalizeMultiInputEdges([stale], isMulti)

    expect(result[0].type).toBeUndefined()
    expect(result[0].data).toEqual({ keep: 'me' })
  })

  it('is idempotent and returns the same reference when nothing changed', () => {
    const once = normalizeMultiInputEdges([edge('a'), edge('b')], isMulti)
    const twice = normalizeMultiInputEdges(once, isMulti)

    expect(twice).toBe(once)
  })

  it('repairs stale orderIndex after the array is reordered', () => {
    const normalized = normalizeMultiInputEdges([edge('a'), edge('b'), edge('c')], isMulti)
    const reordered = [normalized[2], normalized[0], normalized[1]]
    const result = normalizeMultiInputEdges(reordered, isMulti)

    expect(result.map(e => e.id)).toEqual(['c', 'a', 'b'])
    expect(result.map(e => e.data?.orderIndex)).toEqual([0, 1, 2])
  })
})

describe('orderedEdgeIdsForHandle', () => {
  it('returns ids for the handle in array order', () => {
    const edges = [edge('a'), edge('x', '/other'), edge('b')]

    expect(orderedEdgeIdsForHandle(edges, '/deck', 'par.layers')).toEqual(['a', 'b'])
    expect(orderedEdgeIdsForHandle(edges, '/other', 'par.layers')).toEqual(['x'])
    expect(orderedEdgeIdsForHandle(edges, '/nope', 'par.layers')).toEqual([])
  })
})

describe('insertEdgeAtGroupIndex', () => {
  const existing = [edge('a'), edge('x', '/other'), edge('b')]

  it('inserts at the head of the group', () => {
    const result = insertEdgeAtGroupIndex(existing, edge('new'), 0)
    expect(result.map(e => e.id)).toEqual(['new', 'a', 'x', 'b'])
  })

  it('inserts in the middle of the group, skipping unrelated edges', () => {
    const result = insertEdgeAtGroupIndex(existing, edge('new'), 1)
    expect(result.map(e => e.id)).toEqual(['a', 'x', 'new', 'b'])
    expect(orderedEdgeIdsForHandle(result, '/deck', 'par.layers')).toEqual(['a', 'new', 'b'])
  })

  it('appends past the end of the group', () => {
    const result = insertEdgeAtGroupIndex(existing, edge('new'), 2)
    expect(result.map(e => e.id)).toEqual(['a', 'x', 'b', 'new'])
  })

  it('clamps out-of-range indices', () => {
    expect(insertEdgeAtGroupIndex(existing, edge('new'), -5).map(e => e.id)).toEqual([
      'new',
      'a',
      'x',
      'b',
    ])
    expect(insertEdgeAtGroupIndex(existing, edge('new'), 99).map(e => e.id)).toEqual([
      'a',
      'x',
      'b',
      'new',
    ])
  })

  it('appends to an empty group', () => {
    const result = insertEdgeAtGroupIndex([edge('x', '/other')], edge('new'), 0)
    expect(result.map(e => e.id)).toEqual(['x', 'new'])
  })
})

describe('moveEdgeWithinGroup', () => {
  const edges = [edge('a'), edge('x', '/other'), edge('b'), edge('c')]

  it('moves an edge earlier in its group', () => {
    const result = moveEdgeWithinGroup(edges, 'c', 0)
    expect(orderedEdgeIdsForHandle(result, '/deck', 'par.layers')).toEqual(['c', 'a', 'b'])
  })

  it('moves an edge later in its group', () => {
    const result = moveEdgeWithinGroup(edges, 'a', 2)
    expect(orderedEdgeIdsForHandle(result, '/deck', 'par.layers')).toEqual(['b', 'c', 'a'])
  })

  it('returns the same reference for a no-op move', () => {
    expect(moveEdgeWithinGroup(edges, 'a', 0)).toBe(edges)
    expect(moveEdgeWithinGroup(edges, 'missing', 1)).toBe(edges)
  })

  it('clamps the target index', () => {
    const result = moveEdgeWithinGroup(edges, 'a', 99)
    expect(orderedEdgeIdsForHandle(result, '/deck', 'par.layers')).toEqual(['b', 'c', 'a'])
  })
})

describe('slotOffsetY', () => {
  it('centers a single slot on the handle', () => {
    expect(slotOffsetY(0, 1)).toBe(0)
  })

  it('spreads slots symmetrically around the center', () => {
    expect(slotOffsetY(0, 3)).toBe(-SLOT_SPACING)
    expect(slotOffsetY(1, 3)).toBe(0)
    expect(slotOffsetY(2, 3)).toBe(SLOT_SPACING)

    expect(slotOffsetY(0, 2)).toBe(-SLOT_SPACING / 2)
    expect(slotOffsetY(1, 2)).toBe(SLOT_SPACING / 2)
  })
})

describe('insertionIndexFromPointerY', () => {
  const centerY = 100

  it('returns 0 for an empty group', () => {
    expect(insertionIndexFromPointerY(centerY, centerY, 0)).toBe(0)
  })

  it('returns 0 far above and groupSize far below', () => {
    expect(insertionIndexFromPointerY(centerY - 1000, centerY, 3)).toBe(0)
    expect(insertionIndexFromPointerY(centerY + 1000, centerY, 3)).toBe(3)
  })

  it('maps slot centers to the nearest boundary', () => {
    // slot centers for groupSize 2 sit at ±SLOT_SPACING/2; hovering just above a slot's
    // center rounds to the boundary before it, just below to the boundary after it
    expect(insertionIndexFromPointerY(centerY + slotOffsetY(0, 2) - 1, centerY, 2)).toBe(0)
    expect(insertionIndexFromPointerY(centerY + slotOffsetY(0, 2) + 1, centerY, 2)).toBe(1)
    expect(insertionIndexFromPointerY(centerY + slotOffsetY(1, 2) - 1, centerY, 2)).toBe(1)
    expect(insertionIndexFromPointerY(centerY + slotOffsetY(1, 2) + 1, centerY, 2)).toBe(2)
  })

  it('returns the exact boundary at boundary positions', () => {
    // boundary between the two slots of a 2-group is exactly the handle center
    expect(insertionIndexFromPointerY(centerY, centerY, 2)).toBe(1)
  })
})
