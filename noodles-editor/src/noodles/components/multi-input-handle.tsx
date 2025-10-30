import { Handle, Position, useConnection, useEdges, useNodeId, useReactFlow, useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useMemo, useRef } from 'react'
import cx from 'classnames'
import type { Field } from '../fields'
import { ListField } from '../fields'
import { getBaseName } from '../utils/path-utils'
import { setPendingInsertionIndex } from '../store'
import s from './multi-input-handle.module.css'

interface MultiInputHandleProps {
  id: string
  isListField: boolean
  className: string
  style: React.CSSProperties
}

export function MultiInputHandle({ id, isListField, className, style }: MultiInputHandleProps) {
  const nid = useNodeId()
  const edges = useEdges()
  const { getNode } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const connection = useConnection()
  const handleRef = useRef<HTMLDivElement>(null)
  const prevConnectionCountRef = useRef(0)

  // Get all incoming edges for this handle
  const incomingEdges = useMemo(() => {
    return edges.filter(edge => edge.target === nid && edge.targetHandle === id)
  }, [edges, nid, id])

  const connectionCount = incomingEdges.length

  // Detect if we're actively dragging a connection to this handle
  const isDraggingToThisHandle = useMemo(() => {
    return connection.inProgress && connection.toNode?.id === nid && connection.toHandle?.id === id
  }, [connection, nid, id])

  // Calculate insertion index based on mouse position
  const insertionIndex = useMemo(() => {
    if (!isDraggingToThisHandle || !handleRef.current || connectionCount === 0) {
      return connectionCount // Append to end by default
    }

    const handleRect = handleRef.current.getBoundingClientRect()
    const mouseY = connection.toY || 0
    const relativeY = mouseY - handleRect.top
    const handleHeight = handleRect.height

    const SLOT_HEIGHT = 6
    const SLOT_GAP = 1.5
    const SLOT_SPACING = SLOT_HEIGHT + SLOT_GAP

    // Calculate total height and center offset
    const totalSlotsHeight = connectionCount * SLOT_SPACING
    const centerOffset = (handleHeight - totalSlotsHeight) / 2

    // Adjust relativeY to account for centering
    const adjustedY = relativeY - centerOffset

    // Determine which slot boundary we're closest to
    // Each slot starts at index * SLOT_SPACING
    // We want to insert *between* slots, so calculate which boundary
    const normalizedPosition = adjustedY / SLOT_SPACING

    // Round to nearest boundary (0, 1, 2, ... connectionCount)
    const slotIndex = Math.round(normalizedPosition)

    // Clamp to valid range [0, connectionCount] (inclusive of end for appending)
    return Math.max(0, Math.min(connectionCount, slotIndex))
  }, [isDraggingToThisHandle, connection.toY, connectionCount])

  // Update store with pending insertion index
  useEffect(() => {
    if (isDraggingToThisHandle && nid) {
      setPendingInsertionIndex({ nodeId: nid, handleId: id, index: insertionIndex })
    } else if (!connection.inProgress) {
      // Clear when connection is complete
      setPendingInsertionIndex(null)
    }
  }, [isDraggingToThisHandle, nid, id, insertionIndex, connection.inProgress])

  // Update node internals when connection count changes (for edge reordering)
  useEffect(() => {
    if (connectionCount !== prevConnectionCountRef.current && nid) {
      prevConnectionCountRef.current = connectionCount
      updateNodeInternals(nid)
    }
  }, [connectionCount, nid, updateNodeInternals])

  // Generate title showing connection order (just base names)
  const title = useMemo(() => {
    if (!isListField || connectionCount === 0) return undefined

    const connections = incomingEdges
      .map((edge, index) => {
        const baseName = getBaseName(edge.source)
        return `${index + 1}. ${baseName}`
      })
      .join('\n')

    return connections
  }, [isListField, connectionCount, incomingEdges])

  // Calculate dynamic handle height based on connection count
  const handleHeight = useMemo(() => {
    if (!isListField || connectionCount <= 1) return undefined

    const slotHeight = 6
    const slotGap = 1.5
    return connectionCount * slotHeight + (connectionCount - 1) * slotGap
  }, [isListField, connectionCount])

  // Apply dynamic styling for multi-input visualization
  const dynamicStyle = useMemo(() => {
    if (!handleHeight) return style

    return {
      ...style,
      height: `${handleHeight}px`,
      borderRadius: '4px',
      width: '8px',
    }
  }, [style, handleHeight])

  const handleClassName = cx(className, {
    [s.multiInputHandle]: isListField && connectionCount > 1,
  })

  // Calculate slot positions for distributing edges vertically
  const slots = useMemo(() => {
    if (!isListField || connectionCount === 0) return []

    const slotHeight = 6
    const slotGap = 1.5
    const totalHeight = connectionCount * slotHeight + (connectionCount - 1) * slotGap

    return incomingEdges.map((edge, index) => {
      const yOffset = index * (slotHeight + slotGap) - totalHeight / 2
      return {
        edge,
        index,
        yOffset,
      }
    })
  }, [isListField, connectionCount, incomingEdges])

  return (
    <div className={s.handleContainer} ref={handleRef}>
      {/* Main handle for all connections */}
      <Handle
        id={id}
        className={handleClassName}
        style={dynamicStyle}
        type="target"
        position={Position.Left}
        title={title}
        isConnectable={true}
      />

      {/* Insertion indicator when dragging */}
      {isDraggingToThisHandle && isListField && (
        <div
          className={s.insertionIndicator}
          style={{
            top: `${(insertionIndex / (connectionCount + 1)) * 100}%`,
          }}
        />
      )}

      {/* Visual indicator for multiple connections */}
      {isListField && connectionCount > 1 && (
        <div className={s.connectionCount}>
          {connectionCount}
        </div>
      )}
    </div>
  )
}
