// Parameters the Properties panel shows as one control, as Kepler's layer panel does, while the
// document keeps them apart: a value and its units (`radiusScale` with `radiusUnits`), and a
// layer's color, which is a solid color, an attribute, a ramp over a numeric column or a row
// expression. They stay separate parameters because the planner routes them differently: units
// are a deck prop, a channel is per-row data. Nothing here changes the document format.

import type { OpDef, ParamDef, ParamValue } from '@noodles.gl/planner'

export interface UnitsPair {
  // The number the units apply to
  value: string
  units: string
}

export interface ColorGroup {
  // The per-row channel
  channel: string
  // The color used when the channel is empty
  solid?: string
  // The ramp `ramp()` reads in the channel's expression
  ramp?: string
}

export interface Compounds {
  units: UnitsPair[]
  colors: ColorGroup[]
  // Parameters drawn inside another one's control rather than on a row of their own
  absorbed: Set<string>
}

const isChannel = (p: ParamDef) => p.kind === 'expr' && p.of !== undefined

export function compoundsOf(op: Pick<OpDef, 'params'>): Compounds {
  const byName = new Map(op.params.map(p => [p.name, p]))
  const units: UnitsPair[] = []
  for (const p of op.params) {
    const m = /^(.+)Units$/.exec(p.name)
    if (!m || p.kind !== 'menu') continue
    // `sizeUnits` measures a text layer's `size`, and `radiusUnits` a scatterplot's
    // `radiusScale`, its radius being a per-row channel
    const value = [m[1], `${m[1]}Scale`].find(n => byName.get(n)?.kind === 'float')
    if (value) units.push({ value, units: p.name })
  }

  const colors: ColorGroup[] = []
  const solids = op.params.filter(p => p.kind === 'color')
  const taken = new Set<string>()
  const ramp = op.params.find(p => p.name === 'ramp' && p.kind === 'menu')
  for (const p of op.params) {
    // `color`, `sourceColor`, `lineColorChannel`; not `colorWeight`, which is a number
    if (!isChannel(p) || !/color(Channel)?$/i.test(p.name)) continue
    // The help names what an empty channel uses ("Empty uses the constant Outline color."), in
    // any folder; without one, the layer's first Style color nobody else claimed
    const named = /Empty uses (?:the constant )?([^.]+)\./.exec(p.help ?? '')?.[1]?.toLowerCase()
    const solid =
      solids.find(c => named && c.label.toLowerCase() === named && !taken.has(c.name)) ??
      (named ? undefined : solids.find(c => c.folder === 'Style' && !taken.has(c.name)))
    if (solid) taken.add(solid.name)
    colors.push({ channel: p.name, solid: solid?.name, ramp: ramp?.name })
  }

  const absorbed = new Set<string>([
    ...units.map(u => u.units),
    ...colors.flatMap(c => [c.solid, c.ramp].filter((n): n is string => n !== undefined)),
  ])
  return { units, colors, absorbed }
}

// A name an expression can use as written. A column like `total-cost` would read as
// subtraction, so pickers that write expressions offer only these.
export const addressable = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)

const callsRamp = (v: ParamValue | undefined) => typeof v === 'string' && /\bramp\(/.test(v)

// `compoundsOf` for one node's values. A units parameter that holds a reference or an expression
// keeps its own row, which shows the link and can break it. The ramp is drawn in the color
// control only while that control's Ramp mode is its sole user: any other channel calling
// ramp(), or a custom color expression, keeps it on its own row.
export function compoundsFor(
  op: Pick<OpDef, 'params'>,
  params: Record<string, ParamValue>
): Compounds & { rampIn?: string } {
  const all = compoundsOf(op)
  const units = all.units.filter(u => {
    const v = params[u.units]
    return v === undefined || typeof v !== 'object'
  })
  const rampGroups = all.colors.filter(c => {
    const v = params[c.channel]
    return typeof v === 'string' && colorValue(v).mode === 'ramp'
  })
  const ramp = all.colors.find(c => c.ramp)?.ramp
  const users = op.params.filter(p => isChannel(p) && callsRamp(params[p.name]))
  const others = users.filter(p => !rampGroups.some(g => g.channel === p.name))
  const rampIn = ramp && rampGroups[0] && others.length === 0 ? rampGroups[0].channel : undefined
  const absorbed = new Set<string>([
    ...units.map(u => u.units),
    ...all.colors.map(c => c.solid).filter((n): n is string => n !== undefined),
  ])
  // Shown in the Ramp control, or read by nothing: either way not a row of its own
  if (ramp && (rampIn || users.length === 0)) absorbed.add(ramp)
  return { units, colors: all.colors, absorbed, rampIn }
}

export type ColorMode = 'solid' | 'attribute' | 'ramp' | 'expression'

// A ramp's domain: the column's extent over the layer's rows, or fixed ends
export type RampRange = 'auto' | [number, number]

export interface ColorValue {
  mode: ColorMode
  column?: string
  range?: RampRange
}

const NUM = '(-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?)'
const RAMP = new RegExp(
  `^ramp\\(\\s*fit\\(\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*0\\s*,\\s*1\\s*\\)\\s*\\)$`
)
const RAMP_AUTO =
  /^ramp\(\s*fit\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*colmin\(\s*\1\s*\)\s*,\s*colmax\(\s*\1\s*\)\s*,\s*0\s*,\s*1\s*\)\s*\)$/

// What a color channel's text holds. `ramp(fit(col, lo, hi, 0, 1))`, and its auto form
// `ramp(fit(col, colmin(col), colmax(col), 0, 1))`, are what the Ramp mode writes, so they read
// back as Ramp; any other expression is shown as written.
export function colorValue(text: string): ColorValue {
  const t = text.trim()
  if (t === '') return { mode: 'solid' }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return { mode: 'attribute', column: t }
  const auto = RAMP_AUTO.exec(t)
  if (auto) return { mode: 'ramp', column: auto[1], range: 'auto' }
  const m = RAMP.exec(t)
  if (m) return { mode: 'ramp', column: m[1], range: [Number(m[2]), Number(m[3])] }
  return { mode: 'expression' }
}

// The Ramp mode's channel text. Auto fits the domain to the column's extent over the layer's
// rows (colmin and colmax, computed in SQL); fixed ends map straight to the ramp's ends.
export const rampExpression = (column: string, range: RampRange) =>
  range === 'auto'
    ? `ramp(fit(${column}, colmin(${column}), colmax(${column}), 0, 1))`
    : `ramp(fit(${column}, ${range[0]}, ${range[1]}, 0, 1))`
