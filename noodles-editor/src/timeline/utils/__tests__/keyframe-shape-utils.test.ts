import { describe, expect, it } from 'vitest'
import type { BezierHandles, Keyframe } from '../../types'
import { getKeyframeShapeType } from '../keyframe-shape-utils'

// Test helpers
function createKeyframe(
  interpolation: 'hold' | 'linear' | 'bezier',
  handles?: BezierHandles
): Keyframe {
  return {
    id: 'test',
    position: 0,
    value: 0,
    interpolation,
    handles,
  }
}

const linearHandles: BezierHandles = {
  left: [0, 0],
  right: [1, 1],
  type: 'aligned',
}

const easeInHandles: BezierHandles = {
  left: [0, 0],
  right: [0.42, 1],
  type: 'aligned',
}

const easeOutHandles: BezierHandles = {
  left: [0.58, 0],
  right: [1, 1],
  type: 'aligned',
}

const easyEaseHandles: BezierHandles = {
  left: [0.42, 0],
  right: [0.58, 1],
  type: 'aligned',
}

describe('getKeyframeShapeType', () => {
  describe('basic interpolation types', () => {
    it('returns linear for linear interpolation', () => {
      const kf = createKeyframe('linear')
      expect(getKeyframeShapeType(kf)).toBe('linear')
    })

    it('returns linear for bezier with linear handles', () => {
      const kf = createKeyframe('bezier', linearHandles)
      expect(getKeyframeShapeType(kf)).toBe('linear')
    })

    it('returns ease-in for bezier with ease-in handles', () => {
      const kf = createKeyframe('bezier', easeInHandles)
      expect(getKeyframeShapeType(kf)).toBe('ease-in')
    })

    it('returns ease-out for bezier with ease-out handles', () => {
      const kf = createKeyframe('bezier', easeOutHandles)
      expect(getKeyframeShapeType(kf)).toBe('ease-out')
    })

    it('returns easy-ease for bezier with curved handles on both sides', () => {
      const kf = createKeyframe('bezier', easyEaseHandles)
      expect(getKeyframeShapeType(kf)).toBe('easy-ease')
    })
  })

  describe('hold keyframes without neighbors', () => {
    it('returns hold when no prev/next keyframes', () => {
      const kf = createKeyframe('hold')
      expect(getKeyframeShapeType(kf)).toBe('hold')
    })

    it('returns hold when both neighbors are hold', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('hold')
      const next = createKeyframe('hold')
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold')
    })
  })

  describe('hold keyframes with easing neighbors', () => {
    it('returns hold-ease-out when next keyframe has easing', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('hold')
      const next = createKeyframe('bezier', easeInHandles)
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-ease-out')
    })

    it('returns hold-ease-in when prev keyframe has easing', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeInHandles)
      const next = createKeyframe('hold')
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-ease-in')
    })

    it('returns hold-linear-out when next keyframe is linear', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('hold')
      const next = createKeyframe('linear')
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-linear-out')
    })

    it('returns hold-linear-in when prev keyframe is linear', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('linear')
      const next = createKeyframe('hold')
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-linear-in')
    })
  })

  describe('hold keyframes with easing on both sides', () => {
    it('prioritizes right side (next keyframe) for ease-out', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeInHandles)
      const next = createKeyframe('bezier', easeInHandles)
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-ease-out')
    })

    it('prioritizes right side (next keyframe) for linear-out', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeInHandles)
      const next = createKeyframe('linear')
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-linear-out')
    })
  })

  describe('edge cases', () => {
    it('handles undefined prev keyframe', () => {
      const kf = createKeyframe('hold')
      const next = createKeyframe('bezier', easeInHandles)
      expect(getKeyframeShapeType(kf, undefined, next)).toBe('hold-ease-out')
    })

    it('handles undefined next keyframe', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeInHandles)
      expect(getKeyframeShapeType(kf, prev, undefined)).toBe('hold-ease-in')
    })

    it('returns hold when hold keyframe has no defined neighbors', () => {
      const kf = createKeyframe('hold')
      expect(getKeyframeShapeType(kf, undefined, undefined)).toBe('hold')
    })
  })
})
