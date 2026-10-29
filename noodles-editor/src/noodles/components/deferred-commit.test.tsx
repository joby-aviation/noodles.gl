import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_MS, useDeferredCommit } from './deferred-commit'

afterEach(() => vi.useRealTimers())

describe('edits held back until a dialog closes', () => {
  it('hands over only the last edit, when the dialog closes', () => {
    const onCommit = vi.fn()
    const { result, rerender } = renderHook(
      ({ open }) => useDeferredCommit(onCommit, false, open),
      {
        initialProps: { open: true },
      }
    )
    act(() => {
      for (const v of [1, 2, 3]) result.current.change(v)
    })
    expect(onCommit).not.toHaveBeenCalled()
    rerender({ open: false })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(3)
  })

  it('with live update on, hands edits over every LIVE_MS while they come', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    const { result } = renderHook(() => useDeferredCommit(onCommit, true, true))
    act(() => {
      result.current.change(1)
      result.current.change(2)
    })
    expect(onCommit).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(LIVE_MS))
    expect(onCommit).toHaveBeenCalledWith(2)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('hands over what was held when live update turns on, and when it unmounts', () => {
    const onCommit = vi.fn()
    const { result, rerender, unmount } = renderHook(
      ({ live }) => useDeferredCommit(onCommit, live, true),
      { initialProps: { live: false } }
    )
    act(() => result.current.change('a'))
    rerender({ live: true })
    expect(onCommit).toHaveBeenLastCalledWith('a')
    rerender({ live: false })
    act(() => result.current.change('b'))
    unmount()
    expect(onCommit).toHaveBeenLastCalledWith('b')
    expect(onCommit).toHaveBeenCalledTimes(2)
  })
})
