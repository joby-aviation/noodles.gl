import type { Deck, DeckProps } from '@deck.gl/core'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDeckDrawLoop } from './draw-loop'

// Worker timers on the test's fake clock
vi.mock('../utils/worker-timer', () => ({
  workerSetTimeout: (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
  workerSetInterval: (fn: (ts: number) => void, ms: number) => {
    const id = setInterval(() => fn(performance.now()), ms)
    return () => clearInterval(id)
  },
}))

function fakeDeck() {
  const props: Partial<DeckProps> = { layers: [] }
  return {
    props,
    setProps: (next: Partial<DeckProps>) => Object.assign(props, next),
    redraw: vi.fn(),
  }
}

const rendererConfig = { waitForData: true, captureDelay: 200, captureMode: 'final' } as const

function renderLoop(deck: ReturnType<typeof fakeDeck>, captureFrame = vi.fn()) {
  return renderHook(
    ({ props, isRendering }: { props: Partial<DeckProps>; isRendering: boolean }) =>
      useDeckDrawLoop({
        deck: deck as unknown as Deck,
        isRendering,
        captureFrame,
        rendererConfig,
        props,
      }),
    { initialProps: { props: {}, isRendering: true } }
  )
}

// What deck does after drawing a frame: call the onAfterRender set last
function drawFrame(deck: ReturnType<typeof fakeDeck>) {
  deck.props.onAfterRender?.({} as never)
}

describe('useDeckDrawLoop', () => {
  afterEach(() => {
    cleanup()
  })

  it('stops redrawing once the frame is captured', async () => {
    const deck = fakeDeck()
    const captureFrame = vi.fn()
    renderLoop(deck, captureFrame)

    await vi.advanceTimersByTimeAsync(50)
    expect(deck.redraw).toHaveBeenCalled()
    drawFrame(deck)
    await vi.advanceTimersByTimeAsync(rendererConfig.captureDelay)
    expect(captureFrame).toHaveBeenCalledTimes(1)

    deck.redraw.mockClear()
    await vi.advanceTimersByTimeAsync(1000)
    expect(deck.redraw).not.toHaveBeenCalled()
  })

  // During an export the editor re-renders each time the engine publishes, several times a
  // frame, and each render passes new props. A pass replaced by the next one used to keep its
  // redraw loop running forever, so the map repainted nonstop and starved the frame reads.
  it('ends a pass when new props replace it', async () => {
    const deck = fakeDeck()
    const captureFrame = vi.fn()
    const { rerender } = renderLoop(deck, captureFrame)
    for (let i = 0; i < 3; i++) rerender({ props: {}, isRendering: true })

    drawFrame(deck)
    await vi.advanceTimersByTimeAsync(rendererConfig.captureDelay)
    expect(captureFrame).toHaveBeenCalledTimes(1)

    deck.redraw.mockClear()
    await vi.advanceTimersByTimeAsync(1000)
    expect(deck.redraw).not.toHaveBeenCalled()
  })

  it('stops redrawing when the export ends before the frame is drawn', async () => {
    const deck = fakeDeck()
    const captureFrame = vi.fn()
    const { rerender } = renderLoop(deck, captureFrame)
    rerender({ props: {}, isRendering: false })

    deck.redraw.mockClear()
    await vi.advanceTimersByTimeAsync(1000)
    expect(deck.redraw).not.toHaveBeenCalled()
    expect(captureFrame).not.toHaveBeenCalled()
  })
})
