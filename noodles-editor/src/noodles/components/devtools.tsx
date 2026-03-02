import { Panel, useNodes, useReactFlow, useStore, useViewport } from '@xyflow/react'
import s from './devtools.module.css'

// Renders x/y/width/height info below each node in graph coordinates
export function NodeInfoOverlay() {
  const nodes = useNodes()
  const { getInternalNode } = useReactFlow()
  const transform = useStore(state => state.transform)

  return (
    <div
      className={s.overlay}
      style={{ transform: `translate(${transform[0]}px, ${transform[1]}px) scale(${transform[2]})` }}
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
            className={s.nodeLabel}
            style={{ top: absPos.y + h + 4, left: absPos.x }}
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
      <div className={s.viewportInfo}>
        x: {x.toFixed(1)}  y: {y.toFixed(1)}  zoom: {zoom.toFixed(2)}
      </div>
    </Panel>
  )
}
