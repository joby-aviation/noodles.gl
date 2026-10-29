// The style editor's layer inspector, as Maputnik's and Mapbox Studio's: every paint and layout
// property the style spec gives the layer's type, each edited by its type (a number with a
// slider in its units, a color, a menu, a toggle, a list), as a zoom ramp when it follows the
// zoom, or as JSON when it is any other expression. A changed property is marked and can be put
// back to the style's own value.

import cx from 'classnames'
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import {
  type Bezier,
  type Curve,
  curveFactor,
  EASE,
  isExpression,
  type PropSpec,
  propLabel,
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
      spec={spec}
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
  spec,
  zoom,
  onChange,
}: {
  prop: PropSpec
  layerType: string
  styleValue: unknown
  changed: unknown
  spec: StyleSpec
  zoom: number
  onChange: (value: unknown) => void
}) {
  const { operators } = spec
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
                // The value the map shows at its zoom now, so nothing jumps
                onChange(
                  ramp
                    ? spec.valueAt(prop, value, zoom)
                    : rampExpression(rampFrom(value, prop.interpolated))
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
          valueAt={z => spec.valueAt(prop, value, z)}
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

// A CSS color MapLibre can read, once typed in full
const isColor = (text: string) => typeof CSS !== 'undefined' && CSS.supports('color', text.trim())

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
          <TextInput value={(value as string) ?? ''} onChange={onChange} live={isColor} />
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
  accept,
  onChange,
  whileTyping = true,
}: {
  value: number
  min?: number
  max?: number
  label?: string
  // A number refused here goes back to the value
  accept?: (value: number) => boolean
  onChange: (value: number) => void
  // Apply as it is typed; off, on Enter or blur (a stop's zoom, which re-sorts the stops)
  whileTyping?: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  // Typed into, the box keeps its text: the value it set comes back as a number, which would
  // turn `1.` into `1` under the cursor
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(String(+value.toFixed(4)))
  }, [value])
  // A whole number typed applies as it is typed, so the map follows; out of range waits for blur
  const type = (text: string) => {
    setDraft(text)
    if (!whileTyping) return
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n) || n === value) return
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return
    if (accept?.(n) ?? true) onChange(n)
  }
  const commit = () => {
    editing.current = false
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(value))
    const clamped = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? Number.NEGATIVE_INFINITY, n)
    )
    if (clamped !== value && (accept?.(clamped) ?? true)) onChange(clamped)
    else setDraft(String(value))
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={p.numberBox}
      value={draft}
      onFocus={() => {
        editing.current = true
      }}
      onChange={e => type(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function TextInput({
  value,
  onChange,
  live,
}: {
  value: string
  onChange: (value: string) => void
  // Text this accepts applies as it is typed (a color that parses); the rest on blur
  live?: (text: string) => boolean
}) {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  return (
    <input
      type="text"
      className={p.text}
      value={draft}
      onFocus={() => {
        editing.current = true
      }}
      onChange={e => {
        setDraft(e.target.value)
        if (live?.(e.target.value) && e.target.value !== value) onChange(e.target.value)
      }}
      onBlur={() => {
        editing.current = false
        if (draft !== value) onChange(draft)
      }}
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
  { value: 'bezier', label: 'Bezier' },
  { value: 'step', label: 'Step' },
]

/** Stops over the zoom: each a zoom and the value there, blended by the curve between them. */
function RampEditor({
  prop,
  ramp,
  zoom,
  valueAt,
  onChange,
}: {
  prop: PropSpec
  ramp: ZoomRamp
  zoom: number
  // The ramp's value at a zoom, as MapLibre computes it
  valueAt: (zoom: number) => unknown
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
          onChange={e => {
            const curve = e.target.value as Curve
            onChange({
              ...ramp,
              curve,
              ...(curve === 'bezier' ? { bezier: ramp.bezier ?? EASE } : {}),
            })
          }}
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
      <RampChart
        stops={stops}
        curve={ramp.curve}
        base={ramp.base}
        bezier={ramp.bezier}
        zoom={zoom}
        onBezier={bezier => onChange({ ...ramp, bezier })}
      />
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
                // Applied as typed, it would re-sort the stops under the box being typed in
                whileTyping={false}
                // Stops go up the zoom one at a time: two at one zoom is no ramp MapLibre reads
                accept={nz => !stops.some(([oz], j) => j !== i && oz === nz)}
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
        onClick={() => onChange({ ...ramp, stops: [...stops, [here, valueAt(here)]] })}
      >
        + Stop at zoom {here}
      </button>
    </div>
  )
}

const CHART_W = 240
const CHART_H = 44
// Taller while a bezier's handles are on it, with room for a curve that overshoots
const BEZIER_H = 84
const BEZIER_PAD = 14

// Short labels, so the presets and the curve's numbers share one line
const PRESETS: { label: string; title: string; value: Bezier }[] = [
  { label: 'In', title: 'Ease in', value: [0.42, 0, 1, 1] },
  { label: 'Out', title: 'Ease out', value: [0, 0, 0.58, 1] },
  { label: 'In-out', title: 'Ease in and out', value: EASE },
]

/**
 * A ramp over zoom 0–22 with the preview's zoom marked: numbers as their curve, colors as a
 * gradient. A bezier ramp shows its control handles between every pair of stops, as a curve
 * editor's tangents. MapLibre's `cubic-bezier` is one easing for every segment, so dragging
 * any handle reshapes them all. A color ramp's segments each rise from one stop to the next.
 */
function RampChart({
  stops,
  curve,
  base,
  bezier,
  zoom,
  onBezier,
}: {
  stops: [number, unknown][]
  curve: Curve
  base: number
  bezier?: Bezier
  zoom: number
  onBezier: (bezier: Bezier) => void
}) {
  // Drawn at its own width in pixels, so handles and stops keep their size as the pane grows
  // A callback ref: switching curves can draw a different element to measure
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(CHART_W)
  useEffect(() => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || CHART_W))
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  // The zooms the stops span, a zoom either side: stops close together still spread out
  const zMin = Math.max(0, stops[0][0] - 1)
  const zMax = Math.min(24, stops[stops.length - 1][0] + 1)
  const x = (z: number) => ((Math.min(zMax, Math.max(zMin, z)) - zMin) / (zMax - zMin || 1)) * width
  const numbers = stops.every(([, v]) => typeof v === 'number')
  const colors = stops.every(([, v]) => typeof v === 'string')
  const gradient = colors && (
    <div
      className={p.gradient}
      style={{
        background: `linear-gradient(to right, ${stops
          .map(([z, v]) => `${v} ${((x(z) / width) * 100).toFixed(1)}%`)
          .join(', ')})`,
      }}
    />
  )
  const isBezier = curve === 'bezier'
  if (!numbers && !(colors && isBezier)) return <div ref={setEl}>{gradient}</div>

  const b = bezier ?? EASE
  const h = isBezier ? BEZIER_H : CHART_H
  const pad = isBezier ? BEZIER_PAD : 4
  // Numbers on their own scale; colors as each segment's blend from 0 to 1
  const values = numbers ? stops.map(([, v]) => v as number) : undefined
  const lo = values ? Math.min(0, ...values) : 0
  const hi = values ? Math.max(...values, lo + 1e-6) : 1
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2)
  const ends = (i: number): [number, number] => (values ? [values[i - 1], values[i]] : [0, 1])
  const at = (z: number): number => {
    if (z <= stops[0][0]) return ends(1)[0]
    for (let i = 1; i < stops.length; i++) {
      const [z0, z1] = [stops[i - 1][0], stops[i][0]]
      if (z > z1) continue
      const [v0, v1] = ends(i)
      if (curve === 'step') return v0
      return v0 + (v1 - v0) * curveFactor({ curve, base, bezier }, z - z0, z1 - z0)
    }
    return ends(stops.length - 1)[1]
  }
  // Sampled, so an exponential or bezier curve bends as MapLibre draws it; a color ramp's
  // segments are drawn apart, each from 0 to 1
  const line = values
    ? Array.from({ length: 121 }, (_, i) => zMin + ((zMax - zMin) * i) / 120)
        .map(z => `${x(z)},${y(at(z))}`)
        .join(' ')
    : undefined
  const segments = stops.slice(1).map((_, k) => {
    const i = k + 1
    const [z0, z1] = [stops[i - 1][0], stops[i][0]]
    const [v0, v1] = ends(i)
    const [X0, X1, Y0, Y1] = [x(z0), x(z1), y(v0), y(v1)]
    return {
      key: `${z0}-${z1}`,
      box: [X0, X1, Y0, Y1] as const,
      handles: [
        [X0 + b[0] * (X1 - X0), Y0 + b[1] * (Y1 - Y0)],
        [X0 + b[2] * (X1 - X0), Y0 + b[3] * (Y1 - Y0)],
      ] as const,
      path: values
        ? undefined
        : Array.from({ length: 33 }, (_, t) => t / 32)
            .map(t => `${X0 + t * (X1 - X0)},${y(curveFactor({ curve, base, bezier }, t, 1))}`)
            .join(' '),
    }
  })

  // A handle dragged within its segment: the point's place in that segment is the curve's
  const drag =
    (box: readonly [number, number, number, number], handle: 0 | 1) =>
    (e: ReactPointerEvent<SVGCircleElement>) => {
      const svg = e.currentTarget.ownerSVGElement
      const toChart = svg?.getScreenCTM()?.inverse()
      if (!svg || !toChart) return
      e.preventDefault()
      const [X0, X1, Y0, Y1] = box
      const move = (ev: PointerEvent) => {
        const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(toChart)
        const round = (n: number) => Math.round(n * 100) / 100
        const next = [...b] as Bezier
        // x stays in 0–1 so the curve is a function of the zoom; y may overshoot
        next[handle * 2] = round(Math.min(1, Math.max(0, (pt.x - X0) / (X1 - X0 || 1))))
        // A flat segment can't say how far up a handle is; the others keep it
        if (Math.abs(Y1 - Y0) > 1)
          next[handle * 2 + 1] = round(Math.min(1.5, Math.max(-0.5, (pt.y - Y0) / (Y1 - Y0))))
        onBezier(next)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

  return (
    <div ref={setEl} className={p.chartWrap}>
      {isBezier && (
        <div className={p.presets}>
          {PRESETS.map(preset => (
            <button
              key={preset.label}
              type="button"
              title={preset.title}
              className={cx(p.preset, preset.value.join() === b.join() && p.presetOn)}
              onClick={() => onBezier(preset.value)}
            >
              {preset.label}
            </button>
          ))}
          {/* Two decimals each, so dragging a handle doesn't change the row's width */}
          <span className={p.bezierValues} title={b.join(', ')}>
            {b.map(n => n.toFixed(2)).join(', ')}
          </span>
        </div>
      )}
      <svg
        className={cx(p.chart, isBezier && p.chartBezier)}
        width={width}
        height={h}
        viewBox={`0 0 ${width} ${h}`}
        role="img"
        aria-label="Value by zoom"
      >
        {zoom >= zMin && zoom <= zMax && (
          <line className={p.chartZoom} x1={x(zoom)} x2={x(zoom)} y1={0} y2={h} />
        )}
        {line && <polyline className={p.chartLine} points={line} />}
        {segments.map(
          seg => seg.path && <polyline key={seg.key} className={p.chartLine} points={seg.path} />
        )}
        {isBezier &&
          segments.map(seg => {
            const [X0, X1, Y0, Y1] = seg.box
            const [[ax, ay], [bx, by]] = seg.handles
            return (
              <g key={`h-${seg.key}`}>
                <line className={p.bezierArm} x1={X0} y1={Y0} x2={ax} y2={ay} />
                <line className={p.bezierArm} x1={X1} y1={Y1} x2={bx} y2={by} />
                <circle
                  className={p.bezierHandle}
                  cx={ax}
                  cy={ay}
                  r={3.5}
                  aria-label="Bezier handle leaving the stop"
                  onPointerDown={drag(seg.box, 0)}
                />
                <circle
                  className={p.bezierHandle}
                  cx={bx}
                  cy={by}
                  r={3.5}
                  aria-label="Bezier handle entering the stop"
                  onPointerDown={drag(seg.box, 1)}
                />
              </g>
            )
          })}
        {stops.map(([z], i) => (
          <circle
            key={z}
            className={p.chartStop}
            cx={x(z)}
            cy={values ? y(values[i]) : y(i === 0 ? 0 : 1)}
            r={2.5}
          />
        ))}
      </svg>
      {gradient}
    </div>
  )
}
