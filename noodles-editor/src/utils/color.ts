import type { Color } from '@deck.gl/core'
import type { types } from '@theatre/core'

export type RGBA = { r: number; g: number; b: number; a: number }
export type RGBX = { r: number; g: number; b: number; a?: number }
export type Rgba = Parameters<typeof types.rgba>[0] | RGBA

export function colorToRgba([r, g, b, a = 255]: number[] | Color): Rgba {
  return {
    r: r / 255,
    g: g / 255,
    b: b / 255,
    a: a / 255,
  }
}

export function rgbaToColor(
  { r, g, b, a = 1 }: RGBX,
  { alpha = true }: { alpha?: boolean } = { alpha: true }
): Color {
  return [r * 255, g * 255, b * 255, a * 255].map(Math.round).slice(0, alpha ? 4 : 3) as Color
}

export function rgbaToClearColor({ r, g, b, a = 1 }: RGBX): Color {
  return [r, g, b, a]
}

// hex color string in the format #rrggbb or #rrggbbaa
// deck.gl uses alphaRange 255, theatrejs uses 1
export function hexToColor(val: string, alpha = true): Color {
  let hex = val
  if (hex.charAt(0) === '#') {
    hex = hex.slice(1)
  }

  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map(c => c + c)
      .join('')
  }

  if (alpha && hex.length === 6) {
    hex = `${hex}ff` // append alpha if not provided
  }

  if (alpha && hex.length !== 8) {
    throw new Error('Invalid HEX color.')
  }

  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const a = parseInt(hex.slice(6, 8), 16)

  return [r, g, b, a]
}

export function colorToHex(color: Color, alpha = true): string {
  return `#${color.map(c => c.toString(16).padStart(2, '0')).join('')}`.slice(0, alpha ? 9 : 7)
}

export function hexToRgba(hex: string): Rgba {
  return colorToRgba(hexToColor(hex))
}

export function rgbaToHex(rgba: RGBX): string {
  return colorToHex(rgbaToColor(rgba, { alpha: false }))
}
