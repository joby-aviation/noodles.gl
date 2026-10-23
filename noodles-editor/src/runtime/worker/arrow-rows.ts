// Rows from code into an Arrow table, column by column into typed arrays. Arrow's tableFromJSON
// infers a type for every value, nested ones included, which for world-flights' 1.5M path
// vertices took seconds; here a column of numbers is one Float64Array, and a column of paths is
// one offsets array over one array of coordinates. Columns of another shape (objects, mixed
// values) return undefined, and the caller falls back to tableFromJSON.

import {
  Bool,
  type Data,
  Field,
  FixedSizeList,
  Float64,
  List,
  makeData,
  makeVector,
  Table,
  Utf8,
  type Vector,
  vectorFromArray,
} from 'apache-arrow'

type Shape =
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'boolean' }
  | { kind: 'list' }
  | { kind: 'points'; width: number }
  | { kind: 'lists' }

const isNumber = (v: unknown): v is number => typeof v === 'number'
const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNumber)

/** A column's shape from every value it holds, or undefined when the values disagree. */
function shapeOf(values: unknown[]): Shape | undefined {
  let kind: Shape['kind'] | undefined
  let width: number | undefined
  let uneven = false
  for (const v of values) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue
    let next: Shape['kind']
    if (isNumber(v)) next = 'number'
    else if (typeof v === 'string') next = 'string'
    else if (typeof v === 'boolean') next = 'boolean'
    else if (isNumbers(v)) next = 'list'
    else if (Array.isArray(v) && v.every(isNumbers)) {
      next = 'points'
      for (const p of v as number[][]) {
        if (width === undefined) width = p.length
        else if (p.length !== width) uneven = true
      }
    } else return undefined
    if (kind === undefined) kind = next
    else if (kind !== next) return undefined
  }
  if (kind === undefined) return { kind: values.some(Array.isArray) ? 'list' : 'number' }
  if (kind === 'points') return uneven || !width ? { kind: 'lists' } : { kind: 'points', width }
  return { kind } as Shape
}

function validity(values: unknown[]): { bitmap?: Uint8Array; nulls: number } {
  let nulls = 0
  const bitmap = new Uint8Array(Math.ceil(values.length / 8))
  values.forEach((v, i) => {
    if (v === null || v === undefined) nulls++
    else bitmap[i >> 3] |= 1 << (i & 7)
  })
  return nulls ? { bitmap, nulls } : { nulls }
}

const float64 = new Float64()

// A missing key as null: Arrow reads undefined text as '' and an undefined number as NaN
const orNull = (v: unknown) => v ?? null

/** A list column: per row, its items flattened into one child (numbers, or points). */
function listData(values: unknown[], child: (flat: unknown[][]) => Data, childType: Field): Data {
  const offsets = new Int32Array(values.length + 1)
  const rows: unknown[][] = []
  values.forEach((v, i) => {
    const items = Array.isArray(v) ? v : []
    rows.push(items)
    offsets[i + 1] = offsets[i] + items.length
  })
  const { bitmap, nulls } = validity(values)
  return makeData({
    type: new List(childType),
    length: values.length,
    nullCount: nulls,
    nullBitmap: bitmap,
    valueOffsets: offsets,
    child: child(rows),
  })
}

function numbersData(rows: unknown[][]): Data<Float64> {
  let total = 0
  for (const r of rows) total += r.length
  const data = new Float64Array(total)
  let at = 0
  for (const r of rows) for (const v of r) data[at++] = v as number
  return makeData({ type: float64, length: total, data })
}

function column(values: unknown[], shape: Shape): Vector {
  switch (shape.kind) {
    case 'number': {
      // A missing value is null, never NaN: SQL's coalesce and IS NULL see it
      const data = new Float64Array(values.length)
      values.forEach((v, i) => {
        if (typeof v === 'number') data[i] = v
      })
      const { bitmap, nulls } = validity(values)
      return makeVector(
        makeData({
          type: float64,
          length: values.length,
          nullCount: nulls,
          nullBitmap: bitmap,
          data,
        })
      )
    }
    case 'string':
      return vectorFromArray(values.map(orNull), new Utf8())
    case 'boolean':
      return vectorFromArray(values.map(orNull), new Bool())
    case 'list':
      return makeVector(listData(values, numbersData, new Field('item', float64, true)))
    case 'points': {
      const pointType = new FixedSizeList(shape.width, new Field('item', float64, false))
      return makeVector(
        listData(
          values,
          rows => {
            // Points of every row, one after another; a point is `width` numbers
            let count = 0
            for (const r of rows) count += r.length
            const flat = new Float64Array(count * shape.width)
            let at = 0
            for (const r of rows) {
              for (const p of r as number[][])
                for (let k = 0; k < shape.width; k++) flat[at++] = p[k]
            }
            return makeData({
              type: pointType,
              length: count,
              child: makeData({ type: float64, length: flat.length, data: flat }),
            })
          },
          new Field('item', pointType, true)
        )
      )
    }
    case 'lists': {
      const inner = new List(new Field('item', float64, true))
      return makeVector(
        listData(
          values,
          rows => {
            const points = rows.flat() as unknown[]
            return listData(points, numbersData, new Field('item', float64, true))
          },
          new Field('item', inner, true)
        )
      )
    }
  }
}

/** Rows as an Arrow table, or undefined when a column's values are not one plain shape. */
export function tableFromRows(rows: Record<string, unknown>[]): Table | undefined {
  const names: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k)
        names.push(k)
      }
    }
  }
  const columns: Record<string, Vector> = {}
  for (const name of names) {
    const values = rows.map(r => r[name])
    const shape = shapeOf(values)
    if (!shape) return undefined
    columns[name] = column(values, shape)
  }
  return new Table(columns)
}
