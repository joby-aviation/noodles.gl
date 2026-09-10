import { describe, expect, it } from 'vitest'
import type { AttributeEnhancedData } from '../fields'
import {
  extractAttributes,
  isAttributeReference,
  resolveNumericField,
  transformAttribute,
  transformAttributeMulti,
  withAttribute,
} from './resolve-attribute'

describe('resolve-attribute utilities', () => {
  const sampleData: AttributeEnhancedData = {
    data: [{ x: 1 }, { x: 2 }, { x: 3 }],
    attributes: {
      temperature: { values: new Float32Array([10, 20, 30]), size: 1 },
      position: { values: new Float32Array([1, 2, 3, 4, 5, 6]), size: 2 },
      color: { values: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]), size: 4 },
    },
  }

  describe('isAttributeReference', () => {
    it('returns true for non-empty strings', () => {
      expect(isAttributeReference('temperature')).toBe(true)
      expect(isAttributeReference('position')).toBe(true)
    })

    it('returns false for empty strings', () => {
      expect(isAttributeReference('')).toBe(false)
    })

    it('returns false for non-strings', () => {
      expect(isAttributeReference(42)).toBe(false)
      expect(isAttributeReference(null)).toBe(false)
      expect(isAttributeReference(undefined)).toBe(false)
      expect(isAttributeReference(() => {})).toBe(false)
    })
  })

  describe('resolveNumericField', () => {
    it('resolves numeric values as uniform', () => {
      const result = resolveNumericField(42, sampleData)
      expect(result).toEqual({ mode: 'uniform', value: 42 })
    })

    it('resolves zero as uniform', () => {
      const result = resolveNumericField(0, sampleData)
      expect(result).toEqual({ mode: 'uniform', value: 0 })
    })

    it('resolves string attribute name to attribute data', () => {
      const result = resolveNumericField('temperature', sampleData)
      expect(result.mode).toBe('attribute')
      if (result.mode === 'attribute') {
        expect(result.name).toBe('temperature')
        expect(result.size).toBe(1)
        expect(result.values).toEqual(new Float32Array([10, 20, 30]))
      }
    })

    it('resolves unknown attribute name as uniform 0', () => {
      const result = resolveNumericField('nonexistent', sampleData)
      expect(result).toEqual({ mode: 'uniform', value: 0 })
    })

    it('resolves with undefined data as uniform', () => {
      const result = resolveNumericField('temperature', undefined)
      expect(result).toEqual({ mode: 'uniform', value: 0 })
    })

    it('coerces non-numeric non-string values to 0', () => {
      const result = resolveNumericField(null, sampleData)
      expect(result).toEqual({ mode: 'uniform', value: 0 })
    })
  })

  describe('transformAttribute', () => {
    it('applies a scalar function to every element', () => {
      const input = new Float32Array([1, 2, 3, 4])
      const output = transformAttribute(input, v => v * 2)
      expect(output).toEqual(new Float32Array([2, 4, 6, 8]))
    })

    it('handles empty input', () => {
      const input = new Float32Array([])
      const output = transformAttribute(input, v => v * 2)
      expect(output.length).toBe(0)
    })

    it('works with math functions', () => {
      const input = new Float32Array([0, 1, 4, 9])
      const output = transformAttribute(input, Math.sqrt)
      expect(output[0]).toBeCloseTo(0)
      expect(output[1]).toBeCloseTo(1)
      expect(output[2]).toBeCloseTo(2)
      expect(output[3]).toBeCloseTo(3)
    })
  })

  describe('transformAttributeMulti', () => {
    it('produces a multi-component output (e.g., RGBA colors)', () => {
      const input = new Float32Array([0, 0.5, 1])
      const output = transformAttributeMulti(input, 4, v => [v * 255, 0, 0, 255])
      expect(output.length).toBe(12) // 3 items * 4 components
      expect(output[0]).toBe(0) // r=0*255
      expect(output[3]).toBe(255) // a=255
      expect(output[4]).toBeCloseTo(127, 0) // r=0.5*255
      expect(output[8]).toBe(255) // r=1*255
    })

    it('returns Uint8Array for size=4 (colors)', () => {
      const input = new Float32Array([1])
      const output = transformAttributeMulti(input, 4, () => [255, 128, 0, 255])
      expect(output).toBeInstanceOf(Uint8Array)
    })

    it('returns Float32Array for non-color sizes', () => {
      const input = new Float32Array([1])
      const output = transformAttributeMulti(input, 3, v => [v, v, v])
      expect(output).toBeInstanceOf(Float32Array)
    })
  })

  describe('withAttribute', () => {
    it('adds a new attribute to data', () => {
      const base: AttributeEnhancedData = { data: [1, 2, 3], attributes: {} }
      const values = new Float32Array([10, 20, 30])
      const result = withAttribute(base, 'weight', values, 1)
      expect(result.data).toBe(base.data)
      expect(result.attributes?.weight).toEqual({ values, size: 1 })
    })

    it('preserves existing attributes', () => {
      const result = withAttribute(sampleData, 'newAttr', new Float32Array([1]), 1)
      expect(result.attributes?.temperature).toBeDefined()
      expect(result.attributes?.position).toBeDefined()
      expect(result.attributes?.newAttr).toBeDefined()
    })

    it('overwrites an existing attribute of the same name', () => {
      const newValues = new Float32Array([99, 98, 97])
      const result = withAttribute(sampleData, 'temperature', newValues, 1)
      expect(result.attributes?.temperature.values).toBe(newValues)
    })
  })

  describe('extractAttributes', () => {
    it('extracts from {data, attributes} wrapper', () => {
      const result = extractAttributes({
        data: [1, 2],
        attributes: { x: { values: new Float32Array([1, 2]), size: 1 } },
      })
      expect(result.data).toEqual([1, 2])
      expect(result.attributes?.x).toBeDefined()
    })

    it('handles plain arrays', () => {
      const result = extractAttributes([1, 2, 3])
      expect(result.data).toEqual([1, 2, 3])
      expect(result.attributes).toEqual({})
    })

    it('handles null/undefined', () => {
      expect(extractAttributes(null).data).toEqual([])
      expect(extractAttributes(undefined).data).toEqual([])
    })

    it('handles non-object primitives', () => {
      expect(extractAttributes(42).data).toEqual([])
      expect(extractAttributes('hello').data).toEqual([])
    })
  })
})
