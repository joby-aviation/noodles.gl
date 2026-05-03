import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelineStore } from '../../timeline/timeline-store'
import { getTimelineContext } from './timeline-context'

describe('timeline-context', () => {
  beforeEach(() => {
    // Reset timeline store to known state
    const store = useTimelineStore.getState()
    store.setPosition(0)
    store.setLength(10)
    store.setFps(30)
  })

  describe('getTimelineContext', () => {
    it('returns current timeline values', () => {
      const store = useTimelineStore.getState()
      store.setPosition(5)
      store.setLength(20)
      store.setFps(60)

      const context = getTimelineContext()

      expect(context.sequenceTime).toBe(5)
      expect(context.frame).toBe(300) // 5 * 60
      expect(context.totalFrames).toBe(1200) // 20 * 60
      expect(context.sequence).toEqual({ length: 20, fps: 60 })
    })

    it('computes frame from position and fps', () => {
      const store = useTimelineStore.getState()
      store.setPosition(2.5)
      store.setFps(24)

      const context = getTimelineContext()

      expect(context.frame).toBe(60) // Math.floor(2.5 * 24)
    })

    it('computes totalFrames from sequence length and fps', () => {
      const store = useTimelineStore.getState()
      store.setLength(15)
      store.setFps(30)

      const context = getTimelineContext()

      expect(context.totalFrames).toBe(450) // Math.floor(15 * 30)
    })
  })


  describe('edge cases', () => {
    it('handles zero position', () => {
      const store = useTimelineStore.getState()
      store.setPosition(0)
      store.setFps(30)

      const context = getTimelineContext()

      expect(context.sequenceTime).toBe(0)
      expect(context.frame).toBe(0)
    })

    it('handles fractional positions', () => {
      const store = useTimelineStore.getState()
      store.setPosition(1.234)
      store.setFps(30)

      const context = getTimelineContext()

      expect(context.sequenceTime).toBe(1.234)
      expect(context.frame).toBe(37) // Math.floor(1.234 * 30)
    })

    it('handles high fps values', () => {
      const store = useTimelineStore.getState()
      store.setPosition(1)
      store.setFps(120)
      store.setLength(10)

      const context = getTimelineContext()

      expect(context.frame).toBe(120)
      expect(context.totalFrames).toBe(1200)
    })
  })
})
