import { csvParseRows, tsvFormatRows, tsvParseRows } from 'd3'
import { Temporal } from 'temporal-polyfill'
import { type ColumnSchema, getDefaultValue, isTableSchema, type TableSchema } from './table-schema'
import { coerceSchemaValue, parseSchemaClipboard } from './table-schema-clipboard'
import type { CopiedNodesJSON } from './utils/serialization'

export const TABLE_RANGE_CLIPBOARD_MIME = 'application/x-noodles-table-range+json'
export const TABLE_RANGE_CLIPBOARD_VERSION = 1 as const

export interface TableRangeClipboardEnvelope {
  $noodles: 'table-range'
  version: typeof TABLE_RANGE_CLIPBOARD_VERSION
  columns: ColumnSchema[]
  values: unknown[][]
}

export type TableClipboardFormat =
  | 'noodles-range'
  | 'html'
  | 'tsv'
  | 'json-records'
  | 'json-arrays'
  | 'csv'
  | 'scalar'

export interface ParsedTableDataClipboard {
  kind: 'table'
  format: TableClipboardFormat
  rows: unknown[][]
  /** Explicit names supplied by a typed payload, semantic HTML, or JSON records. */
  columnNames?: string[]
  /** Typed columns supplied by a Noodles range payload. */
  columns?: ColumnSchema[]
}

export type ParsedTableClipboard =
  | ParsedTableDataClipboard
  | { kind: 'schema'; payload: ReturnType<typeof parseSchemaClipboard> & { success: true } }
  | { kind: 'graph'; graph: CopiedNodesJSON }
  | { kind: 'unrecognized'; error?: string }

export interface SerializedTableRangeClipboard {
  plainText: string
  html: string
  richText: string
}

export interface InferredTableData {
  schema: TableSchema
  data: Array<Record<string, unknown>>
  /** Raw value rows after an optional header row has been removed. */
  sourceRows: unknown[][]
  counts: { preserved: number; coerced: number; reset: number }
}

export interface AnchoredTablePastePlan {
  needsPreview: boolean
  data: unknown[]
  sourceRows: unknown[][]
  anchor: { row: number; column: number }
  rowCount: number
  columnCount: number
  rowsAdded: number
  overflowColumnCount: number
  counts: { preserved: number; coerced: number; reset: number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function valueToClipboardText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (isRecord(value) && typeof value.datetime === 'string' && typeof value.timezone === 'string') {
    return `${value.datetime}[${value.timezone}]`
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Serialize a rectangular selection in universal and typed clipboard formats. */
export function serializeTableRangeClipboard(
  columns: ColumnSchema[],
  rows: unknown[][],
  { includeColumnNames = false }: { includeColumnNames?: boolean } = {}
): SerializedTableRangeClipboard {
  const textRows = rows.map(row => row.map(valueToClipboardText))
  const universalRows = includeColumnNames
    ? [columns.map(column => column.name), ...textRows]
    : textRows
  const plainText = tsvFormatRows(universalRows)
  const head = includeColumnNames
    ? `<thead><tr>${columns.map(column => `<th>${escapeHtml(column.name)}</th>`).join('')}</tr></thead>`
    : ''
  const body = `<tbody>${textRows
    .map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`
  const envelope: TableRangeClipboardEnvelope = {
    $noodles: 'table-range',
    version: TABLE_RANGE_CLIPBOARD_VERSION,
    columns: columns.map(cloneColumn),
    values: rows.map(row => row.map(cloneValue)),
  }

  return {
    plainText,
    html: `<table>${head}${body}</table>`,
    richText: JSON.stringify(envelope),
  }
}

export function isGraphClipboard(value: unknown): value is CopiedNodesJSON {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false

  const nodeIds = new Set<string>()
  for (const node of value.nodes) {
    if (
      !isRecord(node) ||
      typeof node.id !== 'string' ||
      node.id.trim() === '' ||
      nodeIds.has(node.id) ||
      typeof node.type !== 'string' ||
      node.type.trim() === '' ||
      !isRecord(node.position) ||
      typeof node.position.x !== 'number' ||
      !Number.isFinite(node.position.x) ||
      typeof node.position.y !== 'number' ||
      !Number.isFinite(node.position.y)
    ) {
      return false
    }
    nodeIds.add(node.id)
  }

  const edgeIds = new Set<string>()
  for (const edge of value.edges) {
    if (
      !isRecord(edge) ||
      typeof edge.id !== 'string' ||
      edge.id.trim() === '' ||
      edgeIds.has(edge.id) ||
      typeof edge.source !== 'string' ||
      edge.source.trim() === '' ||
      typeof edge.target !== 'string' ||
      edge.target.trim() === ''
    ) {
      return false
    }
    edgeIds.add(edge.id)
  }

  return true
}

function parseRichRange(text: string): ParsedTableDataClipboard | undefined {
  if (!text) return undefined
  try {
    const value: unknown = JSON.parse(text)
    if (
      !isRecord(value) ||
      value.$noodles !== 'table-range' ||
      value.version !== TABLE_RANGE_CLIPBOARD_VERSION ||
      !Array.isArray(value.columns) ||
      !Array.isArray(value.values)
    ) {
      return undefined
    }
    const schema = { columns: value.columns }
    if (!isTableSchema(schema) || !value.values.every(row => Array.isArray(row))) return undefined
    return {
      kind: 'table',
      format: 'noodles-range',
      rows: (value.values as unknown[][]).map(row => row.map(cloneValue)),
      columnNames: schema.columns.map(column => column.name),
      columns: schema.columns.map(cloneColumn),
    }
  } catch {
    return undefined
  }
}

function removeSyntheticTrailingRow(text: string, rows: string[][]): string[][] {
  if (!/(?:\r\n|\n|\r)$/.test(text) || rows.length === 0) return rows
  const last = rows.at(-1)
  return last?.length === 1 && last[0] === '' ? rows.slice(0, -1) : rows
}

function hasExplicitSingleColumnCsvSyntax(text: string): boolean {
  return /(?:^|\r\n|\n|\r)"(?:[^"]|"")*"(?:\r\n|\n|\r|$)/.test(text)
}

const HTML_BLOCK_ELEMENTS = new Set([
  'ADDRESS',
  'ARTICLE',
  'BLOCKQUOTE',
  'DIV',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'UL',
])

function hasMeaningfulHtmlContent(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return /\S/.test(node.nodeValue ?? '')
  if (!(node instanceof Element)) return false
  if (node.tagName === 'BR') return true
  return Array.from(node.childNodes).some(hasMeaningfulHtmlContent)
}

/** Preserve explicit and block-level line breaks that `textContent` discards. */
function htmlElementText(element: Element): string {
  const children = Array.from(element.childNodes)
  const hasBlockChildren = children.some(
    child => child instanceof Element && HTML_BLOCK_ELEMENTS.has(child.tagName)
  )
  let text = ''

  for (const [index, child] of children.entries()) {
    if (child.nodeType === Node.TEXT_NODE) {
      const value = child.nodeValue ?? ''
      if (!(hasBlockChildren && /^\s+$/.test(value))) text += value
      continue
    }
    if (!(child instanceof Element)) continue
    if (child.tagName === 'BR') {
      text += '\n'
      continue
    }

    const isBlock = HTML_BLOCK_ELEMENTS.has(child.tagName)
    if (isBlock && text && !text.endsWith('\n')) text += '\n'
    text += htmlElementText(child)
    const hasLaterContent = children.slice(index + 1).some(hasMeaningfulHtmlContent)
    if (isBlock && hasLaterContent && !text.endsWith('\n')) text += '\n'
  }

  return text
}

function parseHtmlTable(html: string): ParsedTableDataClipboard | undefined {
  if (!html || typeof DOMParser === 'undefined') return undefined
  try {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const table = document.querySelector('table')
    if (!table) return undefined
    const tableRows = Array.from(table.querySelectorAll('tr'))
    if (tableRows.length === 0) return undefined

    const rows = tableRows.map(row =>
      Array.from(row.querySelectorAll(':scope > th, :scope > td'), htmlElementText)
    )
    if (rows.every(row => row.length === 0)) return undefined
    const firstCells = Array.from(tableRows[0].querySelectorAll(':scope > th, :scope > td'))
    const semanticHeader = firstCells.length > 0 && firstCells.every(cell => cell.tagName === 'TH')
    return {
      kind: 'table',
      format: 'html',
      rows: semanticHeader ? rows.slice(1) : rows,
      ...(semanticHeader && { columnNames: rows[0] }),
    }
  } catch {
    return undefined
  }
}

function parseJsonTable(value: unknown): ParsedTableDataClipboard | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined

  if (value.every(row => Array.isArray(row))) {
    return {
      kind: 'table',
      format: 'json-arrays',
      rows: (value as unknown[][]).map(row => row.map(cloneValue)),
    }
  }

  if (value.every(isRecord)) {
    const names: string[] = []
    const seen = new Set<string>()
    for (const row of value as Array<Record<string, unknown>>) {
      for (const name of Object.keys(row)) {
        if (!seen.has(name)) {
          seen.add(name)
          names.push(name)
        }
      }
    }
    if (names.length === 0) return undefined
    return {
      kind: 'table',
      format: 'json-records',
      rows: (value as Array<Record<string, unknown>>).map(row =>
        names.map(name => cloneValue(row[name]))
      ),
      columnNames: names,
    }
  }

  return undefined
}

/**
 * Route clipboard content without throwing. Schema and graph payloads are identified
 * before universal tabular formats so the correct owner can handle them.
 */
export function parseTableClipboard(
  {
    plainText = '',
    html = '',
    richText = '',
  }: { plainText?: string; html?: string; richText?: string },
  { allowScalar = false }: { allowScalar?: boolean } = {}
): ParsedTableClipboard {
  const rich = parseRichRange(richText)
  if (rich) return rich

  const text = plainText
  let jsonValue: unknown
  let hasJsonValue = false
  if (text.trim()) {
    try {
      jsonValue = JSON.parse(text)
      hasJsonValue = true
    } catch {
      // Universal text formats are checked below.
    }
  }

  if (hasJsonValue && isRecord(jsonValue)) {
    const schema = parseSchemaClipboard(text)
    if (schema.success) return { kind: 'schema', payload: schema }
    if (isGraphClipboard(jsonValue)) return { kind: 'graph', graph: jsonValue }
  }

  const htmlTable = parseHtmlTable(html)
  if (htmlTable) return htmlTable

  if (text.includes('\t')) {
    return {
      kind: 'table',
      format: 'tsv',
      rows: removeSyntheticTrailingRow(text, tsvParseRows(text)),
    }
  }

  if (hasJsonValue) {
    const jsonTable = parseJsonTable(jsonValue)
    if (jsonTable) return jsonTable
  }

  if (/\r|\n/.test(text)) {
    try {
      const rows = removeSyntheticTrailingRow(text, csvParseRows(text))
      const width = rows[0]?.length ?? 0
      if (
        rows.length >= 2 &&
        (width > 1 || hasExplicitSingleColumnCsvSyntax(text)) &&
        rows.every(row => row.length === width)
      ) {
        return { kind: 'table', format: 'csv', rows }
      }
    } catch {
      // Malformed CSV remains unclaimed.
    }
  }

  if (allowScalar && text !== '') {
    return { kind: 'table', format: 'scalar', rows: [[text]] }
  }
  return { kind: 'unrecognized' }
}

/** Normalize blank and duplicate headers without dropping their source positions. */
export function normalizeTableColumnNames(names: unknown[], count = names.length): string[] {
  const used = new Set<string>()
  return Array.from({ length: count }, (_, index) => {
    const trimmed = typeof names[index] === 'string' ? names[index].trim() : ''
    const base = trimmed || `Column ${index + 1}`
    let name = base
    let suffix = 2
    while (used.has(name)) {
      name = `${base} ${suffix}`
      suffix += 1
    }
    used.add(name)
    return name
  })
}

function parseStrictNumber(value: string): number | undefined {
  const text = value.trim()
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseVector(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    return value.length >= 2 && value.length <= 3 && value.every(Number.isFinite)
      ? (value as number[])
      : undefined
  }
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value.trim())
    return Array.isArray(parsed) &&
      parsed.length >= 2 &&
      parsed.length <= 3 &&
      parsed.every(Number.isFinite)
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

function isStrictDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false
  try {
    Temporal.PlainDate.from(value.trim())
    return true
  } catch {
    return false
  }
}

function isStrictDateTime(value: unknown): boolean {
  if (isRecord(value) && typeof value.datetime === 'string' && typeof value.timezone === 'string') {
    return true
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.trim())) return false
  try {
    const text = value.trim()
    if (text.includes('[')) Temporal.ZonedDateTime.from(text)
    else if (/Z$|[+-]\d{2}:\d{2}$/.test(text)) Temporal.Instant.from(text)
    else Temporal.PlainDateTime.from(text)
    return true
  } catch {
    return false
  }
}

function inferColumn(values: unknown[], name: string): ColumnSchema {
  const populated = values.filter(
    value => value !== undefined && value !== null && !(typeof value === 'string' && value === '')
  )
  let type: ColumnSchema['type'] = 'string'

  if (populated.length > 0) {
    if (
      populated.every(
        value =>
          typeof value === 'boolean' ||
          (typeof value === 'string' && /^(?:true|false)$/i.test(value.trim()))
      )
    ) {
      type = 'boolean'
    } else if (
      populated.every(
        value =>
          (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && parseStrictNumber(value) !== undefined)
      )
    ) {
      type = 'number'
    } else if (
      populated.every(
        value => typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value.trim())
      )
    ) {
      type = 'color'
    } else if (populated.every(isStrictDateTime)) {
      type = 'dateTime'
    } else if (populated.every(isStrictDate)) {
      type = 'date'
    } else {
      const vectors = populated.map(parseVector)
      if (vectors.every(vector => vector?.length === 2)) type = 'vec2'
      else if (vectors.every(vector => vector?.length === 3)) type = 'vec3'
    }
  }

  const column = { name, type } satisfies ColumnSchema
  return { ...column, defaultValue: getDefaultValue(column) }
}

/** Infer a complete schema from every nonblank cell and coerce every imported row. */
export function inferTableData(
  sourceRows: unknown[][],
  {
    firstRowContainsHeaders = true,
    columnNames,
    columns,
  }: {
    firstRowContainsHeaders?: boolean
    columnNames?: string[]
    columns?: ColumnSchema[]
  } = {}
): InferredTableData {
  const rows = sourceRows.map(row => [...row])
  const explicitMetadata = (columns?.length ?? 0) > 0 || (columnNames?.length ?? 0) > 0
  const values = firstRowContainsHeaders && !explicitMetadata ? rows.slice(1) : rows
  const width = Math.max(
    columns?.length ?? 0,
    columnNames?.length ?? 0,
    ...rows.map(row => row.length),
    0
  )
  const rawNames =
    columns?.map(column => column.name) ??
    columnNames ??
    (firstRowContainsHeaders && !explicitMetadata ? rows[0] : undefined) ??
    []
  const names = normalizeTableColumnNames(rawNames, width)
  const inferredColumns = columns?.length
    ? Array.from({ length: width }, (_, index) => {
        const supplied = columns[index]
        if (supplied) return { ...cloneColumn(supplied), name: names[index] }
        return inferColumn(
          values.map(row => row[index]),
          names[index]
        )
      })
    : Array.from({ length: width }, (_, index) =>
        inferColumn(
          values.map(row => row[index]),
          names[index]
        )
      )

  const counts = { preserved: 0, coerced: 0, reset: 0 }
  const data = values.map(row =>
    Object.fromEntries(
      inferredColumns.map((column, index) => {
        const value = row[index]
        if (value === '' && column.type === 'string') {
          counts.preserved += 1
          return [column.name, '']
        }
        const conversion = coerceSchemaValue(value, column)
        counts[conversion.status] += 1
        return [column.name, conversion.value]
      })
    )
  )
  return {
    schema: { columns: inferredColumns },
    data,
    sourceRows: values.map(row => row.map(cloneValue)),
    counts,
  }
}

function defaultRow(schema: TableSchema): Record<string, unknown> {
  return Object.fromEntries(
    schema.columns.map(column => [
      column.name,
      cloneValue(column.defaultValue ?? getDefaultValue(column)),
    ])
  )
}

/** Plan an anchored paste without silently truncating or resetting invalid values. */
export function planAnchoredTablePaste(
  schema: TableSchema,
  currentData: unknown[],
  sourceRows: unknown[][],
  anchor: { row: number; column: number }
): AnchoredTablePastePlan {
  const data = currentData.map(row => (isRecord(row) ? { ...row } : defaultRow(schema)))
  const rowCount = sourceRows.length
  const columnCount = sourceRows.reduce((max, row) => Math.max(max, row.length), 0)
  const requiredRows = anchor.row + rowCount
  const rowsAdded = Math.max(0, requiredRows - data.length)
  for (let index = 0; index < rowsAdded; index += 1) data.push(defaultRow(schema))

  const counts = { preserved: 0, coerced: 0, reset: 0 }
  for (const [sourceRowIndex, sourceRow] of sourceRows.entries()) {
    const targetRow = data[anchor.row + sourceRowIndex]
    if (!isRecord(targetRow)) continue
    for (const [sourceColumnIndex, value] of sourceRow.entries()) {
      const column = schema.columns[anchor.column + sourceColumnIndex]
      if (!column) continue
      const conversion = coerceSchemaValue(value, column)
      counts[conversion.status] += 1
      if (conversion.status !== 'reset') targetRow[column.name] = cloneValue(conversion.value)
    }
  }

  const overflowColumnCount = Math.max(0, anchor.column + columnCount - schema.columns.length)
  return {
    needsPreview: overflowColumnCount > 0 || counts.reset > 0,
    data,
    sourceRows: sourceRows.map(row => row.map(cloneValue)),
    anchor: { ...anchor },
    rowCount,
    columnCount,
    rowsAdded,
    overflowColumnCount,
    counts,
  }
}
