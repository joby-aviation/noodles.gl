import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrubValue, startScrub } from './label-scrub'

describe('scrubValue', () => {
  const float = { kind: 'float' as const, step: 0.1 }

  it('moves one step per pixel, a tenth with Shift and ten with Alt', () => {
    expect(scrubValue(float, 1, 5)).toBe(1.5)
    expect(scrubValue(float, 1, 5, { fine: true })).toBe(1.05)
    expect(scrubValue(float, 1, 5, { coarse: true })).toBe(6)
  })

  it('rounds an int, falls back to 0.01 per pixel without a step, and clamps', () => {
    expect(scrubValue({ kind: 'int' }, 2, 3.4)).toBe(5)
    expect(scrubValue({ kind: 'float' }, 0, 10)).toBe(0.1)
    expect(scrubValue({ kind: 'float', step: 1, min: 0, max: 10 }, 5, -20)).toBe(0)
    expect(scrubValue({ kind: 'float', step: 1, min: 0, max: 10 }, 5, 20)).toBe(10)
  })
})

describe('startScrub', () => {
  afterEach(() => window.dispatchEvent(new PointerEvent('pointerup')))

  it('sets values as the pointer moves past a small dead zone, and stops on release', () => {
    const set = vi.fn()
    startScrub({ clientX: 100, preventDefault() {} }, { kind: 'float', step: 1 }, 10, set)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 101 }))
    expect(set).not.toHaveBeenCalled()
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 104 }))
    expect(set).toHaveBeenLastCalledWith(14)
    window.dispatchEvent(new PointerEvent('pointerup'))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 120 }))
    expect(set).toHaveBeenCalledTimes(1)
  })
})
