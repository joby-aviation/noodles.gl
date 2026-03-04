import type {
  EdgeChange,
  NodeChange,
  OnEdgesChange,
  OnNodesChange,
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
} from '@xyflow/react'
import { useStore, useStoreApi } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { captureTimelineState, getTimelineStore } from '../../timeline/timeline-store'
import {
  debugHistory,
  debugHistoryRedo,
  debugHistorySnapshot,
  debugHistoryUndo,
} from '../../utils/debug'

interface HistoryEntry {
  id: string
  timestamp: number
  description: string
  nodeChanges: NodeChange[]
  edgeChanges: EdgeChange[]
  // Store the state before and after these changes were applied
  nodesBefore: ReactFlowNode[]
  edgesBefore: ReactFlowEdge[]
  nodesAfter: ReactFlowNode[]
  edgesAfter: ReactFlowEdge[]
  // Timeline state snapshots for unified undo/redo
  timelineStateBefore?: string
  timelineStateAfter?: string
}

interface UndoRedoState {
  history: HistoryEntry[]
  currentIndex: number
}

interface UndoRedoPublicState {
  canUndo: boolean
  canRedo: boolean
  undoDescription?: string
  redoDescription?: string
}

export function useUndoRedo() {
  const [undoRedoState, setUndoRedoState] = useState<UndoRedoState>({
    history: [],
    currentIndex: -1,
  })
  const maxHistorySize = 50

  const onNodesChangeIntercepted = useRef(false)
  const onEdgesChangeIntercepted = useRef(false)
  const isRestoringRef = useRef(false)

  // Store references to original handlers for use during undo/redo
  const originalOnNodesChangeRef = useRef<OnNodesChange | null>(null)
  const originalOnEdgesChangeRef = useRef<OnEdgesChange | null>(null)

  // These hooks must be used inside ReactFlow context
  const onNodesChange = useStore(s => s.onNodesChange)
  const onEdgesChange = useStore(s => s.onEdgesChange)
  const store = useStoreApi()

  const { history, currentIndex } = undoRedoState

  // Intercept nodes changes
  useEffect(() => {
    if (!onNodesChange || onNodesChangeIntercepted.current) {
      return
    }

    onNodesChangeIntercepted.current = true
    const userOnNodesChange = onNodesChange
    originalOnNodesChangeRef.current = userOnNodesChange

    const onNodesChangeWithHistory: OnNodesChange = changes => {
      // Skip recording changes during undo/redo operations
      if (isRestoringRef.current) {
        userOnNodesChange(changes)
        return
      }

      // Record state before changes - capture directly from store to avoid stale closure
      const { nodes: nodesBefore, edges: edgesBefore } = store.getState()
      const timelineStateBefore = captureTimelineState()

      // Apply changes
      userOnNodesChange(changes)

      // Create history entry for significant changes (not just selection/drag)
      const significantChanges = changes.filter(
        change =>
          change.type === 'add' ||
          change.type === 'remove' ||
          (change.type === 'position' && change.dragging === false) // Only record final position
      )

      debugHistory(
        'Node changes: %O',
        changes.map(c => c.type)
      )
      debugHistory('Significant changes: %d', significantChanges.length)
      debugHistorySnapshot('Captured state counts: %O', {
        nodesBeforeCount: nodesBefore.length,
        edgesBeforeCount: edgesBefore.length,
      })

      if (significantChanges.length > 0) {
        // Capture state after changes (need to use setTimeout to get updated state from store)
        setTimeout(() => {
          const { nodes: nodesAfter, edges: edgesAfter } = store.getState()
          const timelineStateAfter = captureTimelineState()

          debugHistorySnapshot('Captured after state counts: %O', {
            nodesAfterCount: nodesAfter.length,
            edgesAfterCount: edgesAfter.length,
          })

          const entry: HistoryEntry = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            description: getChangeDescription(significantChanges, 'node'),
            nodeChanges: significantChanges,
            edgeChanges: [],
            nodesBefore: [...nodesBefore],
            edgesBefore: [...edgesBefore],
            nodesAfter: [...nodesAfter],
            edgesAfter: [...edgesAfter],
            timelineStateBefore,
            timelineStateAfter,
          }

          setUndoRedoState(prev => {
            debugHistorySnapshot(
              'Before adding node entry - history length: %d, currentIndex: %d',
              prev.history.length,
              prev.currentIndex
            )
            // Remove any history after current index
            const newHistory = prev.history.slice(0, prev.currentIndex + 1)
            newHistory.push(entry)
            debugHistorySnapshot(
              'After adding node entry - new history length: %d',
              newHistory.length
            )

            // Limit history size
            let finalHistory = newHistory
            let newIndex = prev.currentIndex + 1
            if (newHistory.length > maxHistorySize) {
              finalHistory = newHistory.slice(-maxHistorySize)
              newIndex = finalHistory.length - 1
              debugHistory(
                'Trimmed history to %d entries, new index: %d',
                finalHistory.length,
                newIndex
              )
            }

            debugHistorySnapshot(
              'Added node history entry: "%s", final index: %d, final history length: %d',
              entry.description,
              newIndex,
              finalHistory.length
            )
            return {
              history: finalHistory,
              currentIndex: newIndex,
            }
          })
        }, 0)
      }
    }

    store.setState({ onNodesChange: onNodesChangeWithHistory })
  }, [onNodesChange, store])

  // Intercept edges changes
  useEffect(() => {
    if (!onEdgesChange || onEdgesChangeIntercepted.current) {
      return
    }

    onEdgesChangeIntercepted.current = true
    const userOnEdgesChange = onEdgesChange
    originalOnEdgesChangeRef.current = userOnEdgesChange

    const onEdgesChangeWithHistory: OnEdgesChange = changes => {
      // Skip recording changes during undo/redo operations
      if (isRestoringRef.current) {
        userOnEdgesChange(changes)
        return
      }

      // Record state before changes - capture directly from store to avoid stale closure
      const { nodes: nodesBefore, edges: edgesBefore } = store.getState()
      const timelineStateBefore = captureTimelineState()

      // Apply changes
      userOnEdgesChange(changes)

      debugHistory(
        'Edge changes: %O',
        changes.map(c => c.type)
      )

      // Create history entry for all edge changes (they're usually significant)
      if (changes.length > 0) {
        // Capture state after changes (need to use setTimeout to get updated state from store)
        setTimeout(() => {
          const { nodes: nodesAfter, edges: edgesAfter } = store.getState()
          const timelineStateAfter = captureTimelineState()

          const entry: HistoryEntry = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            description: getChangeDescription(changes, 'edge'),
            nodeChanges: [],
            edgeChanges: changes,
            nodesBefore,
            edgesBefore,
            nodesAfter: [...nodesAfter],
            edgesAfter: [...edgesAfter],
            timelineStateBefore,
            timelineStateAfter,
          }

          setUndoRedoState(prev => {
            debugHistorySnapshot(
              'Before adding edge entry - history length: %d, currentIndex: %d',
              prev.history.length,
              prev.currentIndex
            )
            // Remove any history after current index
            const newHistory = prev.history.slice(0, prev.currentIndex + 1)
            newHistory.push(entry)
            debugHistorySnapshot(
              'After adding edge entry - new history length: %d',
              newHistory.length
            )

            // Limit history size
            let finalHistory = newHistory
            let newIndex = prev.currentIndex + 1
            if (newHistory.length > maxHistorySize) {
              finalHistory = newHistory.slice(-maxHistorySize)
              newIndex = finalHistory.length - 1
              debugHistory(
                'Trimmed history to %d entries, new index: %d',
                finalHistory.length,
                newIndex
              )
            }

            debugHistorySnapshot(
              'Added edge history entry: "%s", final index: %d, final history length: %d',
              entry.description,
              newIndex,
              finalHistory.length
            )
            return {
              history: finalHistory,
              currentIndex: newIndex,
            }
          })
        }, 0)
      }
    }

    store.setState({ onEdgesChange: onEdgesChangeWithHistory })
  }, [onEdgesChange, store])

  const undo = useCallback(() => {
    debugHistoryUndo('Undo check: currentIndex=%d, history.length=%d', currentIndex, history.length)

    if (currentIndex < 0 || currentIndex >= history.length) {
      debugHistoryUndo('Cannot undo - no history available')
      return
    }

    const entry = history[currentIndex]
    if (!entry) {
      console.warn('Cannot undo - history entry is undefined')
      return
    }

    isRestoringRef.current = true

    debugHistoryUndo('Undoing: %s', entry.description)

    // Calculate the changes needed to restore the state
    const currentNodes = store.getState().nodes
    const currentEdges = store.getState().edges

    debugHistoryUndo('Undo state comparison: %O', {
      currentNodeCount: currentNodes.length,
      currentNodeIds: currentNodes.map(n => n.id),
      targetNodeCount: entry.nodesBefore.length,
      targetNodeIds: entry.nodesBefore.map(n => n.id),
      afterNodeCount: entry.nodesAfter.length,
      afterNodeIds: entry.nodesAfter.map(n => n.id),
    })

    // Create remove changes for nodes that exist now but shouldn't
    const nodeIdsToKeep = new Set(entry.nodesBefore.map(n => n.id))
    const nodeRemoveChanges: NodeChange[] = currentNodes
      .filter(n => !nodeIdsToKeep.has(n.id))
      .map(n => ({ type: 'remove' as const, id: n.id }))

    // Create add changes for nodes that should exist but don't
    const currentNodeIds = new Set(currentNodes.map(n => n.id))
    const nodeAddChanges: NodeChange[] = entry.nodesBefore
      .filter(n => !currentNodeIds.has(n.id))
      .map(n => ({ type: 'add' as const, item: n }))

    // Create update changes for nodes that exist in both but may have changed
    const nodeUpdateChanges: NodeChange[] = entry.nodesBefore
      .filter(n => currentNodeIds.has(n.id))
      .flatMap(n => {
        const current = currentNodes.find(cn => cn.id === n.id)
        // Check if position changed
        if (
          current &&
          (current.position.x !== n.position.x || current.position.y !== n.position.y)
        ) {
          return [
            {
              type: 'position' as const,
              id: n.id,
              position: n.position,
              dragging: false,
            },
          ]
        }
        return []
      })

    const allNodeChanges = [...nodeRemoveChanges, ...nodeAddChanges, ...nodeUpdateChanges]

    // Similar for edges
    const edgeIdsToKeep = new Set(entry.edgesBefore.map(e => e.id))
    const edgeRemoveChanges: EdgeChange[] = currentEdges
      .filter(e => !edgeIdsToKeep.has(e.id))
      .map(e => ({ type: 'remove' as const, id: e.id }))

    const currentEdgeIds = new Set(currentEdges.map(e => e.id))
    const edgeAddChanges: EdgeChange[] = entry.edgesBefore
      .filter(e => !currentEdgeIds.has(e.id))
      .map(e => ({ type: 'add' as const, item: e }))

    const allEdgeChanges = [...edgeRemoveChanges, ...edgeAddChanges]

    debugHistoryUndo('Applying undo changes: %O', {
      nodeChanges: allNodeChanges.map(c => c.type),
      edgeChanges: allEdgeChanges.map(c => c.type),
    })

    // Apply changes through the original handlers (which will sync external state)
    // We use the original handlers stored in refs to bypass our interception
    if (allNodeChanges.length > 0 && originalOnNodesChangeRef.current) {
      originalOnNodesChangeRef.current(allNodeChanges)
    }
    if (allEdgeChanges.length > 0 && originalOnEdgesChangeRef.current) {
      originalOnEdgesChangeRef.current(allEdgeChanges)
    }

    // Restore timeline state if the entry has a snapshot
    if (entry.timelineStateBefore) {
      try {
        getTimelineStore().fromTheatreJSON(JSON.parse(entry.timelineStateBefore))
      } catch (e) {
        console.warn('Failed to restore timeline state during undo', e)
      }
    }

    setUndoRedoState(prev => ({
      ...prev,
      currentIndex: prev.currentIndex - 1,
    }))

    // Use queueMicrotask to reset flag after all synchronous state updates complete
    queueMicrotask(() => {
      isRestoringRef.current = false
    })
  }, [currentIndex, history, store])

  const redo = useCallback(() => {
    if (currentIndex >= history.length - 1) return

    const entry = history[currentIndex + 1]
    isRestoringRef.current = true

    debugHistoryRedo('Redoing: %s', entry.description)

    // Calculate the changes needed to restore the "after" state
    const currentNodes = store.getState().nodes
    const currentEdges = store.getState().edges

    // Create remove changes for nodes that exist now but shouldn't
    const nodeIdsToKeep = new Set(entry.nodesAfter.map(n => n.id))
    const nodeRemoveChanges: NodeChange[] = currentNodes
      .filter(n => !nodeIdsToKeep.has(n.id))
      .map(n => ({ type: 'remove' as const, id: n.id }))

    // Create add changes for nodes that should exist but don't
    const currentNodeIds = new Set(currentNodes.map(n => n.id))
    const nodeAddChanges: NodeChange[] = entry.nodesAfter
      .filter(n => !currentNodeIds.has(n.id))
      .map(n => ({ type: 'add' as const, item: n }))

    // Create update changes for nodes that exist in both but may have changed
    const nodeUpdateChanges: NodeChange[] = entry.nodesAfter
      .filter(n => currentNodeIds.has(n.id))
      .flatMap(n => {
        const current = currentNodes.find(cn => cn.id === n.id)
        // Check if position changed
        if (
          current &&
          (current.position.x !== n.position.x || current.position.y !== n.position.y)
        ) {
          return [
            {
              type: 'position' as const,
              id: n.id,
              position: n.position,
              dragging: false,
            },
          ]
        }
        return []
      })

    const allNodeChanges = [...nodeRemoveChanges, ...nodeAddChanges, ...nodeUpdateChanges]

    // Similar for edges
    const edgeIdsToKeep = new Set(entry.edgesAfter.map(e => e.id))
    const edgeRemoveChanges: EdgeChange[] = currentEdges
      .filter(e => !edgeIdsToKeep.has(e.id))
      .map(e => ({ type: 'remove' as const, id: e.id }))

    const currentEdgeIds = new Set(currentEdges.map(e => e.id))
    const edgeAddChanges: EdgeChange[] = entry.edgesAfter
      .filter(e => !currentEdgeIds.has(e.id))
      .map(e => ({ type: 'add' as const, item: e }))

    const allEdgeChanges = [...edgeRemoveChanges, ...edgeAddChanges]

    debugHistoryRedo('Applying redo changes: %O', {
      nodeChanges: allNodeChanges.map(c => c.type),
      edgeChanges: allEdgeChanges.map(c => c.type),
    })

    // Apply changes through the original handlers (which will sync external state)
    // We use the original handlers stored in refs to bypass our interception
    if (allNodeChanges.length > 0 && originalOnNodesChangeRef.current) {
      originalOnNodesChangeRef.current(allNodeChanges)
    }
    if (allEdgeChanges.length > 0 && originalOnEdgesChangeRef.current) {
      originalOnEdgesChangeRef.current(allEdgeChanges)
    }

    // Restore timeline state if the entry has a snapshot
    if (entry.timelineStateAfter) {
      try {
        getTimelineStore().fromTheatreJSON(JSON.parse(entry.timelineStateAfter))
      } catch (e) {
        console.warn('Failed to restore timeline state during redo', e)
      }
    }

    setUndoRedoState(prev => ({
      ...prev,
      currentIndex: prev.currentIndex + 1,
    }))

    // Use queueMicrotask to reset flag after all synchronous state updates complete
    queueMicrotask(() => {
      isRestoringRef.current = false
    })
  }, [currentIndex, history, store])

  const canUndo =
    currentIndex >= 0 && currentIndex < history.length && history[currentIndex] != null
  const canRedo = currentIndex < history.length - 1

  debugHistory(
    'State check: currentIndex=%d, history.length=%d, canUndo=%s',
    currentIndex,
    history.length,
    canUndo
  )

  const state: UndoRedoPublicState = {
    canUndo,
    canRedo,
    undoDescription: canUndo ? history[currentIndex]?.description : undefined,
    redoDescription: canRedo ? history[currentIndex + 1]?.description : undefined,
  }

  // Record a pure timeline change (no node/edge changes) into the unified history
  const recordTimelineChange = useCallback(
    (desc: string, timelineStateBefore: string, timelineStateAfter: string) => {
      if (isRestoringRef.current) return
      const { nodes, edges } = store.getState()
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        description: desc,
        nodeChanges: [],
        edgeChanges: [],
        nodesBefore: [...nodes],
        edgesBefore: [...edges],
        nodesAfter: [...nodes],
        edgesAfter: [...edges],
        timelineStateBefore,
        timelineStateAfter,
      }
      setUndoRedoState(prev => {
        const newHistory = prev.history.slice(0, prev.currentIndex + 1)
        newHistory.push(entry)
        let finalHistory = newHistory
        let newIndex = prev.currentIndex + 1
        if (newHistory.length > maxHistorySize) {
          finalHistory = newHistory.slice(-maxHistorySize)
          newIndex = finalHistory.length - 1
        }
        return { history: finalHistory, currentIndex: newIndex }
      })
    },
    [store]
  )

  return {
    undo,
    redo,
    canUndo: () => canUndo,
    canRedo: () => canRedo,
    getState: () => state,
    isRestoring: () => isRestoringRef.current,
    recordTimelineChange,
    history,
    clear: () => {
      setUndoRedoState({
        history: [],
        currentIndex: -1,
      })
    },
  }
}

function getChangeDescription(changes: (NodeChange | EdgeChange)[], type: 'node' | 'edge'): string {
  if (changes.length === 1) {
    const change = changes[0]
    switch (change.type) {
      case 'add':
        return `Add ${type}`
      case 'remove':
        return `Delete ${type}`
      case 'position':
        return `Move ${type}`
      case 'select':
        return `Select ${type}`
      default:
        return `Update ${type}`
    }
  }
  const addCount = changes.filter(c => c.type === 'add').length
  const removeCount = changes.filter(c => c.type === 'remove').length
  const moveCount = changes.filter(c => c.type === 'position').length

  if (addCount > 0) return `Add ${addCount} ${type}s`
  if (removeCount > 0) return `Delete ${removeCount} ${type}s`
  if (moveCount > 0) return `Move ${moveCount} ${type}s`
  return `Update ${changes.length} ${type}s`
}
