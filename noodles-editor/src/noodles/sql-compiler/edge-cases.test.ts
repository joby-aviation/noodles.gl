import * as duckdb from '@duckdb/duckdb-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompilableNode } from './compiler'
import { collectSubgraph, compile } from './compiler'
import { collectParamValues, execute, PreparedPipeline, setDuckDbInstance } from './executor'
import {
  classifyRef,
  extractOperatorId,
  parseDuckDbSQL,
  parseMustacheRefs,
} from './mustache-parser'
import type { ParamSlot } from './types'
import { escapeIdentifier, escapeLiteral, operatorIdToAlias } from './utils'

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

describe('Edge Cases: Compiler', () => {
  it('handles empty node list', () => {
    expect(() => compile([])).toThrow()
  })

  it('handles operator IDs with special characters', () => {
    const nodes = [makeNode('/my data (1)/file-source_2', 'File', { url: 'x.csv', format: 'csv' })]
    const result = compile(nodes)
    const alias = result.operatorAliases.get('/my data (1)/file-source_2')!
    // Alias must be a valid SQL identifier (lowercase alphanumeric + underscore)
    expect(alias).toMatch(/^[a-z_][a-z0-9_]*$/)
    // Alias must appear in the SQL
    expect(result.sql).toContain(alias)
  })

  it('handles deeply nested operator paths', () => {
    const nodes = [
      makeNode('/container/sub-container/deeply/nested/file', 'File', {
        url: 'x.csv',
        format: 'csv',
      }),
    ]
    const result = compile(nodes)
    expect(result.sql).toBeDefined()
    expect(result.operatorAliases.get('/container/sub-container/deeply/nested/file')).toBeTruthy()
  })

  it('handles operator IDs that are SQL reserved words', () => {
    const reserved = ['/select', '/from', '/where', '/group', '/order', '/join', '/table', '/index']
    for (const id of reserved) {
      const alias = operatorIdToAlias(id)
      expect(alias).not.toBe(id.slice(1))
      expect(alias).toMatch(/_op$/)
    }
  })

  it('handles duplicate upstream references', () => {
    // An operator referencing the same upstream twice (self-join pattern)
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/self-join', 'Join', { leftKey: 'id', rightKey: 'parent_id', joinType: 'left' }, [
        '/data',
        '/data',
      ]),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('LEFT JOIN')
  })

  it('handles empty string field values', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/filter', 'FilterOp', { columnName: '', condition: 'equals', value: '' }, [
        '/data',
      ]),
    ]
    // Should not throw, even with empty column name
    const result = compile(nodes)
    expect(result.sql).toBeDefined()
  })

  it('handles very long operator chains (20 nodes)', () => {
    const nodes: CompilableNode[] = [
      makeNode('/source', 'File', { url: 'data.csv', format: 'csv' }),
    ]
    for (let i = 0; i < 19; i++) {
      const prev = nodes[nodes.length - 1].id
      nodes.push(
        makeNode(
          `/filter-${i}`,
          'FilterOp',
          {
            columnName: 'x',
            condition: 'greater than',
            value: String(i),
          },
          [prev]
        )
      )
    }
    const result = compile(nodes)
    expect(result.sql.split('AS (').length).toBe(21) // 20 CTEs + 1 from split
    expect(result.paramSlots.length).toBe(20) // 1 url + 19 filter values
  })

  it('handles FilterOp with all condition types', () => {
    const conditions = [
      'equals',
      'not equals',
      'greater than',
      'less than',
      'greater than or equal to',
      'less than or equal to',
      'contains',
      'not contains',
      'in',
      'not in',
    ]
    for (const condition of conditions) {
      const nodes = [
        makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
        makeNode('/f', 'FilterOp', { columnName: 'col', condition, value: 'test,a,b' }, ['/data']),
      ]
      const result = compile(nodes)
      expect(result.sql).toBeDefined()
      // IN/NOT IN should produce multiple params for the value list
      if (condition === 'in' || condition === 'not in') {
        expect(result.sql).toContain('IN (')
      }
    }
  })

  it('handles GroupByOp with no aggregations', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode('/group', 'GroupBy', { groupByColumns: 'department', aggregations: '' }, ['/data']),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('"department"')
  })

  it('handles GroupByOp with multiple aggregations', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode(
        '/group',
        'GroupBy',
        {
          groupByColumns: 'dept,region',
          aggregations:
            'sum(sales) as total; avg(price) as avg_price; count(*) as n; min(date) as first; max(date) as last',
        },
        ['/data']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('SUM("sales") AS "total"')
    expect(result.sql).toContain('AVG("price") AS "avg_price"')
    expect(result.sql).toContain('COUNT(*) AS "n"')
    expect(result.sql).toContain('MIN("date") AS "first"')
    expect(result.sql).toContain('MAX("date") AS "last"')
  })

  it('handles WindowOp with all function types', () => {
    const fns = ['row_number', 'rank', 'dense_rank', 'lag', 'lead', 'sum', 'avg', 'min', 'max']
    for (const fn of fns) {
      const nodes = [
        makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
        makeNode(
          '/w',
          'Window',
          {
            column: 'val',
            function: fn,
            partitionBy: 'grp',
            orderBy: 'ts',
            order: 'asc',
            windowSize: 3,
            outputColumn: 'result',
          },
          ['/data']
        ),
      ]
      const result = compile(nodes)
      expect(result.sql).toContain('OVER')
      expect(result.sql).toContain('"result"')
    }
  })

  it('handles StringTransformOp with all operations', () => {
    const ops = [
      'upper',
      'lower',
      'trim',
      'title',
      'length',
      'reverse',
      'hash_md5',
      'regex_extract',
      'regex_replace',
    ]
    for (const operation of ops) {
      const nodes = [
        makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
        makeNode(
          '/s',
          'StringTransform',
          {
            column: 'name',
            operation,
            pattern: '\\d+',
            replacement: 'X',
            outputColumn: 'result',
          },
          ['/data']
        ),
      ]
      const result = compile(nodes)
      expect(result.sql).toContain('"result"')
      if (operation === 'regex_extract' || operation === 'regex_replace') {
        expect(result.paramSlots.some(s => s.fieldPath.includes('pattern'))).toBe(true)
      }
    }
  })

  it('handles FillNullsOp with all strategies', () => {
    const strategies = ['forward', 'backward', 'constant']
    for (const strategy of strategies) {
      const nodes = [
        makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
        makeNode(
          '/fill',
          'FillNulls',
          {
            column: 'val',
            strategy,
            constantValue: '0',
            orderBy: 'ts',
          },
          ['/data']
        ),
      ]
      const result = compile(nodes)
      expect(result.sql).toContain('COALESCE')
      if (strategy === 'constant') {
        expect(result.paramSlots.some(s => s.fieldPath.includes('constantValue'))).toBe(true)
      }
    }
  })

  it('handles column names with special characters', () => {
    const nodes = [
      makeNode('/data', 'File', { url: 'x.csv', format: 'csv' }),
      makeNode(
        '/f',
        'FilterOp',
        {
          columnName: 'column with spaces & "quotes"',
          condition: 'equals',
          value: 'test',
        },
        ['/data']
      ),
    ]
    const result = compile(nodes)
    expect(result.sql).toContain('"column with spaces & ""quotes"""')
  })

  it('handles JoinOp with all join types', () => {
    const types = ['inner', 'left', 'right', 'full', 'cross']
    for (const joinType of types) {
      const nodes = [
        makeNode('/a', 'File', { url: 'a.csv', format: 'csv' }),
        makeNode('/b', 'File', { url: 'b.csv', format: 'csv' }),
        makeNode('/j', 'Join', { leftKey: 'id', rightKey: 'id', joinType }, ['/a', '/b']),
      ]
      const result = compile(nodes)
      if (joinType === 'cross') {
        expect(result.sql).toContain('CROSS JOIN')
      } else {
        expect(result.sql).toContain(`${joinType.toUpperCase()} JOIN`)
      }
    }
  })
})

describe('Edge Cases: collectSubgraph', () => {
  it('returns empty when sink is not compilable', () => {
    const nodes = new Map<string, CompilableNode>([['/code', makeNode('/code', 'CodeOp', {})]])
    const result = collectSubgraph('/code', id => nodes.get(id))
    expect(result).toHaveLength(0)
  })

  it('returns empty when upstream is not compilable', () => {
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

  it('returns partial chain when mid-chain is non-compilable', () => {
    const nodes = new Map<string, CompilableNode>([
      ['/file', makeNode('/file', 'File', { url: 'x.csv', format: 'csv' })],
      ['/code', makeNode('/code', 'CodeOp', {})],
      [
        '/filter',
        makeNode('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }, [
          '/code',
        ]),
      ],
    ])
    // filter depends on code (non-compilable), so chain breaks
    const result = collectSubgraph('/filter', id => nodes.get(id))
    expect(result).toHaveLength(0)
  })

  it('handles missing node references gracefully', () => {
    const nodes = new Map<string, CompilableNode>([
      [
        '/filter',
        makeNode('/filter', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }, [
          '/missing',
        ]),
      ],
    ])
    const result = collectSubgraph('/filter', id => nodes.get(id))
    expect(result).toHaveLength(0)
  })

  it('handles circular references without infinite loop', () => {
    const nodes = new Map<string, CompilableNode>([
      [
        '/a',
        makeNode('/a', 'FilterOp', { columnName: 'x', condition: 'equals', value: '1' }, ['/b']),
      ],
      [
        '/b',
        makeNode('/b', 'FilterOp', { columnName: 'y', condition: 'equals', value: '2' }, ['/a']),
      ],
    ])
    // Should terminate, not infinite loop
    const result = collectSubgraph('/a', id => nodes.get(id))
    // Can't build a valid chain from circular deps
    expect(result).toBeDefined()
  })
})

describe('Edge Cases: Utils', () => {
  it('operatorIdToAlias handles numeric-prefixed results', () => {
    expect(operatorIdToAlias('/123-data')).toMatch(/^op_/)
  })

  it('operatorIdToAlias handles empty string', () => {
    const alias = operatorIdToAlias('')
    expect(alias).toMatch(/^op_/)
  })

  it('escapeIdentifier handles empty string', () => {
    expect(escapeIdentifier('')).toBe('""')
  })

  it('escapeIdentifier handles quotes', () => {
    expect(escapeIdentifier('col"name')).toBe('"col""name"')
  })

  it('escapeLiteral handles all types', () => {
    expect(escapeLiteral(null)).toBe('NULL')
    expect(escapeLiteral(undefined)).toBe('NULL')
    expect(escapeLiteral(42)).toBe('42')
    expect(escapeLiteral(3.14)).toBe('3.14')
    expect(escapeLiteral(true)).toBe('TRUE')
    expect(escapeLiteral(false)).toBe('FALSE')
    expect(escapeLiteral("it's")).toBe("'it''s'")
    expect(escapeLiteral('')).toBe("''")
  })
})

describe('Edge Cases: Mustache Parser', () => {
  it('handles nested braces', () => {
    const refs = parseMustacheRefs('{{/op.par.value}}')
    expect(refs).toHaveLength(1)
    expect(refs[0].path).toBe('/op.par.value')
  })

  it('handles adjacent refs', () => {
    const refs = parseMustacheRefs('{{/a.par.x}}{{/b.par.y}}')
    expect(refs).toHaveLength(2)
  })

  it('handles refs in complex SQL', () => {
    const sql = `
      SELECT a.*, b.name
      FROM {{/flights.out.data}} a
      LEFT JOIN {{/airports.out.data}} b
      ON a.code = b.code
      WHERE a.delay > {{/threshold.par.value}}
      ORDER BY a.delay DESC
      LIMIT {{/limit.par.value}}
    `
    const refs = parseMustacheRefs(sql)
    expect(refs).toHaveLength(4)
  })

  it('handles paths with hyphens and numbers', () => {
    expect(extractOperatorId('/my-op-1.par.value')).toBe('/my-op-1')
    expect(extractOperatorId('/data-2.out.result')).toBe('/data-2')
  })

  it('classifyRef handles edge cases', () => {
    expect(classifyRef('/op')).toBe('data')
    expect(classifyRef('./op')).toBe('data')
    expect(classifyRef('/op.par.x')).toBe('param')
    expect(classifyRef('/nested/op.par.x')).toBe('param')
    expect(classifyRef('/op.out.data')).toBe('data')
  })

  it('parseDuckDbSQL handles SQL with no refs', () => {
    const result = parseDuckDbSQL('SELECT 1 AS one', 1, () => undefined)
    expect(result.sql).toBe('SELECT 1 AS one')
    expect(result.params).toHaveLength(0)
    expect(result.upstreamRefs).toHaveLength(0)
  })

  it('parseDuckDbSQL handles unresolvable data refs', () => {
    const result = parseDuckDbSQL('SELECT * FROM {{/unknown}}', 1, () => undefined)
    // If the alias can't be resolved, the ref stays as-is? Or becomes undefined?
    // Current implementation: resolveOperatorAlias returns undefined, ref not replaced
    expect(result.upstreamRefs).toHaveLength(0)
  })
})

describe('Edge Cases: Executor', () => {
  beforeAll(async () => {
    const DUCKDB_BUNDLES = await duckdb.selectBundle({
      mvp: {
        mainModule: new URL(
          '@aspect-build/aspect-duckdb-wasm/dist/duckdb-mvp.wasm',
          import.meta.url
        ).href,
        mainWorker: new URL(
          '@aspect-build/aspect-duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
          import.meta.url
        ).href,
      },
      eh: {
        mainModule: new URL('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm', import.meta.url).href,
        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js', import.meta.url)
          .href,
      },
    })
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const worker = new Worker(DUCKDB_BUNDLES.mainWorker!)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(DUCKDB_BUNDLES.mainModule)
    setDuckDbInstance(db)

    const conn = await db.connect()
    await conn.query(`
      CREATE TABLE edge_data AS SELECT * FROM (VALUES
        ('Alice', 30, 'Eng', 90000, NULL),
        ('Bob', NULL, 'Mkt', 60000, 'NY'),
        ('Charlie', 35, NULL, NULL, 'SF'),
        (NULL, 28, 'Eng', 65000, 'LA'),
        ('Eve', 32, 'Eng', 95000, '')
      ) AS t(name, age, department, salary, city)
    `)
    await conn.query(`
      CREATE TABLE large_data AS
      SELECT
        i AS id,
        'name_' || i AS name,
        (i % 10) AS category,
        random() * 1000 AS value
      FROM generate_series(1, 10000) AS t(i)
    `)
    await conn.close()
  })

  it('handles NULL values in filter', async () => {
    const result = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM edge_data WHERE age IS NOT NULL) SELECT * FROM src',
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    expect(result.toArray()).toHaveLength(4)
  })

  it('handles empty result sets', async () => {
    const result = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM edge_data WHERE age > $1) SELECT * FROM src',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
        operatorAliases: new Map(),
      },
      [1000]
    )
    expect(result.toArray()).toHaveLength(0)
    expect(result.table.numRows).toBe(0)
  })

  it('handles NULL parameters', async () => {
    const result = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM edge_data WHERE name = $1 OR $1 IS NULL) SELECT * FROM src',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'string' }],
        operatorAliases: new Map(),
      },
      [null]
    )
    // NULL = NULL is FALSE in SQL, but $1 IS NULL is TRUE
    expect(result.toArray().length).toBeGreaterThan(0)
  })

  it('handles large datasets (10K rows)', async () => {
    const start = performance.now()
    const result = await execute(
      {
        sql: `WITH
        src AS (SELECT * FROM large_data),
        filtered AS (SELECT * FROM src WHERE category IN (1, 3, 5, 7)),
        sorted AS (SELECT * FROM filtered ORDER BY value DESC),
        top AS (SELECT * FROM sorted LIMIT 100)
      SELECT * FROM top`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const elapsed = performance.now() - start
    expect(result.toArray()).toHaveLength(100)
    expect(elapsed).toBeLessThan(500) // Should be fast
  })

  it('handles string parameters with SQL injection attempts', async () => {
    const result = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM edge_data WHERE name = $1) SELECT * FROM src',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'string' }],
        operatorAliases: new Map(),
      },
      ["'; DROP TABLE edge_data; --"]
    )
    // Prepared statements prevent injection — should just return empty result
    expect(result.toArray()).toHaveLength(0)
  })

  it('handles numeric overflow gracefully', async () => {
    const result = await execute(
      {
        sql: 'WITH src AS (SELECT * FROM edge_data WHERE salary > $1) SELECT * FROM src',
        paramSlots: [{ index: 1, fieldPath: '/f.value', type: 'number' }],
        operatorAliases: new Map(),
      },
      [Number.MAX_SAFE_INTEGER]
    )
    expect(result.toArray()).toHaveLength(0)
  })

  it('handles COALESCE with NULLs', async () => {
    const result = await execute(
      {
        sql: `WITH src AS (SELECT *, COALESCE(city, department, 'unknown') AS location FROM edge_data) SELECT * FROM src`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = result.toArray()
    // Charlie has NULL department but has city 'SF'
    const charlie = rows.find((r: any) => r.name === 'Charlie')
    expect(charlie!.location).toBe('SF')
    // Alice has NULL city but has department 'Eng'
    const alice = rows.find((r: any) => r.name === 'Alice')
    expect(alice!.location).toBe('Eng')
  })

  it('handles window functions with NULLs', async () => {
    const result = await execute(
      {
        sql: `WITH src AS (
        SELECT *, LAG(salary) OVER (ORDER BY name) AS prev_salary FROM edge_data
      ) SELECT * FROM src`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = result.toArray()
    expect(rows).toHaveLength(5)
    // First row should have NULL prev_salary
    expect(rows[0].prev_salary).toBeNull()
  })

  it('PreparedPipeline handles rapid parameter changes (stress test)', async () => {
    const pipeline = new PreparedPipeline({
      sql: 'WITH src AS (SELECT * FROM large_data WHERE value > $1 AND category = $2) SELECT COUNT(*) as n FROM src',
      paramSlots: [
        { index: 1, fieldPath: '/threshold.value', type: 'number' },
        { index: 2, fieldPath: '/cat.value', type: 'number' },
      ],
      operatorAliases: new Map(),
    })

    try {
      const start = performance.now()
      for (let i = 0; i < 60; i++) {
        // Simulate 60 frames of animation
        const threshold = (i / 60) * 1000
        const category = i % 10
        const result = await pipeline.execute([threshold, category])
        expect(result.table.numRows).toBe(1)
      }
      const elapsed = performance.now() - start
      const perFrame = elapsed / 60
      // Must be under 16ms per frame for 60fps
      expect(perFrame).toBeLessThan(16)
    } finally {
      await pipeline.close()
    }
  })

  it('handles GROUP BY with NULL grouping keys', async () => {
    const result = await execute(
      {
        sql: `WITH src AS (
        SELECT department, COUNT(*) as n FROM edge_data GROUP BY department
      ) SELECT * FROM src ORDER BY department`,
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const rows = result.toArray()
    // Should include NULL department as its own group
    const nullGroup = rows.find((r: any) => r.department === null)
    expect(nullGroup).toBeDefined()
  })

  it('collectParamValues handles deeply nested field paths', () => {
    const slots: ParamSlot[] = [
      { index: 1, fieldPath: '/container/sub/op.fieldName', type: 'string' },
    ]
    const values = collectParamValues(slots, path => {
      if (path === '/container/sub/op.fieldName') return 'found'
      return undefined
    })
    expect(values[0]).toBe('found')
  })

  it('Arrow table preserves column types', async () => {
    const result = await execute(
      {
        sql: 'WITH src AS (SELECT name, age, salary FROM edge_data WHERE name IS NOT NULL) SELECT * FROM src',
        paramSlots: [],
        operatorAliases: new Map(),
      },
      []
    )
    const schema = result.table.schema
    expect(schema.fields.length).toBe(3)
    // Verify we get proper column names
    const fieldNames = schema.fields.map(f => f.name)
    expect(fieldNames).toContain('name')
    expect(fieldNames).toContain('age')
    expect(fieldNames).toContain('salary')
  })
})
