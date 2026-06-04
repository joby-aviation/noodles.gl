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

  if (type.typeId === 2 || type.typeId === 3) {
    return new Float32Array(values as number[])
  }
  if (type.typeId === 4 || type.typeId === 5) {
    return new Float64Array(values as number[])
  }
  if (type.typeId === 6 || type.typeId === 7 || type.typeId === 8) {
    return new Int32Array(values as number[])
  }
  if (type.typeId === 9 || type.typeId === 10 || type.typeId === 11) {
    return new Uint8Array(values as number[])
  }

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

  if (typeId === 2 || typeId === 3) {
    return { type: 'float32', size: 1 }
  }
  if (typeId === 4 || typeId === 5) {
    return { type: 'float64', size: 1 }
  }
  if (typeId === 6 || typeId === 7 || typeId === 8) {
    return { type: 'int32', size: 1 }
  }
  if (typeId === 9 || typeId === 10 || typeId === 11) {
    return { type: 'uint8', size: 1 }
  }

  return { type: 'float32', size: 1 }
}
