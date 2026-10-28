// A MapLibre layer's properties as the style editor edits them, from the style spec's reference
// (`@maplibre/maplibre-gl-style-spec`): each paint and layout property's type, default, range
// and units, and whether it can follow the zoom. A value is a constant, a zoom ramp (an
// `interpolate` or `step` over `["zoom"]`, or a legacy `{ stops }` function), or any other
// expression, which is edited as JSON.

import type { LayerOverride, StyleConfiguratorData } from './map-style-utils'

type Reference = Record<string, Record<string, RawSpec>>

interface RawSpec {
  type: string
  default?: unknown
  minimum?: number
  maximum?: number
  units?: string
  values?: Record<string, unknown> | string[]
  value?: string
  length?: number
  doc?: string
  expression?: { interpolated?: boolean; parameters?: string[] }
}

export interface PropSpec {
  name: string
  group: 'paint' | 'layout'
  type: string
  default?: unknown
  minimum?: number
  maximum?: number
  units?: string
  // An enum's values
  values?: string[]
  // An array's item type and fixed length
  item?: string
  length?: number
  doc?: string
  // Can follow the zoom, and whether it blends between stops or steps
  zoom: boolean
  interpolated: boolean
  // The spec's own entry, for evaluating a value as MapLibre does
  raw: RawSpec
}

export interface StyleSpec {
  props: (layerType: string) => PropSpec[]
  // Expression operator names, to tell `["get", "name"]` from `["Open Sans Regular"]`
  operators: Set<string>
  /**
   * A value at a zoom, as MapLibre computes it: a ramp's curve and color space, a step's
   * thresholds. Undefined when it depends on feature data.
   */
  valueAt: (prop: PropSpec, value: unknown, zoom: number) => unknown
}

type Evaluate = (value: unknown, raw: RawSpec, zoom: number) => unknown

let loading: Promise<StyleSpec> | undefined

/** The style spec's reference and expressions, loaded once, when the style editor first opens. */
export function loadStyleSpec(): Promise<StyleSpec> {
  loading ??= import('@maplibre/maplibre-gl-style-spec').then(m =>
    styleSpecOf(
      m.latest as unknown as Reference,
      (value, raw, zoom) => {
        const e = m.normalizePropertyExpression(value as never, raw as never)
        return plain(e.evaluate({ zoom } as never))
      },
      // The module's reference leaves out the docs' operator list; its registry has them all
      new Set(Object.keys(m.expressions))
    )
  )
  // A load that failed (offline, a stale dev bundle) is tried again next time
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

// An evaluated value as a style holds it: a Color as a CSS color, a Padding or a number
// array as its numbers
function plain(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v
  const o = v as { r?: number; values?: unknown; toString?: () => string }
  if (typeof o.r === 'number') return o.toString?.()
  if (Array.isArray(o.values)) return o.values
  return v
}

export function styleSpecOf(
  reference: Reference,
  evaluate?: Evaluate,
  known?: Set<string>
): StyleSpec {
  const operators =
    known ??
    new Set(
      Object.keys((reference.expression_name as unknown as { values?: object })?.values ?? {})
    )
  const props = (layerType: string): PropSpec[] =>
    (['paint', 'layout'] as const).flatMap(group =>
      Object.entries(reference[`${group}_${layerType}`] ?? {})
        // Shown as the layer's eye
        .filter(([name]) => name !== 'visibility')
        .map(([name, raw]) => ({
          name,
          group,
          type: raw.type,
          default: raw.default,
          minimum: raw.minimum,
          maximum: raw.maximum,
          units: raw.units,
          values: raw.values
            ? Array.isArray(raw.values)
              ? raw.values
              : Object.keys(raw.values)
            : undefined,
          item: raw.value,
          length: raw.length,
          doc: raw.doc,
          zoom: raw.expression?.parameters?.includes('zoom') ?? false,
          interpolated: raw.expression?.interpolated ?? false,
          raw,
        }))
    )
  const valueAt = (prop: PropSpec, value: unknown, zoom: number) => {
    const ramp = zoomRampOf(value, operators)
    try {
      if (evaluate) return evaluate(value, prop.raw, zoom)
    } catch {
      // An expression the spec rejects: read the stops as best we can
    }
    return ramp ? rampAt(ramp, zoom) : value
  }
  return { props, operators, valueAt }
}

/** A property's name without its layer type: `line-width` → `width`, `text-halo-color` → `halo color`. */
export function propLabel(name: string, layerType: string): string {
  const bare = name.startsWith(`${layerType}-`) ? name.slice(layerType.length + 1) : name
  return bare.replace(/-/g, ' ')
}

export function isExpression(value: unknown, operators: Set<string>): boolean {
  return Array.isArray(value) && typeof value[0] === 'string' && operators.has(value[0])
}

export type Curve = 'linear' | 'exponential' | 'bezier' | 'step'

// A cubic bezier's two control points, x1 y1 x2 y2, as CSS's `cubic-bezier()`
export type Bezier = [number, number, number, number]

// Ease in and out, where a new bezier curve starts
export const EASE: Bezier = [0.42, 0, 0.58, 1]

export interface ZoomRamp {
  curve: Curve
  // An exponential curve's base
  base: number
  // A bezier curve's control points
  bezier?: Bezier
  // Zoom levels and the values there. A step ramp's first stop is the value below its second.
  stops: [number, unknown][]
  // `interpolate-hcl` and `interpolate-lab` blend colors in another space
  op?: string
}

const literal = (v: unknown, operators: Set<string>) =>
  !isExpression(v, operators) && (typeof v !== 'object' || v === null || Array.isArray(v))

const isZoom = (v: unknown) => Array.isArray(v) && v.length === 1 && v[0] === 'zoom'

// A list in an expression is `["literal", [...]]`, or MapLibre reads it as an expression
const unwrap = (v: unknown) => (Array.isArray(v) && v[0] === 'literal' && v.length === 2 ? v[1] : v)
const wrap = (v: unknown) => (Array.isArray(v) ? ['literal', v] : v)

/** A value that follows the zoom, as stops; undefined for a constant or another expression. */
export function zoomRampOf(value: unknown, operators: Set<string>): ZoomRamp | undefined {
  if (Array.isArray(value) && /^interpolate(-hcl|-lab)?$/.test(String(value[0]))) {
    const [op, kind, input, ...rest] = value as [string, unknown[], unknown, ...unknown[]]
    if (!isZoom(input) || !Array.isArray(kind) || rest.length < 2 || rest.length % 2) return
    const curve =
      kind[0] === 'exponential'
        ? 'exponential'
        : kind[0] === 'linear'
          ? 'linear'
          : kind[0] === 'cubic-bezier' &&
              kind.length === 5 &&
              kind.slice(1).every(n => typeof n === 'number')
            ? 'bezier'
            : null
    if (!curve) return
    const stops: [number, unknown][] = []
    for (let i = 0; i < rest.length; i += 2) {
      const v = unwrap(rest[i + 1])
      if (typeof rest[i] !== 'number' || !literal(v, operators)) return
      stops.push([rest[i] as number, v])
    }
    return {
      curve,
      base: curve === 'exponential' ? Number(kind[1] ?? 1) : 1,
      ...(curve === 'bezier' ? { bezier: kind.slice(1) as Bezier } : {}),
      stops,
      ...(op !== 'interpolate' ? { op } : {}),
    }
  }
  if (Array.isArray(value) && value[0] === 'step') {
    const [, input, first, ...rest] = value
    if (!isZoom(input) || rest.length % 2 || !literal(unwrap(first), operators)) return
    const stops: [number, unknown][] = [[0, unwrap(first)]]
    for (let i = 0; i < rest.length; i += 2) {
      const v = unwrap(rest[i + 1])
      if (typeof rest[i] !== 'number' || !literal(v, operators)) return
      stops.push([rest[i] as number, v])
    }
    return { curve: 'step', base: 1, stops }
  }
  // A legacy zoom function: stops over the zoom, not over a feature property
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const f = value as { stops?: unknown; property?: unknown; base?: unknown; type?: unknown }
    if (f.property !== undefined || !Array.isArray(f.stops) || f.stops.length === 0) return
    const stops = f.stops as unknown[]
    if (!stops.every(s => Array.isArray(s) && typeof s[0] === 'number')) return
    const base = Number(f.base ?? 1)
    return {
      curve: f.type === 'interval' ? 'step' : base === 1 ? 'linear' : 'exponential',
      base,
      stops: stops.map(s => [(s as unknown[])[0] as number, (s as unknown[])[1]]),
    }
  }
}

/** A zoom ramp as an expression MapLibre reads. */
export function rampExpression(ramp: ZoomRamp): unknown[] {
  const stops = [...ramp.stops].sort((a, b) => a[0] - b[0])
  const out = stops.flatMap(([z, v]) => [z, wrap(v)])
  if (ramp.curve === 'step') return ['step', ['zoom'], ...out.slice(1)]
  const kind =
    ramp.curve === 'exponential'
      ? ['exponential', ramp.base]
      : ramp.curve === 'bezier'
        ? ['cubic-bezier', ...(ramp.bezier ?? EASE)]
        : ['linear']
  return [ramp.op ?? 'interpolate', kind, ['zoom'], ...out]
}

/** A constant made to follow the zoom: the same value at both ends, to be changed. */
export function rampFrom(value: unknown, interpolated: boolean, from = 6, to = 16): ZoomRamp {
  return {
    curve: interpolated ? 'linear' : 'step',
    base: 1,
    stops: [
      [from, value],
      [to, value],
    ],
  }
}

/**
 * The ramp's value at `zoom` without the spec's expressions: numbers on the ramp's curve, a
 * step's value from its threshold on, anything else (a color) the stop at or below. The style
 * editor uses StyleSpec.valueAt, which blends colors as MapLibre does.
 */
export function rampAt(ramp: ZoomRamp, zoom: number): unknown {
  const stops = [...ramp.stops].sort((a, b) => a[0] - b[0])
  if (stops.length === 0) return undefined
  const below = stops.filter(([z]) => z <= zoom).length - 1
  if (below < 0) return stops[0][1]
  if (below === stops.length - 1 || ramp.curve === 'step') return stops[below][1]
  const [z0, v0] = stops[below]
  const [z1, v1] = stops[below + 1]
  if (typeof v0 !== 'number' || typeof v1 !== 'number') return v0
  return v0 + (v1 - v0) * curveFactor(ramp, zoom - z0, z1 - z0)
}

// How far between two stops `progress` is along the curve, as MapLibre's interpolate computes it
export function curveFactor(
  ramp: Pick<ZoomRamp, 'curve' | 'base' | 'bezier'>,
  progress: number,
  span: number
) {
  if (span === 0) return 0
  if (ramp.curve === 'bezier') return bezierAt(ramp.bezier ?? EASE, progress / span)
  if (ramp.curve !== 'exponential' || ramp.base === 1) return progress / span
  return (ramp.base ** progress - 1) / (ramp.base ** span - 1)
}

/** A cubic bezier's y where its x is `x`, from (0, 0) to (1, 1), as CSS and MapLibre ease. */
export function bezierAt([x1, y1, x2, y2]: Bezier, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const at = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3
  // x rises with t while the control points' x stay in 0–1, so halving finds the t for x
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2
    if (at(x1, x2, t) < x) lo = t
    else hi = t
  }
  return at(y1, y2, (lo + hi) / 2)
}

/**
 * A number scaled by `k`: a constant, or every stop of a zoom ramp. Anything else (a
 * data expression) is returned as it is. Stops must be numbers, so this needs no spec.
 */
export function scaleNumbers(value: unknown, k: number): unknown {
  if (typeof value === 'number') return value * k
  const ramp = zoomRampOf(value, new Set())
  if (!ramp?.stops.every(([, v]) => typeof v === 'number')) return value
  return rampExpression({ ...ramp, stops: ramp.stops.map(([z, v]) => [z, (v as number) * k]) })
}

/**
 * The changes with one property of one layer set, or put back to the style's own when
 * `value` is undefined. A layer left with no changes leaves the list.
 */
export function withLayerProp(
  changes: StyleConfiguratorData,
  layerId: string,
  group: 'paint' | 'layout',
  prop: string,
  value: unknown
): StyleConfiguratorData {
  const key = group === 'paint' ? 'paintOverrides' : 'layoutOverrides'
  const layers = changes.layers ?? []
  const current = layers.find(o => o.layerId === layerId) ?? { layerId }
  const props = { ...(current[key] ?? {}) }
  if (value === undefined) delete props[prop]
  else props[prop] = value
  const next: LayerOverride = { ...current, [key]: props }
  if (Object.keys(props).length === 0) delete next[key]
  const empty = !next.paintOverrides && !next.layoutOverrides
  const others = layers.filter(o => o.layerId !== layerId)
  return {
    ...changes,
    layers: empty
      ? others
      : layers.some(o => o.layerId === layerId)
        ? layers.map(o => (o.layerId === layerId ? next : o))
        : [...layers, next],
  }
}
