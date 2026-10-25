// The drag half of parameter links (param-links.ts): starting a drag from a port or a node row,
// and the drop targets on property rows and node rows. What is being dragged lives in the UI
// store rather than only in the DataTransfer, because a drop target has to know during
// dragover whether it can take the drop, and the browser hides DataTransfer contents until
// the drop. Hovering a node row for a moment selects it, so the Properties panel switches to
// it and the drag can end on one of its properties, as Cavalry's spring-loaded layers do.

import { type DocNode, nameOf, type ParamDef } from '@noodles.gl/planner'
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { analytics } from '../utils/analytics'
import { docStore, useEditor } from './doc-store'
import { canLink, type LinkDrag, linkParam, paramDef, sourcesOn, targetsOn } from './param-links'
import { RefPicker } from './ref-picker'
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
  e.dataTransfer.setData(MIME, drag.kind === 'param' ? drag.key : drag.id)
  if (drag.kind === 'param') e.dataTransfer.setData('text/plain', drag.key)
  e.dataTransfer.effectAllowed = 'all'
  getUIStore().setLinkDrag(drag)
}

function link(source: string, target: string, via: 'port' | 'node') {
  let made = false
  docStore().edit(d => {
    made = linkParam(d, source, target)
  }, `link:${target}`)
  if (made)
    analytics.track('param_linked', { via, kind: paramDef(docStore().get().doc, target)?.kind })
}

interface Picker {
  x: number
  y: number
  node: DocNode
  def: ParamDef
  items: ReturnType<typeof targetsOn>
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

// A property row: takes a dragged port it can read, or a node to choose one of its properties
export function useParamLinkTarget(node: DocNode, def: ParamDef) {
  const drag = useUIStore(state => state.linkDrag)
  const doc = useEditor(state => state.doc)
  const [picker, setPicker] = useState<Picker>()
  const key = `${node.id}.${def.name}`

  const accepts =
    drag?.kind === 'param'
      ? canLink(doc, drag.key, key)
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
      if (drag.kind === 'param') return link(drag.key, key, 'port')
      const sources = sourcesOn(doc, drag.id, key)
      const from = doc.nodes.find(n => n.id === drag.id)
      if (sources.length === 1) return link(sources[0].key, key, 'node')
      if (from)
        setPicker({
          x: e.clientX,
          y: e.clientY,
          node,
          def,
          items: sources,
          placeholder: `${def.label} reads which property of ${nameOf(from)}?`,
          onPick: source => link(source, key, 'node'),
        })
    },
  }
  return {
    props,
    accepts,
    dragging: drag !== null,
    picker: renderPicker(picker, () => setPicker(undefined)),
  }
}

// A node row in a list: takes a dragged port to choose which of the node's properties reads it,
// and selects the node when the drag rests on it
export function useNodeLinkTarget(nodeId: string) {
  const drag = useUIStore(state => state.linkDrag)
  const doc = useEditor(state => state.doc)
  const [picker, setPicker] = useState<Picker>()
  const spring = useRef<ReturnType<typeof setTimeout>>(undefined)
  const targets = drag?.kind === 'param' ? targetsOn(doc, nodeId, drag.key) : []
  const accepts = targets.length > 0

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
      if (!accepts || drag?.kind !== 'param') return
      e.preventDefault()
      e.stopPropagation()
      if (targets.length === 1) return link(drag.key, targets[0].key, 'node')
      const def = paramDef(doc, drag.key)
      const node = doc.nodes.find(n => n.id === nodeId)
      if (def && node)
        setPicker({
          x: e.clientX,
          y: e.clientY,
          node,
          def,
          items: targets,
          placeholder: `Which property of ${nameOf(node)} reads it?`,
          onPick: target => link(drag.key, target, 'node'),
        })
    },
  }
  return { props, accepts, picker: renderPicker(picker, () => setPicker(undefined)) }
}
