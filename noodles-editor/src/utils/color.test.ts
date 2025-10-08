import { describe, expect, it } from 'vitest'
import { colorToHex, hexToColor } from './color'

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
