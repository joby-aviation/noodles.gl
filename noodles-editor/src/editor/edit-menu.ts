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

// The history step a key press asks for: mod+Z undoes, mod+shift+Z and mod+Y redo. Bound for
// the whole window, so it works from any editor, the node graph or not; a text field keeps
// its own undo.
export function historyShortcut(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.metaKey || e.ctrlKey)) return null
  const target = e.target as HTMLElement | null
  if (target?.closest?.('input, textarea, select, [contenteditable], .cm-editor')) return null
  const key = e.key.toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === 'y') return 'redo'
  return null
}
