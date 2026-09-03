import { getIncomers, type Node as ReactFlowNode } from '@xyflow/react'
import { analytics } from '../utils/analytics'
import { debugExecutor } from '../utils/debug'
import { type Field, ListField } from './fields'
import type { Edge as ExecutorEdge } from './graph-executor'
import type { Edge } from './noodles'
import type { IOperator, Operator, OpType } from './operators'
import {
  ContainerOp,
  ForLoopEndOp,
  GraphInputOp,
  GraphOutputOp,
  opTypes,
  type SpecialNodeType,
} from './operators'
import { deriveReferenceEdges, referenceDependencyModel } from './reference-dependencies'
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

export { deriveReferenceEdges } from './reference-dependencies'

export interface GraphLoadError {
  type: 'unknown-operator' | 'stale-edge'
  nodeId?: string
  nodeType?: string
  edgeId?: string
  message: string
}

export function transformGraph<
  OP extends Operator<IOperator>,
  E extends Edge<OP, OP>,
  T extends OpType,
>({
  nodes: _nodes,
  edges: _edges,
}: {
  nodes: NodeJSON<unknown>[]
  edges: E[]
}): {
  operators: OP[]
  errors: GraphLoadError[]
} {
  const errors: GraphLoadError[] = []
  const nodes = _nodes.filter(n => opTypes[n.type as T] !== undefined) as NodeJSON<OpType>[]
  const dataEdges = _edges.filter(edge => (edge as E & { type?: string }).type !== 'ReferenceEdge')
  // Reference dependencies are model-owned and derived for every node, mounted or not.
  const edges = [
    ...dataEdges,
    ...(deriveReferenceEdges(
      _nodes as ReadonlyArray<{ id: string; data?: { inputs?: Record<string, unknown> } }>,
      dataEdges
    ) as unknown as E[]),
  ]
  // A container's output boundary is structural, not a persisted React Flow edge.
  // Include it in the executor graph so the container cannot race its child
  // GraphOutputOp as an independent root during the first frame.
  const containerOutputNodeIds = new Map<string, string>()
  const implicitContainerOutputEdges: ExecutorEdge[] = nodes.flatMap(containerNode => {
    if (containerNode.type !== 'ContainerOp') return []
    const outputNode = nodes.find(
      node => node.type === 'GraphOutputOp' && isDirectChild(node.id, containerNode.id)
    )
    if (outputNode) containerOutputNodeIds.set(containerNode.id, outputNode.id)
    if (
      !outputNode ||
      edges.some(edge => edge.source === outputNode.id && edge.target === containerNode.id)
    ) {
      return []
    }
    return [
      {
        id: `${outputNode.id}.out.propagatedValue->${containerNode.id}.out.out`,
        source: outputNode.id,
        target: containerNode.id,
        sourceHandle: 'out.propagatedValue',
        targetHandle: 'out.out',
      },
    ]
  })

  // A container input is a field-level bridge: source -> Container.par -> GraphInput.par.
  // The enclosing Container cannot be a pull dependency of its GraphInput because the
  // output boundary points back from GraphOutput -> Container, which would form a cycle.
  // Bridge external output dependencies directly to each GraphInput so the child graph
  // waits for its parent inputs to be populated on the first pull.
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const graphInputNodeIdsByContainer = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.type !== 'GraphInputOp') continue
    const containerId = getParentPath(node.id)
    if (!containerId || nodeById.get(containerId)?.type !== 'ContainerOp') continue
    const inputNodeIds = graphInputNodeIdsByContainer.get(containerId) ?? []
    inputNodeIds.push(node.id)
    graphInputNodeIdsByContainer.set(containerId, inputNodeIds)
  }

  const containerInputSourceIdsByGraphInput = new Map<string, Set<string>>()
  const existingPullRelations = new Set(
    edges
      .filter(edge => parseHandleId(String(edge.sourceHandle))?.namespace === 'out')
      .map(edge => `${edge.source}->${edge.target}`)
  )
  const bridgeRelations = new Set<string>()
  const implicitContainerInputEdges: ExecutorEdge[] = []
  for (const edge of edges) {
    const containerNode = nodeById.get(edge.target)
    const sourceHandle = parseHandleId(String(edge.sourceHandle))
    const targetHandle = parseHandleId(String(edge.targetHandle))
    if (
      containerNode?.type !== 'ContainerOp' ||
      sourceHandle?.namespace !== 'out' ||
      targetHandle?.namespace !== 'par' ||
      edge.source === containerNode.id ||
      edge.source.startsWith(`${containerNode.id}/`)
    ) {
      continue
    }

    const graphInputNodeIds = graphInputNodeIdsByContainer.get(containerNode.id) ?? []
    if (graphInputNodeIds.length === 0) continue

    for (const graphInputNodeId of graphInputNodeIds) {
      const relation = `${edge.source}->${graphInputNodeId}`
      if (existingPullRelations.has(relation) || bridgeRelations.has(relation)) continue
      bridgeRelations.add(relation)

      const sourceIds =
        containerInputSourceIdsByGraphInput.get(graphInputNodeId) ?? new Set<string>()
      sourceIds.add(edge.source)
      containerInputSourceIdsByGraphInput.set(graphInputNodeId, sourceIds)

      implicitContainerInputEdges.push({
        id: `${edge.id}->${graphInputNodeId}.par.parentValue`,
        source: edge.source,
        target: graphInputNodeId,
        sourceHandle: edge.sourceHandle,
        targetHandle: 'par.parentValue',
      })
    }
  }

  const executorEdges = [
    ...(edges as unknown as ExecutorEdge[]),
    ...implicitContainerOutputEdges,
    ...implicitContainerInputEdges,
  ]
  const store = getOpStore()

  // Error about unknown node types — nodes present in the project file that aren't registered
  // operators. Intentional special types like 'group' (React Flow group nodes) are excluded.
  const specialNodeTypes = new Set<string>(['group'] satisfies SpecialNodeType[])
  for (const node of _nodes) {
    if (opTypes[node.type as T] === undefined && !specialNodeTypes.has(node.type as string)) {
      const nodeId = (node as { id: string }).id
      const errorMsg = `Unknown operator type "${node.type}" for node "${nodeId}". This node will be skipped.`
      console.error(`[noodles] ${errorMsg}`)
      errors.push({
        type: 'unknown-operator',
        nodeId,
        nodeType: node.type as string,
        message: `Node "${nodeId}" (type: ${node.type})`,
      })
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
      const errorMsg = `Edge "${edge.id}" references missing node(s): ${missing}`
      console.error(
        `[noodles] Stale edge detected: ${errorMsg}. ` +
          'This may be caused by a failed node rename. The graph will load, but affected connections will be missing.'
      )
      debugExecutor('Stale edge: %s (missing: %s)', edge.id, missing)
      errors.push({
        type: 'stale-edge',
        edgeId: edge.id,
        message: errorMsg,
      })
    }
  }

  const sortedNodes = topologicalSort(nodes, executorEdges as unknown as E[])
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
            dataEdges
              .filter(edge => edge.target === id)
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

  for (const edge of dataEdges) {
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

      targetField.addConnection(edge.id, sourceField, 'value')

      // Auto-show fields when they receive data connections (for programmatic/AI connections)
      targetOp.showField(targetFieldName)

      // Only validate when the source field has produced a value; skip if the operator hasn't
      // executed yet (value === undefined) to avoid false "type mismatch" errors on initial load
      const validation = validateConnection(sourceField, targetField)
      if (!validation.valid && validation.error && sourceField.value !== undefined) {
        targetOp.addConnectionError(edge.id, validation.error)
        // Only track if this edge hasn't been reported yet to avoid duplicates on graph rebuilds
        const errorMap = targetOp.connectionErrors.value
        const isNewError = !errorMap.has(edge.id)
        if (isNewError) {
          // Don't send constraint details - may contain user values
          analytics.track('connection_failed', {
            failureType:
              validation.severity === 'warning' ? 'constraint_violation' : 'type_mismatch',
            sourceType: (sourceField.constructor as typeof Field).type,
            targetType: (targetField.constructor as typeof Field).type,
          })
        }
      } else {
        // Clear any existing error for this edge if it's now valid (or not yet computed)
        targetOp.removeConnectionError(edge.id)
      }

      // Parameter-sourced edges that stay inside their owner don't require
      // executing that owner and would create a false container cycle.
      const isEnclosedParameterReference =
        sourceNamespace === 'par' &&
        (edge.source === edge.target || edge.target.startsWith(`${edge.source}/`))

      if (!isEnclosedParameterReference) {
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
          dataEdges
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
      const graphOutputId = containerOutputNodeIds.get(containerOp.id)
      const selectedOutput = graphOutputId ? store.getOp(graphOutputId) : undefined
      const graphOutput = selectedOutput instanceof GraphOutputOp ? selectedOutput : undefined
      // The implicit executor edge above establishes scheduling order. Mirror
      // it in Operator's pull graph so a downstream pull awaits the child
      // output and future child updates dirty the container and its consumers.
      containerOp.setGraphOutputOp(graphOutput)

      for (const childOp of store.getAllOps()) {
        if (childOp instanceof GraphInputOp && isDirectChild(childOp.id, containerOp.id)) {
          const inputDependencies = Array.from(
            containerInputSourceIdsByGraphInput.get(childOp.id) ?? []
          )
            .map(sourceId => store.getOp(sourceId))
            .filter((sourceOp): sourceOp is Operator<IOperator> => sourceOp !== undefined)
          childOp.setContainerInputDependencies(inputDependencies)

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

  referenceDependencyModel.configure({
    nodes: _nodes,
    executionEdges: executorEdges,
    operators: instances,
  })

  return { operators: instances, errors }
}
