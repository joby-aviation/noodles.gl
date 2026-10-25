// The Layers editor: what the deck draws, top layer first, each layer's nodes nested under
// it (editor/layer-stack.ts). Click a row to edit it in Properties, drag a layer to move it up
// or down, and use the eye to hide it.

import { nameOf, OPERATOR_INDEX } from '@noodles.gl/planner'
import cx from 'classnames'
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { docStore, useEditor } from '../../editor/doc-store'
import { layerStack, moveLayer } from '../../editor/layer-stack'
import { useUIStore } from '../../editor/ui-store'
import { setEditorShown } from '../../editor/workspace-store'
import { analytics } from '../../utils/analytics'
import s from './layer-stack.module.css'
import { getOperatorCategory } from './node-tree-sidebar'

type Section = 'scene' | 'unused'

const select = (id: string) => docStore().set({ selection: [id] })

// Open the graph on a node: an area for it if none shows it, then pan to it and pulse it
function showInGraph(id: string) {
  const store = docStore()
  const node = store.get().doc.nodes.find(n => n.id === id)
  setEditorShown('graph', true)
  store.set({ network: node?.parent, selection: [id] })
  useUIStore.getState().focusNodeFromMap(id)
}

export function LayerStack() {
  const doc = useEditor(st => st.doc)
  const selection = useEditor(st => st.selection)
  const stack = useMemo(() => layerStack(doc), [doc])
  const byId = useMemo(() => new Map(doc.nodes.map(n => [n.id, n])), [doc])

  const [open, setOpen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const focusTrigger = useUIStore(state => state.sidebarSearchFocusTrigger)
  // The layer being dragged, and the stack position it would land at
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null)

  useEffect(() => {
    if (focusTrigger > 0) searchRef.current?.focus()
  }, [focusTrigger])

  // Open the layer that feeds a newly selected node, so the selection is on screen. Only on a
  // new selection: an edit to the document leaves a layer the user closed closed.
  const stackRef = useRef(stack)
  stackRef.current = stack
  useEffect(() => {
    const id = selection[0]
    const owner = id && stackRef.current.layers.find(l => l.upstream.includes(id))
    if (owner) setOpen(prev => (prev.has(owner.id) ? prev : new Set(prev).add(owner.id)))
  }, [selection])

  const toggle = (key: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const q = query.trim().toLowerCase()
  const matches = (id: string) => {
    if (!q) return true
    const n = byId.get(id)
    if (!n) return false
    const label = OPERATOR_INDEX.get(n.op)?.label ?? n.op
    return nameOf(n).toLowerCase().includes(q) || label.toLowerCase().includes(q)
  }

  const onDrop = () => {
    if (!drag) return
    const from = stack.layers.findIndex(l => l.id === drag.id)
    // `to` counts the dragged layer's own slot; moveLayer counts without it
    const position = drag.to > from ? drag.to - 1 : drag.to
    if (position !== from) {
      docStore().edit(d => moveLayer(d, drag.id, position), 'layer-order')
      analytics.track('layer_reordered', { from, to: position, layers: stack.layers.length })
    }
    setDrag(null)
  }

  const overLayer = (e: DragEvent, index: number) => {
    if (!drag) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const to = e.clientY < rect.top + rect.height / 2 ? index : index + 1
    if (to !== drag.to) setDrag({ ...drag, to })
  }

  const toggleVisible = (id: string, visible: boolean) => {
    docStore().edit(d => {
      const n = d.nodes.find(x => x.id === id)
      if (n) n.flags = { ...n.flags, bypass: visible }
    })
    analytics.track('layer_panel_toggle_visible', { visible: !visible })
  }

  const row = (id: string, depth: number, extra?: { sharedWith?: string[] }) => {
    const n = byId.get(id)
    if (!n) return null
    const category = getOperatorCategory(n.op)
    const others = extra?.sharedWith?.map(l => byId.get(l)).filter(Boolean)
    return (
      <NodeRow
        key={`${depth}:${id}`}
        id={id}
        name={nameOf(n)}
        type={OPERATOR_INDEX.get(n.op)?.label ?? n.op}
        color={category ? `var(--node-${category}-color)` : undefined}
        depth={depth}
        selected={selection.includes(id)}
        shared={others ? `Also feeds ${others.map(o => nameOf(o!)).join(', ')}` : undefined}
      />
    )
  }

  const section = (key: Section, label: string, ids: string[]) => {
    const shown = ids.filter(matches)
    if (shown.length === 0) return null
    const expanded = Boolean(q) || open.has(key)
    return (
      <div className={s.section}>
        <button type="button" className={s.sectionHeader} onClick={() => toggle(key)}>
          <i className={cx('pi', expanded ? 'pi-chevron-down' : 'pi-chevron-right')} />
          {label}
          <span className={s.count}>{shown.length}</span>
        </button>
        {expanded && shown.map(id => row(id, 1))}
      </div>
    )
  }

  return (
    <div className={s.container}>
      <div className={s.search}>
        <input
          ref={searchRef}
          className={s.searchInput}
          placeholder="Find layer or node…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setQuery('')
              searchRef.current?.blur()
            }
          }}
        />
        {query && (
          <button
            type="button"
            className={s.searchClear}
            onClick={() => setQuery('')}
            title="Clear search"
          >
            <i className="pi pi-times" />
          </button>
        )}
      </div>

      <div className={s.list}>
        {stack.layers.length === 0 && !q && (
          <div className={s.empty}>
            Nothing is drawn yet.
            <br />
            Import data or add a layer node to get started.
          </div>
        )}

        {stack.layers.map((layer, index) => {
          const n = byId.get(layer.id)
          if (!n) return null
          const children = layer.upstream.filter(matches)
          if (q && !matches(layer.id) && children.length === 0) return null
          const expanded = (Boolean(q) && children.length > 0) || open.has(layer.id)
          const category = getOperatorCategory(n.op)
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: drop target for reordering; the rows inside are the controls
            <div
              key={layer.id}
              className={cx(
                s.layer,
                drag?.id === layer.id && s.dragging,
                drag && drag.to === index && s.dropBefore,
                drag && drag.to === index + 1 && index === stack.layers.length - 1 && s.dropAfter
              )}
              onDragOver={e => overLayer(e, index)}
              onDrop={e => {
                e.preventDefault()
                onDrop()
              }}
            >
              {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging is the pointer gesture; Alt+Up and Alt+Down on the name move a layer from the keyboard */}
              <div
                className={cx(s.row, s.layerRow, selection.includes(layer.id) && s.selected)}
                style={{ borderLeftColor: category ? `var(--node-${category}-color)` : undefined }}
                draggable={!q}
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', layer.id)
                  setDrag({ id: layer.id, to: index })
                }}
                onDragEnd={() => setDrag(null)}
              >
                <button
                  type="button"
                  className={s.chevron}
                  onClick={() => toggle(layer.id)}
                  title={expanded ? 'Hide its nodes' : 'Show its nodes'}
                  disabled={layer.upstream.length === 0}
                >
                  <i className={cx('pi', expanded ? 'pi-chevron-down' : 'pi-chevron-right')} />
                </button>
                <button
                  type="button"
                  className={s.rowMain}
                  onClick={() => select(layer.id)}
                  onKeyDown={e => {
                    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                    e.preventDefault()
                    const to = index + (e.key === 'ArrowUp' ? -1 : 1)
                    if (to < 0 || to >= stack.layers.length) return
                    docStore().edit(d => moveLayer(d, layer.id, to), 'layer-order')
                    analytics.track('layer_reordered', {
                      from: index,
                      to,
                      layers: stack.layers.length,
                    })
                  }}
                  title="Alt+Up or Alt+Down moves the layer"
                >
                  <span className={cx(s.name, !layer.visible && s.hidden)}>{nameOf(n)}</span>
                  <span className={s.type}>{OPERATOR_INDEX.get(n.op)?.label ?? n.op}</span>
                </button>
                <button
                  type="button"
                  className={s.rowAction}
                  onClick={() => showInGraph(layer.id)}
                  title="Show in node graph"
                >
                  <i className="pi pi-sitemap" />
                </button>
                <button
                  type="button"
                  className={cx(s.eye, !layer.visible && s.eyeOff)}
                  onClick={() => toggleVisible(layer.id, layer.visible)}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                >
                  <i className={layer.visible ? 'pi pi-eye' : 'pi pi-eye-slash'} />
                </button>
              </div>
              {expanded &&
                children.map(id =>
                  row(id, 1, { sharedWith: stack.shared.get(id)?.filter(l => l !== layer.id) })
                )}
            </div>
          )
        })}

        {section('scene', 'Scene', stack.scene)}
        {section('unused', 'Not drawn', stack.unused)}
      </div>
    </div>
  )
}

function NodeRow({
  id,
  name,
  type,
  color,
  depth,
  selected,
  shared,
}: {
  id: string
  name: string
  type: string
  color?: string
  depth: number
  selected: boolean
  shared?: string
}) {
  return (
    <div
      className={cx(s.row, selected && s.selected)}
      style={{ paddingLeft: 8 + depth * 18, borderLeftColor: color }}
    >
      <button type="button" className={s.rowMain} onClick={() => select(id)}>
        <span className={s.name}>{name}</span>
        <span className={s.type}>{type}</span>
      </button>
      {shared && (
        <span className={s.shared} title={shared}>
          <i className="pi pi-link" />
        </span>
      )}
      <button
        type="button"
        className={s.rowAction}
        onClick={() => showInGraph(id)}
        title="Show in node graph"
      >
        <i className="pi pi-sitemap" />
      </button>
    </div>
  )
}
