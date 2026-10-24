import type { EdgeChange, NodeChange } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../../utils/analytics'
import { trackAddedEdges, trackAddedNodes } from './graph-analytics'

vi.mock('../../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

const track = vi.mocked(analytics.track)

const node = (id: string, type?: string) => ({ id, type, position: { x: 0, y: 0 }, data: {} })
const edge = (id: string) => ({ id, source: '/a', target: '/b' })

describe('graph analytics', () => {
  beforeEach(() => {
    track.mockClear()
  })

  it('tracks node_added once per added node with its type', () => {
    const changes: NodeChange[] = [
      { type: 'add', item: node('/file', 'FileOp') },
      { type: 'add', item: node('/untyped') },
      { type: 'select', id: '/other', selected: true },
      { type: 'replace', id: '/other', item: node('/other', 'NumberOp') },
    ]
    trackAddedNodes(changes)
    expect(track.mock.calls).toEqual([
      ['node_added', { nodeType: 'FileOp' }],
      ['node_added', { nodeType: 'unknown' }],
    ])
  })

  it('tracks one edge_added event with the number of added edges', () => {
    const changes: EdgeChange[] = [
      { type: 'add', item: edge('e1') },
      { type: 'add', item: edge('e2') },
      { type: 'remove', id: 'e0' },
    ]
    trackAddedEdges(changes)
    expect(track.mock.calls).toEqual([['edge_added', { count: 2 }]])
  })

  it('tracks nothing when no nodes or edges were added', () => {
    trackAddedNodes([{ type: 'remove', id: '/gone' }])
    trackAddedEdges([{ type: 'select', id: 'e1', selected: true }])
    expect(track).not.toHaveBeenCalled()
  })
})
