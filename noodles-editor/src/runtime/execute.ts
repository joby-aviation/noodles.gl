/**
 * One layer's data: its query, then its CPU stage, then whatever the deck adapter needs.
 *
 * Split in two on purpose, because the two halves are two different routes. `queryLayer` runs
 * the plan's SQL and reads Arrow — what a `requery` parameter costs. `evaluateLayer` runs the
 * generated JS loop over those columns, applies the discard mask and computes path starts —
 * what a `cpu` parameter costs. A `prop` parameter costs neither, and the runtime calls
 * neither. Keeping them separate is what lets the runtime do exactly the work a change needs.
 */

import {
  type ColumnUpload,
  evaluateStage,
  type LayerPlan,
  readColumn,
  readStrings,
  readValues,
  readVectorColumns,
  ringStarts,
  runStarts,
  type SqlEngine,
  withDerived,
} from '@noodles.gl/planner'
import type { Table, Vector } from 'apache-arrow'
import { alongPaths, flattenPaths, flattenPoints, fromOrigin, perMark } from './path-rows'

export interface QueriedLayer {
  rows: number
  uploads: Map<string, ColumnUpload>
  strings: Map<string, string[]>
  raw: Map<string, unknown[]>
  /** Columns read in doubles (`AttributeDecl.precise`): a trips layer's timestamps. */
  precise: Map<string, Float64Array>
  /** Path rows: the columns holding a path per row, as their Arrow vectors. */
  lists: Map<string, { vector: Vector; wkb: boolean }>
  /** Parameters published by the layer's stats queries. */
  stats: Record<string, number>
  queryMs: number
}

export interface LayerData {
  /** Instances after the discard mask. */
  rows: number
  attributes: Map<string, { data: Float32Array; width: number }>
  strings: Map<string, string[]>
  /** Raw uint32/int columns like __rowid, preserved through compaction. */
  raw?: Map<string, unknown[]>
  /** Path starts, for vertex layers. For a polygon layer, one per polygon. */
  starts?: Uint32Array
  /**
   * Ring starts, for polygon layers: a row where the polygon or its ring changes. A ring start
   * that is not also a polygon start begins a hole. The deck adapter triangulates from these.
   */
  rings?: Uint32Array
  /** A trips layer's times are offsets from this; deck's current time is moved by it too. */
  timeOrigin?: number
  evalMs: number
  /** The generated CPU loop, for the inspector. */
  code: string
}

export async function queryLayer(
  sql: SqlEngine,
  layer: LayerPlan,
  values: Record<string, number | string>
): Promise<QueriedLayer> {
  const started = performance.now()
  const plan = layer.plan
  // Derived parameters read declared ones only, never a stats output, so once is enough.
  const all: Record<string, number | string> = withDerived(plan, values)
  const stats: Record<string, number> = {}
  for (const s of plan.stats) {
    const { table } = await sql.run(
      s.sql,
      s.params.map(p => bindValue(all, p))
    )
    const row = table.get(0) as Record<string, unknown> | null
    for (const o of s.outputs) {
      const v = Number(row?.[o.column])
      stats[o.param] = Number.isFinite(v) ? v : 0
      all[o.param] = stats[o.param]
    }
  }
  const { table } = await sql.run(
    plan.sql,
    plan.sqlParams.map(p => bindValue(all, p))
  )
  const uploads = new Map<string, ColumnUpload>()
  const strings = new Map<string, string[]>()
  const raw = new Map<string, unknown[]>()
  const lists = new Map<string, { vector: Vector; wkb: boolean }>()
  const precise = new Map<string, Float64Array>()
  for (const decl of plan.attributes) {
    if (decl.provenance !== 'arrow') continue
    if (decl.precise)
      precise.set(decl.name, readDoubles(table, decl.sourceColumns?.[0] ?? decl.name))
    if (decl.type === 'list') {
      const vector = table.getChild(decl.name)
      const field = table.schema.fields.find(f => f.name === decl.name)
      const wkb = field?.metadata.get('ARROW:extension:name') === 'geoarrow.wkb'
      if (vector) lists.set(decl.name, { vector, wkb })
      continue
    }
    if (decl.type === 'str') {
      strings.set(decl.name, readStrings(table, decl.name))
      continue
    }
    if (decl.type === 'raw') raw.set(decl.name, readValues(table, decl.name))
    // A raw column may also be read numerically by a stage; that read may narrow, harmlessly.
    try {
      uploads.set(
        decl.name,
        decl.sourceColumns && decl.sourceColumns.length > 1
          ? readVectorColumns(table, decl.sourceColumns)
          : readColumn(table, decl.sourceColumns?.[0] ?? decl.name)
      )
    } catch (err) {
      if (decl.type !== 'raw') throw err
    }
  }
  return {
    rows: table.numRows,
    uploads,
    strings,
    raw,
    precise,
    lists,
    stats,
    queryMs: performance.now() - started,
  }
}

function bindValue(values: Record<string, number | string>, name: string): number | string {
  const v = values[name]
  if (v === undefined) throw new Error(`No value for parameter '${name}'`)
  return v
}

export function evaluateLayer(
  layer: LayerPlan,
  queried: QueriedLayer,
  values: Record<string, number | string>
): LayerData {
  const plan = layer.plan
  const numeric: Record<string, number> = { ...queried.stats }
  for (const [k, v] of Object.entries(values)) if (typeof v === 'number') numeric[k] = v
  // No compute on deck's WebGL2 path: a GPU-stage node, if a plan has one, runs here too.
  const stage = [...plan.cpuStage, ...plan.gpuStage]
  const evaluated = evaluateStage(stage, plan, queried.uploads, numeric, queried.rows)

  const mask = plan.maskAttribute ? evaluated.values.get(plan.maskAttribute) : undefined
  const keep = mask ? keptRows(mask.data, mask.width, queried.rows) : undefined

  const attributes = new Map<string, { data: Float32Array; width: number }>()
  for (const [name, v] of evaluated.values) {
    if (name === plan.maskAttribute) continue
    attributes.set(name, { data: keep ? pick(v.data, v.width, keep) : v.data, width: v.width })
  }
  const strings = new Map<string, string[]>()
  for (const [name, s] of queried.strings) strings.set(name, keep ? Array.from(keep, i => s[i]) : s)

  // Compact raw arrays (rowid, pathId) using same pattern as strings
  const raw = new Map<string, unknown[]>()
  for (const [name, r] of queried.raw) {
    raw.set(name, keep ? Array.from(keep, i => r[i]) : r)
  }

  // Path rows: each row's path flattened into vertices, and every per-row value repeated
  // along them
  const pathLists = plan.layer?.lists
  if (pathLists?.length) {
    const kind = plan.layer?.kind
    const rowsKept = keep ?? Uint32Array.from({ length: queried.rows }, (_, i) => i)
    if (kind !== 'path' && kind !== 'trips' && kind !== 'polygon') {
      // A mark per point of each row's geometry
      const position = pathLists.find(l => l.channel === 'position')
      const column = position && queried.lists.get(position.column)
      if (!position || !column) throw new Error('The position column is missing from the query')
      const marks = flattenPoints(column.vector, rowsKept, column.wkb)
      const per = new Map<string, { data: Float32Array; width: number }>()
      for (const [name, a] of attributes) per.set(name, perMark(a, marks.rowOf))
      per.set(position.column, marks.position)
      const perStrings = new Map<string, string[]>()
      for (const [name, s] of strings)
        perStrings.set(
          name,
          Array.from(marks.rowOf, j => s[j])
        )
      return {
        rows: marks.rowOf.length,
        attributes: per,
        strings: perStrings,
        raw: new Map(),
        evalMs: evaluated.evalMs,
        code: evaluated.code,
      }
    }
    const paths = flattenPaths(
      pathLists.map(l => {
        const column = queried.lists.get(l.column)
        if (!column) throw new Error(`Column '${l.column}' not present in query result`)
        return { ...l, ...column }
      }),
      rowsKept,
      kind
    )
    const along = new Map<string, { data: Float32Array; width: number }>()
    for (const [name, a] of attributes) along.set(name, alongPaths(a, paths))
    for (const [name, a] of paths.values) along.set(name, a)
    let timeOrigin: number | undefined
    const time = kind === 'trips' ? pathLists.find(l => l.channel === 'timestamp') : undefined
    const times = time && paths.doubles.get(time.column)
    if (time && times) {
      const offsets = fromOrigin(times)
      along.set(time.column, { data: offsets.data, width: 1 })
      timeOrigin = offsets.origin
    }
    return {
      rows: paths.vertices,
      attributes: along,
      strings: new Map(),
      raw: new Map(),
      starts: paths.starts,
      rings: paths.rings,
      timeOrigin,
      evalMs: evaluated.evalMs,
      code: evaluated.code,
    }
  }

  // A trips layer's times, from the doubles the query returned, as offsets from an origin
  let timeOrigin: number | undefined
  const timeName =
    plan.layer?.kind === 'trips'
      ? plan.layer.bindings.find(b => b.channel === 'timestamp')?.attribute
      : undefined
  const staged = new Set(stage.map(n => n.name))
  const times = timeName && !staged.has(timeName) ? queried.precise.get(timeName) : undefined
  if (timeName && times) {
    const offsets = fromOrigin(keep ? Float64Array.from(keep, i => times[i]) : times)
    attributes.set(timeName, { data: offsets.data, width: 1 })
    timeOrigin = offsets.origin
  }

  const pathId = plan.layer?.pathId
  const ids = pathId ? queried.raw.get(pathId) : undefined
  const ringId = plan.layer?.ringId
  const isPolygon = plan.layer?.kind === 'polygon'
  return {
    rows: keep ? keep.length : queried.rows,
    attributes,
    strings,
    raw,
    starts: ids ? runStarts(ids, keep) : undefined,
    rings:
      ids && isPolygon
        ? ringStarts(ids, ringId ? queried.raw.get(ringId) : undefined, keep)
        : undefined,
    timeOrigin,
    evalMs: evaluated.evalMs,
    code: evaluated.code,
  }
}

/** Row indices whose mask value passes, matching the WebGPU pass's `< 0.5` discard test. */
export function keptRows(mask: Float32Array, width: number, rows: number): Uint32Array {
  const out = new Uint32Array(rows)
  let n = 0
  for (let i = 0; i < rows; i++) if (mask[i * width] >= 0.5) out[n++] = i
  return out.subarray(0, n)
}

export function pick(src: Float32Array, width: number, keep: ArrayLike<number>): Float32Array {
  const out = new Float32Array(keep.length * width)
  for (let j = 0; j < keep.length; j++) {
    const i = keep[j]
    for (let c = 0; c < width; c++) out[j * width + c] = src[i * width + c]
  }
  return out
}

/** A numeric column in doubles, nulls as NaN: what `AttributeDecl.precise` columns are read as. */
function readDoubles(table: Table, name: string): Float64Array {
  const vector = table.getChild(name)
  const out = new Float64Array(table.numRows)
  if (!vector) return out
  let at = 0
  for (const d of vector.data) {
    const values = d.values as ArrayLike<number | bigint>
    for (let i = 0; i < d.length; i++) {
      const bitmap = d.nullCount > 0 && d.nullBitmap?.length ? d.nullBitmap : undefined
      const j = d.offset + i
      out[at++] = bitmap && !(bitmap[j >> 3] & (1 << (j & 7))) ? Number.NaN : Number(values[j])
    }
  }
  return out
}
