import { tableFromArrays } from 'apache-arrow'
import { describe, expect, it } from 'vitest'
import {
  arrowColumnNames,
  arrowColumnTypes,
  arrowGetColumn,
  arrowGetColumnAsTypedArray,
  arrowGetNestedColumn,
  arrowNumRows,
  arrowSlice,
  arrowToRows,
  arrowTypeToGLFormat,
  isArrowTable,
} from './arrow-utils'

describe('isArrowTable', () => {
  it('returns true for a real Arrow table', () => {
    const table = tableFromArrays({
      x: [1, 2, 3],
      y: ['a', 'b', 'c'],
    })
    expect(isArrowTable(table)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isArrowTable(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isArrowTable(undefined)).toBe(false)
  })

  it('returns false for a plain array', () => {
    expect(isArrowTable([{ x: 1 }, { x: 2 }])).toBe(false)
  })

  it('returns false for a plain object', () => {
    expect(isArrowTable({ foo: 'bar' })).toBe(false)
  })

  it('returns false for an object with some but not all required properties', () => {
    expect(isArrowTable({ numRows: 5, schema: {} })).toBe(false)
  })
})

describe('arrowColumnNames', () => {
  it('returns column names from an Arrow table', () => {
    const table = tableFromArrays({
      latitude: [40.7, 34.0],
      longitude: [-74.0, -118.2],
      name: ['NYC', 'LA'],
    })
    expect(arrowColumnNames(table)).toEqual(['latitude', 'longitude', 'name'])
  })

  it('returns empty array for table with no columns', () => {
    const table = tableFromArrays({})
    expect(arrowColumnNames(table)).toEqual([])
  })
})

describe('arrowColumnTypes', () => {
  it('returns column types as strings', () => {
    const table = tableFromArrays({
      id: Int32Array.from([1, 2, 3]),
      value: Float64Array.from([1.5, 2.5, 3.5]),
    })
    const types = arrowColumnTypes(table)
    expect(types.id).toBeDefined()
    expect(types.value).toBeDefined()
    expect(typeof types.id).toBe('string')
    expect(typeof types.value).toBe('string')
  })
})

describe('arrowNumRows', () => {
  it('returns the number of rows', () => {
    const table = tableFromArrays({
      x: [1, 2, 3, 4, 5],
    })
    expect(arrowNumRows(table)).toBe(5)
  })

  it('returns 0 for empty table', () => {
    const table = tableFromArrays({ x: [] })
    expect(arrowNumRows(table)).toBe(0)
  })
})

describe('arrowToRows', () => {
  it('converts Arrow table to array of plain objects', () => {
    const table = tableFromArrays({
      city: ['NYC', 'LA'],
      pop: [8_000_000, 4_000_000],
    })
    const rows = arrowToRows(table)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ city: 'NYC', pop: 8_000_000 })
    expect(rows[1]).toEqual({ city: 'LA', pop: 4_000_000 })
  })

  it('returns empty array for empty table', () => {
    const table = tableFromArrays({ x: [] })
    expect(arrowToRows(table)).toEqual([])
  })
})

describe('arrowSlice', () => {
  it('returns a subset of rows', () => {
    const table = tableFromArrays({
      x: [10, 20, 30, 40, 50],
    })
    const sliced = arrowSlice(table, 1, 3)
    expect(arrowNumRows(sliced)).toBe(2)
    const rows = arrowToRows(sliced)
    expect(rows[0]).toEqual({ x: 20 })
    expect(rows[1]).toEqual({ x: 30 })
  })

  it('handles start=0', () => {
    const table = tableFromArrays({ x: [1, 2, 3] })
    const sliced = arrowSlice(table, 0, 2)
    expect(arrowNumRows(sliced)).toBe(2)
    expect(arrowToRows(sliced)).toEqual([{ x: 1 }, { x: 2 }])
  })

  it('clamps end beyond table length', () => {
    const table = tableFromArrays({ x: [1, 2, 3] })
    const sliced = arrowSlice(table, 0, 100)
    expect(arrowNumRows(sliced)).toBe(3)
  })
})

describe('arrowGetColumn', () => {
  it('returns the column vector', () => {
    const table = tableFromArrays({
      x: [1, 2, 3],
      y: [4, 5, 6],
    })
    const column = arrowGetColumn(table, 'x')
    const array = column.toArray()
    expect(Array.from(array)).toEqual([1, 2, 3])
  })

  it('throws for non-existent column', () => {
    const table = tableFromArrays({ x: [1, 2, 3] })
    expect(() => arrowGetColumn(table, 'nonexistent')).toThrow(
      'Column "nonexistent" not found'
    )
  })
})

describe('arrowGetColumnAsTypedArray', () => {
  it('converts integer column to Float32Array', () => {
    const table = tableFromArrays({ x: [1, 2, 3, 4, 5] })
    const result = arrowGetColumnAsTypedArray(table, 'x')
    expect(result).toBeInstanceOf(Float32Array)
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5])
  })

  it('converts float column to Float32Array', () => {
    const table = tableFromArrays({ x: [1.5, 2.5, 3.5] })
    const result = arrowGetColumnAsTypedArray(table, 'x')
    expect(result).toBeInstanceOf(Float32Array)
    expect(Array.from(result)).toEqual([1.5, 2.5, 3.5])
  })

  it('handles zero values', () => {
    const table = tableFromArrays({ x: [0, 1, 0, 2, 0] })
    const result = arrowGetColumnAsTypedArray(table, 'x')
    expect(Array.from(result)).toEqual([0, 1, 0, 2, 0])
  })
})

describe('arrowGetNestedColumn', () => {
  it('extracts simple column path', () => {
    const table = tableFromArrays({ x: [1, 2, 3] })
    const result = arrowGetNestedColumn(table, 'x')
    expect(result).toBeInstanceOf(Float32Array)
    expect(Array.from(result)).toEqual([1, 2, 3])
  })

  it('extracts nested object property', () => {
    const table = tableFromArrays({
      coords: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ],
    })
    const result = arrowGetNestedColumn(table, 'coords.x')
    expect(result).toBeInstanceOf(Float32Array)
    expect(Array.from(result)).toEqual([1, 3, 5])
  })

  it('returns 0 for missing nested properties', () => {
    const table = tableFromArrays({
      coords: [{ x: 1 }, { x: 2 }, {}],
    })
    const result = arrowGetNestedColumn(table, 'coords.y')
    expect(Array.from(result)).toEqual([0, 0, 0])
  })

  it('handles undefined values in nested paths', () => {
    const table = tableFromArrays({
      coords: [{ x: 1 }, {}, { x: 3 }],
    })
    const result = arrowGetNestedColumn(table, 'coords.x')
    expect(Array.from(result)).toEqual([1, 0, 3])
  })
})

describe('arrowTypeToGLFormat', () => {
  it('returns format for numeric types', () => {
    const table = tableFromArrays({ x: [1, 2, 3] })
    const column = arrowGetColumn(table, 'x')
    const format = arrowTypeToGLFormat(column.type)
    expect(format).toHaveProperty('type')
    expect(format).toHaveProperty('size')
    expect(format.size).toBe(1)
    expect(typeof format.type).toBe('string')
  })
})
