import { OPERATOR_INDEX } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import {
  addressable,
  colorValue,
  compoundsFor,
  compoundsOf,
  rampExpression,
} from './compound-params'

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

describe('compoundsFor', () => {
  it('leaves a numeric weight channel out of the color controls', () => {
    expect(compoundsOf(op('hexagon')).colors.map(c => c.channel)).not.toContain('colorWeight')
    expect(compoundsOf(op('grid-layer')).colors.map(c => c.channel)).not.toContain('colorWeight')
  })

  it('keeps referenced or expression-driven units on their own row', () => {
    const linked = compoundsFor(op('scatter'), { radiusUnits: { ref: 'other/radiusUnits' } })
    expect(linked.units).toEqual([])
    expect(linked.absorbed.has('radiusUnits')).toBe(false)
    expect(compoundsFor(op('scatter'), { radiusUnits: 'meters' }).absorbed.has('radiusUnits')).toBe(
      true
    )
  })

  it('draws the ramp in the color control only while its Ramp mode is the only user', () => {
    const inRamp = compoundsFor(op('scatter'), { color: rampExpression('mag', 0, 7) })
    expect(inRamp.rampIn).toBe('color')
    expect(inRamp.absorbed.has('ramp')).toBe(true)

    // Another channel reads the ramp too: it keeps its own row
    const shared = compoundsFor(op('scatter'), {
      color: rampExpression('mag', 0, 7),
      radius: 'ramp(mag)[0]',
    })
    expect(shared.rampIn).toBeUndefined()
    expect(shared.absorbed.has('ramp')).toBe(false)

    // A custom color expression calling ramp() keeps it on its own row as well
    const custom = compoundsFor(op('scatter'), { color: 'ramp(fit(sqrt(mag), 0, 3, 0, 1))' })
    expect(custom.absorbed.has('ramp')).toBe(false)

    // Nothing reads the ramp: no row for it
    expect(compoundsFor(op('scatter'), {}).absorbed.has('ramp')).toBe(true)
  })
})

describe('addressable', () => {
  it('accepts names an expression can use as written', () => {
    expect(addressable('Magnitude')).toBe(true)
    expect(addressable('total_cost')).toBe(true)
    expect(addressable('total-cost')).toBe(false)
    expect(addressable('2021 sales')).toBe(false)
  })
})
