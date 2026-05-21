import { describe, expect, it } from 'vitest'
import { deepEqual } from './deep-equal'

describe('deepEqual', () => {
  describe('primitives', () => {
    it('equal numbers', () => expect(deepEqual(1, 1)).toBe(true))
    it('different numbers', () => expect(deepEqual(1, 2)).toBe(false))
    it('equal strings', () => expect(deepEqual('a', 'a')).toBe(true))
    it('different strings', () => expect(deepEqual('a', 'b')).toBe(false))
    it('equal booleans', () => expect(deepEqual(true, true)).toBe(true))
    it('different booleans', () => expect(deepEqual(true, false)).toBe(false))
    it('null equals null', () => expect(deepEqual(null, null)).toBe(true))
    it('undefined equals undefined', () => expect(deepEqual(undefined, undefined)).toBe(true))
    it('null !== undefined', () => expect(deepEqual(null, undefined)).toBe(false))
    it('0 !== false', () => expect(deepEqual(0, false)).toBe(false))
    it('"" !== false', () => expect(deepEqual('', false)).toBe(false))
    it('NaN === NaN (via ===)', () => expect(deepEqual(NaN, NaN)).toBe(false))
  })

  describe('arrays', () => {
    it('empty arrays', () => expect(deepEqual([], [])).toBe(true))
    it('same elements', () => expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true))
    it('different elements', () => expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false))
    it('different lengths', () => expect(deepEqual([1, 2], [1, 2, 3])).toBe(false))
    it('nested arrays', () => expect(deepEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true))
    it('array !== object', () => expect(deepEqual([1], { 0: 1 })).toBe(false))
    it('array !== null', () => expect(deepEqual([1], null)).toBe(false))
  })

  describe('objects', () => {
    it('empty objects', () => expect(deepEqual({}, {})).toBe(true))
    it('same properties', () => expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true))
    it('different values', () => expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false))
    it('different keys', () => expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false))
    it('extra key in b', () => expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false))
    it('extra key in a', () => expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false))
    it('object !== null', () => expect(deepEqual({ a: 1 }, null)).toBe(false))
    it('null !== object', () => expect(deepEqual(null, { a: 1 })).toBe(false))
  })

  describe('nested structures', () => {
    it('nested objects', () => {
      const a = { x: { y: { z: 1 } } }
      const b = { x: { y: { z: 1 } } }
      expect(deepEqual(a, b)).toBe(true)
    })

    it('nested objects with difference at depth', () => {
      const a = { x: { y: { z: 1 } } }
      const b = { x: { y: { z: 2 } } }
      expect(deepEqual(a, b)).toBe(false)
    })

    it('objects containing arrays', () => {
      const a = { points: [1, 2, 3], label: 'test' }
      const b = { points: [1, 2, 3], label: 'test' }
      expect(deepEqual(a, b)).toBe(true)
    })

    it('arrays containing objects', () => {
      const a = [{ id: 1 }, { id: 2 }]
      const b = [{ id: 1 }, { id: 2 }]
      expect(deepEqual(a, b)).toBe(true)
    })

    it('CompoundPropsField-style viewState', () => {
      const a = { lat: 40.75, lng: -73.88, zoom: 13.2, pitch: 0, bearing: 0 }
      const b = { lat: 40.75, lng: -73.88, zoom: 13.2, pitch: 0, bearing: 0 }
      expect(deepEqual(a, b)).toBe(true)
    })

    it('same reference is equal', () => {
      const obj = { a: 1, b: [2, 3] }
      expect(deepEqual(obj, obj)).toBe(true)
    })
  })
})
