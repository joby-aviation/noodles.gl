import { describe, expect, it } from 'vitest'
import { deepEqual } from './deep-equal'

describe('deepEqual', () => {
  describe('primitives', () => {
    it('returns true for identical numbers', () => {
      expect(deepEqual(1, 1)).toBe(true)
    })

    it('returns false for different numbers', () => {
      expect(deepEqual(1, 2)).toBe(false)
    })

    it('returns true for identical strings', () => {
      expect(deepEqual('hello', 'hello')).toBe(true)
    })

    it('returns false for different strings', () => {
      expect(deepEqual('hello', 'world')).toBe(false)
    })

    it('returns true for identical booleans', () => {
      expect(deepEqual(true, true)).toBe(true)
    })

    it('returns false for different booleans', () => {
      expect(deepEqual(true, false)).toBe(false)
    })

    it('returns true for same reference', () => {
      const obj = { a: 1 }
      expect(deepEqual(obj, obj)).toBe(true)
    })
  })

  describe('null and undefined', () => {
    it('returns true for null === null', () => {
      expect(deepEqual(null, null)).toBe(true)
    })

    it('returns true for undefined === undefined', () => {
      expect(deepEqual(undefined, undefined)).toBe(true)
    })

    it('returns false for null !== undefined', () => {
      expect(deepEqual(null, undefined)).toBe(false)
    })

    it('returns false for null !== object', () => {
      expect(deepEqual(null, {})).toBe(false)
    })

    it('returns false for object !== null', () => {
      expect(deepEqual({}, null)).toBe(false)
    })
  })

  describe('flat objects', () => {
    it('returns true for identical flat objects', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    })

    it('returns false for different values', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false)
    })

    it('returns false for different keys', () => {
      expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false)
    })

    it('returns false for different number of keys', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    })

    it('returns true for empty objects', () => {
      expect(deepEqual({}, {})).toBe(true)
    })
  })

  describe('nested objects', () => {
    it('returns true for deeply nested identical objects', () => {
      const a = { x: { y: { z: 1 } }, w: 'hello' }
      const b = { x: { y: { z: 1 } }, w: 'hello' }
      expect(deepEqual(a, b)).toBe(true)
    })

    it('returns false for deeply nested different objects', () => {
      const a = { x: { y: { z: 1 } } }
      const b = { x: { y: { z: 2 } } }
      expect(deepEqual(a, b)).toBe(false)
    })
  })

  describe('arrays', () => {
    it('returns true for identical arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    })

    it('returns false for different arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false)
    })

    it('returns false for different length arrays', () => {
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    })

    it('returns true for nested arrays', () => {
      expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true)
    })

    it('returns false for array vs object', () => {
      expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false)
    })

    it('returns true for empty arrays', () => {
      expect(deepEqual([], [])).toBe(true)
    })
  })

  describe('mixed types', () => {
    it('returns false for number vs string', () => {
      expect(deepEqual(1, '1')).toBe(false)
    })

    it('returns false for object vs array', () => {
      expect(deepEqual({}, [])).toBe(false)
    })

    it('returns false for object vs primitive', () => {
      expect(deepEqual({ a: 1 }, 1)).toBe(false)
    })
  })

  describe('maplibre-style objects', () => {
    it('returns true for identical maplibre config objects', () => {
      const a = {
        mapStyle: 'https://example.com/style.json',
        projection: 'mercator',
        latitude: 37,
        longitude: -122,
        zoom: 10,
        pitch: 0,
        bearing: 0,
        light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
        sky: {
          enabled: false,
          skyColor: '#88C6FC',
          horizonColor: '#ffffff',
          skyHorizonBlend: 0.8,
          atmosphereBlend: 0.5,
        },
      }
      const b = {
        mapStyle: 'https://example.com/style.json',
        projection: 'mercator',
        latitude: 37,
        longitude: -122,
        zoom: 10,
        pitch: 0,
        bearing: 0,
        light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
        sky: {
          enabled: false,
          skyColor: '#88C6FC',
          horizonColor: '#ffffff',
          skyHorizonBlend: 0.8,
          atmosphereBlend: 0.5,
        },
      }
      expect(deepEqual(a, b)).toBe(true)
    })

    it('returns false when one nested property differs', () => {
      const a = {
        mapStyle: 'https://example.com/style.json',
        light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
      }
      const b = {
        mapStyle: 'https://example.com/style.json',
        light: { anchor: 'viewport', azimuthal: 211, polar: 30 },
      }
      expect(deepEqual(a, b)).toBe(false)
    })

    it('handles mapStyle as an object (inline style spec)', () => {
      const style = {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      }
      const a = { ...style }
      const b = { ...style }
      expect(deepEqual(a, b)).toBe(true)
    })
  })
})
