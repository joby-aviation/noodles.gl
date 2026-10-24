import { describe, expect, it } from 'vitest'
import { SplitRGBAOp } from './operators'

describe('SplitRGBAOp', () => {
  it('splits a hex color into 0-255 channels', () => {
    const op = new SplitRGBAOp('/split-rgba')
    expect(op.execute({ color: '#ff800040' })).toEqual({ r: 255, g: 128, b: 0, a: 64 })
  })

  it('splits accessor colors per item', () => {
    const op = new SplitRGBAOp('/split-rgba')
    const { r, a } = op.execute({ color: (d: { c: string }) => d.c })
    expect((r as (d: unknown) => number)({ c: '#10203040' })).toBe(16)
    expect((a as (d: unknown) => number)({ c: '#102030' })).toBe(255)
  })
})
