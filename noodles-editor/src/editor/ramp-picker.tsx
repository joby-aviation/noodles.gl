// A color ramp parameter as its colors, not its name, as main's Color Ramp operator showed
// them: the menu draws each ramp from the planner's own stops (RAMP_STOPS), so what it shows is
// what the engine colors with, registered ramps included.

import { type ParamDef, RAMP_STOPS } from '@noodles.gl/planner'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import cx from 'classnames'
import s from './doc-editor.module.css'

const css = ([r, g, b]: [number, number, number]) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`

// The ramp as a CSS gradient. Stops are evenly spaced and linearly interpolated, as the engine
// samples them; `steps` draws that many flat bands instead, for a range sampled from the ramp.
export function rampGradient(name: string, steps?: number): string | undefined {
  const stops = RAMP_STOPS[name]
  if (!stops || stops.length < 2) return undefined
  if (!steps) return `linear-gradient(to right, ${stops.map(css).join(', ')})`
  const at = (t: number): [number, number, number] => {
    const x = t * (stops.length - 1)
    const i = Math.min(Math.floor(x), stops.length - 2)
    const f = x - i
    return [0, 1, 2].map(c => stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f) as [
      number,
      number,
      number,
    ]
  }
  const bands = Array.from({ length: steps }, (_, k) => {
    const color = css(at(steps === 1 ? 0 : k / (steps - 1)))
    return `${color} ${(k / steps) * 100}% ${((k + 1) / steps) * 100}%`
  })
  return `linear-gradient(to right, ${bands.join(', ')})`
}

// A menu whose choices are ramps: every non-empty option names one
export function isRampParam(def: ParamDef): boolean {
  const named = (def.options ?? []).filter(o => o.value !== '')
  return def.kind === 'menu' && named.length > 0 && named.every(o => o.value in RAMP_STOPS)
}

// "Six colors sampled from a ramp" draws six bands
const stepsOf = (def: ParamDef) => {
  const m = /\b(two|three|four|five|six|seven|eight|\d+) colors sampled/i.exec(def.help ?? '')
  if (!m) return undefined
  const words = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight']
  const w = words.indexOf(m[1].toLowerCase())
  return w >= 0 ? w + 2 : Number(m[1])
}

function Swatch({ name, steps }: { name: string; steps?: number }) {
  const background = name ? rampGradient(name, steps) : undefined
  return (
    <span className={cx(s.rampSwatch, !background && s.rampSwatchNone)} style={{ background }} />
  )
}

export function RampPicker({
  label,
  def,
  value,
  onChange,
}: {
  label: string
  def: ParamDef
  value: string
  onChange: (value: string) => void
}) {
  const steps = stepsOf(def)
  const options = def.options ?? []
  const current = options.find(o => o.value === value)
  return (
    <div className={s.paramDriven}>
      <span className={s.paramLabel}>{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={s.rampTrigger} aria-label={label}>
            <Swatch name={value} steps={steps} />
            <span className={s.rampName}>{current?.label ?? value}</span>
            <i className="pi pi-chevron-down" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={s.rampMenu} align="start" sideOffset={2}>
            {options.map(o => (
              <DropdownMenu.Item
                key={o.value}
                className={cx(s.rampItem, o.value === value && s.rampItemOn)}
                onSelect={() => onChange(o.value)}
              >
                <Swatch name={o.value} steps={steps} />
                <span className={s.rampName}>{o.label}</span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
