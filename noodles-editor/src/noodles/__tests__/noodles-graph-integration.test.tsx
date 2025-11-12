// Integration tests for core Noodles graph editor flows
// Tests node addition, connection, deletion, and graph manipulation
import type { Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearOps, getAllOps, getOp, hasOp } from '../store'
import { transformGraph } from '../transform-graph'

// Mock Theatre.js studio to avoid side effects
vi.mock('@theatre/studio', () => ({
  default: {
    transaction: vi.fn(fn =>
      fn({
        __experimental_forgetSheet: vi.fn(),
      })
    ),
    setSelection: vi.fn(),
    createContentOfSaveFile: vi.fn(() => ({ sheetsById: {} })),
  },
}))

describe('Noodles Graph Integration', () => {
  afterEach(() => {
    clearOps()
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
    expect(getAllOps().length).toBeGreaterThanOrEqual(3)
    expect(hasOp('/num1')).toBe(true)
    expect(hasOp('/num2')).toBe(true)
    expect(hasOp('/add')).toBe(true)

    // Verify the connections were established
    const addOp = getOp('/add')
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

    expect(getAllOps().length).toBeGreaterThanOrEqual(3)
    const middleOp = getOp('/middle')
    expect(middleOp).toBeDefined()

    // Now remove the middle node and create a direct connection
    // In the app, transformGraph is called with the updated nodes/edges
    // without clearing opMap - operators are reused when they exist
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

    // Transform the graph again - this reuses existing operators
    // and cleans up operators that are no longer in the nodes list
    const newOperators = transformGraph({
      nodes: nodesAfterDelete,
      edges: edgesAfterDelete,
    })

    // Should only return 2 operators in this transform
    expect(newOperators).toHaveLength(2)
    // The middle operator should be removed from opMap by transformGraph
    // (it calls dispose() and deletes operators not in the nodes list)
    expect(hasOp('/middle')).toBe(false)

    // Verify the new connection
    const finalOp = getOp('/final')
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
    const initialSize = getAllOps().length
    expect(getAllOps().length).toBeGreaterThanOrEqual(1)
    const num1Op = getOp('/num1')

    // Add a new node - in the app, transformGraph is called again
    // with updated nodes/edges, reusing existing operators
    const updatedNodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      ...initialNodes,
      {
        id: '/num2',
        type: 'NumberOp',
        position: { x: 200, y: 0 },
        data: { inputs: { val: 10 } },
      },
    ]

    // Transform again without clearing - operators are reused
    const operators = transformGraph({ nodes: updatedNodes, edges: [] })

    expect(operators).toHaveLength(2)
    expect(hasOp('/num2')).toBe(true)
    // Verify the original operator was reused
    expect(getOp('/num1')).toBe(num1Op)
    // opMap should have grown by 1
    expect(getAllOps().length).toBe(initialSize + 1)
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

    const addOp = getOp('/add')
    expect(addOp).toBeDefined()
    expect(addOp!.inputs.a.subscriptions.size).toBe(0)

    // Add a connection - in the app, transformGraph is called with updated edges
    const edges = [
      {
        id: '/num/out.val->/add/par.a',
        source: '/num',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    // Transform again without clearing - operators are reused and connection is established
    transformGraph({ nodes, edges })

    const connectedAddOp = getOp('/add')
    expect(connectedAddOp).toBeDefined()
    // Should be the same operator instance
    expect(connectedAddOp).toBe(addOp)
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
    const multiplyOp = getOp('/multiply')
    expect(multiplyOp).toBeDefined()
    expect(multiplyOp!.inputs.a.subscriptions.size).toBe(1)
    expect(multiplyOp!.inputs.b.subscriptions.size).toBe(1)
  })

  it('properly handles replacing edges', () => {
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

    const addOp1 = getOp('/add')
    expect(addOp1!.inputs.a.subscriptions.size).toBe(1)

    // Replace connection: num1 with num2
    // In the app, transformGraph is called with the new edges
    const edges2 = [
      {
        id: '/num2/out.val->/add/par.a',
        source: '/num2',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges: edges2 })

    const addOp2 = getOp('/add')
    // Should be the same operator instance
    expect(addOp2).toBe(addOp1)
    // Should still have exactly 1 subscription (the new one replaces the old)
    expect(addOp2!.inputs.a.subscriptions.size).toBe(1)
  })
})
