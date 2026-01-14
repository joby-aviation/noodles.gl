import { describe, expect, it } from 'vitest'
import {
  evaluateBezierEasing,
  evaluateCubicBezier,
  evaluateTrack,
  findSurroundingKeyframes,
  findTForX,
  interpolateBetweenKeyframes,
  interpolateColor,
  interpolateCompound,
  interpolateNumber,
  interpolatePoint2D,
  interpolatePoint3D,
  interpolateValue,
  interpolateVec2,
  interpolateVec3,
} from '../interpolation'
import type { Keyframe, Track } from '../types'

describe('evaluateCubicBezier', () => {
  it('returns p0 at t=0', () => {
    expect(evaluateCubicBezier(0, 0, 0.25, 0.75, 1)).toBe(0)
  })

  it('returns p3 at t=1', () => {
    expect(evaluateCubicBezier(1, 0, 0.25, 0.75, 1)).toBe(1)
  })

  it('returns midpoint for linear curve at t=0.5', () => {
    expect(evaluateCubicBezier(0.5, 0, 0.333, 0.666, 1)).toBeCloseTo(0.5, 2)
  })

  it('handles negative control points (back easing)', () => {
    const result = evaluateCubicBezier(0.5, 0, -0.5, 1.5, 1)
    expect(result).toBeDefined()
    expect(typeof result).toBe('number')
  })
})

describe('findTForX', () => {
  it('returns 0 for x=0', () => {
    expect(findTForX(0, 0.25, 0.75)).toBe(0)
  })

  it('returns 1 for x=1', () => {
    expect(findTForX(1, 0.25, 0.75)).toBe(1)
  })

  it('returns x for linear curve', () => {
    expect(findTForX(0.5, 0, 1)).toBeCloseTo(0.5, 4)
    expect(findTForX(0.25, 0, 1)).toBeCloseTo(0.25, 4)
    expect(findTForX(0.75, 0, 1)).toBeCloseTo(0.75, 4)
  })

  it('converges for ease-in curve', () => {
    // ease-in: cubic-bezier(0.42, 0, 1, 1)
    const t = findTForX(0.5, 0.42, 1)
    expect(t).toBeGreaterThan(0.3)
    expect(t).toBeLessThan(0.5)
  })

  it('converges for ease-out curve', () => {
    // ease-out: cubic-bezier(0, 0, 0.58, 1)
    const t = findTForX(0.5, 0, 0.58)
    expect(t).toBeGreaterThan(0.5)
    expect(t).toBeLessThan(0.7)
  })
})

describe('evaluateBezierEasing', () => {
  it('returns 0 at x=0', () => {
    expect(evaluateBezierEasing(0, { left: [0.25, 0.1], right: [0.25, 1], type: 'aligned' })).toBe(0)
  })

  it('returns 1 at x=1', () => {
    expect(evaluateBezierEasing(1, { left: [0.25, 0.1], right: [0.25, 1], type: 'aligned' })).toBe(1)
  })

  it('returns 0.5 at x=0.5 for linear curve', () => {
    expect(evaluateBezierEasing(0.5, { left: [0, 0], right: [1, 1], type: 'aligned' })).toBeCloseTo(
      0.5,
      4
    )
  })

  it('returns values between 0 and 1 for standard curves', () => {
    // ease: cubic-bezier(0.25, 0.1, 0.25, 1)
    const result = evaluateBezierEasing(0.5, { left: [0.25, 0.1], right: [0.25, 1], type: 'aligned' })
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })
})

describe('interpolateNumber', () => {
  it('returns v1 at t=0', () => {
    expect(interpolateNumber(10, 20, 0)).toBe(10)
  })

  it('returns v2 at t=1', () => {
    expect(interpolateNumber(10, 20, 1)).toBe(20)
  })

  it('returns midpoint at t=0.5', () => {
    expect(interpolateNumber(10, 20, 0.5)).toBe(15)
  })

  it('handles negative numbers', () => {
    expect(interpolateNumber(-10, 10, 0.5)).toBe(0)
  })
})

describe('interpolateColor', () => {
  const red = { r: 1, g: 0, b: 0, a: 1 }
  const blue = { r: 0, g: 0, b: 1, a: 1 }

  it('returns c1 at t=0', () => {
    expect(interpolateColor(red, blue, 0)).toEqual(red)
  })

  it('returns c2 at t=1', () => {
    expect(interpolateColor(red, blue, 1)).toEqual(blue)
  })

  it('interpolates between colors at t=0.5', () => {
    const result = interpolateColor(red, blue, 0.5)
    expect(result.r).toBeCloseTo(0.5)
    expect(result.g).toBe(0)
    expect(result.b).toBeCloseTo(0.5)
    expect(result.a).toBe(1)
  })
})

describe('interpolateVec2', () => {
  const v1 = { x: 0, y: 0 }
  const v2 = { x: 10, y: 20 }

  it('returns v1 at t=0', () => {
    expect(interpolateVec2(v1, v2, 0)).toEqual(v1)
  })

  it('returns v2 at t=1', () => {
    expect(interpolateVec2(v1, v2, 1)).toEqual(v2)
  })

  it('interpolates at t=0.5', () => {
    expect(interpolateVec2(v1, v2, 0.5)).toEqual({ x: 5, y: 10 })
  })
})

describe('interpolateVec3', () => {
  const v1 = { x: 0, y: 0, z: 0 }
  const v2 = { x: 10, y: 20, z: 30 }

  it('interpolates all three components', () => {
    expect(interpolateVec3(v1, v2, 0.5)).toEqual({ x: 5, y: 10, z: 15 })
  })
})

describe('interpolatePoint2D', () => {
  const p1 = { lng: -122, lat: 37 }
  const p2 = { lng: -73, lat: 40 }

  it('interpolates lng and lat', () => {
    const result = interpolatePoint2D(p1, p2, 0.5)
    expect(result.lng).toBeCloseTo(-97.5)
    expect(result.lat).toBeCloseTo(38.5)
  })
})

describe('interpolatePoint3D', () => {
  const p1 = { lng: -122, lat: 37, alt: 0 }
  const p2 = { lng: -73, lat: 40, alt: 10000 }

  it('interpolates lng, lat, and alt', () => {
    const result = interpolatePoint3D(p1, p2, 0.5)
    expect(result.lng).toBeCloseTo(-97.5)
    expect(result.lat).toBeCloseTo(38.5)
    expect(result.alt).toBe(5000)
  })
})

describe('interpolateCompound', () => {
  it('recursively interpolates nested objects', () => {
    const v1 = { position: { x: 0, y: 0 }, scale: 1 }
    const v2 = { position: { x: 10, y: 20 }, scale: 2 }
    const result = interpolateCompound(v1, v2, 0.5)
    expect(result).toEqual({ position: { x: 5, y: 10 }, scale: 1.5 })
  })

  it('preserves keys only in v1', () => {
    const v1 = { a: 10, b: 20 }
    const v2 = { a: 20 }
    const result = interpolateCompound(v1, v2, 0.5)
    expect(result.a).toBe(15)
    expect(result.b).toBe(20) // preserves v1 value
  })
})

describe('interpolateValue', () => {
  it('step-interpolates booleans', () => {
    expect(interpolateValue(true, false, 0.4)).toBe(true)
    expect(interpolateValue(true, false, 0.6)).toBe(false)
  })

  it('step-interpolates strings', () => {
    expect(interpolateValue('hello', 'world', 0.4)).toBe('hello')
    expect(interpolateValue('hello', 'world', 0.6)).toBe('world')
  })

  it('linearly interpolates numbers', () => {
    expect(interpolateValue(0, 10, 0.5)).toBe(5)
  })

  it('detects and interpolates RGBA', () => {
    const result = interpolateValue({ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }, 0.5)
    expect(result).toHaveProperty('r')
    expect((result as { r: number }).r).toBeCloseTo(0.5)
  })

  it('detects and interpolates Vec2', () => {
    const result = interpolateValue({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)
    expect(result).toEqual({ x: 5, y: 10 })
  })

  it('detects and interpolates Point2D', () => {
    const result = interpolateValue({ lng: 0, lat: 0 }, { lng: 10, lat: 20 }, 0.5)
    expect(result).toEqual({ lng: 5, lat: 10 })
  })
})

describe('interpolateBetweenKeyframes', () => {
  const k1: Keyframe = {
    id: 'k1',
    position: 0,
    value: 0,
    interpolation: 'linear',
  }
  const k2: Keyframe = {
    id: 'k2',
    position: 1,
    value: 10,
    interpolation: 'linear',
  }

  it('returns k1 value at k1 position', () => {
    expect(interpolateBetweenKeyframes(0, k1, k2)).toBe(0)
  })

  it('returns k2 value at k2 position', () => {
    expect(interpolateBetweenKeyframes(1, k1, k2)).toBe(10)
  })

  it('returns k1 value before k1 position', () => {
    expect(interpolateBetweenKeyframes(-1, k1, k2)).toBe(0)
  })

  it('returns k2 value after k2 position', () => {
    expect(interpolateBetweenKeyframes(2, k1, k2)).toBe(10)
  })

  it('linearly interpolates between keyframes', () => {
    expect(interpolateBetweenKeyframes(0.5, k1, k2)).toBe(5)
  })

  it('respects hold interpolation (step function)', () => {
    const holdK1: Keyframe = { ...k1, interpolation: 'hold' }
    expect(interpolateBetweenKeyframes(0.5, holdK1, k2)).toBe(0)
    expect(interpolateBetweenKeyframes(0.99, holdK1, k2)).toBe(0)
  })

  it('applies bezier easing when specified', () => {
    const bezierK1: Keyframe = {
      ...k1,
      interpolation: 'bezier',
      handles: { left: [0.42, 0], right: [0.58, 1], type: 'aligned' }, // ease-in-out
    }
    const result = interpolateBetweenKeyframes(0.5, bezierK1, k2)
    expect(result).toBeGreaterThan(4) // should be around 5 but with easing
    expect(result).toBeLessThan(6)
  })
})

describe('findSurroundingKeyframes', () => {
  const keyframes: Keyframe[] = [
    { id: 'k1', position: 0, value: 0, interpolation: 'linear' },
    { id: 'k2', position: 1, value: 10, interpolation: 'linear' },
    { id: 'k3', position: 2, value: 20, interpolation: 'linear' },
  ]

  it('returns null for both when empty', () => {
    expect(findSurroundingKeyframes([], 0.5)).toEqual({ left: null, right: null })
  })

  it('returns single keyframe as right when before it', () => {
    const single = [keyframes[1]]
    expect(findSurroundingKeyframes(single, 0)).toEqual({ left: null, right: single[0] })
  })

  it('returns single keyframe as left when after it', () => {
    const single = [keyframes[1]]
    expect(findSurroundingKeyframes(single, 2)).toEqual({ left: single[0], right: null })
  })

  it('returns left=null when before first keyframe', () => {
    const result = findSurroundingKeyframes(keyframes, -1)
    expect(result.left).toBeNull()
    expect(result.right).toBe(keyframes[0])
  })

  it('returns right=null when after last keyframe', () => {
    const result = findSurroundingKeyframes(keyframes, 3)
    expect(result.left).toBe(keyframes[2])
    expect(result.right).toBeNull()
  })

  it('finds correct surrounding keyframes in middle', () => {
    const result = findSurroundingKeyframes(keyframes, 0.5)
    expect(result.left).toBe(keyframes[0])
    expect(result.right).toBe(keyframes[1])
  })

  it('finds correct surrounding keyframes between k2 and k3', () => {
    const result = findSurroundingKeyframes(keyframes, 1.5)
    expect(result.left).toBe(keyframes[1])
    expect(result.right).toBe(keyframes[2])
  })

  it('handles exact keyframe position', () => {
    const result = findSurroundingKeyframes(keyframes, 1)
    expect(result.left).toBe(keyframes[1])
    expect(result.right).toBe(keyframes[2])
  })
})

describe('evaluateTrack', () => {
  const track: Track = {
    id: 'test',
    fieldPath: 'test / value',
    defaultValue: 0,
    keyframes: [
      { id: 'k1', position: 0, value: 0, interpolation: 'linear' },
      { id: 'k2', position: 1, value: 10, interpolation: 'linear' },
      { id: 'k3', position: 2, value: 5, interpolation: 'linear' },
    ],
  }

  it('returns undefined for empty track', () => {
    const emptyTrack: Track = { ...track, keyframes: [] }
    expect(evaluateTrack(emptyTrack, 0.5)).toBeUndefined()
  })

  it('returns first keyframe value before first keyframe', () => {
    expect(evaluateTrack(track, -1)).toBe(0)
  })

  it('returns last keyframe value after last keyframe', () => {
    expect(evaluateTrack(track, 3)).toBe(5)
  })

  it('interpolates between keyframes', () => {
    expect(evaluateTrack(track, 0.5)).toBe(5) // halfway between 0 and 10
    expect(evaluateTrack(track, 1.5)).toBe(7.5) // halfway between 10 and 5
  })

  it('returns exact keyframe value at keyframe position', () => {
    expect(evaluateTrack(track, 0)).toBe(0)
    expect(evaluateTrack(track, 1)).toBe(10)
    expect(evaluateTrack(track, 2)).toBe(5)
  })
})
