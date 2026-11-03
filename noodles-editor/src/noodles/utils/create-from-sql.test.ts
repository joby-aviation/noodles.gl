import { lowerDocument } from '@noodles.gl/planner'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProjectFromSQL, takeCreateFromSQLRequest, validateSQL } from './create-from-sql'

describe('createProjectFromSQL', () => {
  it('draws the query rows as points, with no accessors', () => {
    const sql = "SELECT name, lng, lat FROM read_csv('https://example.com/a.csv')"
    const doc = createProjectFromSQL({ sql })
    expect(doc.nodes.map(n => n.op)).toEqual(['sql', 'scatter', 'deck'])
    expect(doc.nodes[0].params.query).toBe(sql)
    expect(doc.nodes[1].params.position).toBe('[lng, lat]')
    expect(lowerDocument(doc).errors).toEqual([])
  })

  it('positions points by the coordinate columns the query names', () => {
    const doc = createProjectFromSQL({ sql: 'SELECT longitude, latitude FROM places' })
    expect(doc.nodes[1].params.position).toBe('[longitude, latitude]')
    const lon = createProjectFromSQL({ sql: 'SELECT lon, lat FROM t' })
    expect(lon.nodes[1].params.position).toBe('[lon, lat]')
  })

  it('lays the nodes out left to right', () => {
    const xs = createProjectFromSQL({ sql: 'SELECT * FROM data' }).nodes.map(n => n.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })
})

describe('validateSQL', () => {
  it('accepts valid SELECT query', () => {
    const result = validateSQL('SELECT * FROM data')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts SELECT with lowercase', () => {
    const result = validateSQL('select * from data')
    expect(result.valid).toBe(true)
  })

  it('accepts SELECT with mixed case', () => {
    const result = validateSQL('SeLeCt * FrOm data')
    expect(result.valid).toBe(true)
  })

  it('accepts SELECT with leading whitespace', () => {
    const result = validateSQL('  \n  SELECT * FROM data')
    expect(result.valid).toBe(true)
  })

  it('rejects empty query', () => {
    const result = validateSQL('')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('empty')
  })

  it('rejects non-SELECT query', () => {
    const result = validateSQL('INSERT INTO data VALUES (1, 2)')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SELECT')
  })

  it('rejects DROP TABLE query', () => {
    const result = validateSQL('DROP TABLE users')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SELECT')
  })

  it('rejects UPDATE query', () => {
    const result = validateSQL('UPDATE users SET name = "test"')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SELECT')
  })

  it('rejects DELETE query', () => {
    const result = validateSQL('DELETE FROM users')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SELECT')
  })

  it('rejects whitespace-only query', () => {
    const result = validateSQL('   \n  \t  ')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('empty')
  })
})

describe('takeCreateFromSQLRequest', () => {
  let originalUrl: string

  beforeEach(() => {
    originalUrl = window.location.href
  })

  afterEach(() => {
    window.history.replaceState(null, '', originalUrl)
  })

  const setSearch = (search: string) => {
    window.history.replaceState(null, '', `${window.location.pathname}${search}`)
  }

  it('returns null when there is no createFromSQL param', () => {
    setSearch('?foo=bar')
    expect(takeCreateFromSQLRequest()).toBeNull()
  })

  it('returns the SQL for confirmation instead of a project', () => {
    const sql = "SELECT * FROM 'https://example.com/data.parquet'"
    setSearch(`?createFromSQL=${encodeURIComponent(sql)}`)
    expect(takeCreateFromSQLRequest()).toEqual({ sql })
  })

  it('removes the param from the URL so the link applies once', () => {
    setSearch(`?foo=bar&createFromSQL=${encodeURIComponent('SELECT 1')}`)
    takeCreateFromSQLRequest()
    const params = new URLSearchParams(window.location.search)
    expect(params.has('createFromSQL')).toBe(false)
    expect(params.get('foo')).toBe('bar')
    expect(takeCreateFromSQLRequest()).toBeNull()
  })

  it('returns an error for SQL that is not a SELECT', () => {
    setSearch(`?createFromSQL=${encodeURIComponent('DROP TABLE users')}`)
    expect(takeCreateFromSQLRequest()).toEqual({ error: 'SQL query must start with SELECT' })
  })
})
