import { describe, expect, it } from 'vitest'
import {
  classifyRef,
  extractOperatorId,
  parseDuckDbSQL,
  parseMustacheRefs,
} from './mustache-parser'

describe('parseMustacheRefs', () => {
  it('extracts simple refs', () => {
    const refs = parseMustacheRefs('SELECT * FROM data WHERE x > {{/threshold.par.value}}')
    expect(refs).toHaveLength(1)
    expect(refs[0].path).toBe('/threshold.par.value')
  })

  it('extracts multiple refs', () => {
    const refs = parseMustacheRefs(
      'SELECT * FROM {{/source.out.data}} WHERE x > {{/threshold.par.value}}'
    )
    expect(refs).toHaveLength(2)
    expect(refs[0].path).toBe('/source.out.data')
    expect(refs[1].path).toBe('/threshold.par.value')
  })

  it('handles refs with relative paths', () => {
    const refs = parseMustacheRefs('{{./sibling.par.value}}')
    expect(refs).toHaveLength(1)
    expect(refs[0].path).toBe('./sibling.par.value')
  })

  it('handles refs with spaces around path', () => {
    const refs = parseMustacheRefs('{{ /op.par.x }}')
    expect(refs).toHaveLength(1)
    expect(refs[0].path).toBe('/op.par.x')
  })

  it('returns empty for no refs', () => {
    expect(parseMustacheRefs('SELECT 1')).toHaveLength(0)
  })
})

describe('classifyRef', () => {
  it('classifies .par. paths as params', () => {
    expect(classifyRef('/op.par.value')).toBe('param')
    expect(classifyRef('/nested/op.par.threshold')).toBe('param')
  })

  it('classifies .inputs. paths as params', () => {
    expect(classifyRef('/op.inputs.value')).toBe('param')
  })

  it('classifies .out. paths as data', () => {
    expect(classifyRef('/source.out.data')).toBe('data')
  })

  it('classifies bare operator paths as data', () => {
    expect(classifyRef('/source')).toBe('data')
    expect(classifyRef('./sibling')).toBe('data')
  })
})

describe('extractOperatorId', () => {
  it('extracts from parameter paths', () => {
    expect(extractOperatorId('/threshold.par.value')).toBe('/threshold')
  })

  it('extracts from output paths', () => {
    expect(extractOperatorId('/source.out.data')).toBe('/source')
  })

  it('returns bare paths as-is', () => {
    expect(extractOperatorId('/source')).toBe('/source')
  })

  it('handles relative paths', () => {
    expect(extractOperatorId('./sibling.par.x')).toBe('./sibling')
  })
})

describe('parseDuckDbSQL', () => {
  it('replaces value refs with parameter placeholders', () => {
    const result = parseDuckDbSQL(
      "SELECT * FROM read_csv_auto('data.csv') WHERE age > {{/threshold.par.value}}",
      1,
      () => undefined
    )
    expect(result.sql).toBe("SELECT * FROM read_csv_auto('data.csv') WHERE age > $1")
    expect(result.params).toHaveLength(1)
    expect(result.params[0]).toEqual({ index: 1, path: '/threshold.par.value' })
  })

  it('replaces data refs with CTE aliases', () => {
    const result = parseDuckDbSQL('SELECT * FROM {{/source}} WHERE x = 1', 1, id =>
      id === '/source' ? 'source' : undefined
    )
    expect(result.sql).toBe('SELECT * FROM source WHERE x = 1')
    expect(result.upstreamRefs).toEqual(['/source'])
    expect(result.params).toHaveLength(0)
  })

  it('handles mixed data and value refs', () => {
    const result = parseDuckDbSQL(
      'SELECT * FROM {{/flights.out.data}} WHERE delay > {{/threshold.par.value}} AND airline = {{/config.par.airline}}',
      1,
      id => (id === '/flights' ? 'flights' : undefined)
    )
    expect(result.sql).toContain('FROM flights')
    expect(result.sql).toMatch(/delay > \$\d/)
    expect(result.sql).toMatch(/airline = \$\d/)
    expect(result.params).toHaveLength(2)
    expect(result.upstreamRefs).toEqual(['/flights'])
  })

  it('starts param index from provided value', () => {
    const result = parseDuckDbSQL('SELECT * WHERE x > {{/op.par.value}}', 5, () => undefined)
    expect(result.sql).toContain('$5')
    expect(result.params[0].index).toBe(5)
  })

  it('handles multiple params with incrementing indices', () => {
    const result = parseDuckDbSQL(
      'SELECT * WHERE x > {{/a.par.v1}} AND y < {{/b.par.v2}}',
      3,
      () => undefined
    )
    expect(result.sql).toContain('$3')
    expect(result.sql).toContain('$4')
  })
})
