// DuckDB rows as the plain objects Noodles operators expect: numbers, arrays, objects. Arrow
// vectors and structs become arrays and objects, BIGINTs numbers, so rows also survive being
// posted from the engine worker.

function plainValue(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v)
  if (v && typeof v === 'object') {
    if ('toArray' in v && typeof (v as { toArray: unknown }).toArray === 'function') {
      return Array.from((v as { toArray(): ArrayLike<unknown> }).toArray(), plainValue)
    }
    if ('toJSON' in v && typeof (v as { toJSON: unknown }).toJSON === 'function') {
      return plainRow((v as { toJSON(): Record<string, unknown> }).toJSON())
    }
  }
  return v
}

export function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plainValue(v)]))
}

export function isFeatureCollection(
  value: unknown
): value is { type: 'FeatureCollection'; features: unknown[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'FeatureCollection' &&
    Array.isArray((value as { features?: unknown }).features)
  )
}

/**
 * A host row as a table row: a GeoJSON-style `properties` object becomes columns, as feature
 * properties are columns everywhere else; a name already taken keeps a `p_` prefix.
 */
export function flatRow(row: unknown): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { value: row }
  const { properties, ...rest } = row as Record<string, unknown>
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return row
  const out: Record<string, unknown> = { ...rest }
  for (const [k, v] of Object.entries(properties)) out[k in rest ? `p_${k}` : k] = v
  return out
}

/**
 * A vector as JS code reads it: an array, so `c[0]` works and it writes back as a list column,
 * that also reads by component name, `c.x` or `c.r`, as expressions do. The names don't
 * enumerate, so rows keep their keys and serialize as arrays.
 */
export class Vec extends Array<number> {}
for (const [i, names] of ['xr', 'yg', 'zb', 'wa'].entries()) {
  for (const name of names) {
    Object.defineProperty(Vec.prototype, name, {
      get(this: Vec) {
        return this[i]
      },
      enumerable: false,
    })
  }
}

const NUMERIC_TYPE = /^(DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC|U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?)/i

/**
 * The vectors a relation stores as component columns, as the planner names them (`c_0, c_1,
 * c_2`): 2 to 4 numeric columns numbered from 0, with no column of the vector's own name.
 */
export function vectorColumns(types: Map<string, string>): { name: string; width: number }[] {
  const widths = new Map<string, number[]>()
  for (const [column, type] of types) {
    const m = /^(.+)_([0-3])$/.exec(column)
    if (!m || !NUMERIC_TYPE.test(type)) continue
    widths.set(m[1], [...(widths.get(m[1]) ?? []), Number(m[2])])
  }
  return [...widths]
    .filter(
      ([name, ks]) => !types.has(name) && ks.length >= 2 && ks.every((_, i) => ks.includes(i))
    )
    .map(([name, ks]) => ({ name, width: ks.length }))
}

/** A row with each vector's components folded into one Vec under the vector's name. */
export function foldVectors(
  row: Record<string, unknown>,
  vectors: { name: string; width: number }[]
): Record<string, unknown> {
  if (vectors.length === 0) return row
  const out = { ...row }
  for (const { name, width } of vectors) {
    const parts = Array.from({ length: width }, (_, i) => `${name}_${i}`)
    out[name] = Vec.from(parts.map(k => out[k] as number))
    for (const k of parts) delete out[k]
  }
  return out
}

/** Column types JS reads wrongly from Arrow (decimals as words, 64-bit integers as BigInt). */
const NUMERIC_CAST = /^(DECIMAL|NUMERIC|HUGEINT|UHUGEINT|BIGINT|UBIGINT)/

/**
 * A relation's rows as plain objects, with decimals and 64-bit integers read as numbers in
 * SQL first and each vector's components as one Vec: what JS code and host operators get.
 */
export async function readPlainRows(
  sql: {
    describe(relation: string): Promise<Map<string, string>>
    run(sql: string): Promise<{ table: { toArray(): unknown[] } }>
  },
  relation: string
): Promise<Record<string, unknown>[]> {
  const types = await sql.describe(relation)
  const casts = [...types]
    .filter(([, type]) => NUMERIC_CAST.test(type))
    .map(
      ([name]) => `CAST("${name.replace(/"/g, '""')}" AS DOUBLE) AS "${name.replace(/"/g, '""')}"`
    )
  const select = casts.length
    ? `SELECT * REPLACE (${casts.join(', ')}) FROM ${relation}`
    : `SELECT * FROM ${relation}`
  const { table } = await sql.run(select)
  // A vector stored as components is one value: `d.magnitude_color`, read as `[0]` or `.r`
  const vectors = vectorColumns(types)
  return (table.toArray() as { toJSON(): Record<string, unknown> }[]).map(r =>
    foldVectors(plainRow(r.toJSON()), vectors)
  )
}
