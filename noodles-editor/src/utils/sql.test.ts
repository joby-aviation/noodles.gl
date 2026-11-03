import { describe, expect, it } from 'vitest'
import { sqlIdentifier, sqlLiteral } from './sql'

describe('sqlLiteral', () => {
  it('wraps plain values in single quotes', () => {
    expect(sqlLiteral('https://example.com/a.parquet')).toBe("'https://example.com/a.parquet'")
  })

  it('doubles embedded single quotes', () => {
    expect(sqlLiteral("/data/o'hare.parquet")).toBe("'/data/o''hare.parquet'")
  })

  it('neutralizes an attempted statement break', () => {
    expect(sqlLiteral("x'); DROP TABLE t; --")).toBe("'x''); DROP TABLE t; --'")
  })

  it('leaves double quotes alone', () => {
    expect(sqlLiteral('say "hi"')).toBe('\'say "hi"\'')
  })
})

describe('sqlIdentifier', () => {
  it('wraps plain names in double quotes', () => {
    expect(sqlIdentifier('geometry')).toBe('"geometry"')
  })

  it('doubles embedded double quotes', () => {
    expect(sqlIdentifier('geo"m')).toBe('"geo""m"')
  })

  it('preserves names that need quoting to be valid', () => {
    expect(sqlIdentifier('my column')).toBe('"my column"')
    expect(sqlIdentifier('SELECT')).toBe('"SELECT"')
  })
})
