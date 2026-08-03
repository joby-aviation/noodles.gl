import type { Table } from 'apache-arrow'

export function isArrowTable(value: unknown): value is Table {
  if (value === null || value === undefined || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.numRows === 'number' &&
    typeof obj.numCols === 'number' &&
    obj.schema !== undefined &&
    Array.isArray(obj.batches)
  )
}

export function arrowToRows(table: Table): Record<string, unknown>[] {
  return table.toArray().map(row => ({ ...row }))
}

export function arrowColumnNames(table: Table): string[] {
  return table.schema.fields.map(f => f.name)
}

export function arrowColumnTypes(table: Table): Record<string, string> {
  const types: Record<string, string> = {}
  for (const field of table.schema.fields) {
    types[field.name] = String(field.type)
  }
  return types
}

export function arrowNumRows(table: Table): number {
  return table.numRows
}

export function arrowSlice(table: Table, start: number, end: number): Table {
  return table.slice(start, end)
}
