import { describe, expect, it } from 'vitest'
import { composeAccessor, isAccessor } from './accessor-helpers'

describe('accessor-helpers', () => {
  describe('isAccessor', () => {
    it('should return true for functions', () => {
      const fn = (d: unknown) => d
      expect(isAccessor(fn)).toBe(true)
    })

    it('should return false for non-functions', () => {
      expect(isAccessor(42)).toBe(false)
      expect(isAccessor('string')).toBe(false)
      expect(isAccessor(null)).toBe(false)
      expect(isAccessor(undefined)).toBe(false)
      expect(isAccessor({})).toBe(false)
      expect(isAccessor([])).toBe(false)
    })
  })

  describe('composeAccessor', () => {
    describe('with static values', () => {
      it('should apply transformation to static numbers', () => {
        const result = composeAccessor(10, (x: number) => x * 2)
        expect(result).toBe(20)
      })

      it('should apply transformation to static strings', () => {
        const result = composeAccessor('hello', (s: string) => s.toUpperCase())
        expect(result).toBe('HELLO')
      })

      it('should handle transformation returning different type', () => {
        const result = composeAccessor(42, (n: number) => `${n}`)
        expect(result).toBe('42')
      })
    })

    describe('with accessor functions', () => {
      it('should compose accessor with transformation', () => {
        const accessor = (d: { value: number }) => d.value
        const result = composeAccessor(accessor, (x: number) => x * 2)

        expect(typeof result).toBe('function')
        const composed = result as Function
        expect(composed({ value: 10 })).toBe(20)
      })

      it('should preserve accessor arguments', () => {
        const accessor = (d: { x: number }, index: number) => d.x + index
        const result = composeAccessor(accessor, (x: number) => x * 2)

        const composed = result as Function
        expect(composed({ x: 10 }, 3)).toBe(26) // (10 + 3) * 2
      })

      it('should work with complex transformations', () => {
        const accessor = (d: { count: number }) => d.count
        const normalize = (val: number) => val / 100
        const result = composeAccessor(accessor, normalize)

        const composed = result as Function
        expect(composed({ count: 50 })).toBe(0.5)
      })

      it('should handle transformation returning objects', () => {
        const accessor = (d: { value: number }) => d.value
        const toObject = (val: number) => ({ normalized: val / 10 })
        const result = composeAccessor(accessor, toObject)

        const composed = result as Function
        expect(composed({ value: 50 })).toEqual({ normalized: 5 })
      })
    })

    describe('chaining compositions', () => {
      it('should allow multiple compositions', () => {
        // Step 1: Extract count
        const countAccessor = (d: { count: number }) => d.count

        // Step 2: Normalize (0-100 to 0-1)
        const normalized = composeAccessor(countAccessor, (val: number) => val / 100)

        // Step 3: Apply color scale
        const colorScale = (val: number) => {
          if (val < 0.5) return '#00ff00'
          return '#ff0000'
        }
        const colored = composeAccessor(normalized, colorScale)

        const finalAccessor = colored as Function
        expect(finalAccessor({ count: 30 })).toBe('#00ff00')
        expect(finalAccessor({ count: 80 })).toBe('#ff0000')
      })

      it('should handle real-world scenario: count -> MapRange -> ColorRamp', () => {
        // Initial accessor
        const countAccessor = (d: { count: number }) => d.count

        // MapRange: normalize 0-200 to 0-1
        const mapRange = (val: number) => (val - 0) / (200 - 0)
        const normalized = composeAccessor(countAccessor, mapRange)

        // ColorRamp: map 0-1 to colors
        const colorRamp = (val: number) => {
          if (val < 0.33) return '#00ff00'
          if (val < 0.66) return '#ffff00'
          return '#ff0000'
        }
        const finalColor = composeAccessor(normalized, colorRamp)

        const accessor = finalColor as Function
        expect(accessor({ count: 50 })).toBe('#00ff00') // 50/200 = 0.25 < 0.33
        expect(accessor({ count: 100 })).toBe('#ffff00') // 100/200 = 0.5, 0.33 < 0.5 < 0.66
        expect(accessor({ count: 150 })).toBe('#ff0000') // 150/200 = 0.75 > 0.66
      })
    })

    describe('edge cases', () => {
      it('should handle null transformation return', () => {
        const result = composeAccessor(10, () => null)
        expect(result).toBeNull()
      })

      it('should handle undefined transformation return', () => {
        const result = composeAccessor(10, () => undefined)
        expect(result).toBeUndefined()
      })

      it('should handle accessor returning null', () => {
        const accessor = () => null
        const result = composeAccessor(accessor, val => val)

        const composed = result as Function
        expect(composed()).toBeNull()
      })

      it('should handle async transformations', async () => {
        const accessor = (d: { value: number }) => d.value
        const asyncTransform = async (val: number) => val * 2
        const result = composeAccessor(accessor, asyncTransform)

        const composed = result as Function
        const promise = composed({ value: 10 })
        expect(promise instanceof Promise).toBe(true)
        await expect(promise).resolves.toBe(20)
      })

      it('should handle transformations that throw errors', () => {
        const accessor = (d: { value: number }) => d.value
        const throwingTransform = (val: number) => {
          if (val < 0) throw new Error('Negative value')
          return val * 2
        }
        const result = composeAccessor(accessor, throwingTransform)

        const composed = result as Function
        expect(() => composed({ value: -5 })).toThrow('Negative value')
        expect(composed({ value: 5 })).toBe(10)
      })
    })
  })
})
