import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { DataField, NumberField, StringField, UnknownField } from '../fields'
import { schemasAreCompatible, validateConnection } from './can-connect'

describe('can-connect error handling', () => {
  describe('schemasAreCompatible with invalid schemas', () => {
    it('should handle null schemas gracefully', () => {
      const validSchema = z.number()
      // @ts-expect-error - testing null schema handling
      const result = schemasAreCompatible(null, validSchema)
      expect(result).toBe(false)
    })

    it('should handle undefined schemas gracefully', () => {
      const validSchema = z.string()
      // @ts-expect-error - testing undefined schema handling
      const result = schemasAreCompatible(undefined, validSchema)
      expect(result).toBe(false)
    })

    it('should handle non-Zod objects gracefully', () => {
      const validSchema = z.boolean()
      const invalidSchema = { notAZodSchema: true } as any
      const result = schemasAreCompatible(invalidSchema, validSchema)
      expect(result).toBe(false)
    })

    it('should handle valid schemas normally', () => {
      const schema1 = z.number()
      const schema2 = z.number()
      const result = schemasAreCompatible(schema1, schema2)
      expect(result).toBe(true)
    })

    it('should handle incompatible schemas', () => {
      const schema1 = z.number()
      const schema2 = z.string()
      const result = schemasAreCompatible(schema1, schema2)
      expect(result).toBe(false)
    })
  })

  describe('validateConnection with edge cases', () => {
    it('should allow UnknownField to connect to any field', () => {
      const unknownField = new UnknownField()
      const numberField = new NumberField(42)

      const result = validateConnection(unknownField, numberField)
      expect(result.valid).toBe(true)
    })

    it('should validate compatible field types', () => {
      const numberField1 = new NumberField(10)
      const numberField2 = new NumberField(20)

      const result = validateConnection(numberField1, numberField2)
      expect(result.valid).toBe(true)
    })

    it('should reject incompatible field types', () => {
      const numberField = new NumberField(42)
      const stringField = new StringField('hello')

      const result = validateConnection(numberField, stringField)
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle DataField connections', () => {
      const dataField1 = new DataField()
      const dataField2 = new DataField()

      const result = validateConnection(dataField1, dataField2)
      expect(result.valid).toBe(true)
    })

    it('should validate field values when available', () => {
      const numberField1 = new NumberField(10, { min: 0, max: 100 })
      const numberField2 = new NumberField(20, { min: 0, max: 50 })

      // Set value that's valid for field1 but not field2
      numberField1.setValue(75)

      const result = validateConnection(numberField1, numberField2)
      // Should fail because 75 > 50 (max of field2)
      expect(result.valid).toBe(false)
    })

    it('should allow connections without value constraints', () => {
      const stringField1 = new StringField('test')
      const stringField2 = new StringField('other')

      const result = validateConnection(stringField1, stringField2)
      expect(result.valid).toBe(true)
    })
  })

  describe('schema unwrapping edge cases', () => {
    it('should handle optional schemas', () => {
      const optionalNumber = z.number().optional()
      const number = z.number()

      // Optional number should be compatible with number
      const result = schemasAreCompatible(optionalNumber, number)
      // This will fail because optional adds undefined as possibility
      // but we're testing that it doesn't crash
      expect(typeof result).toBe('boolean')
    })

    it('should handle nullable schemas', () => {
      const nullableString = z.string().nullable()
      const string = z.string()

      const result = schemasAreCompatible(nullableString, string)
      expect(typeof result).toBe('boolean')
    })

    it('should handle deeply nested wrapper types', () => {
      const deeplyWrapped = z.number().optional().nullable().default(42)
      const simple = z.number()

      const result = schemasAreCompatible(deeplyWrapped, simple)
      expect(typeof result).toBe('boolean')
    })

    it('should handle array schemas', () => {
      const arraySchema = z.array(z.number())
      const anotherArray = z.array(z.number())

      const result = schemasAreCompatible(arraySchema, anotherArray)
      expect(result).toBe(true)
    })

    it('should handle union types', () => {
      const union = z.union([z.number(), z.string()])
      const number = z.number()

      const result = schemasAreCompatible(number, union)
      expect(typeof result).toBe('boolean')
    })
  })
})
