// The drag half of parameter links (param-links.ts): starting a drag from a port or a node row,
// and the drop targets on property rows, output rows and node rows. What is being dragged lives in the UI
// store rather than only in the DataTransfer, because a drop target has to know during
// dragover whether it can take the drop, and the browser hides DataTransfer contents until
// the drop. Hovering a node row for a moment selects it, so the Properties panel switches to
// it and the drag can end on one of its properties, as Cavalry's spring-loaded layers do.

import type { DocNode, ParamDef } from '@noodles.gl/planner'
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react'
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

// A drag ends with a drop or a dragend, but a dragend from a row that unmounted mid-drag (the
// Properties panel switched nodes) reaches nothing. The first mouse move after a drag clears
// it too: the browser sends none while one is in progress.
function installCleanup() {
  if (cleanupInstalled) return
  cleanupInstalled = true
  const clear = () => setTimeout(() => getUIStore().setLinkDrag(null), 0)
  document.addEventListener('drop', clear, true)
  document.addEventListener('dragend', clear, true)
  document.addEventListener('mousemove', () => {
    if (getUIStore().linkDrag) getUIStore().setLinkDrag(null)
  })
}

export function startLinkDrag(e: DragEvent, drag: LinkDrag) {
  installCleanup()
  const key = drag.kind === 'node' ? drag.id : drag.key
  e.dataTransfer.setData(MIME, key)
  if (drag.kind !== 'node') e.dataTransfer.setData('text/plain', key)
  e.dataTransfer.effectAllowed = 'all'
  getUIStore().setLinkDrag(drag)
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
  e: DragEvent,
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
    onDragOver: (e: DragEvent) => {
      if (!accepts) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
    },
    onDrop: (e: DragEvent) => {
      if (!accepts || !drag) return
      e.preventDefault()
      e.stopPropagation()
      if (drag.kind === 'source') return link(drag.key, key, 'port')
      if (drag.kind === 'target') return link(key, drag.key, 'port')
      const from = doc.nodes.find(n => n.id === drag.id)
      if (from)
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
    onDragOver: (e: DragEvent) => {
      if (!accepts) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
    },
    onDrop: (e: DragEvent) => {
      if (!accepts || drag?.kind !== 'target') return
      e.preventDefault()
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

  const props = {
    onDragOver: (e: DragEvent) => {
      if (!accepts) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
      spring.current ??= setTimeout(() => docStore().set({ selection: [nodeId] }), SPRING_MS)
    },
    onDragLeave: () => {
      clearTimeout(spring.current)
      spring.current = undefined
    },
    onDrop: (e: DragEvent) => {
      clearTimeout(spring.current)
      spring.current = undefined
      const node = doc.nodes.find(n => n.id === nodeId)
      if (!accepts || !node || !drag || drag.kind === 'node') return
      e.preventDefault()
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
