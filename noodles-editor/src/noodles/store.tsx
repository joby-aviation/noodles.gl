import type { ISheetObject } from '@theatre/core'
import { createContext, type PropsWithChildren, useContext, useMemo } from 'react'
import { create } from 'zustand'
import type { IOperator, Operator } from './operators'
// only import types from noodles to avoid circular dependencies
import type { OpId } from './utils/id-utils'
import { isAbsolutePath, resolvePath } from './utils/path-utils'

export const opMap = new Map<OpId, Operator<IOperator>>()
export const sheetObjectMap = new Map<OpId, ISheetObject>()

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

export type OpsContextValue = {
  get: (id: OpId) => Operator<IOperator> | undefined
  set: (id: OpId, op: Operator<IOperator>) => void
}

export type SheetObjectsContextValue = {
  get: (id: OpId) => ISheetObject | undefined
  set: (id: OpId, sheetObj: ISheetObject) => void
  delete: (id: OpId) => void
}

export type NoodlesContextValue = {
  ops: OpsContextValue
  sheetObjects: SheetObjectsContextValue
}

const opsContext: OpsContextValue = {
  get: (id: OpId) => opMap.get(id),
  set: (id: OpId, op: Operator<IOperator>) => {
    opMap.set(id, op)
  },
}

const sheetObjectsContext: SheetObjectsContextValue = {
  get: (id: OpId) => sheetObjectMap.get(id),
  set: (id: OpId, sheetObj: ISheetObject) => {
    sheetObjectMap.set(id, sheetObj)
  },
  delete: (id: OpId) => {
    sheetObjectMap.delete(id)
  },
}

// Track currently hovered output handle for viewer creation
export let hoveredOutputHandle: { nodeId: string; handleId: string } | null = null
export const setHoveredOutputHandle = (handle: { nodeId: string; handleId: string } | null) => {
  hoveredOutputHandle = handle
}

const defaultContextValue: NoodlesContextValue = {
  ops: opsContext,
  sheetObjects: sheetObjectsContext,
}

export const NoodlesContext = createContext<NoodlesContextValue>(defaultContextValue)

export const NoodlesProvider = ({ children }: PropsWithChildren) => {
  const contextValue = useMemo<NoodlesContextValue>(() => {
    return {
      ops: opsContext,
      sheetObjects: sheetObjectsContext,
    }
  }, [])

  return <NoodlesContext.Provider value={contextValue}>{children}</NoodlesContext.Provider>
}

export const useSlice: <T>(resolver: (state: NoodlesContextValue) => T) => T = resolver =>
  resolver(useContext(NoodlesContext))

// Helpful hook to get an op, just be careful not to break rule of hooks with it.
export const useOp = (id: OpId) => {
  const op = useSlice(state => state.ops).get(id)
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

  // If path is absolute or no context provided, use direct lookup
  if (isAbsolutePath(path) || !contextOperatorId) {
    return opMap.get(path)
  }

  // Resolve relative path using context
  const resolvedPath = resolvePath(path, contextOperatorId)
  if (!resolvedPath) {
    return undefined
  }

  return opMap.get(resolvedPath)
}
