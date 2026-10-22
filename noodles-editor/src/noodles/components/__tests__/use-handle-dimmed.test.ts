import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../../store'
import { useHandleDimmed } from '../op-components'

function setDragState(
  sourceNodeId: string,
  sourceHandleId: string,
  compatibleNodeIds: string[] = []
) {
  act(() => {
    useUIStore.getState().setConnectionDragState({
      sourceNodeId,
      sourceHandleId,
      compatibleNodeIds: new Set(compatibleNodeIds),
    })
  })
}

describe('useHandleDimmed — self-connection prevention', () => {
  beforeEach(() => {
    useUIStore.getState().setConnectionDragState(null)
  })

  afterEach(() => {
    useUIStore.getState().setConnectionDragState(null)
  })

  it('returns false when no drag is active', () => {
    const { result } = renderHook(() => useHandleDimmed('/a', 'par.value'))
    expect(result.current).toBe(false)
  })

  it('dims input handles on the source node to prevent self-connections', () => {
    setDragState('/a', 'out.val', [])
    const { result } = renderHook(() => useHandleDimmed('/a', 'par.value'))
    expect(result.current).toBe(true)
  })

  it('does not dim the source handle itself', () => {
    setDragState('/a', 'out.val', [])
    const { result } = renderHook(() => useHandleDimmed('/a', 'out.val'))
    expect(result.current).toBe(false)
  })

  it('dims other output handles on the source node', () => {
    setDragState('/a', 'out.val', [])
    const { result } = renderHook(() => useHandleDimmed('/a', 'out.other'))
    expect(result.current).toBe(true)
  })
})
