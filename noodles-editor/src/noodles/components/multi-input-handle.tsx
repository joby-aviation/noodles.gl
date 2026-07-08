import {
  Handle,
  Position,
  useConnection,
  useNodeId,
  useStore,
  useUpdateNodeInternals,
} from '@xyflow/react'
import cx from 'classnames'
import { useEffect, useMemo } from 'react'
import type { Field } from '../fields'
import { ListField } from '../fields'
import { setPendingInsertionIndex } from '../store'
import {
  SLOT_GAP,
  SLOT_HEIGHT,
  SLOT_SPACING,
  insertionIndexFromPointerY,
} from '../utils/multi-input-utils'
import { getBaseName } from '../utils/path-utils'
import s from './multi-input-handle.module.css'

interface MultiInputHandleProps {
  id: string
  field: Field
  className: string
  style: React.CSSProperties
}

// Blender-style multi-input handle: grows one slot per connection and, while a connection
// or reconnection drag hovers it, tracks which slot boundary the pointer is closest to so
// the drop inserts (or reorders) at that position. The tracked index is published to
// pendingInsertionIndex and consumed by onConnect/onReconnect.
export function MultiInputHandle({ id, field, className, style }: MultiInputHandleProps) {
  const nid = useNodeId()
  const updateNodeInternals = useUpdateNodeInternals()
  const isListField = field instanceof ListField

  // Sources of incoming edges in slot order, collapsed to a string so re-renders only
  // happen when this handle's connections actually change
  const incomingKey = useStore(store =>
    store.edges
      .filter(edge => edge.target === nid && edge.targetHandle === id)
      .map(edge => edge.source)
      .join('\n')
  )
  const sources = useMemo(() => (incomingKey ? incomingKey.split('\n') : []), [incomingKey])
  const connectionCount = sources.length

  // Drag hover state for this handle: connection.pointer is the pointer in
  // container-screen coordinates (connection.to is useless here — it snaps to the handle
  // center once the hover is valid), and connection.toHandle.y is the handle's center in
  // flow coordinates
  const hover = useConnection(connection =>
    connection.inProgress &&
    connection.toHandle?.nodeId === nid &&
    connection.toHandle?.id === id
      ? { pointerY: connection.pointer.y, centerY: connection.toHandle.y }
      : null
  )

  // Viewport transform to lift the pointer into flow coordinates (zoom independent)
  const translateY = useStore(store => store.transform[1])
  const zoom = useStore(store => store.transform[2])

  const insertionIndex = useMemo(() => {
    if (!isListField || hover === null) return null
    const pointerFlowY = (hover.pointerY - translateY) / zoom
    return insertionIndexFromPointerY(pointerFlowY, hover.centerY, connectionCount)
  }, [isListField, hover, translateY, zoom, connectionCount])

  // Publish the tracked slot for onConnect/onReconnect to consume. Keyed on the hover
  // object (fresh per pointer move) so a new drag republishes even when the computed
  // index matches the previous drag's. Stale values from abandoned hovers are guarded by
  // target matching in takePendingInsertionIndex and cleared on connect/reconnect end.
  useEffect(() => {
    if (nid && hover !== null && insertionIndex !== null) {
      setPendingInsertionIndex({ nodeId: nid, handleId: id, index: insertionIndex })
    }
  }, [nid, id, hover, insertionIndex])

  // The handle grows with its connections — tell React Flow to re-measure so edge
  // anchors and hit areas follow (useUpdateNodeInternals is the public API for this)
  useEffect(() => {
    if (nid) {
      updateNodeInternals(nid)
    }
  }, [connectionCount, nid, updateNodeInternals])

  // Numbered slot order shown on hover
  const title = useMemo(() => {
    if (!isListField || connectionCount === 0) return undefined
    return sources.map((source, index) => `${index + 1}. ${getBaseName(source)}`).join('\n')
  }, [isListField, connectionCount, sources])

  const handleHeight =
    isListField && connectionCount > 1
      ? connectionCount * SLOT_HEIGHT + (connectionCount - 1) * SLOT_GAP
      : undefined

  const dynamicStyle = handleHeight
    ? { ...style, height: `${handleHeight}px`, borderRadius: '4px', width: '8px' }
    : style

  return (
    <div className={s.handleContainer}>
      <Handle
        id={id}
        className={cx(className, {
          [s.multiInputHandle]: isListField && connectionCount > 1,
        })}
        style={dynamicStyle}
        type="target"
        position={Position.Left}
        title={title}
        isConnectable={true}
      />

      {/* Boundary marker for the slot the drag would drop into */}
      {insertionIndex !== null && (
        <div
          className={s.insertionIndicator}
          style={{
            top: `calc(50% + ${(insertionIndex - connectionCount / 2) * SLOT_SPACING}px)`,
          }}
        />
      )}

      {isListField && connectionCount > 1 && (
        <div className={s.connectionCount}>{connectionCount}</div>
      )}
    </div>
  )
}
