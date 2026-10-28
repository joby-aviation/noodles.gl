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
}

export interface StyleSpec {
  props: (layerType: string) => PropSpec[]
  // Expression operator names, to tell `["get", "name"]` from `["Open Sans Regular"]`
  operators: Set<string>
}

let loading: Promise<StyleSpec> | undefined

/** The style spec's reference, loaded once, when the style editor first opens. */
export function loadStyleSpec(): Promise<StyleSpec> {
  loading ??= import('@maplibre/maplibre-gl-style-spec/dist/latest.json').then(m =>
    styleSpecOf((m.default ?? m) as unknown as Reference)
  )
  return loading
}

export function styleSpecOf(reference: Reference): StyleSpec {
  const operators = new Set(
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
        }))
    )
  return { props, operators }
}

/** A property's name without its layer type: `line-width` → `width`, `text-halo-color` → `halo color`. */
export function propLabel(name: string, layerType: string): string {
  const bare = name.startsWith(`${layerType}-`) ? name.slice(layerType.length + 1) : name
  return bare.replace(/-/g, ' ')
}

export function isExpression(value: unknown, operators: Set<string>): boolean {
  return Array.isArray(value) && typeof value[0] === 'string' && operators.has(value[0])
}

export type Curve = 'linear' | 'exponential' | 'step'

export interface ZoomRamp {
  curve: Curve
  // An exponential curve's base
  base: number
  // Zoom levels and the values there. A step ramp's first stop is the value below its second.
  stops: [number, unknown][]
  // `interpolate-hcl` and `interpolate-lab` blend colors in another space
  op?: string
}

const literal = (v: unknown, operators: Set<string>) =>
  !isExpression(v, operators) && (typeof v !== 'object' || v === null || Array.isArray(v))

const isZoom = (v: unknown) => Array.isArray(v) && v.length === 1 && v[0] === 'zoom'

/** A value that follows the zoom, as stops; undefined for a constant or another expression. */
export function zoomRampOf(value: unknown, operators: Set<string>): ZoomRamp | undefined {
  if (Array.isArray(value) && /^interpolate(-hcl|-lab)?$/.test(String(value[0]))) {
    const [op, kind, input, ...rest] = value as [string, unknown[], unknown, ...unknown[]]
    if (!isZoom(input) || !Array.isArray(kind) || rest.length < 2 || rest.length % 2) return
    const curve = kind[0] === 'exponential' ? 'exponential' : kind[0] === 'linear' ? 'linear' : null
    if (!curve) return
    const stops: [number, unknown][] = []
    for (let i = 0; i < rest.length; i += 2) {
      if (typeof rest[i] !== 'number' || !literal(rest[i + 1], operators)) return
      stops.push([rest[i] as number, rest[i + 1]])
    }
    return {
      curve,
      base: curve === 'exponential' ? Number(kind[1] ?? 1) : 1,
      stops,
      ...(op !== 'interpolate' ? { op } : {}),
    }
  }
  if (Array.isArray(value) && value[0] === 'step') {
    const [, input, first, ...rest] = value
    if (!isZoom(input) || rest.length % 2 || !literal(first, operators)) return
    const stops: [number, unknown][] = [[0, first]]
    for (let i = 0; i < rest.length; i += 2) {
      if (typeof rest[i] !== 'number' || !literal(rest[i + 1], operators)) return
      stops.push([rest[i] as number, rest[i + 1]])
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
  if (ramp.curve === 'step') {
    const [first, ...rest] = stops
    return ['step', ['zoom'], first?.[1], ...rest.flat()]
  }
  const kind = ramp.curve === 'exponential' ? ['exponential', ramp.base] : ['linear']
  return [ramp.op ?? 'interpolate', kind, ['zoom'], ...stops.flat()]
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

/** The ramp's value at `zoom`, for a new stop there: numbers blend linearly, others step. */
export function rampAt(ramp: ZoomRamp, zoom: number): unknown {
  const stops = [...ramp.stops].sort((a, b) => a[0] - b[0])
  if (stops.length === 0) return undefined
  if (zoom <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [z0, v0] = stops[i - 1]
    const [z1, v1] = stops[i]
    if (zoom > z1) continue
    if (ramp.curve === 'step' || typeof v0 !== 'number' || typeof v1 !== 'number') return v0
    return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0 || 1)
  }
  return stops[stops.length - 1][1]
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
