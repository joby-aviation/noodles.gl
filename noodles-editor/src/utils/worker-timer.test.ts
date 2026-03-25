import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workerSetInterval, workerSetTimeout } from './worker-timer'

// Tests use real timers because the Worker runs its own unthrottled setInterval/setTimeout.
// setupTests.ts installs fake timers globally so we restore real timers per-test.
beforeEach(() => vi.useRealTimers())
afterEach(() => vi.useFakeTimers())

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('workerSetTimeout', () => {
  it('fires callback exactly once after the delay', async () => {
    const fn = vi.fn()
    workerSetTimeout(fn, 20)
    await wait(80)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel() prevents the callback from firing', async () => {
    const fn = vi.fn()
    const cancel = workerSetTimeout(fn, 50)
    cancel()
    await wait(100)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('workerSetInterval', () => {
  it('fires callback repeatedly at the interval', async () => {
    const fn = vi.fn()
    const cancel = workerSetInterval(fn, 20)
    await wait(90)
    cancel()
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('cancel() stops further callbacks', async () => {
    const fn = vi.fn()
    const cancel = workerSetInterval(fn, 20)
    await wait(60)
    cancel()
    const countAtCancel = fn.mock.calls.length
    await wait(60)
    expect(fn.mock.calls.length).toBe(countAtCancel)
  })

  it('passes a numeric timestamp to the callback', async () => {
    let ts: number | undefined
    const before = performance.now()
    const cancel = workerSetInterval(t => {
      ts = t
    }, 20)
    await wait(60)
    cancel()
    const after = performance.now()
    expect(typeof ts).toBe('number')
    expect(ts!).toBeGreaterThanOrEqual(before)
    expect(ts!).toBeLessThanOrEqual(after)
  })
})
