// One parameter of a document node in the parameter pane: the Noodles field widget that edits
// it, or the expression or reference that drives it; a keyframe diamond for numbers; and what
// a change to it costs, from the compiled program's routes (a prop, a requery, a rebuild).

import {
  bindingOf,
  type DocNode,
  isExpr,
  isRef,
  nameOf,
  OPERATOR_INDEX,
  type OpDef,
  type ParamDef,
  type ParamValue,
  resolveRef,
} from '@noodles.gl/planner'
import cx from 'classnames'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { inputComponents } from '../noodles/components/field-components'
import type { Field } from '../noodles/fields'
import { ChannelInput, isChannel } from './channel-input'
import s from './doc-editor.module.css'
import { type EngineState, useEngineState } from './doc-engine'
import { clearTrack, pathTo, promote, removeKey, setKey, setParam } from './doc-ops'
import { docStore, useEditor } from './doc-store'
import { NodeFields } from './field-adapter'
import { startLinkDrag, useParamLinkTarget } from './link-drag'
import { ContextMenu, type MenuItem } from './menus'
import { isRampParam, RampPicker } from './ramp-picker'
import { RefPicker, referenceable } from './ref-picker'

/** Whether a parameter shows, given the values its `when` reads. */
export function shown(def: ParamDef, node: DocNode, op: OpDef): boolean {
  if (!def.when) return true
  const ruled = op.params.find(p => p.name === def.when?.param)
  const value = node.params[def.when.param] ?? ruled?.default
  return def.when.is.includes(value as string | number | boolean)
}

/** The node's fields while it is shown, kept in step with its parameters. */
export function useNodeFields(node: DocNode | undefined): NodeFields | undefined {
  const [fields, setFields] = useState<NodeFields>()
  const timeline = useEditor(s => s.doc.timeline)
  const time = useEditor(s => s.time)
  const id = node?.id
  const op = node?.op
  // biome-ignore lint/correctness/useExhaustiveDependencies: fields are rebuilt only for a new node or operator; parameter changes sync below
  useEffect(() => {
    if (!node) return
    const created = new NodeFields(docStore(), node)
    setFields(created)
    return () => created.dispose()
  }, [id, op])
  useEffect(() => {
    if (node && fields) fields.sync(node, timeline, time)
  }, [node, fields, timeline, time])
  return fields
}

const ROUTE_HELP: Record<string, string> = {
  prop: 'deck applies it as a uniform: no query, no CPU pass',
  uniform: 'a uniform write into the fused GPU kernel',
  cpu: "the layer's CPU stage re-runs; no query",
  requery: "the layer's prepared statement is rebound and re-run",
  rematerialize: 'a relation is rebuilt (memoized by value) and its readers requeried',
  rebuild: 'structural: the graph recompiles; memoization limits it to what changed',
}

/** What changing a parameter costs: the routes the program gives the values it lowered to. */
function routesOf(def: ParamDef, key: string, engine: EngineState) {
  const out: { route: string; target: string }[] = []
  for (const name of engine.lowered?.slotParams[key] ?? []) {
    for (const r of engine.program?.routes[name] ?? []) {
      if (!out.some(x => x.route === r.route && x.target === r.target)) out.push(r)
    }
  }
  const structural = def.kind !== 'field' && bindingOf(def) === 'structural'
  if (out.length === 0 && structural && def.kind !== 'code')
    out.push({ route: 'rebuild', target: '' })
  return out
}

const fmt = (v: unknown): string => {
  if (typeof v === 'number') return Number.isFinite(v) ? String(+v.toFixed(3)) : 'NaN'
  if (Array.isArray(v)) return v.join(', ')
  return v === undefined ? '' : String(v)
}

const KEYABLE = new Set(['float', 'int'])

/** Whether a parameter can be keyframed: a number, the planner's or a Noodles field's. */
const keyable = (def: ParamDef, field: Field) =>
  KEYABLE.has(def.kind) || (def.kind === 'field' && typeof field.value === 'number')

export function ParamRow({
  node,
  def,
  field,
  wired,
  label,
  onUnpromote,
  inline,
}: {
  node: DocNode
  def: ParamDef
  field: Field
  wired: boolean
  /** A promoted parameter's label on its subnet. */
  label?: string
  onUnpromote?: () => void
  /** A control drawn after the value, such as its units */
  inline?: ReactNode
}) {
  const { type } = field.constructor as typeof Field
  const Widget = inputComponents[type]
  const engine = useEngineState()
  const doc = useEditor(st => st.doc)
  const time = useEditor(st => st.time)
  const copied = useEditor(st => st.copiedParam)
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const [picker, setPicker] = useState<{ x: number; y: number }>()
  const key = `${node.id}.${def.name}`
  const raw: ParamValue | undefined = node.params[def.name]
  const mode =
    isExpr(raw) && def.kind !== 'expr' && def.kind !== 'code'
      ? 'expr'
      : isRef(raw)
        ? 'ref'
        : 'literal'
  const track = doc.timeline?.tracks.find(t => t.target === key)
  const atKey = track?.keyframes.some(k => Math.abs(k.time - time) < 1e-3)
  const value = engine.slots.get(key)
  const canKey = keyable(def, field) && !wired && mode === 'literal'
  const wire = doc.edges.find(e => e.target === node.id && e.targetPort === `par:${def.name}`)
  const debug = useEditor(st => st.debug)
  // What a change costs is the planner's business; debug mode shows it
  const routes = debug ? routesOf(def, key, engine) : []
  const numeric = KEYABLE.has(def.kind)
  const linkTarget = useParamLinkTarget(node, def)

  // What this parameter reads, and what reads it
  const source = (() => {
    if (!isRef(raw)) return undefined
    try {
      const k = resolveRef(doc, node, raw.ref)
      const dot = k.lastIndexOf('.')
      const n = doc.nodes.find(x => x.id === k.slice(0, dot))
      const p = n && OPERATOR_INDEX.get(n.op)?.params.find(x => x.name === k.slice(dot + 1))
      return n ? { node: n, label: `${nameOf(n)} › ${p?.label ?? k.slice(dot + 1)}` } : undefined
    } catch {
      return undefined
    }
  })()
  const readers = [
    ...new Set(
      (engine.lowered?.references ?? [])
        .filter(r => r.from === key)
        .map(r => r.to.slice(0, r.to.lastIndexOf('.')))
        .filter(id => id !== node.id)
    ),
  ]
    .map(id => doc.nodes.find(n => n.id === id))
    .filter((n): n is DocNode => !!n)
  const goTo = (n: DocNode) => docStore().set({ network: n.parent, selection: [n.id] })

  const set = (v: ParamValue | undefined) =>
    docStore().edit(d => setParam(d, node.id, def.name, v, docStore().get().time), `p:${key}`)
  const items: MenuItem[] = [
    { heading: `${label ?? def.label} · ${key}` },
    ...(numeric
      ? [
          mode === 'expr'
            ? { label: 'Revert to value', onClick: () => set(Number(value ?? def.default)) }
            : {
                label: 'Set expression…',
                onClick: () => {
                  const e = prompt(
                    "Expression (T = seconds, F = frame, ch('node/param') reads a parameter):",
                    mode === 'ref' && isRef(raw) ? `ch('${raw.ref}')` : String(value ?? def.default)
                  )
                  if (e) set({ expr: e })
                },
              },
        ]
      : []),
    ...(referenceable(def) && !wired
      ? [
          {
            label: 'Reference a parameter…',
            onClick: () => setPicker(menu ?? { x: 200, y: 200 }),
          },
        ]
      : []),
    { label: 'Copy parameter', onClick: () => docStore().set({ copiedParam: key }) },
    {
      label: copied ? `Paste relative reference (${copied})` : 'Paste relative reference',
      disabled: !copied || copied === key,
      onClick: () => {
        if (copied) set({ ref: pathTo(docStore().get().doc, node, copied) })
      },
    },
    ...(mode === 'ref'
      ? [
          {
            label: 'Remove reference',
            onClick: () => set(Number.isFinite(Number(value)) ? Number(value) : undefined),
          },
        ]
      : []),
    { separator: true },
    {
      label: atKey ? 'Update keyframe' : 'Add keyframe at playhead',
      disabled: !canKey,
      onClick: () => docStore().edit(d => setKey(d, key, time, Number(field.value)), `key:${key}`),
    },
    {
      label: 'Remove keyframe here',
      disabled: !atKey,
      onClick: () => docStore().edit(d => removeKey(d, key, time)),
    },
    {
      label: 'Clear keyframes',
      disabled: !track,
      onClick: () => docStore().edit(d => clearTrack(d, key)),
    },
    { separator: true },
    {
      label: 'Revert to default',
      disabled: wired,
      onClick: () =>
        docStore().edit(d => {
          clearTrack(d, key)
          setParam(d, node.id, def.name, undefined)
        }),
    },
    ...(node.parent && !onUnpromote
      ? [
          { separator: true },
          {
            label: 'Promote to subnet',
            onClick: () => docStore().edit(d => promote(d, node.id, def.name, raw ?? def.default)),
          },
        ]
      : []),
    ...(onUnpromote
      ? [{ separator: true }, { label: 'Remove promotion', onClick: onUnpromote }]
      : []),
  ]

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click opens the parameter's menu; a dragged port drops here
    <div
      className={cx(s.paramRow, linkTarget.accepts && s.paramRowLinkTarget)}
      // A field label's tooltip opens when keyboard focus reaches this row's input
      data-field-row
      title={`${def.help ?? def.label}\n${key}`}
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      {...linkTarget.props}
    >
      {referenceable(def) && (
        // biome-ignore lint/a11y/noStaticElementInteractions: dragging the port is the pointer gesture; the link button and the right-click menu make the same link from the keyboard
        <span
          className={cx(s.port, mode === 'ref' && s.portLinked, wire && s.portWired)}
          draggable
          onDragStart={e => {
            e.stopPropagation()
            startLinkDrag(e, { kind: 'param', key })
          }}
          title="Drag onto another property or node to link it to this one"
        />
      )}
      <div className={s.paramMain}>
        {wire ? (
          <div className={s.paramDriven}>
            <span className={s.paramLabel}>{label ?? def.label}</span>
            <span className={s.wired}>
              ← {nameOf(doc.nodes.find(n => n.id === wire.source) ?? node)}
              {value !== undefined ? ` = ${fmt(value)}` : ''}
            </span>
          </div>
        ) : mode === 'ref' ? (
          <div className={s.paramDriven}>
            <span className={s.paramLabel}>{label ?? def.label}</span>
            <span className={s.refChip}>
              <button
                type="button"
                className={s.refChipSource}
                title={`Reads ${isRef(raw) ? raw.ref : ''}. Click to go to it.`}
                onClick={() => source && goTo(source.node)}
              >
                ⛓ {source?.label ?? (isRef(raw) ? raw.ref : '')}
              </button>
              {value !== undefined && <span className={s.evaluated}>{fmt(value)}</span>}
              <button
                type="button"
                className={s.refChipBreak}
                title="Break the reference, keeping its value"
                onClick={() => set(value === undefined ? undefined : (value as ParamValue))}
              >
                ×
              </button>
            </span>
          </div>
        ) : mode !== 'literal' ? (
          <div className={s.paramDriven}>
            <span className={s.paramLabel}>{label ?? def.label}</span>
            <DrivenText
              mode={mode}
              text={isExpr(raw) ? raw.expr : isRef(raw) ? raw.ref : ''}
              onCommit={t => set(mode === 'expr' ? { expr: t } : { ref: t })}
            />
            {value !== undefined && <span className={s.evaluated}>{fmt(value)}</span>}
          </div>
        ) : isRampParam(def) ? (
          <RampPicker
            label={label ?? def.label}
            def={def}
            value={String(raw ?? def.default ?? '')}
            onChange={v => set(v === def.default ? undefined : v)}
          />
        ) : isChannel(def) ? (
          <ChannelInput
            label={label ?? def.label}
            def={def}
            value={String(raw ?? def.default ?? '')}
            // A channel set back to its default leaves the document, as defaults do
            onCommit={t => set(t === def.default ? undefined : t)}
          />
        ) : (
          Widget && (
            // A Noodles widget labels itself with its id: a host operator's input name, else the
            // parameter's label
            <Widget
              id={
                label ?? (OPERATOR_INDEX.get(node.op)?.category === 'host' ? def.name : def.label)
              }
              field={field}
              disabled={false}
            />
          )
        )}
        {inline}
        {/* Link and keyframe buttons share a fixed gutter, so every control ends at the same edge */}
        <span className={s.paramGutter}>
          {referenceable(def) && !wired && mode === 'literal' && (
            <button
              type="button"
              className={s.linkButton}
              title="Reference another node's parameter"
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect()
                setPicker({ x: r.left, y: r.bottom + 4 })
              }}
            >
              ⛓
            </button>
          )}
          {canKey || track ? (
            <button
              type="button"
              className={cx(s.diamond, { [s.diamondTrack]: !!track, [s.diamondOn]: atKey })}
              title={
                atKey ? 'Keyframe at the playhead (click to remove)' : 'Click to set a keyframe'
              }
              disabled={!canKey && !atKey}
              onClick={() =>
                docStore().edit(d => {
                  if (atKey) removeKey(d, key, time)
                  else setKey(d, key, time, Number(field.value))
                })
              }
            />
          ) : null}
        </span>
      </div>
      {readers.length > 0 && (
        <div className={s.readers}>
          used by{' '}
          {readers.map((n, i) => (
            <span key={n.id}>
              {i > 0 && ', '}
              <button type="button" onClick={() => goTo(n)}>
                {nameOf(n)}
              </button>
            </span>
          ))}
        </div>
      )}
      {picker && (
        <RefPicker
          doc={doc}
          node={node}
          def={def}
          x={picker.x}
          y={picker.y}
          onClose={() => setPicker(undefined)}
          onPick={k => {
            set({ ref: pathTo(docStore().get().doc, node, k) })
            setPicker(undefined)
          }}
        />
      )}
      {linkTarget.picker}
      {routes.length > 0 && (
        <div className={s.routes}>
          {routes.map(r => (
            <span
              key={r.route + r.target}
              className={cx(s.route, s[`route_${r.route}`])}
              title={`${ROUTE_HELP[r.route] ?? r.route}${r.target ? ` → ${r.target}` : ''}`}
            >
              {r.route}
              {r.target && routes.length > 1 ? ` ${r.target}` : ''}
            </span>
          ))}
        </div>
      )}
      {menu &&
        createPortal(
          <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(undefined)} />,
          document.body
        )}
    </div>
  )
}

/** An expression or a reference, edited as text: commits on Enter or blur. */
function DrivenText({
  mode,
  text,
  onCommit,
}: {
  mode: 'expr' | 'ref'
  text: string
  onCommit: (text: string) => void
}) {
  const [draft, setDraft] = useState(text)
  useEffect(() => setDraft(text), [text])
  return (
    <input
      type="text"
      spellCheck={false}
      className={mode === 'expr' ? s.exprMode : s.refMode}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== text) onCommit(draft)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(text)
      }}
    />
  )
}
