// Table schema types and utilities for TableEditorOp

import { Temporal } from 'temporal-polyfill'

export type ColumnType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'color'
  | 'point2d'
  | 'point3d'
  | 'vec2'
  | 'vec3'
  | 'date'
  | 'dateTime'
  | 'stringLiteral'

export interface ColumnSchema {
  name: string
  type: ColumnType
  options?: {
    // NumberField options
    min?: number
    max?: number
    step?: number
    softMin?: number
    softMax?: number

    // StringLiteralField options
    values?: string[]

    // Point2D options
    geocoder?: boolean
  }
  defaultValue?: unknown
}

export interface TableSchema {
  columns: ColumnSchema[]
}

// Infer column type from a sample value
function inferColumnType(value: unknown): ColumnType {
  if (value === null || value === undefined) {
    return 'string'
  }

  if (typeof value === 'number') {
    return 'number'
  }

  if (typeof value === 'boolean') {
    return 'boolean'
  }

  if (typeof value === 'string') {
    // Check for hex color
    if (/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)) {
      return 'color'
    }
    return 'string'
  }

  if (Array.isArray(value)) {
    // Point2D: [number, number]
    if (value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      return 'point2d'
    }
    // Point3D or Vec3: [number, number, number]
    if (
      value.length === 3 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number' &&
      typeof value[2] === 'number'
    ) {
      return 'vec3'
    }
    // Vec2: [number, number] (same as point2d, defaults to point2d)
    if (value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      return 'vec2'
    }
  }

  if (typeof value === 'object' && value !== null) {
    // Check for Temporal.PlainDate or Date
    if ('calendar' in value && 'year' in value) {
      return 'date'
    }
    if (value instanceof Date) {
      return 'date'
    }

    // Check for Point2D object: { lng, lat } or { x, y }
    const obj = value as Record<string, unknown>
    if (
      ('lng' in obj && 'lat' in obj) ||
      ('x' in obj && 'y' in obj && Object.keys(obj).length === 2)
    ) {
      return 'point2d'
    }

    // Vec3 object: { x, y, z }
    if ('x' in obj && 'y' in obj && 'z' in obj && Object.keys(obj).length === 3) {
      return 'vec3'
    }
  }

  return 'string'
}

// Infer schema from data array
export function inferSchema(data: unknown[]): TableSchema {
  if (!data || data.length === 0) {
    return { columns: [] }
  }

  const firstRow = data[0]
  if (typeof firstRow !== 'object' || firstRow === null || Array.isArray(firstRow)) {
    return { columns: [] }
  }

  const columns: ColumnSchema[] = []
  for (const [key, value] of Object.entries(firstRow)) {
    const type = inferColumnType(value)
    columns.push({
      name: key,
      type,
      defaultValue: getDefaultValue({ name: key, type }),
    })
  }

  return { columns }
}

// Get default value for a column type
export function getDefaultValue(schema: ColumnSchema): unknown {
  switch (schema.type) {
    case 'number':
      return schema.options?.min ?? 0
    case 'string':
      return ''
    case 'boolean':
      return false
    case 'color':
      return '#000000'
    case 'point2d':
      return [0, 0]
    case 'point3d':
      return [0, 0, 0]
    case 'vec2':
      return [0, 0]
    case 'vec3':
      return [0, 0, 0]
    case 'date':
      return new Date().toISOString().split('T')[0] // YYYY-MM-DD
    case 'dateTime': {
      // Return object with datetime and timezone (always default to UTC for new cells)
      const timezone = 'UTC'
      const now = Temporal.Now.zonedDateTimeISO(timezone)
      return {
        datetime: now.toPlainDateTime().toString({ smallestUnit: 'millisecond' }),
        timezone: timezone,
      }
    }
    case 'stringLiteral':
      return schema.options?.values?.[0] ?? ''
    default:
      return null
  }
}

// Validate IANA timezone identifier
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Convert a value to match the target column type
export function convertValue(value: unknown, targetType: ColumnType): unknown {
  // If value is already valid for the target type, return as-is
  if (validateValue(value, { name: '', type: targetType })) {
    return value
  }

  // Otherwise convert to default value for the target type
  return getDefaultValue({ name: '', type: targetType })
}

// Validate a value against a column schema
export function validateValue(value: unknown, schema: ColumnSchema): boolean {
  switch (schema.type) {
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return false
      }
      if (schema.options?.min !== undefined && value < schema.options.min) {
        return false
      }
      if (schema.options?.max !== undefined && value > schema.options.max) {
        return false
      }
      return true

    case 'string':
      return typeof value === 'string'

    case 'boolean':
      return typeof value === 'boolean'

    case 'color':
      return typeof value === 'string' && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value)

    case 'point2d':
    case 'vec2':
      return (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'number'
      )

    case 'point3d':
    case 'vec3':
      return (
        Array.isArray(value) &&
        value.length === 3 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'number' &&
        typeof value[2] === 'number'
      )

    case 'date':
      // Accept ISO date string or Date object
      if (typeof value === 'string') {
        return /^\d{4}-\d{2}-\d{2}$/.test(value)
      }
      return value instanceof Date && !Number.isNaN(value.getTime())

    case 'dateTime': {
      // Accept new format: { datetime: "...", timezone: "..." }
      if (value && typeof value === 'object' && 'datetime' in value) {
        const obj = value as { datetime: unknown; timezone?: unknown }
        if (typeof obj.datetime !== 'string') return false
        if (obj.timezone && typeof obj.timezone !== 'string') return false
        // Validate datetime string
        try {
          Temporal.PlainDateTime.from(obj.datetime)
          return true
        } catch {
          return false
        }
      }
      // Accept Temporal.ZonedDateTime (runtime type)
      if (value && typeof value === 'object' && 'timeZoneId' in value) {
        return true
      }
      // Accept ISO datetime strings (legacy format)
      if (typeof value === 'string') {
        try {
          // Try parsing with Temporal (handles multiple formats)
          // Try as ZonedDateTime first (with timezone annotation)
          if (value.includes('[')) {
            Temporal.ZonedDateTime.from(value)
            return true
          }
          // Try as Instant (with Z or offset)
          if (value.includes('Z') || /[+-]\d{2}:\d{2}/.test(value)) {
            Temporal.Instant.from(value)
            return true
          }
          // Try as PlainDateTime (datetime-local format)
          Temporal.PlainDateTime.from(value)
          return true
        } catch {
          return false
        }
      }
      // Accept Date objects for backward compatibility
      if (value instanceof Date) {
        return !Number.isNaN(value.getTime())
      }
      return false
    }

    case 'stringLiteral':
      if (typeof value !== 'string') {
        return false
      }
      if (schema.options?.values) {
        return schema.options.values.includes(value)
      }
      return true

    default:
      return true
  }
}

// Convert datetime string to Temporal.ZonedDateTime for output
export function stringToTemporal(value: string, timezone: string): Temporal.ZonedDateTime {
  // Handle various input formats:
  // 1. datetime-local format: "2026-05-03T14:30:45.123"
  // 2. ISO 8601 with timezone: "2026-05-03T14:30:45.123+05:00[Asia/Tokyo]"
  // 3. ISO 8601 with Z suffix: "2026-05-03T14:30:45.123Z"

  try {
    // If value has explicit timezone annotation [TimeZone], use it
    if (value.includes('[')) {
      return Temporal.ZonedDateTime.from(value)
    }

    // If value has Z suffix or offset (+/-), parse as instant then convert to target timezone
    if (value.includes('Z') || /[+-]\d{2}:\d{2}/.test(value)) {
      const instant = Temporal.Instant.from(value)
      return instant.toZonedDateTimeISO(timezone)
    }

    // Otherwise, parse as PlainDateTime and add timezone
    const plainDateTime = Temporal.PlainDateTime.from(value)
    return plainDateTime.toZonedDateTime(timezone)
  } catch (error) {
    console.warn(`Failed to parse datetime "${value}" with timezone ${timezone}:`, error)
    // Fallback: use current time in a safe timezone
    const safeTimezone = isValidTimezone(timezone) ? timezone : 'UTC'
    return Temporal.Now.zonedDateTimeISO(safeTimezone)
  }
}

// Convert Temporal.ZonedDateTime to string for storage
export function temporalToString(value: Temporal.ZonedDateTime): string {
  // Store as PlainDateTime string (no timezone suffix) for datetime-local compatibility
  // The timezone is stored in column schema
  return value.toPlainDateTime().toString({ smallestUnit: 'millisecond' })
}

// Convert table data for output: strings → Temporal for dateTime columns
export function prepareTableDataForOutput(data: unknown[], schema: TableSchema): unknown[] {
  if (!data || data.length === 0) {
    return []
  }

  return data.map(row => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return row
    }

    const outputRow: Record<string, unknown> = { ...row }

    for (const col of schema.columns) {
      if (col.type === 'dateTime') {
        const value = (row as Record<string, unknown>)[col.name]

        // Handle new format: { datetime: "...", timezone: "..." }
        if (value && typeof value === 'object' && 'datetime' in value) {
          const obj = value as { datetime: string; timezone: string }
          const timezone = obj.timezone && isValidTimezone(obj.timezone) ? obj.timezone : 'UTC'
          // Convert to Temporal.ZonedDateTime
          outputRow[col.name] = stringToTemporal(obj.datetime, timezone)
        } else if (typeof value === 'string') {
          // Legacy format: plain string (assume UTC)
          outputRow[col.name] = stringToTemporal(value, 'UTC')
        } else if (value && typeof value === 'object' && 'timeZoneId' in value) {
          // Already a ZonedDateTime, keep as-is
          outputRow[col.name] = value
        } else if (value instanceof Date) {
          // Convert Date to ZonedDateTime (assume UTC)
          const instant = Temporal.Instant.fromEpochMilliseconds(value.getTime())
          outputRow[col.name] = instant.toZonedDateTimeISO('UTC')
        }
      }
    }

    return outputRow
  })
}

// Validate entire table data against schema
export function validateTableData(data: unknown[], schema: TableSchema): unknown[] {
  if (!data || data.length === 0) {
    return []
  }

  return data.map((row, rowIndex) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      console.warn(`TableEditorOp: Invalid row at index ${rowIndex}`, row)
      return row
    }

    const validatedRow: Record<string, unknown> = {}
    for (const col of schema.columns) {
      const value = (row as Record<string, unknown>)[col.name]

      // Use default if missing
      if (value === undefined) {
        validatedRow[col.name] = col.defaultValue ?? getDefaultValue(col)
        continue
      }

      // Validate value
      if (!validateValue(value, col)) {
        console.warn(
          `TableEditorOp: Invalid value for column "${col.name}" at row ${rowIndex}:`,
          value,
          'expected type:',
          col.type
        )
        validatedRow[col.name] = col.defaultValue ?? getDefaultValue(col)
      } else {
        validatedRow[col.name] = value
      }
    }

    return validatedRow
  })
}
