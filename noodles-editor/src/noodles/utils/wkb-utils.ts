import type { Table, Vector } from 'apache-arrow'

// WKB Geometry Type Constants (ISO 13249-3:2016)
export const WKB_POINT = 1
export const WKB_LINESTRING = 2
export const WKB_POLYGON = 3
export const WKB_MULTIPOINT = 4
export const WKB_MULTILINESTRING = 5
export const WKB_MULTIPOLYGON = 6
export const WKB_GEOMETRYCOLLECTION = 7

// WKB Byte Order
const WKB_BIG_ENDIAN = 0
const WKB_LITTLE_ENDIAN = 1

export interface WKBHeader {
  byteOrder: number
  geomType: number
  dataView: DataView
  offset: number
}

export interface GeometryEncoding {
  encoding: 'wkb' | 'wkt' | 'geoarrow' | 'geojson' | 'unknown'
  columnName: string
  vector: Vector
}

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

// Parse WKB header (byte order + geometry type)
export function parseWKBHeader(buffer: ArrayBuffer): WKBHeader | null {
  if (buffer.byteLength < 5) return null

  const dataView = new DataView(buffer)
  const byteOrder = dataView.getUint8(0)

  if (byteOrder !== WKB_BIG_ENDIAN && byteOrder !== WKB_LITTLE_ENDIAN) {
    return null
  }

  const littleEndian = byteOrder === WKB_LITTLE_ENDIAN
  const geomType = dataView.getUint32(1, littleEndian)

  return {
    byteOrder,
    geomType,
    dataView,
    offset: 5,
  }
}

// Read a Point's XY coordinates from WKB
export function readWKBPointXY(header: WKBHeader): [number, number] | null {
  if (header.geomType !== WKB_POINT) return null
  if (header.dataView.byteLength < header.offset + 16) return null

  const littleEndian = header.byteOrder === WKB_LITTLE_ENDIAN
  const x = header.dataView.getFloat64(header.offset, littleEndian)
  const y = header.dataView.getFloat64(header.offset + 8, littleEndian)

  return [x, y]
}

// Visit polygon coordinates with callback
export interface PolygonVisitor {
  onRingStart?: () => void
  onCoordinate: (x: number, y: number) => void
}

export function visitWKBPolygonCoordinates(
  buffer: ArrayBuffer,
  header: WKBHeader,
  visitor: PolygonVisitor
): boolean {
  if (header.geomType !== WKB_POLYGON) return false

  const littleEndian = header.byteOrder === WKB_LITTLE_ENDIAN
  let offset = header.offset

  if (header.dataView.byteLength < offset + 4) return false
  const numRings = header.dataView.getUint32(offset, littleEndian)
  offset += 4

  for (let ringIdx = 0; ringIdx < numRings; ringIdx++) {
    if (header.dataView.byteLength < offset + 4) return false
    const numPoints = header.dataView.getUint32(offset, littleEndian)
    offset += 4

    visitor.onRingStart?.()

    for (let ptIdx = 0; ptIdx < numPoints; ptIdx++) {
      if (header.dataView.byteLength < offset + 16) return false
      const x = header.dataView.getFloat64(offset, littleEndian)
      const y = header.dataView.getFloat64(offset + 8, littleEndian)
      offset += 16

      visitor.onCoordinate(x, y)
    }
  }

  return true
}

// Visit multi-polygon coordinates with callback
export function visitWKBMultiPolygonCoordinates(
  buffer: ArrayBuffer,
  header: WKBHeader,
  visitor: PolygonVisitor
): boolean {
  if (header.geomType !== WKB_MULTIPOLYGON) return false

  const littleEndian = header.byteOrder === WKB_LITTLE_ENDIAN
  let offset = header.offset

  if (header.dataView.byteLength < offset + 4) return false
  const numPolygons = header.dataView.getUint32(offset, littleEndian)
  offset += 4

  for (let polyIdx = 0; polyIdx < numPolygons; polyIdx++) {
    // Each polygon has its own WKB header
    if (header.dataView.byteLength < offset + 5) return false
    const polyByteOrder = header.dataView.getUint8(offset)
    const polyLittleEndian = polyByteOrder === WKB_LITTLE_ENDIAN
    const polyGeomType = header.dataView.getUint32(offset + 1, polyLittleEndian)
    offset += 5

    if (polyGeomType !== WKB_POLYGON) return false

    if (header.dataView.byteLength < offset + 4) return false
    const numRings = header.dataView.getUint32(offset, polyLittleEndian)
    offset += 4

    for (let ringIdx = 0; ringIdx < numRings; ringIdx++) {
      if (header.dataView.byteLength < offset + 4) return false
      const numPoints = header.dataView.getUint32(offset, polyLittleEndian)
      offset += 4

      visitor.onRingStart?.()

      for (let ptIdx = 0; ptIdx < numPoints; ptIdx++) {
        if (header.dataView.byteLength < offset + 16) return false
        const x = header.dataView.getFloat64(offset, polyLittleEndian)
        const y = header.dataView.getFloat64(offset + 8, polyLittleEndian)
        offset += 16

        visitor.onCoordinate(x, y)
      }
    }
  }

  return true
}

// Detect if Arrow vector contains WKB binary data
export function isWKBColumn(vector: Vector): boolean {
  const typeName = String(vector.type).toLowerCase()
  return typeName.includes('binary') || typeName.includes('uint8')
}

// Detect if Arrow vector contains WKT text data
export function isWKTColumn(vector: Vector): boolean {
  const typeName = String(vector.type).toLowerCase()
  return typeName.includes('utf8') || typeName.includes('string')
}

// Sample WKB geometries to determine their types
export function sampleWKBGeometryTypes(
  vector: Vector,
  sampleLimit = 100
): number[] | null {
  const geomTypes: number[] = []

  const numRows = Math.min(vector.length, sampleLimit)
  if (numRows === 0) return []

  for (let i = 0; i < numRows; i++) {
    const raw = vector.get(i)
    if (raw == null) continue

    try {
      const buffer = toArrayBuffer(raw)
      const header = parseWKBHeader(buffer)
      if (!header) return null

      geomTypes.push(header.geomType)
      if (geomTypes.length >= sampleLimit) break
    } catch {
      return null
    }
  }

  return geomTypes
}

// Check if all sampled geometries match a type predicate
export function allSampledGeometriesMatch(
  vector: Vector,
  matchFn: (geomType: number) => boolean,
  sampleLimit = 100
): boolean {
  try {
    const geomTypes = sampleWKBGeometryTypes(vector, sampleLimit)
    return geomTypes != null && geomTypes.length > 0 && geomTypes.every(matchFn)
  } catch {
    return false
  }
}

// Detect geometry column in Arrow table
export function detectGeometryColumn(
  table: Table,
  hint?: string
): GeometryEncoding | null {
  const fields = table.schema.fields.map((f) => f.name)

  // 1. Use explicit hint
  if (hint && fields.includes(hint)) {
    const vector = table.getChild(hint)!
    if (isWKBColumn(vector)) {
      return { encoding: 'wkb', columnName: hint, vector }
    }
    if (isWKTColumn(vector)) {
      return { encoding: 'wkt', columnName: hint, vector }
    }
    return { encoding: 'unknown', columnName: hint, vector }
  }

  // 2. Check naming patterns
  const geomField = fields.find((f) => /^(geom|geometry|wkb_geometry)$/i.test(f))
  if (geomField) {
    const vector = table.getChild(geomField)!
    if (isWKBColumn(vector)) {
      return { encoding: 'wkb', columnName: geomField, vector }
    }
    if (isWKTColumn(vector)) {
      return { encoding: 'wkt', columnName: geomField, vector }
    }
    return { encoding: 'unknown', columnName: geomField, vector }
  }

  // 3. Look for any binary column that might be WKB
  for (const fieldName of fields) {
    const vector = table.getChild(fieldName)!
    if (isWKBColumn(vector)) {
      // Sample to verify it's actually WKB
      const sample = vector.get(0)
      if (sample != null) {
        try {
          const buffer = toArrayBuffer(sample)
          const header = parseWKBHeader(buffer)
          if (header) {
            return { encoding: 'wkb', columnName: fieldName, vector }
          }
        } catch {
          // Not WKB, continue
        }
      }
    }
  }

  return null
}

// Check if WKB column contains only Point geometries
export function isWKBPointColumn(vector: Vector, sampleLimit = 100): boolean {
  return allSampledGeometriesMatch(vector, (type) => type === WKB_POINT, sampleLimit)
}

// Check if WKB column contains only Polygon/MultiPolygon geometries
export function isWKBPolygonColumn(vector: Vector, sampleLimit = 100): boolean {
  return allSampledGeometriesMatch(
    vector,
    (type) => type === WKB_POLYGON || type === WKB_MULTIPOLYGON,
    sampleLimit
  )
}
