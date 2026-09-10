import { describe, it, expect } from 'vitest'
import { Binary, Field, Schema, Table, vectorFromArray } from 'apache-arrow'
import {
  promoteWKBPointColumn,
  promoteWKBPolygonColumn,
  tryPromoteWKBColumn,
} from './wkb-to-geoarrow'

// Helper to create WKB Point binary
function createWKBPoint(x: number, y: number): Uint8Array {
  const buffer = new ArrayBuffer(21)
  const view = new DataView(buffer)

  view.setUint8(0, 1) // Little endian
  view.setUint32(1, 1, true) // Point type
  view.setFloat64(5, x, true)
  view.setFloat64(13, y, true)

  return new Uint8Array(buffer)
}

// Helper to create WKB Polygon binary
function createWKBPolygon(coordinates: number[][]): Uint8Array {
  const numPoints = coordinates.length
  const buffer = new ArrayBuffer(9 + 4 + numPoints * 16)
  const view = new DataView(buffer)

  let offset = 0
  view.setUint8(offset, 1) // Little endian
  offset += 1
  view.setUint32(offset, 3, true) // Polygon type
  offset += 4
  view.setUint32(offset, 1, true) // Number of rings
  offset += 4
  view.setUint32(offset, numPoints, true) // Number of points
  offset += 4

  for (const [x, y] of coordinates) {
    view.setFloat64(offset, x, true)
    offset += 8
    view.setFloat64(offset, y, true)
    offset += 8
  }

  return new Uint8Array(buffer)
}

describe('WKB to GeoArrow Promotion', () => {
  describe('promoteWKBPointColumn', () => {
    it('should promote WKB Point column to GeoArrow', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(10, 20), createWKBPoint(-5, 15)],
        new Binary()
      )
      const table = new Table(
        new Schema([
          new Field('id', vectorFromArray([1, 2, 3]).type, false),
          new Field('geom', new Binary(), true),
        ]),
        [vectorFromArray([1, 2, 3]), geomVector]
      )

      const promoted = promoteWKBPointColumn(table, 'geom')
      expect(promoted).not.toBeNull()
      expect(promoted?.numRows).toBe(3)

      // Verify column still exists
      const geomColumn = promoted?.getChild('geom')
      expect(geomColumn).not.toBeNull()

      // Verify we can extract coordinates
      const firstPoint = geomColumn?.get(0)
      expect(firstPoint).not.toBeNull()
    })

    it('should handle null values in WKB Point column', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), null, createWKBPoint(10, 20), null],
        new Binary()
      )
      const table = new Table(
        new Schema([
          new Field('id', vectorFromArray([1, 2, 3, 4]).type, false),
          new Field('geom', new Binary(), true),
        ]),
        [vectorFromArray([1, 2, 3, 4]), geomVector]
      )

      const promoted = promoteWKBPointColumn(table, 'geom')
      expect(promoted).not.toBeNull()
      expect(promoted?.numRows).toBe(4)

      const geomColumn = promoted?.getChild('geom')
      expect(geomColumn).not.toBeNull()

      // Null values should be preserved
      expect(geomColumn?.get(1)).toBeNull()
      expect(geomColumn?.get(3)).toBeNull()

      // Non-null values should exist
      expect(geomColumn?.get(0)).not.toBeNull()
      expect(geomColumn?.get(2)).not.toBeNull()
    })

    it('should return null for mixed geometry types', () => {
      const polygon = createWKBPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ])

      const geomVector = vectorFromArray([createWKBPoint(0, 0), polygon], new Binary())
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const promoted = promoteWKBPointColumn(table, 'geom')
      expect(promoted).toBeNull()
    })

    it('should return null for non-existent column', () => {
      const table = new Table(
        new Schema([new Field('id', vectorFromArray([1, 2, 3]).type, false)]),
        [vectorFromArray([1, 2, 3])]
      )

      const promoted = promoteWKBPointColumn(table, 'geom')
      expect(promoted).toBeNull()
    })

    it('should preserve other columns when promoting', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(10, 20), createWKBPoint(-5, 15)],
        new Binary()
      )
      const table = new Table(
        new Schema([
          new Field('id', vectorFromArray([1, 2, 3]).type, false),
          new Field('name', vectorFromArray(['A', 'B', 'C']).type, false),
          new Field('geom', new Binary(), true),
        ]),
        [vectorFromArray([1, 2, 3]), vectorFromArray(['A', 'B', 'C']), geomVector]
      )

      const promoted = promoteWKBPointColumn(table, 'geom')
      expect(promoted).not.toBeNull()

      // Other columns should still exist
      expect(promoted?.getChild('id')).not.toBeNull()
      expect(promoted?.getChild('name')).not.toBeNull()

      // And have same values
      const ids = promoted?.getChild('id')?.toArray()
      expect(ids).toEqual([1, 2, 3])
    })
  })

  describe('promoteWKBPolygonColumn', () => {
    it('should promote WKB Polygon column to GeoArrow', () => {
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
      const table = new Table(
        new Schema([
          new Field('id', vectorFromArray([1, 2]).type, false),
          new Field('geom', new Binary(), true),
        ]),
        [vectorFromArray([1, 2]), geomVector]
      )

      const promoted = promoteWKBPolygonColumn(table, 'geom')
      expect(promoted).not.toBeNull()
      expect(promoted?.numRows).toBe(2)

      const geomColumn = promoted?.getChild('geom')
      expect(geomColumn).not.toBeNull()
    })

    it('should handle null values in Polygon column', () => {
      const poly = createWKBPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ])

      const geomVector = vectorFromArray([poly, null, poly], new Binary())
      const table = new Table(
        new Schema([
          new Field('id', vectorFromArray([1, 2, 3]).type, false),
          new Field('geom', new Binary(), true),
        ]),
        [vectorFromArray([1, 2, 3]), geomVector]
      )

      const promoted = promoteWKBPolygonColumn(table, 'geom')
      expect(promoted).not.toBeNull()

      const geomColumn = promoted?.getChild('geom')
      expect(geomColumn?.get(1)).toBeNull()
      expect(geomColumn?.get(0)).not.toBeNull()
      expect(geomColumn?.get(2)).not.toBeNull()
    })

    it('should return null for Point geometries', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(1, 1)],
        new Binary()
      )
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const promoted = promoteWKBPolygonColumn(table, 'geom')
      expect(promoted).toBeNull()
    })
  })

  describe('tryPromoteWKBColumn', () => {
    it('should promote Point columns', () => {
      const geomVector = vectorFromArray(
        [createWKBPoint(0, 0), createWKBPoint(1, 1)],
        new Binary()
      )
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const promoted = tryPromoteWKBColumn(table, 'geom')
      expect(promoted).not.toBe(table) // Should return new table
      expect(promoted.numRows).toBe(2)
    })

    it('should promote Polygon columns', () => {
      const poly = createWKBPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ])

      const geomVector = vectorFromArray([poly, poly], new Binary())
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const promoted = tryPromoteWKBColumn(table, 'geom')
      expect(promoted).not.toBe(table)
      expect(promoted.numRows).toBe(2)
    })

    it('should return original table for mixed geometry types', () => {
      const polygon = createWKBPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ])

      const geomVector = vectorFromArray([createWKBPoint(0, 0), polygon], new Binary())
      const table = new Table(new Schema([new Field('geom', new Binary(), true)]), [geomVector])

      const result = tryPromoteWKBColumn(table, 'geom')
      expect(result).toBe(table) // Should return same table
    })

    it('should return original table for non-geometry columns', () => {
      const table = new Table(
        new Schema([new Field('value', vectorFromArray([1.0, 2.0, 3.0]).type, false)]),
        [vectorFromArray([1.0, 2.0, 3.0])]
      )

      const result = tryPromoteWKBColumn(table, 'value')
      expect(result).toBe(table)
    })
  })
})
