import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireGraphMutation, registerGraphMutationCallback } from './graph-history'

afterEach(() => registerGraphMutationCallback(undefined))

describe('graph proposal history', () => {
  it('records an accepted batch as one history mutation', () => {
    const callback = vi.fn()
    registerGraphMutationCallback(callback)
    const before = { nodes: [], edges: [] }
    const after = {
      nodes: [{ id: '/n', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }

    fireGraphMutation('Apply assistant proposal', before, after)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('Apply assistant proposal', before, after)
  })

  it('does nothing for a rejected proposal because no mutation is fired', () => {
    const callback = vi.fn()
    registerGraphMutationCallback(callback)

    expect(callback).not.toHaveBeenCalled()
  })
})
