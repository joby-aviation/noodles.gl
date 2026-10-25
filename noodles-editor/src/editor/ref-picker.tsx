// Choosing a parameter to reference, as Houdini's channel reference or a Blender driver: every
// parameter of the same kind on another node, searchable by node and parameter name. The
// reference is a relative path, so it keeps working when nodes are renamed or moved.

import {
  type DocNode,
  type EditorDoc,
  nodePath,
  OPERATOR_INDEX,
  type ParamDef,
} from '@noodles.gl/planner'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import s from './doc-editor.module.css'
import { shownValue } from './node-summary'

// Parameters a reference can join: a value of one fits the other
const GROUP: Record<string, string> = {
  float: 'number',
  int: 'number',
  toggle: 'toggle',
  color: 'color',
  string: 'text',
  text: 'text',
  menu: 'text',
  column: 'text',
  url: 'text',
  expr: 'text',
}

export const referenceable = (def: ParamDef) => def.kind in GROUP

/** Whether a value of `a` fits `b`, so one can reference the other. */
export const sameKind = (a: ParamDef, b: ParamDef) =>
  GROUP[a.kind] !== undefined && GROUP[a.kind] === GROUP[b.kind]

export interface Candidate {
  key: string
  node: DocNode
  def: ParamDef
  label: string
}

/** Parameters `def` on `node` can reference: the same kind of value, on any other node. */
export function candidates(doc: EditorDoc, node: DocNode, def: ParamDef): Candidate[] {
  const group = GROUP[def.kind]
  if (!group) return []
  const out: Candidate[] = []
  for (const n of doc.nodes) {
    if (n.id === node.id) continue
    for (const p of OPERATOR_INDEX.get(n.op)?.params ?? []) {
      if (GROUP[p.kind] !== group) continue
      out.push({
        key: `${n.id}.${p.name}`,
        node: n,
        def: p,
        label: `${nodePath(doc, n)} › ${p.label}`,
      })
    }
  }
  return out
}

export function RefPicker({
  doc,
  node,
  def,
  x,
  y,
  onPick,
  onClose,
  items,
  placeholder,
}: {
  doc: EditorDoc
  node: DocNode
  def: ParamDef
  x: number
  y: number
  onPick: (key: string) => void
  onClose: () => void
  /** The parameters to choose from, when not every one `def` could reference */
  items?: Candidate[]
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const all = useMemo(() => items ?? candidates(doc, node, def), [items, doc, node, def])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? all.filter(c => c.label.toLowerCase().includes(q)) : all
  }, [all, query])
  useEffect(() => setActive(0), [])
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className={s.refPicker}
      style={{
        left: Math.min(x, window.innerWidth - 320),
        top: Math.min(y, window.innerHeight - 320),
      }}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the picker opens to be typed into
        autoFocus
        className={s.refPickerSearch}
        placeholder={placeholder ?? `Reference a ${def.kind === 'color' ? 'color' : 'parameter'}…`}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'ArrowDown') setActive(a => Math.min(a + 1, shown.length - 1))
          if (e.key === 'ArrowUp') setActive(a => Math.max(a - 1, 0))
          if (e.key === 'Enter' && shown[active]) onPick(shown[active].key)
        }}
      />
      <div className={s.refPickerList} role="listbox">
        {shown.length === 0 && <div className={s.refPickerEmpty}>Nothing to reference</div>}
        {shown.map((c, i) => (
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            key={c.key}
            className={s.refPickerItem}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(c.key)}
          >
            <span>{c.label}</span>
            <span className={s.refPickerValue}>
              {shownValue(c.node.params[c.def.name] ?? c.def.default)}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}
