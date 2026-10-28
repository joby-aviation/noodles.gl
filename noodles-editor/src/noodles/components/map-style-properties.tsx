// The style editor's layer inspector, as Maputnik's and Mapbox Studio's: every paint and layout
// property the style spec gives the layer's type, each edited by its type (a number with a
// slider in its units, a color, a menu, a toggle, a list), as a zoom ramp when it follows the
// zoom, or as JSON when it is any other expression. A changed property is marked and can be put
// back to the style's own value.

import cx from 'classnames'
import { useEffect, useState } from 'react'
import {
  type Curve,
  isExpression,
  type PropSpec,
  propLabel,
  rampAt,
  rampExpression,
  rampFrom,
  type StyleSpec,
  type ZoomRamp,
  zoomRampOf,
} from '../../utils/map-style-props'
import type { LayerOverride, MaplibreLayer } from '../../utils/map-style-utils'
import { ColorSwatch } from './color-swatch'
import p from './map-style-properties.module.css'

type Change = (group: 'paint' | 'layout', prop: string, value: unknown) => void

export function LayerInspector({
  layer,
  layerOverride,
  spec,
  zoom,
  onChange,
}: {
  layer: MaplibreLayer
  layerOverride: LayerOverride | undefined
  spec: StyleSpec
  // The preview's zoom, where a new ramp stop goes
  zoom: number
  // A value, or undefined to put the style's own back
  onChange: Change
}) {
  const props = spec.props(layer.type)
  const changedOf = (prop: PropSpec) =>
    (prop.group === 'paint' ? layerOverride?.paintOverrides : layerOverride?.layoutOverrides)?.[
      prop.name
    ]
  const styleOf = (prop: PropSpec) =>
    (prop.group === 'paint' ? layer.paint : layer.layout)?.[prop.name]
  // What the style sets comes first; the rest of what the layer type can take, folded away
  const set = props.filter(prop => styleOf(prop) !== undefined || changedOf(prop) !== undefined)
  const others = props.filter(prop => !set.includes(prop))
  const row = (prop: PropSpec) => (
    <PropertyRow
      key={`${prop.group}:${prop.name}`}
      prop={prop}
      layerType={layer.type}
      styleValue={styleOf(prop)}
      changed={changedOf(prop)}
      operators={spec.operators}
      zoom={zoom}
      onChange={value => onChange(prop.group, prop.name, value)}
    />
  )
  const meta = layer as MaplibreLayer & { source?: string; 'source-layer'?: string }

  return (
    <div className={p.inspector}>
      <div className={p.inspectorHead}>
        <span className={p.typeBadge}>{layer.type}</span>
        <span className={p.layerName} title={layer.id}>
          {layer.id}
        </span>
      </div>
      {(meta.source || meta['source-layer']) && (
        <div className={p.layerSource}>
          {[meta.source, meta['source-layer']].filter(Boolean).join(' › ')}
        </div>
      )}
      {(['paint', 'layout'] as const).map(group => {
        const rows = set.filter(prop => prop.group === group)
        return rows.length > 0 ? (
          <section key={group} className={p.group}>
            <div className={p.groupTitle}>{group}</div>
            {rows.map(row)}
          </section>
        ) : null
      })}
      {others.length > 0 && (
        <details className={p.more}>
          <summary>Other properties ({others.length})</summary>
          {others.map(row)}
        </details>
      )}
    </div>
  )
}

function PropertyRow({
  prop,
  layerType,
  styleValue,
  changed,
  operators,
  zoom,
  onChange,
}: {
  prop: PropSpec
  layerType: string
  styleValue: unknown
  changed: unknown
  operators: Set<string>
  zoom: number
  onChange: (value: unknown) => void
}) {
  const value = changed ?? styleValue ?? prop.default
  const ramp = zoomRampOf(value, operators)
  const expression = !ramp && (isExpression(value, operators) || isFunction(value))
  const isChanged = changed !== undefined
  const label = propLabel(prop.name, layerType)

  return (
    <div className={cx(p.prop, isChanged && p.propChanged)}>
      <div className={p.propHead}>
        <span className={p.propLabel} title={`${prop.name}${prop.doc ? `\n${prop.doc}` : ''}`}>
          {label}
          {prop.units && <span className={p.units}>{prop.units}</span>}
        </span>
        <span className={p.propActions}>
          {prop.zoom && !expression && (
            <button
              type="button"
              className={cx(p.iconButton, ramp && p.iconButtonOn)}
              title={ramp ? 'Make it one value at every zoom' : 'Make it change with the zoom'}
              aria-label={ramp ? `${label}: one value` : `${label}: by zoom`}
              onClick={() =>
                onChange(
                  ramp ? rampAt(ramp, zoom) : rampExpression(rampFrom(value, prop.interpolated))
                )
              }
            >
              z
            </button>
          )}
          {isChanged && (
            <button
              type="button"
              className={p.iconButton}
              title="Put back the style's own value"
              aria-label={`${label}: reset`}
              onClick={() => onChange(undefined)}
            >
              ↺
            </button>
          )}
        </span>
      </div>
      {ramp ? (
        <RampEditor
          prop={prop}
          ramp={ramp}
          zoom={zoom}
          onChange={next => onChange(rampExpression(next))}
        />
      ) : expression ? (
        <JsonEditor value={value} onChange={onChange} />
      ) : (
        <ValueInput prop={prop} value={value} onChange={onChange} />
      )}
    </div>
  )
}

// A legacy function over a feature property: `{ property, stops }`
const isFunction = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)

/** A constant of the property's type. */
export function ValueInput({
  prop,
  value,
  onChange,
}: {
  prop: PropSpec
  value: unknown
  onChange: (value: unknown) => void
}) {
  switch (prop.type) {
    case 'number':
      return typeof value === 'number' || value === undefined ? (
        <NumberInput prop={prop} value={value ?? 0} onChange={onChange} />
      ) : (
        <JsonEditor value={value} onChange={onChange} />
      )
    case 'color':
      return typeof value === 'string' || value === undefined ? (
        <span className={p.colorInput}>
          <ColorSwatch value={(value as string) ?? '#000000'} onChange={onChange} />
          <TextInput value={(value as string) ?? ''} onChange={onChange} />
        </span>
      ) : (
        <JsonEditor value={value} onChange={onChange} />
      )
    case 'enum':
      return (
        <select
          className={p.select}
          value={String(value ?? '')}
          onChange={e => onChange(e.target.value)}
        >
          {(prop.values ?? []).map(v => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )
    case 'boolean':
      return (
        <input
          type="checkbox"
          className={p.checkbox}
          checked={value === true}
          onChange={e => onChange(e.target.checked)}
        />
      )
    case 'array':
    case 'padding':
    case 'numberArray':
      return <ListInput prop={prop} value={value} onChange={onChange} />
    default:
      return typeof value === 'string' || value === undefined ? (
        <TextInput value={(value as string) ?? ''} onChange={onChange} />
      ) : (
        <JsonEditor value={value} onChange={onChange} />
      )
  }
}

// How far a slider reaches when the spec sets no maximum: past the value, in the property's units
function sliderMax(prop: PropSpec, value: number): number {
  if (prop.maximum !== undefined) return prop.maximum
  const soft =
    prop.units === 'degrees'
      ? 360
      : prop.units === 'milliseconds'
        ? 2000
        : prop.units === 'ems'
          ? 4
          : prop.units === 'pixels'
            ? 24
            : 10
  return Math.max(soft, Math.ceil(Math.abs(value) * 2))
}

function NumberInput({
  prop,
  value,
  onChange,
}: {
  prop: PropSpec
  value: number
  onChange: (value: number) => void
}) {
  const max = sliderMax(prop, value)
  const min = prop.minimum ?? (value < 0 || prop.units === 'degrees' ? -max : 0)
  const step = max - min <= 2 ? 0.01 : max - min <= 50 ? 0.1 : 1
  return (
    <span className={p.number}>
      <input
        type="range"
        className={p.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <NumberBox value={value} min={prop.minimum} max={prop.maximum} onChange={onChange} />
    </span>
  )
}

/** A number typed in: commits on Enter or blur, clamped to the spec's range. */
function NumberBox({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number
  min?: number
  max?: number
  label?: string
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(+value.toFixed(4))), [value])
  const commit = () => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(value))
    const clamped = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? Number.NEGATIVE_INFINITY, n)
    )
    if (clamped !== value) onChange(clamped)
    else setDraft(String(value))
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={p.numberBox}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function TextInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type="text"
      className={p.text}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => draft !== value && onChange(draft)}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

/** A list of numbers or names, as text: `2, 1` for a dash, `Open Sans Regular` for a font. */
function ListInput({
  prop,
  value,
  onChange,
}: {
  prop: PropSpec
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (value !== undefined && !Array.isArray(value))
    return <JsonEditor value={value} onChange={onChange} />
  const numbers = prop.item === 'number' || prop.type === 'padding' || prop.type === 'numberArray'
  const text = (value as unknown[] | undefined)?.join(', ') ?? ''
  return (
    <TextInput
      value={text}
      onChange={t => {
        const items = t
          .split(',')
          .map(x => x.trim())
          .filter(Boolean)
        if (!numbers) return onChange(items)
        const ns = items.map(Number)
        if (ns.every(Number.isFinite) && (!prop.length || ns.length === prop.length)) onChange(ns)
      }}
    />
  )
}

/** Any other expression, as JSON: commits when it parses. */
function JsonEditor({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const text = JSON.stringify(value)
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState(false)
  useEffect(() => setDraft(text), [text])
  return (
    <textarea
      className={cx(p.json, error && p.jsonError)}
      spellCheck={false}
      value={draft}
      rows={Math.min(6, Math.ceil(draft.length / 40))}
      onChange={e => {
        setDraft(e.target.value)
        setError(false)
      }}
      onBlur={() => {
        if (draft === text) return
        try {
          onChange(JSON.parse(draft))
        } catch {
          setError(true)
        }
      }}
    />
  )
}

const CURVES: { value: Curve; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'step', label: 'Step' },
]

/** Stops over the zoom: each a zoom and the value there, blended by the curve between them. */
function RampEditor({
  prop,
  ramp,
  zoom,
  onChange,
}: {
  prop: PropSpec
  ramp: ZoomRamp
  zoom: number
  onChange: (ramp: ZoomRamp) => void
}) {
  const stops = [...ramp.stops].sort((a, b) => a[0] - b[0])
  const setStop = (i: number, stop: [number, unknown]) =>
    onChange({ ...ramp, stops: stops.map((s, j) => (j === i ? stop : s)) })
  const here = Math.round(zoom * 10) / 10
  return (
    <div className={p.ramp}>
      <div className={p.rampHead}>
        <select
          className={p.select}
          value={ramp.curve}
          aria-label="Curve"
          onChange={e => onChange({ ...ramp, curve: e.target.value as Curve })}
        >
          {CURVES.filter(c => prop.interpolated || c.value === 'step').map(c => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {ramp.curve === 'exponential' && (
          <span className={p.base}>
            base
            <NumberBox
              value={ramp.base}
              min={0}
              label="Exponential base"
              onChange={base => onChange({ ...ramp, base })}
            />
          </span>
        )}
      </div>
      <RampChart stops={stops} curve={ramp.curve} base={ramp.base} zoom={zoom} />
      {stops.map(([z, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stops are edited in place; a zoom can repeat while typed
        <div key={i} className={p.stop}>
          <span
            className={p.stopZoom}
            title={ramp.curve === 'step' && i === 0 ? 'Below the next stop' : 'Zoom'}
          >
            {ramp.curve === 'step' && i === 0 ? (
              <span className={p.stopBelow}>below</span>
            ) : (
              <NumberBox
                value={z}
                min={0}
                max={24}
                label="Stop zoom"
                onChange={nz => setStop(i, [nz, v])}
              />
            )}
          </span>
          <span className={p.stopValue}>
            <ValueInput prop={prop} value={v} onChange={nv => setStop(i, [z, nv])} />
          </span>
          <button
            type="button"
            className={p.iconButton}
            disabled={stops.length <= 2}
            title="Remove the stop"
            aria-label={`Remove the stop at zoom ${z}`}
            onClick={() => onChange({ ...ramp, stops: stops.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={p.addStop}
        disabled={stops.some(([z]) => z === here)}
        onClick={() => onChange({ ...ramp, stops: [...stops, [here, rampAt(ramp, here)]] })}
      >
        + Stop at zoom {here}
      </button>
    </div>
  )
}

const CHART_W = 240
const CHART_H = 44

/** A number ramp's curve over zoom 0–22, with the preview's zoom marked; colors as a gradient. */
function RampChart({
  stops,
  curve,
  base,
  zoom,
}: {
  stops: [number, unknown][]
  curve: Curve
  base: number
  zoom: number
}) {
  const x = (z: number) => (Math.min(22, Math.max(0, z)) / 22) * CHART_W
  if (stops.every(([, v]) => typeof v === 'string')) {
    return (
      <div
        className={p.gradient}
        style={{
          background: `linear-gradient(to right, ${stops
            .map(([z, v]) => `${v} ${((x(z) / CHART_W) * 100).toFixed(1)}%`)
            .join(', ')})`,
        }}
      />
    )
  }
  if (!stops.every(([, v]) => typeof v === 'number')) return null
  const values = stops.map(([, v]) => v as number)
  const lo = Math.min(0, ...values)
  const hi = Math.max(...values, lo + 1e-6)
  const y = (v: number) => CHART_H - 4 - ((v - lo) / (hi - lo)) * (CHART_H - 8)
  // Sampled, so an exponential curve bends as MapLibre draws it
  const at = (z: number): number => {
    if (z <= stops[0][0]) return values[0]
    for (let i = 1; i < stops.length; i++) {
      const [z0, z1] = [stops[i - 1][0], stops[i][0]]
      if (z > z1) continue
      if (curve === 'step') return values[i - 1]
      const t = (z - z0) / (z1 - z0 || 1)
      const f =
        curve === 'exponential' && base !== 1
          ? (base ** (t * (z1 - z0)) - 1) / (base ** (z1 - z0) - 1)
          : t
      return values[i - 1] + (values[i] - values[i - 1]) * f
    }
    return values[values.length - 1]
  }
  const points = Array.from({ length: 89 }, (_, i) => i / 4).map(z => `${x(z)},${y(at(z))}`)
  return (
    <svg
      className={p.chart}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label="Value by zoom"
    >
      <line className={p.chartZoom} x1={x(zoom)} x2={x(zoom)} y1={0} y2={CHART_H} />
      <polyline className={p.chartLine} points={points.join(' ')} />
      {stops.map(([z, v]) => (
        <circle key={z} className={p.chartStop} cx={x(z)} cy={y(v as number)} r={2.5} />
      ))}
    </svg>
  )
}
