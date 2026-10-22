// GeoJSON as vertex rows, for the planner's `geojson` source.
//
// The planner reads geometry the way it reads everything else: as rows. A polygon is its
// vertices, grouped by polygon id and ring and ordered by vertex index; a line is its vertices
// grouped by line id; a point is one row. Each row carries its feature's properties as columns,
// so attribute and wrangle nodes can color, size and extrude features by them, and filters and
// stats can read them in SQL.
//
// The file is parsed here rather than by DuckDB's spatial extension, which DuckDB-Wasm downloads
// on first use: this works offline and in Node tests, and runs once per file.

import { type GeojsonKind, geojsonTable } from '@noodles.gl/planner'
import { Float64, Int32, Table, tableToIPC, Utf8, type Vector, vectorFromArray } from 'apache-arrow'

type Position = number[]
interface Geometry {
  type: string
  coordinates?: unknown
  geometries?: Geometry[]
}
interface Feature {
  type: 'Feature'
  geometry: Geometry | null
  properties?: Record<string, unknown> | null
}

/** Column names the geometry uses; a property with one of these names gets a `p_` prefix. */
const RESERVED = new Set(['kind', 'id', 'feature', 'ring', 'vertex', 'lng', 'lat', 'alt'])

interface Builder {
  id: number[]
  feature: number[]
  ring?: number[]
  vertex?: number[]
  lng: number[]
  lat: number[]
  alt: number[]
  /** Feature index per row, for filling property columns afterwards. */
  rows: number[]
  next: number
}

const builder = (kind: Exclude<GeojsonKind, 'all'>): Builder => ({
  id: [],
  feature: [],
  ...(kind === 'polygons' ? { ring: [] } : {}),
  ...(kind !== 'points' ? { vertex: [] } : {}),
  lng: [],
  lat: [],
  alt: [],
  rows: [],
  next: 0,
})

function push(b: Builder, f: number, id: number, p: Position, ring?: number, vertex?: number) {
  b.id.push(id)
  b.feature.push(f)
  if (b.ring) b.ring.push(ring ?? 0)
  if (b.vertex) b.vertex.push(vertex ?? 0)
  b.lng.push(Number(p[0]))
  b.lat.push(Number(p[1]))
  b.alt.push(p.length > 2 ? Number(p[2]) : 0)
  b.rows.push(f)
}

/** A ring without its closing vertex: deck draws polygon outlines as loops. */
function openRing(ring: Position[]): Position[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  const closed = ring.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]
  return closed ? ring.slice(0, -1) : ring
}

type Builders = Record<Exclude<GeojsonKind, 'all'>, Builder>

function addGeometry(g: Geometry | null, f: number, out: Builders) {
  if (!g) return
  const c = g.coordinates as unknown
  const polygon = (rings: Position[][]) => {
    const id = out.polygons.next++
    rings.forEach((ring, r) => {
      openRing(ring).forEach((p, v) => {
        push(out.polygons, f, id, p, r, v)
      })
    })
  }
  const line = (coords: Position[]) => {
    const id = out.lines.next++
    coords.forEach((p, v) => {
      push(out.lines, f, id, p, undefined, v)
    })
  }
  const point = (p: Position) => push(out.points, f, out.points.next++, p)
  switch (g.type) {
    case 'Point':
      return point(c as Position)
    case 'MultiPoint':
      return (c as Position[]).forEach(point)
    case 'LineString':
      return line(c as Position[])
    case 'MultiLineString':
      return (c as Position[][]).forEach(line)
    case 'Polygon':
      return polygon(c as Position[][])
    case 'MultiPolygon':
      return (c as Position[][][]).forEach(polygon)
    case 'GeometryCollection':
      for (const child of g.geometries ?? []) addGeometry(child, f, out)
      return
  }
}

function features(json: unknown): Feature[] {
  const j = json as { type?: string; features?: Feature[]; geometry?: Geometry }
  if (j?.type === 'FeatureCollection') return j.features ?? []
  if (j?.type === 'Feature') return [j as Feature]
  if (j && typeof j.type === 'string') return [{ type: 'Feature', geometry: j as Geometry }]
  if (Array.isArray(json)) return json as Feature[]
  throw new Error('Not GeoJSON: expected a FeatureCollection, a Feature or a geometry')
}

/** Property columns: numbers stay numbers, everything else is text. */
function propertyColumns(all: Feature[], rows: number[]) {
  const names = new Map<string, string>()
  for (const f of all) {
    for (const key of Object.keys(f.properties ?? {})) {
      if (!names.has(key)) names.set(key, RESERVED.has(key) ? `p_${key}` : key)
    }
  }
  // biome-ignore lint/suspicious/noExplicitAny: columns of mixed Arrow types
  const columns: Record<string, Vector<any>> = {}
  for (const [key, column] of names) {
    const values = all.map(f => f.properties?.[key] ?? null)
    const numeric = values.every(
      v => v === null || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean'
    )
    if (numeric) {
      const per = values.map(v => (v === null ? null : Number(v)))
      columns[column] = vectorFromArray(
        rows.map(r => per[r]),
        new Float64()
      )
    } else {
      const per = values.map(v =>
        v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)
      )
      columns[column] = vectorFromArray(
        rows.map(r => per[r]),
        new Utf8()
      )
    }
  }
  return columns
}

/** A GeoJSON value as one vertex-row table per geometry kind. */
export function geojsonToTables(json: unknown): Record<GeojsonKind, Table> {
  const all = features(json)
  const out: Builders = {
    polygons: builder('polygons'),
    lines: builder('lines'),
    points: builder('points'),
  }
  all.forEach((f, i) => {
    addGeometry(f.geometry, i, out)
  })
  const table = (b: Builder) => {
    const int = (xs: number[]) => vectorFromArray(xs, new Int32())
    const float = (xs: number[]) => vectorFromArray(xs, new Float64())
    const props = propertyColumns(all, b.rows)
    return new Table({
      id: int(b.id),
      feature: int(b.feature),
      ...(b.ring ? { ring: int(b.ring) } : {}),
      ...(b.vertex ? { vertex: int(b.vertex) } : {}),
      lng: float(b.lng),
      lat: float(b.lat),
      alt: float(b.alt),
      ...props,
    })
  }
  // Every row in one table: polygons, then lines, then points, each kind's ids its own.
  const kinds = [
    ['polygon', out.polygons],
    ['line', out.lines],
    ['point', out.points],
  ] as const
  const merged: Builder = { ...builder('polygons'), vertex: [] }
  const kindColumn: string[] = []
  const rings: (number | null)[] = []
  const vertices: (number | null)[] = []
  for (const [kind, b] of kinds) {
    for (let i = 0; i < b.id.length; i++) {
      merged.id.push(b.id[i])
      merged.feature.push(b.feature[i])
      merged.lng.push(b.lng[i])
      merged.lat.push(b.lat[i])
      merged.alt.push(b.alt[i])
      merged.rows.push(b.rows[i])
      rings.push(b.ring ? b.ring[i] : null)
      vertices.push(b.vertex ? b.vertex[i] : null)
      kindColumn.push(kind)
    }
  }
  const allTable = new Table({
    kind: vectorFromArray(kindColumn, new Utf8()),
    id: vectorFromArray(merged.id, new Int32()),
    feature: vectorFromArray(merged.feature, new Int32()),
    ring: vectorFromArray(rings, new Int32()),
    vertex: vectorFromArray(vertices, new Int32()),
    lng: vectorFromArray(merged.lng, new Float64()),
    lat: vectorFromArray(merged.lat, new Float64()),
    alt: vectorFromArray(merged.alt, new Float64()),
    ...propertyColumns(all, merged.rows),
  })
  return {
    all: allTable,
    polygons: table(out.polygons),
    lines: table(out.lines),
    points: table(out.points),
  }
}

/** Load a GeoJSON file into the tables its `geojson` source reads. */
export async function loadGeojson(
  url: string,
  text: string,
  insert: (table: string, ipc: Uint8Array) => Promise<void>
): Promise<Record<GeojsonKind, number>> {
  const tables = geojsonToTables(JSON.parse(text))
  const rows = {} as Record<GeojsonKind, number>
  for (const kind of ['all', 'polygons', 'lines', 'points'] as const) {
    await insert(geojsonTable(url, kind), tableToIPC(tables[kind], 'stream'))
    rows[kind] = tables[kind].numRows
  }
  return rows
}
