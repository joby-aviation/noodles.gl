import type { Table, DataType, Vector } from 'apache-arrow'

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

export function hasColumn(table: Table, columnName: string): boolean {
  return table.schema.fields.some(f => f.name === columnName)
}

export function arrowSlice(table: Table, start: number, end: number): Table {
  return table.slice(start, end)
}

export function arrowGetColumn(table: Table, columnName: string): Vector {
  const column = table.getChild(columnName)
  if (!column) {
    throw new Error(`Column "${columnName}" not found in Arrow table`)
  }
  return column
}

export function arrowGetColumnAsTypedArray(
  table: Table,
  columnName: string
): Float32Array | Float64Array | Int32Array | Uint8Array {
  const column = arrowGetColumn(table, columnName)
  const type = column.type

  const values = column.toArray()

  // Apache Arrow Type enum values:
  // typeId 2 = Int (Int8/16/32/64, Uint8/16/32/64)
  // typeId 3 = Float (Float16/32/64)
  // typeId 4 = Binary
  // typeId 5 = Utf8

  // Handle Float types (typeId 3)
  if (type.typeId === 3) {
    const precision = (type as any).precision ?? 1
    // precision 2 = Float64, precision 1 = Float32, precision 0 = Float16
    if (precision === 2) return new Float64Array(values as number[])
    return new Float32Array(values as number[])
  }

  // Handle Int types (typeId 2)
  if (type.typeId === 2) {
    const isSigned = (type as any).isSigned !== false
    const bitWidth = (type as any).bitWidth ?? 32
    if (!isSigned && bitWidth <= 8) return new Uint8Array(values as number[])
    if (!isSigned) return new Uint32Array(values as number[])
    if (bitWidth <= 8) return new Int8Array(values as number[])
    if (bitWidth <= 16) return new Int16Array(values as number[])
    return new Int32Array(values as number[])
  }

  // Fallback for other types - attempt float32
  return new Float32Array(values as number[])
}

export function arrowGetNestedColumn(
  table: Table,
  path: string
): Float32Array | Float64Array | Int32Array | Uint8Array {
  const parts = path.split('.')
  const columnName = parts[0]
  const column = arrowGetColumn(table, columnName)

  if (parts.length === 1) {
    return arrowGetColumnAsTypedArray(table, columnName)
  }

  const values = column.toArray()
  const nestedValues: number[] = []

  for (const row of values) {
    let value: unknown = row
    for (let i = 1; i < parts.length; i++) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[parts[i]]
      } else {
        value = undefined
        break
      }
    }
    nestedValues.push(typeof value === 'number' && !Number.isNaN(value) ? value : 0)
  }

  return new Float32Array(nestedValues)
}

export function arrowTypeToGLFormat(type: DataType): { type: string; size: number } {
  const typeId = type.typeId

  // typeId 3 = Float (Float16/32/64)
  if (typeId === 3) {
    const precision = (type as any).precision ?? 1
    if (precision === 2) return { type: 'float64', size: 1 }
    return { type: 'float32', size: 1 }
  }

  // typeId 2 = Int (Int8/16/32/64, Uint8/16/32/64)
  if (typeId === 2) {
    const isSigned = (type as any).isSigned !== false
    const bitWidth = (type as any).bitWidth ?? 32
    if (!isSigned && bitWidth <= 8) return { type: 'uint8', size: 1 }
    if (!isSigned) return { type: 'uint32', size: 1 }
    if (bitWidth <= 8) return { type: 'int8', size: 1 }
    if (bitWidth <= 16) return { type: 'int16', size: 1 }
    return { type: 'int32', size: 1 }
  }

  return { type: 'float32', size: 1 }
}
