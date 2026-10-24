import { type FitViewOptions, useNodesInitialized, useReactFlow, useStoreApi } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { useUIStore } from '../store'
import { panViewportToShow } from '../utils/starter-node'

// Never zoom past 100% to fit, so a small graph doesn't open blown up
export const LOAD_FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.2, maxZoom: 1, duration: 0 }

// Frames the graph once a project's nodes are measured. A fresh load fits the whole
// graph so it opens on an overview; then, if an example selected a node on open and the
// fit left it off screen, it pans (never zooms) to that node. `loadId` changes on every
// project load, and `fitView` is false for undo/redo restores, which keep the user's view.
//
// The fit waits for every node to be measured: a fitView queued while nodes are still
// mounting resolves on the first measured node and zooms all the way in on it.
export function ProjectLoadView({ loadId, fitView }: { loadId: number; fitView: boolean }) {
  const nodeId = useUIStore(state => state.starterHintNodeId)
  const nodesInitialized = useNodesInitialized()
  const store = useStoreApi()
  const reactFlow = useReactFlow()
  const handledRef = useRef<number | null>(null)

  useEffect(() => {
    if (handledRef.current === loadId || (!fitView && !nodeId) || !nodesInitialized) return
    // Wait a frame so React Flow has the new project's nodes, not the previous project's
    const frame = requestAnimationFrame(async () => {
      const { nodeLookup, nodesInitialized: measured, width, height } = store.getState()
      if (!measured || nodeLookup.size === 0) return
      handledRef.current = loadId
      if (fitView) await reactFlow.fitView(LOAD_FIT_VIEW_OPTIONS)
      const node = nodeId ? reactFlow.getInternalNode(nodeId) : undefined
      if (!node?.measured.width || !node.measured.height) return
      const next = panViewportToShow(
        {
          x: node.internals.positionAbsolute.x,
          y: node.internals.positionAbsolute.y,
          width: node.measured.width,
          height: node.measured.height,
        },
        reactFlow.getViewport(),
        { width, height }
      )
      if (next) reactFlow.setViewport(next)
    })
    return () => cancelAnimationFrame(frame)
  }, [loadId, fitView, nodeId, nodesInitialized, store, reactFlow])

  return null
}
