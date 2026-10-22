import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasReplacedError, FrameTimeoutError, guardFrameStep } from './frame-guard'

// The guard's timers run in a Web Worker, so these use the real clock
beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  vi.useFakeTimers()
  document.body.replaceChildren()
})

function liveCanvas() {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return canvas
}

const never = () => new Promise<never>(() => {})
const later = <T>(value: T, ms: number) => new Promise<T>(r => setTimeout(() => r(value), ms))

describe('guardFrameStep', () => {
  it('passes the step through while the recorded canvas is still drawn', async () => {
    const canvas = liveCanvas()
    const guard = { recording: canvas, getCanvas: () => canvas }
    await expect(guardFrameStep(later('frame', 20), guard, 5000, 'slow')).resolves.toBe('frame')
  })

  it('passes a failed step through', async () => {
    const canvas = liveCanvas()
    const guard = { recording: canvas, getCanvas: () => canvas }
    const step = Promise.reject(new Error('draw failed'))
    await expect(guardFrameStep(step, guard, 5000, 'slow')).rejects.toThrow('draw failed')
  })

  it('fails at once when the canvas was already replaced', async () => {
    const recording = liveCanvas()
    const guard = { recording, getCanvas: () => liveCanvas() }
    await expect(guardFrameStep(never(), guard, 5000, 'slow')).rejects.toBeInstanceOf(
      CanvasReplacedError
    )
  })

  it('fails soon after the canvas is replaced mid-wait, not at the timeout', async () => {
    // The basemap is added: deck moves to the map's new canvas and the old one is removed
    const recording = liveCanvas()
    let current = recording
    const guard = { recording, getCanvas: () => current }
    setTimeout(() => {
      recording.remove()
      current = liveCanvas()
    }, 50)

    const start = performance.now()
    await expect(guardFrameStep(never(), guard, 60_000, 'slow')).rejects.toBeInstanceOf(
      CanvasReplacedError
    )
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('fails while the deck has no canvas, as when it was finalized', async () => {
    const recording = liveCanvas()
    const guard = { recording, getCanvas: () => null }
    await expect(guardFrameStep(never(), guard, 5000, 'slow')).rejects.toBeInstanceOf(
      CanvasReplacedError
    )
  })

  it('times out a step that never finishes on a live canvas', async () => {
    const canvas = liveCanvas()
    const guard = { recording: canvas, getCanvas: () => canvas }
    const result = guardFrameStep(never(), guard, 100, 'Frame 3 did not finish drawing')
    await expect(result).rejects.toBeInstanceOf(FrameTimeoutError)
    await expect(result).rejects.toThrow('Frame 3 did not finish drawing')
  })
})
