import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { debugUI } from '../../utils/debug'
import { createDrawingGraph, createMeasurementGraph } from '../components/tools/map-tool-pipelines'
import type { LngLat } from '../components/tools/measure-math'
import type { Operator, OpType } from '../operators'
import { useNestingStore, useOperatorStore } from '../store'
import type { NodeJSON } from '../transform-graph'
import { nodeId } from '../utils/id-utils'

// Commits geometry produced by the on-map tools into the graph. The maths and node
// shapes live in pure modules; this hook only supplies ids, position and React Flow.

function findRendererId(): string | null {
  for (const [id, op] of useOperatorStore.getState().operators.entries()) {
    if ((op.constructor as typeof Operator).displayName === 'DeckRenderer') return id
  }
  return null
}

export function useMapToolGraph() {
  const { addNodes, addEdges, setNodes, fitView, getViewport } = useReactFlow()
  const currentContainerId = useNestingStore(state => state.currentContainerId)

  const commit = useCallback(
    (built: ReturnType<typeof createDrawingGraph>) => {
      addNodes(built.nodes as NodeJSON<OpType>[])
      if (built.edges.length > 0) addEdges(built.edges)
      setNodes(ns => ns.map(n => ({ ...n, selected: n.id === built.primaryNodeId })))
      requestAnimationFrame(() => {
        fitView({ nodes: built.nodes.map(n => ({ id: n.id })), duration: 300, padding: 0.3 })
      })
      debugUI('Map tool wrote %d nodes to the graph', built.nodes.length)
    },
    [addNodes, addEdges, setNodes, fitView]
  )

  // Place new nodes at the centre of the current graph viewport so they land
  // somewhere the user can see once they switch back to the graph.
  const basePosition = useCallback(() => {
    const { x, y, zoom } = getViewport()
    return { x: -x / zoom + 80, y: -y / zoom + 80 }
  }, [getViewport])

  const makeNodeId = useCallback(
    (baseName: string) => nodeId(baseName, currentContainerId || '/'),
    [currentContainerId]
  )

  const saveDrawing = useCallback(
    (features: GeoJSON.Feature[]) => {
      if (features.length === 0) return
      commit(
        createDrawingGraph({
          features,
          basePosition: basePosition(),
          makeNodeId,
          rendererId: findRendererId(),
        })
      )
    },
    [commit, basePosition, makeNodeId]
  )

  const saveMeasurement = useCallback(
    (points: LngLat[], closed: boolean) => {
      if (points.length < 2) return
      commit(
        createMeasurementGraph({
          points,
          closed,
          basePosition: basePosition(),
          makeNodeId,
          rendererId: findRendererId(),
        })
      )
    },
    [commit, basePosition, makeNodeId]
  )

  return { saveDrawing, saveMeasurement }
}
