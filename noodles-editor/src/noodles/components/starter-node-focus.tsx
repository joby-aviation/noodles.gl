import { useNodesInitialized, useReactFlow, useStore } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { useUIStore } from '../store'
import { panViewportToShow } from '../utils/starter-node'

// Pans the graph so the node an example selected on open is on screen. Runs once the
// nodes are measured, after the graph's own fitView, and only pans when the node is
// out of view, so a view that already shows it stays as it is.
export function StarterNodeFocus() {
  const nodeId = useUIStore(state => state.starterHintNodeId)
  const nodesInitialized = useNodesInitialized()
  const measuredWidth = useStore(state =>
    nodeId ? state.nodeLookup.get(nodeId)?.measured?.width : undefined
  )
  const { getInternalNode, getViewport, setViewport } = useReactFlow()
  const paneWidth = useStore(state => state.width)
  const paneHeight = useStore(state => state.height)
  const focusedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!nodeId || !nodesInitialized || !measuredWidth || focusedRef.current === nodeId) return
    // Wait a frame so a fitView queued for the same load has applied first
    const frame = requestAnimationFrame(() => {
      const node = getInternalNode(nodeId)
      if (!node?.measured.width || !node.measured.height) return
      focusedRef.current = nodeId
      const next = panViewportToShow(
        {
          x: node.internals.positionAbsolute.x,
          y: node.internals.positionAbsolute.y,
          width: node.measured.width,
          height: node.measured.height,
        },
        getViewport(),
        { width: paneWidth, height: paneHeight }
      )
      if (next) setViewport(next)
    })
    return () => cancelAnimationFrame(frame)
  }, [
    nodeId,
    nodesInitialized,
    measuredWidth,
    paneWidth,
    paneHeight,
    getInternalNode,
    getViewport,
    setViewport,
  ])

  return null
}
