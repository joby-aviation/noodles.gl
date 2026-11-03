import { describe, expect, it } from 'vitest'
import { parseWkt } from './wkt'

describe('parseWkt', () => {
  it('parses points', () => {
    expect(parseWkt('POINT (-122.4 37.8)')).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
    expect(parseWkt('point(1 2)')).toEqual({ type: 'Point', coordinates: [1, 2] })
    expect(parseWkt('POINT (1e2 -2.5E-1)')).toEqual({ type: 'Point', coordinates: [100, -0.25] })
  })

  it('keeps Z and drops M values', () => {
    expect(parseWkt('POINT Z (1 2 3)')).toEqual({ type: 'Point', coordinates: [1, 2, 3] })
    expect(parseWkt('POINT ZM (1 2 3 4)')).toEqual({ type: 'Point', coordinates: [1, 2, 3] })
    expect(parseWkt('POINT M (1 2 4)')).toEqual({ type: 'Point', coordinates: [1, 2] })
  })

  it('strips an EWKT SRID prefix', () => {
    expect(parseWkt('SRID=4326;POINT(1 2)')).toEqual({ type: 'Point', coordinates: [1, 2] })
  })

  it('parses lines and polygons', () => {
    expect(parseWkt('LINESTRING (0 0, 1 1, 2 0)')).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
    })
    expect(parseWkt('POLYGON ((0 0, 4 0, 4 4, 0 0), (1 1, 2 1, 2 2, 1 1))')).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 1],
        ],
      ],
    })
  })

  it('parses both MULTIPOINT spellings', () => {
    const expected = {
      type: 'MultiPoint',
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    }
    expect(parseWkt('MULTIPOINT (1 2, 3 4)')).toEqual(expected)
    expect(parseWkt('MULTIPOINT ((1 2), (3 4))')).toEqual(expected)
  })

  it('parses multi geometries and collections', () => {
    expect(parseWkt('MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))')?.type).toBe('MultiLineString')
    const multiPolygon = parseWkt('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))')
    expect(multiPolygon?.type).toBe('MultiPolygon')
    expect(multiPolygon && 'coordinates' in multiPolygon && multiPolygon.coordinates).toHaveLength(
      2
    )
    expect(parseWkt('GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 1 1))')).toEqual({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [1, 2] },
        {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
    })
  })

  it('returns null for empty or malformed input', () => {
    expect(parseWkt('POINT EMPTY')).toBeNull()
    expect(parseWkt('')).toBeNull()
    expect(parseWkt('Tokyo')).toBeNull()
    expect(parseWkt('POINT (1)')).toBeNull()
    expect(parseWkt('POINT (1 2')).toBeNull()
    expect(parseWkt('POINT (1 2) extra')).toBeNull()
    expect(parseWkt('CIRCLE (1 2)')).toBeNull()
    expect(parseWkt(42 as unknown as string)).toBeNull()
  })
})
