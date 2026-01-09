// Shared hook for applying project modifications using ReactFlow hooks
// Used by both the UI and the AI chat system

import {
  applyEdgeChanges,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
  type OnConnect,
  type Edge as ReactFlowEdge,
  type Node as ReactFlowNode,
  addEdge as reactFlowAddEdge,
} from '@xyflow/react'
import { useCallback } from 'react'
import { analytics } from '../../utils/analytics'
import { type Field, ListField } from '../fields'
import type { IOperator, Operator } from '../operators'
import { deleteOp, getAllOps, getOp, setOp } from '../store'
import { canConnect } from '../utils/can-connect'
import { edgeId } from '../utils/id-utils'
import { generateQualifiedPath, parseHandleId } from '../utils/path-utils'

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

interface UseProjectModificationsOptions {
  getNodes: () => ReactFlowNode<Record<string, unknown>>[]
  getEdges: () => ReactFlowEdge[]
  setNodes: (
    nodes:
      | ReactFlowNode<Record<string, unknown>>[]
      | ((
          nodes: ReactFlowNode<Record<string, unknown>>[]
        ) => ReactFlowNode<Record<string, unknown>>[])
  ) => void
  setEdges: (edges: ReactFlowEdge[] | ((edges: ReactFlowEdge[]) => ReactFlowEdge[])) => void
}

export function useProjectModifications(options: UseProjectModificationsOptions) {
  const { getNodes, getEdges, setNodes, setEdges } = options

  // Implement add/delete operations manually
  const addNodes = useCallback(
    (newNodes: ReactFlowNode[]) => {
      setNodes(currentNodes => [...currentNodes, ...newNodes])
      // Track node addition
      newNodes.forEach(node => {
        analytics.track('node_added', { nodeType: node.type || 'unknown' })
      })
    },
    [setNodes]
  )

  const addEdges = useCallback(
    (newEdges: ReactFlowEdge[]) => {
      setEdges(currentEdges => [...currentEdges, ...newEdges])
      // Track edge addition
      if (newEdges.length > 0) {
        analytics.track('edge_added', { count: newEdges.length })
      }
    },
    [setEdges]
  )

  const deleteElements = useCallback(
    ({
      nodes: nodesToDelete,
      edges: edgesToDelete,
    }: {
      nodes?: { id: string }[]
      edges?: { id: string }[]
    }) => {
      if (nodesToDelete && nodesToDelete.length > 0) {
        const nodeIds = new Set(nodesToDelete.map(n => n.id))
        setNodes(currentNodes => currentNodes.filter(n => !nodeIds.has(n.id)))
        analytics.track('node_deleted', { count: nodesToDelete.length })
      }
      if (edgesToDelete && edgesToDelete.length > 0) {
        const edgeIds = new Set(edgesToDelete.map(e => e.id))
        setEdges(currentEdges => currentEdges.filter(e => !edgeIds.has(e.id)))
        analytics.track('edge_deleted', { count: edgesToDelete.length })
      }
    },
    [setNodes, setEdges]
  )

  // Handle edge reconnection after nodes are deleted (same logic as noodles.tsx onNodesDelete)
  // This is a callback invoked AFTER nodes have been deleted by ReactFlow
  // Takes the deleted nodes directly (not IDs) since they're no longer in the nodes array
  const handleNodesDeleted = useCallback(
    (deletedNodes: ReactFlowNode[]): ModificationResult => {
      // Get the current state BEFORE the nodes were deleted (for edge reconnection logic)
      // We need to reconstruct the pre-deletion state by adding deleted nodes back
      const currentNodes = getNodes()
      const nodes = [...currentNodes, ...deletedNodes]
      const edges = getEdges()
      const nodesToDelete = deletedNodes

      if (nodesToDelete.length === 0) {
        return { success: false, error: 'No nodes provided for deletion' }
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
                const sourceField = getOp(source)?.outputs[sourceHandleInfo.fieldName]
                const targetField = getOp(target)?.inputs[targetHandleInfo.fieldName]
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

  // Delete nodes with intelligent edge handling
  // This wrapper handles edge reconnection and then deletes the nodes
  const deleteNodes = useCallback(
    (nodeIds: string[]): ModificationResult => {
      // Get the nodes before deletion
      const nodes = getNodes()
      const nodesToDelete = nodes.filter(n => nodeIds.includes(n.id))

      if (nodesToDelete.length === 0) {
        return { success: false, error: `No nodes found with IDs: ${nodeIds.join(', ')}` }
      }

      // First handle edge reconnection (needs nodes to still exist)
      const result = handleNodesDeleted(nodesToDelete)
      // Then delete the nodes
      deleteElements({ nodes: nodeIds.map(id => ({ id })) })
      return result
    },
    [getNodes, deleteElements, handleNodesDeleted]
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
      const sourceOp = getOp(edge.source)
      const targetOp = getOp(edge.target)

      if (!sourceOp || !targetOp) {
        return {
          success: false,
          error: 'Invalid edge: source or target operator not found in store',
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

      const sourceFieldType = (sourceField.constructor as typeof Field).type
      const targetFieldType = (targetField.constructor as typeof Field).type

      // Validate connection
      if (!canConnect(sourceField, targetField)) {
        return {
          success: false,
          error: `Invalid connection: ${sourceFieldType} cannot connect to ${targetFieldType}`,
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

      // Get the operator instance from store
      const operator = getOp(nodeId)

      if (operator && updates.data?.inputs) {
        // Update operator inputs using setValue
        const inputs = updates.data.inputs
        Object.entries(inputs).forEach(([key, value]: [string, unknown]) => {
          const operatorInputs = (operator as unknown as Record<string, unknown>).inputs as
            | Record<string, { setValue?: (value: unknown) => void }>
            | undefined
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
            const nodeData = (n.data || {}) as Record<string, unknown>
            const updatesData = (updates.data || {}) as Record<string, unknown>
            const nodeInputs = (nodeData.inputs || {}) as Record<string, unknown>
            const updateInputs = (updatesData.inputs || {}) as Record<string, unknown>
            return {
              ...n,
              ...updates,
              data: {
                ...nodeData,
                ...updatesData,
                inputs: {
                  ...nodeInputs,
                  ...updateInputs,
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

  // Apply a batch of modifications atomically
  // All nodes are added first, then edges are validated and added
  // Edge validation failures are logged but don't stop other edges from being applied
  const applyModifications = useCallback(
    (modifications: ProjectModification[]): ModificationResult => {
      const allWarnings: string[] = []
      const edgeErrors: string[] = []

      // Collect all modifications by type
      const nodesToAdd: ReactFlowNode[] = []
      const nodesToUpdate: Array<{ id: string; updates: Partial<ReactFlowNode> & { id: string } }> =
        []
      const nodesToDelete: string[] = []
      const edgesToAdd: ReactFlowEdge[] = []
      const edgesToDelete: string[] = []

      // First pass: collect all modifications
      for (const mod of modifications) {
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

          default:
            return {
              success: false,
              error: `Unknown modification type: ${(mod as { type: string }).type}`,
            }
        }
      }

      // Apply node deletions first
      if (nodesToDelete.length > 0) {
        // Get the actual node objects before deletion
        const nodes = getNodes()
        const nodeObjectsToDelete = nodes.filter(n => nodesToDelete.includes(n.id))

        if (nodeObjectsToDelete.length === 0) {
          return { success: false, error: `No nodes found with IDs: ${nodesToDelete.join(', ')}` }
        }

        // Handle edge reconnection BEFORE deleting nodes
        const result = handleNodesDeleted(nodeObjectsToDelete)
        if (!result.success) {
          return result
        }
        if (result.warnings) {
          allWarnings.push(...result.warnings)
        }
        // Then delete the nodes
        deleteElements({ nodes: nodesToDelete.map(id => ({ id })) })
      }

      // Get current nodes before modifications
      const currentNodesBeforeAdd = getNodes()

      // Build the complete node list (existing + new) for edge validation BEFORE setNodes
      let completeNodeList = [...currentNodesBeforeAdd]

      // Add new nodes to the list
      if (nodesToAdd.length > 0) {
        completeNodeList = [...completeNodeList, ...nodesToAdd]
      }

      // Apply updates to existing nodes in the list
      if (nodesToUpdate.length > 0) {
        completeNodeList = completeNodeList.map(n => {
          const update = nodesToUpdate.find(u => u.id === n.id)
          if (update) {
            const nodeData = (n.data || {}) as Record<string, unknown>
            const updatesData = (update.updates.data || {}) as Record<string, unknown>
            const nodeInputs = (nodeData.inputs || {}) as Record<string, unknown>
            const updateInputs = (updatesData.inputs || {}) as Record<string, unknown>
            return {
              ...n,
              ...update.updates,
              data: {
                ...nodeData,
                ...updatesData,
                inputs: {
                  ...nodeInputs,
                  ...updateInputs,
                },
              },
            }
          }
          return n
        })
      }

      // Apply node additions and updates atomically
      setNodes(currentNodes => {
        let updatedNodes = [...currentNodes]

        // Add new nodes
        if (nodesToAdd.length > 0) {
          updatedNodes = [...updatedNodes, ...nodesToAdd]
        }

        // Apply updates to existing nodes
        if (nodesToUpdate.length > 0) {
          updatedNodes = updatedNodes.map(n => {
            const update = nodesToUpdate.find(u => u.id === n.id)
            if (update) {
              const nodeData = (n.data || {}) as Record<string, unknown>
              const updatesData = (update.updates.data || {}) as Record<string, unknown>
              const nodeInputs = (nodeData.inputs || {}) as Record<string, unknown>
              const updateInputs = (updatesData.inputs || {}) as Record<string, unknown>
              return {
                ...n,
                ...update.updates,
                data: {
                  ...nodeData,
                  ...updatesData,
                  inputs: {
                    ...nodeInputs,
                    ...updateInputs,
                  },
                },
              }
            }
            return n
          })
        }

        return updatedNodes
      })

      // Update operator inputs for node updates
      for (const { id, updates } of nodesToUpdate) {
        const operator = getOp(id)
        if (operator && updates.data?.inputs) {
          const inputs = updates.data.inputs as Record<string, unknown>
          for (const [key, value] of Object.entries(inputs)) {
            const operatorInputs = (operator as unknown as Record<string, unknown>).inputs as
              | Record<string, { setValue?: (value: unknown) => void }>
              | undefined
            const input = operatorInputs?.[key]
            if (input && typeof input.setValue === 'function') {
              input.setValue(value)
            }
          }
        }
      }

      // Add edges - with optional validation depending on whether new nodes were added
      if (edgesToAdd.length > 0) {
        // If we just added nodes, we can't validate edges yet because the store hasn't been updated
        // In this case, add edges optimistically and let the system handle them on next render
        const hasNewNodes = nodesToAdd.length > 0

        if (hasNewNodes) {
          // Optimistic path: add edges without validation when nodes were just added
          // Basic check: ensure nodes exist in our complete list
          const skippedEdges: string[] = []
          const edgesToAddOptimistically = edgesToAdd.filter(edge => {
            const sourceExists = completeNodeList.some(n => n.id === edge.source)
            const targetExists = completeNodeList.some(n => n.id === edge.target)

            if (!sourceExists || !targetExists) {
              const error = `Edge ${edge.id}: source or target node not in node list (source: ${edge.source}, target: ${edge.target})`
              console.warn('⚠️', error)
              skippedEdges.push(error)
              return false
            }
            return true
          })

          if (edgesToAddOptimistically.length > 0) {
            setEdges(currentEdges => [...currentEdges, ...edgesToAddOptimistically])
            console.log(`✅ Added ${edgesToAddOptimistically.length} edge(s) optimistically`)
          }

          if (skippedEdges.length > 0) {
            allWarnings.push(
              `${skippedEdges.length} edge(s) skipped due to missing nodes. See console for details.`
            )
          }
        } else {
          // Validated path: full validation when no new nodes
          const validEdges: ReactFlowEdge[] = []
          const edgeFieldConnections: Array<{
            edge: ReactFlowEdge
            // biome-ignore lint/suspicious/noExplicitAny: Field type requires generic parameter
            sourceField: Field<any>
            // biome-ignore lint/suspicious/noExplicitAny: Field type requires generic parameter
            targetField: Field<any>
          }> = []

          for (const edge of edgesToAdd) {
            // Validate the edge against existing operators
            const sourceNode = completeNodeList.find(n => n.id === edge.source)
            const targetNode = completeNodeList.find(n => n.id === edge.target)

            if (!sourceNode || !targetNode) {
              const error = `Edge ${edge.id}: source or target node not found`
              console.error(error)
              edgeErrors.push(error)
              continue
            }

            const sourceOp = getOp(edge.source)
            const targetOp = getOp(edge.target)

            if (!sourceOp || !targetOp) {
              const error = `Edge ${edge.id}: source or target operator not found`
              console.error(error)
              edgeErrors.push(error)
              continue
            }

            if (!edge.sourceHandle || !edge.targetHandle) {
              const error = `Edge ${edge.id}: missing source or target handle`
              console.error(error)
              edgeErrors.push(error)
              continue
            }

            const sourceHandleInfo = parseHandleId(edge.sourceHandle)
            const targetHandleInfo = parseHandleId(edge.targetHandle)

            if (!sourceHandleInfo || !targetHandleInfo) {
              const error = `Edge ${edge.id}: could not parse handle IDs`
              console.error(error)
              edgeErrors.push(error)
              continue
            }

            const sourceField = sourceOp.outputs[sourceHandleInfo.fieldName]
            const targetField = targetOp.inputs[targetHandleInfo.fieldName]

            if (!sourceField || !targetField) {
              const error = `Edge ${edge.id}: field not found (${sourceHandleInfo.fieldName} -> ${targetHandleInfo.fieldName})`
              console.error(error)
              edgeErrors.push(error)
              continue
            }

            const sourceFieldType = (sourceField.constructor as typeof Field).type
            const targetFieldType = (targetField.constructor as typeof Field).type

            if (!canConnect(sourceField, targetField)) {
              const error = `Edge ${edge.id}: incompatible types (${sourceFieldType} -> ${targetFieldType})`
              console.error(error)
              edgeErrors.push(error)
              continue
            }

            // Edge is valid
            validEdges.push(edge)
            edgeFieldConnections.push({ edge, sourceField, targetField })
          }

          // Add all valid edges atomically
          if (validEdges.length > 0) {
            setEdges(currentEdges => [...currentEdges, ...validEdges])

            // Update field connections for valid edges
            for (const { edge, sourceField, targetField } of edgeFieldConnections) {
              targetField.addConnection(edge.id, sourceField)
            }

            if (edgeErrors.length > 0) {
              console.log(
                `Added ${validEdges.length}/${edgesToAdd.length} edges (${edgeErrors.length} skipped)`
              )
            }
          }

          if (edgeErrors.length > 0) {
            allWarnings.push(
              `${edgeErrors.length} edge(s) failed validation and were skipped. See console for details.`
            )
          }
        }
      }

      // Delete edges
      if (edgesToDelete.length > 0) {
        deleteElements({ edges: edgesToDelete.map(id => ({ id })) })
      }

      return {
        success: true,
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      }
    },
    [getNodes, setNodes, setEdges, handleNodesDeleted, deleteElements]
  )

  // ReactFlow-compatible onConnect callback
  // Handles edge creation with validation and field updates
  const onConnect: OnConnect = useCallback(
    connection => {
      const nodes = getNodes()

      const newEdge: ReactFlowEdge = {
        ...connection,
        id: edgeId(connection),
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle || null,
        targetHandle: connection.targetHandle || null,
      }

      const source = nodes.find(n => n.id === connection.source)
      if (!source) {
        console.warn('Invalid source', connection)
        return
      }
      const targetIndex = nodes.findIndex(n => n.id === connection.target)
      const target = nodes[targetIndex]
      if (!target) {
        console.warn('Invalid target', connection)
        return
      }

      const sourceOp = getOp(source.id)
      const targetOp = getOp(target.id)

      if (!sourceOp || !targetOp) {
        console.warn('Invalid source or target', connection)
        return
      }

      // Extract field names from qualified handle IDs
      if (!connection.sourceHandle || !connection.targetHandle) {
        console.warn('Invalid handle IDs', connection)
        return
      }
      const sourceHandleInfo = parseHandleId(connection.sourceHandle)
      const targetHandleInfo = parseHandleId(connection.targetHandle)

      if (!sourceHandleInfo || !targetHandleInfo) {
        console.warn('Invalid handle IDs', connection)
        return
      }

      const sourceField = sourceOp.outputs[sourceHandleInfo.fieldName]
      const targetField = targetOp.inputs[targetHandleInfo.fieldName]
      if (!sourceField || !targetField) {
        console.warn('Invalid connection', connection)
        return
      }

      // Validate connection
      if (!canConnect(sourceField, targetField)) {
        return
      }

      // Update edges - replace existing if target is not a ListField
      setEdges(eds => {
        const existing = eds.find(
          e => e.target === newEdge.target && e.targetHandle === newEdge.targetHandle
        )
        if (existing && !(targetField instanceof ListField)) {
          return applyEdgeChanges(
            [{ type: 'replace', id: existing.id, item: newEdge }],
            eds as ReactFlowEdge[]
          )
        }
        return reactFlowAddEdge(newEdge, eds as ReactFlowEdge[])
      })

      // Update target node with new input value
      setNodes(nds => {
        const updated = [...nds]
        const value =
          targetField instanceof ListField
            ? Array.from(targetField.fields.values()).map(f => f.value)
            : sourceField.value

        const targetData = target.data as Record<string, unknown> | undefined
        updated[targetIndex] = {
          ...target,
          data: {
            ...targetData,
            inputs: {
              ...(targetData?.inputs as Record<string, unknown>),
              [targetHandleInfo.fieldName]: value,
            },
          },
        }

        return updated
      })

      // Add connection to field
      targetField.addConnection(newEdge.id, sourceField)
    },
    [getNodes, setNodes, setEdges]
  )

  // ReactFlow-compatible onNodesDelete callback
  // Handles edge reconnection after ReactFlow deletes nodes
  const onNodesDelete = useCallback(
    (deleted: ReactFlowNode[]) => {
      handleNodesDeleted(deleted)
    },
    [handleNodesDeleted]
  )

  // Update operator ID and all references to it (nodes, edges, children)
  // Used when renaming operators in the node tree sidebar or node headers
  const updateOperatorId = useCallback(
    (nodeId: string, newBaseName: string, isContainer: boolean) => {
      const op = getOp(nodeId)
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
    },
    [setNodes, setEdges]
  )

  return {
    // Batch operations
    applyModifications,

    // Individual operations
    addNode: (node: ReactFlowNode) => addNodes([node]),
    updateNode,
    deleteNodes,
    addEdge: addEdgeWithValidation,
    deleteEdge: (edgeId: string) => deleteElements({ edges: [{ id: edgeId }] }),

    // Operator operations
    updateOperatorId,

    // ReactFlow callbacks
    onConnect,
    onNodesDelete,
  }
}
