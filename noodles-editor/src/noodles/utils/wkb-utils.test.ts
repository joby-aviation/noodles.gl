import { describe, it, expect } from 'vitest'
import { tableFromArrays, Binary, vectorFromArray, Field, Schema, Table } from 'apache-arrow'
import {
  WKB_POINT,
  WKB_LINESTRING,
  WKB_POLYGON,
  WKB_MULTIPOINT,
  WKB_MULTILINESTRING,
  WKB_MULTIPOLYGON,
  parseWKBHeader,
  readWKBPointXY,
  detectGeometryColumn,
  isWKBColumn,
  isWKTColumn,
  isWKBPointColumn,
  isWKBPolygonColumn,
} from './wkb-utils'

// Helper to create WKB Point binary
function createWKBPoint(x: number, y: number): Uint8Array {
  const buffer = new ArrayBuffer(21)
  const view = new DataView(buffer)

  // Little endian byte order
  view.setUint8(0, 1)
  // Point type
  view.setUint32(1, WKB_POINT, true)
  // X coordinate
  view.setFloat64(5, x, true)
  // Y coordinate
  view.setFloat64(13, y, true)

  return new Uint8Array(buffer)
}

// Helper to create WKB Polygon binary (single ring)
function createWKBPolygon(coordinates: number[][]): Uint8Array {
  const numPoints = coordinates.length
  const buffer = new ArrayBuffer(9 + 4 + numPoints * 16)
  const view = new DataView(buffer)

  let offset = 0

  // Little endian byte order
  view.setUint8(offset, 1)
  offset += 1

  // Polygon type
  view.setUint32(offset, WKB_POLYGON, true)
  offset += 4

  // Number of rings
  view.setUint32(offset, 1, true)
  offset += 4

  // Number of points in ring
  view.setUint32(offset, numPoints, true)
  offset += 4

  // Coordinates
  for (const [x, y] of coordinates) {
    view.setFloat64(offset, x, true)
    offset += 8
    view.setFloat64(offset, y, true)
    offset += 8
  }

  return new Uint8Array(buffer)
}

describe('WKB Utilities', () => {
  describe('parseWKBHeader', () => {
    it('should parse WKB Point header', () => {
      const wkb = createWKBPoint(10, 20)
      const header = parseWKBHeader(wkb.buffer)

      expect(header).not.toBeNull()
      expect(header?.byteOrder).toBe(1) // Little endian
      expect(header?.geomType).toBe(WKB_POINT)
    })

    it('should return null for invalid WKB', () => {
      const invalidWkb = new Uint8Array([1, 2, 3])
      const header = parseWKBHeader(invalidWkb.buffer)

      expect(header).toBeNull()
    })

    it('should return null for empty buffer', () => {
      const emptyBuffer = new ArrayBuffer(0)
      const header = parseWKBHeader(emptyBuffer)

      expect(header).toBeNull()
    })
  })

  describe('readWKBPointXY', () => {
    it('should read Point coordinates', () => {
      const wkb = createWKBPoint(123.456, 789.012)
      const header = parseWKBHeader(wkb.buffer)
      expect(header).not.toBeNull()

      const coords = readWKBPointXY(header!)
      expect(coords).not.toBeNull()
      expect(coords![0]).toBeCloseTo(123.456, 5)
      expect(coords![1]).toBeCloseTo(789.012, 5)
    })

    it('should return null for non-Point geometry', () => {
      const wkb = createWKBPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ])
      const header = parseWKBHeader(wkb.buffer)
      expect(header).not.toBeNull()

      const coords = readWKBPointXY(header!)
      expect(coords).toBeNull()
    })
  })

  describe('Arrow column type detection', () => {
    it('should detect Binary column as potential WKB', () => {
      // Create Binary vector explicitly
      const binaryVector = vectorFromArray([createWKBPoint(0, 0)], new Binary())
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [binaryVector])

      const vector = table.getChild('geom')!
      expect(isWKBColumn(vector)).toBe(true)
    })

    it('should detect Utf8 column as potential WKT', () => {
      const table = tableFromArrays({
        geom: ['POINT(0 0)'],
      })

      const vector = table.getChild('geom')!
      expect(isWKTColumn(vector)).toBe(true)
    })

    it('should not detect Float64 column as geometry', () => {
      const table = tableFromArrays({
        value: [1.0, 2.0, 3.0],
      })

      const vector = table.getChild('value')!
      expect(isWKBColumn(vector)).toBe(false)
      expect(isWKTColumn(vector)).toBe(false)
    })
  })

  describe('detectGeometryColumn', () => {
    it('should detect column named "geometry"', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(1, 1), createWKBPoint(2, 2)],
        new Binary()
      )
      const table = new Table(
        new Schema([
          new Field('id', tableFromArrays({ id: [1, 2, 3] }).schema.fields[0]!.type, false),
          new Field('geometry', new Binary(), true),
        ]),
        [vectorFromArray([1, 2, 3]), geomVector]
      )

      const result = detectGeometryColumn(table)
      expect(result).not.toBeNull()
      expect(result?.columnName).toBe('geometry')
      expect(result?.encoding).toBe('wkb')
    })

    it('should detect column named "geom"', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(1, 1), createWKBPoint(2, 2)],
        new Binary()
      )
      const table = new Table(
        new Schema([
          new Field('id', tableFromArrays({ id: [1, 2, 3] }).schema.fields[0]!.type, false),
          new Field('geom', new Binary(), true),
        ]),
        [vectorFromArray([1, 2, 3]), geomVector]
      )

      const result = detectGeometryColumn(table)
      expect(result).not.toBeNull()
      expect(result?.columnName).toBe('geom')
      expect(result?.encoding).toBe('wkb')
    })

    it('should use explicit hint when provided', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(1, 1), createWKBPoint(2, 2)],
        new Binary()
      )
      const table = new Table(
        new Schema([
          new Field('id', tableFromArrays({ id: [1, 2, 3] }).schema.fields[0]!.type, false),
          new Field('shape', new Binary(), true),
        ]),
        [vectorFromArray([1, 2, 3]), geomVector]
      )

      const result = detectGeometryColumn(table, 'shape')
      expect(result).not.toBeNull()
      expect(result?.columnName).toBe('shape')
      expect(result?.encoding).toBe('wkb')
    })

    it('should return null when no geometry column found', () => {
      const table = tableFromArrays({
        id: [1, 2, 3],
        value: [10.0, 20.0, 30.0],
      })

      const result = detectGeometryColumn(table)
      expect(result).toBeNull()
    })

    it('should detect WKT text columns', () => {
      const table = tableFromArrays({
        geometry: ['POINT(0 0)', 'POINT(1 1)', 'POINT(2 2)'],
      })

      const result = detectGeometryColumn(table)
      expect(result).not.toBeNull()
      expect(result?.columnName).toBe('geometry')
      expect(result?.encoding).toBe('wkt')
    })
  })

  describe('isWKBPointColumn', () => {
    it('should return true for column with all Points', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(1, 1), createWKBPoint(2, 2)],
        new Binary()
      )
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const vector = table.getChild('geom')!
      expect(isWKBPointColumn(vector)).toBe(true)
    })

    it('should return false for column with mixed geometry types', () => {
      const polygon = createWKBPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ])
      const geomVector = vectorFromArray([createWKBPoint(0, 0), polygon], new Binary())
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const vector = table.getChild('geom')!
      expect(isWKBPointColumn(vector)).toBe(false)
    })

    it('should handle null values', () => {
      // Create points with nulls
      const points: (Uint8Array | null)[] = [createWKBPoint(0, 0), null, createWKBPoint(2, 2)]
      const geomVector = vectorFromArray(points, new Binary())
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const vector = table.getChild('geom')!
      expect(isWKBPointColumn(vector)).toBe(true)
    })
  })

  describe('isWKBPolygonColumn', () => {
    it('should return true for column with all Polygons', () => {
      const poly1 = createWKBPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ])
      const poly2 = createWKBPolygon([
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
        [2, 2],
      ])

      const geomVector = vectorFromArray([poly1, poly2], new Binary())
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const vector = table.getChild('geom')!
      expect(isWKBPolygonColumn(vector)).toBe(true)
    })

    it('should return false for column with Points', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(1, 1)],
        new Binary()
      )
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const vector = table.getChild('geom')!
      expect(isWKBPolygonColumn(vector)).toBe(false)
    })
  })
})
