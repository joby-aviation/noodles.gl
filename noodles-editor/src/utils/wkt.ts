import type { Geometry, Position } from 'geojson'

// Parse a Well-Known Text geometry ("POINT (-122.4 37.8)") into GeoJSON.
// Handles every OGC simple feature type, Z / M / ZM coordinates and an EWKT
// "SRID=4326;" prefix. Returns null for anything it can't read, including EMPTY.
export function parseWkt(wkt: string): Geometry | null {
  if (typeof wkt !== 'string') return null
  const tokens = wkt
    .replace(/^\s*SRID=\d+\s*;/i, '')
    .match(/[A-Za-z]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[(),]/g)
  if (!tokens) return null

  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = (token: string) => {
    if (next() !== token) throw new Error(`Expected ${token}`)
  }

  // Values kept per position: x, y and z, or just x and y when the extra one is M
  let dimensions = 3

  const coordinate = (): Position => {
    const values: number[] = []
    while (peek() !== undefined && peek() !== ',' && peek() !== ')') {
      const value = Number(next())
      if (!Number.isFinite(value)) throw new Error('Bad number')
      values.push(value)
    }
    if (values.length < 2) throw new Error('Coordinate needs x and y')
    // GeoJSON positions are [x, y] or [x, y, z], with no place for M
    return values.slice(0, dimensions)
  }

  // A comma separated list wrapped in parens, e.g. "(1 2, 3 4)"
  const list = <T>(item: () => T): T[] => {
    expect('(')
    const items = [item()]
    while (peek() === ',') {
      next()
      items.push(item())
    }
    expect(')')
    return items
  }

  const ring = () => list(coordinate)
  const polygon = () => list(ring)
  // MULTIPOINT allows both "(1 2, 3 4)" and "((1 2), (3 4))"
  const multiPointMember = () => (peek() === '(' ? list(coordinate)[0] : coordinate())

  const geometry = (): Geometry | null => {
    const type = next()?.toUpperCase()
    const marker = peek()?.toUpperCase()
    if (marker === 'Z' || marker === 'M' || marker === 'ZM') {
      next()
      dimensions = marker === 'M' ? 2 : 3
    }
    if (peek()?.toUpperCase() === 'EMPTY') {
      next()
      return null
    }
    switch (type) {
      case 'POINT':
        return { type: 'Point', coordinates: list(coordinate)[0] }
      case 'LINESTRING':
        return { type: 'LineString', coordinates: ring() }
      case 'POLYGON':
        return { type: 'Polygon', coordinates: polygon() }
      case 'MULTIPOINT':
        return { type: 'MultiPoint', coordinates: list(multiPointMember) }
      case 'MULTILINESTRING':
        return { type: 'MultiLineString', coordinates: list(ring) }
      case 'MULTIPOLYGON':
        return { type: 'MultiPolygon', coordinates: list(polygon) }
      case 'GEOMETRYCOLLECTION': {
        const geometries = list(geometry).filter((g): g is Geometry => g !== null)
        return { type: 'GeometryCollection', geometries }
      }
      default:
        throw new Error(`Unknown geometry type ${type}`)
    }
  }

  try {
    const result = geometry()
    return pos === tokens.length ? result : null
  } catch {
    return null
  }
}
