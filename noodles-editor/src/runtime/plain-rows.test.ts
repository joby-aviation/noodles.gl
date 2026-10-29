import { describe, expect, it } from 'vitest'
import { foldVectors, Vec } from './plain-rows'

describe('vectors in JS rows', () => {
  const color = [{ name: 'magnitude_color', width: 3 }]

  it('folds a known vector’s components into one array under its name, reading .x and .r', () => {
    const row = foldVectors(
      { x: 1, magnitude_color_0: 0.1, magnitude_color_1: 0.2, magnitude_color_2: 0.3 },
      color
    )
    expect(Object.keys(row)).toEqual(['x', 'magnitude_color'])
    const c = row.magnitude_color as Vec & { r: number; b: number; x: number }
    expect(c).toBeInstanceOf(Vec)
    expect([c[0], c.r, c.x, c.b]).toEqual([0.1, 0.1, 0.1, 0.3])
    // Written back, it is a list
    expect(JSON.stringify(row)).toBe('{"x":1,"magnitude_color":[0.1,0.2,0.3]}')
  })

  it('wraps a vector held as a list column, dropping the components generated from it', () => {
    const row = foldVectors(
      {
        magnitude_color: [0.1, 0.2, 0.3],
        magnitude_color_0: 0.1,
        magnitude_color_1: 0.2,
        magnitude_color_2: 0.3,
      },
      color
    )
    expect(Object.keys(row)).toEqual(['magnitude_color'])
    expect((row.magnitude_color as Vec & { g: number }).g).toBe(0.2)
  })

  it('leaves numbered columns the planner doesn’t know as a vector alone', () => {
    const row = { value_0: 1, value_1: 2 }
    expect(foldVectors(row, [])).toEqual(row)
    expect(foldVectors(row, color)).toEqual(row)
  })
})
