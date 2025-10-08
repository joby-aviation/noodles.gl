import { describe, expect, it } from 'vitest'

import { memoize } from './memoize'

describe('memoize', () => {
  it('should memoize the result of a function', () => {
    const fn = ({ a }: { a: number }) => Math.random() * a
    const memoizedFn = memoize(fn)

    const args = { a: 2 }
    expect(memoizedFn.cache.has(args)).toBe(false)

    const result1 = memoizedFn(args)
    const result2 = memoizedFn(args)
    expect(result1).toEqual(result2)
    expect(memoizedFn.cache.has(args)).toBe(true)
  })

  it('should not cache results for different parameters', () => {
    const fn = ({ a }: { a: number }) => Math.random() * a
    const memoizedFn = memoize(fn)

    const args1 = { a: 2 }
    const args2 = { a: 2 }
    expect(memoizedFn.cache.has(args1)).toBe(false)

    const result1 = memoizedFn(args1)
    expect(memoizedFn.cache.has(args2)).toBe(false)

    const result2 = memoizedFn(args2)
    expect(result1).not.toEqual(result2)
  })
})
