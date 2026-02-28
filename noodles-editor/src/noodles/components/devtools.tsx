import { Panel, ViewportPortal, useNodes, useReactFlow, useStore } from '@xyflow/react'
import type { XYPosition } from '@xyflow/react'

type NodeInfoProps = {
  id: string
  type: string
  selected: boolean
  position: XYPosition
  absPosition: XYPosition
  width: number
  height: number
}

function NodeInfo({ id, type, selected, position, absPosition, width, height }: NodeInfoProps) {
  if (!width || !height) return null

  return (
    <div
      style={{
        position: 'absolute',
        transform: `translate(${absPosition.x}px, ${absPosition.y + height + 4}px)`,
        width: Math.max(width, 160),
        background: 'rgba(0,0,0,0.75)',
        color: '#9effa0',
        fontFamily: 'monospace',
        fontSize: '10px',
        lineHeight: '1.5',
        padding: '4px 6px',
        borderRadius: '3px',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <div>
        <span style={{ opacity: 0.5 }}>id </span>
        {id}
      </div>
      <div>
        <span style={{ opacity: 0.5 }}>type </span>
        {type}
      </div>
      <div>
        <span style={{ opacity: 0.5 }}>sel </span>
        {selected ? 'true' : 'false'}
      </div>
      <div>
        <span style={{ opacity: 0.5 }}>pos </span>
        {position.x.toFixed(0)}, {position.y.toFixed(0)}
      </div>
      <div>
        <span style={{ opacity: 0.5 }}>dim </span>
        {width} × {height}
      </div>
    </div>
  )
}

export function NodeInspector() {
  const { getInternalNode } = useReactFlow()
  const nodes = useNodes()

  return (
    <ViewportPortal>
      <div>
        {nodes.map(node => {
          const internal = getInternalNode(node.id)
          if (!internal) return null
          const absPosition = internal.internals.positionAbsolute
          const width = node.measured?.width ?? 0
          const height = node.measured?.height ?? 0
          return (
            <NodeInfo
              key={node.id}
              id={node.id}
              type={node.type ?? 'default'}
              selected={!!node.selected}
              position={node.position}
              absPosition={absPosition}
              width={width}
              height={height}
            />
          )
        })}
      </div>
    </ViewportPortal>
  )
}

export function ViewportLogger() {
  const [x, y, zoom] = useStore(s => s.transform)

  return (
    <Panel
      position="bottom-left"
      style={{
        background: 'rgba(0,0,0,0.75)',
        color: '#9effa0',
        fontFamily: 'monospace',
        fontSize: '11px',
        lineHeight: '1.6',
        padding: '6px 8px',
        borderRadius: '4px',
        pointerEvents: 'none',
      }}
    >
      <div>
        <span style={{ opacity: 0.5 }}>x </span>
        {x.toFixed(2)}
      </div>
      <div>
        <span style={{ opacity: 0.5 }}>y </span>
        {y.toFixed(2)}
      </div>
      <div>
        <span style={{ opacity: 0.5 }}>zoom </span>
        {zoom.toFixed(3)}
      </div>
    </Panel>
  )
}
