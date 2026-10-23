// Path rows: a vertex layer whose rows each hold a whole path, in a list column of positions
// or a geometry, drawn without unnesting them into vertex rows. The list's Arrow buffers (or
// the WKB) are walked once into deck's flat vertex array and path starts; every other channel
// stays one value per row and is repeated along that row's vertices. world-flights' 12,938
// flights stay 12,938 rows instead of 1.5M. A one-mark layer (scatter, text) on a geometry
// draws a mark per point the same way.

import type { PathColumnKind } from '@noodles.gl/planner'
import type { Data, Vector } from 'apache-arrow'

export interface PathList {
  channel: string
  column: string
  kind: PathColumnKind
  vector: Vector
  /** A geometry column arrived as WKB (Arrow's `geoarrow.wkb`), not DuckDB's own bytes. */
  wkb?: boolean
}

export interface FlatPaths {
  /** Vertices of every path, one after another. */
  vertices: number
  /** First vertex of each path. */
  starts: Uint32Array
  /** Polygons: first vertex of each ring, the first of each polygon included. */
  rings?: Uint32Array
  /** Per path, the row it came from (an index into the rows kept). */
  rowOf: Uint32Array
  /** Flattened list channels, by column: the position three-wide, a number list one-wide. */
  values: Map<string, { data: Float32Array; width: number }>
}

/** A Float32Array that grows as values are pushed. */
class Floats {
  data = new Float32Array(1024)
  length = 0
  push(v: number) {
    if (this.length === this.data.length) this.reserve(1)
    this.data[this.length++] = v
  }
  /** Room for `n` more values, for a loop that writes `data` directly. */
  reserve(n: number) {
    if (this.length + n <= this.data.length) return
    let size = this.data.length * 2
    while (size < this.length + n) size *= 2
    const next = new Float32Array(size)
    next.set(this.data.subarray(0, this.length))
    this.data = next
  }
  done(): Float32Array {
    return this.data.slice(0, this.length)
  }
}

class Indices {
  data = new Uint32Array(256)
  length = 0
  push(v: number) {
    if (this.length === this.data.length) {
      const next = new Uint32Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    this.data[this.length++] = v
  }
  done(): Uint32Array {
    return this.data.slice(0, this.length)
  }
}

const isValid = (d: Data, i: number) => {
  if (!d.nullCount) return true
  const bitmap = d.nullBitmap
  if (!bitmap || bitmap.length === 0) return true
  const at = d.offset + i
  return (bitmap[at >> 3] & (1 << (at & 7))) !== 0
}

/** Row `row` of a chunked vector: the chunk holding it and the row within it. */
function locate(vector: Vector): (row: number) => [Data, number] {
  const ends: number[] = []
  let total = 0
  for (const d of vector.data) {
    total += d.length
    ends.push(total)
  }
  let chunk = 0
  return row => {
    // Rows are read in order, so the chunk only moves forward; a jump back starts over
    if (chunk > 0 && row < ends[chunk - 1]) chunk = 0
    while (row >= ends[chunk]) chunk++
    return [vector.data[chunk], row - (chunk > 0 ? ends[chunk - 1] : 0)]
  }
}

/** A list of positions per row: `List<FixedSizeList<k>>` or `List<List<number>>`. */
function pointsOf(vector: Vector) {
  const at = locate(vector)
  return (row: number, out: Floats): number => {
    const [d, i] = at(row)
    if (!isValid(d, i)) return 0
    const offsets = d.valueOffsets as Int32Array
    const start = offsets[d.offset + i]
    const end = offsets[d.offset + i + 1]
    const point = d.children[0]
    const fixed = (point.type as { listSize?: number }).listSize
    const n = end - start
    if (fixed && !point.nullCount) {
      // The common case, a fixed-width point: one tight copy, a null number tested by its bit
      const numbers = point.children[0]
      const values = numbers.values as Float64Array | Float32Array
      const bits = numbers.nullCount && numbers.nullBitmap?.length ? numbers.nullBitmap : undefined
      out.reserve(n * 3)
      const dst = out.data
      let w = out.length
      let r = numbers.offset + (point.offset + start) * fixed
      for (let j = 0; j < n; j++, r += fixed) {
        if (bits) {
          // A missing altitude is the ground; a missing longitude or latitude draws nothing
          dst[w++] = bits[r >> 3] & (1 << (r & 7)) ? values[r] : Number.NaN
          dst[w++] = bits[(r + 1) >> 3] & (1 << ((r + 1) & 7)) ? values[r + 1] : Number.NaN
          dst[w++] = fixed > 2 && bits[(r + 2) >> 3] & (1 << ((r + 2) & 7)) ? values[r + 2] : 0
        } else {
          dst[w++] = values[r]
          dst[w++] = values[r + 1]
          dst[w++] = fixed > 2 ? values[r + 2] : 0
        }
      }
      out.length = w
      return n
    }
    for (let j = start; j < end; j++) {
      let numbers: Data
      let from: number
      let width: number
      if (fixed) {
        numbers = point.children[0]
        from = (point.offset + j) * fixed
        width = fixed
      } else {
        const inner = point.valueOffsets as Int32Array
        numbers = point.children[0]
        from = inner[point.offset + j]
        width = inner[point.offset + j + 1] - from
      }
      const values = numbers.values as Float64Array | Float32Array
      const base = numbers.offset + from
      for (let c = 0; c < 3; c++) {
        // A missing altitude is the ground; a missing longitude or latitude draws nothing
        const present = c < width && isValid(numbers, from + c)
        out.push(present ? values[base + c] : c === 2 ? 0 : Number.NaN)
      }
    }
    return end - start
  }
}

/** A list of numbers per row: `List<number>`. */
function numbersOf(vector: Vector) {
  const at = locate(vector)
  return (row: number, out: Floats): number => {
    const [d, i] = at(row)
    if (!isValid(d, i)) return 0
    const offsets = d.valueOffsets as Int32Array
    const start = offsets[d.offset + i]
    const end = offsets[d.offset + i + 1]
    const numbers = d.children[0]
    const values = numbers.values as Float64Array | Float32Array
    if (!numbers.nullCount) {
      out.reserve(end - start)
      out.data.set(values.subarray(numbers.offset + start, numbers.offset + end), out.length)
      out.length += end - start
      return end - start
    }
    for (let j = start; j < end; j++) {
      out.push(isValid(numbers, j) ? values[numbers.offset + j] : Number.NaN)
    }
    return end - start
  }
}

/** One row's geometry bytes, or undefined for a null geometry. */
function wkbOf(vector: Vector) {
  const at = locate(vector)
  return (row: number): Uint8Array | undefined => {
    const [d, i] = at(row)
    if (!isValid(d, i)) return undefined
    const offsets = d.valueOffsets as Int32Array
    const bytes = d.values as Uint8Array
    return bytes.subarray(offsets[d.offset + i], offsets[d.offset + i + 1])
  }
}

/**
 * The lines or polygons of a WKB geometry, written as vertices. `line` is called per line
 * (a path layer draws it), `polygon` per polygon with its rings' vertex counts; points and
 * the other kind are skipped, as a GeoJSON layer draws each kind with its own sublayer.
 */
function walkWkb(
  bytes: Uint8Array,
  out: Floats,
  onLine: (vertices: number) => void,
  onPolygon: (rings: number[]) => void,
  onPoint?: () => void
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 0
  const read = () => {
    const little = view.getUint8(at) === 1
    const raw = view.getUint32(at + 1, little)
    at += 5
    const code = raw & 0xffff
    const base = code % 1000
    const flag = Math.floor(code / 1000)
    const z = flag === 1 || flag === 3 || (raw & 0x80000000) !== 0
    const m = flag === 2 || flag === 3 || (raw & 0x40000000) !== 0
    if (raw & 0x20000000) at += 4
    const stride = 16 + (z ? 8 : 0) + (m ? 8 : 0)
    const u32 = () => {
      const v = view.getUint32(at, little)
      at += 4
      return v
    }
    const points = (write: boolean, dropLast: boolean): number => {
      const n = u32()
      const kept = dropLast && n > 1 ? n - 1 : n
      if (write) {
        for (let j = 0; j < kept; j++) {
          const p = at + j * stride
          out.push(view.getFloat64(p, little))
          out.push(view.getFloat64(p + 8, little))
          out.push(z ? view.getFloat64(p + 16, little) : 0)
        }
      }
      at += n * stride
      return write ? kept : 0
    }
    switch (base) {
      case 1: {
        if (onPoint) {
          const x = view.getFloat64(at, little)
          // An empty point is NaN coordinates: no mark
          if (!Number.isNaN(x)) {
            out.push(x)
            out.push(view.getFloat64(at + 8, little))
            out.push(z ? view.getFloat64(at + 16, little) : 0)
            onPoint()
          }
        }
        at += stride
        return
      }
      case 2: {
        const n = points(!onPoint, false)
        if (!onPoint) onLine(n)
        return
      }
      case 3: {
        const rings: number[] = []
        const count = u32()
        // A ring's closing vertex repeats its first, which deck's triangulation does not need
        for (let r = 0; r < count; r++) rings.push(points(!onPoint, true))
        if (!onPoint) onPolygon(rings)
        return
      }
      case 4:
      case 5:
      case 6:
      case 7: {
        const count = u32()
        for (let k = 0; k < count; k++) read()
        return
      }
    }
    throw new Error(`Unknown WKB geometry type ${raw}`)
  }
  read()
}

/**
 * The same walk over DuckDB spatial's own GEOMETRY bytes, which a query returns when it
 * selects a geometry as it is: no ST_AsWKB, which for world-flights' 1.5M vertices cost
 * 0.4 s per layer. An 8-byte header (type, flags: z, m, a bounding box), the box as floats,
 * then per geometry a type and a count; a polygon's ring counts are padded to 8 bytes.
 */
function walkGeometry(
  bytes: Uint8Array,
  out: Floats,
  onLine: (vertices: number) => void,
  onPolygon: (rings: number[]) => void,
  onPoint?: () => void
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = bytes[1]
  const z = (flags & 1) !== 0
  const m = (flags & 2) !== 0
  let at = 8
  if (flags & 4) at += 4 * (4 + (z ? 2 : 0) + (m ? 2 : 0))
  const stride = 16 + (z ? 8 : 0) + (m ? 8 : 0)
  const u32 = () => {
    const v = view.getUint32(at, true)
    at += 4
    return v
  }
  const points = (n: number, write: boolean, dropLast: boolean): number => {
    const kept = dropLast && n > 1 ? n - 1 : n
    if (write) {
      for (let j = 0; j < kept; j++) {
        const p = at + j * stride
        out.push(view.getFloat64(p, true))
        out.push(view.getFloat64(p + 8, true))
        // Without z the third number is m, which is not an altitude
        out.push(z ? view.getFloat64(p + 16, true) : 0)
      }
    }
    at += n * stride
    return write ? kept : 0
  }
  const read = () => {
    const type = u32()
    const count = u32()
    switch (type) {
      case 0:
        if (count > 0) {
          if (onPoint) {
            points(1, true, false)
            onPoint()
          } else {
            at += stride
          }
        }
        return
      case 1: {
        const n = points(count, !onPoint, false)
        if (!onPoint) onLine(n)
        return
      }
      case 2: {
        const sizes: number[] = []
        for (let r = 0; r < count; r++) sizes.push(u32())
        if (count % 2 === 1) at += 4
        const rings = sizes.map(n => points(n, !onPoint, true))
        if (!onPoint) onPolygon(rings)
        return
      }
      case 3:
      case 4:
      case 5:
      case 6:
        for (let k = 0; k < count; k++) read()
        return
    }
    throw new Error(`Unknown geometry type ${type}`)
  }
  read()
}

/**
 * Flatten path rows. `kept` are the rows the layer draws (its filter applied), in order;
 * every list channel is read for those rows only.
 */
export function flattenPaths(
  lists: PathList[],
  kept: ArrayLike<number>,
  kind: 'path' | 'trips' | 'polygon'
): FlatPaths {
  const position = lists.find(l => l.channel === 'position')
  if (!position) throw new Error('A path layer needs a position')
  const others = lists.filter(l => l !== position)
  const out = new Floats()
  const starts = new Indices()
  const rings = new Indices()
  const rowOf = new Indices()
  const values = new Map<string, { data: Float32Array; width: number }>()
  let vertices = 0

  if (position.kind === 'geometry') {
    if (others.length) {
      throw new Error(
        `'${others[0].channel}' reads a list per row, which only a list of positions can pair with`
      )
    }
    const wkb = wkbOf(position.vector)
    const walk = position.wkb ? walkWkb : walkGeometry
    for (let j = 0; j < kept.length; j++) {
      const bytes = wkb(kept[j])
      if (!bytes) continue
      walk(
        bytes,
        out,
        n => {
          if (kind === 'polygon') {
            // A line in a polygon layer draws nothing; its vertices are taken back
            out.length -= n * 3
            return
          }
          if (n === 0) return
          starts.push(vertices)
          rowOf.push(j)
          vertices += n
        },
        ringCounts => {
          const total = ringCounts.reduce((a, b) => a + b, 0)
          if (kind !== 'polygon' || total === 0) {
            out.length -= total * 3
            return
          }
          starts.push(vertices)
          rowOf.push(j)
          for (const n of ringCounts) {
            if (n === 0) continue
            rings.push(vertices)
            vertices += n
          }
        }
      )
    }
  } else {
    const read = pointsOf(position.vector)
    const lists = others.map(l => {
      if (l.kind !== 'numbers') {
        throw new Error(`'${l.channel}' reads '${l.column}', which is not a list of numbers`)
      }
      return { l, read: numbersOf(l.vector), out: new Floats() }
    })
    for (let j = 0; j < kept.length; j++) {
      const row = kept[j]
      const n = read(row, out)
      for (const x of lists) {
        const m = x.read(row, x.out)
        if (m !== n) {
          throw new Error(
            `Row ${row}: '${x.l.column}' has ${m} values for ${n} positions in '${position.column}'`
          )
        }
      }
      if (n === 0) continue
      starts.push(vertices)
      rings.push(vertices)
      rowOf.push(j)
      vertices += n
    }
    for (const x of lists) values.set(x.l.column, { data: x.out.done(), width: 1 })
  }
  values.set(position.column, { data: out.done(), width: 3 })
  return {
    vertices,
    starts: starts.done(),
    rings: kind === 'polygon' ? rings.done() : undefined,
    rowOf: rowOf.done(),
    values,
  }
}

/** A per-row attribute repeated along each path's vertices. */
export function alongPaths(
  a: { data: Float32Array; width: number },
  paths: FlatPaths
): { data: Float32Array; width: number } {
  const { width } = a
  const out = new Float32Array(paths.vertices * width)
  const { starts, rowOf, vertices } = paths
  for (let p = 0; p < starts.length; p++) {
    const end = p + 1 < starts.length ? starts[p + 1] : vertices
    const from = rowOf[p] * width
    for (let v = starts[p]; v < end; v++) {
      for (let c = 0; c < width; c++) out[v * width + c] = a.data[from + c]
    }
  }
  return { data: out, width }
}

/** Marks from a geometry per row: one per point, a MultiPoint's every part. */
export interface FlatPoints {
  /** Per mark, the row it came from (an index into the rows kept). */
  rowOf: Uint32Array
  position: { data: Float32Array; width: number }
}

export function flattenPoints(vector: Vector, kept: ArrayLike<number>, isWkb = false): FlatPoints {
  const wkb = wkbOf(vector)
  const walk = isWkb ? walkWkb : walkGeometry
  const out = new Floats()
  const rowOf = new Indices()
  for (let j = 0; j < kept.length; j++) {
    const bytes = wkb(kept[j])
    if (!bytes) continue
    walk(
      bytes,
      out,
      () => {},
      () => {},
      () => rowOf.push(j)
    )
  }
  return { rowOf: rowOf.done(), position: { data: out.done(), width: 3 } }
}

/** A per-row attribute repeated for every mark of its row. */
export function perMark(
  a: { data: Float32Array; width: number },
  rowOf: Uint32Array
): { data: Float32Array; width: number } {
  const { width } = a
  const out = new Float32Array(rowOf.length * width)
  for (let m = 0; m < rowOf.length; m++) {
    for (let c = 0; c < width; c++) out[m * width + c] = a.data[rowOf[m] * width + c]
  }
  return { data: out, width }
}
