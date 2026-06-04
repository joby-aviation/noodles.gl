import { describe, expect, it } from 'vitest'
import type { CompilableNode } from './compiler'
import { collectSubgraph, compile, isCompilable } from './compiler'

function makeNode(
  id: string,
  type: string,
  inputs: Record<string, unknown>,
  upstreamIds: string[] = []
): CompilableNode {
  const inputFields: Record<string, { value: unknown }> = {}
  for (const [key, val] of Object.entries(inputs)) {
    inputFields[key] = { value: val }
  }
  return {
    id,
    type,
    inputs: inputFields,
    getUpstreamDataIds: () => upstreamIds,
  }
}

describe('isCompilable', () => {
  it('returns true for registered operator types', () => {
    expect(isCompilable(makeNode('/f', 'File', { url: 'test.csv', format: 'csv' }))).toBe(true)
    expect(
      isCompilable(makeNode('/f', 'FilterOp', { columnName: 'x', condition: 'equals', value: '5' }))
    ).toBe(true)
    expect(isCompilable(makeNode('/f', 'Sort', { key: 'x', order: 'asc' }))).toBe(true)
  })

  it('returns false for unknown operator types', () => {
    expect(isCompilable(makeNode('/f', 'CodeOp', {}))).toBe(false)
    expect(isCompilable(makeNode('/f', 'ScatterplotLayerOp', {}))).toBe(false)
  })
})

describe('compile', () => {
  it('compiles a single FileOp to a CTE with parameter', () => {
    const nodes = [makeNode('/data', 'File', { url: 'test.csv', format: 'csv' })]
    const result = compile(nodes)
    expect(result.sql).toContain('read_csv_auto($1')
    expect(result.paramSlots).toHaveLength(1)
    expect(result.paramSlots[0].fieldPath).toBe('/data.url')
    expect(result.paramSlots[0].type).toBe('string')
  })

  it('compiles FileOp → FilterOp chain', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'test.csv', format: 'csv' }),
      makeNode(
        '/filter',
        'FilterOp',
        { columnName: 'age', condition: 'greater than', value: '30' },
        ['/data']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('read_csv_auto($1')
    expect(result.sql).toContain('FROM data')
    expect(result.sql).toContain('"age"')
    expect(result.sql).toContain('> $2')
    expect(result.paramSlots).toHaveLength(2)
    expect(result.paramSlots[1].fieldPath).toBe('/filter.value')
  })

  it('compiles FileOp → FilterOp → SortOp chain', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'data.csv', format: 'csv' }),
      makeNode(
        '/filter',
        'FilterOp',
        { columnName: 'score', condition: 'greater than', value: '50' },
        ['/data']
      ),
      makeNode('/sort', 'Sort', { key: 'score', order: 'desc' }, ['/filter']),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('read_csv_auto($1')
    expect(result.sql).toContain('WHERE "score" > $2')
    expect(result.sql).toContain('ORDER BY "score" DESC')
    expect(result.sql).toContain('SELECT * FROM sort')
    expect(result.paramSlots).toHaveLength(2)
  })

  it('compiles SliceOp with numeric parameters', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/slice', 'Slice', { start: 5, end: 20 }, ['/data']),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('LIMIT $2')
    expect(result.sql).toContain('OFFSET $3')
    expect(result.paramSlots[1].fieldPath).toBe('/slice.end')
    expect(result.paramSlots[1].type).toBe('number')
    expect(result.paramSlots[2].fieldPath).toBe('/slice.start')
    expect(result.paramSlots[2].type).toBe('number')
  })

  it('compiles GroupByOp with aggregations', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'sales.csv', format: 'csv' }),
      makeNode(
        '/group',
        'GroupBy',
        {
          groupByColumns: 'region,category',
          aggregations: 'sum(amount) as total; count(*) as n',
        },
        ['/data']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('GROUP BY')
    expect(result.sql).toContain('"region"')
    expect(result.sql).toContain('"category"')
    expect(result.sql).toContain('SUM("amount") AS "total"')
    expect(result.sql).toContain('COUNT(*) AS "n"')
  })

  it('compiles JoinOp with two upstreams', () => {
    const nodes = [
      makeNode('/left', 'File', { url: 'flights.csv', format: 'csv' }),
      makeNode('/right', 'File', { url: 'airports.csv', format: 'csv' }),
      makeNode(
        '/join',
        'Join',
        {
          leftKey: 'airport_code',
          rightKey: 'code',
          joinType: 'left',
        },
        ['/left', '/right']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('LEFT JOIN')
    expect(result.sql).toContain('"airport_code"')
    expect(result.sql).toContain('"code"')
    expect(result.sql).toContain('SELECT * FROM join_op')
  })

  it('compiles UniqueOp with columns', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/unique', 'Unique', { columns: 'name,city' }, ['/data']),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('DISTINCT ON')
    expect(result.sql).toContain('"name"')
    expect(result.sql).toContain('"city"')
  })

  it('compiles UniqueOp without columns (full distinct)', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/unique', 'Unique', { columns: '' }, ['/data']),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('SELECT DISTINCT *')
  })

  it('compiles WindowOp with rolling sum', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode(
        '/window',
        'Window',
        {
          column: 'sales',
          function: 'sum',
          partitionBy: 'region',
          orderBy: 'date',
          order: 'asc',
          windowSize: 7,
          outputColumn: 'rolling_sum',
        },
        ['/data']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('SUM("sales") OVER')
    expect(result.sql).toContain('PARTITION BY "region"')
    expect(result.sql).toContain('ORDER BY "date" ASC')
    expect(result.sql).toContain('6 PRECEDING')
    expect(result.sql).toContain('"rolling_sum"')
  })

  it('compiles CastOp', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/cast', 'Cast', { column: 'age', targetType: 'INTEGER', outputColumn: 'age_int' }, [
        '/data',
      ]),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('CAST("age" AS INTEGER)')
    expect(result.sql).toContain('"age_int"')
  })

  it('compiles StringTransformOp with regex', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode(
        '/str',
        'StringTransform',
        {
          column: 'name',
          operation: 'regex_replace',
          pattern: '\\s+',
          replacement: '_',
          outputColumn: 'clean_name',
        },
        ['/data']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('regexp_replace("name"')
    expect(result.sql).toContain('$2')
    expect(result.sql).toContain('$3')
    expect(result.sql).toContain('"clean_name"')
    expect(result.paramSlots.some(s => s.fieldPath === '/str.pattern')).toBe(true)
    expect(result.paramSlots.some(s => s.fieldPath === '/str.replacement')).toBe(true)
  })

  it('compiles CoalesceOp', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/coal', 'Coalesce', { columns: 'gps_lat,manual_lat', outputColumn: 'latitude' }, [
        '/data',
      ]),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('COALESCE("gps_lat", "manual_lat")')
    expect(result.sql).toContain('"latitude"')
  })

  it('compiles FillNullsOp with forward fill', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode(
        '/fill',
        'FillNulls',
        {
          column: 'temperature',
          strategy: 'forward',
          constantValue: '',
          orderBy: 'timestamp',
        },
        ['/data']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('COALESCE("temperature"')
    expect(result.sql).toContain('LAG("temperature") IGNORE NULLS')
    expect(result.sql).toContain('ORDER BY "timestamp"')
  })

  it('compiles FillNullsOp with constant', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode(
        '/fill',
        'FillNulls',
        {
          column: 'status',
          strategy: 'constant',
          constantValue: 'unknown',
          orderBy: '',
        },
        ['/data']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('COALESCE("status"')
    expect(result.sql).toContain('$2')
    expect(result.paramSlots.some(s => s.fieldPath === '/fill.constantValue')).toBe(true)
  })

  it('compiles FilterOp with contains condition', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/filter', 'FilterOp', { columnName: 'name', condition: 'contains', value: 'air' }, [
        '/data',
      ]),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain("LIKE '%' ||")
    expect(result.sql).toContain("|| '%'")
  })

  it('assigns correct CTE aliases from operator IDs', () => {
    const nodes = [
      makeNode('/my-data-source', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode(
        '/processing/filter-1',
        'FilterOp',
        { columnName: 'x', condition: 'equals', value: '1' },
        ['/my-data-source']
      ),
    ]
    const result = compile(nodes)
    expect(result.operatorAliases.get('/my-data-source')).toBe('my_data_source')
    expect(result.operatorAliases.get('/processing/filter-1')).toBe('processing_filter_1')
  })

  it('handles SQL reserved words in operator IDs', () => {
    const nodes = [makeNode('/select', 'File', { url: 'x.csv', format: 'csv' })]
    const result = compile(nodes)
    expect(result.operatorAliases.get('/select')).toBe('select_op')
  })
})

describe('collectSubgraph', () => {
  it('collects a linear chain in topological order', () => {
    const nodes = new Map<string, CompilableNode>([
      ['/data', makeNode('/data', 'File', { url: 'x.csv', format: 'csv' })],
      [
        '/filter',
        makeNode('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }, [
          '/data',
        ]),
      ],
      ['/sort', makeNode('/sort', 'Sort', { key: 'x', order: 'asc' }, ['/filter'])],
    ])

    const result = collectSubgraph('/sort', id => nodes.get(id))
    expect(result.map(n => n.id)).toEqual(['/data', '/filter', '/sort'])
  })

  it('stops at non-compilable operators', () => {
    const nodes = new Map<string, CompilableNode>([
      ['/code', makeNode('/code', 'CodeOp', {})],
      [
        '/filter',
        makeNode('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }, [
          '/code',
        ]),
      ],
    ])

    const result = collectSubgraph('/filter', id => nodes.get(id))
    expect(result).toHaveLength(0)
  })

  it('collects diamond-shaped subgraphs correctly', () => {
    const nodes = new Map<string, CompilableNode>([
      ['/data', makeNode('/data', 'File', { url: 'x.csv', format: 'csv' })],
      ['/airports', makeNode('/airports', 'File', { url: 'airports.csv', format: 'csv' })],
      [
        '/join',
        makeNode('/join', 'Join', { leftKey: 'code', rightKey: 'id', joinType: 'inner' }, [
          '/data',
          '/airports',
        ]),
      ],
    ])

    const result = collectSubgraph('/join', id => nodes.get(id))
    expect(result.map(n => n.id)).toContain('/data')
    expect(result.map(n => n.id)).toContain('/airports')
    expect(result[result.length - 1].id).toBe('/join')
  })
})
