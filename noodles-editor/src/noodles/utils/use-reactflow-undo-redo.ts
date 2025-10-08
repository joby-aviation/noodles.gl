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

interface HistoryEntry {
  id: string
  timestamp: number
  description: string
  nodeChanges: NodeChange[]
  edgeChanges: EdgeChange[]
  // Store the state before these changes were applied
  nodesBefore: ReactFlowNode[]
  edgesBefore: ReactFlowEdge[]
}

interface UndoRedoState {
  canUndo: boolean
  canRedo: boolean
  undoDescription?: string
  redoDescription?: string
}

interface UndoRedoState {
  history: HistoryEntry[]
  currentIndex: number
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

  // These hooks must be used inside ReactFlow context
  const onNodesChange = useStore(s => s.onNodesChange)
  const onEdgesChange = useStore(s => s.onEdgesChange)
  const nodes = useStore(s => s.nodes)
  const edges = useStore(s => s.edges)
  const store = useStoreApi()

  const { history, currentIndex } = undoRedoState

  // Intercept nodes changes
  useEffect(() => {
    if (!onNodesChange || onNodesChangeIntercepted.current) {
      return
    }

    onNodesChangeIntercepted.current = true
    const userOnNodesChange = onNodesChange

    const onNodesChangeWithHistory: OnNodesChange = changes => {
      // Skip recording changes during undo/redo operations
      if (isRestoringRef.current) {
        userOnNodesChange(changes)
        return
      }

      // Record state before changes
      const nodesBefore = [...nodes]
      const edgesBefore = [...edges]

      // Apply changes
      userOnNodesChange(changes)

      // Create history entry for significant changes (not just selection/drag)
      const significantChanges = changes.filter(
        change =>
          change.type === 'add' ||
          change.type === 'remove' ||
          change.type === 'reset' ||
          (change.type === 'position' && change.dragging === false) // Only record final position
      )

      console.info(
        'Node changes:',
        changes.map(c => c.type)
      )
      console.info('Significant changes:', significantChanges.length)

      if (significantChanges.length > 0) {
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          description: getChangeDescription(significantChanges, 'node'),
          nodeChanges: significantChanges,
          edgeChanges: [],
          nodesBefore,
          edgesBefore,
        }

        setUndoRedoState(prev => {
          console.info(
            `Before adding node entry - history length: ${prev.history.length}, currentIndex: ${prev.currentIndex}`
          )
          // Remove any history after current index
          const newHistory = prev.history.slice(0, prev.currentIndex + 1)
          newHistory.push(entry)
          console.info(`After adding node entry - new history length: ${newHistory.length}`)

          // Limit history size
          let finalHistory = newHistory
          let newIndex = prev.currentIndex + 1
          if (newHistory.length > maxHistorySize) {
            finalHistory = newHistory.slice(-maxHistorySize)
            newIndex = finalHistory.length - 1
            console.info(
              `Trimmed history to ${finalHistory.length} entries, new index: ${newIndex}`
            )
          }

          console.info(
            `Added node history entry: "${entry.description}", final index: ${newIndex}, final history length: ${finalHistory.length}`
          )
          return {
            history: finalHistory,
            currentIndex: newIndex,
          }
        })
      }
    }

    store.setState({ onNodesChange: onNodesChangeWithHistory })
  }, [onNodesChange, nodes, edges, store])

  // Intercept edges changes
  useEffect(() => {
    if (!onEdgesChange || onEdgesChangeIntercepted.current) {
      return
    }

    onEdgesChangeIntercepted.current = true
    const userOnEdgesChange = onEdgesChange

    const onEdgesChangeWithHistory: OnEdgesChange = changes => {
      // Skip recording changes during undo/redo operations
      if (isRestoringRef.current) {
        userOnEdgesChange(changes)
        return
      }

      // Record state before changes
      const nodesBefore = [...nodes]
      const edgesBefore = [...edges]

      // Apply changes
      userOnEdgesChange(changes)

      console.info(
        'Edge changes:',
        changes.map(c => c.type)
      )

      // Create history entry for all edge changes (they're usually significant)
      if (changes.length > 0) {
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          description: getChangeDescription(changes, 'edge'),
          nodeChanges: [],
          edgeChanges: changes,
          nodesBefore,
          edgesBefore,
        }

        setUndoRedoState(prev => {
          console.info(
            `Before adding edge entry - history length: ${prev.history.length}, currentIndex: ${prev.currentIndex}`
          )
          // Remove any history after current index
          const newHistory = prev.history.slice(0, prev.currentIndex + 1)
          newHistory.push(entry)
          console.info(`After adding edge entry - new history length: ${newHistory.length}`)

          // Limit history size
          let finalHistory = newHistory
          let newIndex = prev.currentIndex + 1
          if (newHistory.length > maxHistorySize) {
            finalHistory = newHistory.slice(-maxHistorySize)
            newIndex = finalHistory.length - 1
            console.info(
              `Trimmed history to ${finalHistory.length} entries, new index: ${newIndex}`
            )
          }

          console.info(
            `Added edge history entry: "${entry.description}", final index: ${newIndex}, final history length: ${finalHistory.length}`
          )
          return {
            history: finalHistory,
            currentIndex: newIndex,
          }
        })
      }
    }

    store.setState({ onEdgesChange: onEdgesChangeWithHistory })
  }, [onEdgesChange, nodes, edges, store])

  const undo = useCallback(() => {
    console.info(`Undo check: currentIndex=${currentIndex}, history.length=${history.length}`)

    if (currentIndex < 0 || currentIndex >= history.length) {
      console.info('Cannot undo - no history available')
      return
    }

    const entry = history[currentIndex]
    if (!entry) {
      console.warn('Cannot undo - history entry is undefined')
      return
    }

    isRestoringRef.current = true

    console.info(`Undoing: ${entry.description}`)

    // Restore the state before the changes
    store.setState({
      nodes: entry.nodesBefore,
      edges: entry.edgesBefore,
    })

    setUndoRedoState(prev => ({
      ...prev,
      currentIndex: prev.currentIndex - 1,
    }))

    // Reset flag after state updates
    setTimeout(() => {
      isRestoringRef.current = false
    }, 100)
  }, [currentIndex, history, store])

  const redo = useCallback(() => {
    if (currentIndex >= history.length - 1) return

    const entry = history[currentIndex + 1]
    isRestoringRef.current = true

    console.info(`Redoing: ${entry.description}`)

    // We need to reapply the changes, but we stored the "before" state
    // So we need to apply the changes to get to the "after" state
    // For now, let's implement a simpler approach by storing after state too
    // TODO: Apply the actual changes instead of storing full state

    setUndoRedoState(prev => ({
      ...prev,
      currentIndex: prev.currentIndex + 1,
    }))

    // Reset flag after state updates
    setTimeout(() => {
      isRestoringRef.current = false
    }, 100)
  }, [currentIndex, history])

  const canUndo =
    currentIndex >= 0 && currentIndex < history.length && history[currentIndex] != null
  const canRedo = currentIndex < history.length - 1

  console.info(
    `State check: currentIndex=${currentIndex}, history.length=${history.length}, canUndo=${canUndo}`
  )

  const state: UndoRedoState = {
    canUndo,
    canRedo,
    undoDescription: canUndo ? history[currentIndex]?.description : undefined,
    redoDescription: canRedo ? history[currentIndex + 1]?.description : undefined,
  }

  return {
    undo,
    redo,
    canUndo: () => canUndo,
    canRedo: () => canRedo,
    getState: () => state,
    isRestoring: () => isRestoringRef.current,
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
