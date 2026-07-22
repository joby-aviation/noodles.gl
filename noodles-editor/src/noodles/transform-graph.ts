import { getIncomers, type Node as ReactFlowNode } from '@xyflow/react'
import { debugExecutor } from '../utils/debug'
import { ListField } from './fields'
import { type Edge as ExecutorEdge, updateGraph } from './graph-executor'
import type { Edge } from './noodles'
import type { IOperator, Operator, OpType } from './operators'
import { ContainerOp, ForLoopEndOp, GraphInputOp, opTypes, type SpecialNodeType } from './operators'
import { getOpStore } from './store'
import { validateConnection } from './utils/can-connect'
import { getParentPath, isDirectChild, parseHandleId } from './utils/path-utils'
import { computeVisibilityHeuristic } from './utils/visibility-heuristic'

// Re-export GraphExecutor and related types for use elsewhere
export {
  type ComputeResult,
  forceUpdate,
  GraphExecutor,
  GraphScope,
  getExecutionOrder,
  getExecutor,
  getPerformanceMetrics,
  initializeExecutor,
  startExecutor,
  stopExecutor,
  wouldCreateCycle,
} from './graph-executor'

// Local type definitions for ReactFlow node data using Operator class constraint
// Simplified to avoid complex type resolution that causes memory issues
export type NodeDataJSON<_T extends Operator<IOperator> = Operator<IOperator>> = {
  inputs?: Record<string, unknown>
  locked?: boolean
  customInputs?: Array<{
    id: string
    name: string
    type: string
    order: number
    options?: Record<string, unknown>
    defaultValue?: unknown
  }>
}

export type NodeJSON<T extends OpType> = ReactFlowNode<
  NodeDataJSON<InstanceType<(typeof opTypes)[T]>>
> & {
  type: T
}

function topologicalSort<N extends Operator<IOperator>>(
  nodes: NodeJSON<OpType>[],
  edges: Edge<N, N>[]
) {
  const sortedNodes: NodeJSON<OpType>[] = []
  const visitedNodes = new Set<string>()

  function traverse(node: NodeJSON<OpType>) {
    if (visitedNodes.has(node.id)) {
      return
    }

    visitedNodes.add(node.id)

    const outgoingEdges = edges.filter(edge => edge.source === node.id)
    for (const edge of outgoingEdges) {
      const targetNode = nodes.find(n => n.id === edge.target)
      if (targetNode) {
        traverse(targetNode)
      }
    }

    sortedNodes.push(node)
  }

  // Look through the edges and find the nodes that have no incoming edges
  const sourceNodes = nodes.filter(node => !edges.some(edge => edge.target === node.id))

  for (const node of sourceNodes) {
    traverse(node)
  }

  // Include nodes that weren't reachable from any source — this happens when an edge references
  // a source node that no longer exists in the graph (e.g. a stale edge after a node is deleted).
  // Without this, those downstream nodes would be silently dropped from the sorted output and
  // never instantiated, causing "Operator with id X not found" errors at render time.
  for (const node of nodes) {
    if (!visitedNodes.has(node.id)) {
      sortedNodes.push(node)
    }
  }

  // TODO: check for cycles, and throw an error if one is found
  // TODO: Fix reversed order
  return sortedNodes.reverse()
}

export function transformGraph<
  OP extends Operator<IOperator>,
  E extends Edge<OP, OP>,
  T extends OpType,
>({ nodes: _nodes, edges }: { nodes: NodeJSON<unknown>[]; edges: E[] }): OP[] {
  const nodes = _nodes.filter(n => opTypes[n.type as T] !== undefined) as NodeJSON<OpType>[]
  const store = getOpStore()

  // Error about unknown node types — nodes present in the project file that aren't registered
  // operators. Intentional special types like 'group' (React Flow group nodes) are excluded.
  const specialNodeTypes = new Set<string>(['group'] satisfies SpecialNodeType[])
  for (const node of _nodes) {
    if (opTypes[node.type as T] === undefined && !specialNodeTypes.has(node.type as string)) {
      console.error(
        `[noodles] Unknown operator type "${node.type}" for node "${(node as { id: string }).id}". ` +
          'This node will be skipped. Is the operator registered in opTypes?'
      )
    }
  }

  // Error about stale edges — edges that reference nodes not present in the graph.
  // This typically indicates a failed node rename where edges weren't updated to match the new ID.
  // Use _nodes (unfiltered) to build nodeIds so unknown-type nodes don't also trigger stale-edge errors.
  const nodeIds = new Set(_nodes.map(n => (n as { id: string }).id))
  for (const edge of edges) {
    const missingSource = !nodeIds.has(edge.source)
    const missingTarget = !nodeIds.has(edge.target)
    if (missingSource || missingTarget) {
      const missing = [
        missingSource ? `source "${edge.source}"` : null,
        missingTarget ? `target "${edge.target}"` : null,
      ]
        .filter(Boolean)
        .join(', ')
      console.error(
        `[noodles] Stale edge detected: edge "${edge.id}" references missing node(s): ${missing}. ` +
          'This may be caused by a failed node rename. The graph will load, but affected connections will be missing.'
      )
      debugExecutor('Stale edge: %s (missing: %s)', edge.id, missing)
    }
  }

  const sortedNodes = topologicalSort(nodes, edges)
  const created: Operator<IOperator>[] = []
  let instances: OP[] = []

  // Batch all store operations for performance
  store.batch(() => {
    // Delete operators that are no longer in the graph
    for (const [id] of store.getOpEntries()) {
      if (!nodes.find(n => n.id === id)) {
        const op = store.getOp(id)
        op?.dispose()
        store.deleteOp(id)
      }
    }

    // Create or retrieve operators
    instances = sortedNodes.map(({ id, data, type }) => {
      let op = store.getOp(id)

      if (!op) {
        const ctor = opTypes[type]
        const containerId = getParentPath(id)
        // Create operator with fully qualified path as id and store containerId
        op = new ctor(id, data?.inputs, data?.locked, containerId) as unknown as OP

        // Restore custom field definitions if present
        if (data?.customInputs && Array.isArray(data.customInputs)) {
          op.customInputDefinitions = data.customInputs
          op.rebuildInputs()
        }

        created.push(op)
        // Store operator in store using fully qualified path
        store.setOp(id, op)

        // Restore field visibility from saved data or derive from heuristic
        const visibleInputs = (data as { visibleInputs?: string[] })?.visibleInputs

        if (visibleInputs && Array.isArray(visibleInputs)) {
          // Explicit visibility saved - use it directly as the full set
          op.visibleFields.next(new Set(visibleInputs))
        } else {
          // No saved visibility - derive from heuristic
          const customValues = data?.inputs ?? {}
          // ReferenceEdges are filtered because they're operator references in code,
          // not data connections that should affect field visibility
          const connectedFields = new Set(
            edges
              .filter(edge => edge.target === id && edge.type !== 'ReferenceEdge')
              .map(edge => parseHandleId(String(edge.targetHandle))?.fieldName)
              .filter((name): name is string => name !== undefined)
          )

          const { visibleFields: heuristicVisible, differsFromDefaults } =
            computeVisibilityHeuristic(op, customValues, connectedFields)

          if (differsFromDefaults) {
            // Heuristic differs from defaults, need to set explicitly
            op.visibleFields.next(heuristicVisible)
          }
          // else: leave visibleFields as null, showByDefault defaults will work
        }
      }

      return op
    }) as OP[]
  })

  // Update dependency graph
  updateGraph(edges as unknown as ExecutorEdge[])

  // Remove any connections that are not in the edges array.
  // Also clear connection errors for removed edges.
  const currentEdgeIds = new Set(edges.map(e => e.id))
  for (const op of instances) {
    for (const [_key, field] of Object.entries(op.inputs)) {
      for (const [id] of field.subscriptions) {
        if (!currentEdgeIds.has(id)) {
          field.removeConnection(id, 'reference')
          op.removeConnectionError(id)
        }
      }
    }
    // Also clear errors for edges that no longer exist but had no subscription
    // (e.g. stale-edge errors from a previous run where the source was missing)
    for (const [errorEdgeId] of op.connectionErrors.value) {
      if (!currentEdgeIds.has(errorEdgeId)) {
        op.removeConnectionError(errorEdgeId)
      }
    }
  }

  for (const edge of edges) {
    const sourceOp = instances.find(n => n.id === edge.source)
    const targetOp = instances.find(n => n.id === edge.target)
    if (sourceOp && targetOp) {
      // Parse handle IDs to get field names - ensure they are strings
      const sourceHandleStr = String(edge.sourceHandle)
      const targetHandleStr = String(edge.targetHandle)

      const sourceHandleInfo = parseHandleId(sourceHandleStr)
      const targetHandleInfo = parseHandleId(targetHandleStr)

      if (!sourceHandleInfo || !targetHandleInfo) {
        throw new Error(
          `Invalid handle ID format (${edge.id}) - migration should have converted all handles to qualified format`
        )
      }

      const sourceFieldName = sourceHandleInfo.fieldName
      const targetFieldName = targetHandleInfo.fieldName

      const sourceNamespace = sourceHandleInfo.namespace
      const targetNamespace = targetHandleInfo.namespace

      // In normal data flow, source is always an output and target is always an input
      const sourceField =
        sourceOp[sourceNamespace === 'par' ? 'inputs' : 'outputs'][sourceFieldName]
      const targetField =
        targetOp[targetNamespace === 'par' ? 'inputs' : 'outputs'][targetFieldName]
      if (!sourceField || !targetField) {
        debugExecutor('Invalid connection')
        continue
      }

      // Check if edge has type property and if it's a ReferenceEdge
      const connectionType =
        (edge as Edge<OP, OP> & { type?: string }).type === 'ReferenceEdge' ? 'reference' : 'value'
      targetField.addConnection(edge.id, sourceField, connectionType)

      // Auto-show fields when they receive data connections (for programmatic/AI connections)
      // ReferenceEdges are operator references in code, not data flow, so don't auto-show
      if (connectionType === 'value') {
        targetOp.showField(targetFieldName)

        // ReferenceEdges mark reactive dependencies only — type checking doesn't apply
        // Only validate when the source field has produced a value; skip if the operator hasn't
        // executed yet (value === undefined) to avoid false "type mismatch" errors on initial load
        const validation = validateConnection(sourceField, targetField)
        if (!validation.valid && validation.error && sourceField.value !== undefined) {
          targetOp.addConnectionError(edge.id, validation.error)
        } else {
          // Clear any existing error for this edge if it's now valid (or not yet computed)
          targetOp.removeConnectionError(edge.id)
        }
      }

      // Update operator dependencies for pull-based execution
      // Skip self-references to parameters (not true cycles - output depends on input value)
      const isSelfParameterReference = edge.source === edge.target && sourceNamespace === 'par'

      if (!isSelfParameterReference) {
        sourceOp.addDownstreamDependent(targetOp)
        targetOp.addUpstreamDependency(sourceOp)
      }
    } else if (targetOp && !sourceOp) {
      // Source node doesn't exist — surface a broken-connection error on the target operator
      // so it appears in the UI via the error popover on the node header.
      targetOp.addConnectionError(
        edge.id,
        `Broken connection: source node "${edge.source}" no longer exists. This may be caused by a failed node rename.`
      )
    }
  }

  // Sync ListField connection order to edge-array order. addConnection early-returns for
  // already-connected ids and appends new ones at the Map end, so reused operators would
  // otherwise keep stale order after edges are inserted mid-group or the array is reordered.
  for (const op of instances) {
    for (const [name, field] of Object.entries(op.inputs)) {
      if (field instanceof ListField) {
        field.setConnectionOrder(
          edges
            .filter(e => e.target === op.id && String(e.targetHandle) === `par.${name}`)
            .map(e => e.id)
        )
      }
    }
  }

  for (const node of sortedNodes) {
    const chain: Operator<IOperator>[] = []
    const op = store.getOp(node.id)
    if (!op) continue

    if (op instanceof ForLoopEndOp) {
      function getUpstream(node: NodeJSON<OpType>) {
        // Cast to NodeJSON<unknown> to specify that `type` is defined in all of our nodes.
        const incomers = getIncomers<NodeDataJSON<unknown>>(
          node,
          nodes,
          edges
        ) as NodeJSON<OpType>[]
        for (const incomer of incomers) {
          const chainOp = store.getOp(incomer.id)!
          chain.push(chainOp)

          if (incomer.type !== 'ForLoopBeginOp') {
            getUpstream(incomer)
          }
        }
      }

      getUpstream(node as NodeJSON<'ForLoopEndOp'>)

      // Optimization: only create listeners if the chain has changed
      if (!chain.every((c, i) => c.id === op.chain[i]?.id)) {
        op.createForLoopListeners(chain)
      }
    }
  }

  // Container to GraphInput propagation
  for (const op of store.getAllOps()) {
    if (op instanceof ContainerOp) {
      const containerOp = op
      for (const childOp of store.getAllOps()) {
        if (childOp instanceof GraphInputOp && isDirectChild(childOp.id, containerOp.id)) {
          // Set up parent container relationship (triggers output rebuild)
          childOp.setParentContainer(containerOp)

          // Wire the base 'in' field to GraphInputOp's parentValue
          const parentValueField = childOp.inputs.parentValue
          const containerInField = containerOp.inputs.in
          const connectionId = `container_in_to_child_${childOp.id}`
          parentValueField.addConnection(connectionId, containerInField, 'value')

          // Wire container's custom inputs to GraphInputOp's dynamic inputs
          // This allows values to flow: container input → GraphInputOp input → execute() → GraphInputOp output
          for (const def of containerOp.customInputDefinitions) {
            const containerCustomField = containerOp.inputs[def.name]
            const graphInputInputField = childOp.inputs[def.name]
            if (containerCustomField && graphInputInputField) {
              const customConnectionId = `container_custom_${def.name}_to_child_${childOp.id}`
              graphInputInputField.addConnection(customConnectionId, containerCustomField, 'value')
            }
          }
        }
      }
    }
  }

  return instances
}
