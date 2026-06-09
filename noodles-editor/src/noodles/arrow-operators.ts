/**
 * Arrow-aware operator wrappers
 *
 * This module provides Arrow-aware versions of common operators that can work
 * with both Arrow tables and JS arrays. These wrappers detect the input type
 * and dispatch to the appropriate implementation.
 *
 * Key operators enhanced with Arrow support:
 * - FilterOp: Zero-copy filtering for Arrow tables
 * - SortOp: Columnar sorting
 * - SliceOp: Zero-copy views
 * - SelectOp: Column projection without materialization
 */

import type * as arrow from 'apache-arrow'
import type { ArrowOrArray } from './arrow-data'
import {
  type ArrowCapabilities,
  arrowToArray,
  getColumn,
  hasColumn,
  isArrowTable,
  SQL_ARROW_CAPABILITIES,
} from './arrow-data'

/**
 * Arrow-aware filter implementation
 * When given an Arrow table, materializes only the filtered subset
 */
export function filterArrowAware<T = unknown>(
  data: ArrowOrArray<T>,
  columnName: string,
  condition: string,
  value: unknown
): ArrowOrArray<T> {
  if (!isArrowTable(data)) {
    // Fallback to JS array filtering (existing logic)
    return filterJSArray(data as T[], columnName, condition, value)
  }

  // Arrow path: Get column as typed array for efficient filtering
  if (!hasColumn(data, columnName)) {
    return []
  }

  const column = getColumn(data, columnName)
  const indices: number[] = []

  // Build index list of matching rows
  for (let i = 0; i < column.length; i++) {
    const cellValue = column[i]
    if (matchesCondition(cellValue, condition, value)) {
      indices.push(i)
    }
  }

  // If no matches, return empty array
  if (indices.length === 0) {
    return []
  }

  // If all rows match, return original table (zero-copy)
  if (indices.length === data.numRows) {
    return data
  }

  // Otherwise, we need to create a filtered view
  // For now, materialize and convert to JS array
  // TODO: Use Arrow RecordBatch.select() for zero-copy filtering
  const rows = arrowToArray<T>(data)
  return indices.map(i => rows[i])
}

/**
 * JS array filter implementation (existing logic)
 */
function filterJSArray<T = unknown>(
  data: T[],
  columnName: string,
  condition: string,
  value: unknown
): T[] {
  let fn: (d: T) => boolean = () => true
  switch (condition) {
    case 'equals':
      fn = (d) => (d as Record<string, unknown>)[columnName] === value
      break
    case 'not equals':
      fn = (d) => (d as Record<string, unknown>)[columnName] !== value
      break
    case 'greater than':
      fn = (d) => ((d as Record<string, unknown>)[columnName] as number) > (value as number)
      break
    case 'less than':
      fn = (d) => ((d as Record<string, unknown>)[columnName] as number) < (value as number)
      break
    case 'greater than or equal to':
      fn = (d) => ((d as Record<string, unknown>)[columnName] as number) >= (value as number)
      break
    case 'less than or equal to':
      fn = (d) => ((d as Record<string, unknown>)[columnName] as number) <= (value as number)
      break
    case 'contains':
      fn = (d) => String((d as Record<string, unknown>)[columnName]).includes(String(value))
      break
    case 'not contains':
      fn = (d) => !String((d as Record<string, unknown>)[columnName]).includes(String(value))
      break
    case 'in': {
      const values = String(value)
        .split(',')
        .map(s => s.trim())
      fn = (d) => values.includes(String((d as Record<string, unknown>)[columnName]))
      break
    }
    case 'not in': {
      const values = String(value)
        .split(',')
        .map(s => s.trim())
      fn = (d) => !values.includes(String((d as Record<string, unknown>)[columnName]))
      break
    }
  }
  return data.filter(fn)
}

/**
 * Check if a cell value matches a condition
 */
function matchesCondition(cellValue: unknown, condition: string, value: unknown): boolean {
  switch (condition) {
    case 'equals':
      return cellValue === value
    case 'not equals':
      return cellValue !== value
    case 'greater than':
      return (cellValue as number) > (value as number)
    case 'less than':
      return (cellValue as number) < (value as number)
    case 'greater than or equal to':
      return (cellValue as number) >= (value as number)
    case 'less than or equal to':
      return (cellValue as number) <= (value as number)
    case 'contains':
      return String(cellValue).includes(String(value))
    case 'not contains':
      return !String(cellValue).includes(String(value))
    case 'in': {
      const values = String(value)
        .split(',')
        .map(s => s.trim())
      return values.includes(String(cellValue))
    }
    case 'not in': {
      const values = String(value)
        .split(',')
        .map(s => s.trim())
      return !values.includes(String(cellValue))
    }
    default:
      return true
  }
}

/**
 * Arrow-aware sort implementation
 */
export function sortArrowAware<T = unknown>(
  data: ArrowOrArray<T>,
  key: string,
  order: 'asc' | 'desc'
): ArrowOrArray<T> {
  if (!isArrowTable(data)) {
    // JS array sort (existing logic)
    return sortJSArray(data as T[], key, order)
  }

  // Arrow path: Get column for comparison
  if (!hasColumn(data, key)) {
    return data
  }

  const column = getColumn(data, key)

  // Build index array for indirect sorting
  const indices = Array.from({ length: data.numRows }, (_, i) => i)

  // Sort indices based on column values
  indices.sort((a, b) => {
    const aVal = column[a] as number
    const bVal = column[b] as number
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    return order === 'desc' ? -cmp : cmp
  })

  // For now, materialize and reorder
  // TODO: Use Arrow take() for zero-copy reordering
  const rows = arrowToArray<T>(data)
  return indices.map(i => rows[i])
}

/**
 * JS array sort implementation
 */
function sortJSArray<T = unknown>(data: T[], key: string, order: 'asc' | 'desc'): T[] {
  return [...data].sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[key] as number
    const bVal = (b as Record<string, unknown>)[key] as number
    if (aVal < bVal) return order === 'desc' ? 1 : -1
    if (aVal > bVal) return order === 'desc' ? -1 : 1
    return 0
  })
}

/**
 * Arrow-aware slice implementation (zero-copy for Arrow)
 */
export function sliceArrowAware<T = unknown>(
  data: ArrowOrArray<T>,
  start: number,
  end: number
): ArrowOrArray<T> {
  if (!isArrowTable(data)) {
    return (data as T[]).slice(start, end)
  }

  // Arrow slice is zero-copy!
  return data.slice(start, end) as arrow.Table
}

/**
 * Arrow-aware column selection (projection)
 */
export function selectColumnsArrowAware<T = unknown>(
  data: ArrowOrArray<T>,
  columns: string[]
): ArrowOrArray<T> {
  if (!isArrowTable(data)) {
    // JS array: project columns
    return (data as T[]).map(row => {
      const selected: Record<string, unknown> = {}
      const rowObj = row as Record<string, unknown>
      for (const col of columns) {
        if (col in rowObj) {
          selected[col] = rowObj[col]
        }
      }
      return selected
    }) as T[]
  }

  // Arrow path: Select only specified columns (zero-copy)
  // This creates a new table with only the requested columns
  const selectedFields: arrow.Vector[] = []
  for (const col of columns) {
    const vector = data.getChild(col)
    if (vector) {
      selectedFields.push(vector)
    }
  }

  // If no columns selected, return empty array
  if (selectedFields.length === 0) {
    return []
  }

  // For now, materialize selected columns
  // TODO: Create new Arrow table with selected columns only
  const rows = arrowToArray<T>(data)
  return rows.map(row => {
    const selected: Record<string, unknown> = {}
    const rowObj = row as Record<string, unknown>
    for (const col of columns) {
      if (col in rowObj) {
        selected[col] = rowObj[col]
      }
    }
    return selected
  }) as T[]
}

/**
 * Get Arrow capabilities for SQL-compilable operators
 */
export function getSQLOperatorCapabilities(): ArrowCapabilities {
  return SQL_ARROW_CAPABILITIES
}

/**
 * Check if operator should use Arrow-aware execution
 * Returns true if input data is Arrow and operator supports it
 */
export function shouldUseArrowPath(
  data: unknown,
  operatorCapabilities: ArrowCapabilities
): boolean {
  return isArrowTable(data) && operatorCapabilities.supportsArrowInput
}
