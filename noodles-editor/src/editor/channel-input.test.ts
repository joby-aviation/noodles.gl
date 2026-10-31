import type { ParamDef } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { channelDefault, channelKind, isChannel } from './channel-input'

const def = (extra: Partial<ParamDef>): ParamDef => ({
  name: 'color',
  label: 'Color',
  kind: 'expr',
  default: '',
  ...extra,
})

describe('channelKind', () => {
  it('reads a bare name as an attribute', () => {
    expect(channelKind('position')).toBe('attribute')
    expect(channelKind(' magnitude_color ')).toBe('attribute')
  })

  it('reads anything else as a row expression', () => {
    expect(channelKind('ramp(fit(mag, 0, 7, 0, 1))')).toBe('expression')
    expect(channelKind('[lng, lat]')).toBe('expression')
    expect(channelKind('4')).toBe('expression')
  })

  it('reads an empty channel as the default', () => {
    expect(channelKind('')).toBe('default')
    expect(channelKind('  ')).toBe('default')
  })
})

describe('channels', () => {
  it('are expression parameters that read an input', () => {
    expect(isChannel(def({ of: 'in' }))).toBe(true)
    expect(isChannel(def({}))).toBe(false)
    expect(isChannel(def({ kind: 'string', of: 'in' }))).toBe(false)
  })

  it('name what an empty channel uses, from the help', () => {
    expect(channelDefault(def({ help: 'An RGB attribute. Empty uses Fill color.' }))).toBe(
      'default · Fill color'
    )
    expect(channelDefault(def({ help: 'An RGB attribute.' }))).toBe('default')
  })
})
