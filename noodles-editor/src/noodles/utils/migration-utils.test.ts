import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import {
  appendUniqueEdges,
  assertUniqueEdges,
  insertUniqueEdge,
} from './edge-integrity'

const edge = (source: string, id = `${source}.out.data->/target.par.values`): Edge => ({
  id,
  source,
  sourceHandle: 'out.data',
  target: '/target',
  targetHandle: 'par.values',
})

describe('edge uniqueness', () => {
  it('treats an existing logical connection as an insertion no-op regardless of ID', () => {
    const existing = [edge('/a', 'legacy-id')]

    expect(insertUniqueEdge(existing, edge('/a', 'different-id'))).toBe(existing)
  })

  it('deduplicates candidates within one batch while preserving order', () => {
    const first = edge('/a')
    const second = edge('/b')

    expect(appendUniqueEdges([], [first, second, { ...first, id: 'alternate' }])).toEqual([
      first,
      second,
    ])
  })

  it('supports atomic insertion at a caller-defined position', () => {
    const first = edge('/a')
    const last = edge('/c')
    const middle = edge('/b')

    const result = insertUniqueEdge([first, last], middle, (current, candidate) => [
      current[0],
      candidate,
      current[1],
    ])

    expect(result).toEqual([first, middle, last])
  })

  it('rejects an ID already assigned to another connection', () => {
    expect(() => insertUniqueEdge([edge('/a', 'shared')], edge('/b', 'shared'))).toThrow(
      'already belongs to a different connection'
    )
  })

  it('reports corrupted existing state before attempting an insertion', () => {
    const duplicate = edge('/a')

    expect(() => appendUniqueEdges([duplicate, { ...duplicate }], [edge('/b')])).toThrow(
      'describe the same connection'
    )
  })

  it('reports duplicate IDs assigned to distinct connections', () => {
    expect(() => assertUniqueEdges([edge('/a', 'shared'), edge('/b', 'shared')])).toThrow(
      'share the ID'
    )
  })
})
