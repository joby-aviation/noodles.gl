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

/** Column types JS reads wrongly from Arrow (decimals as words, 64-bit integers as BigInt). */
const NUMERIC_CAST = /^(DECIMAL|NUMERIC|HUGEINT|UHUGEINT|BIGINT|UBIGINT)/

/**
 * A relation's rows as plain objects, with decimals and 64-bit integers read as numbers in
 * SQL first: what JS code and host operators get.
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
  return (table.toArray() as { toJSON(): Record<string, unknown> }[]).map(r => plainRow(r.toJSON()))
}
