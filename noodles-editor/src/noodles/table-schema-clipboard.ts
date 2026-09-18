import { Temporal } from 'temporal-polyfill'
import {
  type ColumnSchema,
  type DateTimeValue,
  getDefaultValue,
  isTableSchema,
  type TableSchema,
  temporalToString,
  validateValue,
} from './table-schema'

export const TABLE_SCHEMA_CLIPBOARD_VERSION = 1 as const

export interface TableSchemaClipboardEnvelope {
  $noodles: 'table-schema'
  version: typeof TABLE_SCHEMA_CLIPBOARD_VERSION
  schema: TableSchema
}

export interface ColumnSchemaClipboardEnvelope {
  $noodles: 'column-schema'
  version: typeof TABLE_SCHEMA_CLIPBOARD_VERSION
  column: ColumnSchema
}

export type ParsedSchemaClipboard =
  | { kind: 'table-schema'; schema: TableSchema }
  | { kind: 'column-schema'; column: ColumnSchema }

export type SchemaClipboardParseResult =
  | { success: true; payload: ParsedSchemaClipboard }
  | { success: false; error: string }

export type SchemaOverlayDecision = 'apply' | 'keep'
export type SchemaOverlayStatus = 'add' | 'update' | 'keep' | 'conflict'

export interface SchemaOverlayValueCounts {
  preserved: number
  coerced: number
  reset: number
}

export interface SchemaOverlayColumnPreview {
  incomingIndex: number
  incomingColumn: ColumnSchema
  targetIndex?: number
  targetColumn?: ColumnSchema
  proposedColumn?: ColumnSchema
  matchedBy?: 'id' | 'name'
  status: SchemaOverlayStatus
  safe: boolean
  defaultDecision: SchemaOverlayDecision
  counts: SchemaOverlayValueCounts
  conflict?: string
}

export interface SchemaOverlayPreview {
  targetSchema: TableSchema
  targetData: unknown[]
  columns: SchemaOverlayColumnPreview[]
}

export interface AppliedSchemaOverlay {
  schema: TableSchema
  data: unknown[]
}

type SchemaOverlaySource = ParsedSchemaClipboard | TableSchema | ColumnSchema

const EMPTY_COUNTS: SchemaOverlayValueCounts = { preserved: 0, coerced: 0, reset: 0 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isColumnSchema(value: unknown): value is ColumnSchema {
  return isTableSchema({ columns: [value] })
}

function effectiveColumnId(column: ColumnSchema): string {
  return column.id ?? column.name
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value instanceof Date) return new Date(value.getTime())
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]))
  }
  return value
}

function cloneColumn(column: ColumnSchema): ColumnSchema {
  return {
    ...column,
    ...(column.options && {
      options: {
        ...column.options,
        ...(column.options.values && { values: [...column.options.values] }),
      },
    }),
    ...(Object.hasOwn(column, 'defaultValue') && {
      defaultValue: cloneValue(column.defaultValue),
    }),
  }
}

function cloneSchema(schema: TableSchema): TableSchema {
  return { columns: schema.columns.map(cloneColumn) }
}

function duplicateSchemaError(schema: TableSchema): string | undefined {
  const names = new Map<string, number>()
  const identities = new Map<string, number>()

  for (const [index, column] of schema.columns.entries()) {
    const previousNameIndex = names.get(column.name)
    if (previousNameIndex !== undefined) {
      return `Columns ${previousNameIndex + 1} and ${index + 1} both use the name "${column.name}".`
    }
    names.set(column.name, index)

    const identity = effectiveColumnId(column)
    const previousIdentityIndex = identities.get(identity)
    if (previousIdentityIndex !== undefined) {
      return `Columns ${previousIdentityIndex + 1} and ${index + 1} both use the identity "${identity}".`
    }
    identities.set(identity, index)
  }

  return undefined
}

function schemaValidationError(schema: unknown): string | undefined {
  if (!isTableSchema(schema)) {
    return 'Expected a schema with unique, non-empty column names, valid column types, and valid options.'
  }
  return duplicateSchemaError(schema)
}

function parseEnvelope(value: Record<string, unknown>): SchemaClipboardParseResult | undefined {
  if (!Object.hasOwn(value, '$noodles')) return undefined
  if (value.version !== TABLE_SCHEMA_CLIPBOARD_VERSION) {
    return {
      success: false,
      error: `Unsupported Noodles schema clipboard version "${String(value.version)}".`,
    }
  }

  if (value.$noodles === 'table-schema') {
    const error = schemaValidationError(value.schema)
    return error
      ? { success: false, error }
      : {
          success: true,
          payload: { kind: 'table-schema', schema: cloneSchema(value.schema as TableSchema) },
        }
  }

  if (value.$noodles === 'column-schema') {
    if (!isColumnSchema(value.column)) {
      return { success: false, error: 'Expected a valid column schema.' }
    }
    return {
      success: true,
      payload: { kind: 'column-schema', column: cloneColumn(value.column) },
    }
  }

  return {
    success: false,
    error: `Unsupported Noodles schema clipboard kind "${String(value.$noodles)}".`,
  }
}

/** Serializes a whole table schema without changing its optional stable identities. */
export function serializeSchemaClipboard(schema: TableSchema): string {
  const error = schemaValidationError(schema)
  if (error) throw new Error(error)
  const envelope: TableSchemaClipboardEnvelope = {
    $noodles: 'table-schema',
    version: TABLE_SCHEMA_CLIPBOARD_VERSION,
    schema: cloneSchema(schema),
  }
  return JSON.stringify(envelope, null, 2)
}

/** Serializes one column schema without changing its optional stable identity. */
export function serializeColumnClipboard(column: ColumnSchema): string {
  if (!isColumnSchema(column)) throw new Error('Expected a valid column schema.')
  const envelope: ColumnSchemaClipboardEnvelope = {
    $noodles: 'column-schema',
    version: TABLE_SCHEMA_CLIPBOARD_VERSION,
    column: cloneColumn(column),
  }
  return JSON.stringify(envelope, null, 2)
}

/** Parses tagged envelopes as well as raw TableSchema and ColumnSchema JSON. */
export function parseSchemaClipboard(text: string): SchemaClipboardParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { success: false, error: 'Clipboard text is not valid JSON.' }
  }

  if (isRecord(value)) {
    const envelopeResult = parseEnvelope(value)
    if (envelopeResult) return envelopeResult
  }

  const tableError = schemaValidationError(value)
  if (!tableError) {
    return {
      success: true,
      payload: { kind: 'table-schema', schema: cloneSchema(value as TableSchema) },
    }
  }

  if (isColumnSchema(value)) {
    return {
      success: true,
      payload: { kind: 'column-schema', column: cloneColumn(value) },
    }
  }

  return {
    success: false,
    error: 'Clipboard JSON is not a valid table schema or column schema.',
  }
}

function isStrictlyValidValue(value: unknown, column: ColumnSchema): boolean {
  if (!validateValue(value, column)) return false

  switch (column.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'point2d':
    case 'vec2':
    case 'point3d':
    case 'vec3':
      return Array.isArray(value) && value.every(item => Number.isFinite(item))
    case 'date':
      if (value instanceof Date) return !Number.isNaN(value.getTime())
      try {
        Temporal.PlainDate.from(value as string)
        return true
      } catch {
        return false
      }
    default:
      return true
  }
}

function parseStrictNumber(value: string): number | undefined {
  const text = value.trim()
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseNumericVector(value: unknown, length: number): number[] | undefined {
  let items: unknown[]
  if (Array.isArray(value)) {
    items = value
  } else if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return undefined
    if (
      (text.startsWith('[') && text.endsWith(']')) ||
      (text.startsWith('(') && text.endsWith(')'))
    ) {
      const inner = text.slice(1, -1)
      try {
        const parsed = text.startsWith('[') ? JSON.parse(text) : inner.split(',')
        if (!Array.isArray(parsed)) return undefined
        items = parsed
      } catch {
        return undefined
      }
    } else {
      items = text.split(',')
    }
  } else {
    return undefined
  }

  if (items.length !== length) return undefined
  const result = items.map(item =>
    typeof item === 'number' && Number.isFinite(item)
      ? item
      : typeof item === 'string'
        ? parseStrictNumber(item)
        : undefined
  )
  return result.every((item): item is number => item !== undefined) ? result : undefined
}

function coerceDateTime(value: unknown): DateTimeValue | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const zoned = Temporal.Instant.from(value.toISOString()).toZonedDateTimeISO('UTC')
    return { datetime: temporalToString(zoned), timezone: 'UTC' }
  }
  if (typeof value !== 'string') return undefined

  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return undefined
  try {
    if (text.includes('[')) {
      const zoned = Temporal.ZonedDateTime.from(text)
      return { datetime: temporalToString(zoned), timezone: zoned.timeZoneId }
    }
    if (/Z$|[+-]\d{2}:\d{2}$/.test(text)) {
      const zoned = Temporal.Instant.from(text).toZonedDateTimeISO('UTC')
      return { datetime: temporalToString(zoned), timezone: 'UTC' }
    }
    const plain = Temporal.PlainDateTime.from(text)
    return {
      datetime: plain.toString({ smallestUnit: 'millisecond' }),
      timezone: 'UTC',
    }
  } catch {
    return undefined
  }
}

type ValueConversion =
  | { status: 'preserved'; value: unknown }
  | { status: 'coerced'; value: unknown }
  | { status: 'reset'; value: unknown }

function resetValue(column: ColumnSchema): unknown {
  if (Object.hasOwn(column, 'defaultValue') && isStrictlyValidValue(column.defaultValue, column)) {
    return cloneValue(column.defaultValue)
  }
  return cloneValue(getDefaultValue(column))
}

/** Deterministically converts a value for an incoming column definition. */
export function coerceSchemaValue(value: unknown, column: ColumnSchema): ValueConversion {
  if (isStrictlyValidValue(value, column)) return { status: 'preserved', value }

  let coerced: unknown
  switch (column.type) {
    case 'number':
      coerced = typeof value === 'string' ? parseStrictNumber(value) : undefined
      break
    case 'string':
      coerced =
        typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : typeof value === 'boolean' || typeof value === 'bigint'
            ? String(value)
            : undefined
      break
    case 'boolean':
      if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) {
        coerced = value.trim().toLowerCase() === 'true'
      }
      break
    case 'color':
      if (typeof value === 'string' && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(value.trim())) {
        coerced = value.trim()
      }
      break
    case 'point2d':
    case 'vec2':
      coerced = parseNumericVector(value, 2)
      break
    case 'point3d':
    case 'vec3':
      coerced = parseNumericVector(value, 3)
      break
    case 'date':
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        try {
          coerced = Temporal.PlainDate.from(value.trim()).toString()
        } catch {
          coerced = undefined
        }
      }
      break
    case 'dateTime':
      coerced = coerceDateTime(value)
      break
    case 'stringLiteral':
      coerced =
        typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : typeof value === 'boolean' || typeof value === 'bigint'
            ? String(value)
            : undefined
      break
  }

  if (coerced !== undefined && isStrictlyValidValue(coerced, column)) {
    return { status: 'coerced', value: coerced }
  }
  return { status: 'reset', value: resetValue(column) }
}

function normalizeOverlaySource(source: SchemaOverlaySource): ColumnSchema[] {
  if ('kind' in source) {
    return source.kind === 'table-schema' ? source.schema.columns : [source.column]
  }
  if ('columns' in source) return source.columns
  return [source]
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    )
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(key => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
    )
  }
  return false
}

function countConversions(
  data: unknown[],
  sourceName: string,
  proposedColumn: ColumnSchema
): SchemaOverlayValueCounts {
  const counts = { ...EMPTY_COUNTS }
  for (const row of data) {
    if (!isRecord(row)) continue
    const conversion = coerceSchemaValue(row[sourceName], proposedColumn)
    counts[conversion.status] += 1
  }
  return counts
}

function incomingConflictIndexes(columns: ColumnSchema[]): Map<number, string> {
  const conflicts = new Map<number, string>()
  const names = new Map<string, number>()
  const identities = new Map<string, number>()

  for (const [index, column] of columns.entries()) {
    if (!column.name.trim()) {
      conflicts.set(index, 'Column names cannot be empty.')
      continue
    }

    const nameOwner = names.get(column.name)
    if (nameOwner !== undefined) {
      const message = `Incoming column name "${column.name}" is duplicated.`
      conflicts.set(nameOwner, message)
      conflicts.set(index, message)
    } else {
      names.set(column.name, index)
    }

    const identity = effectiveColumnId(column)
    const identityOwner = identities.get(identity)
    if (identityOwner !== undefined) {
      const message = `Incoming column identity "${identity}" is duplicated.`
      conflicts.set(identityOwner, message)
      conflicts.set(index, message)
    } else {
      identities.set(identity, index)
    }
  }

  return conflicts
}

/**
 * Previews a non-destructive overlay. Target order and target-only columns are retained;
 * unmatched incoming columns append in source order when applied.
 */
export function createSchemaOverlayPreview(
  targetSchema: TableSchema,
  data: unknown[],
  source: SchemaOverlaySource
): SchemaOverlayPreview {
  const incomingColumns = normalizeOverlaySource(source).map(cloneColumn)
  const targetIdentityIndexes = new Map(
    targetSchema.columns.map((column, index) => [effectiveColumnId(column), index])
  )
  const targetNameIndexes = new Map(
    targetSchema.columns.map((column, index) => [column.name, index])
  )
  const usedTargetIndexes = new Set<number>()
  const sourceConflicts = incomingConflictIndexes(incomingColumns)

  const columns = incomingColumns.map<SchemaOverlayColumnPreview>(
    (incomingColumn, incomingIndex) => {
      const earlyConflict = sourceConflicts.get(incomingIndex)
      if (earlyConflict) {
        return {
          incomingIndex,
          incomingColumn,
          status: 'conflict',
          safe: false,
          defaultDecision: 'keep',
          counts: { ...EMPTY_COUNTS },
          conflict: earlyConflict,
        }
      }

      const identity = effectiveColumnId(incomingColumn)
      let targetIndex = targetIdentityIndexes.get(identity)
      let matchedBy: 'id' | 'name' | undefined = targetIndex === undefined ? undefined : 'id'
      if (targetIndex === undefined) {
        targetIndex = targetNameIndexes.get(incomingColumn.name)
        if (targetIndex !== undefined) matchedBy = 'name'
      }

      const proposedColumn = { ...cloneColumn(incomingColumn), id: identity }
      if (targetIndex === undefined) {
        return {
          incomingIndex,
          incomingColumn,
          proposedColumn,
          status: 'add',
          safe: true,
          defaultDecision: 'apply',
          counts: { ...EMPTY_COUNTS },
        }
      }

      const targetColumn = targetSchema.columns[targetIndex]
      if (usedTargetIndexes.has(targetIndex)) {
        return {
          incomingIndex,
          incomingColumn,
          targetIndex,
          targetColumn: cloneColumn(targetColumn),
          proposedColumn,
          matchedBy,
          status: 'conflict',
          safe: false,
          defaultDecision: 'keep',
          counts: { ...EMPTY_COUNTS },
          conflict: 'Another incoming column already matches this target column.',
        }
      }
      usedTargetIndexes.add(targetIndex)

      const nameOwner = targetNameIndexes.get(proposedColumn.name)
      if (nameOwner !== undefined && nameOwner !== targetIndex) {
        return {
          incomingIndex,
          incomingColumn,
          targetIndex,
          targetColumn: cloneColumn(targetColumn),
          proposedColumn,
          matchedBy,
          status: 'conflict',
          safe: false,
          defaultDecision: 'keep',
          counts: { ...EMPTY_COUNTS },
          conflict: `Renaming to "${proposedColumn.name}" would collide with an existing column.`,
        }
      }

      const counts = countConversions(data, targetColumn.name, proposedColumn)
      const unchanged = deepEqual(targetColumn, proposedColumn)
      return {
        incomingIndex,
        incomingColumn,
        targetIndex,
        targetColumn: cloneColumn(targetColumn),
        proposedColumn,
        matchedBy,
        status: unchanged ? 'keep' : 'update',
        safe: counts.reset === 0,
        defaultDecision: unchanged || counts.reset > 0 ? 'keep' : 'apply',
        counts,
      }
    }
  )

  return {
    targetSchema: cloneSchema(targetSchema),
    targetData: data.map(row => (isRecord(row) ? { ...row } : row)),
    columns,
  }
}

/** Applies the preview defaults plus any per-incoming-column decision overrides. */
export function applySchemaOverlayPreview(
  preview: SchemaOverlayPreview,
  decisions: Record<number, SchemaOverlayDecision> = {}
): AppliedSchemaOverlay {
  const columns = preview.targetSchema.columns.map(cloneColumn)
  const data = preview.targetData.map(row => (isRecord(row) ? { ...row } : row))

  for (const change of preview.columns) {
    const decision = decisions[change.incomingIndex] ?? change.defaultDecision
    if (decision === 'keep') continue
    if (change.status === 'conflict' || !change.proposedColumn) {
      throw new Error(`Cannot apply conflicting column "${change.incomingColumn.name}".`)
    }

    const proposedColumn = cloneColumn(change.proposedColumn)
    if (change.status === 'add') {
      columns.push(proposedColumn)
      for (const row of data) {
        if (isRecord(row)) row[proposedColumn.name] = resetValue(proposedColumn)
      }
      continue
    }

    if (change.targetIndex === undefined || !change.targetColumn) continue
    columns[change.targetIndex] = proposedColumn
    for (const row of data) {
      if (!isRecord(row)) continue
      const conversion = coerceSchemaValue(row[change.targetColumn.name], proposedColumn)
      if (change.targetColumn.name !== proposedColumn.name) delete row[change.targetColumn.name]
      row[proposedColumn.name] = cloneValue(conversion.value)
    }
  }

  return { schema: { columns }, data }
}
