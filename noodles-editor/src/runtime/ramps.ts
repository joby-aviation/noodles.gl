// Noodles' continuous color schemes as planner ramps, so ramp() matches the ColorRamp the
// editor has always drawn rather than the planner's 8-stop approximations.

import { registerRamp } from '@noodles.gl/planner'
import { rgb } from 'd3'
import { continuousInterpolators } from '../noodles/color-schemes'

/** Evenly spaced samples per scheme. d3's own tables are 256 wide; 32 is visually the same. */
const STOPS = 32

let registered = false

export function registerNoodlesRamps(): void {
  if (registered) return
  registered = true
  for (const [name, interpolate] of Object.entries(continuousInterpolators)) {
    const stops = Array.from({ length: STOPS }, (_, i) => {
      const c = rgb(interpolate(i / (STOPS - 1)))
      return [c.r / 255, c.g / 255, c.b / 255] as [number, number, number]
    })
    registerRamp(name, stops)
  }
}
