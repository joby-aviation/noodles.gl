// GeoJSON features into an Arrow table: properties as columns, each geometry as WKB in a
// `__wkb` column for ST_GeomFromWKB. GDAL's ST_Read on a GeoJSON file spends most of its time
// parsing JSON; JSON.parse and a WKB writer in JS read world-flights' features some 10 times
// faster. Geometries keep x, y and z; a fourth coordinate (a time, say) is dropped, as no
// vertex query reads it.

import { Binary, makeData, makeVector, Table, tableFromJSON } from 'apache-arrow'
import { tableFromRows } from './arrow-rows'

type Position = number[]
interface Geometry {
  type: string
  coordinates?: unknown
  geometries?: Geometry[]
}
interface Feature {
  geometry?: Geometry | null
  properties?: Record<string, unknown> | null
}

const TYPES: Record<string, number> = {
  Point: 1,
  LineString: 2,
  Polygon: 3,
  MultiPoint: 4,
  MultiLineString: 5,
  MultiPolygon: 6,
  GeometryCollection: 7,
}

// Coordinates a geometry's first position has, 2 or 3; 2 for an empty geometry
function dimsOf(g: Geometry): number {
  if (g.type === 'GeometryCollection') {
    for (const c of g.geometries ?? []) if (c) return dimsOf(c)
    return 2
  }
  let c: unknown = g.coordinates
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
  return Array.isArray(c) && c.length >= 3 ? 3 : 2
}

const HEADER = 5

function sizeOf(g: Geometry, dims: number): number {
  const point = dims * 8
  const line = (l: Position[]) => 4 + l.length * point
  const polygon = (p: Position[][]) => 4 + p.reduce((n, r) => n + line(r), 0)
  const c = g.coordinates as never
  switch (g.type) {
    case 'Point':
      return HEADER + point
    case 'LineString':
      return HEADER + line(c)
    case 'Polygon':
      return HEADER + polygon(c)
    case 'MultiPoint':
      return HEADER + 4 + (c as Position[]).length * (HEADER + point)
    case 'MultiLineString':
      return HEADER + 4 + (c as Position[][]).reduce((n, l) => n + HEADER + line(l), 0)
    case 'MultiPolygon':
      return HEADER + 4 + (c as Position[][][]).reduce((n, p) => n + HEADER + polygon(p), 0)
    case 'GeometryCollection':
      return HEADER + 4 + (g.geometries ?? []).reduce((n, x) => n + sizeOf(x, dims), 0)
  }
  throw new Error(`Unknown geometry type '${g.type}'`)
}

class Writer {
  at = 0
  constructor(
    private readonly view: DataView,
    private readonly dims: number
  ) {}
  u32(v: number) {
    this.view.setUint32(this.at, v, true)
    this.at += 4
  }
  header(type: string) {
    this.view.setUint8(this.at, 1)
    this.at += 1
    // ISO WKB: a geometry with z is its type plus 1000
    this.u32(TYPES[type] + (this.dims === 3 ? 1000 : 0))
  }
  point(p: Position) {
    for (let k = 0; k < this.dims; k++) {
      // An empty point is NaN coordinates; a missing z is 0
      const v = p.length === 0 ? Number.NaN : (p[k] ?? 0)
      this.view.setFloat64(this.at, v, true)
      this.at += 8
    }
  }
  line(l: Position[]) {
    this.u32(l.length)
    for (const p of l) this.point(p)
  }
  polygon(rings: Position[][]) {
    this.u32(rings.length)
    for (const r of rings) this.line(r)
  }
  geometry(g: Geometry) {
    this.header(g.type)
    const c = g.coordinates as never
    switch (g.type) {
      case 'Point':
        return this.point(c)
      case 'LineString':
        return this.line(c)
      case 'Polygon':
        return this.polygon(c)
      case 'MultiPoint':
        this.u32((c as Position[]).length)
        for (const p of c as Position[]) this.geometry({ type: 'Point', coordinates: p })
        return
      case 'MultiLineString':
        this.u32((c as Position[][]).length)
        for (const l of c as Position[][]) this.geometry({ type: 'LineString', coordinates: l })
        return
      case 'MultiPolygon':
        this.u32((c as Position[][][]).length)
        for (const p of c as Position[][][]) this.geometry({ type: 'Polygon', coordinates: p })
        return
      case 'GeometryCollection':
        this.u32(g.geometries?.length ?? 0)
        for (const x of g.geometries ?? []) this.geometry(x)
        return
    }
  }
}

/** Every feature's geometry as WKB, one after another, with offsets and a null bitmap. */
export function wkbColumn(geometries: (Geometry | null | undefined)[]) {
  const dims = geometries.map(g => (g ? dimsOf(g) : 2))
  const offsets = new Int32Array(geometries.length + 1)
  geometries.forEach((g, i) => {
    offsets[i + 1] = offsets[i] + (g ? sizeOf(g, dims[i]) : 0)
  })
  const bytes = new Uint8Array(offsets[geometries.length])
  const view = new DataView(bytes.buffer)
  const nulls = new Uint8Array(Math.ceil(geometries.length / 8))
  let nullCount = 0
  geometries.forEach((g, i) => {
    if (!g) {
      nullCount++
      return
    }
    nulls[i >> 3] |= 1 << (i & 7)
    const w = new Writer(view, dims[i])
    w.at = offsets[i]
    w.geometry(g)
  })
  return makeVector(
    makeData({
      type: new Binary(),
      length: geometries.length,
      nullCount,
      nullBitmap: nullCount ? nulls : undefined,
      valueOffsets: offsets,
      data: bytes,
    })
  )
}

/**
 * Features as a table of their properties and a `__wkb` column, or undefined when a geometry
 * is not GeoJSON or a property is named `__wkb`. A property that repeats `geom` is `p_geom`.
 */
export function featuresTable(features: Feature[]): Table | undefined {
  const rows = features.map(f => {
    const p = f.properties && typeof f.properties === 'object' ? f.properties : {}
    if ('geom' in p || '__wkb' in p) {
      const { geom, __wkb, ...rest } = p
      if (__wkb !== undefined) return undefined
      return { ...rest, p_geom: geom }
    }
    return p
  })
  if (rows.some(r => r === undefined)) return undefined
  let wkb: ReturnType<typeof wkbColumn>
  try {
    wkb = wkbColumn(features.map(f => f.geometry))
  } catch {
    return undefined
  }
  const props = rows as Record<string, unknown>[]
  const hasColumns = props.some(r => Object.keys(r).length > 0)
  const table = hasColumns ? (tableFromRows(props) ?? tableFromJSON(props)) : undefined
  const columns = Object.fromEntries(
    (table?.schema.fields ?? []).map(f => [f.name, table?.getChild(f.name) as never])
  )
  return new Table({ ...columns, __wkb: wkb })
}
