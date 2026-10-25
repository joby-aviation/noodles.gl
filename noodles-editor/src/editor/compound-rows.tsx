// The Properties panel's compound controls (compound-params.ts): a layer's color as one choice
// of Solid, Attribute, By value or Expression, and a value's units on the value's own row. The
// parts are still the document's own parameters, so each keeps its keyframes, port and menu.

import {
  type DocNode,
  type EditorDoc,
  nameOf,
  OPERATOR_INDEX,
  type ParamDef,
} from '@noodles.gl/planner'
import cx from 'classnames'
import { useEffect, useState } from 'react'
import { analytics } from '../utils/analytics'
import { ChannelInput } from './channel-input'
import { type ColorGroup, type ColorMode, colorValue, rampExpression } from './compound-params'
import s from './doc-editor.module.css'
import { useEngineState } from './doc-engine'
import { setParam } from './doc-ops'
import { docStore } from './doc-store'
import type { NodeFields } from './field-adapter'
import { ParamRow } from './param-row'

const MODES: { mode: ColorMode; label: string; title: string }[] = [
  { mode: 'solid', label: 'Solid', title: 'Solid: one color for every row' },
  { mode: 'attribute', label: 'Attr', title: 'Attribute: an RGB attribute of the rows' },
  { mode: 'ramp', label: 'Ramp', title: 'Ramp: a color ramp over a numeric column' },
  { mode: 'expression', label: 'ƒ', title: 'Expression: a color computed for each row' },
]

const set = (node: DocNode, name: string, value: string | undefined) =>
  docStore().edit(d => setParam(d, node.id, name, value), `p:${node.id}.${name}`)

// The ramp another node already colors with, if any: a Color Ramp node's, or a layer's whose
// channels call ramp()
function rampInUse(doc: EditorDoc, except: string): string | undefined {
  for (const n of doc.nodes) {
    if (n.id === except || typeof n.params.ramp !== 'string') continue
    const callsRamp = Object.values(n.params).some(
      v => typeof v === 'string' && v.includes('ramp(')
    )
    if (n.op === 'color-ramp' || callsRamp) return n.params.ramp
  }
  return undefined
}

// The columns of the rows feeding `port`, from the compiled program
function useInputColumns(doc: EditorDoc, node: DocNode, port: string) {
  const engine = useEngineState()
  const edge = doc.edges.find(e => e.target === node.id && e.targetPort === port)
  return (edge && engine.program?.nodes[edge.source]?.columns) || []
}

export function ColorGroupRows({
  node,
  doc,
  group,
  fields,
  wired,
}: {
  node: DocNode
  doc: EditorDoc
  group: ColorGroup
  fields: NodeFields
  wired: Set<string>
}) {
  const op = OPERATOR_INDEX.get(node.op)
  const def = op?.params.find(p => p.name === group.channel)
  const columns = useInputColumns(doc, node, def?.of ?? 'in')
  const raw = node.params[group.channel]
  const text = typeof raw === 'string' ? raw : ''
  const value = colorValue(text)
  // An empty channel reads as Solid, so a mode just chosen and not yet filled in is kept here
  const [pending, setPending] = useState<ColorMode>()
  if (!def) return null
  // A channel driven by a parameter expression, a reference or a wire: its own row says so
  if (raw !== undefined && typeof raw !== 'string') return paramRow(def)
  const mode = text === '' && pending ? pending : value.mode

  function paramRow(d: ParamDef | undefined, label?: string) {
    const b = d && fields.bindings.get(d.name)
    if (!d || !b) return null
    return (
      <ParamRow
        key={d.name}
        node={node}
        def={d}
        field={b.field}
        wired={wired.has(`par:${d.name}`)}
        label={label}
      />
    )
  }

  const numeric = columns.filter(c => c.type === 'num').map(c => c.name)
  // The program lists a vector attribute (a position, an RGB color) as a number too, so a ramp
  // starts on a numeric column none of the layer's channels already reads
  const channelValues = new Set(
    (op?.params ?? [])
      .map(p => node.params[p.name])
      .filter((v): v is string => typeof v === 'string')
  )
  const firstScalar = numeric.find(c => !channelValues.has(c)) ?? numeric[0]
  const choose = (next: ColorMode) => {
    if (next === mode) return
    analytics.track('color_mode_changed', { mode: next, operatorType: node.op })
    setPending(next)
    if (next === 'solid') return set(node, group.channel, undefined)
    if (next === 'ramp') {
      const column = value.mode === 'ramp' ? value.column : firstScalar
      // The engine binds one color ramp per graph, so start on the one the graph already uses
      const used = group.ramp && rampInUse(doc, node.id)
      return docStore().edit(d => {
        setParam(d, node.id, group.channel, column ? rampExpression(column, 0, 1) : undefined)
        if (group.ramp && used) setParam(d, node.id, group.ramp, used)
      }, `p:${node.id}.${group.channel}`)
    }
    // Attribute and Expression start from what the channel holds, if it suits them
    if (next === 'attribute') return set(node, group.channel, value.column)
    if (value.mode === 'solid') return set(node, group.channel, undefined)
  }

  return (
    <div className={s.compound}>
      <div className={s.paramDriven}>
        <span className={s.paramLabel}>{def.label}</span>
        <fieldset className={s.segmented} aria-label={`${def.label} from`}>
          {MODES.map(m => (
            <button
              key={m.mode}
              type="button"
              className={cx(s.segment, m.mode === mode && s.segmentOn)}
              aria-pressed={m.mode === mode}
              title={m.title}
              onClick={() => choose(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </fieldset>
      </div>
      <div className={s.compoundBody}>
        {mode === 'solid' && paramRow(op?.params.find(p => p.name === group.solid))}
        {mode === 'attribute' && (
          <ChannelInput
            label="Attribute"
            def={def}
            value={text}
            suggestions={columns.map(c => c.name)}
            placeholder="an RGB attribute, such as magnitude_color"
            onCommit={t => set(node, group.channel, t || undefined)}
          />
        )}
        {mode === 'ramp' && (
          <RampControls
            columns={numeric}
            value={value}
            onChange={(column, min, max) =>
              set(node, group.channel, rampExpression(column, min, max))
            }
          />
        )}
        {mode === 'ramp' &&
          paramRow(
            op?.params.find(p => p.name === group.ramp),
            'Ramp'
          )}
        {mode === 'expression' && (
          <ChannelInput
            label="Expression"
            def={def}
            value={text}
            placeholder="ramp(fit(mag, 0, 7, 0, 1))"
            onCommit={t => set(node, group.channel, t || undefined)}
          />
        )}
      </div>
      {mode === 'ramp' && numeric.length === 0 && (
        <div className={s.compoundNote}>{nameOf(node)} has no numeric columns to color by yet.</div>
      )}
    </div>
  )
}

function RampControls({
  columns,
  value,
  onChange,
}: {
  columns: string[]
  value: ReturnType<typeof colorValue>
  onChange: (column: string, min: number, max: number) => void
}) {
  const column = value.column ?? columns[0] ?? ''
  const [min, setMin] = useState(String(value.min ?? 0))
  const [max, setMax] = useState(String(value.max ?? 1))
  useEffect(() => setMin(String(value.min ?? 0)), [value.min])
  useEffect(() => setMax(String(value.max ?? 1)), [value.max])
  const commit = (lo: number, hi: number) => {
    if (column && Number.isFinite(lo) && Number.isFinite(hi)) onChange(column, lo, hi)
  }
  const options = columns.includes(column) || !column ? columns : [column, ...columns]
  return (
    <>
      <div className={s.paramDriven}>
        <span className={s.paramLabel}>Column</span>
        <select
          className={s.compoundSelect}
          aria-label="Column"
          value={column}
          onChange={e => {
            // Columns arrive once the engine has compiled; never write a ramp over none
            if (e.target.value) onChange(e.target.value, Number(min) || 0, Number(max) || 1)
          }}
        >
          {options.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className={s.paramDriven}>
        <span className={s.paramLabel}>Range</span>
        <span className={s.range}>
          {[
            { label: 'From', v: min, setV: setMin },
            { label: 'To', v: max, setV: setMax },
          ].map(({ label, v, setV }) => (
            <input
              key={label}
              type="number"
              aria-label={label}
              className={s.rangeInput}
              value={v}
              onChange={e => setV(e.target.value)}
              // The input's own value, which a fast blur reads before the state catches up
              onBlur={e =>
                label === 'From'
                  ? commit(Number(e.currentTarget.value), Number(max))
                  : commit(Number(min), Number(e.currentTarget.value))
              }
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          ))}
        </span>
      </div>
    </>
  )
}

// A value's units, as a small menu on the value's own row
export function UnitsSelect({ node, def }: { node: DocNode; def: ParamDef }) {
  const value = String(node.params[def.name] ?? def.default)
  return (
    <select
      className={s.unitsSelect}
      aria-label={def.label}
      title={def.label}
      value={value}
      onChange={e =>
        set(node, def.name, e.target.value === def.default ? undefined : e.target.value)
      }
    >
      {(def.options ?? []).map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
