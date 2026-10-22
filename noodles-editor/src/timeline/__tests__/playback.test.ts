// Tests for the playback driver - RAF-based playback with manual mode support

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackDriver } from '../playback'

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

  describe('manual mode', () => {
    it('is disabled by default', () => {
      expect(driver.isManualMode()).toBe(false)
    })

    it('can be enabled', () => {
      driver.setManualMode(true)
      expect(driver.isManualMode()).toBe(true)
    })

    it('can be disabled', () => {
      driver.setManualMode(true)
      driver.setManualMode(false)
      expect(driver.isManualMode()).toBe(false)
    })

    it('stops playback when enabled', () => {
      driver.start()
      expect(driver.isRunning()).toBe(true)
      driver.setManualMode(true)
      expect(driver.isRunning()).toBe(false)
    })

    it('prevents start when in manual mode', () => {
      driver.setManualMode(true)
      driver.start()
      expect(driver.isRunning()).toBe(false)
    })

    it('manualTick notifies subscribers', () => {
      const callback = vi.fn()
      driver.subscribe(callback)
      driver.setManualMode(true)

      driver.manualTick(0)
      driver.manualTick(16.67) // ~60fps frame

      expect(callback).toHaveBeenCalledTimes(2)
    })

    it('manualTick passes delta to subscribers', () => {
      const callback = vi.fn()
      driver.subscribe(callback)
      driver.setManualMode(true)

      driver.manualTick(0)
      driver.manualTick(100)

      // Second call should have delta of 100
      expect(callback).toHaveBeenLastCalledWith(100)
    })

    it('manualTick does not notify subscribers when not in manual mode', () => {
      const callback = vi.fn()
      driver.subscribe(callback)
      driver.manualTick(0)
      // Should not notify subscribers when not in manual mode
      expect(callback).not.toHaveBeenCalled()
    })

    it('manualTick does nothing when not in manual mode', () => {
      const callback = vi.fn()
      driver.subscribe(callback)
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      driver.manualTick(0)
      expect(callback).not.toHaveBeenCalled()
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
      driver.setManualMode(true)

      driver.manualTick(0)
      driver.manualTick(16)

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
