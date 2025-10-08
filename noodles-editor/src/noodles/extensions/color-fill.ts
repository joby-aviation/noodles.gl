import type { ShaderPass } from '@luma.gl/shadertools'

const fs = `\
uniform colorFillUniforms {
  vec4 fill;
} colorFill;

vec4 colorFill_filterColor(vec4 color) {
  return colorFill.fill;
}

vec4 colorFill_filterColor_ext(vec4 color, vec2 texSize, vec2 texCoords) {
  return colorFill_filterColor(color);
}
`

export type ColorFillProps = {
  fill?: [number, number, number, number]
}

// Replace all colors
// Usage:
//   fill: [r, g, b, a]
//   color channels are 0-1
export const colorFill = {
  name: 'colorFill',
  fs,
  props: {} as ColorFillProps,
  uniformTypes: {
    fill: 'vec4<f32>',
  },
  defaultUniforms: {
    fill: [1, 1, 1, 1],
  },
  propTypes: {
    fill: { format: 'vec4<f32>', value: [1, 1, 1, 1] },
  },

  passes: [{ filter: true }],
} as const satisfies ShaderPass<ColorFillProps>
