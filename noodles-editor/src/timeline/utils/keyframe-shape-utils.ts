// Utilities for determining keyframe visual shape based on interpolation type

import type { Keyframe } from '../types'
import { DEFAULT_BEZIER_HANDLES } from '../types'

export type KeyframeShapeType =
  | 'linear' // Diamond
  | 'ease-in' // Right chevron (linear out)
  | 'ease-out' // Left chevron (linear in)
  | 'easy-ease' // Hourglass (bezier both sides)
  | 'hold' // Square (both sides hold)
  | 'hold-ease-out' // Square with right notch (left hold, right eases)
  | 'hold-ease-in' // Square with left notch (left eases, right hold)
  | 'hold-linear-out' // Square with right triangle (left hold, right linear)
  | 'hold-linear-in' // Square with left triangle (left linear, right hold)

type EasingType = 'hold' | 'linear' | 'ease-in' | 'ease-out' | 'easy-ease'

// Determine if a bezier handle represents linear interpolation
function isHandleLinear(handle: [number, number]): boolean {
  const epsilon = 0.05
  return Math.abs(handle[0] - handle[1]) < epsilon
}

// Classify the easing type from a keyframe's interpolation and handles
function getEasingType(keyframe: Keyframe | undefined): EasingType {
  if (!keyframe) return 'hold'
  if (keyframe.interpolation === 'hold') return 'hold'
  if (keyframe.interpolation === 'linear') return 'linear'

  const handles = keyframe.handles || DEFAULT_BEZIER_HANDLES
  const isLeftLinear = isHandleLinear(handles.left)
  const isRightLinear = isHandleLinear(handles.right)

  if (isLeftLinear && isRightLinear) return 'linear'
  if (isLeftLinear) return 'ease-in'
  if (isRightLinear) return 'ease-out'
  return 'easy-ease'
}

// Determine the visual shape for a keyframe based on its interpolation
// and the adjacent keyframes (for hold variants)
export function getKeyframeShapeType(
  keyframe: Keyframe,
  prevKeyframe?: Keyframe,
  nextKeyframe?: Keyframe
): KeyframeShapeType {
  const currentEasing = getEasingType(keyframe)

  // Non-hold keyframes: determine shape from current keyframe only
  if (currentEasing !== 'hold') {
    return currentEasing
  }

  // Hold keyframes: check adjacent keyframes to determine variants
  const prevEasing = getEasingType(prevKeyframe)
  const nextEasing = getEasingType(nextKeyframe)

  // Both sides hold or missing -> basic hold square
  if (prevEasing === 'hold' && nextEasing === 'hold') {
    return 'hold'
  }

  // Left side has easing, right side hold
  if (prevEasing !== 'hold' && nextEasing === 'hold') {
    if (prevEasing === 'linear') return 'hold-linear-in'
    return 'hold-ease-in'
  }

  // Left side hold, right side has easing
  if (prevEasing === 'hold' && nextEasing !== 'hold') {
    if (nextEasing === 'linear') return 'hold-linear-out'
    return 'hold-ease-out'
  }

  // Both sides have easing (unusual for hold, but handle it)
  // Prioritize showing the right side since that's controlled by current keyframe
  if (nextEasing === 'linear') return 'hold-linear-out'
  if (nextEasing !== 'hold') return 'hold-ease-out'
  if (prevEasing === 'linear') return 'hold-linear-in'
  return 'hold-ease-in'
}
