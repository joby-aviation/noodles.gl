import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import {
  convertValue,
  getDefaultValue,
  inferSchema,
  isValidTimezone,
  prepareTableDataForOutput,
  stringToTemporal,
  temporalToString,
  validateTableData,
  validateValue,
} from './table-schema'

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

  it('should validate dateTime with DateTimeValue object format', () => {
    const schema = {
      name: 'test',
      type: 'dateTime' as const,
    }
    expect(
      validateValue({ datetime: '2024-01-15T10:30:45', timezone: 'America/New_York' }, schema)
    ).toBe(true)
    expect(
      validateValue({ datetime: '2024-01-15T10:30:45.123', timezone: 'UTC' }, schema)
    ).toBe(true)
  })

  it('should reject non-DateTimeValue formats', () => {
    const schema = { name: 'test', type: 'dateTime' as const }
    expect(validateValue('2024-01-15T10:30:45', schema)).toBe(false)  // Plain string
    expect(validateValue(new Date(), schema)).toBe(false)  // Date object
    const zonedDateTime = Temporal.ZonedDateTime.from('2024-01-15T10:30:45[America/New_York]')
    expect(validateValue(zonedDateTime, schema)).toBe(false)  // Temporal object
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

describe('convertValue', () => {
  it('should return value as-is if already valid for target type', () => {
    expect(convertValue(42, 'number')).toBe(42)
    expect(convertValue('test', 'string')).toBe('test')
    expect(convertValue(true, 'boolean')).toBe(true)
    expect(convertValue('#ff5733', 'color')).toBe('#ff5733')
    expect(convertValue([1, 2], 'point2d')).toEqual([1, 2])
    expect(convertValue([1, 2, 3], 'vec3')).toEqual([1, 2, 3])
  })

  it('should convert string to color default when invalid', () => {
    expect(convertValue('not-a-color', 'color')).toBe('#000000')
    expect(convertValue('test', 'color')).toBe('#000000')
    expect(convertValue(123, 'color')).toBe('#000000')
  })

  it('should convert string to number default', () => {
    expect(convertValue('test', 'number')).toBe(0)
    expect(convertValue('123', 'number')).toBe(0)
  })

  it('should convert number to string', () => {
    // Numbers are not valid strings, so convert to default
    expect(convertValue(42, 'string')).toBe('')
  })

  it('should convert string to boolean default', () => {
    expect(convertValue('true', 'boolean')).toBe(false)
    expect(convertValue('false', 'boolean')).toBe(false)
  })

  it('should convert invalid arrays to point2d default', () => {
    expect(convertValue([1], 'point2d')).toEqual([0, 0])
    expect(convertValue([1, 2, 3], 'point2d')).toEqual([0, 0])
    expect(convertValue('not-array', 'point2d')).toEqual([0, 0])
  })

  it('should convert invalid arrays to vec3 default', () => {
    expect(convertValue([1, 2], 'vec3')).toEqual([0, 0, 0])
    expect(convertValue([1, 2, 3, 4], 'vec3')).toEqual([0, 0, 0])
    expect(convertValue('not-array', 'vec3')).toEqual([0, 0, 0])
  })

  it('should convert any value to date default', () => {
    const result = convertValue('not-date', 'date')
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('should handle null and undefined by converting to default', () => {
    expect(convertValue(null, 'number')).toBe(0)
    expect(convertValue(undefined, 'string')).toBe('')
    expect(convertValue(null, 'boolean')).toBe(false)
    expect(convertValue(undefined, 'color')).toBe('#000000')
  })
})

describe('isValidTimezone', () => {
  it('should validate UTC', () => {
    expect(isValidTimezone('UTC')).toBe(true)
  })

  it('should validate IANA timezone names', () => {
    expect(isValidTimezone('America/New_York')).toBe(true)
    expect(isValidTimezone('Europe/London')).toBe(true)
    expect(isValidTimezone('Asia/Tokyo')).toBe(true)
    expect(isValidTimezone('Australia/Sydney')).toBe(true)
  })

  it('should reject invalid timezone names', () => {
    expect(isValidTimezone('Invalid/Timezone')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone('NotATimezone')).toBe(false)
    // Note: EST is technically valid as a legacy timezone in Intl, though IANA names are preferred
  })
})

describe('stringToTemporal', () => {
  it('should convert datetime-local string to ZonedDateTime', () => {
    const result = stringToTemporal('2024-01-15T10:30:45.123', 'UTC')
    expect(result).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(result.timeZoneId).toBe('UTC')
    expect(result.year).toBe(2024)
    expect(result.month).toBe(1)
    expect(result.day).toBe(15)
    expect(result.hour).toBe(10)
    expect(result.minute).toBe(30)
    expect(result.second).toBe(45)
    expect(result.millisecond).toBe(123)
  })

  it('should handle invalid timezone by falling back to UTC', () => {
    const result = stringToTemporal('2024-01-15T10:30:45', 'Invalid/Timezone')
    expect(result).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(result.timeZoneId).toBe('UTC')
  })

  it('should handle partial timezone string by falling back to UTC', () => {
    const result = stringToTemporal('2024-01-15T10:30:45', 'Amer')
    expect(result).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(result.timeZoneId).toBe('UTC')
  })

  it('should handle empty timezone string by falling back to UTC', () => {
    const result = stringToTemporal('2024-01-15T10:30:45', '')
    expect(result).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(result.timeZoneId).toBe('UTC')
  })

  it('should handle different timezones', () => {
    const result = stringToTemporal('2024-01-15T10:30:45', 'America/New_York')
    expect(result.timeZoneId).toBe('America/New_York')
    expect(result.hour).toBe(10)
  })

  it('should parse ISO 8601 strings with timezone annotation', () => {
    const isoString = '2024-01-15T10:30:45[Asia/Tokyo]'
    const result = stringToTemporal(isoString, 'UTC')
    expect(result).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(result.timeZoneId).toBe('Asia/Tokyo')
  })

  it('should convert ISO 8601 strings with offset to target timezone', () => {
    const isoString = '2024-01-15T10:30:45+09:00'
    const result = stringToTemporal(isoString, 'UTC')
    expect(result).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(result.timeZoneId).toBe('UTC')
    // Time should be converted from +09:00 to UTC
    expect(result.hour).toBe(1) // 10:30 JST = 01:30 UTC
  })

  it('should handle invalid strings gracefully', () => {
    const result = stringToTemporal('invalid', 'UTC')
    expect(result).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(result.timeZoneId).toBe('UTC')
  })
})

describe('temporalToString', () => {
  it('should convert ZonedDateTime to datetime-local string', () => {
    const zonedDateTime = Temporal.ZonedDateTime.from('2024-01-15T10:30:45.123[UTC]')
    const result = temporalToString(zonedDateTime)
    expect(result).toBe('2024-01-15T10:30:45.123')
  })

  it('should preserve milliseconds', () => {
    const zonedDateTime = Temporal.ZonedDateTime.from('2024-01-15T10:30:45.456[America/New_York]')
    const result = temporalToString(zonedDateTime)
    expect(result).toMatch(/2024-01-15T10:30:45\.456/)
  })

  it('should strip timezone from output', () => {
    const zonedDateTime = Temporal.ZonedDateTime.from('2024-01-15T10:30:45[Asia/Tokyo]')
    const result = temporalToString(zonedDateTime)
    expect(result).not.toContain('Asia/Tokyo')
    expect(result).not.toContain('+')
    expect(result).not.toContain('Z')
  })
})

describe('prepareTableDataForOutput', () => {
  it('should convert dateTime objects to Temporal.ZonedDateTime', () => {
    const data = [
      { id: 1, timestamp: { datetime: '2024-01-15T10:30:45.123', timezone: 'UTC' } },
      { id: 2, timestamp: { datetime: '2024-01-15T11:45:00', timezone: 'America/New_York' } },
    ]
    const schema = {
      columns: [
        { name: 'id', type: 'number' as const },
        { name: 'timestamp', type: 'dateTime' as const },
      ],
    }

    const result = prepareTableDataForOutput(data, schema)

    expect(result[0].timestamp).toBeInstanceOf(Temporal.ZonedDateTime)
    expect((result[0].timestamp as Temporal.ZonedDateTime).timeZoneId).toBe('UTC')
    expect(result[1].timestamp).toBeInstanceOf(Temporal.ZonedDateTime)
    expect((result[1].timestamp as Temporal.ZonedDateTime).timeZoneId).toBe('America/New_York')
  })

  it('should use timezone from cell value', () => {
    const data = [{ event: 'test', time: { datetime: '2024-01-15T10:30:45', timezone: 'America/New_York' } }]
    const schema = {
      columns: [
        { name: 'event', type: 'string' as const },
        { name: 'time', type: 'dateTime' as const },
      ],
    }

    const result = prepareTableDataForOutput(data, schema)
    const row = result[0] as Record<string, unknown>

    expect((row.time as Temporal.ZonedDateTime).timeZoneId).toBe('America/New_York')
  })

  it('should preserve non-dateTime columns unchanged', () => {
    const data = [{ id: 42, name: 'test', active: true, time: { datetime: '2024-01-15T10:30:45', timezone: 'UTC' } }]
    const schema = {
      columns: [
        { name: 'id', type: 'number' as const },
        { name: 'name', type: 'string' as const },
        { name: 'active', type: 'boolean' as const },
        { name: 'time', type: 'dateTime' as const },
      ],
    }

    const result = prepareTableDataForOutput(data, schema)
    const row = result[0] as Record<string, unknown>

    expect(row.id).toBe(42)
    expect(row.name).toBe('test')
    expect(row.active).toBe(true)
    expect(row.time).toBeInstanceOf(Temporal.ZonedDateTime)
  })

  it('should handle empty data', () => {
    const result = prepareTableDataForOutput([], { columns: [] })
    expect(result).toEqual([])
  })

  it('should handle multiple dateTime columns with different timezones', () => {
    const data = [
      {
        event: 'test',
        created_utc: { datetime: '2024-01-15T10:30:45', timezone: 'UTC' },
        created_ny: { datetime: '2024-01-15T05:30:45', timezone: 'America/New_York' },
      },
    ]
    const schema = {
      columns: [
        { name: 'event', type: 'string' as const },
        { name: 'created_utc', type: 'dateTime' as const },
        { name: 'created_ny', type: 'dateTime' as const },
      ],
    }

    const result = prepareTableDataForOutput(data, schema)
    const row = result[0] as Record<string, unknown>

    expect((row.created_utc as Temporal.ZonedDateTime).timeZoneId).toBe('UTC')
    expect((row.created_ny as Temporal.ZonedDateTime).timeZoneId).toBe('America/New_York')
  })

  it('should fall back to UTC for invalid timezone in cell value', () => {
    const data = [{ time: { datetime: '2024-01-15T10:30:45', timezone: 'Invalid/Zone' } }]
    const schema = {
      columns: [{ name: 'time', type: 'dateTime' as const }],
    }

    const result = prepareTableDataForOutput(data, schema)
    const row = result[0] as Record<string, unknown>

    expect((row.time as Temporal.ZonedDateTime).timeZoneId).toBe('UTC')
  })
})

describe('getDefaultValue with dateTime', () => {
  it('should generate default dateTime as object with UTC timezone', () => {
    const result = getDefaultValue({ name: 'test', type: 'dateTime' })
    expect(typeof result).toBe('object')
    expect(result).toHaveProperty('datetime')
    expect(result).toHaveProperty('timezone')
    expect((result as {timezone: string}).timezone).toBe('UTC')
    expect((result as {datetime: string}).datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/)
  })
})

describe('DateTimeValue validation', () => {
  const schema = { name: 'test', type: 'dateTime' as const }

  it('should accept valid DateTimeValue with UTC', () => {
    expect(validateValue({ datetime: '2024-01-15T10:30:45.123', timezone: 'UTC' }, schema)).toBe(true)
  })

  it('should accept valid DateTimeValue with any IANA timezone', () => {
    expect(validateValue({ datetime: '2024-01-15T10:30:45', timezone: 'America/New_York' }, schema)).toBe(true)
    expect(validateValue({ datetime: '2024-01-15T10:30:45', timezone: 'Europe/London' }, schema)).toBe(true)
    expect(validateValue({ datetime: '2024-01-15T10:30:45', timezone: 'Asia/Tokyo' }, schema)).toBe(true)
  })

  it('should reject DateTimeValue with invalid timezone', () => {
    expect(validateValue({ datetime: '2024-01-15T10:30:45', timezone: 'Invalid/Zone' }, schema)).toBe(false)
    expect(validateValue({ datetime: '2024-01-15T10:30:45', timezone: 'NotAZone' }, schema)).toBe(false)
    expect(validateValue({ datetime: '2024-01-15T10:30:45', timezone: '' }, schema)).toBe(false)
  })

  it('should reject DateTimeValue with invalid datetime string', () => {
    expect(validateValue({ datetime: 'not-a-date', timezone: 'UTC' }, schema)).toBe(false)
    expect(validateValue({ datetime: '2024-13-45', timezone: 'UTC' }, schema)).toBe(false)
    expect(validateValue({ datetime: '', timezone: 'UTC' }, schema)).toBe(false)
  })

  it('should reject DateTimeValue with wrong types', () => {
    expect(validateValue({ datetime: 123, timezone: 'UTC' }, schema)).toBe(false)
    expect(validateValue({ datetime: '2024-01-15T10:30:45', timezone: 123 }, schema)).toBe(false)
    expect(validateValue({ datetime: null, timezone: 'UTC' }, schema)).toBe(false)
  })

  it('should reject objects missing datetime field', () => {
    expect(validateValue({ timezone: 'UTC' }, schema)).toBe(false)
  })

  it('should reject objects missing timezone field', () => {
    expect(validateValue({ datetime: '2024-01-15T10:30:45' }, schema)).toBe(false)
  })

  it('should reject plain strings', () => {
    expect(validateValue('2024-01-15T10:30:45', schema)).toBe(false)
  })

  it('should reject Date objects', () => {
    expect(validateValue(new Date(), schema)).toBe(false)
  })

  it('should reject null and undefined', () => {
    expect(validateValue(null, schema)).toBe(false)
    expect(validateValue(undefined, schema)).toBe(false)
  })
})

describe('prepareTableDataForOutput with DateTimeValue', () => {
  it('should convert DateTimeValue to Temporal.ZonedDateTime with correct timezone', () => {
    const data = [
      { time: { datetime: '2024-01-15T10:30:45.123', timezone: 'America/New_York' } }
    ]
    const schema = {
      columns: [{ name: 'time', type: 'dateTime' as const }],
    }

    const result = prepareTableDataForOutput(data, schema)
    const zonedDateTime = result[0].time as Temporal.ZonedDateTime

    expect(zonedDateTime).toBeInstanceOf(Temporal.ZonedDateTime)
    expect(zonedDateTime.timeZoneId).toBe('America/New_York')
    expect(zonedDateTime.year).toBe(2024)
    expect(zonedDateTime.month).toBe(1)
    expect(zonedDateTime.day).toBe(15)
  })

  it('should handle invalid timezone by falling back to UTC', () => {
    const data = [
      { time: { datetime: '2024-01-15T10:30:45', timezone: 'Invalid/Zone' } }
    ]
    const schema = {
      columns: [{ name: 'time', type: 'dateTime' as const }],
    }

    const result = prepareTableDataForOutput(data, schema)
    const zonedDateTime = result[0].time as Temporal.ZonedDateTime

    expect(zonedDateTime.timeZoneId).toBe('UTC')
  })

  it('should skip invalid DateTimeValue objects', () => {
    const data = [
      { time: { datetime: 'invalid' } }  // Missing timezone
    ]
    const schema = {
      columns: [{ name: 'time', type: 'dateTime' as const }],
    }

    const result = prepareTableDataForOutput(data, schema)
    expect(result[0].time).toEqual({ datetime: 'invalid' })  // Unchanged
  })

  it('should preserve milliseconds in conversion', () => {
    const data = [
      { time: { datetime: '2024-01-15T10:30:45.456', timezone: 'UTC' } }
    ]
    const schema = {
      columns: [{ name: 'time', type: 'dateTime' as const }],
    }

    const result = prepareTableDataForOutput(data, schema)
    const zonedDateTime = result[0].time as Temporal.ZonedDateTime

    expect(zonedDateTime.millisecond).toBe(456)
  })
})
