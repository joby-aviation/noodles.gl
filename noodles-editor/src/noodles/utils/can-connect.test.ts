import { describe, expect, it } from 'vitest'
import z from 'zod/v4'

import {
  ArrayField,
  ColorField,
  CompoundPropsField,
  DataField,
  FunctionField,
  LayerField,
  ListField,
  NumberField,
  Point2DField,
  StringField,
  UnknownField,
} from '../fields'
import { canConnect, schemasAreCompatible, validateConnection } from './can-connect'

describe('CanConnect', () => {
  it('allows compatible fields to connect', () => {
    const field1 = new NumberField(5)
    const field2 = new NumberField(10)
    expect(canConnect(field2, field1)).toBe(true)
  })

  it('does not allow incompatible fields to connect', () => {
    const field1 = new NumberField(5)
    const field2 = new StringField('test')
    expect(canConnect(field2, field1)).toBe(false)
  })

  it('allows compatible fields with different types to connect', () => {
    const field1 = new DataField([1, 2, 3])
    const field2 = new DataField(['a', 'b', 'c'])
    expect(canConnect(field2, field1)).toBe(true)
  })

  it('does not allow nested incompatible fields to connect', () => {
    const dataField = new ArrayField(new NumberField())
    dataField.setValue([1, 2, 3])

    const arrayField = new ArrayField(new StringField('test'))
    arrayField.setValue(['a', 'b', 'c'])

    expect(canConnect(arrayField, dataField)).toBe(false)
    expect(canConnect(dataField, arrayField)).toBe(false)
  })

  it('allows DataField (z.unknown) to connect to/from any field', () => {
    // DataField uses z.unknown() schema, which is optimistically compatible with anything.
    // Type mismatches are caught at runtime, not connection time.
    const field1 = new DataField()
    field1.setValue([1, 2, 3])
    const field2 = new StringField('test')
    expect(canConnect(field1, field2)).toBe(true) // unknown -> string is optimistically valid
    expect(canConnect(field2, field1)).toBe(true) // string -> unknown is valid (DataField accepts anything)
  })

  it('allows ArrayFields to parse the subfield type correctly when connecting to a DataField', () => {
    const dataField = new DataField([{ lng: 1, lat: 2 }])
    const arrayField = new ArrayField(new Point2DField())

    expect(arrayField.value).toEqual([])

    expect(canConnect(arrayField, dataField), 'arrayField can connect to dataField').toBe(true)
    expect(canConnect(dataField, arrayField), 'dataField can connect to arrayField').toBe(true)
  })

  it('parses ListField child types correctly', () => {
    const numberField = new NumberField(5)
    const listField = new ListField(new NumberField())

    expect(canConnect(numberField, listField)).toBe(true)
  })

  it('allows connecting compatible CompoundPropsFields', () => {
    const field1 = new CompoundPropsField({
      latitude: new NumberField(),
      longitude: new NumberField(),
    })
    const field2 = new CompoundPropsField({
      latitude: new NumberField(),
      longitude: new NumberField(),
    })
    expect(canConnect(field2, field1)).toBe(true)
  })

  it('does not allow incompatible CompoundPropsFields to connect', () => {
    const field1 = new CompoundPropsField({
      latitude: new NumberField(),
      longitude: new NumberField(),
    })
    const field2 = new CompoundPropsField({
      test1: new StringField('test'),
      test2: new NumberField(),
    })
    expect(canConnect(field2, field1)).toBe(false)
  })

  it('should allow connecting compatible CompoundPropsFields with extra properties', () => {
    const field1 = new CompoundPropsField({
      latitude: new NumberField(),
      longitude: new NumberField(),
    })
    const field2 = new CompoundPropsField({
      latitude: new NumberField(),
      longitude: new NumberField(),
      zoom: new NumberField(),
    })
    expect(canConnect(field2, field1)).toBe(true)
  })

  it('allows FunctionField to connect to a ColorField with accessor: true', () => {
    // ColorField with accessor only (no transform) — schema is union([string, function])
    const fnField = new FunctionField()
    const colorField = new ColorField('#ff0000', { accessor: true })
    expect(canConnect(fnField, colorField)).toBe(true)
  })

  it('allows FunctionField to connect to a ColorField with accessor and transform', () => {
    // All layer getColor inputs use both accessor: true and transform: hexToColor.
    // This produces pipe(union([string, function]), transform), which previously failed
    // because unwrapSchema could not traverse ZodPipe (Zod v4 uses def.in, not def.innerType).
    const fnField = new FunctionField()
    const colorField = new ColorField('#ff0000', { accessor: true, transform: (v: unknown) => v })
    expect(canConnect(fnField, colorField)).toBe(true)
  })

  it('allows UnknownField to connect to any field', () => {
    const field1 = new UnknownField()
    const field2 = new NumberField(10)
    expect(canConnect(field1, field2), 'UnknownField can connect to NumberField').toBe(true)
    expect(canConnect(field2, field1), 'NumberField can connect to UnknownField').toBe(true)

    const field3 = new StringField('test')
    expect(canConnect(field1, field3), 'UnknownField can connect to StringField').toBe(true)
    expect(canConnect(field3, field1), 'StringField can connect to UnknownField').toBe(true)

    const field4 = new DataField([1, 2, 3])
    expect(canConnect(field1, field4), 'UnknownField can connect to DataField').toBe(true)
    expect(canConnect(field4, field1), 'DataField can connect to UnknownField').toBe(true)

    const field5 = new ArrayField(new NumberField())
    expect(canConnect(field1, field5), 'UnknownField can connect to ArrayField').toBe(true)
    expect(canConnect(field5, field1), 'ArrayField can connect to UnknownField').toBe(true)

    const field6 = new ArrayField(new StringField('test'))
    expect(canConnect(field1, field6), 'UnknownField can connect to ArrayField with String').toBe(
      true
    )
    expect(canConnect(field6, field1), 'ArrayField with String can connect to UnknownField').toBe(
      true
    )
  })
})

describe('ValidateConnection', () => {
  it('returns valid for compatible fields', () => {
    const field1 = new NumberField(5)
    const field2 = new NumberField(10)
    const result = validateConnection(field2, field1)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns invalid with error message for incompatible fields', () => {
    const field1 = new NumberField(5)
    const field2 = new StringField('test')
    const result = validateConnection(field2, field1)
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Type mismatch')
    expect(result.error).toContain('string')
    expect(result.error).toContain('number')
  })

  it('returns valid for UnknownField connecting to any field', () => {
    const unknownField = new UnknownField()
    const numberField = new NumberField(10)
    const result = validateConnection(unknownField, numberField)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns invalid with error message for nested incompatible fields', () => {
    const dataField = new ArrayField(new NumberField())
    dataField.setValue([1, 2, 3])

    const arrayField = new ArrayField(new StringField('test'))
    arrayField.setValue(['a', 'b', 'c'])

    const result = validateConnection(arrayField, dataField)
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Type mismatch')
  })

  it('returns constraint violation error for number exceeding max', () => {
    const source = new NumberField(100) // Value is 100
    const target = new NumberField(0, { max: 50 }) // Max is 50

    const result = validateConnection(source, target)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Constraint violation')
    expect(result.error).not.toContain('Type mismatch')
    expect(result.error).toContain('50') // Should mention the constraint
  })

  it('returns constraint violation error for number below min', () => {
    const source = new NumberField(-10)
    const target = new NumberField(0, { min: 0 })

    const result = validateConnection(source, target)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Constraint violation')
    expect(result.error).not.toContain('Type mismatch')
  })

  it('returns type mismatch for different types even when values could parse', () => {
    const source = new StringField('test')
    const target = new NumberField(0)

    const result = validateConnection(source, target)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Type mismatch')
    expect(result.error).toContain('string')
    expect(result.error).toContain('number')
  })

  it('returns type mismatch for nested type errors in arrays', () => {
    const source = new ArrayField(new StringField())
    source.setValue(['a', 'b'])
    const target = new ArrayField(new NumberField())

    const result = validateConnection(source, target)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Type mismatch')
    expect(result.error).not.toContain('Constraint violation')
  })

  it('returns severity "error" for type mismatches', () => {
    const source = new StringField('test')
    const target = new NumberField(0)

    const result = validateConnection(source, target)
    expect(result.valid).toBe(false)
    expect(result.severity).toBe('error')
  })

  it('returns severity "warning" for constraint violations', () => {
    const source = new NumberField(100)
    const target = new NumberField(0, { max: 50 })

    const result = validateConnection(source, target)
    expect(result.valid).toBe(false)
    expect(result.severity).toBe('warning')
  })

  it('DataField → ListField<LayerField> is valid (structural compatibility)', () => {
    const dataField = new DataField()
    const listField = new ListField(new LayerField())

    const result = validateConnection(dataField, listField)
    expect(result.valid).toBe(true)
  })

  it('unexecuted operator with undefined value is valid', () => {
    // DataField defaults to undefined before execution
    const dataField = new DataField()
    expect(dataField.value).toEqual([])

    // Even with the default empty array, structural compatibility should pass
    const listField = new ListField(new LayerField())
    const result = validateConnection(dataField, listField)
    expect(result.valid).toBe(true)
  })
})

describe('schemasAreCompatible', () => {
  it('z.unknown() is compatible with any schema', () => {
    expect(schemasAreCompatible(z.unknown(), z.number())).toBe(true)
    expect(schemasAreCompatible(z.number(), z.unknown())).toBe(true)
    expect(schemasAreCompatible(z.unknown(), z.string())).toBe(true)
    expect(schemasAreCompatible(z.unknown(), z.object({ a: z.number() }))).toBe(true)
  })

  it('same primitive types are compatible', () => {
    expect(schemasAreCompatible(z.number(), z.number())).toBe(true)
    expect(schemasAreCompatible(z.string(), z.string())).toBe(true)
    expect(schemasAreCompatible(z.boolean(), z.boolean())).toBe(true)
  })

  it('different primitive types are incompatible', () => {
    expect(schemasAreCompatible(z.string(), z.number())).toBe(false)
    expect(schemasAreCompatible(z.number(), z.string())).toBe(false)
    expect(schemasAreCompatible(z.boolean(), z.number())).toBe(false)
  })

  it('arrays are compatible if elements are compatible', () => {
    expect(schemasAreCompatible(z.array(z.number()), z.array(z.number()))).toBe(true)
    expect(schemasAreCompatible(z.array(z.string()), z.array(z.number()))).toBe(false)
    expect(schemasAreCompatible(z.array(z.unknown()), z.array(z.number()))).toBe(true)
  })

  it('objects are compatible if target properties exist in source with compatible types', () => {
    const source = z.object({ a: z.number(), b: z.string() })
    const target = z.object({ a: z.number() })
    expect(schemasAreCompatible(source, target)).toBe(true)

    // Missing required property
    expect(schemasAreCompatible(target, source)).toBe(false)
  })

  it('objects with incompatible property types are incompatible', () => {
    const source = z.object({ a: z.string() })
    const target = z.object({ a: z.number() })
    expect(schemasAreCompatible(source, target)).toBe(false)
  })

  it('optional wrappers are unwrapped for comparison', () => {
    expect(schemasAreCompatible(z.number().optional(), z.number())).toBe(true)
    expect(schemasAreCompatible(z.number(), z.number().optional())).toBe(true)
    expect(schemasAreCompatible(z.string().optional(), z.number())).toBe(false)
  })

  it('nullable wrappers are unwrapped for comparison', () => {
    expect(schemasAreCompatible(z.number().nullable(), z.number())).toBe(true)
    expect(schemasAreCompatible(z.string().nullable(), z.number())).toBe(false)
  })

  it('readonly wrappers are unwrapped for comparison', () => {
    expect(schemasAreCompatible(z.number().readonly(), z.number())).toBe(true)
  })

  it('z.unknown().readonly() is compatible with z.object()', () => {
    // This is the exact schema combination from DataField → LayerField
    expect(schemasAreCompatible(z.unknown().readonly(), z.object({ a: z.number() }))).toBe(true)
  })

  it('tuples are compatible if items match', () => {
    expect(
      schemasAreCompatible(z.tuple([z.string(), z.number()]), z.tuple([z.string(), z.number()]))
    ).toBe(true)
    expect(
      schemasAreCompatible(z.tuple([z.string(), z.number()]), z.tuple([z.number(), z.string()]))
    ).toBe(false)
    expect(schemasAreCompatible(z.tuple([z.string()]), z.tuple([z.string(), z.number()]))).toBe(
      false
    )
  })

  it('string is compatible with literal<string>', () => {
    expect(schemasAreCompatible(z.string(), z.literal('foo'))).toBe(true)
    expect(schemasAreCompatible(z.number(), z.literal(5))).toBe(true)
    expect(schemasAreCompatible(z.string(), z.literal(5))).toBe(false)
  })

  it('string is compatible with union of literals', () => {
    const literals = z.union([z.literal('foo'), z.literal('bar')])
    expect(schemasAreCompatible(z.string(), literals)).toBe(true)
    expect(schemasAreCompatible(z.number(), literals)).toBe(false)
  })

  it('unions are compatible if all source options match at least one target option', () => {
    const source = z.union([z.string(), z.number()])
    const target = z.union([z.string(), z.number(), z.boolean()])
    expect(schemasAreCompatible(source, target)).toBe(true)

    // Source has option not in target
    const incompatible = z.union([z.string()])
    expect(schemasAreCompatible(source, incompatible)).toBe(false)
  })
})
