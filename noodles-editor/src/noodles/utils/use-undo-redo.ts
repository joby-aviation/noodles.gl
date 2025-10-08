import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { useCallback, useRef } from 'react'
import { useSlice } from '../store'
import type { NodesProjectJSON } from './serialization'
import { serializeEdges, serializeNodes } from './serialization'
import { UndoRedoManager } from './undo-redo-manager'

export function useUndoRedo(
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  getTimelineJson: () => Record<string, unknown>,
  loadProjectFile: (project: NodesProjectJSON, name?: string) => void,
  currentProject: NodesProjectJSON
) {
  const ops = useSlice(state => state.ops)

  // Create manager only once using useRef
  const managerRef = useRef<UndoRedoManager | null>(null)

  // Store current values in refs so the functions can access latest values
  const currentOps = useRef(ops)
  const currentNodes = useRef(nodes)
  const currentEdges = useRef(edges)
  const currentGetTimelineJson = useRef(getTimelineJson)
  const currentLoadProjectFile = useRef(loadProjectFile)
  const currentProjectRef = useRef(currentProject)

  // Update refs on every render
  currentOps.current = ops
  currentNodes.current = nodes
  currentEdges.current = edges
  currentGetTimelineJson.current = getTimelineJson
  currentLoadProjectFile.current = loadProjectFile
  currentProjectRef.current = currentProject

  if (!managerRef.current) {
    const getCurrentState = (): NodesProjectJSON => {
      const serializedNodes = serializeNodes(
        currentOps.current,
        currentNodes.current,
        currentEdges.current
      )
      const serializedEdges = serializeEdges(
        currentOps.current,
        currentNodes.current,
        currentEdges.current
      ) as ReactFlowEdge[]
      const timeline = currentGetTimelineJson.current()

      // Use current project as base, but update with current nodes, edges, and timeline
      return {
        ...currentProjectRef.current,
        nodes: serializedNodes,
        edges: serializedEdges,
        timeline,
      }
    }

    const restoreState = (state: NodesProjectJSON) => {
      // Restore with current project properties but snapshot's nodes/edges/timeline
      const currentProjectState = currentProjectRef.current
      const restoredState = {
        ...state, // Use snapshot's nodes, edges, timeline, version
        viewport: currentProjectState.viewport, // But keep current viewport
        // Preserve any other current project properties that shouldn't change
      }
      currentLoadProjectFile.current(restoredState)
    }

    managerRef.current = new UndoRedoManager(getCurrentState, restoreState)
    console.log('UndoRedoManager created (no initial snapshot yet)')
  }

  // Ref to track if we're currently restoring state (to prevent recursive snapshots)
  const isRestoringRef = useRef(false)
  const hasInitialSnapshot = useRef(false)

  const takeSnapshot = useCallback((description: string) => {
    if (isRestoringRef.current) return

    // Take initial snapshot on first user action if not already taken
    if (!hasInitialSnapshot.current && description !== 'Initial state') {
      try {
        console.log('Taking delayed initial snapshot before:', description)
        managerRef.current?.takeSnapshot('Initial state')
        hasInitialSnapshot.current = true
        console.log(
          'Initial snapshot complete, history length:',
          managerRef.current?.getHistory().length
        )
      } catch (error) {
        console.warn('Failed to take initial snapshot:', error)
        return // Don't proceed if initial snapshot failed
      }
    }

    console.log(`Taking snapshot: ${description}`)
    managerRef.current?.takeSnapshot(description)
    console.log('After snapshot, history length:', managerRef.current?.getHistory().length)
  }, [])

  const undo = useCallback(() => {
    isRestoringRef.current = true
    managerRef.current?.undo()
    // Reset flag after a short delay to allow state updates to complete
    setTimeout(() => {
      isRestoringRef.current = false
    }, 100)
  }, [])

  const redo = useCallback(() => {
    isRestoringRef.current = true
    managerRef.current?.redo()
    // Reset flag after a short delay to allow state updates to complete
    setTimeout(() => {
      isRestoringRef.current = false
    }, 100)
  }, [])

  const clear = useCallback(() => {
    managerRef.current?.clear()
  }, [])

  return {
    takeSnapshot,
    undo,
    redo,
    clear,
    state$: managerRef.current?.getState$(),
    getState: () => managerRef.current?.getState(),
    canUndo: () => managerRef.current?.canUndo() || false,
    canRedo: () => managerRef.current?.canRedo() || false,
    isRestoring: () => isRestoringRef.current,
  }
}
