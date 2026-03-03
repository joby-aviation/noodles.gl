import { describe, expect, it } from 'vitest'

import {
  ArrayField,
  CompoundPropsField,
  DataField,
  ListField,
  NumberField,
  Point2DField,
  StringField,
  UnknownField,
} from '../fields'
import { canConnect, validateConnection } from './can-connect'

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

  it('does not allow incompatible fields with different types to connect', () => {
    const field1 = new DataField()
    field1.setValue([1, 2, 3])
    const field2 = new StringField('test')
    expect(canConnect(field1, field2)).toBe(false)
    expect(canConnect(field2, field1)).toBe(true) // DataField can connect to any field
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
})
