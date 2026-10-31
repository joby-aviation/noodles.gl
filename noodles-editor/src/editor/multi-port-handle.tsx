// A multi input's handle and its wires. The handle is a pill with a slot per wire that lists
// the wires in order on hover. While a wire is dragged over it, it marks the slot boundary
// nearest the pointer and publishes it as the pending insertion index, which the network's
// connect and reconnect handlers use. Each wire lands on its own slot.

import { nameOf } from '@noodles.gl/planner'
import {
  BaseEdge,
  type EdgeProps,
  getBezierPath,
  Handle,
  Position,
  useConnection,
  useNodeId,
  useStore,
  useUpdateNodeInternals,
} from '@xyflow/react'
import cx from 'classnames'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import s from './doc-network.module.css'
import { useEditor } from './doc-store'
import { insertionIndex, pillHeight, SLOT_SPACING, slotOffsetY } from './multi-port'
import { getUIStore } from './ui-store'

export function MultiPortHandle({ port, className }: { port: string; className?: string }) {
  const nodeId = useNodeId()
  const updateNodeInternals = useUpdateNodeInternals()

  // The wires' sources in slot order, as one string so the handle re-renders only when they
  // change
  const sourcesKey = useEditor(st =>
    st.doc.edges
      .filter(e => e.target === nodeId && e.targetPort === port)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(e => {
        const source = st.doc.nodes.find(n => n.id === e.source)
        return source ? nameOf(source) : e.source
      })
      .join('\n')
  )
  const sources = useMemo(() => (sourcesKey ? sourcesKey.split('\n') : []), [sourcesKey])
  const count = sources.length

  // The pointer, in the pane's screen coordinates, while a drag hovers this handle; the
  // handle's center is in flow coordinates
  const hover = useConnection(c =>
    c.inProgress && c.toHandle?.nodeId === nodeId && c.toHandle?.id === port
      ? { pointerY: c.pointer.y, centerY: c.toHandle.y }
      : null
  )
  const translateY = useStore(st => st.transform[1])
  const zoom = useStore(st => st.transform[2])
  const at =
    hover === null
      ? null
      : insertionIndex((hover.pointerY - translateY) / zoom, hover.centerY, count)

  // A layout effect, so a fast release can't beat the publish. Keyed on the hover object, new
  // per pointer move, so a second drag republishes the same index.
  useLayoutEffect(() => {
    if (nodeId && hover !== null && at !== null)
      getUIStore().setPendingInsertionIndex({ nodeId, handleId: port, index: at })
  }, [nodeId, port, hover, at])

  // A handle that goes away mid-drag takes its slot with it
  useEffect(
    () => () => {
      const pending = getUIStore().pendingInsertionIndex
      if (pending?.nodeId === nodeId && pending.handleId === port)
        getUIStore().setPendingInsertionIndex(null)
    },
    [nodeId, port]
  )

  // The pill grows with its wires: React Flow re-measures it so wires land on their slots
  // biome-ignore lint/correctness/useExhaustiveDependencies: count triggers the re-measure
  useEffect(() => {
    if (nodeId) updateNodeInternals(nodeId)
  }, [count, nodeId, updateNodeInternals])

  const height = pillHeight(count)
  return (
    <>
      <Handle
        id={port}
        type="target"
        position={Position.Left}
        className={cx(className, s.multiHandle)}
        style={{ height }}
        title={count ? sources.map((name, i) => `${i + 1}. ${name}`).join('\n') : undefined}
      />
      {at !== null && (
        <div
          className={s.insertionMark}
          style={{ top: `calc(50% + ${(at - count / 2) * SLOT_SPACING}px)` }}
        />
      )}
    </>
  )
}

// A wire into a multi input, landing on its slot of the pill rather than its center
export function MultiPortEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  interactionWidth,
  data,
}: EdgeProps) {
  const { index = 0, count = 1 } = (data ?? {}) as { index?: number; count?: number }
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY: targetY + slotOffsetY(index, count),
    targetPosition,
  })
  return (
    <BaseEdge path={path} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />
  )
}
