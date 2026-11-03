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
    it('returns hold-linear-out when next keyframe is ease-in (linear left handle)', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('hold')
      const next = createKeyframe('bezier', easeInHandles) // left: [0,0] is linear
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-linear-out')
    })

    it('returns hold-linear-in when prev keyframe is ease-out (linear right handle)', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeOutHandles) // right: [1,1] is linear
      const next = createKeyframe('hold')
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-linear-in')
    })

    it('returns hold-ease-out when next keyframe has curved left handle', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('hold')
      const next = createKeyframe('bezier', easeOutHandles) // left: [0.58,0] is curved
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-ease-out')
    })

    it('returns hold-ease-in when prev keyframe has curved right handle', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeInHandles) // right: [0.42,1] is curved
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
    it('prioritizes right side when next has curved left handle', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeInHandles) // right: [0.42,1] curved
      const next = createKeyframe('bezier', easeOutHandles) // left: [0.58,0] curved
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-ease-out')
    })

    it('shows linear-out when next has linear left handle despite prev having curve', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeInHandles) // right: [0.42,1] curved
      const next = createKeyframe('bezier', easeInHandles) // left: [0,0] linear
      expect(getKeyframeShapeType(kf, prev, next)).toBe('hold-linear-out')
    })
  })

  describe('custom bezier handles', () => {
    it('classifies steep ease-in curve correctly', () => {
      const steepEaseIn: BezierHandles = {
        left: [0.05, 0.05],
        right: [0.2, 1],
        type: 'aligned',
      }
      const kf = createKeyframe('bezier', steepEaseIn)
      expect(getKeyframeShapeType(kf)).toBe('ease-in')
    })

    it('classifies steep ease-out curve correctly', () => {
      const steepEaseOut: BezierHandles = {
        left: [0.8, 0],
        right: [0.95, 0.95],
        type: 'aligned',
      }
      const kf = createKeyframe('bezier', steepEaseOut)
      expect(getKeyframeShapeType(kf)).toBe('ease-out')
    })

    it('classifies asymmetric easy-ease curve correctly', () => {
      const asymmetricEase: BezierHandles = {
        left: [0.3, 0.1],
        right: [0.7, 0.9],
        type: 'uneven',
      }
      const kf = createKeyframe('bezier', asymmetricEase)
      expect(getKeyframeShapeType(kf)).toBe('easy-ease')
    })

    it('detects near-linear handles as linear', () => {
      const nearLinear: BezierHandles = {
        left: [0.02, 0.04],
        right: [0.98, 0.96],
        type: 'aligned',
      }
      const kf = createKeyframe('bezier', nearLinear)
      expect(getKeyframeShapeType(kf)).toBe('linear')
    })

    it('detects handles just outside linear threshold as ease', () => {
      const justOutsideLinear: BezierHandles = {
        left: [0.1, 0],
        right: [0.9, 1],
        type: 'aligned',
      }
      const kf = createKeyframe('bezier', justOutsideLinear)
      expect(getKeyframeShapeType(kf)).toBe('easy-ease')
    })

    it('handles extreme bezier curves (overshoot)', () => {
      const overshoot: BezierHandles = {
        left: [0.6, -0.28],
        right: [0.735, 1.045],
        type: 'free',
      }
      const kf = createKeyframe('bezier', overshoot)
      expect(getKeyframeShapeType(kf)).toBe('easy-ease')
    })
  })

  describe('edge cases', () => {
    it('handles undefined prev keyframe', () => {
      const kf = createKeyframe('hold')
      const next = createKeyframe('bezier', easeInHandles) // left: [0,0] is linear
      expect(getKeyframeShapeType(kf, undefined, next)).toBe('hold-linear-out')
    })

    it('handles undefined next keyframe', () => {
      const kf = createKeyframe('hold')
      const prev = createKeyframe('bezier', easeInHandles) // right: [0.42,1] is curved
      expect(getKeyframeShapeType(kf, prev, undefined)).toBe('hold-ease-in')
    })

    it('returns hold when hold keyframe has no defined neighbors', () => {
      const kf = createKeyframe('hold')
      expect(getKeyframeShapeType(kf, undefined, undefined)).toBe('hold')
    })

    it('handles keyframe with no handles (uses defaults)', () => {
      const kf = createKeyframe('bezier')
      // Should use DEFAULT_BEZIER_HANDLES which are linear
      expect(getKeyframeShapeType(kf)).toBe('linear')
    })
  })
})
