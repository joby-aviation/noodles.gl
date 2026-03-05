// Tests for easing presets - standard CSS bezier curves

import { describe, expect, it } from 'vitest'
import {
  EASING_PRESETS,
  findMatchingPreset,
  getDefaultPreset,
  getPresetByName,
  getPresetNames,
} from '../easing-presets'

describe('EASING_PRESETS', () => {
  it('contains standard CSS easing presets', () => {
    const names = EASING_PRESETS.map(p => p.name)
    expect(names).toContain('Linear')
    expect(names).toContain('Ease')
    expect(names).toContain('Ease In')
    expect(names).toContain('Ease Out')
    expect(names).toContain('Ease In-Out')
  })

  it('contains extended easing presets', () => {
    const names = EASING_PRESETS.map(p => p.name)
    expect(names).toContain('Quad In')
    expect(names).toContain('Cubic Out')
    expect(names).toContain('Expo In-Out')
    expect(names).toContain('Back In')
  })

  it('has valid handles for all presets', () => {
    for (const preset of EASING_PRESETS) {
      expect(preset.handles).toBeDefined()
      expect(preset.handles.left).toHaveLength(2)
      expect(preset.handles.right).toHaveLength(2)
      expect(preset.handles.type).toBe('aligned')
    }
  })

  it('linear preset has correct control points', () => {
    const linear = EASING_PRESETS.find(p => p.name === 'Linear')
    expect(linear).toBeDefined()
    expect(linear!.handles.left).toEqual([0, 0])
    expect(linear!.handles.right).toEqual([1, 1])
  })

  it('ease preset matches CSS ease', () => {
    // CSS ease: cubic-bezier(0.25, 0.1, 0.25, 1)
    const ease = EASING_PRESETS.find(p => p.name === 'Ease')
    expect(ease).toBeDefined()
    expect(ease!.handles.left[0]).toBeCloseTo(0.25, 2)
    expect(ease!.handles.left[1]).toBeCloseTo(0.1, 2)
    expect(ease!.handles.right[0]).toBeCloseTo(0.25, 2)
    expect(ease!.handles.right[1]).toBeCloseTo(1, 2)
  })

  it('has no duplicate preset names', () => {
    const names = EASING_PRESETS.map(p => p.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })
})

describe('getPresetByName', () => {
  it('finds preset by exact name', () => {
    const preset = getPresetByName('Linear')
    expect(preset).toBeDefined()
    expect(preset!.name).toBe('Linear')
  })

  it('finds preset case-insensitively', () => {
    expect(getPresetByName('linear')).toBeDefined()
    expect(getPresetByName('LINEAR')).toBeDefined()
    expect(getPresetByName('LiNeAr')).toBeDefined()
  })

  it('returns undefined for unknown preset', () => {
    expect(getPresetByName('NonExistent')).toBeUndefined()
    expect(getPresetByName('')).toBeUndefined()
  })

  it('finds ease variants', () => {
    expect(getPresetByName('Ease In')).toBeDefined()
    expect(getPresetByName('Ease Out')).toBeDefined()
    expect(getPresetByName('Ease In-Out')).toBeDefined()
  })
})

describe('getDefaultPreset', () => {
  it('returns Linear as default', () => {
    const preset = getDefaultPreset()
    expect(preset.name).toBe('Linear')
  })

  it('returns a valid preset', () => {
    const preset = getDefaultPreset()
    expect(preset.handles).toBeDefined()
    expect(preset.handles.left).toHaveLength(2)
    expect(preset.handles.right).toHaveLength(2)
  })
})

describe('getPresetNames', () => {
  it('returns array of preset names', () => {
    const names = getPresetNames()
    expect(Array.isArray(names)).toBe(true)
    expect(names.length).toBeGreaterThan(0)
  })

  it('includes standard CSS presets', () => {
    const names = getPresetNames()
    expect(names).toContain('Linear')
    expect(names).toContain('Ease')
  })

  it('matches EASING_PRESETS count', () => {
    const names = getPresetNames()
    expect(names.length).toBe(EASING_PRESETS.length)
  })
})

describe('findMatchingPreset', () => {
  it('finds exact match for linear', () => {
    const handles = {
      left: [0, 0] as [number, number],
      right: [1, 1] as [number, number],
      type: 'aligned' as const,
    }
    const match = findMatchingPreset(handles)
    expect(match).toBeDefined()
    expect(match!.name).toBe('Linear')
  })

  it('finds match within epsilon tolerance', () => {
    // Slightly off from exact Linear values
    const handles = {
      left: [0.0001, 0.0001] as [number, number],
      right: [0.9999, 0.9999] as [number, number],
      type: 'aligned' as const,
    }
    const match = findMatchingPreset(handles)
    expect(match).toBeDefined()
    expect(match!.name).toBe('Linear')
  })

  it('returns undefined for custom handles', () => {
    const handles = {
      left: [0.5, 0.5] as [number, number],
      right: [0.5, 0.5] as [number, number],
      type: 'aligned' as const,
    }
    const match = findMatchingPreset(handles)
    expect(match).toBeUndefined()
  })

  it('matches ease preset', () => {
    const handles = {
      left: [0.25, 0.1] as [number, number],
      right: [0.25, 1] as [number, number],
      type: 'aligned' as const,
    }
    const match = findMatchingPreset(handles)
    expect(match).toBeDefined()
    expect(match!.name).toBe('Ease')
  })

  it('ignores handle type for matching', () => {
    // Linear handles but with different type
    const handles = {
      left: [0, 0] as [number, number],
      right: [1, 1] as [number, number],
      type: 'free' as const,
    }
    const match = findMatchingPreset(handles)
    expect(match).toBeDefined()
    expect(match!.name).toBe('Linear')
  })
})

describe('preset handle values', () => {
  it('all handles are in valid range for standard curves', () => {
    for (const preset of EASING_PRESETS) {
      // X values should be in [0, 1]
      expect(preset.handles.left[0]).toBeGreaterThanOrEqual(0)
      expect(preset.handles.left[0]).toBeLessThanOrEqual(1)
      expect(preset.handles.right[0]).toBeGreaterThanOrEqual(0)
      expect(preset.handles.right[0]).toBeLessThanOrEqual(1)
    }
  })

  it('back presets have Y values outside [0, 1] for overshoot', () => {
    const backIn = EASING_PRESETS.find(p => p.name === 'Back In')
    const backOut = EASING_PRESETS.find(p => p.name === 'Back Out')
    const backInOut = EASING_PRESETS.find(p => p.name === 'Back In-Out')

    expect(backIn).toBeDefined()
    expect(backOut).toBeDefined()
    expect(backInOut).toBeDefined()

    // Back curves have control points that cause overshoot
    // At least one Y value should be outside [0, 1]
    const hasOvershoot = (handles: { left: [number, number]; right: [number, number] }) => {
      return (
        handles.left[1] < 0 || handles.left[1] > 1 || handles.right[1] < 0 || handles.right[1] > 1
      )
    }

    expect(hasOvershoot(backIn!.handles)).toBe(true)
    expect(hasOvershoot(backOut!.handles)).toBe(true)
    expect(hasOvershoot(backInOut!.handles)).toBe(true)
  })
})
