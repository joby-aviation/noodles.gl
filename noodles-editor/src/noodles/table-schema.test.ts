import { describe, expect, it } from 'vitest'
import { getDefaultValue, inferSchema, validateTableData, validateValue } from './table-schema'

describe('inferSchema', () => {
  it('should infer number columns', () => {
    const data = [{ count: 42, price: 19.99 }]
    const schema = inferSchema(data)
    expect(schema.columns).toHaveLength(2)
    expect(schema.columns[0].name).toBe('count')
    expect(schema.columns[0].type).toBe('number')
    expect(schema.columns[1].name).toBe('price')
    expect(schema.columns[1].type).toBe('number')
  })

  it('should infer string columns', () => {
    const data = [{ name: 'Alice', city: 'NYC' }]
    const schema = inferSchema(data)
    expect(schema.columns).toHaveLength(2)
    expect(schema.columns[0].type).toBe('string')
    expect(schema.columns[1].type).toBe('string')
  })

  it('should infer boolean columns', () => {
    const data = [{ active: true, verified: false }]
    const schema = inferSchema(data)
    expect(schema.columns).toHaveLength(2)
    expect(schema.columns[0].type).toBe('boolean')
    expect(schema.columns[1].type).toBe('boolean')
  })

  it('should infer color columns from hex strings', () => {
    const data = [{ color: '#ff5733', background: '#00FF00' }]
    const schema = inferSchema(data)
    expect(schema.columns).toHaveLength(2)
    expect(schema.columns[0].type).toBe('color')
    expect(schema.columns[1].type).toBe('color')
  })

  it('should infer point2d columns from [lng, lat] arrays', () => {
    const data = [{ position: [10.5, 20.3] }]
    const schema = inferSchema(data)
    expect(schema.columns).toHaveLength(1)
    expect(schema.columns[0].type).toBe('point2d')
  })

  it('should infer vec3 columns from [x, y, z] arrays', () => {
    const data = [{ velocity: [1.0, 2.0, 3.0] }]
    const schema = inferSchema(data)
    expect(schema.columns).toHaveLength(1)
    expect(schema.columns[0].type).toBe('vec3')
  })

  it('should return empty schema for empty data', () => {
    const schema = inferSchema([])
    expect(schema.columns).toHaveLength(0)
  })

  it('should return empty schema for non-object data', () => {
    const schema = inferSchema([42, 'string', true])
    expect(schema.columns).toHaveLength(0)
  })

  it('should infer mixed column types', () => {
    const data = [
      {
        name: 'Test',
        count: 5,
        active: true,
        color: '#ff0000',
        position: [10, 20],
      },
    ]
    const schema = inferSchema(data)
    expect(schema.columns).toHaveLength(5)
    expect(schema.columns[0].type).toBe('string')
    expect(schema.columns[1].type).toBe('number')
    expect(schema.columns[2].type).toBe('boolean')
    expect(schema.columns[3].type).toBe('color')
    expect(schema.columns[4].type).toBe('point2d')
  })
})

describe('getDefaultValue', () => {
  it('should return 0 for number columns', () => {
    expect(getDefaultValue({ name: 'test', type: 'number' })).toBe(0)
  })

  it('should return empty string for string columns', () => {
    expect(getDefaultValue({ name: 'test', type: 'string' })).toBe('')
  })

  it('should return false for boolean columns', () => {
    expect(getDefaultValue({ name: 'test', type: 'boolean' })).toBe(false)
  })

  it('should return #000000 for color columns', () => {
    expect(getDefaultValue({ name: 'test', type: 'color' })).toBe('#000000')
  })

  it('should return [0, 0] for point2d columns', () => {
    expect(getDefaultValue({ name: 'test', type: 'point2d' })).toEqual([0, 0])
  })

  it('should return [0, 0, 0] for vec3 columns', () => {
    expect(getDefaultValue({ name: 'test', type: 'vec3' })).toEqual([0, 0, 0])
  })

  it('should respect min option for number columns', () => {
    expect(getDefaultValue({ name: 'test', type: 'number', options: { min: 10 } })).toBe(10)
  })
})

describe('validateValue', () => {
  it('should validate number values', () => {
    const schema = { name: 'test', type: 'number' as const }
    expect(validateValue(42, schema)).toBe(true)
    expect(validateValue('string', schema)).toBe(false)
    expect(validateValue(Number.NaN, schema)).toBe(false)
  })

  it('should validate number range constraints', () => {
    const schema = { name: 'test', type: 'number' as const, options: { min: 0, max: 100 } }
    expect(validateValue(50, schema)).toBe(true)
    expect(validateValue(-1, schema)).toBe(false)
    expect(validateValue(101, schema)).toBe(false)
  })

  it('should validate string values', () => {
    const schema = { name: 'test', type: 'string' as const }
    expect(validateValue('hello', schema)).toBe(true)
    expect(validateValue(42, schema)).toBe(false)
  })

  it('should validate boolean values', () => {
    const schema = { name: 'test', type: 'boolean' as const }
    expect(validateValue(true, schema)).toBe(true)
    expect(validateValue(false, schema)).toBe(true)
    expect(validateValue('true', schema)).toBe(false)
  })

  it('should validate color values', () => {
    const schema = { name: 'test', type: 'color' as const }
    expect(validateValue('#ff5733', schema)).toBe(true)
    expect(validateValue('#ff573388', schema)).toBe(true)
    expect(validateValue('#ZZZ', schema)).toBe(false)
    expect(validateValue('red', schema)).toBe(false)
  })

  it('should validate point2d values', () => {
    const schema = { name: 'test', type: 'point2d' as const }
    expect(validateValue([10.5, 20.3], schema)).toBe(true)
    expect(validateValue([10], schema)).toBe(false)
    expect(validateValue([10, 20, 30], schema)).toBe(false)
    expect(validateValue('invalid', schema)).toBe(false)
  })

  it('should validate vec3 values', () => {
    const schema = { name: 'test', type: 'vec3' as const }
    expect(validateValue([1, 2, 3], schema)).toBe(true)
    expect(validateValue([1, 2], schema)).toBe(false)
    expect(validateValue([1, 2, 3, 4], schema)).toBe(false)
  })

  it('should validate date values', () => {
    const schema = { name: 'test', type: 'date' as const }
    expect(validateValue('2024-01-15', schema)).toBe(true)
    expect(validateValue(new Date(), schema)).toBe(true)
    expect(validateValue('invalid-date', schema)).toBe(false)
  })
})

describe('validateTableData', () => {
  it('should apply default values for missing columns', () => {
    const schema = {
      columns: [
        { name: 'name', type: 'string' as const, defaultValue: '' },
        { name: 'count', type: 'number' as const, defaultValue: 0 },
      ],
    }
    const data = [{ name: 'Alice' }] // missing 'count'
    const validated = validateTableData(data, schema)
    expect(validated[0]).toEqual({ name: 'Alice', count: 0 })
  })

  it('should replace invalid values with defaults', () => {
    const schema = {
      columns: [
        { name: 'count', type: 'number' as const, defaultValue: 0 },
        { name: 'color', type: 'color' as const, defaultValue: '#000000' },
      ],
    }
    const data = [{ count: 'invalid', color: 'not-a-color' }]
    const validated = validateTableData(data, schema)
    expect(validated[0]).toEqual({ count: 0, color: '#000000' })
  })

  it('should preserve valid values', () => {
    const schema = {
      columns: [
        { name: 'name', type: 'string' as const },
        { name: 'count', type: 'number' as const },
      ],
    }
    const data = [{ name: 'Alice', count: 42 }]
    const validated = validateTableData(data, schema)
    expect(validated[0]).toEqual({ name: 'Alice', count: 42 })
  })

  it('should handle empty data', () => {
    const schema = { columns: [] }
    const validated = validateTableData([], schema)
    expect(validated).toEqual([])
  })
})
