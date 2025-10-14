import type { NodeJSON } from '@xyflow/react'
import { type MathOpType, mathOps, type OpType, opTypes } from '../operators'
import { edgeId, nodeId } from './id-utils'

export type NodeType = OpType | MathOpType | 'ForLoop'


// Get all available node types (operators, math ops, and special types like ForLoop)
export function getNodeTypeOptions(): NodeType[] {
  return (Object.keys(opTypes) as NodeType[])
    .filter(type => type !== 'ForLoopBeginOp' && type !== 'ForLoopEndOp')
    .concat(['ForLoop', ...Object.keys(mathOps)])
    .sort()
}

// Convert a string to kebab-case
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

// Generate an operator ID from its type
function makeOpId(type: OpType, containerId: string): string {
  const baseName = toKebabCase(type.replace(/Op$/g, ''))
  return nodeId(baseName, containerId)
}

// Create nodes and edges for a given operator type
// Returns the nodes and edges that should be added to the graph
export function createNodesForType(
  type: NodeType,
  position: { x: number; y: number },
  currentContainerId: string
): {
  nodes: NodeJSON<unknown>[]
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }>
} {
  const nodes: NodeJSON<unknown>[] = []
  const edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }> = []

  const { x, y } = position

  if (type === 'ForLoop') {
    const bodyId = nodeId('for-loop-body', currentContainerId)
    const beginNode = {
      id: makeOpId('ForLoopBeginOp', currentContainerId),
      type: 'ForLoopBeginOp',
      data: undefined,
      parentNode: bodyId,
      expandParent: true,
      position: { x: 0, y: 100 },
    }
    const endNode = {
      id: makeOpId('ForLoopEndOp', currentContainerId),
      type: 'ForLoopEndOp',
      data: undefined,
      parentNode: bodyId,
      expandParent: true,
      position: { x: 900, y: 100 },
    }
    nodes.push({
      id: bodyId,
      type: 'group',
      selectable: false,
      draggable: false,
      style: { width: 1200, height: 300 },
      position: { x, y },
    } as NodeJSON<'group'>)
    nodes.push(beginNode)
    nodes.push(endNode)
    edges.push({
      id: edgeId({
        source: beginNode.id,
        sourceHandle: 'd',
        target: endNode.id,
        targetHandle: 'd',
      }),
      source: beginNode.id,
      target: endNode.id,
      sourceHandle: 'd',
      targetHandle: 'd',
    })
  } else if (type === 'ContainerOp') {
    const id = nodeId('container', currentContainerId)
    const containerInputId = nodeId('container-input', id)
    const containerOutputId = nodeId('container-output', id)
    nodes.push(
      {
        id,
        type,
        data: undefined,
        position: { x, y },
      },
      {
        id: containerInputId,
        type: 'GraphInputOp',
        position: { x: -700, y: 0 },
      },
      {
        id: containerOutputId,
        type: 'GraphOutputOp',
        position: { x: 0, y: 0 },
      }
    )
    const inputSourceHandle = 'par.in'
    const inputTargetHandle = 'par.parentValue'

    const inEdge = {
      source: id,
      sourceHandle: inputSourceHandle,
      target: containerInputId,
      targetHandle: inputTargetHandle,
    }

    const outputSourceHandle = 'out.propagatedValue'
    const outputTargetHandle = 'out.out'

    const outEdge = {
      source: containerOutputId,
      sourceHandle: outputSourceHandle,
      target: id,
      targetHandle: outputTargetHandle,
    }
    edges.push({ ...inEdge, id: edgeId(inEdge) }, { ...outEdge, id: edgeId(outEdge) })
  } else if (mathOps[type]) {
    const operator = mathOps[type] as MathOpType
    nodes.push({
      id: nodeId(operator, currentContainerId),
      type: 'MathOp',
      data: {
        inputs: { operator },
      },
      position: { x, y },
    })
  } else {
    nodes.push({ type, id: makeOpId(type, currentContainerId), position: { x, y } })
  }

  return { nodes, edges }
}
