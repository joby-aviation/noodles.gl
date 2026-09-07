// Unified graph store - operators as source of truth, nodes as cached views
//
// ARCHITECTURE:
// - Operators (Map<OpId, Operator>) are the authoritative source for all logic state
// - Nodes (ReactFlowNode[]) are a maintained cache for ReactFlow rendering
// - When operator changes, syncNodeFromOperator() creates new nodes array (immutable)
// - Node components read operator state directly (not from node.data)
// - Serialization extracts state from operators
//
// This eliminates the dual-state problem: operators and nodes no longer duplicate data

import {
  type Connection,
  type Edge as ReactFlowEdge,
  type EdgeChange,
  type Node as ReactFlowNode,
  type NodeChange,
  applyEdgeChanges as applyReactFlowEdgeChanges,
  applyNodeChanges as applyReactFlowNodeChanges,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
} from '@xyflow/react'
import { shallow } from 'zustand/shallow'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { getTimelineStore } from '../timeline/timeline-store'
import { analytics } from '../utils/analytics'
import { debugUI } from '../utils/debug'
import type { IOperator, Operator } from './operators'
import { canConnect, validateConnection } from './utils/can-connect'
import { expandDeleteSet } from './utils/copy-paste-utils'
import { reconcileForLoopGroups } from './utils/for-loop-group-utils'
import { edgeId } from './utils/id-utils'
import {
  insertEdgeAtGroupIndex,
  normalizeMultiInputEdges,
  orderedEdgeIdsForHandle,
} from './utils/multi-input-utils'
import {
  generateQualifiedPath,
  getParentPath,
  isAbsolutePath,
  parseHandleId,
  resolvePath,
} from './utils/path-utils'
import { transformGraph } from './transform-graph'
import type { OpId } from './utils/id-utils'
import { type Field } from './fields'

// ============================================================================
// Types
// ============================================================================

export type ProjectModification =
  | { type: 'add_node'; data: ReactFlowNode }
  | { type: 'update_node'; data: Partial<ReactFlowNode> & { id: string } }
  | { type: 'delete_node'; data: { id: string } }
  | { type: 'add_edge'; data: ReactFlowEdge }
  | { type: 'delete_edge'; data: { id: string } }

export interface ModificationResult {
  success: boolean
  error?: string
  warnings?: string[]
}

// ============================================================================
// Graph Store State
// ============================================================================

interface GraphStore {
  // State
  nodes: ReactFlowNode[]
  edges: ReactFlowEdge[]
  operators: Map<OpId, Operator<IOperator>>
  sheetObjects: Map<OpId, unknown>

  // Batching state
  _batching: boolean

  // Internal: prevent recursive subscriber updates
  _reconciling: boolean

  // Write API - programmatic modifications
  addNodes: (newNodes: ReactFlowNode[]) => void
  updateNode: (id: OpId, updates: Partial<ReactFlowNode>) => void
  syncNodeFromOperator: (id: OpId) => void // Update node when operator changes
  deleteNodes: (ids: OpId[]) => void
  addEdges: (newEdges: ReactFlowEdge[]) => void
  deleteEdges: (ids: string[]) => void

  // Batch API
  batch: (fn: () => void) => void

  // High-level API (from use-project-modifications)
  applyModifications: (mods: ProjectModification[]) => ModificationResult

  // User interaction handlers (translate ReactFlow changes to store updates)
  applyNodeChanges: (changes: NodeChange[]) => void
  applyEdgeChanges: (changes: EdgeChange[]) => void

  // Operator management (from useOperatorStore)
  getOp: (id: OpId) => Operator<IOperator> | undefined
  setOp: (id: OpId, op: Operator<IOperator>) => void
  deleteOp: (id: OpId) => void
  hasOp: (id: OpId) => boolean
  clearOps: () => void
  getAllOps: () => Operator<IOperator>[]
  getOpEntries: () => [OpId, Operator<IOperator>][]

  // Sheet object management
  getSheetObject: (id: OpId) => unknown
  setSheetObject: (id: OpId, sheetObj: unknown) => void
  deleteSheetObject: (id: OpId) => void
  hasSheetObject: (id: OpId) => boolean

  // Project load/reset
  loadProject: (nodes: ReactFlowNode[], edges: ReactFlowEdge[]) => void
  clearGraph: () => void
}

// ============================================================================
// Create Store
// ============================================================================

export const useGraphStore = create<GraphStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    nodes: [],
    edges: [],
    operators: new Map(),
    sheetObjects: new Map(),
    _batching: false,
    _reconciling: false,

    // ========================================================================
    // Write API
    // ========================================================================

    addNodes: newNodes => {
      if (!newNodes.length) return
      set(state => ({ nodes: [...state.nodes, ...newNodes] }))
      newNodes.forEach(node => {
        analytics.track('node_added', { nodeType: node.type || 'unknown' })
      })
    },

    updateNode: (id, updates) => {
      set(state => ({
        // Immutable update - create new array with one node changed
        nodes: state.nodes.map(n =>
          n.id === id
            ? {
                ...n,
                ...updates,
                // Note: We're moving away from storing inputs in node.data
                // Node components will read directly from operators
                data: updates.data
                  ? {
                      ...(n.data || {}),
                      ...updates.data,
                      inputs: {
                        ...((n.data as Record<string, unknown>)?.inputs || {}),
                        ...((updates.data as Record<string, unknown>)?.inputs || {}),
                      },
                    }
                  : n.data,
              }
            : n
        ),
      }))
    },

    // Sync a single node from its operator (immutable update)
    // Used when operator state changes to update the ReactFlow view
    syncNodeFromOperator: (id: OpId) => {
      const op = get().operators.get(id)
      if (!op) return

      set(state => ({
        // Immutable: create new array with one node updated
        nodes: state.nodes.map(n =>
          n.id === id
            ? {
                ...n,
                // Visual state (position, selection) stays in node
                // Data is read from operator by node components
                // We can store minimal rendering hints here if needed
              }
            : n
        ),
      }))
    },

    deleteNodes: ids => {
      if (!ids.length) return
      const nodeIds = new Set(ids)
      set(state => {
        // Expand to include path-based container children
        expandDeleteSet(nodeIds, state.nodes)
        return {
          nodes: state.nodes.filter(n => !nodeIds.has(n.id)),
          edges: state.edges.filter(e => !nodeIds.has(e.source) && !nodeIds.has(e.target)),
        }
      })
      analytics.track('node_deleted', { count: ids.length })
    },

    addEdges: newEdges => {
      if (!newEdges.length) return
      set(state => ({
        edges: normalizeMultiInputEdges([...state.edges, ...newEdges]),
      }))
      analytics.track('edge_added', { count: newEdges.length })
    },

    deleteEdges: ids => {
      if (!ids.length) return
      const edgeIds = new Set(ids)
      set(state => ({
        edges: normalizeMultiInputEdges(state.edges.filter(e => !edgeIds.has(e.id))),
      }))
      analytics.track('edge_deleted', { count: ids.length })
    },

    // ========================================================================
    // Batch API
    // ========================================================================

    batch: fn => {
      set({ _batching: true })
      fn()
      set({ _batching: false })
    },

    // ========================================================================
    // High-level API
    // ========================================================================

    applyModifications: mods => {
      const warnings: string[] = []
      const errors: string[] = []

      get().batch(() => {
        const nodesToAdd: ReactFlowNode[] = []
        const nodesToUpdate: Array<{ id: OpId; updates: Partial<ReactFlowNode> }> = []
        const nodesToDelete: OpId[] = []
        const edgesToAdd: ReactFlowEdge[] = []
        const edgesToDelete: string[] = []

        // Group modifications by type
        for (const mod of mods) {
          switch (mod.type) {
            case 'add_node':
              nodesToAdd.push(mod.data)
              break
            case 'update_node':
              nodesToUpdate.push({ id: mod.data.id, updates: mod.data })
              break
            case 'delete_node':
              nodesToDelete.push(mod.data.id)
              break
            case 'add_edge':
              edgesToAdd.push(mod.data)
              break
            case 'delete_edge':
              edgesToDelete.push(mod.data.id)
              break
          }
        }

        // Apply deletions first
        if (nodesToDelete.length > 0) {
          get().deleteNodes(nodesToDelete)
        }
        if (edgesToDelete.length > 0) {
          get().deleteEdges(edgesToDelete)
        }

        // Apply additions
        if (nodesToAdd.length > 0) {
          get().addNodes(nodesToAdd)
        }

        // Apply updates
        if (nodesToUpdate.length > 0) {
          for (const { id, updates } of nodesToUpdate) {
            get().updateNode(id, updates)

            // Update operator inputs
            const operator = get().getOp(id)
            if (operator && updates.data?.inputs) {
              const inputs = updates.data.inputs as Record<string, unknown>
              for (const [key, value] of Object.entries(inputs)) {
                const operatorInputs = (operator as unknown as Record<string, unknown>).inputs as
                  | Record<string, { setValue?: (value: unknown) => void }>
                  | undefined
                const input = operatorInputs?.[key]
                if (input && typeof input.setValue === 'function') {
                  input.setValue(value)
                  operator.showField(key)
                }
              }
            }
          }
        }

        // Add edges (with validation if no new nodes)
        if (edgesToAdd.length > 0) {
          const hasNewNodes = nodesToAdd.length > 0
          if (hasNewNodes) {
            // Optimistic: add edges without full validation
            get().addEdges(edgesToAdd)
          } else {
            // Validated: check operators exist and are compatible
            const validEdges: ReactFlowEdge[] = []
            for (const edge of edgesToAdd) {
              const sourceOp = get().getOp(edge.source)
              const targetOp = get().getOp(edge.target)

              if (!sourceOp || !targetOp) {
                errors.push(`Edge ${edge.id}: source or target operator not found`)
                continue
              }

              const sourceHandleInfo = edge.sourceHandle ? parseHandleId(edge.sourceHandle) : null
              const targetHandleInfo = edge.targetHandle ? parseHandleId(edge.targetHandle) : null

              if (!sourceHandleInfo || !targetHandleInfo) {
                errors.push(`Edge ${edge.id}: invalid handle format`)
                continue
              }

              // biome-ignore lint/suspicious/noExplicitAny: Field type requires generic parameter
              const sourceField = (sourceOp as any)[sourceHandleInfo.namespace]?.[
                sourceHandleInfo.fieldName
                // biome-ignore lint/suspicious/noExplicitAny: Field type requires generic parameter
              ] as Field<any> | undefined
              // biome-ignore lint/suspicious/noExplicitAny: Field type requires generic parameter
              const targetField = (targetOp as any)[targetHandleInfo.namespace]?.[
                targetHandleInfo.fieldName
                // biome-ignore lint/suspicious/noExplicitAny: Field type requires generic parameter
              ] as Field<any> | undefined

              if (!sourceField || !targetField) {
                errors.push(`Edge ${edge.id}: source or target field not found`)
                continue
              }

              if (!canConnect(sourceField, targetField)) {
                errors.push(
                  `Edge ${edge.id}: incompatible types ${sourceField.constructor.name} → ${targetField.constructor.name}`
                )
                continue
              }

              validEdges.push(edge)
            }

            if (validEdges.length > 0) {
              get().addEdges(validEdges)
            }
            if (validEdges.length < edgesToAdd.length) {
              warnings.push(
                `${edgesToAdd.length - validEdges.length} edge(s) skipped due to validation errors`
              )
            }
          }
        }
      })

      return {
        success: errors.length === 0,
        error: errors.length > 0 ? errors.join('; ') : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    },

    // ========================================================================
    // ReactFlow Change Handlers
    // ========================================================================

    applyNodeChanges: changes => {
      set(state => ({
        nodes: applyReactFlowNodeChanges(changes, state.nodes),
      }))
    },

    applyEdgeChanges: changes => {
      set(state => ({
        edges: applyReactFlowEdgeChanges(changes, state.edges),
      }))
    },

    // ========================================================================
    // Operator Management (from useOperatorStore)
    // ========================================================================

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
      // Dispose only if this op instance is no longer referenced at any id
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

    // ========================================================================
    // Sheet Object Management
    // ========================================================================

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

    // ========================================================================
    // Project Load/Reset
    // ========================================================================

    loadProject: (nodes, edges) => {
      set({
        nodes,
        edges: normalizeMultiInputEdges(edges),
        // Operators will be populated by transformGraph subscriber
      })
    },

    clearGraph: () => {
      // Dispose all operators
      for (const op of get().operators.values()) {
        op.dispose?.()
      }
      set({
        nodes: [],
        edges: [],
        operators: new Map(),
        sheetObjects: new Map(),
      })
    },
  }))
)

// ============================================================================
// Auto-Reconciliation Subscribers
// ============================================================================

// TODO: Re-enable subscribers after fixing infinite loop issues
// For now, reconciliation must be called manually

// // 1. ForLoop group reconciliation
// // Runs after nodes or edges change to maintain visual grouping
// useGraphStore.subscribe(
//   state => [state.nodes, state.edges, state._batching, state._reconciling] as const,
//   ([nodes, edges, batching, reconciling]) => {
//     if (batching || reconciling) return

//     const reconciled = reconcileForLoopGroups(nodes, edges)
//     if (reconciled !== nodes) {
//       useGraphStore.setState({ _reconciling: true })
//       useGraphStore.setState({ nodes: reconciled, _reconciling: false })
//     }
//   },
//   { equalityFn: shallow }
// )

// // 2. Multi-input edge normalization
// // Runs after edges change to maintain orderIndex and groupSize metadata
// useGraphStore.subscribe(
//   state => [state.edges, state._batching, state._reconciling] as const,
//   ([edges, batching, reconciling]) => {
//     if (batching || reconciling) return

//     // normalizeMultiInputEdges is already called in addEdges/deleteEdges
//     // This subscriber is a safety net for edge changes from ReactFlow
//     const normalized = normalizeMultiInputEdges(edges)
//     if (normalized !== edges) {
//       useGraphStore.setState({ _reconciling: true })
//       useGraphStore.setState({ edges: normalized, _reconciling: false })
//     }
//   },
//   { equalityFn: shallow }
// )

// // 3. Operator synchronization (from transformGraph)
// // Runs after nodes or edges change to rebuild operator instances
// useGraphStore.subscribe(
//   state => [state.nodes, state.edges, state._batching, state._reconciling] as const,
//   ([nodes, edges, batching, reconciling]) => {
//     if (batching || reconciling) return
//     if (!nodes || !edges) return // Guard against undefined during initialization

//     transformGraph({ nodes, edges })
//     // Note: transformGraph updates the operator store directly via setOp/deleteOp
//     // We don't need to set state here
//   },
//   { equalityFn: shallow }
// )

// // 4. Timeline binding
// // Runs after operators change to sync timeline tracks
// useGraphStore.subscribe(
//   state => [state.operators, state._batching, state._reconciling] as const,
//   ([operators, batching, reconciling]) => {
//     if (batching || reconciling) return

//     const timeline = getTimelineStore()
//     const operatorIds = new Set(operators.keys())

//     // Bind new operators to timeline
//     for (const [id, op] of operators.entries()) {
//       // bindOperatorToTimeline is called in transformGraph
//       // This subscriber is mainly for cleanup
//     }

//     // Cleanup removed operators from timeline
//     const timelineTracks = timeline.tracks
//     for (const fieldPath of Object.keys(timelineTracks)) {
//       const opId = fieldPath.split('.')[0]
//       if (!operatorIds.has(opId)) {
//         timeline.deleteTrack(fieldPath)
//       }
//     }
//   },
//   { equalityFn: shallow }
// )

// ============================================================================
// Helper functions for non-React contexts
// ============================================================================

export const getGraphStore = () => useGraphStore.getState()

// Compatibility exports (delegate to graph store)
// `path` can be absolute or relative to `contextOperatorId`
export const getOp = (path: string, contextOperatorId?: string) => {
  if (!path) {
    return undefined
  }

  const store = getGraphStore()

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

export const setOp = (id: OpId, op: Operator<IOperator>) => getGraphStore().setOp(id, op)
export const deleteOp = (id: OpId) => getGraphStore().deleteOp(id)
export const hasOp = (id: OpId) => getGraphStore().hasOp(id)
export const clearOps = () => getGraphStore().clearOps()
export const getAllOps = () => getGraphStore().getAllOps()
export const getOpEntries = () => getGraphStore().getOpEntries()

export const getSheetObject = (id: OpId) => getGraphStore().getSheetObject(id)
export const setSheetObject = (id: OpId, sheetObj: unknown) =>
  getGraphStore().setSheetObject(id, sheetObj)
export const deleteSheetObject = (id: OpId) => getGraphStore().deleteSheetObject(id)
export const hasSheetObject = (id: OpId) => getGraphStore().hasSheetObject(id)
export const getAllSheetObjectIds = () => Array.from(getGraphStore().sheetObjects.keys())
