import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { useUndoRedo } from '../utils/use-reactflow-undo-redo'

export interface UndoRedoHandlerRef {
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  getState: () => {
    canUndo: boolean
    canRedo: boolean
    undoDescription?: string
    redoDescription?: string
  }
  isRestoring: () => boolean
}

// This component must be placed inside ReactFlow to access the zustand store
export const UndoRedoHandler = forwardRef<UndoRedoHandlerRef>((_, ref) => {
  const undoRedo = useUndoRedo()

  // Expose the undo/redo methods to parent component via ref
  useImperativeHandle(
    ref,
    () => ({
      undo: undoRedo.undo,
      redo: undoRedo.redo,
      canUndo: undoRedo.canUndo,
      canRedo: undoRedo.canRedo,
      getState: undoRedo.getState,
      isRestoring: undoRedo.isRestoring,
    }),
    [undoRedo]
  )

  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if Theatre.js timeline is focused
      // Theatre.js uses a shadow DOM with id 'theatrejs-studio-root'
      // If the event target or active element is within Theatre's shadow DOM,
      // don't handle the event - let Theatre.js handle its own undo/redo
      const theatreRoot = document.querySelector('#theatrejs-studio-root')
      const isTheatreFocused = (() => {
        // Check if event target is within Theatre.js shadow DOM
        if (theatreRoot?.shadowRoot && e.target instanceof Node) {
          const composedPath = e.composedPath()
          if (composedPath.includes(theatreRoot.shadowRoot as EventTarget)) {
            return true
          }
        }

        // Check if active element is within Theatre.js shadow DOM
        if (theatreRoot?.shadowRoot?.activeElement) {
          return true
        }

        // Check if the event target is the Theatre.js root itself
        if (e.target === theatreRoot) {
          return true
        }

        return false
      })()

      // Only handle undo/redo for the graph if Theatre.js is not focused
      if (isTheatreFocused) {
        console.info('Theatre.js is focused, skipping graph undo/redo')
        return
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        console.info('Undo triggered via keyboard')
        undoRedo.undo()
      } else if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') ||
        ((e.ctrlKey || e.metaKey) && e.key === 'y')
      ) {
        e.preventDefault()
        console.info('Redo triggered via keyboard')
        undoRedo.redo()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [undoRedo])

  // This component doesn't render anything
  return null
})
