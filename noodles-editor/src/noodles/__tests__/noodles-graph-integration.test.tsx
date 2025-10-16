// Integration tests for core Noodles graph editor flows
// Tests node addition, connection, deletion, and graph manipulation
import type { Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MathOp, NumberOp } from '../operators'
import { opMap } from '../store'
import { transformGraph } from '../transform-graph'

// Mock Theatre.js studio to avoid side effects
vi.mock('@theatre/studio', () => ({
  default: {
    transaction: vi.fn((fn) => fn({
      __experimental_forgetSheet: vi.fn(),
    })),
    setSelection: vi.fn(),
    createContentOfSaveFile: vi.fn(() => ({ sheetsById: {} })),
  },
}))

describe('Noodles Graph Integration', () => {
  afterEach(() => {
    opMap.clear()
  })

  it('creates operators when transforming a graph with nodes and edges', () => {
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/num2',
        type: 'NumberOp',
        position: { x: 200, y: 0 },
        data: { inputs: { val: 10 } },
      },
      {
        id: '/add',
        type: 'MathOp',
        position: { x: 400, y: 0 },
        data: { inputs: { operator: 'add' } },
      },
    ]

    const edges = [
      {
        id: '/num1/out.val->/add/par.a',
        source: '/num1',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
      {
        id: '/num2/out.val->/add/par.b',
        source: '/num2',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.b',
      },
    ]

    const operators = transformGraph({ nodes, edges })

    // Should create 3 operators
    expect(operators).toHaveLength(3)

    // All operators should be in the opMap
    expect(opMap.size).toBeGreaterThanOrEqual(3)
    expect(opMap.has('/num1')).toBe(true)
    expect(opMap.has('/num2')).toBe(true)
    expect(opMap.has('/add')).toBe(true)

    // Verify the connections were established
    const addOp = opMap.get('/add')
    expect(addOp).toBeDefined()
    expect(addOp!.inputs.a.subscriptions.size).toBe(1)
    expect(addOp!.inputs.b.subscriptions.size).toBe(1)
  })

  it('handles node deletion and updates connections', () => {
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/middle',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 2 } },
      },
      {
        id: '/final',
        type: 'MathOp',
        position: { x: 400, y: 0 },
        data: { inputs: { operator: 'multiply', b: 3 } },
      },
    ]

    const edges = [
      {
        id: '/num1/out.val->/middle/par.a',
        source: '/num1',
        target: '/middle',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
      {
        id: '/middle/out.result->/final/par.a',
        source: '/middle',
        target: '/final',
        sourceHandle: 'out.result',
        targetHandle: 'par.a',
      },
    ]

    // Create the initial graph
    transformGraph({ nodes, edges })

    expect(opMap.size).toBeGreaterThanOrEqual(3)

    // Now remove the middle node and create a direct connection
    const nodesAfterDelete = nodes.filter(n => n.id !== '/middle')
    const edgesAfterDelete = [
      {
        id: '/num1/out.val->/final/par.a',
        source: '/num1',
        target: '/final',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    // Clear opMap to simulate a fresh transformation
    opMap.clear()

    // Transform the graph again
    const newOperators = transformGraph({
      nodes: nodesAfterDelete,
      edges: edgesAfterDelete,
    })

    // Should only have 2 operators now
    expect(newOperators).toHaveLength(2)
    expect(opMap.has('/middle')).toBe(false)

    // Verify the new connection
    const finalOp = opMap.get('/final')
    expect(finalOp).toBeDefined()
    expect(finalOp!.inputs.a.subscriptions.size).toBe(1)
  })

  it('handles adding a new node to an existing graph', () => {
    // Start with a simple graph
    const initialNodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
    ]

    transformGraph({ nodes: initialNodes, edges: [] })
    expect(opMap.size).toBeGreaterThanOrEqual(1)

    // Add a new node
    const updatedNodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      ...initialNodes,
      {
        id: '/num2',
        type: 'NumberOp',
        position: { x: 200, y: 0 },
        data: { inputs: { val: 10 } },
      },
    ]

    // Clear and retransform (simulating React Flow's update)
    opMap.clear()
    const operators = transformGraph({ nodes: updatedNodes, edges: [] })

    expect(operators).toHaveLength(2)
    expect(opMap.has('/num2')).toBe(true)
  })

  it('connects two existing nodes', () => {
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/add',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
    ]

    // Start with no connections
    transformGraph({ nodes, edges: [] })

    const addOp = opMap.get('/add')
    expect(addOp).toBeDefined()
    expect(addOp!.inputs.a.subscriptions.size).toBe(0)

    // Add a connection
    const edges = [
      {
        id: '/num/out.val->/add/par.a',
        source: '/num',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    opMap.clear()
    transformGraph({ nodes, edges })

    const connectedAddOp = opMap.get('/add')
    expect(connectedAddOp).toBeDefined()
    expect(connectedAddOp!.inputs.a.subscriptions.size).toBe(1)
  })

  it('handles complex graphs with multiple connections per node', () => {
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/add1',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
      {
        id: '/add2',
        type: 'MathOp',
        position: { x: 200, y: 100 },
        data: { inputs: { operator: 'add', b: 20 } },
      },
      {
        id: '/multiply',
        type: 'MathOp',
        position: { x: 400, y: 50 },
        data: { inputs: { operator: 'multiply' } },
      },
    ]

    const edges = [
      // num1 feeds into both add operations
      {
        id: '/num1/out.val->/add1/par.a',
        source: '/num1',
        target: '/add1',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
      {
        id: '/num1/out.val->/add2/par.a',
        source: '/num1',
        target: '/add2',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
      // Both add operations feed into multiply
      {
        id: '/add1/out.result->/multiply/par.a',
        source: '/add1',
        target: '/multiply',
        sourceHandle: 'out.result',
        targetHandle: 'par.a',
      },
      {
        id: '/add2/out.result->/multiply/par.b',
        source: '/add2',
        target: '/multiply',
        sourceHandle: 'out.result',
        targetHandle: 'par.b',
      },
    ]

    const operators = transformGraph({ nodes, edges })

    expect(operators).toHaveLength(4)

    // Verify all connections
    const multiplyOp = opMap.get('/multiply')
    expect(multiplyOp).toBeDefined()
    expect(multiplyOp!.inputs.a.subscriptions.size).toBe(1)
    expect(multiplyOp!.inputs.b.subscriptions.size).toBe(1)
  })

  it('properly cleans up when replacing edges', () => {
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/num2',
        type: 'NumberOp',
        position: { x: 0, y: 100 },
        data: { inputs: { val: 10 } },
      },
      {
        id: '/add',
        type: 'MathOp',
        position: { x: 200, y: 50 },
        data: { inputs: { operator: 'add' } },
      },
    ]

    // First connection: num1 -> add
    const edges1 = [
      {
        id: '/num1/out.val->/add/par.a',
        source: '/num1',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges: edges1 })

    const addOp1 = opMap.get('/add')
    expect(addOp1!.inputs.a.subscriptions.size).toBe(1)

    // Second connection: replace num1 with num2
    const edges2 = [
      {
        id: '/num2/out.val->/add/par.a',
        source: '/num2',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    opMap.clear()
    transformGraph({ nodes, edges: edges2 })

    const addOp2 = opMap.get('/add')
    // Should still have exactly 1 subscription (the new one)
    expect(addOp2!.inputs.a.subscriptions.size).toBe(1)
  })
})
