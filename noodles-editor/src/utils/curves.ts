// Curves Ramp and Bezier Curve operators evaluate: shared by the Noodles operators and the
// planner's scalar operators that replace them.

export type RampInterpType = 'linear' | 'smooth' | 'hold'

// Tangent slopes matching D3's curveMonotoneX (Fritsch-Carlson algorithm)
// so the smooth computation result matches the visual curve exactly.
// For n=2, D3 draws a straight line, so we return the chord slope at both endpoints.
export function monotoneSlopes(stops: Array<{ pos: number; val: number }>): number[] {
  const n = stops.length
  const m = new Array<number>(n).fill(0)
  if (n < 2) return m
  if (n === 2) {
    const h = stops[1].pos - stops[0].pos
    const s = h !== 0 ? (stops[1].val - stops[0].val) / h : 0
    return [s, s]
  }

  // Interior slopes — D3 slope3 formula
  for (let i = 1; i < n - 1; i++) {
    const h0 = stops[i].pos - stops[i - 1].pos
    const h1 = stops[i + 1].pos - stops[i].pos
    const s0 = h0 !== 0 ? (stops[i].val - stops[i - 1].val) / h0 : 0
    const s1 = h1 !== 0 ? (stops[i + 1].val - stops[i].val) / h1 : 0
    const p = (s0 * h1 + s1 * h0) / (h0 + h1)
    const sign = (v: number) => (v < 0 ? -1 : v > 0 ? 1 : 0)
    m[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  }

  // Endpoint slopes — D3 slope2 formula
  const h0 = stops[1].pos - stops[0].pos
  const hN = stops[n - 1].pos - stops[n - 2].pos
  m[0] = h0 !== 0 ? ((3 * (stops[1].val - stops[0].val)) / h0 - m[1]) / 2 : m[1]
  m[n - 1] = hN !== 0 ? ((3 * (stops[n - 1].val - stops[n - 2].val)) / hN - m[n - 2]) / 2 : m[n - 2]

  return m
}

// Per-segment interpolation: uses each stop's interp type for the segment that follows it
export function interpolateRamp(
  position: number,
  sortedStops: Array<{ pos: number; val: number; interp?: RampInterpType }>
): number {
  const n = sortedStops.length
  if (n === 1) return sortedStops[0].val
  if (position <= sortedStops[0].pos) return sortedStops[0].val
  if (position >= sortedStops[n - 1].pos) return sortedStops[n - 1].val

  let i = 0
  while (i < n - 2 && position >= sortedStops[i + 1].pos) i++

  const s0 = sortedStops[i]
  const s1 = sortedStops[i + 1]
  const h = s1.pos - s0.pos
  if (h === 0) return s0.val

  const interp = s0.interp ?? 'smooth'

  if (interp === 'hold') return s0.val

  const t = (position - s0.pos) / h

  if (interp === 'linear') return s0.val + t * (s1.val - s0.val)

  // smooth: cubic Hermite with PCHIP slopes
  const slopes = monotoneSlopes(sortedStops)
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * s0.val +
    (t3 - 2 * t2 + t) * h * slopes[i] +
    (-2 * t3 + 3 * t2) * s1.val +
    (t3 - t2) * h * slopes[i + 1]
  )
}

// A Bezier Curve field's curve at x in 0–1: cubic segments between points sorted by x, each
// with its handles (a third of the way along when unset), clamped to the end points outside
export interface BezierPoint {
  x: number
  y: number
  handleLeftX?: number
  handleLeftY?: number
  handleRightX?: number
  handleRightY?: number
}

export function bezierAt(points: BezierPoint[], x: number): number {
  if (points.length === 0) return 0
  if (points.length === 1) return points[0].y
  const clampedX = Math.max(0, Math.min(1, x))
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    if (clampedX >= p0.x && clampedX <= p1.x) {
      const t = (clampedX - p0.x) / (p1.x - p0.x)
      const cp1y = p0.handleRightY ?? p0.y
      const cp2y = p1.handleLeftY ?? p1.y
      return (
        (1 - t) ** 3 * p0.y +
        3 * (1 - t) ** 2 * t * cp1y +
        3 * (1 - t) * t ** 2 * cp2y +
        t ** 3 * p1.y
      )
    }
  }
  return clampedX <= points[0].x ? points[0].y : points[points.length - 1].y
}
