import type { Node as ReactFlowNode } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { Edge } from './noodles'
import { type IOperator, MathOp, NumberOp, type Operator } from './operators'
import { transformGraph } from './transform-graph'
import { edgeId } from './utils/id-utils'

describe('transform-graph', () => {
  it('handles qualified handle IDs', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/num.out.val->/add.par.a',
        },
      ],
    }

    const instances = transformGraph(graph)
    expect(instances).toHaveLength(2)

    const [num, add] = instances
    expect(num).toBeInstanceOf(NumberOp)
    expect(add).toBeInstanceOf(MathOp)
    expect(num.id).toBe('/num')
    expect(add.id).toBe('/add')
  })

  it('skips connections with invalid handle ID format', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Record<string, unknown>[] // Using Record type to test invalid handle IDs
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'invalid-format', // Invalid handle ID format
          targetHandle: 'par.a',
          id: 'invalid-edge',
        },
      ],
    }

    const instances = transformGraph(graph)
    expect(instances).toHaveLength(2)

    const [num, add] = instances
    expect(num).toBeInstanceOf(NumberOp)
    expect(add).toBeInstanceOf(MathOp)
    expect(num.id).toBe('/num')
    expect(add.id).toBe('/add')

    // Verify that the invalid connection was not established
    expect(add.inputs.a.subscriptions.size).toBe(0)
  })

  it('generates correct edge IDs with qualified paths', () => {
    const connection = {
      source: '/container/operator1',
      target: '/container/operator2',
      sourceHandle: 'out.data',
      targetHandle: 'par.input',
    }

    const id = edgeId(connection)

    expect(id).toBe('/container/operator1.out.data->/container/operator2.par.input')
  })

  it('handles ReferenceEdges with standard handles', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: (Edge<Operator<IOperator>, Operator<IOperator>> & { type?: string })[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          // ReferenceEdges use standard handles but render as node-to-node connections
          type: 'ReferenceEdge',
          id: '/num.out.val->/add.par.a',
        } as Edge<Operator<IOperator>, Operator<IOperator>> & { type: string },
      ],
    }

    const instances = transformGraph(graph)
    expect(instances).toHaveLength(2)

    const [num, add] = instances
    expect(num).toBeInstanceOf(NumberOp)
    expect(add).toBeInstanceOf(MathOp)

    // Verify that the reference connection was established
    expect(add.inputs.a.subscriptions.size).toBe(1)
    expect(add.inputs.a.subscriptions.has('/num.out.val->/add.par.a')).toBe(true)
  })
})
