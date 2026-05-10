import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { create } from 'zustand'
import type { IOperator, Operator } from './operators'
// only import types from noodles to avoid circular dependencies
import type { OpId } from './utils/id-utils'
import { edgeId } from './utils/id-utils'
import { generateQualifiedPath, isAbsolutePath, resolvePath } from './utils/path-utils'

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
  targetedEdge: { id: string; compatible: boolean } | null
  setTargetedEdge: (edge: { id: string; compatible: boolean } | null) => void
  nodeDragState: NodeDragState | null
  setNodeDragState: (state: NodeDragState | null) => void
  sidebarVisible: boolean
  setSidebarVisible: (visible: boolean) => void
  sidebarSearchFocusTrigger: number
  triggerSidebarSearch: () => void
  settingsDialogOpen: boolean
  setSettingsDialogOpen: (open: boolean) => void
  timelineExpanded: boolean
  setTimelineExpanded: (expanded: boolean) => void
  timelineHeight: number
  setTimelineHeight: (height: number) => void
  quickStartModalOpen: boolean
  setQuickStartModalOpen: (open: boolean) => void
  spreadsheetVisible: boolean
  setSpreadsheetVisible: (visible: boolean) => void
  pinnedSpreadsheetNodeId: string | null
  setPinnedSpreadsheetNodeId: (id: string | null) => void
  spreadsheetWidth: number
  setSpreadsheetWidth: (width: number) => void
}

export const useUIStore = create<UIStoreState>(set => ({
  hoveredOutputHandle: null,
  setHoveredOutputHandle: handle => set({ hoveredOutputHandle: handle }),
  connectionDragState: null,
  setConnectionDragState: state => set({ connectionDragState: state }),
  targetedEdge: null,
  setTargetedEdge: edge => set({ targetedEdge: edge }),
  nodeDragState: null,
  setNodeDragState: state => set({ nodeDragState: state }),
  sidebarVisible: false,
  setSidebarVisible: visible => set({ sidebarVisible: visible }),
  sidebarSearchFocusTrigger: 0,
  triggerSidebarSearch: () =>
    set(state => ({ sidebarSearchFocusTrigger: state.sidebarSearchFocusTrigger + 1 })),
  settingsDialogOpen: false,
  setSettingsDialogOpen: open => set({ settingsDialogOpen: open }),
  timelineExpanded: false,
  setTimelineExpanded: expanded => set({ timelineExpanded: expanded }),
  timelineHeight: 250,
  setTimelineHeight: height => set({ timelineHeight: height }),
  quickStartModalOpen: false,
  setQuickStartModalOpen: open => set({ quickStartModalOpen: open }),
  spreadsheetVisible: false,
  setSpreadsheetVisible: visible => set({ spreadsheetVisible: visible }),
  pinnedSpreadsheetNodeId: null,
  setPinnedSpreadsheetNodeId: id => set({ pinnedSpreadsheetNodeId: id }),
  spreadsheetWidth:
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('noodles-spreadsheet-width')) || 400
      : 400,
  setSpreadsheetWidth: width => {
    set({ spreadsheetWidth: width })
    if (typeof window !== 'undefined') {
      localStorage.setItem('noodles-spreadsheet-width', String(width))
    }
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

// ============================================================================
// Operator ID Update Helper
// ============================================================================

//
// Updates an operator's ID and all references to it (nodes, edges, children).
// This is used when renaming operators in the node tree sidebar or node headers.
//
// @param nodeId - Current ID of the operator
// @param newBaseName - New base name (without path prefix)
// @param isContainer - Whether the operator is a container
// @param setNodes - React Flow setNodes function
// @param setEdges - React Flow setEdges function
export const updateOperatorId = (
  nodeId: string,
  newBaseName: string,
  isContainer: boolean,
  setNodes: (updater: (nodes: ReactFlowNode[]) => ReactFlowNode[]) => void,
  setEdges: (updater: (edges: ReactFlowEdge[]) => ReactFlowEdge[]) => void
) => {
  const store = getOpStore()
  const op = store.getOp(nodeId)
  if (!op) return

  const newQualifiedId = generateQualifiedPath(newBaseName, op.containerId ?? '/')

  // Update the operator itself
  setOp(newQualifiedId, op)
  op.id = newQualifiedId

  // If this is a container, update all children nodes and their operators
  if (isContainer) {
    const childOps = getAllOps().filter((childOp: Operator<IOperator>) =>
      childOp.id.startsWith(`${nodeId}/`)
    )

    for (const childOp of childOps) {
      const oldChildId = childOp.id
      // Replace only the exact container path at the start
      const newChildId = newQualifiedId + oldChildId.slice(nodeId.length)
      setOp(newChildId, childOp)
      childOp.id = newChildId
      queueMicrotask(() => deleteOp(oldChildId))
    }
  }

  // Give React time to update the component tree before deleting the old id
  queueMicrotask(() => {
    deleteOp(nodeId)
  })

  // Update React Flow nodes and edges
  setNodes(nodes =>
    nodes.map(n => {
      // Update the node itself if it matches
      if (n.id === nodeId) {
        return { ...n, id: newQualifiedId }
      }
      // Update children if this is a container
      if (isContainer && n.id.startsWith(`${nodeId}/`)) {
        return { ...n, id: newQualifiedId + n.id.slice(nodeId.length) }
      }
      return n
    })
  )

  setEdges(edges =>
    edges.map(edge => {
      const sourceNeedsUpdate =
        edge.source === nodeId || (isContainer && edge.source.startsWith(`${nodeId}/`))
      const targetNeedsUpdate =
        edge.target === nodeId || (isContainer && edge.target.startsWith(`${nodeId}/`))

      if (!sourceNeedsUpdate && !targetNeedsUpdate) return edge

      const updatedEdge = {
        ...edge,
        source: sourceNeedsUpdate
          ? edge.source === nodeId
            ? newQualifiedId
            : newQualifiedId + edge.source.slice(nodeId.length)
          : edge.source,
        target: targetNeedsUpdate
          ? edge.target === nodeId
            ? newQualifiedId
            : newQualifiedId + edge.target.slice(nodeId.length)
          : edge.target,
      }

      return { ...updatedEdge, id: edgeId(updatedEdge) }
    })
  )
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
