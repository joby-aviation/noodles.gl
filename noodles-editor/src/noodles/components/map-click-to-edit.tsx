// Click a feature on the map to select the layer node that drew it. Hovering a feature
// shows a pointer cursor and a "Click to edit" label. All of it runs inside deck.gl's own
// picking callbacks and writes to the DOM directly, so pointer moves never re-render React.

import type { PickingInfo } from '@deck.gl/core'
import { type PointerEvent, useCallback, useEffect, useMemo, useRef } from 'react'
import { analytics } from '../../utils/analytics'
import { getGraphStore, getUIStore, hasOp, useGraphStore, useNestingStore } from '../store'
import {
  findPickedOperatorId,
  isClickNotDrag,
  type PickedInfo,
  placeLabel,
  type ScreenPoint,
} from '../utils/map-pick'
import { getParentPath } from '../utils/path-utils'
import s from './map-click-to-edit.module.css'

// Offset of the label from the pointer, so it never sits under the cursor
const LABEL_OFFSET = 14

const deckDefaultCursor = ({ isDragging }: { isDragging: boolean }) =>
  isDragging ? 'grabbing' : 'grab'

// Selects a node from the map: only that node, in its own container, then asks the graph
// to bring it into view and pulse it
export function selectNodeFromMap(nodeId: string) {
  const container = getParentPath(nodeId) ?? '/'
  const nesting = useNestingStore.getState()
  if (nesting.currentContainerId !== container) nesting.setCurrentContainerId(container)
  useGraphStore.setState(({ nodes }) => ({
    nodes: nodes.map(node =>
      node.id === nodeId
        ? node.selected
          ? node
          : { ...node, selected: true }
        : node.selected
          ? { ...node, selected: false }
          : node
    ),
  }))
  getUIStore().focusNodeFromMap(nodeId)
}

const pickedOperatorId = (info: PickingInfo) =>
  info.picked ? findPickedOperatorId(info as PickedInfo, hasOp) : null

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
    const nodeId = pickedOperatorId(info)
    const node = nodeId ? getGraphStore().nodes.find(n => n.id === nodeId) : undefined
    analytics.track('map_feature_clicked', {
      operatorType: node?.type ?? 'unknown',
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
