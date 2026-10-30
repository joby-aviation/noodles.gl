import { describe, it, expect } from 'vitest'
import {
  columnTypeOf,
  numericListOf,
  listVectors,
  listComponentsSql,
  listComponentColumns,
  rowwiseSql,
  sqlNodeSql,
  type RelColumn,
} from './relational.js'
import type { GraphNode, SqlNode } from './types.js'
import { plan } from './planner.js'
import { targetCaps } from './target.js'

const col = (name: string, duckType: string): RelColumn => ({
  name,
  duckType,
  type: columnTypeOf(duckType),
})

describe('numeric list columns', () => {
  it('classifies a list or array as other, whatever it holds', () => {
    expect(columnTypeOf('DOUBLE[]')).toBe('other')
    expect(columnTypeOf('FLOAT[3]')).toBe('other')
    expect(columnTypeOf('VARCHAR[]')).toBe('other')
    expect(columnTypeOf('DOUBLE')).toBe('num')
  })

  it('recognizes lists and arrays of numbers', () => {
    expect(numericListOf('DOUBLE[]')).toEqual({})
    expect(numericListOf('INTEGER[3]')).toEqual({ length: 3 })
    expect(numericListOf('DECIMAL(9,6)[]')).toEqual({})
    expect(numericListOf('VARCHAR[]')).toBeUndefined()
    expect(numericListOf('DOUBLE[][]')).toBeUndefined()
    expect(numericListOf('STRUCT(a DOUBLE)[]')).toBeUndefined()
    expect(numericListOf('DOUBLE')).toBeUndefined()
  })

  it('reads a list as a vector when every row has the same 2 to 4 items', () => {
    const columns = [
      col('name', 'VARCHAR'),
      col('coordinates', 'DOUBLE[]'),
      col('ragged', 'DOUBLE[]'),
      col('long', 'DOUBLE[]'),
      col('xyz', 'FLOAT[3]'),
      col('tags', 'VARCHAR[]'),
    ]
    const lengths = {
      coordinates: { min: 2, max: 2 },
      ragged: { min: 2, max: 3 },
      long: { min: 6, max: 6 },
    }
    expect(listVectors(columns, lengths, [])).toEqual([
      { name: 'coordinates', width: 2 },
      { name: 'xyz', width: 3 },
    ])
  })

  it('leaves a list that is already a vector, or whose component names are taken', () => {
    const columns = [col('a', 'DOUBLE[2]'), col('b', 'DOUBLE[2]'), col('b_1', 'DOUBLE')]
    expect(listVectors(columns, {}, [{ name: 'a', width: 2 }])).toEqual([])
  })

  it('adds component columns in DOUBLE, and hides them from a table view', () => {
    const vectors = [{ name: 'coordinates', width: 2 }]
    expect(listComponentsSql('"t"', vectors)).toBe(
      'SELECT *, CAST("coordinates"[1] AS DOUBLE) AS "coordinates_0", CAST("coordinates"[2] AS DOUBLE) AS "coordinates_1" FROM "t"'
    )
    const shape = {
      columns: [col('coordinates', 'DOUBLE[]')],
      vectors: [...vectors, { name: 'P', width: 3 }],
    }
    // `P` is a computed vector: its components are the only columns it has.
    expect(listComponentColumns(shape)).toEqual(['coordinates_0', 'coordinates_1'])
  })
})

describe('components of a re-packed vector', () => {
  it('reads item() and swizzles of it as its component columns, in SQL', () => {
    const graph = {
      params: {},
      nodes: [
        { id: 'src', type: 'source' as const, dataset: { ref: 't' } },
        // How compileProgram re-packs a relation's vector.
        { id: 'pack', type: 'attribute' as const, input: 'src', name: 'xy', expr: '[xy_0, xy_1]' },
        {
          id: 'p',
          type: 'attribute' as const,
          input: 'pack',
          name: 'P',
          expr: '[item(xy, 0.0), xy[1], random() * 0.0]',
        },
        {
          id: 'l',
          type: 'layer' as const,
          kind: 'scatter' as const,
          input: 'p',
          channels: { position: 'P' },
        },
      ],
      output: 'l',
    }
    const physical = plan(
      graph as never,
      new Map([
        ['xy_0', 1],
        ['xy_1', 1],
      ]),
      {
        policy: 'auto',
        relation: '"t"',
        caps: targetCaps('deck-webgl2', undefined),
      }
    )
    // random() is SQL-only, so P can only be planned if its components are SQL too.
    expect(physical.assignments.find(a => a.nodeId === 'p')?.engine).toBe('sql')
    expect(physical.sql).toContain('"xy_1"')
  })
})

describe('re-packing a relation’s vectors for a chain', () => {
  it('takes any column name, one that is no regular expression included', () => {
    const shape = {
      columns: ['x', 'v[_0', 'v[_1'].map((name) => ({ name, type: 'num' as const, duckType: 'DOUBLE' })),
      vectors: [{ name: 'v[', width: 2 }],
    }
    const chain = [{ id: 'a', type: 'attribute', input: 'in', name: 'twice', expr: 'x * 2' }] as GraphNode[]
    expect(() => rowwiseSql(chain, 'rel', shape, {}, { params: {} }, 'a test')).not.toThrow()
  })
})

describe('a SQL node’s query', () => {
  const sqlNode = (query: string): SqlNode => ({ id: 'q', type: 'sql', query, inputs: ['src'] })
  const emit = (query: string) => sqlNodeSql(sqlNode(query), ['"__m_src"'], {}).sql

  it('accepts leading line comments, and drops them', () => {
    const query = '-- Busiest routes\n-- one row per pair\n\nSELECT a, b FROM {{input}}'
    expect(emit(query)).toBe('SELECT a, b FROM "__m_src"')
  })

  it('accepts a block comment header, and drops it', () => {
    const query = '/*\n * Busiest routes\n */\nWITH t AS (SELECT * FROM {{input}}) SELECT * FROM t'
    expect(emit(query)).toBe('WITH t AS (SELECT * FROM "__m_src") SELECT * FROM t')
  })

  it('drops a trailing comment, so the query inlines inside parentheses', () => {
    const sql = emit('SELECT a FROM {{input}} -- the last line\n;\n-- done')
    expect(sql).toBe('SELECT a FROM "__m_src"')
    expect(`(${sql})`).toBe('(SELECT a FROM "__m_src")')
  })

  it('keeps comments inside the query, and dashes inside strings and names', () => {
    expect(emit("SELECT 'a -- b' AS \"x--y\" -- note\nFROM {{input}}"))
      .toBe("SELECT 'a -- b' AS \"x--y\" -- note\nFROM \"__m_src\"")
    expect(emit("SELECT 'it''s' AS s /* one */ FROM {{input}}"))
      .toBe("SELECT 'it''s' AS s /* one */ FROM \"__m_src\"")
  })

  it('still refuses a statement that is not a query', () => {
    expect(() => emit('-- clean up\nDROP TABLE t')).toThrow(/must be a single SELECT/)
    expect(() => emit('-- nothing here')).toThrow(/must be a single SELECT/)
  })
})
