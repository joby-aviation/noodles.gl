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
