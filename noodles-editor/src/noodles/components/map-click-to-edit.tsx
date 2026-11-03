// Click a feature on the map to select the layer node that drew it. Hovering a feature
// shows a pointer cursor and a "Click to edit" label. All of it runs inside deck.gl's own
// picking callbacks and writes to the DOM directly, so pointer moves never re-render React.

import type { PickingInfo } from '@deck.gl/core'
import { type PointerEvent, useCallback, useEffect, useMemo, useRef } from 'react'
import { OPERATOR_INDEX } from '@noodles.gl/planner'
import { docStore } from '../../editor/doc-store'
import { getUIStore } from '../../editor/ui-store'
import { analytics } from '../../utils/analytics'
import {
  findPickedOperatorId,
  isClickNotDrag,
  type PickedInfo,
  placeLabel,
  type ScreenPoint,
} from '../utils/map-pick'
import s from './map-click-to-edit.module.css'

// Offset of the label from the pointer, so it never sits under the cursor
const LABEL_OFFSET = 14

const deckDefaultCursor = ({ isDragging }: { isDragging: boolean }) =>
  isDragging ? 'grabbing' : 'grab'

// Selects a node from the map: only that node, in its own network, then asks the graph
// to bring it into view and pulse it
export function selectNodeFromMap(nodeId: string) {
  const store = docStore()
  const node = store.get().doc.nodes.find(n => n.id === nodeId)
  store.set({ network: node?.parent, selection: [nodeId] })
  getUIStore().focusNodeFromMap(nodeId)
}

// The document node a deck layer id names: the engine ids a node's layer `<node>:<kind>`
// (`<node>:outline` for a polygon's outline), and a layer deck loads itself `<node>`
const docNodeOf = (layerId: string) => {
  const { nodes } = docStore().get().doc
  const exact = nodes.find(n => n.id === layerId)
  if (exact) return exact
  const at = layerId.lastIndexOf(':')
  return at > 0 ? nodes.find(n => n.id === layerId.slice(0, at)) : undefined
}

// A node draws a layer when its operator outputs one; a switch passes one through, but its
// id never names a deck layer
const isLayerOperator = (layerId: string) => {
  const node = docNodeOf(layerId)
  return Boolean(node && OPERATOR_INDEX.get(node.op)?.outputs.some(o => o.type === 'layer'))
}

const pickedOperatorId = (info: PickingInfo) =>
  info.picked ? findPickedOperatorId(info as PickedInfo, isLayerOperator) : null

export function useMapClickToEdit(enabled: boolean) {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const labelRef = useRef<HTMLDivElement>(null)
  // Whether the pointer is over a feature some node drew, read by getCursor each frame
  const editableHoverRef = useRef(false)
  const pressRef = useRef<{ down: ScreenPoint | null; up: ScreenPoint | null }>({
    down: null,
    up: null,
  })

  const hideLabel = useCallback(() => {
    editableHoverRef.current = false
    if (labelRef.current) labelRef.current.hidden = true
  }, [])

  useEffect(() => {
    if (!enabled) hideLabel()
  }, [enabled, hideLabel])

  // `event` is deck's pointer event. The label is positioned from the pointer's client
  // coordinates rather than deck's, since a fixed-size render is drawn scaled down and the
  // label lives outside that scaled box so it keeps its size.
  const onHover = useCallback(
    (info: PickingInfo, event?: { srcEvent?: unknown }) => {
      const label = labelRef.current
      const pointer = event?.srcEvent as { clientX?: number; clientY?: number } | undefined
      if (
        !enabledRef.current ||
        !label ||
        typeof pointer?.clientX !== 'number' ||
        typeof pointer.clientY !== 'number' ||
        !pickedOperatorId(info)
      ) {
        hideLabel()
        return
      }
      editableHoverRef.current = true
      // Shown first: a hidden element has no offsetParent or size
      label.hidden = false
      const container = label.offsetParent ?? label.parentElement
      if (!container) return
      const bounds = container.getBoundingClientRect()
      const { x, y } = placeLabel(
        { x: pointer.clientX - bounds.left, y: pointer.clientY - bounds.top },
        { width: label.offsetWidth, height: label.offsetHeight },
        { width: bounds.width, height: bounds.height },
        LABEL_OFFSET
      )
      label.style.transform = `translate(${x}px, ${y}px)`
    },
    [hideLabel]
  )

  // Runs after deck has offered the click to the picked layer's own onClick, and only
  // when that handler didn't claim it
  const onClick = useCallback((info: PickingInfo) => {
    if (!enabledRef.current || !info.picked || !info.layer) return
    const { down, up } = pressRef.current
    if (!isClickNotDrag(down, up)) return
    const layerId = pickedOperatorId(info)
    const node = layerId ? docNodeOf(layerId) : undefined
    analytics.track('map_feature_clicked', {
      operatorType: node?.op ?? 'unknown',
      selected: Boolean(node),
    })
    if (node) selectNodeFromMap(node.id)
  }, [])

  const getCursor = useCallback(
    (state: { isDragging: boolean; isHovering: boolean }) =>
      enabledRef.current && state.isHovering && editableHoverRef.current && !state.isDragging
        ? 'pointer'
        : deckDefaultCursor(state),
    []
  )

  // Capture-phase listeners on the map's container, so they see every press before
  // MapLibre or deck handle it
  const surfaceHandlers = useMemo(
    () => ({
      onPointerDownCapture: (event: PointerEvent) => {
        pressRef.current = { down: { x: event.clientX, y: event.clientY }, up: null }
      },
      onPointerUpCapture: (event: PointerEvent) => {
        pressRef.current.up = { x: event.clientX, y: event.clientY }
      },
      onPointerLeave: hideLabel,
    }),
    [hideLabel]
  )

  const label = (
    <div ref={labelRef} className={s.label} hidden aria-hidden="true">
      Click to edit
    </div>
  )

  return { onHover, onClick, getCursor, surfaceHandlers, label }
}
