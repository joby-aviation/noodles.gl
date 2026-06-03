const SQL_RESERVED = new Set([
  'all', 'alter', 'and', 'as', 'between', 'by', 'case', 'cast', 'check',
  'column', 'create', 'cross', 'current', 'default', 'delete', 'distinct',
  'drop', 'else', 'end', 'exists', 'false', 'filter', 'for', 'foreign',
  'from', 'full', 'group', 'having', 'if', 'in', 'index', 'inner', 'insert',
  'into', 'is', 'join', 'left', 'like', 'limit', 'not', 'null', 'offset',
  'on', 'or', 'order', 'outer', 'pivot', 'primary', 'references', 'right',
  'select', 'set', 'table', 'then', 'true', 'union', 'unique', 'unpivot',
  'update', 'using', 'values', 'when', 'where', 'with',
])

export function operatorIdToAlias(id: string): string {
  const base = id
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()

  if (SQL_RESERVED.has(base)) return `${base}_op`
  return base
}

export function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function escapeLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  return `'${String(value).replace(/'/g, "''")}'`
}
