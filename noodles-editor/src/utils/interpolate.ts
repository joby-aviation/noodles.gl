import { scaleLinear } from 'd3'

/**
 * Create a function that maps from a numerical input array to a numerical output array.
 * Supports easing.
 */
export function interpolate(
  input: [number, number],
  output: [number, number],
  ease?: (v: number) => number
) {
  const inputInterpolator = scaleLinear(input)
  const outputInterpolator = scaleLinear(output)
  return (inputValue: number): number => {
    const normalizedInput = inputInterpolator.invert(inputValue)
    return outputInterpolator(ease ? ease(normalizedInput) : normalizedInput)
  }
}
