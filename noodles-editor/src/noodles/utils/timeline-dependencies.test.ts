import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTimelineStore } from '../../timeline/timeline-store'
import {
  subscribeOpToTimeline,
  unsubscribeOpFromTimeline,
  useTimelineDependencyStore,
} from './timeline-dependencies'
import { CodeOp } from '../operators'

describe('timeline-dependencies', () => {
  const createdOps: CodeOp[] = []

  beforeEach(() => {
    // Reset timeline store
    const store = useTimelineStore.getState()
    store.setPosition(0)
    store.setLength(10)
    store.setFps(30)
  })

  afterEach(() => {
    // Clean up all created operators
    for (const op of createdOps) {
      unsubscribeOpFromTimeline(op.id)
    }
    createdOps.length = 0
  })

  describe('Timeline subscriptions', () => {
    it('subscribes an operator to timeline changes', () => {
      const op = new CodeOp('/test-op', { code: 'return sequenceTime' })
      createdOps.push(op)

      subscribeOpToTimeline(op)

      const subscriptions = useTimelineDependencyStore.getState().subscriptions
      expect(subscriptions.has(op.id)).toBe(true)
    })

    it('marks operator dirty on position changes', () => {
      const op = new CodeOp('/test-op', { code: 'return sequenceTime' })
      createdOps.push(op)

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      subscribeOpToTimeline(op)

      // Change position - Zustand subscriptions are synchronous
      const store = useTimelineStore.getState()
      store.setPosition(5)

      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('marks operator dirty on FPS changes', () => {
      const op = new CodeOp('/test-op', { code: 'return frame' })
      createdOps.push(op)

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      subscribeOpToTimeline(op)

      // Change FPS
      const store = useTimelineStore.getState()
      store.setFps(60)

      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('marks operator dirty on sequence length changes', () => {
      const op = new CodeOp('/test-op', { code: 'return totalFrames' })
      createdOps.push(op)

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      subscribeOpToTimeline(op)

      // Change sequence length (affects totalFrames)
      const store = useTimelineStore.getState()
      store.setLength(20)

      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('unsubscribes and cleans up', () => {
      const op = new CodeOp('/test-op', { code: 'return sequenceTime' })
      createdOps.push(op)

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      subscribeOpToTimeline(op)

      // Unsubscribe
      unsubscribeOpFromTimeline(op.id)

      // Change position - should not trigger markDirty
      const store = useTimelineStore.getState()
      store.setPosition(5)

      expect(markDirtySpy).not.toHaveBeenCalled()
    })

    it('handles multiple operators independently', () => {
      const op1 = new CodeOp('/op1', { code: 'return sequenceTime' })
      const op2 = new CodeOp('/op2', { code: 'return sequence.length' })
      createdOps.push(op1, op2)

      subscribeOpToTimeline(op1)
      subscribeOpToTimeline(op2)

      const markDirty1Spy = vi.spyOn(op1, 'markDirty')
      const markDirty2Spy = vi.spyOn(op2, 'markDirty')

      // Change position - both should be marked dirty (both subscribe to all timeline changes)
      const store = useTimelineStore.getState()
      store.setPosition(3)
      expect(markDirty1Spy).toHaveBeenCalled()
      expect(markDirty2Spy).toHaveBeenCalled()
    })
  })
})
