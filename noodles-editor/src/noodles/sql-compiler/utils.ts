const SQL_RESERVED = new Set([
  'select',
  'from',
  'where',
  'group',
  'order',
  'limit',
  'offset',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'on',
  'as',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'true',
  'false',
  'between',
  'like',
  'case',
  'when',
  'then',
  'else',
  'end',
  'having',
  'union',
  'all',
  'distinct',
  'insert',
  'update',
  'delete',
  'create',
  'drop',
  'alter',
  'table',
  'index',
  'view',
  'with',
  'recursive',
  'values',
  'set',
  'into',
  'exists',
  'cast',
  'filter',
  'over',
  'partition',
  'window',
  'rows',
  'range',
  'unbounded',
  'preceding',
  'following',
  'current',
  'row',
  'rank',
  'count',
  'sum',
  'avg',
  'min',
  'max',
])

export function operatorIdToAlias(id: string): string {
  let alias = id
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()

  if (!alias || /^\d/.test(alias)) alias = `op_${alias}`
  if (SQL_RESERVED.has(alias)) alias = `${alias}_op`

  return alias
}

export function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function escapeLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${String(value).replace(/'/g, "''")}'`
}
