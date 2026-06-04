import { describe, expect, it } from 'vitest'
import {
  attributeColumnName,
  canTranspileToSql,
  expressionToSql,
  parseArrayExpression,
} from './expression-to-sql'

describe('expressionToSql', () => {
  it('transpiles simple column access', () => {
    expect(expressionToSql('d.latitude')).toEqual({
      sql: 'latitude',
      isTranslatable: true,
    })
  })

  it('transpiles column with multiplication', () => {
    expect(expressionToSql('d.value * 100')).toEqual({
      sql: '(value * 100)',
      isTranslatable: true,
    })
  })

  it('transpiles column with division', () => {
    expect(expressionToSql('d.price / 1000')).toEqual({
      sql: '(price / 1000)',
      isTranslatable: true,
    })
  })

  it('transpiles two columns addition', () => {
    expect(expressionToSql('d.x + d.y')).toEqual({
      sql: '(x + y)',
      isTranslatable: true,
    })
  })

  it('transpiles Math.sqrt', () => {
    expect(expressionToSql('Math.sqrt(d.value)')).toEqual({
      sql: 'SQRT(value)',
      isTranslatable: true,
    })
  })

  it('transpiles Math.abs', () => {
    expect(expressionToSql('Math.abs(d.temperature)')).toEqual({
      sql: 'ABS(temperature)',
      isTranslatable: true,
    })
  })

  it('transpiles Math.floor', () => {
    expect(expressionToSql('Math.floor(d.value)')).toEqual({
      sql: 'FLOOR(value)',
      isTranslatable: true,
    })
  })

  it('transpiles numeric constant', () => {
    expect(expressionToSql('0')).toEqual({
      sql: '0',
      isTranslatable: true,
    })
    expect(expressionToSql('123.456')).toEqual({
      sql: '123.456',
      isTranslatable: true,
    })
  })

  it('returns not translatable for complex expressions', () => {
    expect(expressionToSql('Math.random()')).toEqual({
      sql: '',
      isTranslatable: false,
    })
    expect(expressionToSql('d.value > 100 ? 1 : 0')).toEqual({
      sql: '',
      isTranslatable: false,
    })
    expect(expressionToSql('op("/other").value')).toEqual({
      sql: '',
      isTranslatable: false,
    })
  })

  it('handles whitespace', () => {
    expect(expressionToSql('  d.value * 100  ')).toEqual({
      sql: '(value * 100)',
      isTranslatable: true,
    })
  })
})

describe('parseArrayExpression', () => {
  it('parses two-column array', () => {
    const result = parseArrayExpression('[d.lng, d.lat]')
    expect(result.isTranslatable).toBe(true)
    expect(result.columns).toHaveLength(2)
    expect(result.columns[0].sql).toBe('lng')
    expect(result.columns[1].sql).toBe('lat')
  })

  it('parses three-column array with constant', () => {
    const result = parseArrayExpression('[d.lng, d.lat, 0]')
    expect(result.isTranslatable).toBe(true)
    expect(result.columns).toHaveLength(3)
    expect(result.columns[0].sql).toBe('lng')
    expect(result.columns[1].sql).toBe('lat')
    expect(result.columns[2].sql).toBe('0')
  })

  it('parses array with arithmetic', () => {
    const result = parseArrayExpression('[d.x * 100, d.y * 100]')
    expect(result.isTranslatable).toBe(true)
    expect(result.columns).toHaveLength(2)
    expect(result.columns[0].sql).toBe('(x * 100)')
    expect(result.columns[1].sql).toBe('(y * 100)')
  })

  it('returns not translatable if any element is complex', () => {
    const result = parseArrayExpression('[d.lng, Math.random()]')
    expect(result.isTranslatable).toBe(false)
  })

  it('returns not translatable for non-array', () => {
    const result = parseArrayExpression('d.value')
    expect(result.isTranslatable).toBe(false)
  })

  it('handles whitespace in array', () => {
    const result = parseArrayExpression('[  d.lng  ,  d.lat  ,  0  ]')
    expect(result.isTranslatable).toBe(true)
    expect(result.columns).toHaveLength(3)
  })
})

describe('attributeColumnName', () => {
  it('generates correct column names', () => {
    expect(attributeColumnName('position', 0)).toBe('__attr_position_0')
    expect(attributeColumnName('position', 1)).toBe('__attr_position_1')
    expect(attributeColumnName('color', 2)).toBe('__attr_color_2')
  })
})

describe('canTranspileToSql', () => {
  it('returns true for transpilable expressions', () => {
    expect(canTranspileToSql('d.value')).toBe(true)
    expect(canTranspileToSql('d.value * 100')).toBe(true)
    expect(canTranspileToSql('[d.lng, d.lat, 0]')).toBe(true)
    expect(canTranspileToSql('Math.sqrt(d.value)')).toBe(true)
  })

  it('returns false for non-transpilable expressions', () => {
    expect(canTranspileToSql('Math.random()')).toBe(false)
    expect(canTranspileToSql('d.value > 100 ? 1 : 0')).toBe(false)
    expect(canTranspileToSql('[d.x, Math.random()]')).toBe(false)
  })
})
