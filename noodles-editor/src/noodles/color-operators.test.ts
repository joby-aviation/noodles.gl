import { describe, expect, it } from 'vitest'
import { CombineRGBAOp, SplitRGBAOp } from './operators'

describe('SplitRGBAOp', () => {
  it('splits a hex color into 0-255 channels', () => {
    const op = new SplitRGBAOp('/split-rgba')
    expect(op.execute({ color: '#ff800040' })).toEqual({ r: 255, g: 128, b: 0, a: 64 })
  })

  it('splits accessor colors per item', () => {
    const op = new SplitRGBAOp('/split-rgba')
    op.inputs.color.setValue((d: { c: string }) => d.c)
    const { r, a } = op.execute(op.data)
    expect((r as (d: unknown) => number)({ c: '#10203040' })).toBe(16)
    expect((a as (d: unknown) => number)({ c: '#102030' })).toBe(255)
  })
})

describe('CombineRGBAOp', () => {
  it('defaults to an opaque color', () => {
    const op = new CombineRGBAOp('/combine-rgba')
    expect(op.execute(op.data)).toEqual({ color: '#000000ff' })
  })

  it('rounds and clamps channels to valid hex', () => {
    const op = new CombineRGBAOp('/combine-rgba')
    expect(op.execute({ r: 127.6, g: 300, b: -2, a: 255 })).toEqual({ color: '#80ff00ff' })
  })

  it('rounds accessor channels', () => {
    const op = new CombineRGBAOp('/combine-rgba')
    const { color } = op.execute({ r: (d: { v: number }) => d.v, g: 0, b: 0, a: 255 })
    expect((color as (d: unknown) => string)({ v: 15.4 })).toBe('#0f0000ff')
  })
})
