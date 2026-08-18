export type RenderResolution = {
  width: number
  height: number
}

/**
 * Return the fixed visualization surface size used by Deck and MapLibre.
 * LOD deliberately scales the CSS/render dimensions, preserving existing behavior.
 */
export function getEffectiveRenderResolution(
  resolution: RenderResolution,
  lod: number
): RenderResolution {
  return {
    width: Math.round(resolution.width * lod),
    height: Math.round(resolution.height * lod),
  }
}

/** Camera zoom needed to preserve geographic bounds after scaling dimensions by LOD. */
export function getLodZoomCompensation(lod: number): number {
  return Math.log2(lod)
}
