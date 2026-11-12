// The workspaces the editor's window is laid out in, persisted to localStorage. The trees and
// their edits are in workspace.ts.

import { create } from 'zustand'
import {
  type EditorType,
  hasEditor,
  hideEditor,
  type LayoutNode,
  PRESETS,
  sanitize,
  showEditor,
  WORKSPACES,
  type WorkspaceId,
} from './workspace'

const STORAGE_KEY = 'noodles-workspaces'

// The fixed layout's panel sizes, from before the editor had workspaces
for (const key of [
  'noodles-timeline-height',
  'noodles-timeline-height-v2',
  'noodles-spreadsheet-width',
  'react-resizable-panels:noodles:columns',
  'react-resizable-panels:noodles:main-split',
]) {
  localStorage.removeItem(key)
}

interface WorkspaceState {
  active: WorkspaceId
  layouts: Record<WorkspaceId, LayoutNode>
  setActive: (id: WorkspaceId) => void
  // Edit the active workspace's tree
  update: (fn: (tree: LayoutNode) => LayoutNode) => void
  // Put a workspace back to its preset
  reset: (id: WorkspaceId) => void
}

const isWorkspace = (id: unknown): id is WorkspaceId => WORKSPACES.some(w => w.id === id)

function presets(): Record<WorkspaceId, LayoutNode> {
  return Object.fromEntries(WORKSPACES.map(w => [w.id, PRESETS[w.id]()])) as Record<
    WorkspaceId,
    LayoutNode
  >
}

function load(): Pick<WorkspaceState, 'active' | 'layouts'> {
  const layouts = presets()
  let active: WorkspaceId = 'layout'
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isWorkspace(saved?.active)) active = saved.active
    for (const w of WORKSPACES) {
      const tree = sanitize(saved?.layouts?.[w.id])
      if (tree) layouts[w.id] = tree
    }
  } catch {}
  return { active, layouts }
}

export const useWorkspaceStore = create<WorkspaceState>(set => ({
  ...load(),
  setActive: id => set({ active: id }),
  update: fn =>
    set(state => {
      const tree = fn(state.layouts[state.active])
      return tree === state.layouts[state.active]
        ? state
        : { layouts: { ...state.layouts, [state.active]: tree } }
    }),
  reset: id => set(state => ({ layouts: { ...state.layouts, [id]: PRESETS[id]() } })),
}))

useWorkspaceStore.subscribe(({ active, layouts }) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ active, layouts }))
})

export const activeLayout = (state: WorkspaceState) => state.layouts[state.active]

// Whether the active workspace shows an editor, for menus that toggle one
export const useEditorShown = (editor: EditorType) =>
  useWorkspaceStore(state => hasEditor(activeLayout(state), editor))

export function setEditorShown(editor: EditorType, shown: boolean) {
  useWorkspaceStore.getState().update(tree => (shown ? showEditor : hideEditor)(tree, editor))
}
