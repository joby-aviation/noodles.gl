// Noodles' color schemes as planner ramps, so ramp() matches the ColorRamp the editor has always
// drawn rather than the planner's 8-stop approximations.

import { registerRamp } from '@noodles.gl/planner'
import { rgb } from 'd3'
import { categoricalSchemesFixed, continuousInterpolators } from '../noodles/color-schemes'

/** Evenly spaced samples per scheme. d3's own tables are 256 wide; 32 is visually the same. */
const STOPS = 32

/** The ramp a categorical scheme registers as: `categorical-category10`. */
export const categoricalRamp = (scheme: string) => `categorical-${scheme}`

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
  // Each color twice, so the ramp is flat across each color's band: color i of n is exactly
  // ramp((i + 0.5) / n), with no blend from its neighbors.
  for (const [name, scheme] of Object.entries(categoricalSchemesFixed)) {
    const stops = (scheme as readonly string[]).flatMap(color => {
      const c = rgb(color)
      const stop = [c.r / 255, c.g / 255, c.b / 255] as [number, number, number]
      return [stop, stop]
    })
    registerRamp(categoricalRamp(name), stops, `${name} (categories)`)
  }
}
