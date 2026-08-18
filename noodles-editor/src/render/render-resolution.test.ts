import { describe, expect, it } from 'vitest'
import { getEffectiveRenderResolution, getLodZoomCompensation } from './render-resolution'

describe('render resolution', () => {
  it('multiplies base resolution by LOD using the existing rounded dimensions', () => {
    expect(getEffectiveRenderResolution({ width: 1920, height: 1080 }, 2)).toEqual({
      width: 3840,
      height: 2160,
    })
    expect(getEffectiveRenderResolution({ width: 101, height: 51 }, 1.5)).toEqual({
      width: 152,
      height: 77,
    })
  })

  it('calculates Web Mercator zoom compensation with log2', () => {
    expect(getLodZoomCompensation(1)).toBe(0)
    expect(getLodZoomCompensation(2)).toBe(1)
    expect(getLodZoomCompensation(4)).toBe(2)
    expect(getLodZoomCompensation(0.5)).toBe(-1)
  })
})
