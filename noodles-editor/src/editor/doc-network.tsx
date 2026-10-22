// The network editor: React Flow drawing the document. Nothing here holds graph state: nodes
// and edges are derived from the document on every change, and every gesture is a document
// edit (one undo step), except positions in flight during a drag.

import { nameOf, OPERATOR_INDEX, type OpDef } from '@noodles.gl/planner'
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type Node,
  type NodeChange,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import nodeStyles from '../noodles/noodles.module.css'
import { DocNodeComponent } from './doc-node'
import {
  addNode,
  type Clip,
  connect,
  copyNodes,
  insertOnEdge,
  pasteNodes,
  removeEdges,
  removeNodes,
  validConnection,
} from './doc-ops'
import { docStore, useEditor } from './doc-store'
import { AddNodeMenu, ContextMenu, type MenuItem } from './menus'

const nodeTypes = { doc: DocNodeComponent }

const PORT_COLOR: Record<string, string> = {
  table: '#22c55e',
  layer: '#e04ddd',
  number: '#ef4444',
  value: '#8a92a6',
}

type Menu =
  | { kind: 'add'; x: number; y: number; flow: { x: number; y: number }; edge?: string }
  | { kind: 'node'; x: number; y: number; id: string }
  | { kind: 'edge'; x: number; y: number; id: string }

const CLIP_TYPE = 'application/x-noodles-doc-nodes'
let clipboard: Clip | undefined

/** Copy the selection: kept here, and as JSON on the system clipboard for other tabs. */
export function copySelection(): boolean {
  const { doc, selection } = docStore().get()
  if (!selection.length) return false
  clipboard = copyNodes(doc, selection)
  void navigator.clipboard
    ?.writeText(JSON.stringify({ type: CLIP_TYPE, ...clipboard }))
    .catch(() => {})
  return true
}

export async function pasteClipboard(): Promise<void> {
  let clip = clipboard
  try {
    const text = await navigator.clipboard?.readText()
    const parsed = text ? JSON.parse(text) : undefined
    if (parsed?.type === CLIP_TYPE) clip = { nodes: parsed.nodes, edges: parsed.edges }
  } catch {
    // Not ours, or no permission: the in-page copy stands.
  }
  if (!clip?.nodes.length) return
  const store = docStore()
  let pasted: string[] = []
  const data = clip
  store.edit(d => {
    pasted = pasteNodes(d, data, store.get().network)
  })
  store.set({ selection: pasted })
}

export const canPaste = () => !!clipboard?.nodes.length

const tablePassThrough = (o: OpDef) =>
  o.inputs.some(p => p.type === 'table') && o.outputs.some(p => p.type === 'table')

export function DocNetwork() {
  const doc = useEditor(s => s.doc)
  const network = useEditor(s => s.network)
  const selection = useEditor(s => s.selection)
  const flow = useReactFlow()
  const [menu, setMenu] = useState<Menu>()
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({})
  const mouse = useRef({ x: 200, y: 200 })

  const nodes: Node[] = useMemo(
    () =>
      doc.nodes
        .filter(n => n.parent === network)
        .map(n => ({
          id: n.id,
          type: 'doc',
          position: dragPos[n.id] ?? { x: n.x, y: n.y },
          selected: selection.includes(n.id),
          dragHandle: `.${nodeStyles.dragHandle}`,
          data: {},
        })),
    [doc.nodes, network, selection, dragPos]
  )

  const edges: Edge[] = useMemo(() => {
    const here = new Set(nodes.map(n => n.id))
    return doc.edges
      .filter(e => here.has(e.source) && here.has(e.target))
      .map(e => {
        const src = doc.nodes.find(n => n.id === e.source)
        const type =
          OPERATOR_INDEX.get(src?.op ?? '')?.outputs.find(p => p.name === e.sourcePort)?.type ??
          'value'
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourcePort,
          targetHandle: e.targetPort,
          style: { stroke: PORT_COLOR[type], strokeWidth: 1.6, opacity: 0.85 },
          label: e.index !== undefined && e.index > 0 ? String(e.index) : undefined,
        }
      })
  }, [doc, nodes])

  // Positions live here while a drag is in flight and reach the document once, on release: a
  // document edit per pointer move would lower the whole graph on every frame of a drag.
  const dragRef = useRef<Record<string, { x: number; y: number }>>({})
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const store = docStore()
    const selects = changes.filter(
      (c): c is Extract<NodeChange, { type: 'select' }> => c.type === 'select'
    )
    if (selects.length) {
      const next = new Set(store.get().selection)
      for (const c of selects) {
        if (c.selected) next.add(c.id)
        else next.delete(c.id)
      }
      store.set({ selection: [...next] })
    }
    const finished: string[] = []
    let moved = false
    for (const c of changes) {
      if (c.type !== 'position') continue
      if (c.position) {
        dragRef.current[c.id] = c.position
        moved = true
      }
      if (c.dragging === false) finished.push(c.id)
    }
    if (finished.length) {
      const commit = { ...dragRef.current }
      store.edit(d => {
        for (const id of finished) {
          const p = commit[id]
          const n = d.nodes.find(x => x.id === id)
          if (n && p) {
            n.x = Math.round(p.x)
            n.y = Math.round(p.y)
          }
        }
      }, 'move')
      for (const id of finished) delete dragRef.current[id]
    }
    if (moved || finished.length) setDragPos({ ...dragRef.current })
  }, [])

  const isValidConnection = useCallback(
    (c: Connection | Edge) =>
      validConnection(
        docStore().get().doc,
        c.source,
        c.sourceHandle ?? 'out',
        c.target,
        c.targetHandle ?? 'in'
      ),
    []
  )

  const onConnect = useCallback((c: Connection) => {
    docStore().edit(d => {
      connect(d, c.source, c.sourceHandle ?? 'out', c.target, c.targetHandle ?? 'in')
    })
  }, [])

  const deleteSelection = useCallback(() => {
    const store = docStore()
    const ids = store.get().selection
    if (!ids.length) return
    store.edit(d => removeNodes(d, ids))
    store.set({ selection: [] })
  }, [])

  const place = (op: OpDef, at: { x: number; y: number }, edge?: string) => {
    const store = docStore()
    let created: string | undefined
    store.edit(d => {
      const n = edge ? insertOnEdge(d, edge, op.type) : addNode(d, op.type, at.x, at.y, network)
      created = n?.id
    })
    if (created) store.set({ selection: [created] })
    setMenu(undefined)
  }

  const toggleBypass = () => {
    const store = docStore()
    const ids = store.get().selection
    if (!ids.length) return
    store.edit(d => {
      for (const n of d.nodes) {
        if (ids.includes(n.id)) n.flags = { ...n.flags, bypass: !n.flags?.bypass }
      }
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) docStore().redo()
      else docStore().undo()
    } else if (meta && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      docStore().redo()
    } else if (meta && e.key.toLowerCase() === 'c') {
      if (copySelection()) e.preventDefault()
    } else if (meta && e.key.toLowerCase() === 'v') {
      e.preventDefault()
      void pasteClipboard()
    } else if (meta && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      if (copySelection()) void pasteClipboard()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const { x, y } = mouse.current
      setMenu({ kind: 'add', x, y, flow: flow.screenToFlowPosition({ x, y }) })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteSelection()
    } else if (e.key === 'b' && !meta) {
      toggleBypass()
    } else if (e.key === 'f' && !meta) {
      void flow.fitView({ padding: 0.15, duration: 250 })
    }
  }

  const nodeMenu = (id: string): MenuItem[] => {
    const n = doc.nodes.find(x => x.id === id)
    if (!n) return []
    return [
      { heading: `${nameOf(n)} · ${OPERATOR_INDEX.get(n.op)?.label ?? n.op}` },
      { label: n.flags?.bypass ? 'Un-bypass  (B)' : 'Bypass  (B)', onClick: toggleBypass },
      { separator: true },
      { label: 'Delete  (⌫)', onClick: deleteSelection },
    ]
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the canvas takes the editor's keyboard shortcuts
    <div
      className="react-flow-wrapper"
      style={{ position: 'absolute', inset: 0 }}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerMove={e => {
        mouse.current = { x: e.clientX, y: e.clientY }
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        onNodeContextMenu={(e, n) => {
          e.preventDefault()
          if (!docStore().get().selection.includes(n.id)) docStore().set({ selection: [n.id] })
          setMenu({ kind: 'node', x: e.clientX, y: e.clientY, id: n.id })
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault()
          setMenu({ kind: 'edge', x: e.clientX, y: e.clientY, id: edge.id })
        }}
        onPaneContextMenu={e => {
          e.preventDefault()
          setMenu({
            kind: 'add',
            x: e.clientX,
            y: e.clientY,
            flow: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
          })
        }}
        onPaneClick={() => docStore().set({ selection: [] })}
      >
        <Background />
        <Controls position="bottom-right" />
      </ReactFlow>
      {menu?.kind === 'add' && (
        <AddNodeMenu
          x={menu.x}
          y={menu.y}
          filter={menu.edge ? tablePassThrough : undefined}
          onPick={op => place(op, menu.flow, menu.edge)}
          onClose={() => setMenu(undefined)}
        />
      )}
      {menu?.kind === 'node' && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={nodeMenu(menu.id)}
          onClose={() => setMenu(undefined)}
        />
      )}
      {menu?.kind === 'edge' && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            {
              label: 'Insert node here…',
              onClick: () =>
                setTimeout(() =>
                  setMenu({
                    kind: 'add',
                    x: menu.x,
                    y: menu.y,
                    flow: { x: 0, y: 0 },
                    edge: menu.id,
                  })
                ),
            },
            {
              label: 'Delete wire',
              onClick: () => docStore().edit(d => removeEdges(d, [menu.id])),
            },
          ]}
        />
      )}
    </div>
  )
}
