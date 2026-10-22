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
