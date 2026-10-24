// The add-node menu (Tab, or right-click the canvas) and the node and wire context menus.

import { OPERATORS, type OpDef } from '@noodles.gl/planner'
import cx from 'classnames'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_ORDER } from './categories'
import s from './doc-editor.module.css'

const order = (category: string) => (CATEGORY_ORDER as readonly string[]).indexOf(category)
const HIDDEN = new Set(['subnet-input', 'subnet-output', 'deck'])
// A subnet's input and output nodes belong inside one
const SUBNET_ONLY = new Set(['subnet-input', 'subnet-output'])

/** Type to filter, arrows to move, Enter to place. */
export function AddNodeMenu({
  x,
  y,
  onPick,
  onClose,
  filter,
  inSubnet,
}: {
  x: number
  y: number
  onPick: (op: OpDef) => void
  onClose: () => void
  filter?: (op: OpDef) => boolean
  inSubnet?: boolean
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return OPERATORS.filter(
      o => (!HIDDEN.has(o.type) || (inSubnet && SUBNET_ONLY.has(o.type))) && (!filter || filter(o))
    )
      .filter(
        o =>
          !q ||
          o.label.toLowerCase().includes(q) ||
          o.type.toLowerCase().includes(q) ||
          o.category.includes(q)
      )
      .sort((a, b) => order(a.category) - order(b.category))
  }, [query, filter, inSubnet])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query moves the highlight back to the top
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [onClose])

  let lastCategory = ''
  return (
    <div
      className={s.tabMenu}
      ref={ref}
      style={{
        left: Math.min(x, window.innerWidth - 310),
        top: Math.min(y, window.innerHeight - 420),
      }}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the menu opens to be typed into
        autoFocus
        placeholder="Add operator…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive(a => Math.min(items.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive(a => Math.max(0, a - 1))
          } else if (e.key === 'Enter' && items[active]) {
            onPick(items[active])
          } else if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <div className={s.list}>
        {items.map((o, i) => {
          const heading =
            o.category !== lastCategory ? (
              <div className={s.category} key={`c-${o.category}`}>
                {o.category}
              </div>
            ) : null
          lastCategory = o.category
          return [
            heading,
            <div
              key={o.type}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              className={cx(s.item, { [s.itemActive]: i === active })}
              title={o.description}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(o)}
            >
              <span>{o.label}</span>
              <small>{o.description}</small>
            </div>,
          ]
        })}
        {items.length === 0 && <div className={s.category}>nothing matches</div>}
      </div>
    </div>
  )
}

export interface MenuItem {
  label?: string
  onClick?: () => void
  disabled?: boolean
  separator?: boolean
  heading?: string
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div
      className={s.menu}
      ref={ref}
      style={{
        left: Math.min(x, window.innerWidth - 200),
        top: Math.min(y, window.innerHeight - items.length * 28 - 10),
      }}
    >
      {items.map((it, i) => {
        const key = it.label ?? it.heading ?? `separator-${i}`
        if (it.separator) return <hr key={key} />
        if (it.heading)
          return (
            <div className={s.menuHeading} key={key}>
              {it.heading}
            </div>
          )
        return (
          <button
            type="button"
            key={key}
            disabled={it.disabled}
            onClick={() => {
              it.onClick?.()
              onClose()
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
