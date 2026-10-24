import type { EditorDoc } from '@noodles.gl/planner'

export interface CreateFromSQLOptions {
  sql: string
}

// Column names a query's coordinates usually go by, most common first
const LONGITUDE_NAMES = ['lng', 'lon', 'longitude', 'long', 'x']
const LATITUDE_NAMES = ['lat', 'latitude', 'y']

/** The first of `names` the query mentions as a word, else the first name. */
function columnIn(sql: string, names: string[]): string {
  const found = names.find(n => new RegExp(`\\b${n}\\b`, 'i').test(sql))
  return found ?? names[0]
}

// A project from a query: its rows drawn as points, positioned by the coordinate columns the
// query names. A document, not an operator graph: the position is an expression, no accessor.
export function createProjectFromSQL({ sql }: CreateFromSQLOptions): EditorDoc {
  const lng = columnIn(sql, LONGITUDE_NAMES)
  const lat = columnIn(sql, LATITUDE_NAMES)
  return {
    version: 1,
    name: 'new',
    nodes: [
      { id: 'n1', op: 'sql', name: 'query', x: 100, y: 200, params: { query: sql } },
      {
        id: 'n2',
        op: 'scatter',
        name: 'points',
        x: 400,
        y: 200,
        params: { position: `[${lng}, ${lat}]`, fillColor: [255, 100, 100], opacity: 0.8 },
      },
      { id: 'n3', op: 'deck', name: 'deck', x: 700, y: 200, params: {} },
    ],
    edges: [
      { id: 'e1', source: 'n1', sourcePort: 'out', target: 'n2', targetPort: 'in' },
      { id: 'e2', source: 'n2', sourcePort: 'out', target: 'n3', targetPort: 'layers', index: 0 },
    ],
  }
}

export const CREATE_FROM_SQL_PARAM = 'createFromSQL'

export type CreateFromSQLRequest = { sql: string } | { error: string }

// Reads ?createFromSQL= and removes it from the URL so a link applies once. Never run
// the SQL directly: DuckDB can fetch remote URLs, so show it and wait for the user to confirm.
export function takeCreateFromSQLRequest(): CreateFromSQLRequest | null {
  const url = new URL(window.location.href)
  const sql = url.searchParams.get(CREATE_FROM_SQL_PARAM)
  if (sql === null) return null
  url.searchParams.delete(CREATE_FROM_SQL_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  const validation = validateSQL(sql)
  return validation.valid ? { sql } : { error: validation.error ?? 'Invalid SQL query' }
}

export function validateSQL(sql: string): { valid: boolean; error?: string } {
  if (!sql || sql.trim().length === 0) {
    return { valid: false, error: 'SQL query is empty' }
  }

  const trimmed = sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT')) {
    return { valid: false, error: 'SQL query must start with SELECT' }
  }

  return { valid: true }
}
