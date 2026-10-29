import { describe, expect, it } from 'vitest'
import { foldVectors, Vec, vectorColumns } from './plain-rows'

describe('vectors in JS rows', () => {
  const types = new Map([
    ['x', 'DOUBLE'],
    ['magnitude_color_0', 'DOUBLE'],
    ['magnitude_color_1', 'DOUBLE'],
    ['magnitude_color_2', 'DOUBLE'],
    ['position_0', 'DOUBLE'],
    ['position_1', 'DOUBLE'],
    // Not vectors: one component, a gap, text, or a column named as the vector already is
    ['lone_0', 'DOUBLE'],
    ['gap_0', 'DOUBLE'],
    ['gap_2', 'DOUBLE'],
    ['label_0', 'VARCHAR'],
    ['label_1', 'VARCHAR'],
    ['P', 'DOUBLE[]'],
    ['P_0', 'DOUBLE'],
    ['P_1', 'DOUBLE'],
  ])

  it('finds the vectors the planner stores as numbered numeric columns', () => {
    expect(vectorColumns(types)).toEqual([
      { name: 'magnitude_color', width: 3 },
      { name: 'position', width: 2 },
    ])
  })

  it('folds each into one array under its name, which also reads as .x and .r', () => {
    const row = foldVectors(
      { x: 1, magnitude_color_0: 0.1, magnitude_color_1: 0.2, magnitude_color_2: 0.3 },
      [{ name: 'magnitude_color', width: 3 }]
    )
    expect(Object.keys(row)).toEqual(['x', 'magnitude_color'])
    const color = row.magnitude_color as Vec & { r: number; b: number; x: number }
    expect(color).toBeInstanceOf(Vec)
    expect([color[0], color.r, color.x, color.b]).toEqual([0.1, 0.1, 0.1, 0.3])
    // Written back, it is a list
    expect(JSON.stringify(row)).toBe('{"x":1,"magnitude_color":[0.1,0.2,0.3]}')
  })
})
