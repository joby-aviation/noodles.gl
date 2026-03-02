import { Panel, useNodes, useReactFlow, useStore, useViewport } from '@xyflow/react'

const labelStyle: React.CSSProperties = {
  position: 'absolute',
  fontSize: 10,
  fontFamily: 'monospace',
  color: 'rgba(255, 255, 255, 0.5)',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  padding: '2px 4px',
  background: 'rgba(0, 0, 0, 0.3)',
  borderRadius: 3,
}

// Renders x/y/width/height info below each node in graph coordinates
export function NodeInfoOverlay() {
  const nodes = useNodes()
  const { getInternalNode } = useReactFlow()
  const transform = useStore(s => s.transform)

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        transformOrigin: '0 0',
        transform: `translate(${transform[0]}px, ${transform[1]}px) scale(${transform[2]})`,
      }}
    >
      {nodes.map(node => {
        const internalNode = getInternalNode(node.id)
        const absPos = internalNode?.internals.positionAbsolute
        const w = node.measured?.width ?? 0
        const h = node.measured?.height ?? 0
        if (!absPos) return null
        return (
          <div
            key={node.id}
            style={{
              ...labelStyle,
              top: absPos.y + h + 4,
              left: absPos.x,
            }}
          >
            x: {Math.round(node.position.x)}  y: {Math.round(node.position.y)}  {w}×{h}
          </div>
        )
      })}
    </div>
  )
}

// Renders current viewport x/y/zoom in a bottom-left panel
export function ViewportInfoPanel() {
  const { x, y, zoom } = useViewport()
  return (
    <Panel position="bottom-left">
      <div
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: 'rgba(255, 255, 255, 0.6)',
          background: 'rgba(0, 0, 0, 0.4)',
          padding: '4px 8px',
          borderRadius: 4,
        }}
      >
        x: {x.toFixed(1)}  y: {y.toFixed(1)}  zoom: {zoom.toFixed(2)}
      </div>
    </Panel>
  )
}
