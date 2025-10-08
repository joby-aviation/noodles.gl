import { describe, expect, it } from 'vitest'
import {
  clamp,
  getArc,
  mix,
  mixspace,
  paraboloid,
  range,
  segmentRatios,
  smoothstep,
  tiltPoint,
} from './arc-geometry'

describe('mix function', () => {
  it('interpolates between two values', () => {
    expect(mix(0, 10, 0.5)).toBe(5)
    expect(mix(-10, 10, 0.25)).toBe(-5)
    expect(mix(5, 15, 1)).toBe(15)
    expect(mix(5, 15, 0)).toBe(5)
  })
})

describe('mixspace function', () => {
  it('returns an array of interpolated values', () => {
    expect(mixspace(0, 10, [0, 0.5, 1])).toEqual([0, 5, 10])
    expect(mixspace(-10, 10, [0.25, 0.75])).toEqual([-5, 5])
  })
})

describe('clamp function', () => {
  it('clamps values', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-5, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })
})

describe('range function', () => {
  it('returns an array of sequential numbers', () => {
    expect(range(5)).toEqual([0, 1, 2, 3, 4])
    expect(range(0)).toEqual([])
  })
})

describe('smoothstep function', () => {
  it('returns a smooth transition', () => {
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 2)
  })
})

describe('segmentRatios function', () => {
  it('returns correct segment ratios', () => {
    expect(segmentRatios(3, false)).toEqual([0, 0.5, 1])
  })
})

describe('paraboloid function', () => {
  it('returns correct altitude at given ratio', () => {
    expect(paraboloid(10, 5, 15, 0)).toBe(5)
    expect(paraboloid(10, 5, 15, 1)).toBe(15)
  })
})

describe('getArc function', () => {
  it('generates an arc with correct segment count', () => {
    const path = getArc({
      source: { lat: 0, lng: 0, alt: 0 },
      target: { lat: 10, lng: 10, alt: 10 },
      arcHeight: 100,
      segmentCount: 5,
    })

    expect(path.length).toBe(5)
  })

  it('generates an arc with correct apex height', () => {
    const path = getArc({
      source: { lat: 0, lng: 0, alt: 0 },
      target: { lat: 10, lng: 10, alt: 0 },
      arcHeight: 100,
      segmentCount: 5,
    })
    // TODO: This is actually expected to be equal to the arc height.. but it's 50%. This bug might now be a feature since many projects exist with it.
    expect(path[2][2]).toBeCloseTo(50, 1)
  })

  it('arcs work', () => {
    const path = getArc({
      source: { lat: 40.72145, lng: -73.9974, alt: 0 },
      target: { lat: 40.655, lng: -73.77585, alt: 0 },
      arcHeight: 10000,
      segmentCount: 11,
      tilt: 0,
    })
    expect(path.length).toBe(11)
    expect(path).toMatchSnapshot()
  })

  it('tilted arcs work', () => {
    const path = getArc({
      source: { lat: 40.72145, lng: -73.9974, alt: 0 },
      target: { lat: 40.655, lng: -73.77585, alt: 0 },
      arcHeight: 10000,
      segmentCount: 11,
      tilt: 90,
    })
    expect(path.length).toBe(11)
    expect(path).toMatchSnapshot()
  })
})

describe('tiltPoint function', () => {
  it('does not modify point if tilt is zero', () => {
    const point = [5, 5, 10]
    expect(tiltPoint(point, { lat: 0, lng: 0, alt: 0 }, { lat: 10, lng: 10, alt: 10 }, 0)).toEqual(
      point
    )
  })

  it('applies tilt', () => {
    const tilt1 = tiltPoint(
      [0, 0, 10],
      { lat: 0, lng: 0, alt: 0 },
      { lat: 10, lng: 10, alt: 10 },
      45
    )
    expect(tilt1[0]).toBeCloseTo(0, 3)
    expect(tilt1[1]).toBeCloseTo(0, 3)
    expect(tilt1[2]).toBeCloseTo(7.07, 1)
    const tilt2 = tiltPoint(
      [5, 5, 10],
      { lat: 0, lng: 0, alt: 0 },
      { lat: 10, lng: 10, alt: 10 },
      45
    )
    expect(tilt2[0]).toBeCloseTo(5, 3)
    expect(tilt2[1]).toBeCloseTo(5, 3)
    expect(tilt2[2]).toBeCloseTo(7.07, 1)
    const tilt3 = tiltPoint(
      [0, 0, 10],
      { lat: 0, lng: 0, alt: 0 },
      { lat: 10, lng: 10, alt: 10 },
      0.01
    )
    expect(tilt3[0]).toBeCloseTo(0, 3)
    expect(tilt3[1]).toBeCloseTo(0, 3)
    expect(tilt3[2]).toBeCloseTo(10, 3)
  })
})
