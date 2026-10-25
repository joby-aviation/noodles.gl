// Parameters the Properties panel shows as one control, as Kepler's layer panel does, while the
// document keeps them apart: a value and its units (`radiusScale` with `radiusUnits`), and a
// layer's color, which is a solid color, an attribute, a ramp over a numeric column or a row
// expression. They stay separate parameters because the planner routes them differently: units
// are a deck prop, a channel is per-row data. Nothing here changes the document format.

import type { OpDef, ParamDef } from '@noodles.gl/planner'

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
    // `radiusUnits` measures `radiusScale`; `sizeUnits` measures `size`
    const value = [`${m[1]}Scale`, m[1]].find(n => byName.get(n)?.kind === 'float')
    if (value) units.push({ value, units: p.name })
  }

  const colors: ColorGroup[] = []
  const solids = op.params.filter(p => p.kind === 'color' && p.folder === 'Style')
  const taken = new Set<string>()
  const ramp = op.params.find(p => p.name === 'ramp' && p.kind === 'menu')
  for (const p of op.params) {
    if (!isChannel(p) || !/color/i.test(p.name)) continue
    // The help names what an empty channel uses ("Empty uses the constant Outline color.");
    // without one, the layer's first Style color nobody else claimed
    const named = /Empty uses (?:the constant )?([^.]+)\./.exec(p.help ?? '')?.[1]?.toLowerCase()
    const solid =
      solids.find(c => named && c.label.toLowerCase() === named && !taken.has(c.name)) ??
      (named ? undefined : solids.find(c => !taken.has(c.name)))
    if (solid) taken.add(solid.name)
    colors.push({ channel: p.name, solid: solid?.name, ramp: ramp?.name })
  }

  const absorbed = new Set<string>([
    ...units.map(u => u.units),
    ...colors.flatMap(c => [c.solid, c.ramp].filter((n): n is string => n !== undefined)),
  ])
  return { units, colors, absorbed }
}

export type ColorMode = 'solid' | 'attribute' | 'ramp' | 'expression'

export interface ColorValue {
  mode: ColorMode
  column?: string
  min?: number
  max?: number
}

const NUM = '(-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?)'
const RAMP = new RegExp(
  `^ramp\\(\\s*fit\\(\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*0\\s*,\\s*1\\s*\\)\\s*\\)$`
)

// What a color channel's text holds. `ramp(fit(col, lo, hi, 0, 1))` is the by-value form this
// control writes, so it reads back as one; any other expression is shown as written.
export function colorValue(text: string): ColorValue {
  const t = text.trim()
  if (t === '') return { mode: 'solid' }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return { mode: 'attribute', column: t }
  const m = RAMP.exec(t)
  if (m) return { mode: 'ramp', column: m[1], min: Number(m[2]), max: Number(m[3]) }
  return { mode: 'expression' }
}

export const rampExpression = (column: string, min: number, max: number) =>
  `ramp(fit(${column}, ${min}, ${max}, 0, 1))`
