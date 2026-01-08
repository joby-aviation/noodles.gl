import { getIncomers, type Node as ReactFlowNode } from '@xyflow/react'

import type { Edge } from './noodles'
import type { IOperator, Operator, OpType } from './operators'
import { ContainerOp, ForLoopEndOp, GraphInputOp, opTypes } from './operators'
import { getOpStore } from './store'
import { memoize } from './utils/memoize'
import { getParentPath, isDirectChild, parseHandleId } from './utils/path-utils'
import {
  updateGraph,
  type ComputeState,
  type ComputeResult,
  type Edge as ExecutorEdge,
} from './graph-executor'

// Re-export GraphExecutor and related types for use elsewhere
export {
  GraphExecutor,
  GraphScope,
  type ComputeState,
  type ComputeResult,
  initializeExecutor,
  startExecutor,
  stopExecutor,
  getExecutor,
  forceUpdate,
  getPerformanceMetrics,
  wouldCreateCycle,
  getExecutionOrder,
} from './graph-executor'
import type { ExtractProps } from './utils/extract-props'

// Local type definitions for ReactFlow node data using Operator class constraint
// Simplified to avoid complex type resolution that causes memory issues
export type NodeDataJSON<_T extends Operator<IOperator> = Operator<IOperator>> = {
  inputs?: Record<string, unknown>
  locked?: boolean
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
        if (ctor.cacheable) {
          op.execute = memoize(op.execute)
        }
        created.push(op)
        // Store operator in store using fully qualified path
        store.setOp(id, op)
      }

      return op
    }) as OP[]
  })

  for (const op of created) {
    op.createListeners()
  }

  // Update dependency graph
  updateGraph(edges as unknown as ExecutorEdge[])

  // Remove any connections that are not in the edges array
  for (const op of instances) {
    for (const [_key, field] of Object.entries(op.inputs)) {
      for (const [id] of field.subscriptions) {
        const edge = edges.find(edge => edge.id === id)
        if (!edge) {
          field.removeConnection(id, 'reference')
        }
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
        console.warn('Invalid connection')
        debugger
        continue
      }

      // Check if edge has type property and if it's a ReferenceEdge
      const connectionType =
        (edge as Edge<OP, OP> & { type?: string }).type === 'ReferenceEdge' ? 'reference' : 'value'
      targetField.addConnection(edge.id, sourceField, connectionType)

      // Update operator dependencies for pull-based execution
      sourceOp.addDownstreamDependent(targetOp)
      targetOp.addUpstreamDependency(sourceOp)
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
          const parentValueField = childOp.inputs.parentValue
          const containerInField = containerOp.inputs.in

          const connectionId = `container_in_to_child_${childOp.id}`
          parentValueField.addConnection(connectionId, containerInField, 'value')
        }
      }
    }
  }

  return instances
}

// External compute function that operates on operators
// This replaces the need for a compute() method on Operator class
export async function compute(
  operators: Operator<IOperator>[],
  state: ComputeState
): Promise<Map<string, ComputeResult>> {
  const results = new Map<string, ComputeResult>()

  // Sort operators topologically using edges from connections
  const edges: Array<{ source: string; target: string }> = []

  // Extract edges from operator connections
  for (const op of operators) {
    for (const [_, field] of Object.entries(op.inputs)) {
      const connections = field.getConnections()
      for (const connection of connections) {
        if (connection.sourceOp) {
          edges.push({
            source: connection.sourceOp.id,
            target: op.id
          })
        }
      }
    }
  }

  // Build node map for topological sort
  const nodeMap = new Map(operators.map(op => [op.id, op]))

  // Use existing topological sort (convert to work with operators)
  const nodes = operators.map(op => ({
    id: op.id,
    type: (op.constructor as any).displayName || 'Unknown',
    data: {}
  })) as NodeJSON<OpType>[]

  const sortedNodes = topologicalSort(nodes, edges as any)

  // Execute each operator in sorted order
  for (const node of sortedNodes) {
    const op = nodeMap.get(node.id)
    if (!op || !op.dirty) continue

    try {
      // Get input values
      const inputs: Record<string, unknown> = {}
      for (const [key, field] of Object.entries(op.inputs)) {
        inputs[key] = field.value
      }

      // Execute the operator
      const output = op.execute(inputs as ExtractProps<typeof op.inputs>)
      const finalOutput = output instanceof Promise ? await output : output

      // Update output fields
      if (finalOutput) {
        for (const [key, value] of Object.entries(finalOutput)) {
          if (key in op.outputs) {
            ;(op.outputs as any)[key].setValue(value)
          }
        }
      }

      results.set(node.id, {
        value: finalOutput,
        changed: true
      })

      // Clear dirty flag
      op.dirty = false
    } catch (error) {
      results.set(node.id, {
        value: null,
        changed: false,
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  }

  return results
}
