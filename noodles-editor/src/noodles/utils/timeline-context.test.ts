import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTimelineStore } from '../../timeline/timeline-store'
import {
  getTimelineContext,
  createTrackedTimelineContext,
  type TimelineVariable,
} from './timeline-context'

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

  describe('createTrackedTimelineContext', () => {
    it('tracks property access via callback', () => {
      const accessedVars: TimelineVariable[] = []
      const context = createTrackedTimelineContext((variable) => {
        accessedVars.push(variable)
      })

      // Access properties
      const _time = context.sequenceTime
      const _frame = context.frame
      const _length = context.sequence.length

      expect(accessedVars).toContain('sequenceTime')
      expect(accessedVars).toContain('frame')
      expect(accessedVars).toContain('sequence')
    })

    it('returns correct values when accessed', () => {
      const store = useTimelineStore.getState()
      store.setPosition(3)
      store.setFps(30)
      store.setLength(10)

      const context = createTrackedTimelineContext(() => {})

      expect(context.sequenceTime).toBe(3)
      expect(context.frame).toBe(90)
      expect(context.totalFrames).toBe(300)
      expect(context.sequence.length).toBe(10)
      expect(context.sequence.fps).toBe(30)
    })

    it('tracks multiple accesses to same property', () => {
      const accessedVars: TimelineVariable[] = []
      const context = createTrackedTimelineContext((variable) => {
        accessedVars.push(variable)
      })

      const _time1 = context.sequenceTime
      const _time2 = context.sequenceTime
      const _time3 = context.sequenceTime

      expect(accessedVars.filter((v) => v === 'sequenceTime')).toHaveLength(3)
    })

    it('does not track access to non-timeline properties', () => {
      const accessedVars: TimelineVariable[] = []
      const context = createTrackedTimelineContext((variable) => {
        accessedVars.push(variable)
      })

      // Try to access non-existent property (should not track)
      const _invalid = (context as any).nonExistentProperty

      expect(accessedVars).toHaveLength(0)
    })

    it('tracks nested sequence property access', () => {
      const accessedVars: TimelineVariable[] = []
      const context = createTrackedTimelineContext((variable) => {
        accessedVars.push(variable)
      })

      const _seq = context.sequence
      expect(accessedVars).toContain('sequence')

      // Accessing properties of sequence object doesn't trigger additional tracking
      const _len = _seq.length
      const _fps = _seq.fps
      expect(accessedVars).toHaveLength(1)
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
