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

/**
 * A row with each vector the planner knows the relation stores (its shape's vectors) as one
 * Vec under the vector's name: built from its component columns (`c_0, c_1, c_2`), or wrapped
 * when the relation also holds it as a list column (one a code node wrote), whose components
 * the planner generated. Other numbered columns (`value_0`) are left as they are.
 */
export function foldVectors(
  row: Record<string, unknown>,
  vectors: readonly { name: string; width: number }[]
): Record<string, unknown> {
  if (vectors.length === 0) return row
  const out = { ...row }
  for (const { name, width } of vectors) {
    const parts = Array.from({ length: width }, (_, i) => `${name}_${i}`)
    const list = out[name]
    if (Array.isArray(list)) out[name] = Vec.from(list as number[])
    else if (parts.every(k => k in out)) out[name] = Vec.from(parts.map(k => out[k] as number))
    else continue
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
  relation: string,
  // The vectors the planner knows the relation stores, from its shape
  vectors: readonly { name: string; width: number }[] = []
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
  return (table.toArray() as { toJSON(): Record<string, unknown> }[]).map(r =>
    foldVectors(plainRow(r.toJSON()), vectors)
  )
}
