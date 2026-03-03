import { describe, expect, it } from 'vitest'
import { colorToHex, hexToColor, hexToRgba, rgbaToHex } from './color'

describe('hexToColor', () => {
  it('converts hex to color', () => {
    expect(hexToColor('#ff0000')).toEqual([255, 0, 0, 255])
  })

  it('converts hex to color with alpha', () => {
    expect(hexToColor('#dc000082')).toEqual([220, 0, 0, 130])
  })
})

describe('colorToHex', () => {
  it('converts color to hex', () => {
    expect(colorToHex([255, 0, 0])).toEqual('#ff0000')
  })

  it('converts color to hex with alpha', () => {
    expect(colorToHex([255, 0, 0, 255])).toEqual('#ff0000ff')
  })
})

describe('hexToRgba', () => {
  it('converts hex to rgba object', () => {
    expect(hexToRgba('#ff0000')).toEqual({
      r: 1,
      g: 0,
      b: 0,
      a: 1,
    })
  })

  it('converts hex with alpha to rgba object', () => {
    expect(hexToRgba('#50222221')).toEqual({
      r: 80 / 255,
      g: 34 / 255,
      b: 34 / 255,
      a: 33 / 255,
    })
  })
})

describe('rgbaToHex', () => {
  it('converts rgba object to hex with alpha', () => {
    expect(rgbaToHex({ r: 1, g: 0, b: 0, a: 1 })).toEqual('#ff0000ff')
  })

  it('preserves alpha channel when converting rgba to hex', () => {
    // This test covers the critical bug fix
    // Alpha channel must be preserved in Theatre.js bidirectional sync
    expect(rgbaToHex({ r: 80 / 255, g: 34 / 255, b: 34 / 255, a: 33 / 255 })).toEqual('#50222221')
  })

  it('handles transparent colors', () => {
    expect(rgbaToHex({ r: 1, g: 0, b: 0, a: 0 })).toEqual('#ff000000')
  })

  it('handles semi-transparent colors', () => {
    expect(rgbaToHex({ r: 1, g: 0, b: 0, a: 0.5 })).toEqual('#ff000080')
  })
})
