import type { Edge as ReactFlowEdge } from '@xyflow/react'
import { create } from 'zustand'
import type { IOperator, Operator } from './operators'
// only import types from noodles to avoid circular dependencies
import type { OpId } from './utils/id-utils'
import { isAbsolutePath, resolvePath } from './utils/path-utils'

// ============================================================================
// Operator Store (Zustand) - Separate slice for operators and sheet objects
// ============================================================================

interface OperatorStoreState {
  // The actual maps
  operators: Map<OpId, Operator<IOperator>>
  sheetObjects: Map<OpId, unknown>

  // Batching state
  _batching: boolean

  // Operator actions
  getOp: (id: OpId) => Operator<IOperator> | undefined
  setOp: (id: OpId, op: Operator<IOperator>) => void
  deleteOp: (id: OpId) => void
  hasOp: (id: OpId) => boolean
  clearOps: () => void
  getAllOps: () => Operator<IOperator>[]
  getOpEntries: () => [OpId, Operator<IOperator>][]

  // Sheet object actions
  getSheetObject: (id: OpId) => unknown
  setSheetObject: (id: OpId, sheetObj: unknown) => void
  deleteSheetObject: (id: OpId) => void
  hasSheetObject: (id: OpId) => boolean

  // Batching
  batch: (fn: () => void) => void
}

export interface PendingInsertionIndex {
  nodeId: string
  handleId: string
  index: number
}

export const useOperatorStore = create<OperatorStoreState>((set, get) => ({
  operators: new Map(),
  sheetObjects: new Map(),
  _batching: false,

  // Operator actions
  getOp: id => get().operators.get(id),

  setOp: (id, op) => {
    const operators = new Map(get().operators)
    operators.set(id, op)
    set({ operators })
  },

  deleteOp: id => {
    const operators = new Map(get().operators)
    const op = operators.get(id)
    operators.delete(id)
    // Dispose only if this op instance is no longer referenced at any id.
    // During renames, setOp(newId, op) runs before deleteOp(oldId), so the
    // same instance is still in the map and should NOT be disposed.
    const isStillReferenced = op && Array.from(operators.values()).some(o => o === op)
    set({ operators })
    if (op && !isStillReferenced) {
      op.dispose?.()
    }
  },

  hasOp: id => get().operators.has(id),

  clearOps: () => {
    set({ operators: new Map(), sheetObjects: new Map() })
  },

  getAllOps: () => Array.from(get().operators.values()),

  getOpEntries: () => Array.from(get().operators.entries()),

  // Sheet object actions
  getSheetObject: id => get().sheetObjects.get(id),

  setSheetObject: (id, sheetObj) => {
    const sheetObjects = new Map(get().sheetObjects)
    sheetObjects.set(id, sheetObj)
    set({ sheetObjects })
  },

  deleteSheetObject: id => {
    const sheetObjects = new Map(get().sheetObjects)
    sheetObjects.delete(id)
    set({ sheetObjects })
  },

  hasSheetObject: id => get().sheetObjects.has(id),

  // Batching - prevents multiple Zustand updates during batch operations
  batch: fn => {
    set({ _batching: true })
    fn()
    set({ _batching: false })
  },
}))

// ============================================================================
// UI Store (Zustand) - Separate slice for UI state
// ============================================================================

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
}))

// ============================================================================
// Active OutOp Store (Zustand) - Tracks which OutOp is the "active" one
// Similar to Blender's active camera concept - sticky selection independent
// of node selection that drives render settings
// ============================================================================

interface ActiveOutOpState {
  activeOutOpId: string | null
  setActiveOutOpId: (id: string | null) => void
}

export const useActiveOutOpStore = create<ActiveOutOpState>(set => ({
  activeOutOpId: null,
  setActiveOutOpId: id => set({ activeOutOpId: id }),
}))

// Get the active OutOp store instance for use outside React components
export const getActiveOutOpStore = () => useActiveOutOpStore.getState()

// ============================================================================
// Helper functions for non-React contexts
// ============================================================================

// Get the operator store instance for use outside React components
export const getOpStore = () => useOperatorStore.getState()

// Get the UI store instance for use outside React components
export const getUIStore = () => useUIStore.getState()

// `path` can be absolute or relative to `contextOperatorId`
export const getOp = (
  path: string,
  contextOperatorId?: string
): Operator<IOperator> | undefined => {
  if (!path) {
    return undefined
  }

  const store = useOperatorStore.getState()

  // If path is absolute or no context provided, use direct lookup
  if (isAbsolutePath(path) || !contextOperatorId) {
    return store.getOp(path)
  }

  // Resolve relative path using context
  const resolvedPath = resolvePath(path, contextOperatorId)
  if (!resolvedPath) {
    return undefined
  }

  return store.getOp(resolvedPath)
}

// Convenience helpers for common store operations
export const setOp = (id: OpId, op: Operator<IOperator>) => getOpStore().setOp(id, op)
export const deleteOp = (id: OpId) => getOpStore().deleteOp(id)
export const hasOp = (id: OpId) => getOpStore().hasOp(id)
export const clearOps = () => getOpStore().clearOps()
export const getAllOps = () => getOpStore().getAllOps()
export const getOpEntries = () => getOpStore().getOpEntries()

// Sheet object helpers
export const getSheetObject = (id: OpId) => getOpStore().getSheetObject(id)
export const setSheetObject = (id: OpId, sheetObj: unknown) =>
  getOpStore().setSheetObject(id, sheetObj)
export const deleteSheetObject = (id: OpId) => getOpStore().deleteSheetObject(id)
export const hasSheetObject = (id: OpId) => getOpStore().hasSheetObject(id)
export const getAllSheetObjectIds = () => Array.from(getOpStore().sheetObjects.keys())

// Hovered output handle helpers
export const setHoveredOutputHandle = (handle: { nodeId: string; handleId: string } | null) =>
  getUIStore().setHoveredOutputHandle(handle)

// Multi-input pending slot helpers (see pendingInsertionIndex in UIStoreState)
export const setPendingInsertionIndex = (info: PendingInsertionIndex | null) =>
  getUIStore().setPendingInsertionIndex(info)

export const clearPendingInsertionIndex = () => getUIStore().setPendingInsertionIndex(null)

// Consume-and-clear, guarded on the drop target so a stale index from hovering one
// handle can't leak into a drop on a different handle
export const takePendingInsertionIndex = (
  nodeId: string | null | undefined,
  handleId: string | null | undefined
): number | null => {
  const pending = getUIStore().pendingInsertionIndex
  getUIStore().setPendingInsertionIndex(null)
  if (pending && pending.nodeId === nodeId && pending.handleId === handleId) {
    return pending.index
  }
  return null
}

// ============================================================================
// Nesting State (Zustand)
// ============================================================================

interface NestingState {
  currentContainerId: string
  setCurrentContainerId: (id: string) => void
}

export const useNestingStore = create<NestingState>(set => ({
  currentContainerId: '/',
  setCurrentContainerId: (id: string) => set({ currentContainerId: id }),
}))

// ============================================================================
// Edge Connection Store - O(1) lookup for incoming connections
// ============================================================================

// Key format: "nodeId::handleId" for O(1) lookup
type ConnectionKey = `${string}::${string}`

interface EdgeConnectionState {
  connectionMap: Map<ConnectionKey, boolean>
  _edgeSignature: string
  updateFromEdges: (edges: ReactFlowEdge[]) => void
}

export const useEdgeConnectionStore = create<EdgeConnectionState>((set, get) => ({
  connectionMap: new Map(),
  _edgeSignature: '',

  updateFromEdges: edges => {
    // Compute structural signature (ignores array reference changes)
    const signature = edges
      .filter(e => e.type !== 'ReferenceEdge')
      .map(e => `${e.target}:${e.targetHandle}`)
      .sort()
      .join('|')

    // Early exit if structure unchanged
    if (signature === get()._edgeSignature) return

    // Build new connection map
    const newMap = new Map<ConnectionKey, boolean>()
    for (const edge of edges) {
      if (edge.type === 'ReferenceEdge') continue
      if (!edge.target || !edge.targetHandle) continue
      const key: ConnectionKey = `${edge.target}::${edge.targetHandle}`
      newMap.set(key, true)
    }

    set({ connectionMap: newMap, _edgeSignature: signature })
  },
}))
