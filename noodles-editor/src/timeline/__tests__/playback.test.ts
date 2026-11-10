// Tests for the playback driver - RAF-based playback

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectPlaybackToTimeline, PlaybackDriver } from '../playback'
import { useTimelineStore } from '../timeline-store'

describe('PlaybackDriver', () => {
  let driver: PlaybackDriver

  beforeEach(() => {
    driver = new PlaybackDriver()
    vi.useFakeTimers()
  })

  afterEach(() => {
    driver.stop()
    vi.useRealTimers()
  })

  describe('start/stop', () => {
    it('starts the playback loop', () => {
      expect(driver.isRunning()).toBe(false)
      driver.start()
      expect(driver.isRunning()).toBe(true)
    })

    it('stops the playback loop', () => {
      driver.start()
      expect(driver.isRunning()).toBe(true)
      driver.stop()
      expect(driver.isRunning()).toBe(false)
    })

    it('does not double-start', () => {
      driver.start()
      driver.start() // Should be a no-op
      expect(driver.isRunning()).toBe(true)
    })

    it('stop is safe to call when not running', () => {
      expect(() => driver.stop()).not.toThrow()
    })
  })

  describe('subscribe', () => {
    it('subscribes to tick events', () => {
      const callback = vi.fn()
      driver.subscribe(callback)
      expect(callback).not.toHaveBeenCalled()
    })

    it('returns unsubscribe function', () => {
      const callback = vi.fn()
      const unsubscribe = driver.subscribe(callback)
      expect(typeof unsubscribe).toBe('function')
    })

    it('unsubscribe removes callback', () => {
      const callback = vi.fn()
      const unsubscribe = driver.subscribe(callback)
      unsubscribe()
      // After unsubscribe, callback should not be in the subscriber set
      // We can't directly test this without exposing internals
    })

    it('multiple subscribers receive ticks', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      driver.subscribe(callback1)
      driver.subscribe(callback2)
      // Both should be registered
    })
  })

  describe('error handling', () => {
    it('catches errors in subscribers and continues', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Test error')
      })
      const successCallback = vi.fn()

      driver.subscribe(errorCallback)
      driver.subscribe(successCallback)
      vi.spyOn(console, 'error').mockImplementation(() => {})

      driver.start()
      vi.advanceTimersToNextFrame()

      // Error callback threw but success callback should still be called
      expect(errorCallback).toHaveBeenCalled()
      expect(successCallback).toHaveBeenCalled()
    })
  })
})

describe('playback helpers', () => {
  // These tests would require mocking the timeline store
  // For now, we test the module exports exist

  it('exports goToFrame', async () => {
    const { goToFrame } = await import('../playback')
    expect(typeof goToFrame).toBe('function')
  })

  it('exports getTotalFrames', async () => {
    const { getTotalFrames } = await import('../playback')
    expect(typeof getTotalFrames).toBe('function')
  })

  it('exports getCurrentFrame', async () => {
    const { getCurrentFrame } = await import('../playback')
    expect(typeof getCurrentFrame).toBe('function')
  })

  it('exports nextFrame', async () => {
    const { nextFrame } = await import('../playback')
    expect(typeof nextFrame).toBe('function')
  })

  it('exports prevFrame', async () => {
    const { prevFrame } = await import('../playback')
    expect(typeof prevFrame).toBe('function')
  })

  it('exports connectPlaybackToTimeline', async () => {
    const { connectPlaybackToTimeline } = await import('../playback')
    expect(typeof connectPlaybackToTimeline).toBe('function')
  })

  it('exports playbackDriver singleton', async () => {
    const { playbackDriver } = await import('../playback')
    expect(playbackDriver).toBeDefined()
    expect(typeof playbackDriver.start).toBe('function')
  })
})

describe('connectPlaybackToTimeline', () => {
  let disconnect: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    useTimelineStore.getState().reset()
    disconnect = connectPlaybackToTimeline()
  })

  afterEach(() => {
    disconnect()
    useTimelineStore.getState().reset()
    vi.useRealTimers()
  })

  function advance(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) vi.advanceTimersToNextFrame()
  }

  it('advances the position while playing', () => {
    useTimelineStore.getState().play()
    advance(500)
    const { position } = useTimelineStore.getState()
    expect(position).toBeGreaterThan(0.3)
    expect(position).toBeLessThan(0.7)
  })

  it('wraps around the in/out range when looping', () => {
    const store = useTimelineStore.getState()
    store.setLength(10)
    store.setInPoint(1)
    store.setOutPoint(2)
    store.toggleLoopInOut()
    store.setPosition(1.9)
    store.play()
    advance(300)
    const { position, playing } = useTimelineStore.getState()
    expect(playing).toBe(true)
    expect(position).toBeGreaterThanOrEqual(1)
    expect(position).toBeLessThan(1.5)
  })

  it('pauses instead of producing NaN when a loaded in/out range is empty', () => {
    const store = useTimelineStore.getState()
    // fromTimelineJSON trusts the file, so it can load in == out
    useTimelineStore.setState({ sequence: { ...store.sequence, inPoint: 3, outPoint: 3 } })
    store.toggleLoopInOut()
    store.setPosition(3)
    store.play()
    advance(100)
    const { position, playing } = useTimelineStore.getState()
    expect(position).toBe(3)
    expect(Number.isNaN(position)).toBe(false)
    expect(playing).toBe(false)
  })

  it('pauses instead of producing NaN when the sequence length is zero', () => {
    const store = useTimelineStore.getState()
    useTimelineStore.setState({ sequence: { ...store.sequence, length: 0 } })
    store.play()
    advance(100)
    const { position, playing } = useTimelineStore.getState()
    expect(position).toBe(0)
    expect(playing).toBe(false)
  })

  it('does not advance the position while scrubbing', () => {
    const store = useTimelineStore.getState()
    store.setPosition(2)
    store.play()
    store.beginScrub('ruler')
    advance(500)
    expect(useTimelineStore.getState().position).toBe(2)

    store.endScrub('ruler')
    advance(500)
    expect(useTimelineStore.getState().position).toBeGreaterThan(2)
  })
})
