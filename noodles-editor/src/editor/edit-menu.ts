// What the top bar's Edit menu calls to undo, redo, copy and paste, and reads to enable its items.
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
}

// What the Edit menu calls to copy and paste the selection.
export interface CopyControlsRef {
  copy: () => void
  paste: () => void
  canCopy: () => boolean
  canPaste: () => boolean
}
