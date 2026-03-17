import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeckDrawLoop } from './draw-loop'

// These tests verify the useDeckDrawLoop hook doesn't cause frame capture issues.
// The original blank frame bug was caused by:
// 1. useDeckDrawLoop re-running and overwriting onAfterRender callbacks
// 2. Multiple captureFrame() calls from different sources causing premature promise resolution
// 3. Effect re-runs due to unstable prop references

describe('useDeckDrawLoop', () => {
  let mockDeck: {
    setProps: ReturnType<typeof vi.fn>
    props: { layers: unknown[]; onAfterRender?: () => void }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockDeck = {
      setProps: vi.fn(),
      props: { layers: [] },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should not set onAfterRender when isRendering is false', () => {
    renderHook(() =>
      useDeckDrawLoop({
        deck: mockDeck as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
        isRendering: false,
        rendererConfig: { waitForData: false, captureDelay: 200 },
      })
    )

    expect(mockDeck.setProps).not.toHaveBeenCalled()
  })

  it('should not set onAfterRender when deck is null', () => {
    renderHook(() =>
      useDeckDrawLoop({
        deck: null,
        isRendering: true,
        rendererConfig: { waitForData: false, captureDelay: 200 },
      })
    )

    expect(mockDeck.setProps).not.toHaveBeenCalled()
  })

  it('should set onAfterRender when isRendering is true and deck exists', () => {
    renderHook(() =>
      useDeckDrawLoop({
        deck: mockDeck as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
        isRendering: true,
        rendererConfig: { waitForData: false, captureDelay: 200 },
      })
    )

    expect(mockDeck.setProps).toHaveBeenCalled()
    expect(mockDeck.setProps).toHaveBeenCalledWith(
      expect.objectContaining({
        onAfterRender: expect.any(Function),
      })
    )
  })

  it('should call captureFrame after captureDelay when onAfterRender fires', async () => {
    const mockCaptureFrame = vi.fn()
    const captureDelay = 200

    renderHook(() =>
      useDeckDrawLoop({
        deck: mockDeck as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
        isRendering: true,
        captureFrame: mockCaptureFrame,
        rendererConfig: { waitForData: false, captureDelay },
      })
    )

    // Get the onAfterRender callback that was set
    const setPropsCall = mockDeck.setProps.mock.calls[0][0]
    const onAfterRender = setPropsCall.onAfterRender

    // Simulate onAfterRender being called
    onAfterRender({})

    // captureFrame shouldn't be called immediately
    expect(mockCaptureFrame).not.toHaveBeenCalled()

    // Advance timers by captureDelay
    await act(async () => {
      vi.advanceTimersByTime(captureDelay)
    })

    // Now captureFrame should be called
    expect(mockCaptureFrame).toHaveBeenCalledTimes(1)
  })

  it('should wait for layers to load when waitForData is true', async () => {
    const mockCaptureFrame = vi.fn()
    const captureDelay = 200

    // Deck with unloaded layers
    const deckWithUnloadedLayers = {
      setProps: vi.fn(),
      props: { layers: [{ isLoaded: false }] },
    }

    renderHook(() =>
      useDeckDrawLoop({
        deck: deckWithUnloadedLayers as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
        isRendering: true,
        captureFrame: mockCaptureFrame,
        rendererConfig: { waitForData: true, captureDelay },
      })
    )

    const setPropsCall = deckWithUnloadedLayers.setProps.mock.calls[0][0]
    const onAfterRender = setPropsCall.onAfterRender

    // Simulate onAfterRender being called
    onAfterRender({})

    // Advance timers
    await act(async () => {
      vi.advanceTimersByTime(captureDelay + 100)
    })

    // captureFrame should NOT be called because layers aren't loaded
    expect(mockCaptureFrame).not.toHaveBeenCalled()
  })

  it('should call captureFrame when layers are loaded and waitForData is true', async () => {
    const mockCaptureFrame = vi.fn()
    const captureDelay = 200

    // Deck with loaded layers
    const deckWithLoadedLayers = {
      setProps: vi.fn(),
      props: { layers: [{ isLoaded: true }] },
    }

    renderHook(() =>
      useDeckDrawLoop({
        deck: deckWithLoadedLayers as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
        isRendering: true,
        captureFrame: mockCaptureFrame,
        rendererConfig: { waitForData: true, captureDelay },
      })
    )

    const setPropsCall = deckWithLoadedLayers.setProps.mock.calls[0][0]
    const onAfterRender = setPropsCall.onAfterRender

    onAfterRender({})

    await act(async () => {
      vi.advanceTimersByTime(captureDelay)
    })

    expect(mockCaptureFrame).toHaveBeenCalledTimes(1)
  })

  it('should call original onAfterRender if provided in props', async () => {
    const mockOriginalOnAfterRender = vi.fn()
    const captureDelay = 200

    renderHook(() =>
      useDeckDrawLoop({
        deck: mockDeck as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
        isRendering: true,
        rendererConfig: { waitForData: false, captureDelay },
        props: { onAfterRender: mockOriginalOnAfterRender },
      })
    )

    const setPropsCall = mockDeck.setProps.mock.calls[0][0]
    const onAfterRender = setPropsCall.onAfterRender

    const context = { test: true }
    onAfterRender(context)

    // Original callback should be called with the context
    expect(mockOriginalOnAfterRender).toHaveBeenCalledWith(context)
  })

  it('should handle captureFrame being undefined (no-op)', async () => {
    const captureDelay = 200

    renderHook(() =>
      useDeckDrawLoop({
        deck: mockDeck as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
        isRendering: true,
        captureFrame: undefined,
        rendererConfig: { waitForData: false, captureDelay },
      })
    )

    const setPropsCall = mockDeck.setProps.mock.calls[0][0]
    const onAfterRender = setPropsCall.onAfterRender

    // Should not throw when captureFrame is undefined
    expect(() => {
      onAfterRender({})
    }).not.toThrow()

    await act(async () => {
      vi.advanceTimersByTime(captureDelay)
    })

    // No error should occur
  })
})

describe('useDeckDrawLoop effect re-run behavior', () => {
  // These tests verify the effect doesn't re-run unnecessarily,
  // which was causing the callback overwrite bug

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should re-run effect when isRendering changes from false to true', () => {
    const mockDeck = {
      setProps: vi.fn(),
      props: { layers: [] },
    }

    const { rerender } = renderHook(
      ({ isRendering }) =>
        useDeckDrawLoop({
          deck: mockDeck as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
          isRendering,
          rendererConfig: { waitForData: false, captureDelay: 200 },
        }),
      { initialProps: { isRendering: false } }
    )

    expect(mockDeck.setProps).not.toHaveBeenCalled()

    // Change isRendering to true
    rerender({ isRendering: true })

    expect(mockDeck.setProps).toHaveBeenCalled()
  })

  it('should not call setProps again when isRendering stays true across rerenders', () => {
    const mockDeck = {
      setProps: vi.fn(),
      props: { layers: [] },
    }
    const stableConfig = { waitForData: false, captureDelay: 200 }
    const stableProps = {}

    const { rerender } = renderHook(
      () =>
        useDeckDrawLoop({
          deck: mockDeck as unknown as Parameters<typeof useDeckDrawLoop>[0]['deck'],
          isRendering: true,
          rendererConfig: stableConfig,
          props: stableProps,
        }),
      {}
    )

    const initialCallCount = mockDeck.setProps.mock.calls.length

    // Rerender with same props
    rerender()
    rerender()
    rerender()

    // Effect should not have re-run (setProps call count should be the same)
    // Note: This depends on React's effect behavior with stable dependencies
    expect(mockDeck.setProps.mock.calls.length).toBe(initialCallCount)
  })
})
