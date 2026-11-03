import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { getNoodles } from './noodles'
import { useGraphStore } from './store'

const wrapper = ({ children }: { children: ReactNode }) => (
  <Router hook={memoryLocation({ path: '/projects/new' }).hook}>{children}</Router>
)

describe('getNoodles graph store lifetime', () => {
  afterEach(() => {
    cleanup()
    useGraphStore.getState().clearGraph()
  })

  it('clears nodes and edges when the editor unmounts', () => {
    const { unmount } = renderHook(() => getNoodles(), { wrapper })
    useGraphStore.setState({
      nodes: [{ id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [{ id: 'e', source: '/num', target: '/num' }],
    })

    unmount()

    expect(useGraphStore.getState().nodes).toEqual([])
    expect(useGraphStore.getState().edges).toEqual([])
  })
})
