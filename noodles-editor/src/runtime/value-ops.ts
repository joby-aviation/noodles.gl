// Numbers from curves: Noodles' Bezier Curve and Ramp as planner scalar operators, evaluated by
// the scalar program each frame, so a wired or keyframed position moves them as it did. The
// curve is JSON text, parsed once per text.

import { type OpDef, registerOperator } from '@noodles.gl/planner'
import { type BezierPoint, bezierAt, interpolateRamp, type RampInterpType } from '../utils/curves'

const parsed = new Map<string, unknown>()
function json<T>(text: string, fallback: T): T {
  if (!parsed.has(text)) {
    let value: unknown = fallback
    try {
      value = JSON.parse(text)
    } catch {
      // A curve that does not parse is the default one
    }
    parsed.set(text, value)
  }
  return parsed.get(text) as T
}

type Stop = { pos: number; val: number; interp?: RampInterpType }
const DEFAULT_STOPS: Stop[] = [
  { pos: 0, val: 0, interp: 'smooth' },
  { pos: 1, val: 1, interp: 'smooth' },
]

export const VALUE_OPS: OpDef[] = [
  {
    type: 'bezier-curve',
    label: 'Bezier Curve',
    category: 'number',
    description: 'A number from a curve: the curve’s height at a factor from 0 to 1.',
    inputs: [],
    outputs: [{ name: 'out', type: 'number' }],
    params: [
      {
        name: 'factor',
        label: 'Factor',
        kind: 'float',
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        port: true,
      },
      {
        name: 'curve',
        label: 'Curve',
        kind: 'text',
        default: JSON.stringify({
          points: [
            { x: 0, y: 0, handleRightX: 0.3, handleRightY: 0 },
            { x: 1, y: 1, handleLeftX: 0.7, handleLeftY: 1 },
          ],
        }),
        help: 'Points from 0 to 1, each with handles: { points: [{ x, y, handleRightY, handleLeftY }] }.',
      },
    ],
    scalar: p => {
      const curve = json<{ points?: BezierPoint[] }>(p.str('curve'), {})
      return bezierAt(curve.points ?? [], p.num('factor'))
    },
  },
  {
    type: 'ramp',
    label: 'Ramp',
    category: 'number',
    description:
      'A number from stops: the value at a position, between stops linearly, smoothly (monotone) or held.',
    inputs: [],
    outputs: [{ name: 'out', type: 'number' }],
    params: [
      {
        name: 'position',
        label: 'Position',
        kind: 'float',
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
        port: true,
      },
      {
        name: 'stops',
        label: 'Stops',
        kind: 'text',
        default: '',
        help: 'JSON: [{ pos, val, interp: "linear" | "smooth" | "hold" }]; empty is 0 to 1, smooth.',
      },
    ],
    scalar: p => {
      const stops = json<Stop[]>(p.str('stops'), [])
      const sorted =
        Array.isArray(stops) && stops.length
          ? [...stops].sort((a, b) => a.pos - b.pos)
          : DEFAULT_STOPS
      return interpolateRamp(p.num('position'), sorted)
    },
  },
]

let registered = false

// Register the curve operators with the planner's catalog. Idempotent.
export function registerValueOperators(): void {
  if (registered) return
  registered = true
  for (const op of VALUE_OPS) registerOperator(op)
}
