import { useNodesInitialized, useReactFlow, useStore } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { useUIStore } from '../../editor/ui-store'
import { panViewportToShow } from '../utils/starter-node'
import s from './starter-node-focus.module.css'

// How long a node picked from the map stays highlighted
export const MAP_PICK_PULSE_MS = 1000

// Pans the graph so a node is on screen, once per `focusKey`. Runs once the nodes are
// measured, a frame after any fitView queued for the same render, and only pans when the
// node is out of view, so a view that already shows it stays as it is. `onShown` runs
// with the node's id after the pan (or the check that none was needed).
function useShowNode(nodeId: string | null, focusKey: string, onShown?: (nodeId: string) => void) {
  const nodesInitialized = useNodesInitialized()
  const measuredWidth = useStore(state =>
    nodeId ? state.nodeLookup.get(nodeId)?.measured?.width : undefined
  )
  const { getInternalNode, getViewport, setViewport } = useReactFlow()
  const paneWidth = useStore(state => state.width)
  const paneHeight = useStore(state => state.height)
  const focusedRef = useRef<string | null>(null)
  const onShownRef = useRef(onShown)
  onShownRef.current = onShown

  useEffect(() => {
    if (!nodeId || !nodesInitialized || !measuredWidth || focusedRef.current === focusKey) return
    const frame = requestAnimationFrame(() => {
      const node = getInternalNode(nodeId)
      if (!node?.measured.width || !node.measured.height) return
      focusedRef.current = focusKey
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
      onShownRef.current?.(nodeId)
    })
    return () => cancelAnimationFrame(frame)
  }, [
    focusKey,
    nodeId,
    nodesInitialized,
    measuredWidth,
    paneWidth,
    paneHeight,
    getInternalNode,
    getViewport,
    setViewport,
  ])
}

// Pans the graph so the node an example selected on open is on screen. `loadId` changes
// on every project load, so two examples that start on the same node id each get the check.
export function StarterNodeFocus({ loadId }: { loadId: number }) {
  const nodeId = useUIStore(state => state.starterHintNodeId)
  useShowNode(nodeId, `${loadId}:${nodeId}`)
  return null
}

// Brings a node picked on the map into view and pulses its outline for a second. The
// network draws the pulse from `pulsingNodeId`, so a re-render (the selection arriving)
// keeps it.
export function MapPickFocus() {
  const request = useUIStore(state => state.mapPickFocus)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const frameRef = useRef(0)

  useShowNode(request?.nodeId ?? null, `map:${request?.seq}`, nodeId => {
    const { setPulsingNodeId } = useUIStore.getState()
    clearTimeout(timerRef.current)
    cancelAnimationFrame(frameRef.current)
    // Off for a frame first, so picking the same node mid-pulse restarts the animation
    setPulsingNodeId(null)
    frameRef.current = requestAnimationFrame(() => {
      setPulsingNodeId(nodeId)
      timerRef.current = setTimeout(() => setPulsingNodeId(null), MAP_PICK_PULSE_MS)
    })
  })

  useEffect(
    () => () => {
      clearTimeout(timerRef.current)
      cancelAnimationFrame(frameRef.current)
    },
    []
  )

  return null
}

// The class the network puts on the node `pulsingNodeId` names
export const mapPickPulseClass = s.mapPickPulse
