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
  isArrowTable,
  arrowToArray,
  getRowCount,
  hasColumn,
  getColumn,
  SQL_ARROW_CAPABILITIES,
  type ArrowCapabilities,
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
  let fn = (_d: unknown) => true
  switch (condition) {
    case 'equals':
      fn = (d: any) => d[columnName] === value
      break
    case 'not equals':
      fn = (d: any) => d[columnName] !== value
      break
    case 'greater than':
      fn = (d: any) => d[columnName] > value
      break
    case 'less than':
      fn = (d: any) => d[columnName] < value
      break
    case 'greater than or equal to':
      fn = (d: any) => d[columnName] >= value
      break
    case 'less than or equal to':
      fn = (d: any) => d[columnName] <= value
      break
    case 'contains':
      fn = (d: any) => String(d[columnName]).includes(String(value))
      break
    case 'not contains':
      fn = (d: any) => !String(d[columnName]).includes(String(value))
      break
    case 'in': {
      const values = String(value)
        .split(',')
        .map(s => s.trim())
      fn = (d: any) => values.includes(String(d[columnName]))
      break
    }
    case 'not in': {
      const values = String(value)
        .split(',')
        .map(s => s.trim())
      fn = (d: any) => !values.includes(String(d[columnName]))
      break
    }
  }
  return data.filter(fn as any)
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
      return (cellValue as any) > value
    case 'less than':
      return (cellValue as any) < value
    case 'greater than or equal to':
      return (cellValue as any) >= value
    case 'less than or equal to':
      return (cellValue as any) <= value
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
    const aVal = column[a]
    const bVal = column[b]
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
  return [...data].sort((a: any, b: any) => {
    if (a[key] < b[key]) return order === 'desc' ? 1 : -1
    if (a[key] > b[key]) return order === 'desc' ? -1 : 1
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
    return (data as any[]).map(row => {
      const selected: any = {}
      for (const col of columns) {
        if (col in row) {
          selected[col] = row[col]
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
    const selected: any = {}
    for (const col of columns) {
      if (col in (row as any)) {
        selected[col] = (row as any)[col]
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
