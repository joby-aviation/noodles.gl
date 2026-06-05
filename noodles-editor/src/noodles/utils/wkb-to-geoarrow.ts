import {
  Field as ArrowField,
  FixedSizeList,
  Float64,
  List,
  makeData,
  Table,
  Vector,
} from 'apache-arrow'
import {
  WKB_MULTIPOLYGON,
  WKB_POINT,
  WKB_POLYGON,
  isWKBPointColumn,
  isWKBPolygonColumn,
  parseWKBHeader,
  readWKBPointXY,
  visitWKBMultiPolygonCoordinates,
  visitWKBPolygonCoordinates,
} from './wkb-utils'

// Arrow type definitions for GeoArrow geometries
const COORD_FIELD = new ArrowField('xy', new Float64(), false)
const VERTEX_TYPE = new FixedSizeList(2, COORD_FIELD)
const VERTEX_FIELD = new ArrowField('', VERTEX_TYPE, true)
const RING_TYPE = new List(VERTEX_FIELD)
const RING_FIELD = new ArrowField('', RING_TYPE, true)
const POLYGON_TYPE = new List(RING_FIELD)

const BITS_PER_VALIDITY_BYTE = 8

// Convert various input formats to ArrayBuffer
function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value
  }
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength)
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), 0)
    return copy.buffer
  }
  throw new Error('Value is not an ArrayBuffer or TypedArray')
}

// Build null bitmap for Arrow data
function buildNullBitmap(
  n: number,
  isNull: Uint8Array,
  nullCount: number
): Uint8Array | null {
  if (nullCount === 0) return null
  const bitmap = new Uint8Array(Math.ceil(n / BITS_PER_VALIDITY_BYTE))
  for (let i = 0; i < n; i++) {
    if (isNull[i] !== 1) {
      const byteIndex = Math.floor(i / BITS_PER_VALIDITY_BYTE)
      const bitIndex = i % BITS_PER_VALIDITY_BYTE
      bitmap[byteIndex]! |= 1 << bitIndex
    }
  }
  return bitmap
}

// Replace a column in Arrow table with a new vector
function replaceColumn(table: Table, columnName: string, newVector: Vector): Table {
  const columns: Record<string, Vector> = {}
  for (const field of table.schema.fields) {
    columns[field.name] =
      field.name === columnName ? newVector : (table.getChild(field.name) as Vector)
  }
  return new Table(columns)
}

// Promote WKB Point column to GeoArrow FixedSizeList[Float64, 2]
export function promoteWKBPointColumn(table: Table, columnName: string): Table | null {
  const vector = table.getChild(columnName)
  if (!vector) return null

  // Check if all non-null geometries are Points
  if (!isWKBPointColumn(vector)) {
    return null
  }

  const n = table.numRows
  const xyValues = new Float64Array(n * 2)
  const isNull = new Uint8Array(n)
  let nullCount = 0

  const markNullPoint = (rowIndex: number) => {
    isNull[rowIndex] = 1
    xyValues[rowIndex * 2] = Number.NaN
    xyValues[rowIndex * 2 + 1] = Number.NaN
    nullCount++
  }

  for (let i = 0; i < n; i++) {
    const raw = vector.get(i)
    if (raw == null) {
      markNullPoint(i)
      continue
    }

    try {
      const buffer = toArrayBuffer(raw)
      const header = parseWKBHeader(buffer)
      if (!header) {
        markNullPoint(i)
        continue
      }

      const xy = readWKBPointXY(header)
      if (!xy) {
        markNullPoint(i)
        continue
      }

      xyValues[i * 2] = xy[0]
      xyValues[i * 2 + 1] = xy[1]
    } catch {
      markNullPoint(i)
    }
  }

  // Build GeoArrow point column
  const floatData = makeData({
    type: new Float64(),
    length: n * 2,
    data: xyValues,
  })

  const geomData = makeData({
    type: VERTEX_TYPE,
    length: n,
    nullCount,
    nullBitmap: buildNullBitmap(n, isNull, nullCount),
    child: floatData,
  })

  const pointVector = new Vector([geomData])
  return replaceColumn(table, columnName, pointVector)
}

// Promote WKB Polygon column to GeoArrow nested list structure
export function promoteWKBPolygonColumn(table: Table, columnName: string): Table | null {
  const vector = table.getChild(columnName)
  if (!vector) return null

  // Check if all non-null geometries are Polygons or MultiPolygons
  if (!isWKBPolygonColumn(vector)) {
    return null
  }

  const n = table.numRows
  const polygonOffsets = new Int32Array(n + 1)
  const ringOffsetsList: number[] = []
  const xyList: number[] = []
  const isNull = new Uint8Array(n)
  let nullCount = 0

  const polygonVisitor = {
    onRingStart: () => ringOffsetsList.push(xyList.length / 2),
    onCoordinate: (x: number, y: number) => {
      xyList.push(x, y)
    },
  }

  for (let i = 0; i < n; i++) {
    polygonOffsets[i] = ringOffsetsList.length
    const raw = vector.get(i)

    if (raw == null) {
      isNull[i] = 1
      nullCount++
      continue
    }

    try {
      const buffer = toArrayBuffer(raw)
      const header = parseWKBHeader(buffer)
      if (!header) {
        isNull[i] = 1
        nullCount++
        continue
      }

      if (header.geomType === WKB_POLYGON) {
        if (!visitWKBPolygonCoordinates(buffer, header, polygonVisitor)) {
          isNull[i] = 1
          nullCount++
        }
      } else if (header.geomType === WKB_MULTIPOLYGON) {
        if (!visitWKBMultiPolygonCoordinates(buffer, header, polygonVisitor)) {
          isNull[i] = 1
          nullCount++
        }
      } else {
        isNull[i] = 1
        nullCount++
      }
    } catch {
      isNull[i] = 1
      nullCount++
    }
  }

  polygonOffsets[n] = ringOffsetsList.length

  const totalRings = ringOffsetsList.length
  const totalPoints = xyList.length / 2

  const ringOffsets = new Int32Array(totalRings + 1)
  for (let j = 0; j < totalRings; j++) {
    ringOffsets[j] = ringOffsetsList[j]!
  }
  ringOffsets[totalRings] = totalPoints

  // Build GeoArrow polygon column
  const flatCoords = new Float64Array(xyList)
  const floatData = makeData({
    type: new Float64(),
    length: totalPoints * 2,
    data: flatCoords,
  })

  const pointData = makeData({
    type: VERTEX_TYPE,
    length: totalPoints,
    child: floatData,
  })

  const ringData = makeData({
    type: RING_TYPE,
    length: totalRings,
    valueOffsets: ringOffsets,
    child: pointData,
  })

  const polyData = makeData({
    type: POLYGON_TYPE,
    length: n,
    nullCount,
    nullBitmap: buildNullBitmap(n, isNull, nullCount),
    valueOffsets: polygonOffsets,
    child: ringData,
  })

  const polygonVector = new Vector([polyData])
  return replaceColumn(table, columnName, polygonVector)
}

// Auto-promote WKB geometry column to GeoArrow if possible
export function tryPromoteWKBColumn(table: Table, columnName: string): Table {
  // Try Point promotion first (most common)
  const pointResult = promoteWKBPointColumn(table, columnName)
  if (pointResult) {
    return pointResult
  }

  // Try Polygon promotion
  const polygonResult = promoteWKBPolygonColumn(table, columnName)
  if (polygonResult) {
    return polygonResult
  }

  // Can't promote - return original table
  return table
}
