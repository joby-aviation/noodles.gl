// Bezier interpolation engine for the native timeline system
// Provides keyframe evaluation with cubic bezier easing

import type {
  BezierHandles,
  Keyframe,
  KeyframeValue,
  Point2D,
  Point3D,
  RGBA,
  Track,
  Vec2,
  Vec3,
} from './types'
import { DEFAULT_BEZIER_HANDLES } from './types'

// ============================================================================
// Core Bezier Math
// ============================================================================

// Evaluate a cubic bezier curve at parameter t
// B(t) = (1-t)^3 * P0 + 3*(1-t)^2 * t * P1 + 3*(1-t) * t^2 * P2 + t^3 * P3
export function evaluateCubicBezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number
): number {
  const oneMinusT = 1 - t
  const oneMinusTSquared = oneMinusT * oneMinusT
  const oneMinusTCubed = oneMinusTSquared * oneMinusT
  const tSquared = t * t
  const tCubed = tSquared * t

  return (
    oneMinusTCubed * p0 +
    3 * oneMinusTSquared * t * p1 +
    3 * oneMinusT * tSquared * p2 +
    tCubed * p3
  )
}

// Evaluate the derivative of a cubic bezier curve at parameter t
// B'(t) = 3*(1-t)^2 * (P1-P0) + 6*(1-t)*t * (P2-P1) + 3*t^2 * (P3-P2)
function evaluateCubicBezierDerivative(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number
): number {
  const oneMinusT = 1 - t
  const oneMinusTSquared = oneMinusT * oneMinusT
  const tSquared = t * t

  return 3 * oneMinusTSquared * (p1 - p0) + 6 * oneMinusT * t * (p2 - p1) + 3 * tSquared * (p3 - p2)
}

// Find the parameter t for a given x value using Newton-Raphson iteration
// This maps time (x) to bezier parameter (t)
// x: The x value to find t for (normalized 0-1)
// x1, x2: Control point x values (from cubic-bezier)
// epsilon: Precision threshold (default: 0.0001)
// maxIterations: Maximum Newton-Raphson iterations (default: 8)
export function findTForX(
  x: number,
  x1: number,
  x2: number,
  epsilon = 0.0001,
  maxIterations = 8
): number {
  // Edge cases
  if (x <= 0) return 0
  if (x >= 1) return 1

  // For linear curves, t = x
  if (x1 === 0 && x2 === 1) return x

  // Initial guess using linear approximation
  let t = x

  // Newton-Raphson iteration
  for (let i = 0; i < maxIterations; i++) {
    const currentX = evaluateCubicBezier(t, 0, x1, x2, 1)
    const error = currentX - x

    if (Math.abs(error) < epsilon) {
      return t
    }

    const derivative = evaluateCubicBezierDerivative(t, 0, x1, x2, 1)

    // Avoid division by zero
    if (Math.abs(derivative) < 1e-10) {
      break
    }

    t = t - error / derivative

    // Clamp to valid range
    t = Math.max(0, Math.min(1, t))
  }

  // Fallback to binary search if Newton-Raphson doesn't converge
  let low = 0
  let high = 1
  t = x

  while (high - low > epsilon) {
    const currentX = evaluateCubicBezier(t, 0, x1, x2, 1)

    if (currentX < x) {
      low = t
    } else {
      high = t
    }

    t = (low + high) / 2
  }

  return t
}

// Evaluate a bezier easing curve at normalized time x, returns the eased value y
// x: Normalized time (0-1)
// handles: Bezier control point handles
export function evaluateBezierEasing(x: number, handles: BezierHandles): number {
  // Edge cases
  if (x <= 0) return 0
  if (x >= 1) return 1

  // Find t for the given x
  const t = findTForX(x, handles.left[0], handles.right[0])

  // Evaluate y at t
  return evaluateCubicBezier(t, 0, handles.left[1], handles.right[1], 1)
}

// ============================================================================
// Type-Specific Interpolation
// ============================================================================

export function interpolateNumber(v1: number, v2: number, t: number): number {
  return v1 + (v2 - v1) * t
}

export function interpolateColor(c1: RGBA, c2: RGBA, t: number): RGBA {
  return {
    r: interpolateNumber(c1.r, c2.r, t),
    g: interpolateNumber(c1.g, c2.g, t),
    b: interpolateNumber(c1.b, c2.b, t),
    a: interpolateNumber(c1.a, c2.a, t),
  }
}

export function interpolateVec2(v1: Vec2, v2: Vec2, t: number): Vec2 {
  return {
    x: interpolateNumber(v1.x, v2.x, t),
    y: interpolateNumber(v1.y, v2.y, t),
  }
}

export function interpolateVec3(v1: Vec3, v2: Vec3, t: number): Vec3 {
  return {
    x: interpolateNumber(v1.x, v2.x, t),
    y: interpolateNumber(v1.y, v2.y, t),
    z: interpolateNumber(v1.z, v2.z, t),
  }
}

export function interpolatePoint2D(p1: Point2D, p2: Point2D, t: number): Point2D {
  return {
    lng: interpolateNumber(p1.lng, p2.lng, t),
    lat: interpolateNumber(p1.lat, p2.lat, t),
  }
}

export function interpolatePoint3D(p1: Point3D, p2: Point3D, t: number): Point3D {
  return {
    lng: interpolateNumber(p1.lng, p2.lng, t),
    lat: interpolateNumber(p1.lat, p2.lat, t),
    alt: interpolateNumber(p1.alt, p2.alt, t),
  }
}

// Interpolate compound (object) values recursively
export function interpolateCompound(
  v1: Record<string, KeyframeValue>,
  v2: Record<string, KeyframeValue>,
  t: number
): Record<string, KeyframeValue> {
  const result: Record<string, KeyframeValue> = {}

  for (const key of Object.keys(v1)) {
    if (!(key in v2)) {
      result[key] = v1[key]
      continue
    }

    result[key] = interpolateValue(v1[key], v2[key], t)
  }

  return result
}

// Interpolate any keyframe value based on its type
export function interpolateValue(v1: KeyframeValue, v2: KeyframeValue, t: number): KeyframeValue {
  // Boolean and string: no interpolation (step)
  if (typeof v1 === 'boolean' || typeof v1 === 'string') {
    return t < 0.5 ? v1 : v2
  }

  // Number
  if (typeof v1 === 'number' && typeof v2 === 'number') {
    return interpolateNumber(v1, v2, t)
  }

  // Objects
  if (typeof v1 === 'object' && typeof v2 === 'object' && v1 !== null && v2 !== null) {
    // RGBA color
    if ('r' in v1 && 'g' in v1 && 'b' in v1 && 'a' in v1) {
      return interpolateColor(v1 as RGBA, v2 as RGBA, t)
    }

    // Point3D (check alt before Point2D since Point3D has lng/lat too)
    if ('lng' in v1 && 'lat' in v1 && 'alt' in v1) {
      return interpolatePoint3D(v1 as Point3D, v2 as Point3D, t)
    }

    // Point2D
    if ('lng' in v1 && 'lat' in v1) {
      return interpolatePoint2D(v1 as Point2D, v2 as Point2D, t)
    }

    // Vec3 (check z before Vec2)
    if ('x' in v1 && 'y' in v1 && 'z' in v1) {
      return interpolateVec3(v1 as Vec3, v2 as Vec3, t)
    }

    // Vec2
    if ('x' in v1 && 'y' in v1) {
      return interpolateVec2(v1 as Vec2, v2 as Vec2, t)
    }

    // Generic compound object
    return interpolateCompound(
      v1 as Record<string, KeyframeValue>,
      v2 as Record<string, KeyframeValue>,
      t
    )
  }

  // Fallback: return v1 at t<0.5, v2 otherwise
  return t < 0.5 ? v1 : v2
}

// ============================================================================
// Keyframe Interpolation
// ============================================================================

// Interpolate between two keyframes at a given time
// time: The current time in seconds
// k1: The keyframe before or at time
// k2: The keyframe after time
export function interpolateBetweenKeyframes(
  time: number,
  k1: Keyframe,
  k2: Keyframe
): KeyframeValue {
  // If same position or before k1, return k1 value
  if (time <= k1.position || k1.position === k2.position) {
    return k1.value
  }

  // If at or after k2, return k2 value
  if (time >= k2.position) {
    return k2.value
  }

  // Hold interpolation: step function
  if (k1.interpolation === 'hold') {
    return k1.value
  }

  // Calculate normalized time between keyframes
  const normalizedTime = (time - k1.position) / (k2.position - k1.position)

  // Linear interpolation
  if (k1.interpolation === 'linear') {
    return interpolateValue(k1.value, k2.value, normalizedTime)
  }

  // Bezier interpolation
  const handles = k1.handles || DEFAULT_BEZIER_HANDLES
  const easedTime = evaluateBezierEasing(normalizedTime, handles)
  return interpolateValue(k1.value, k2.value, easedTime)
}

// ============================================================================
// Track Evaluation
// ============================================================================

// Binary search to find the surrounding keyframes for a given time
// Returns the keyframes immediately before and after the time
// keyframes: Sorted array of keyframes
// time: The time to search for
export function findSurroundingKeyframes(
  keyframes: Keyframe[],
  time: number
): { left: Keyframe | null; right: Keyframe | null } {
  if (keyframes.length === 0) {
    return { left: null, right: null }
  }

  if (keyframes.length === 1) {
    const kf = keyframes[0]
    if (time <= kf.position) {
      return { left: null, right: kf }
    }
    return { left: kf, right: null }
  }

  // Binary search
  let low = 0
  let high = keyframes.length - 1

  // Check edges
  if (time <= keyframes[low].position) {
    return { left: null, right: keyframes[low] }
  }
  if (time >= keyframes[high].position) {
    return { left: keyframes[high], right: null }
  }

  // Binary search for the surrounding keyframes
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const kf = keyframes[mid]

    if (time === kf.position) {
      // Exact match - this keyframe is both left and right
      return {
        left: kf,
        right: mid < keyframes.length - 1 ? keyframes[mid + 1] : null,
      }
    }

    if (time < kf.position) {
      // Check if this is the right keyframe we're looking for
      if (mid > 0 && keyframes[mid - 1].position < time) {
        return { left: keyframes[mid - 1], right: kf }
      }
      high = mid - 1
    } else {
      // Check if this is the left keyframe we're looking for
      if (mid < keyframes.length - 1 && keyframes[mid + 1].position > time) {
        return { left: kf, right: keyframes[mid + 1] }
      }
      low = mid + 1
    }
  }

  // Shouldn't reach here, but return safe default
  return { left: keyframes[low - 1] || null, right: keyframes[low] || null }
}

// Evaluate a track at a given time
// track: The track to evaluate
// time: The current time in seconds
// Returns the interpolated value, or undefined if track has no keyframes
export function evaluateTrack(track: Track, time: number): KeyframeValue | undefined {
  const { keyframes } = track

  if (keyframes.length === 0) {
    return undefined
  }

  const { left, right } = findSurroundingKeyframes(keyframes, time)

  // Before first keyframe or at first keyframe
  if (left === null && right !== null) {
    return right.value
  }

  // After last keyframe
  if (left !== null && right === null) {
    return left.value
  }

  // Between two keyframes
  if (left !== null && right !== null) {
    return interpolateBetweenKeyframes(time, left, right)
  }

  // No keyframes (shouldn't happen if length > 0)
  return undefined
}

// Check if a track has any keyframes
export function trackHasKeyframes(track: Track): boolean {
  return track.keyframes.length > 0
}

// Get the value at a specific keyframe time, or undefined if no keyframe exists there
export function getKeyframeAtTime(
  track: Track,
  time: number,
  epsilon = 0.001
): Keyframe | undefined {
  return track.keyframes.find(kf => Math.abs(kf.position - time) < epsilon)
}
