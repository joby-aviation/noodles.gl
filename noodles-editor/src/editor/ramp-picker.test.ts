import { OPERATOR_INDEX, type ParamDef, RAMP_STOPS } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { isRampParam, rampGradient } from './ramp-picker'

const param = (type: string, name: string) => {
  const def = OPERATOR_INDEX.get(type)?.params.find(p => p.name === name)
  if (!def) throw new Error(`no ${type}.${name}`)
  return def
}

describe('rampGradient', () => {
  it('draws every stop of the planner ramp, evenly spaced', () => {
    const g = rampGradient('viridis')
    expect(g).toMatch(/^linear-gradient\(to right, rgb\(/)
    expect(g?.match(/rgb\(/g)).toHaveLength(RAMP_STOPS.viridis.length)
  })

  it('draws flat bands for a sampled range', () => {
    const g = rampGradient('turbo', 6)
    expect(g?.match(/rgb\(/g)).toHaveLength(6)
    expect(g).toContain('0% 16.6')
  })

  it('draws nothing for an unknown ramp', () => {
    expect(rampGradient('no-such-ramp')).toBeUndefined()
  })
})

describe('isRampParam', () => {
  it('finds the ramp menus of layers and the Color Ramp node', () => {
    expect(isRampParam(param('scatter', 'ramp'))).toBe(true)
    expect(isRampParam(param('color-ramp', 'ramp'))).toBe(true)
  })

  it('leaves other menus alone', () => {
    expect(isRampParam(param('scatter', 'radiusUnits'))).toBe(false)
    const notRamps: ParamDef = {
      name: 'x',
      label: 'X',
      kind: 'menu',
      default: 'a',
      options: [{ value: 'a', label: 'A' }],
    }
    expect(isRampParam(notRamps)).toBe(false)
  })
})
