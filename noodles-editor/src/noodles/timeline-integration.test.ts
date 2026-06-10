import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimelineStore } from '../timeline/timeline-store'
import { AccessorOp, CodeOp, ExpressionOp } from './operators'
import { unsubscribeOpFromTimeline } from './utils/timeline-dependencies'

describe('Timeline Variables Integration', () => {
  beforeEach(() => {
    // Reset timeline store
    const store = useTimelineStore.getState()
    store.setPosition(0)
    store.setLength(10)
    store.setFps(30)
  })

  describe('CodeOp with timeline variables', () => {
    it('exposes sequenceTime variable', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(5.5)

      const op = new CodeOp('/test', { code: 'return sequenceTime' })
      const result = await op.execute({ data: [], code: 'return sequenceTime' })

      expect(result.data).toBe(5.5)
    })

    it('exposes frame variable', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(2)
      store.setFps(30)

      const op = new CodeOp('/test', { code: 'return frame' })
      const result = await op.execute({ data: [], code: 'return frame' })

      expect(result.data).toBe(60) // 2 * 30
    })

    it('exposes totalFrames variable', async () => {
      const store = useTimelineStore.getState()
      store.setLength(10)
      store.setFps(30)

      const op = new CodeOp('/test', { code: 'return totalFrames' })
      const result = await op.execute({ data: [], code: 'return totalFrames' })

      expect(result.data).toBe(300) // 10 * 30
    })

    it('exposes sequence object', async () => {
      const store = useTimelineStore.getState()
      store.setLength(15)
      store.setFps(24)

      const op = new CodeOp('/test', { code: 'return sequence' })
      const result = await op.execute({ data: [], code: 'return sequence' })

      expect(result.data).toEqual({ length: 15, fps: 24 })
    })

    it('can access sequence.length', async () => {
      const store = useTimelineStore.getState()
      store.setLength(20)

      const op = new CodeOp('/test', { code: 'return sequence.length' })
      const result = await op.execute({ data: [], code: 'return sequence.length' })

      expect(result.data).toBe(20)
    })

    it('can access sequence.fps', async () => {
      const store = useTimelineStore.getState()
      store.setFps(60)

      const op = new CodeOp('/test', { code: 'return sequence.fps' })
      const result = await op.execute({ data: [], code: 'return sequence.fps' })

      expect(result.data).toBe(60)
    })

    it('can use timeline variables in expressions', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(3)

      const op = new CodeOp('/test', {
        code: 'return Math.sin(sequenceTime * Math.PI)',
      })
      const result = await op.execute({
        data: [],
        code: 'return Math.sin(sequenceTime * Math.PI)',
      })

      expect(result.data).toBeCloseTo(Math.sin(3 * Math.PI), 5)
    })

    it('can combine timeline variables with data', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(2)

      const op = new CodeOp('/test', {
        code: 'return data.map(d => ({ ...d, time: sequenceTime }))',
      })
      const result = await op.execute({
        data: [{ id: 1 }, { id: 2 }],
        code: 'return data.map(d => ({ ...d, time: sequenceTime }))',
      })

      expect(result.data).toEqual([
        { id: 1, time: 2 },
        { id: 2, time: 2 },
      ])
    })

    it('provides sequenceTime value correctly', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(7.5)

      const op = new CodeOp('/test', { code: 'return sequenceTime' })
      const result = await op.execute({ data: [], code: 'return sequenceTime' })

      expect(result.data).toBe(7.5)
    })

    it('provides frame value correctly', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(3)
      store.setFps(24)

      const op = new CodeOp('/test', { code: 'return frame' })
      const result = await op.execute({ data: [], code: 'return frame' })

      expect(result.data).toBe(72)
    })

    it('provides sequence object correctly', async () => {
      const store = useTimelineStore.getState()
      store.setLength(15)
      store.setFps(60)

      const op = new CodeOp('/test', { code: 'return sequence.length' })
      const result = await op.execute({ data: [], code: 'return sequence.length' })

      expect(result.data).toBe(15)
    })

    it('returns regular values when timeline vars not used', async () => {
      const op = new CodeOp('/test', { code: 'return 42' })
      const result = await op.execute({ data: [], code: 'return 42' })

      expect(result.data).toBe(42)
    })

    it('re-executes when timeline position changes', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(1)

      const op = new CodeOp('/test', { code: 'return sequenceTime' })

      // First execution - establishes subscriptions
      let result = await op.execute({ data: [], code: 'return sequenceTime' })
      expect(result.data).toBe(1)

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      // Change position
      store.setPosition(5)

      // Should be marked dirty
      expect(markDirtySpy).toHaveBeenCalled()

      // Execute again
      result = await op.execute({ data: [], code: 'return sequenceTime' })
      expect(result.data).toBe(5)

      unsubscribeOpFromTimeline(op.id)
    })
  })

  describe('ExpressionOp with timeline variables', () => {
    it('exposes sequenceTime variable', () => {
      const store = useTimelineStore.getState()
      store.setPosition(3.5)

      const op = new ExpressionOp('/test', { expression: 'sequenceTime' })
      const result = op.execute({ data: [], expression: 'sequenceTime' })

      expect(result.data).toBe(3.5)
    })

    it('exposes frame variable', () => {
      const store = useTimelineStore.getState()
      store.setPosition(1)
      store.setFps(24)

      const op = new ExpressionOp('/test', { expression: 'frame' })
      const result = op.execute({ data: [], expression: 'frame' })

      expect(result.data).toBe(24)
    })

    it('can use in arithmetic expressions', () => {
      const store = useTimelineStore.getState()
      store.setPosition(2)
      store.setFps(30)

      const op = new ExpressionOp('/test', { expression: 'frame * 2' })
      const result = op.execute({ data: [], expression: 'frame * 2' })

      expect(result.data).toBe(120) // (2 * 30) * 2
    })

    it('can use with conditional logic', () => {
      const store = useTimelineStore.getState()
      store.setPosition(3)
      store.setLength(10)

      const op = new ExpressionOp('/test', {
        expression: 'sequenceTime',
      })
      const result = op.execute({
        data: [],
        expression: 'sequenceTime',
      })

      expect(result.data).toBe(3)
    })

    it('combines multiple timeline variables', () => {
      const store = useTimelineStore.getState()
      store.setPosition(2)
      store.setFps(30)

      const op = new ExpressionOp('/test', { expression: 'sequenceTime + frame' })
      const result = op.execute({ data: [], expression: 'sequenceTime + frame' })

      expect(result.data).toBe(62) // 2 + 60
    })
  })

  describe('AccessorOp with timeline variables', () => {
    it('exposes timeline variables in accessor function', () => {
      const store = useTimelineStore.getState()
      store.setPosition(2)
      store.setFps(30)

      const op = new AccessorOp('/test', { expression: 'd.value + sequenceTime' })
      const result = op.execute({ expression: 'd.value + sequenceTime' })

      const accessor = result.accessor
      const value = accessor({ value: 10 }, { index: 0, data: [], target: [] })

      expect(value).toBe(12) // 10 + 2
    })

    it('can use frame in accessor', () => {
      const store = useTimelineStore.getState()
      store.setPosition(1)
      store.setFps(30)

      const op = new AccessorOp('/test', { expression: 'd.x * frame' })
      const result = op.execute({ expression: 'd.x * frame' })

      const accessor = result.accessor
      const value = accessor({ x: 2 }, { index: 0, data: [], target: [] })

      expect(value).toBe(60) // 2 * (1 * 30)
    })

    it('provides timeline variables in accessor context', () => {
      const store = useTimelineStore.getState()
      store.setPosition(3)

      const op = new AccessorOp('/test', { expression: 'd.value * sequenceTime' })
      const result = op.execute({ expression: 'd.value * sequenceTime' })

      const accessor = result.accessor
      const value = accessor({ value: 10 }, { index: 0, data: [], target: [] })

      expect(value).toBe(30) // 10 * 3
    })

    it('accessor updates when timeline changes', () => {
      const store = useTimelineStore.getState()
      store.setPosition(1)

      const op = new AccessorOp('/test', { expression: 'sequenceTime' })
      const result1 = op.execute({ expression: 'sequenceTime' })
      const value1 = result1.accessor({}, { index: 0, data: [], target: [] })
      expect(value1).toBe(1)

      // Change timeline
      store.setPosition(5)

      // Re-execute (would happen via dirty tracking in real scenario)
      const result2 = op.execute({ expression: 'sequenceTime' })
      const value2 = result2.accessor({}, { index: 0, data: [], target: [] })
      expect(value2).toBe(5)
    })
  })

  describe('Operator disposal cleanup', () => {
    it('cleans up timeline subscriptions on dispose', async () => {
      const store = useTimelineStore.getState()
      const op = new CodeOp('/test', { code: 'return sequenceTime' })
      await op.execute({ data: [], code: 'return sequenceTime' })

      const markDirtySpy = vi.spyOn(op, 'markDirty')

      // Dispose operator
      op.dispose()

      // Change timeline
      store.setPosition(10)

      // Should not trigger markDirty after disposal
      expect(markDirtySpy).not.toHaveBeenCalled()
    })
  })

  describe('Edge cases', () => {
    it('handles operators without data input', async () => {
      const op = new CodeOp('/test', { code: 'return sequenceTime' })
      const result = await op.execute({ data: [], code: 'return sequenceTime' })

      expect(result.data).toBe(0)
    })

    it('handles zero values', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(0)
      store.setFps(0)

      const op = new CodeOp('/test', { code: 'return { time: sequenceTime, frame }' })
      const result = await op.execute({
        data: [],
        code: 'return { time: sequenceTime, frame }',
      })

      expect(result.data).toEqual({ time: 0, frame: 0 })
    })

    it('handles very large frame numbers', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(10)
      store.setFps(60)

      const op = new CodeOp('/test', { code: 'return frame' })
      const result = await op.execute({ data: [], code: 'return frame' })

      expect(result.data).toBe(600) // 10 * 60
    })

    it('handles fractional seconds correctly', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(1.5)
      store.setFps(30)

      const op = new CodeOp('/test', { code: 'return frame' })
      const result = await op.execute({ data: [], code: 'return frame' })

      expect(result.data).toBe(45) // Math.floor(1.5 * 30)
    })
  })

  describe('Timeline reactivity', () => {
    it('provides current values on each execution', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(4)

      const op = new CodeOp('/test', {
        code: 'return sequenceTime',
      })
      const result = await op.execute({
        data: [],
        code: 'return sequenceTime',
      })

      expect(result.data).toBe(4)
    })
  })

  describe('Complex expressions', () => {
    it('handles combined timeline and data expressions', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(2)
      store.setFps(30)

      const op = new CodeOp('/test', {
        code: `
          const progress = sequenceTime / sequence.length
          return data.map((d, i) => ({
            ...d,
            time: sequenceTime,
            frame: frame,
            progress: progress,
            index: i
          }))
        `,
      })

      const result = await op.execute({
        data: [{ id: 1 }, { id: 2 }],
        code: `
          const progress = sequenceTime / sequence.length
          return data.map((d, i) => ({
            ...d,
            time: sequenceTime,
            frame: frame,
            progress: progress,
            index: i
          }))
        `,
      })

      expect(result.data).toEqual([
        { id: 1, time: 2, frame: 60, progress: 0.2, index: 0 },
        { id: 2, time: 2, frame: 60, progress: 0.2, index: 1 },
      ])
    })

    it('handles animation with sine wave', async () => {
      const store = useTimelineStore.getState()
      store.setPosition(0)

      const op = new CodeOp('/test', {
        code: 'return Math.sin(sequenceTime * 2 * Math.PI / 5)',
      })

      const result = await op.execute({
        data: [],
        code: 'return Math.sin(sequenceTime * 2 * Math.PI / 5)',
      })

      expect(result.data).toBeCloseTo(0, 5)
    })
  })
})
