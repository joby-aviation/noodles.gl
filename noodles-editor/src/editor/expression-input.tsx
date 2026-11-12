// A text input for an expression or a column name with the input table's columns as you type:
// a list under the input, filtered by the word at the caret. Arrow keys move through it, Enter
// or Tab takes one, Escape closes it. An empty expression lists every column, so the input
// doubles as a way to see what the rows hold.

import { type DocNode, parseExpr } from '@noodles.gl/planner'
import cx from 'classnames'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FieldLabel } from '../noodles/components/field-components'
import type { Field } from '../noodles/fields'
import ns from '../noodles/noodles.module.css'
import s from './doc-editor.module.css'
import { useEngineState } from './doc-engine'
import { useEditor } from './doc-store'
import {
  applyCompletion,
  type ColumnInfo,
  type Completion,
  completionsAt,
} from './expression-completion'

/** The columns of the table wired into `port` of `node`, once the engine has planned it. */
export function useInputColumns(node: DocNode, port: string | undefined): ColumnInfo[] {
  const wire = useEditor(st =>
    port ? st.doc.edges.find(e => e.target === node.id && e.targetPort === port) : undefined
  )
  const { lowered, program } = useEngineState()
  return useMemo(() => {
    if (!wire) return []
    const ir = lowered?.outputs[wire.source]?.[wire.sourcePort]
    const columns = ir ? (program?.nodes[ir]?.columns ?? []) : []
    return columns.map(c => ({ name: c.name, type: c.duckType }))
  }, [wire, lowered, program])
}

const MAX_SHOWN = 50

// Inputs holding text not yet written to the document (an expression that doesn't parse yet).
// Leaving the input writes it; leaving the page first would lose it.
const unwritten = new Set<string>()

/** Whether an expression input holds an edit the document doesn't have yet. */
export const hasUnwrittenEdit = (): boolean => unwritten.size > 0

const listWidth = (box: DOMRect) => Math.max(box.width, 240)

export function ExpressionInput({
  id,
  field,
  mode,
  columns,
}: {
  id: string
  field: Field
  mode: 'expr' | 'column'
  columns: ColumnInfo[]
}) {
  const [text, setText] = useState(String(field.value ?? ''))
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [box, setBox] = useState<DOMRect>()
  const input = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)

  useEffect(() => {
    const sub = field.subscribe(v => {
      if (typeof v !== 'function') setText(String(v ?? ''))
    })
    return () => sub.unsubscribe()
  }, [field])

  const found = open ? completionsAt(mode, text, caret, columns) : undefined
  const items = found?.items.slice(0, MAX_SHOWN) ?? []
  const shown = items.length > 0
  const listId = `${id.replace(/\W/g, '_')}-completions`

  // An input that goes away mid-edit (another node selected) is no longer holding one
  useEffect(() => () => void unwritten.delete(listId), [listId])

  // The list sits under the input, outside the pane so its scrolling cannot clip it. The
  // input moves as the pane lays out and grows a line at a time, so its box is read after
  // every render while the list shows.
  useLayoutEffect(() => {
    if (!shown || !input.current) return
    const r = input.current.getBoundingClientRect()
    if (!box || r.left !== box.left || r.bottom !== box.bottom || r.width !== box.width) setBox(r)
  })

  // Put the caret after a taken completion once React has written the new text
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !input.current) return
    input.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })

  const write = (next: string) => {
    setText(next)
    if (next !== field.value) field.setValue(next as never)
  }

  // While typing, only text the engine can run reaches the document, so a half-typed
  // expression doesn't blank the layers drawing from it. Leaving the input writes what is there.
  const runnable = (next: string) => {
    if (mode === 'column') return columns.length === 0 || columns.some(c => c.name === next)
    try {
      parseExpr(next)
      return true
    } catch {
      return false
    }
  }
  const type = (next: string) => {
    if (runnable(next)) {
      unwritten.delete(listId)
      write(next)
    } else {
      unwritten.add(listId)
      setText(next)
    }
  }

  const take = (item: Completion) => {
    if (!found) return
    const next = applyCompletion(text, found.word, item)
    write(next.text)
    pendingCaret.current = next.caret
    setCaret(next.caret)
    setActive(0)
    // After a function the list offers its first argument; after a column it closes
    setOpen(item.kind === 'function')
  }

  const readCaret = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length)

  return (
    <div className={cx(ns.fieldWrapper, 'field-row', 'nokey')}>
      <FieldLabel id={id} field={field as never} />
      <div className={cx(ns.fieldInputWrapper, 'field-input')}>
        <textarea
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={shown}
          aria-activedescendant={shown ? `${listId}-${active}` : undefined}
          className={cx(ns.fieldInput, ns.fieldTextarea, s.exprInput)}
          spellCheck={false}
          autoComplete="off"
          rows={Math.max(1, text.split('\n').length)}
          value={text}
          placeholder={mode === 'expr' ? 'An expression of the columns' : 'A column'}
          onFocus={e => {
            readCaret(e.currentTarget)
            setOpen(true)
          }}
          onBlur={() => {
            setOpen(false)
            unwritten.delete(listId)
            write(text)
          }}
          onChange={e => {
            type(e.currentTarget.value)
            readCaret(e.currentTarget)
            setActive(0)
            setOpen(true)
          }}
          onSelect={e => readCaret(e.currentTarget)}
          onClick={() => setOpen(true)}
          onKeyDown={e => {
            if (!shown) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setOpen(true)
              }
              return
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setActive(i => (i + step + items.length) % items.length)
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              take(items[Math.min(active, items.length - 1)])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
      </div>
      {shown &&
        box &&
        createPortal(
          <div
            id={listId}
            role="listbox"
            className={cx(ns.stringLiteralSuggestions, s.exprCompletions)}
            style={{
              position: 'fixed',
              top: box.bottom,
              // Wider than a narrow input, and kept inside the window
              left: Math.max(4, Math.min(box.left, window.innerWidth - listWidth(box) - 4)),
              width: listWidth(box),
            }}
          >
            {items.map((item, i) => (
              <div
                key={`${item.kind}:${item.label}`}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={cx(ns.stringLiteralSuggestion, s.exprCompletion, {
                  [ns.stringLiteralSuggestionActive]: i === active,
                })}
                onMouseEnter={() => setActive(i)}
                // Keep focus in the input, so taking one does not also close the list
                onMouseDown={e => {
                  e.preventDefault()
                  take(item)
                }}
              >
                <span className={item.kind === 'function' ? s.exprFunction : s.exprColumn}>
                  {item.label}
                </span>
                <span className={s.exprDetail}>{item.detail}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
