// Shared hook for applying project modifications using ReactFlow hooks
// Used by both the UI and the AI chat system

import { useCallback } from 'react'
import {
  useReactFlow,
  type Edge as ReactFlowEdge,
  type Node as ReactFlowNode,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
} from '@xyflow/react'

import { opMap } from '../store'
import { canConnect } from '../utils/can-connect'
import { parseHandleId } from '../utils/path-utils'
import { edgeId } from '../utils/id-utils'

// Using ReactFlowNode instead of AnyNodeJSON for compatibility
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

export function useProjectModifications() {
  const { getNodes, getEdges, setNodes, setEdges, addNodes, addEdges, deleteElements } =
    useReactFlow()

  // Delete nodes with intelligent edge handling (same logic as noodles.tsx onNodesDelete)
  const deleteNodes = useCallback(
    (nodeIds: string[]): ModificationResult => {
      const nodes = getNodes()
      const edges = getEdges()
      const nodesToDelete = nodes.filter(n => nodeIds.includes(n.id))

      if (nodesToDelete.length === 0) {
        return { success: false, error: `No nodes found with IDs: ${nodeIds.join(', ')}` }
      }

      const warnings: string[] = []

      // Handle special cases (ForLoop begin/end nodes)
      const extraDeleted = new Set<string>()
      for (const node of nodesToDelete) {
        if (node.type === 'ForLoopBeginOp' || node.type === 'ForLoopEndOp') {
          const parent = node.parentId
          if (parent) {
            extraDeleted.add(parent)
            const siblingType = node.type === 'ForLoopBeginOp' ? 'ForLoopEndOp' : 'ForLoopBeginOp'
            const sibling = nodes.find(n => n.parentId === parent && n.type === siblingType)
            if (sibling) {
              extraDeleted.add(sibling.id)
              warnings.push(
                `Deleted ${node.type} also deleted its sibling ${siblingType} and parent`
              )
            }
          }
        }
      }

      // Update nodes - remove extra deleted nodes and clear parentIds
      if (extraDeleted.size > 0) {
        setNodes(currentNodes => {
          return currentNodes
            .filter(n => !extraDeleted.has(n.id))
            .map(n => {
              if (extraDeleted.has(n.parentId || '')) {
                return { ...n, parentId: undefined }
              }
              return n
            })
        })
      }

      // Intelligent edge reconnection (same logic as noodles.tsx)
      setEdges(currentEdges => {
        return nodesToDelete.reduce((acc, node) => {
          const incomers = getIncomers(node, nodes, edges)
          const outgoers = getOutgoers(node, nodes, edges)
          const connectedEdges = getConnectedEdges([node], edges)

          const remainingEdges = acc.filter(edge => !connectedEdges.includes(edge))

          // Try to reconnect incomers to outgoers
          const sourceHandle = connectedEdges.find(edge => edge.target === node.id)?.sourceHandle
          const targetHandle = connectedEdges.find(edge => edge.source === node.id)?.targetHandle

          if (!sourceHandle || !targetHandle) {
            return remainingEdges
          }

          const sourceHandleInfo = parseHandleId(sourceHandle)
          const targetHandleInfo = parseHandleId(targetHandle)

          if (!sourceHandleInfo || !targetHandleInfo) {
            return remainingEdges
          }

          // Create edges between compatible incomers and outgoers
          const createdEdges = incomers.flatMap(({ id: source }) =>
            outgoers
              .filter(({ id: target }) => {
                const sourceField = opMap.get(source)?.outputs[sourceHandleInfo.fieldName]
                const targetField = opMap.get(target)?.inputs[targetHandleInfo.fieldName]
                if (!sourceField || !targetField) {
                  return false
                }
                return canConnect(sourceField, targetField)
              })
              .map(({ id: target }) => ({
                id: edgeId({
                  source,
                  target,
                  sourceHandle,
                  targetHandle,
                }),
                source,
                target,
                sourceHandle,
                targetHandle,
              }))
          )

          if (createdEdges.length > 0) {
            warnings.push(
              `Reconnected ${createdEdges.length} edge(s) after deleting node ${node.id}`
            )
          }

          return [...remainingEdges, ...createdEdges]
        }, currentEdges)
      })

      return { success: true, warnings: warnings.length > 0 ? warnings : undefined }
    },
    [getNodes, getEdges, setNodes, setEdges]
  )

  // Add an edge with connection validation
  const addEdgeWithValidation = useCallback(
    (edge: ReactFlowEdge): ModificationResult => {
      const nodes = getNodes()

      // Find source and target nodes
      const sourceNode = nodes.find(n => n.id === edge.source)
      const targetNode = nodes.find(n => n.id === edge.target)

      if (!sourceNode || !targetNode) {
        return {
          success: false,
          error: `Invalid edge: source or target node not found (source: ${edge.source}, target: ${edge.target})`,
        }
      }

      // Get operators
      const sourceOp = opMap.get(edge.source)
      const targetOp = opMap.get(edge.target)

      if (!sourceOp || !targetOp) {
        return {
          success: false,
          error: `Invalid edge: source or target operator not found in opMap`,
        }
      }

      // Parse handle IDs
      const sourceHandleInfo = parseHandleId(edge.sourceHandle!)
      const targetHandleInfo = parseHandleId(edge.targetHandle!)

      if (!sourceHandleInfo || !targetHandleInfo) {
        return {
          success: false,
          error: `Invalid handle IDs (source: ${edge.sourceHandle}, target: ${edge.targetHandle})`,
        }
      }

      // Get fields
      const sourceField = sourceOp.outputs[sourceHandleInfo.fieldName]
      const targetField = targetOp.inputs[targetHandleInfo.fieldName]

      if (!sourceField || !targetField) {
        return {
          success: false,
          error: `Invalid edge: source or target field not found (source: ${sourceHandleInfo.fieldName}, target: ${targetHandleInfo.fieldName})`,
        }
      }

      // Validate connection
      if (!canConnect(sourceField, targetField)) {
        return {
          success: false,
          error: `Invalid connection: ${sourceField.constructor.name} cannot connect to ${targetField.constructor.name}`,
        }
      }

      // Add the edge
      addEdges([edge])

      return { success: true }
    },
    [getNodes, addEdges]
  )

  // Update a node's data/inputs
  const updateNode = useCallback(
    (
      nodeId: string,
      updates: Partial<ReactFlowNode> & { data?: { inputs?: Record<string, unknown> } }
    ): ModificationResult => {
      const nodes = getNodes()
      const node = nodes.find(n => n.id === nodeId)

      if (!node) {
        return { success: false, error: `Node not found: ${nodeId}` }
      }

      // Get the operator instance from opMap
      const operator = opMap.get(nodeId)

      if (operator && updates.data?.inputs) {
        // Update operator inputs using setValue
        const inputs = updates.data.inputs
        Object.entries(inputs).forEach(([key, value]: [string, any]) => {
          const operatorInputs = (operator as Record<string, any>).inputs
          const input = operatorInputs?.[key]
          if (input && typeof input.setValue === 'function') {
            input.setValue(value)
          } else {
            console.warn(`Input ${key} not found on operator ${nodeId} or doesn't have setValue`)
          }
        })
      }

      // Update the node in React Flow state
      setNodes(currentNodes =>
        currentNodes.map(n => {
          if (n.id === nodeId) {
            const nodeData = n.data as any
            const updatesData = updates.data as any
            return {
              ...n,
              ...updates,
              data: {
                ...nodeData,
                ...updatesData,
                inputs: {
                  ...nodeData?.inputs,
                  ...updatesData?.inputs,
                },
              },
            }
          }
          return n
        })
      )

      return { success: true }
    },
    [getNodes, setNodes]
  )

  // Apply a batch of modifications sequentially
  const applyModifications = useCallback(
    (modifications: ProjectModification[]): ModificationResult => {
      const results: ModificationResult[] = []
      const allWarnings: string[] = []

      for (const mod of modifications) {
        let result: ModificationResult

        switch (mod.type) {
          case 'add_node':
            console.log('Adding node:', mod.data.id, mod.data.type)
            addNodes([mod.data])
            result = { success: true }
            break

          case 'update_node':
            console.log('Updating node:', mod.data.id, 'with inputs:', mod.data.data?.inputs)
            result = updateNode(mod.data.id, mod.data)
            break

          case 'delete_node':
            console.log('Deleting node:', mod.data.id)
            result = deleteNodes([mod.data.id])
            break

          case 'add_edge':
            console.log('Adding edge:', mod.data.id)
            result = addEdgeWithValidation(mod.data)
            break

          case 'delete_edge':
            console.log('Deleting edge:', mod.data.id)
            deleteElements({ edges: [{ id: mod.data.id }] })
            result = { success: true }
            break

          default:
            result = {
              success: false,
              error: `Unknown modification type: ${(mod as any).type}`,
            }
        }

        results.push(result)

        if (result.warnings) {
          allWarnings.push(...result.warnings)
        }

        // Stop on first error
        if (!result.success) {
          return {
            success: false,
            error: `Failed at modification ${results.length}: ${result.error}`,
            warnings: allWarnings.length > 0 ? allWarnings : undefined,
          }
        }
      }

      return {
        success: true,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      }
    },
    [addNodes, updateNode, deleteNodes, addEdgeWithValidation, deleteElements]
  )

  return {
    applyModifications,
    addNode: (node: ReactFlowNode) => addNodes([node]),
    updateNode,
    deleteNodes,
    addEdge: addEdgeWithValidation,
    deleteEdge: (edgeId: string) => deleteElements({ edges: [{ id: edgeId }] }),
  }
}
