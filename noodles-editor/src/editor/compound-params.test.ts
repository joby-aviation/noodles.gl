import { OPERATOR_INDEX } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { colorValue, compoundsOf, rampExpression } from './compound-params'

const op = (type: string) => {
  const def = OPERATOR_INDEX.get(type)
  if (!def) throw new Error(`no operator ${type}`)
  return def
}

describe('compoundsOf', () => {
  it('pairs a scale with its units, and a size with its units', () => {
    expect(compoundsOf(op('scatter')).units).toEqual([
      { value: 'radiusScale', units: 'radiusUnits' },
    ])
    expect(compoundsOf(op('text')).units).toEqual([{ value: 'size', units: 'sizeUnits' }])
  })

  it('groups a color channel with the solid color its help names, and the ramp', () => {
    expect(compoundsOf(op('scatter')).colors).toEqual([
      { channel: 'color', solid: 'fillColor', ramp: 'ramp' },
    ])
    expect(compoundsOf(op('text')).colors[0]).toMatchObject({
      channel: 'color',
      solid: 'textColor',
    })
  })

  it('pairs each of a polygon layer’s color channels with its own solid color', () => {
    expect(compoundsOf(op('polygon')).colors).toEqual([
      { channel: 'color', solid: 'fillColor', ramp: 'ramp' },
      { channel: 'lineColorChannel', solid: 'lineColor', ramp: 'ramp' },
    ])
  })

  it('falls back to the first Style color when the channel has no help', () => {
    expect(compoundsOf(op('path')).colors[0]).toMatchObject({
      channel: 'color',
      solid: 'lineColor',
    })
  })

  it('absorbs the units menus, solid colors and the ramp into their controls', () => {
    const { absorbed } = compoundsOf(op('scatter'))
    expect([...absorbed].sort()).toEqual(['fillColor', 'radiusUnits', 'ramp'])
  })
})

describe('colorValue', () => {
  it('reads an empty channel as solid, and a bare name as an attribute', () => {
    expect(colorValue('')).toEqual({ mode: 'solid' })
    expect(colorValue('magnitude_color')).toEqual({ mode: 'attribute', column: 'magnitude_color' })
  })

  it('reads the ramp form back, and leaves other expressions as written', () => {
    expect(colorValue(rampExpression('Magnitude', 0, 7.5))).toEqual({
      mode: 'ramp',
      column: 'Magnitude',
      min: 0,
      max: 7.5,
    })
    expect(colorValue('ramp(fit(sqrt(mag), 0, 3, 0, 1))')).toEqual({ mode: 'expression' })
    expect(colorValue('[1, 0, 0]')).toEqual({ mode: 'expression' })
  })
})
