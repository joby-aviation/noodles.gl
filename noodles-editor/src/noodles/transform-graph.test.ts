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

  it('throws on connections with invalid handle ID format', () => {
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

    expect(() => transformGraph(graph)).toThrow(
      'Invalid handle ID format (invalid-edge) - migration should have converted all handles to qualified format'
    )
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

  it('tracks connection errors for incompatible types', () => {
    // Connect a StringOp output to a MathOp number input - type mismatch
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/str',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/str.out.val->/add.par.a',
        },
      ],
    }

    const instances = transformGraph(graph)
    const add = instances.find(op => op.id === '/add') as MathOp

    // Connection should be established despite type mismatch
    expect(add.inputs.a.subscriptions.size).toBe(1)

    // Connection error should be tracked
    expect(add.hasConnectionErrors()).toBe(true)
    expect(add.connectionErrors.value.size).toBe(1)
    const errorMessage = add.connectionErrors.value.get('/str.out.val->/add.par.a')
    expect(errorMessage).toContain('Type mismatch')
  })

  it('clears connection errors when valid connection replaces invalid one', () => {
    // First create an invalid connection
    const graphWithInvalidConnection: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
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
          source: '/str',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/str.out.val->/add.par.a',
        },
      ],
    }

    transformGraph(graphWithInvalidConnection)

    // Now replace with a valid connection (NumberOp -> MathOp)
    const graphWithValidConnection: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
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

    const instances = transformGraph(graphWithValidConnection)
    const add = instances.find(op => op.id === '/add') as MathOp

    // Valid connection should be established
    expect(add.inputs.a.subscriptions.size).toBe(1)

    // No connection errors should remain
    expect(add.hasConnectionErrors()).toBe(false)
    expect(add.connectionErrors.value.size).toBe(0)
  })

  it('clears connection errors when edge is removed', () => {
    // First create an invalid connection
    const graphWithConnection: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/str',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/str.out.val->/add.par.a',
        },
      ],
    }

    transformGraph(graphWithConnection)

    // Now remove the edge
    const graphWithoutConnection: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [], // No edges
    }

    const instances = transformGraph(graphWithoutConnection)
    const add = instances.find(op => op.id === '/add') as MathOp

    // No subscriptions should exist
    expect(add.inputs.a.subscriptions.size).toBe(0)

    // Connection errors should be cleared
    expect(add.hasConnectionErrors()).toBe(false)
    expect(add.connectionErrors.value.size).toBe(0)
  })
})
