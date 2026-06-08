/**
 * Arrow-aware data types for zero-copy data flow between SQL, operators, and Deck.gl
 *
 * This module provides types and utilities for working with Apache Arrow tables
 * as the primary data representation, with fallback to JavaScript arrays for
 * backwards compatibility.
 */

import type * as arrow from 'apache-arrow'

/**
 * Data can be either an Arrow Table (zero-copy, columnar) or JS array (flexible, slower)
 */
export type ArrowOrArray<T = unknown> = arrow.Table<any> // biome-ignore lint/suspicious/noExplicitAny: Arrow table requires any | T[]

/**
 * Check if data is an Arrow Table
 */
export function isArrowTable(data: unknown): data is arrow.Table {
  return data != null && typeof data === 'object' && 'schema' in data && 'numRows' in data
}

/**
 * Convert Arrow table to JS array (materializes data - expensive!)
 * Only use when necessary for non-Arrow-aware code
 */
export function arrowToArray<T = unknown>(data: ArrowOrArray<T>): T[] {
  if (isArrowTable(data)) {
    // Spread operator creates new objects to avoid Arrow proxy issues
    return data.toArray().map((row: any) // biome-ignore lint/suspicious/noExplicitAny: Dynamic row type => ({ ...row })) as T[]
  }
  return data as T[]
}

/**
 * Get row count without materializing data
 */
export function getRowCount(data: ArrowOrArray): number {
  if (isArrowTable(data)) {
    return data.numRows
  }
  return data.length
}

/**
 * Get column names without materializing data
 */
export function getColumnNames(data: ArrowOrArray): string[] {
  if (isArrowTable(data)) {
    return data.schema.fields.map(f => f.name)
  }
  if (data.length === 0) return []
  return Object.keys(data[0])
}

/**
 * Check if a column exists
 */
export function hasColumn(data: ArrowOrArray, columnName: string): boolean {
  if (isArrowTable(data)) {
    return data.schema.fields.some(f => f.name === columnName)
  }
  if (data.length === 0) return false
  return columnName in data[0]
}

/**
 * Get a single column as a typed array (zero-copy for Arrow)
 */
export function getColumn<T = unknown>(data: ArrowOrArray, columnName: string): T[] {
  if (isArrowTable(data)) {
    const column = data.getChild(columnName)
    if (!column) throw new Error(`Column '${columnName}' not found`)
    // Return the underlying typed array (zero-copy)
    return column.toArray() as T[]
  }
  return (data as unknown[]).map(row => row[columnName]) as T[]
}

/**
 * Slice data (zero-copy view for Arrow)
 */
export function sliceData<T = unknown>(
  data: ArrowOrArray<T>,
  start: number,
  end: number
): ArrowOrArray<T> {
  if (isArrowTable(data)) {
    // Arrow slice is a zero-copy view
    return data.slice(start, end)
  }
  return data.slice(start, end)
}

/**
 * Filter data (returns new Arrow table or JS array)
 */
export function filterData<T = unknown>(
  data: ArrowOrArray<T>,
  predicate: (row: T, index: number) => boolean
): ArrowOrArray<T> {
  if (isArrowTable(data)) {
    // For Arrow, we need to materialize, filter, then reconstruct
    // TODO: In future, use Arrow compute functions for columnar filtering
    const rows = arrowToArray(data)
    const filtered = rows.filter(predicate)
    // Return JS array for now - reconstructing Arrow table is complex
    return filtered
  }
  return data.filter(predicate)
}

/**
 * Sort data (returns new Arrow table or JS array)
 */
export function sortData<T = unknown>(
  data: ArrowOrArray<T>,
  compareFn: (a: T, b: T) => number
): ArrowOrArray<T> {
  if (isArrowTable(data)) {
    // For Arrow, materialize, sort, then return JS array
    // TODO: Use Arrow compute sort functions
    const rows = arrowToArray(data)
    return rows.sort(compareFn)
  }
  return [...data].sort(compareFn)
}

/**
 * Convert JS array to Arrow table
 * Useful for CodeOp/custom operators that produce JS data
 */
export async function arrayToArrow<T = unknown>(data: T[]): Promise<arrow.Table> {
  // Dynamic import to avoid loading Arrow in all contexts
  const { tableFromJSON } = await import('apache-arrow')
  return tableFromJSON(data)
}

/**
 * Operator capability flags
 */
export interface ArrowCapabilities {
  /** Can this operator accept Arrow tables as input? */
  supportsArrowInput: boolean

  /** Can this operator produce Arrow tables as output? */
  supportsArrowOutput: boolean

  /** Preferred data format (hint for upstream operators) */
  preferredFormat: 'arrow' | 'array' | 'either'
}

/**
 * Default capabilities for operators (backwards compatible - JS arrays only)
 */
export const DEFAULT_ARROW_CAPABILITIES: ArrowCapabilities = {
  supportsArrowInput: false,
  supportsArrowOutput: false,
  preferredFormat: 'array',
}

/**
 * Capabilities for SQL-compilable operators (Arrow-native)
 */
export const SQL_ARROW_CAPABILITIES: ArrowCapabilities = {
  supportsArrowInput: true,
  supportsArrowOutput: true,
  preferredFormat: 'arrow',
}

/**
 * Type guard for Arrow-aware operators
 */
export function hasArrowCapabilities(op: unknown): op is { arrowCapabilities: ArrowCapabilities } {
  return op != null && 'arrowCapabilities' in op
}

/**
 * Get Arrow capabilities for an operator (with defaults)
 */
export function getArrowCapabilities(op: unknown): ArrowCapabilities {
  if (hasArrowCapabilities(op)) {
    return op.arrowCapabilities
  }
  return DEFAULT_ARROW_CAPABILITIES
}

/**
 * Ensure data is in the format an operator expects
 * Converts between Arrow and JS arrays as needed
 */
export async function ensureDataFormat<T = unknown>(
  data: ArrowOrArray<T>,
  targetCapabilities: ArrowCapabilities
): Promise<ArrowOrArray<T>> {
  const isArrow = isArrowTable(data)

  if (isArrow && targetCapabilities.supportsArrowInput) {
    // Arrow in, Arrow accepted - no conversion
    return data
  }

  if (!isArrow && !targetCapabilities.supportsArrowInput) {
    // JS in, JS expected - no conversion
    return data
  }

  if (isArrow && !targetCapabilities.supportsArrowInput) {
    // Arrow in, but operator needs JS - materialize
    return arrowToArray(data)
  }

  // JS in, operator wants Arrow - convert
  return arrayToArrow(data as T[])
}
