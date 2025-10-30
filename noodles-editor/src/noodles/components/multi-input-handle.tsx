import { Handle, Position, useEdges, useNodeId, useReactFlow } from '@xyflow/react'
import { useMemo } from 'react'
import cx from 'classnames'
import type { Field } from '../fields'
import { ListField } from '../fields'
import { getBaseName } from '../utils/path-utils'
import s from './multi-input-handle.module.css'

interface MultiInputHandleProps {
  id: string
  field: Field<any>
  className: string
  style: React.CSSProperties
}

export function MultiInputHandle({ id, field, className, style }: MultiInputHandleProps) {
  const nid = useNodeId()
  const edges = useEdges()
  const { getNode } = useReactFlow()

  // Get all incoming edges for this handle
  const incomingEdges = useMemo(() => {
    return edges.filter(edge => edge.target === nid && edge.targetHandle === id)
  }, [edges, nid, id])

  const isListField = field instanceof ListField
  const connectionCount = incomingEdges.length

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

  return (
    <div className={s.handleContainer}>
      <Handle id={id} className={handleClassName} style={dynamicStyle} type="target" position={Position.Left} title={title} />

      {/* Visual indicator for multiple connections */}
      {isListField && connectionCount > 1 && (
        <div className={s.connectionCount}>
          {connectionCount}
        </div>
      )}
    </div>
  )
}
