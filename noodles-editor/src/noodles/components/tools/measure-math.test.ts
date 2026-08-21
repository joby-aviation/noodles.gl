import { describe, expect, it } from 'vitest'
import {
  convertDistance,
  formatArea,
  formatDistance,
  haversineDistance,
  pathLength,
  polygonArea,
} from './measure-math'

const NYC = { lng: -74.006, lat: 40.7128 }
const LONDON = { lng: -0.1278, lat: 51.5074 }
const PARIS = { lng: 2.3522, lat: 48.8566 }

describe('haversineDistance', () => {
  it('matches the known NYC to London great-circle distance', () => {
    // Published value is about 5570 km
    expect(haversineDistance(NYC, LONDON)).toBeCloseTo(5570, -2)
  })

  it('is zero for identical points and symmetric otherwise', () => {
    expect(haversineDistance(NYC, NYC)).toBe(0)
    expect(haversineDistance(NYC, PARIS)).toBeCloseTo(haversineDistance(PARIS, NYC), 6)
  })

  it('handles antimeridian-adjacent points without blowing up', () => {
    const west = { lng: -179.9, lat: 0 }
    const east = { lng: 179.9, lat: 0 }
    // Haversine goes the short way around: about 22 km, not most of the equator
    expect(haversineDistance(west, east)).toBeLessThan(30)
  })
})

describe('pathLength', () => {
  it('sums the legs', () => {
    const total = pathLength([NYC, LONDON, PARIS])
    expect(total).toBeCloseTo(haversineDistance(NYC, LONDON) + haversineDistance(LONDON, PARIS), 6)
  })

  it('is zero for fewer than two points', () => {
    expect(pathLength([])).toBe(0)
    expect(pathLength([NYC])).toBe(0)
  })
})

describe('polygonArea', () => {
  it('needs at least three points', () => {
    expect(polygonArea([NYC, LONDON])).toBe(0)
  })

  it('approximates a one-degree square near the equator', () => {
    // A 1 degree square at the equator is roughly 12,300 sq km
    const square = [
      { lng: 0, lat: 0 },
      { lng: 1, lat: 0 },
      { lng: 1, lat: 1 },
      { lng: 0, lat: 1 },
    ]
    expect(polygonArea(square)).toBeGreaterThan(11_000)
    expect(polygonArea(square)).toBeLessThan(13_500)
  })

  it('ignores winding direction', () => {
    const ring = [
      { lng: 0, lat: 0 },
      { lng: 1, lat: 0 },
      { lng: 1, lat: 1 },
    ]
    expect(polygonArea(ring)).toBeCloseTo(polygonArea([...ring].reverse()), 6)
  })
})

describe('convertDistance', () => {
  it('converts from kilometres', () => {
    expect(convertDistance(1, 'kilometers')).toBe(1)
    expect(convertDistance(1, 'meters')).toBe(1000)
    expect(convertDistance(1, 'miles')).toBeCloseTo(0.621371, 6)
    expect(convertDistance(1, 'nauticalmiles')).toBeCloseTo(0.539957, 6)
  })
})

describe('formatDistance', () => {
  it('promotes long metre readings to kilometres', () => {
    expect(formatDistance(1500, 'meters')).toBe('1.50 km')
    expect(formatDistance(999, 'meters')).toBe('999.0 m')
  })

  it('demotes tiny readings to metres so they are not all zeroes', () => {
    expect(formatDistance(0.005, 'kilometers')).toBe('5.0 m')
    expect(formatDistance(1.5, 'kilometers')).toBe('1.50 km')
  })

  it('uses short unit labels', () => {
    expect(formatDistance(3, 'miles')).toBe('3.00 mi')
    expect(formatDistance(3, 'nauticalmiles')).toBe('3.00 nmi')
  })
})

describe('formatArea', () => {
  it('scales the unit to the magnitude', () => {
    expect(formatArea(0.5)).toBe('500000 m²')
    expect(formatArea(12.34)).toBe('12.34 km²')
    expect(formatArea(2_500_000)).toBe('2.50 million km²')
  })
})
