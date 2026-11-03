import * as d3 from 'd3'
import {
  interpolateBlues,
  interpolateBuGn,
  interpolateBuPu,
  interpolateCividis,
  interpolateCool,
  interpolateCubehelixDefault,
  interpolateGnBu,
  interpolateGreens,
  interpolateGreys,
  interpolateInferno,
  interpolateMagma,
  interpolateOranges,
  interpolateOrRd,
  interpolatePiYG,
  interpolatePlasma,
  interpolatePuOr,
  interpolatePurples,
  interpolateRainbow,
  interpolateRdBu,
  interpolateRdGy,
  interpolateRdYlBu,
  interpolateReds,
  interpolateSinebow,
  interpolateSpectral,
  interpolateTurbo,
  interpolateViridis,
  interpolateWarm,
  schemeAccent,
  schemeBrBG,
  schemeCategory10,
  schemeDark2,
  schemeGreys,
  schemePaired,
  schemePiYG,
  schemePRGn,
  schemePuBu,
  schemeRdBu,
  schemeRdGy,
  schemeRdYlBu,
  schemeRdYlGn,
  schemeSet1,
  schemeSet2,
  schemeSet3,
  schemeSpectral,
  schemeTableau10,
  schemeYlGn,
} from 'd3-scale-chromatic'

export const JOBY_COLORS = [
  '#FFB300',
  '#EB6110',
  '#E64839',
  '#00994C',
  '#883DF2',
  '#7CC3FF',
  '#3EC26A',
  '#FF9058',
  '#FFCC54',
  '#B580FF',
]

export const continuousInterpolators = {
  viridis: interpolateViridis,
  inferno: interpolateInferno,
  plasma: interpolatePlasma,
  magma: interpolateMagma,
  turbo: interpolateTurbo,
  cividis: interpolateCividis,
  warm: interpolateWarm,
  cool: interpolateCool,
  cubehelix: interpolateCubehelixDefault,
  spectral: interpolateSpectral,
  rainbow: interpolateRainbow,
  sinebow: interpolateSinebow,
  blues: interpolateBlues,
  greens: interpolateGreens,
  greys: interpolateGreys,
  reds: interpolateReds,
  oranges: interpolateOranges,
  purples: interpolatePurples,
  joby: d3.interpolateRgbBasis(JOBY_COLORS),
  PinkYellowGreen: interpolatePiYG,
  PurpleOrange: interpolatePuOr,
  RedBlue: interpolateRdBu,
  RedGrey: interpolateRdGy,
  RedYellowBlue: interpolateRdYlBu,
  BlueGreen: interpolateBuGn,
  BluePurple: interpolateBuPu,
  GreenBlue: interpolateGnBu,
  OrangeRed: interpolateOrRd,
}

export const categoricalSchemesFixed = {
  accent: schemeAccent,
  category10: schemeCategory10,
  dark: schemeDark2,
  paired: schemePaired,
  set1: schemeSet1,
  set2: schemeSet2,
  set3: schemeSet3,
  tableau10: schemeTableau10,
  joby: JOBY_COLORS,
}

export const categoricalSchemesStepped = {
  greyscale: schemeGreys,
  BrownGreen: schemeBrBG,
  PurpleGreen: schemePRGn,
  PurpleBlue: schemePuBu,
  PinkYellowGreen: schemePiYG,
  RedBlue: schemeRdBu,
  RedGrey: schemeRdGy,
  RedYellowBlue: schemeRdYlBu,
  RedYellowGreen: schemeRdYlGn,
  YellowGreen: schemeYlGn,
  spectral: schemeSpectral,
}

// Render a color scheme to a canvas context
// Handles continuous interpolators, fixed categorical schemes, and stepped schemes
export function renderColorScheme(
  ctx: CanvasRenderingContext2D,
  schemeName: string,
  width: number,
  height: number,
  stepCount = 8
) {
  if (schemeName in continuousInterpolators) {
    const interpolator = continuousInterpolators[schemeName as keyof typeof continuousInterpolators]
    for (let i = 0; i < width; i++) {
      const t = i / (width - 1)
      ctx.fillStyle = interpolator(t)
      ctx.fillRect(i, 0, 1, height)
    }
  } else if (schemeName in categoricalSchemesFixed) {
    const scheme = categoricalSchemesFixed[schemeName as keyof typeof categoricalSchemesFixed]
    const blockWidth = width / scheme.length
    scheme.forEach((color, i) => {
      ctx.fillStyle = color
      ctx.fillRect(i * blockWidth, 0, blockWidth, height)
    })
  } else if (schemeName in categoricalSchemesStepped) {
    const schemes = categoricalSchemesStepped[schemeName as keyof typeof categoricalSchemesStepped]
    const clamped = Math.min(stepCount, schemes.length - 1)
    const scheme = schemes[clamped] as readonly string[]
    const blockWidth = width / scheme.length
    scheme.forEach((color, i) => {
      ctx.fillStyle = color
      ctx.fillRect(i * blockWidth, 0, blockWidth, height)
    })
  }
}
