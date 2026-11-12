/**
 * Keyframes: parameter values over time.
 *
 * Ported from Noodles.gl's native timeline (`noodles-editor/src/timeline/interpolation.ts` and
 * `easing-presets.ts`, Apache-2.0, © the Noodles.gl authors), narrowed to what a parameter
 * here can hold — a number or a string — because vectors and colors are split into one
 * parameter per component before they reach the planner.
 *
 * A keyframed parameter is how time enters the planner. While the timeline plays, its value
 * changes every frame, so the editor declares it with `changeRate = fps` and the optimizer
 * prices it like any dragged slider: a keyframed filter threshold pulls its node onto the
 * stage where a change is cheapest, and a keyframed deck prop (`currentTime`, the camera)
 * routes as `prop` and costs no query at all.
 */

export type InterpolationType = 'bezier' | 'linear' | 'hold';

/**
 * Control points of the segment leaving a keyframe, in normalized [0, 1] × [0, 1] space —
 * CSS `cubic-bezier(left[0], left[1], right[0], right[1])`.
 */
export interface BezierHandles {
  left: [number, number];
  right: [number, number];
}

export type KeyframeValue = number | string;

export interface Keyframe {
  id: string;
  /** Seconds. */
  time: number;
  value: KeyframeValue;
  /** How the segment *leaving* this keyframe interpolates. */
  interpolation: InterpolationType;
  handles?: BezierHandles;
}

export interface Track {
  /** The parameter it drives: `nodeId.param`. */
  target: string;
  /** Sorted by `time`. */
  keyframes: Keyframe[];
}

export interface Timeline {
  /** Seconds. */
  length: number;
  fps: number;
  tracks: Track[];
}

export const LINEAR_HANDLES: BezierHandles = { left: [0, 0], right: [1, 1] };

// ---------------------------------------------------------------------------
// Bezier easing
// ---------------------------------------------------------------------------

export function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function cubicBezierDerivative(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

/**
 * The curve parameter at which the easing's x equals `x`: Newton–Raphson, then bisection if
 * that fails to converge (it can, on a steep handle).
 */
export function findTForX(x: number, x1: number, x2: number, epsilon = 1e-4, iterations = 8): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === 0 && x2 === 1) return x;
  let t = x;
  for (let i = 0; i < iterations; i++) {
    const error = cubicBezier(t, 0, x1, x2, 1) - x;
    if (Math.abs(error) < epsilon) return t;
    const d = cubicBezierDerivative(t, 0, x1, x2, 1);
    if (Math.abs(d) < 1e-10) break;
    t = Math.max(0, Math.min(1, t - error / d));
  }
  let lo = 0;
  let hi = 1;
  t = x;
  while (hi - lo > epsilon) {
    if (cubicBezier(t, 0, x1, x2, 1) < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return t;
}

/** Eased progress for normalized time `x`. */
export function bezierEasing(x: number, h: BezierHandles): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return cubicBezier(findTForX(x, h.left[0], h.right[0]), 0, h.left[1], h.right[1], 1);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function between(time: number, a: Keyframe, b: Keyframe): KeyframeValue {
  if (time <= a.time || a.time === b.time) return a.value;
  if (time >= b.time) return b.value;
  // Strings do not interpolate; nor does a hold.
  if (a.interpolation === 'hold' || typeof a.value !== 'number' || typeof b.value !== 'number') return a.value;
  const x = (time - a.time) / (b.time - a.time);
  const u = a.interpolation === 'linear' ? x : bezierEasing(x, a.handles ?? LINEAR_HANDLES);
  return a.value + (b.value - a.value) * u;
}

/** A track's value at `time`; held constant before the first and after the last keyframe. */
export function evaluateTrack(track: Track, time: number): KeyframeValue | undefined {
  const k = track.keyframes;
  if (k.length === 0) return undefined;
  if (time <= k[0].time) return k[0].value;
  if (time >= k[k.length - 1].time) return k[k.length - 1].value;
  // Binary search for the segment containing `time`.
  let lo = 0;
  let hi = k.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (k[mid].time <= time) lo = mid;
    else hi = mid;
  }
  return between(time, k[lo], k[hi]);
}

/** Insert or replace a keyframe at `time`, keeping the track sorted. Returns a new track. */
export function setKeyframe(track: Track, key: Keyframe, epsilon = 1e-3): Track {
  const rest = track.keyframes.filter((k) => Math.abs(k.time - key.time) >= epsilon && k.id !== key.id);
  return { ...track, keyframes: [...rest, key].sort((a, b) => a.time - b.time) };
}

export function keyframeAt(track: Track | undefined, time: number, epsilon = 1e-3): Keyframe | undefined {
  return track?.keyframes.find((k) => Math.abs(k.time - time) < epsilon);
}

// ---------------------------------------------------------------------------
// Easing presets, as CSS cubic-bezier values
// ---------------------------------------------------------------------------

const cb = (x1: number, y1: number, x2: number, y2: number): BezierHandles => ({ left: [x1, y1], right: [x2, y2] });

export const EASING_PRESETS: { name: string; handles: BezierHandles }[] = [
  { name: 'Linear', handles: cb(0, 0, 1, 1) },
  { name: 'Ease', handles: cb(0.25, 0.1, 0.25, 1) },
  { name: 'Ease In', handles: cb(0.42, 0, 1, 1) },
  { name: 'Ease Out', handles: cb(0, 0, 0.58, 1) },
  { name: 'Ease In-Out', handles: cb(0.42, 0, 0.58, 1) },
  { name: 'Quad In-Out', handles: cb(0.455, 0.03, 0.515, 0.955) },
  { name: 'Cubic In-Out', handles: cb(0.645, 0.045, 0.355, 1) },
  { name: 'Quint In-Out', handles: cb(0.86, 0, 0.07, 1) },
  { name: 'Expo In-Out', handles: cb(1, 0, 0, 1) },
  { name: 'Sine In-Out', handles: cb(0.445, 0.05, 0.55, 0.95) },
  { name: 'Back Out', handles: cb(0.175, 0.885, 0.32, 1.275) },
  { name: 'Back In-Out', handles: cb(0.68, -0.55, 0.265, 1.55) },
];

export function presetName(h: BezierHandles | undefined): string | undefined {
  const e = 1e-3;
  const handles = h ?? LINEAR_HANDLES;
  return EASING_PRESETS.find((p) =>
    Math.abs(p.handles.left[0] - handles.left[0]) < e && Math.abs(p.handles.left[1] - handles.left[1]) < e &&
    Math.abs(p.handles.right[0] - handles.right[0]) < e && Math.abs(p.handles.right[1] - handles.right[1]) < e)?.name;
}
