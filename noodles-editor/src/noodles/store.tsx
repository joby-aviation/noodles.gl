import type { ISheetObject } from '@theatre/core'
import { createContext, type PropsWithChildren, useContext } from 'react'
import type { IOperator, Operator } from './operators'
// only import types from noodles to avoid circular dependencies
import type { OpId } from './utils/id-utils'
import { isAbsolutePath, resolvePath } from './utils/path-utils'

export const opMap = new Map<OpId, Operator<IOperator>>()
export const sheetObjectMap = new Map<OpId, ISheetObject>()

export type NestingContextValue = {
  currentContainerId: string
  setCurrentContainerId: (id: string) => void
}

let currentContainerId = '/'

// Track currently hovered output handle for viewer creation
export let hoveredOutputHandle: { nodeId: string; handleId: string } | null = null
export const setHoveredOutputHandle = (handle: { nodeId: string; handleId: string } | null) => {
  hoveredOutputHandle = handle
}

const noodlesContextValue = {
  ops: {
    get: (id: OpId) => opMap.get(id),
    set: (id: OpId, op: Operator<IOperator>) => opMap.set(id, op),
  },
  sheetObjects: {
    get: (id: OpId) => sheetObjectMap.get(id),
    set: (id: OpId, sheetObj: ISheetObject) => sheetObjectMap.set(id, sheetObj),
    delete: (id: OpId) => sheetObjectMap.delete(id),
  },
  nesting: {
    get currentContainerId() {
      return currentContainerId
    },
    setCurrentContainerId: (id: string) => {
      currentContainerId = id
    },
  },
}

export type NoodlesContextValue = typeof noodlesContextValue

export const NoodlesContext = createContext<NoodlesContextValue>(noodlesContextValue)

export const NoodlesProvider = ({ children }: PropsWithChildren) => (
  <NoodlesContext.Provider value={noodlesContextValue}>{children}</NoodlesContext.Provider>
)

export const useSlice: <T>(resolver: (state: NoodlesContextValue) => T) => T = resolver =>
  resolver(useContext(NoodlesContext))

/* Helpful hook to get an op, just be careful not to break rule of hooks with it. */
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
