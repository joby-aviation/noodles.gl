// App-wide view state: panels, dialogs, the map's placement, and what a connection drag is
// hovering. Never part of the document or an undo step.

import type { Edge as ReactFlowEdge } from '@xyflow/react'
import { create } from 'zustand'

export interface PendingInsertionIndex {
  nodeId: string
  handleId: string
  index: number
}

export interface ConnectionDragState {
  sourceNodeId: string
  sourceHandleId: string
  compatibleNodeIds: Set<string>
  compatibleEdgeIds: Set<string>
}

export interface NodeDragState {
  nodeId: string
  hasExistingConnections: boolean
  targetedEdge: { id: string; canInsert: boolean } | null
}

interface UIStoreState {
  hoveredOutputHandle: { nodeId: string; handleId: string } | null
  setHoveredOutputHandle: (handle: { nodeId: string; handleId: string } | null) => void
  connectionDragState: ConnectionDragState | null
  setConnectionDragState: (state: ConnectionDragState | null) => void
  // Slot index for multi-input handles: written by MultiInputHandle while a connection
  // (or reconnection) drag hovers it, consumed once by onConnect/onReconnect, cleared
  // when a drag is cancelled or the publishing handle unmounts
  pendingInsertionIndex: PendingInsertionIndex | null
  setPendingInsertionIndex: (info: PendingInsertionIndex | null) => void
  targetedEdge: { id: string; compatible: boolean } | null
  setTargetedEdge: (edge: { id: string; compatible: boolean } | null) => void
  nodeDragState: NodeDragState | null
  setNodeDragState: (state: NodeDragState | null) => void
  inspectedReferenceEdge: ReactFlowEdge | null
  setInspectedReferenceEdge: (edge: ReactFlowEdge | null) => void
  sidebarSearchFocusTrigger: number
  triggerSidebarSearch: () => void
  settingsDialogOpen: boolean
  setSettingsDialogOpen: (open: boolean) => void
  quickStartModalOpen: boolean
  setQuickStartModalOpen: (open: boolean) => void
  timelineExpanded: boolean
  setTimelineExpanded: (expanded: boolean) => void
  spreadsheetVisible: boolean
  setSpreadsheetVisible: (visible: boolean) => void
  pinnedSpreadsheetNodeId: string | null
  setPinnedSpreadsheetNodeId: (id: string | null) => void
  mapMode: MapMode
  setMapMode: (mode: MapMode) => void
  // Node an example selected on open; its parameter pane shows a short hint until the user
  // edits a value or selects something else
  starterHintNodeId: string | null
  setStarterHintNodeId: (id: string | null) => void
  // A node selected from the map: the graph pans to it if needed and pulses it. `seq`
  // grows with each request, so clicking the same feature twice pulses twice.
  mapPickFocus: { nodeId: string; seq: number } | null
  focusNodeFromMap: (nodeId: string) => void
  // The node the graph outlines for a second after it was picked on the map
  pulsingNodeId: string | null
  setPulsingNodeId: (id: string | null) => void
}

// docked: map in its own panel above the node graph
// floating: map in a draggable window
// underlay: map fills the node graph area, drawn behind the graph
export type MapMode = 'docked' | 'floating' | 'underlay'

const MAP_MODES: MapMode[] = ['docked', 'floating', 'underlay']

function loadMapMode(): MapMode {
  const stored = localStorage.getItem('noodles-map-mode') as MapMode | null
  return stored && MAP_MODES.includes(stored) ? stored : 'docked'
}

export const useUIStore = create<UIStoreState>(set => ({
  hoveredOutputHandle: null,
  setHoveredOutputHandle: handle => set({ hoveredOutputHandle: handle }),
  connectionDragState: null,
  setConnectionDragState: state => set({ connectionDragState: state }),
  pendingInsertionIndex: null,
  setPendingInsertionIndex: info => set({ pendingInsertionIndex: info }),
  targetedEdge: null,
  setTargetedEdge: edge => set({ targetedEdge: edge }),
  nodeDragState: null,
  setNodeDragState: state => set({ nodeDragState: state }),
  inspectedReferenceEdge: null,
  setInspectedReferenceEdge: edge => set({ inspectedReferenceEdge: edge }),
  sidebarSearchFocusTrigger: 0,
  triggerSidebarSearch: () =>
    set(state => ({ sidebarSearchFocusTrigger: state.sidebarSearchFocusTrigger + 1 })),
  settingsDialogOpen: false,
  setSettingsDialogOpen: open => set({ settingsDialogOpen: open }),
  quickStartModalOpen: false,
  setQuickStartModalOpen: open => set({ quickStartModalOpen: open }),
  timelineExpanded: false,
  setTimelineExpanded: expanded => set({ timelineExpanded: expanded }),
  spreadsheetVisible: false,
  setSpreadsheetVisible: visible => set({ spreadsheetVisible: visible }),
  pinnedSpreadsheetNodeId: null,
  setPinnedSpreadsheetNodeId: id => set({ pinnedSpreadsheetNodeId: id }),
  mapMode: loadMapMode(),
  setMapMode: mode => {
    set({ mapMode: mode })
    localStorage.setItem('noodles-map-mode', mode)
  },
  starterHintNodeId: null,
  setStarterHintNodeId: id => set({ starterHintNodeId: id }),
  mapPickFocus: null,
  focusNodeFromMap: nodeId =>
    set(state => ({ mapPickFocus: { nodeId, seq: (state.mapPickFocus?.seq ?? 0) + 1 } })),
  pulsingNodeId: null,
  setPulsingNodeId: id => set({ pulsingNodeId: id }),
}))

export const getUIStore = () => useUIStore.getState()

// Hides the hint shown for an example's starter node; called on the first edit
export const dismissStarterHint = () => {
  if (getUIStore().starterHintNodeId) getUIStore().setStarterHintNodeId(null)
}
