import type { ISheetObject } from '@theatre/core'
import { create } from 'zustand'
import type { IOperator, Operator } from './operators'
// only import types from noodles to avoid circular dependencies
import type { OpId } from './utils/id-utils'
import { isAbsolutePath, resolvePath } from './utils/path-utils'

// ============================================================================
// Operator Store (Zustand)
// ============================================================================

interface OperatorStore {
  // The actual maps
  operators: Map<OpId, Operator<IOperator>>
  sheetObjects: Map<OpId, ISheetObject>
  hoveredOutputHandle: { nodeId: string; handleId: string } | null

  // Version counter for change tracking
  version: number

  // Batching state
  _batching: boolean
  _pendingVersion: number

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

  // Hovered output handle actions
  setHoveredOutputHandle: (handle: { nodeId: string; handleId: string } | null) => void

  // Batching
  batch: (fn: () => void) => void
}

export const useOperatorStore = create<OperatorStore>((set, get) => ({
  operators: new Map(),
  sheetObjects: new Map(),
  hoveredOutputHandle: null,
  version: 0,
  _batching: false,
  _pendingVersion: 0,

  // Operator actions
  getOp: (id) => get().operators.get(id),

  setOp: (id, op) => {
    const state = get()
    const operators = new Map(state.operators)
    operators.set(id, op)

    if (state._batching) {
      set({ operators, _pendingVersion: state._pendingVersion + 1 })
    } else {
      set({ operators, version: state.version + 1 })
    }
  },

  deleteOp: (id) => {
    const state = get()
    const operators = new Map(state.operators)
    operators.delete(id)

    if (state._batching) {
      set({ operators, _pendingVersion: state._pendingVersion + 1 })
    } else {
      set({ operators, version: state.version + 1 })
    }
  },

  hasOp: (id) => get().operators.has(id),

  clearOps: () => {
    const state = get()
    if (state._batching) {
      set({ operators: new Map(), _pendingVersion: state._pendingVersion + 1 })
    } else {
      set({ operators: new Map(), version: state.version + 1 })
    }
  },

  getAllOps: () => Array.from(get().operators.values()),

  getOpEntries: () => Array.from(get().operators.entries()),

  // Sheet object actions
  getSheetObject: (id) => get().sheetObjects.get(id),

  setSheetObject: (id, sheetObj) => {
    const sheetObjects = new Map(get().sheetObjects)
    sheetObjects.set(id, sheetObj)
    set({ sheetObjects })
  },

  deleteSheetObject: (id) => {
    const sheetObjects = new Map(get().sheetObjects)
    sheetObjects.delete(id)
    set({ sheetObjects })
  },

  hasSheetObject: (id) => get().sheetObjects.has(id),

  // Hovered output handle actions
  setHoveredOutputHandle: (handle) => set({ hoveredOutputHandle: handle }),

  // Batching
  batch: (fn) => {
    const state = get()
    set({ _batching: true, _pendingVersion: state.version })
    fn()
    const newState = get()
    set({
      _batching: false,
      version: newState._pendingVersion
    })
  },
}))

// ============================================================================
// Helper functions for non-React contexts
// ============================================================================

// Get the store instance for use outside React components
export const getOpStore = () => useOperatorStore.getState()

// Helpful hook to get an op, just be careful not to break rule of hooks with it.
export const useOp = (id: OpId) => {
  const op = useOperatorStore.getState().getOp(id)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }
  return op
}

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

// ============================================================================
// Nesting State (Zustand)
// ============================================================================

interface NestingState {
  currentContainerId: string
  setCurrentContainerId: (id: string) => void
}

export const useNestingStore = create<NestingState>((set) => ({
  currentContainerId: '/',
  setCurrentContainerId: (id: string) => set({ currentContainerId: id }),
}))

// ============================================================================
// Deprecated exports for backward compatibility with tests
// ============================================================================
// TODO: Remove these once all tests are updated

export const opMap = useOperatorStore.getState().operators
export const sheetObjectMap = useOperatorStore.getState().sheetObjects
