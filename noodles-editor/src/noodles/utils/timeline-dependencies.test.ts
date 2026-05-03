import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTimelineStore } from '../../timeline/timeline-store'
import { timelineDependencyManager } from './timeline-dependencies'
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
      timelineDependencyManager.unsubscribe(op.id)
    }
    createdOps.length = 0
  })

  describe('TimelineDependencyManager', () => {
    it('tracks dependencies for an operator', () => {
      const op = new CodeOp('/test-op', { code: 'return sequenceTime' })
      createdOps.push(op)
      const deps = new Set(['sequenceTime'])

      timelineDependencyManager.trackDependencies(op.id, deps)

      const tracked = timelineDependencyManager.getDependencies(op.id)
      expect(tracked).toEqual(deps)
    })

    it('subscribes to position changes for sequenceTime dependency', () => {
      const op = new CodeOp('/test-op', { code: 'return sequenceTime' })
      createdOps.push(op)
      const deps = new Set(['sequenceTime'])

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      timelineDependencyManager.trackDependencies(op.id, deps)
      timelineDependencyManager.subscribe(op)

      // Change position - Zustand subscriptions are synchronous
      const store = useTimelineStore.getState()
      store.setPosition(5)

      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('subscribes to position changes for frame dependency', () => {
      const op = new CodeOp('/test-op', { code: 'return frame' })
      createdOps.push(op)
      const deps = new Set(['frame'])

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      timelineDependencyManager.trackDependencies(op.id, deps)
      timelineDependencyManager.subscribe(op)

      // Change position
      const store = useTimelineStore.getState()
      store.setPosition(2)

      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('subscribes to position changes for totalFrames dependency', () => {
      const op = new CodeOp('/test-op', { code: 'return totalFrames' })
      createdOps.push(op)
      const deps = new Set(['totalFrames'])

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      timelineDependencyManager.trackDependencies(op.id, deps)
      timelineDependencyManager.subscribe(op)

      // Change FPS (affects totalFrames)
      const store = useTimelineStore.getState()
      store.setFps(60)

      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('subscribes to sequence changes for sequence dependency', () => {
      const op = new CodeOp('/test-op', { code: 'return sequence.length' })
      createdOps.push(op)
      const deps = new Set(['sequence'])

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      timelineDependencyManager.trackDependencies(op.id, deps)
      timelineDependencyManager.subscribe(op)

      // Change sequence length
      const store = useTimelineStore.getState()
      store.setLength(20)

      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('does not subscribe if no dependencies', () => {
      const op = new CodeOp('/test-op', { code: 'return 42' })
      createdOps.push(op)
      const deps = new Set([])

      timelineDependencyManager.trackDependencies(op.id, deps)
      timelineDependencyManager.subscribe(op)

      // Should not crash or create subscriptions
      expect(timelineDependencyManager.getDependencies(op.id)).toEqual(deps)
    })

    it('unsubscribes and cleans up', () => {
      const op = new CodeOp('/test-op', { code: 'return sequenceTime' })
      createdOps.push(op)
      const deps = new Set(['sequenceTime'])

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      timelineDependencyManager.trackDependencies(op.id, deps)
      timelineDependencyManager.subscribe(op)

      // Unsubscribe
      timelineDependencyManager.unsubscribe(op.id)

      // Change position - should not trigger markDirty
      const store = useTimelineStore.getState()
      store.setPosition(5)

      expect(markDirtySpy).not.toHaveBeenCalled()
    })

    it('handles multiple dependencies', () => {
      const op = new CodeOp('/test-op', {
        code: 'return sequenceTime + sequence.length',
      })
      createdOps.push(op)
      const deps = new Set(['sequenceTime', 'sequence'])

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      timelineDependencyManager.trackDependencies(op.id, deps)
      timelineDependencyManager.subscribe(op)

      // Change position
      const store = useTimelineStore.getState()
      store.setPosition(3)

      expect(markDirtySpy).toHaveBeenCalled()

      markDirtySpy.mockClear()

      // Change sequence
      store.setLength(20)

      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('handles re-subscription with different dependencies', () => {
      const op = new CodeOp('/test-op', { code: 'return sequenceTime' })
      createdOps.push(op)

      // First subscription
      const deps1 = new Set(['sequenceTime'])
      timelineDependencyManager.trackDependencies(op.id, deps1)
      timelineDependencyManager.subscribe(op)

      // Re-subscribe with different dependencies
      const deps2 = new Set(['sequence'])
      timelineDependencyManager.trackDependencies(op.id, deps2)
      timelineDependencyManager.subscribe(op)

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      // Change position - should NOT trigger (no longer subscribed)
      const store = useTimelineStore.getState()
      store.setPosition(5)
      expect(markDirtySpy).not.toHaveBeenCalled()

      markDirtySpy.mockClear()

      // Change sequence - SHOULD trigger
      store.setLength(20)
      expect(markDirtySpy).toHaveBeenCalled()
    })

    it('handles multiple operators with different dependencies', () => {
      const op1 = new CodeOp('/op1', { code: 'return sequenceTime' })
      const op2 = new CodeOp('/op2', { code: 'return sequence.length' })
      createdOps.push(op1, op2)

      timelineDependencyManager.trackDependencies(op1.id, new Set(['sequenceTime']))
      timelineDependencyManager.subscribe(op1)

      timelineDependencyManager.trackDependencies(op2.id, new Set(['sequence']))
      timelineDependencyManager.subscribe(op2)

      const markDirty1Spy = vi.spyOn(op1, 'markDirty')
      const markDirty2Spy = vi.spyOn(op2, 'markDirty')

      // Change position - only op1 should be marked dirty
      const store = useTimelineStore.getState()
      store.setPosition(3)
      expect(markDirty1Spy).toHaveBeenCalled()
      expect(markDirty2Spy).not.toHaveBeenCalled()

      markDirty1Spy.mockClear()
      markDirty2Spy.mockClear()

      // Change sequence - only op2 should be marked dirty
      store.setLength(20)
      expect(markDirty1Spy).not.toHaveBeenCalled()
      expect(markDirty2Spy).toHaveBeenCalled()
    })
  })
})
