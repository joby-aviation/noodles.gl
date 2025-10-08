import { describe, expect, it } from 'vitest'
import { pick } from './pick'

describe('pick', () => {
  it('should return an object with only the specified keys', () => {
    const obj = { a: 1, b: 2, c: 3 }
    const result = pick(obj, ['a', 'c'])
    expect(result).toEqual({ a: 1, c: 3 })
  })

  it('should return an empty object if input is undefined', () => {
    const result = pick(undefined, ['a', 'b'])
    expect(result).toEqual({})
  })

  it('should return undefined for keys not present in the object', () => {
    const obj = { a: 1 }
    const result = pick(obj, ['a', 'b'])
    expect(result).toEqual({ a: 1 })
  })
})
