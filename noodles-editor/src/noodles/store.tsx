import type { ISheetObject } from '@theatre/core'
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
  sheetObjects: Map<OpId, ISheetObject>

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
  getSheetObject: (id: OpId) => ISheetObject | undefined
  setSheetObject: (id: OpId, sheetObj: ISheetObject) => void
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
    operators.delete(id)
    set({ operators })
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

interface UIStoreState {
  hoveredOutputHandle: { nodeId: string; handleId: string } | null
  setHoveredOutputHandle: (handle: { nodeId: string; handleId: string } | null) => void
  sidebarVisible: boolean
  setSidebarVisible: (visible: boolean) => void
}

export const useUIStore = create<UIStoreState>(set => ({
  hoveredOutputHandle: null,
  setHoveredOutputHandle: handle => set({ hoveredOutputHandle: handle }),
  sidebarVisible: true,
  setSidebarVisible: visible => set({ sidebarVisible: visible }),
}))

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
export const setSheetObject = (id: OpId, sheetObj: ISheetObject) =>
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
