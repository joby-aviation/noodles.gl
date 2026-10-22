// Standard easing presets for bezier interpolation
// Based on CSS cubic-bezier values and common animation curves

import type { BezierHandles, EasingPreset } from './types'

// Helper to create handles from CSS cubic-bezier values
// cubic-bezier(x1, y1, x2, y2) -> handles with left at [x1, y1] and right at [x2, y2]
function cubicBezier(x1: number, y1: number, x2: number, y2: number): BezierHandles {
  return {
    left: [x1, y1],
    right: [x2, y2],
    type: 'aligned',
  }
}

// ============================================================================
// Standard CSS Easing Presets
// ============================================================================

export const EASING_PRESETS: EasingPreset[] = [
  // Basic
  { name: 'Linear', handles: cubicBezier(0, 0, 1, 1) },
  { name: 'Ease', handles: cubicBezier(0.25, 0.1, 0.25, 1) },
  { name: 'Ease In', handles: cubicBezier(0.42, 0, 1, 1) },
  { name: 'Ease Out', handles: cubicBezier(0, 0, 0.58, 1) },
  { name: 'Ease In-Out', handles: cubicBezier(0.42, 0, 0.58, 1) },

  // Quad
  { name: 'Quad In', handles: cubicBezier(0.55, 0.085, 0.68, 0.53) },
  { name: 'Quad Out', handles: cubicBezier(0.25, 0.46, 0.45, 0.94) },
  { name: 'Quad In-Out', handles: cubicBezier(0.455, 0.03, 0.515, 0.955) },

  // Cubic
  { name: 'Cubic In', handles: cubicBezier(0.55, 0.055, 0.675, 0.19) },
  { name: 'Cubic Out', handles: cubicBezier(0.215, 0.61, 0.355, 1) },
  { name: 'Cubic In-Out', handles: cubicBezier(0.645, 0.045, 0.355, 1) },

  // Quart
  { name: 'Quart In', handles: cubicBezier(0.895, 0.03, 0.685, 0.22) },
  { name: 'Quart Out', handles: cubicBezier(0.165, 0.84, 0.44, 1) },
  { name: 'Quart In-Out', handles: cubicBezier(0.77, 0, 0.175, 1) },

  // Quint
  { name: 'Quint In', handles: cubicBezier(0.755, 0.05, 0.855, 0.06) },
  { name: 'Quint Out', handles: cubicBezier(0.23, 1, 0.32, 1) },
  { name: 'Quint In-Out', handles: cubicBezier(0.86, 0, 0.07, 1) },

  // Expo
  { name: 'Expo In', handles: cubicBezier(0.95, 0.05, 0.795, 0.035) },
  { name: 'Expo Out', handles: cubicBezier(0.19, 1, 0.22, 1) },
  { name: 'Expo In-Out', handles: cubicBezier(1, 0, 0, 1) },

  // Circ
  { name: 'Circ In', handles: cubicBezier(0.6, 0.04, 0.98, 0.335) },
  { name: 'Circ Out', handles: cubicBezier(0.075, 0.82, 0.165, 1) },
  { name: 'Circ In-Out', handles: cubicBezier(0.785, 0.135, 0.15, 0.86) },

  // Sine
  { name: 'Sine In', handles: cubicBezier(0.47, 0, 0.745, 0.715) },
  { name: 'Sine Out', handles: cubicBezier(0.39, 0.575, 0.565, 1) },
  { name: 'Sine In-Out', handles: cubicBezier(0.445, 0.05, 0.55, 0.95) },

  // Back (slight overshoot)
  { name: 'Back In', handles: cubicBezier(0.6, -0.28, 0.735, 0.045) },
  { name: 'Back Out', handles: cubicBezier(0.175, 0.885, 0.32, 1.275) },
  { name: 'Back In-Out', handles: cubicBezier(0.68, -0.55, 0.265, 1.55) },
]

// ============================================================================
// Preset Lookup Functions
// ============================================================================

export function getPresetByName(name: string): EasingPreset | undefined {
  return EASING_PRESETS.find(preset => preset.name.toLowerCase() === name.toLowerCase())
}

export function getDefaultPreset(): EasingPreset {
  return EASING_PRESETS[0] // Linear
}

export function getPresetNames(): string[] {
  return EASING_PRESETS.map(preset => preset.name)
}

// Check if handles match a known preset
export function findMatchingPreset(handles: BezierHandles): EasingPreset | undefined {
  const epsilon = 0.001
  return EASING_PRESETS.find(preset => {
    const h = preset.handles
    return (
      Math.abs(h.left[0] - handles.left[0]) < epsilon &&
      Math.abs(h.left[1] - handles.left[1]) < epsilon &&
      Math.abs(h.right[0] - handles.right[0]) < epsilon &&
      Math.abs(h.right[1] - handles.right[1]) < epsilon
    )
  })
}
