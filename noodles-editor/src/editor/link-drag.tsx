// The drag half of parameter links (param-links.ts): starting a drag from a port or a node row,
// and the drop targets on property rows, output rows and node rows. A port drags with the
// pointer and draws a line from the port to the pointer, as the node graph's wires do, snapping
// to the port of a row that can take it. A node row drags with the browser's drag and drop, as
// the layer stack reorders with it. Either way what is being dragged lives in the UI store, so
// every target knows while the drag is on whether it can take it. Hovering a node row for a
// moment selects it, so the Properties panel switches to it and the drag can end on one of its
// properties, as Cavalry's spring-loaded layers do.

import type { DocNode, ParamDef } from '@noodles.gl/planner'
import {
  type DragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { analytics } from '../utils/analytics'
import { docStore, useEditor } from './doc-store'
import {
  canLink,
  type LinkDrag,
  linkParam,
  outputKey,
  paramDef,
  sourcesOn,
  targetsOn,
} from './param-links'
import { type Candidate, RefPicker } from './ref-picker'
import { getUIStore, useUIStore } from './ui-store'

const MIME = 'application/x-noodles-link'
// How long a dragged link hovers a node row before the row's node is selected
const SPRING_MS = 600

let cleanupInstalled = false

// A node drag ends with a drop or a dragend, but a dragend from a row that unmounted mid-drag
// (the Properties panel switched nodes) reaches nothing. The first mouse move after a node drag
// clears it too: the browser sends none while one is in progress.
function installCleanup() {
  if (cleanupInstalled) return
  cleanupInstalled = true
  const clear = () => setTimeout(() => getUIStore().setLinkDrag(null), 0)
  document.addEventListener('drop', clear, true)
  document.addEventListener('dragend', clear, true)
  document.addEventListener('mousemove', () => {
    if (getUIStore().linkDrag?.kind === 'node') getUIStore().setLinkDrag(null)
  })
}

// A node row dragged onto a property
export function startLinkDrag(e: DragEvent, drag: { kind: 'node'; id: string }) {
  installCleanup()
  e.dataTransfer.setData(MIME, drag.id)
  e.dataTransfer.effectAllowed = 'all'
  getUIStore().setLinkDrag(drag)
}

// How far the pointer moves from a port before a press becomes a drag, so a click does nothing
const DRAG_PX = 3
const LINE = '#9fc0ff'
const SVG_NS = 'http://www.w3.org/2000/svg'

interface Point {
  x: number
  y: number
}

const centerOf = (el: Element): Point => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

// Where the line ends: the matching port of a row that can take the drag, else the pointer
function endOf(drag: LinkDrag, x: number, y: number): Point {
  const row = document.elementFromPoint(x, y)?.closest('[data-link-accepts]')
  const port = row?.querySelector(drag.kind === 'source' ? '[data-port="in"]' : '[data-port="out"]')
  return port ? centerOf(port) : { x, y }
}

// A curve that leaves and enters each port sideways, as the node graph's wires do
export function linePath(from: Point, to: Point, side: 'in' | 'out'): string {
  const bend = Math.max(30, Math.abs(to.x - from.x) / 2) * (side === 'out' ? 1 : -1)
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`
}

function drawLine() {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('data-link-line', '')
  svg.setAttribute(
    'style',
    'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:10001;overflow:visible'
  )
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', LINE)
  path.setAttribute('stroke-width', '1.6')
  const dot = document.createElementNS(SVG_NS, 'circle')
  dot.setAttribute('r', '3.5')
  dot.setAttribute('fill', LINE)
  svg.append(path, dot)
  document.body.append(svg)
  return {
    move(d: string, end: Point) {
      path.setAttribute('d', d)
      dot.setAttribute('cx', String(end.x))
      dot.setAttribute('cy', String(end.y))
    },
    remove: () => svg.remove(),
  }
}

// Press a port and drag: a line follows the pointer, and a release over a row that can take it
// links them (the row's own pointerup handler, below). Escape cancels.
export function startPortDrag(e: ReactPointerEvent, drag: LinkDrag, side: 'in' | 'out') {
  if (e.button !== 0) return
  // No text selection, no native drag of the port
  e.preventDefault()
  e.stopPropagation()
  const from = centerOf(e.currentTarget)
  const start = { x: e.clientX, y: e.clientY }
  let line: ReturnType<typeof drawLine> | undefined

  const move = (ev: PointerEvent) => {
    if (!line) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) return
      line = drawLine()
      document.body.style.cursor = 'grabbing'
      getUIStore().setLinkDrag(drag)
    }
    const end = endOf(drag, ev.clientX, ev.clientY)
    line.move(linePath(from, end, side), end)
  }
  const stop = () => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('keydown', key, true)
    line?.remove()
    document.body.style.cursor = ''
  }
  // The row under the pointer gets this pointerup next; let it read the drag, then clear it
  const up = () => {
    stop()
    setTimeout(() => getUIStore().setLinkDrag(null), 0)
  }
  const cancel = () => {
    stop()
    getUIStore().setLinkDrag(null)
  }
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cancel()
  }
  // Capturing, so a row that takes the drop and stops the event doesn't keep the line up
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('keydown', key, true)
}

function link(source: string, target: string, via: 'port' | 'node') {
  let made = false
  docStore().edit(d => {
    made = linkParam(d, source, target)
  }, `link:${target}`)
  if (made)
    analytics.track('param_linked', {
      via,
      kind: paramDef(docStore().get().doc, target)?.kind,
      from: source.includes('>') ? 'output' : 'param',
    })
}

interface Picker {
  x: number
  y: number
  node: DocNode
  def: ParamDef
  items: Candidate[]
  placeholder: string
  onPick: (key: string) => void
}

function renderPicker(picker: Picker | undefined, close: () => void): ReactNode {
  if (!picker) return null
  return (
    <RefPicker
      doc={docStore().get().doc}
      node={picker.node}
      def={picker.def}
      x={picker.x}
      y={picker.y}
      items={picker.items}
      placeholder={picker.placeholder}
      onPick={key => {
        picker.onPick(key)
        close()
      }}
      onClose={close}
    />
  )
}

// A drop on a node: a picker of what fits, even when one thing does, so the link it makes is
// the one chosen
function choose(
  e: { clientX: number; clientY: number },
  node: DocNode,
  items: Candidate[],
  placeholder: string,
  onPick: (key: string) => void,
  setPicker: (p: Picker) => void
) {
  setPicker({ x: e.clientX, y: e.clientY, node, def: items[0].def, items, placeholder, onPick })
}

// A property row: takes a dragged output it can read, a dragged input that can read it, or a
// node to choose one of the node's properties or outputs to read
export function useParamLinkTarget(node: DocNode, def: ParamDef) {
  const drag = useUIStore(state => state.linkDrag)
  const doc = useEditor(state => state.doc)
  const [picker, setPicker] = useState<Picker>()
  const key = `${node.id}.${def.name}`

  const accepts =
    drag?.kind === 'source'
      ? canLink(doc, drag.key, key)
      : drag?.kind === 'target'
        ? canLink(doc, key, drag.key)
        : drag?.kind === 'node'
          ? sourcesOn(doc, drag.id, key).length > 0
          : false

  const props = {
    'data-link-accepts': accepts || undefined,
    // A port's drag
    onPointerUp: (e: ReactPointerEvent) => {
      if (!accepts || !drag || drag.kind === 'node') return
      e.stopPropagation()
      if (drag.kind === 'source') link(drag.key, key, 'port')
      else link(key, drag.key, 'port')
    },
    // A node row's drag
    onDragOver: (e: DragEvent) => {
      if (!accepts || drag?.kind !== 'node') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
    },
    onDrop: (e: DragEvent) => {
      if (!accepts || drag?.kind !== 'node') return
      e.preventDefault()
      e.stopPropagation()
      if (doc.nodes.some(n => n.id === drag.id))
        choose(
          e,
          node,
          sourcesOn(doc, drag.id, key),
          `${def.label} reads which?`,
          source => link(source, key, 'node'),
          setPicker
        )
    },
  }
  return {
    props,
    accepts,
    dragging: drag !== null,
    picker: renderPicker(picker, () => setPicker(undefined)),
  }
}

// A value output's row: takes a dragged input that can read it
export function useOutputLinkTarget(nodeId: string, port: string) {
  const drag = useUIStore(state => state.linkDrag)
  const doc = useEditor(state => state.doc)
  const key = outputKey(nodeId, port)
  const accepts = drag?.kind === 'target' && canLink(doc, key, drag.key)
  const props = {
    'data-link-accepts': accepts || undefined,
    onPointerUp: (e: ReactPointerEvent) => {
      if (!accepts || drag?.kind !== 'target') return
      e.stopPropagation()
      link(key, drag.key, 'port')
    },
  }
  return { props, accepts }
}

// A node row in a list: takes a dragged port to choose which of the node's properties reads it,
// or which of its properties and outputs a dragged input reads, and selects the node when the
// drag rests on it
export function useNodeLinkTarget(nodeId: string) {
  const drag = useUIStore(state => state.linkDrag)
  const doc = useEditor(state => state.doc)
  const [picker, setPicker] = useState<Picker>()
  const spring = useRef<ReturnType<typeof setTimeout>>(undefined)
  const items =
    drag?.kind === 'source'
      ? targetsOn(doc, nodeId, drag.key)
      : drag?.kind === 'target'
        ? sourcesOn(doc, nodeId, drag.key)
        : []
  const accepts = items.length > 0

  useEffect(() => () => clearTimeout(spring.current), [])

  const rest = () => {
    clearTimeout(spring.current)
    spring.current = undefined
  }
  const props = {
    'data-link-accepts': accepts || undefined,
    onPointerMove: () => {
      if (accepts)
        spring.current ??= setTimeout(() => docStore().set({ selection: [nodeId] }), SPRING_MS)
    },
    onPointerLeave: rest,
    onPointerUp: (e: ReactPointerEvent) => {
      rest()
      const node = doc.nodes.find(n => n.id === nodeId)
      if (!accepts || !node || !drag || drag.kind === 'node') return
      e.stopPropagation()
      const { key } = drag
      if (drag.kind === 'source')
        return choose(
          e,
          node,
          items,
          'Which input reads it?',
          target => link(key, target, 'node'),
          setPicker
        )
      choose(e, node, items, 'Read which?', source => link(source, key, 'node'), setPicker)
    },
  }
  return { props, accepts, picker: renderPicker(picker, () => setPicker(undefined)) }
}
