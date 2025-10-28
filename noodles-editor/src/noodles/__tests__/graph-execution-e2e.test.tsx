// End-to-end tests for graph execution flow
// Tests the complete flow: graph transformation -> operator creation -> subscriptions
import type { Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MathOp, NumberOp } from '../operators'
import { opMap } from '../store'
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

describe('Graph Execution E2E', () => {
  afterEach(() => {
    opMap.clear()
  })

  it('creates fully connected computation graph', () => {
    // Create a simple computation graph: num1 + num2
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

    // Verify all operators created
    expect(operators).toHaveLength(3)
    const num1Op = opMap.get('/num1') as NumberOp
    const num2Op = opMap.get('/num2') as NumberOp
    const addOp = opMap.get('/add') as MathOp

    expect(num1Op).toBeInstanceOf(NumberOp)
    expect(num2Op).toBeInstanceOf(NumberOp)
    expect(addOp).toBeInstanceOf(MathOp)

    // Verify connections are established
    expect(addOp.inputs.a.subscriptions.size).toBe(1)
    expect(addOp.inputs.b.subscriptions.size).toBe(1)

    // Verify input values are set
    expect(num1Op.inputs.val.value).toBe(5)
    expect(num2Op.inputs.val.value).toBe(10)
    expect(addOp.inputs.operator.value).toBe('add')
  })

  it('establishes reactive subscriptions for value propagation', () => {
    // Create graph: num -> multiply
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/multiply',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'multiply', b: 2 } },
      },
    ]

    const edges = [
      {
        id: '/num/out.val->/multiply/par.a',
        source: '/num',
        target: '/multiply',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges })

    const numOp = opMap.get('/num') as NumberOp
    const multiplyOp = opMap.get('/multiply') as MathOp

    // Verify subscription exists
    expect(multiplyOp.inputs.a.subscriptions.size).toBe(1)

    // Track if subscriber is notified on value change
    let notified = false
    multiplyOp.inputs.a.subscribe(() => {
      notified = true
    })

    // Update the input value
    numOp.inputs.val.setValue(7)

    // Subscriber should be notified
    expect(notified).toBe(true)
  })

  it('handles complex multi-step graph structure', () => {
    // Create graph: (num1 + num2) -> multiply
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
      {
        id: '/multiply',
        type: 'MathOp',
        position: { x: 400, y: 50 },
        data: { inputs: { operator: 'multiply', b: 2 } },
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
      {
        id: '/add/out.result->/multiply/par.a',
        source: '/add',
        target: '/multiply',
        sourceHandle: 'out.result',
        targetHandle: 'par.a',
      },
    ]

    const operators = transformGraph({ nodes, edges })

    expect(operators).toHaveLength(4)

    const addOp = opMap.get('/add') as MathOp
    const multiplyOp = opMap.get('/multiply') as MathOp

    // Verify all connections in the chain
    expect(addOp.inputs.a.subscriptions.size).toBe(1)
    expect(addOp.inputs.b.subscriptions.size).toBe(1)
    expect(multiplyOp.inputs.a.subscriptions.size).toBe(1)
  })

  it('properly initializes operators with constant values', () => {
    // Graph with mixed inputs: connected and constant
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 10 } },
      },
      {
        id: '/add',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 5 } }, // b is a constant
      },
    ]

    const edges = [
      {
        id: '/num/out.val->/add/par.a',
        source: '/num',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges })

    const addOp = opMap.get('/add') as MathOp

    // Verify constant value is set
    expect(addOp.inputs.b.value).toBe(5)

    // Verify connection is established for non-constant input
    expect(addOp.inputs.a.subscriptions.size).toBe(1)
  })

  it('maintains operator type information after transformation', () => {
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 42 } },
      },
      {
        id: '/math',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'multiply', b: 2 } },
      },
    ]

    const edges = [
      {
        id: '/num/out.val->/math/par.a',
        source: '/num',
        target: '/math',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges })

    const numOp = opMap.get('/num')
    const mathOp = opMap.get('/math')

    // Verify correct operator types
    expect(numOp?.constructor.name).toBe('NumberOp')
    expect(mathOp?.constructor.name).toBe('MathOp')

    // Verify operator metadata
    expect(NumberOp.displayName).toBe('Number')
    expect(MathOp.displayName).toBe('Math')
  })

  it('propagates changes through dependency chain', () => {
    // Graph: A -> B -> C (chain of dependencies)
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/a',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 2 } },
      },
      {
        id: '/b',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'multiply', b: 3 } },
      },
      {
        id: '/c',
        type: 'MathOp',
        position: { x: 400, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
    ]

    const edges = [
      {
        id: '/a/out.val->/b/par.a',
        source: '/a',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
      {
        id: '/b/out.result->/c/par.a',
        source: '/b',
        target: '/c',
        sourceHandle: 'out.result',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges })

    const aOp = opMap.get('/a') as NumberOp
    const bOp = opMap.get('/b') as MathOp
    const cOp = opMap.get('/c') as MathOp

    // Track notifications through the chain
    let bNotified = false
    let cNotified = false

    bOp.inputs.a.subscribe(() => {
      bNotified = true
    })

    cOp.inputs.a.subscribe(() => {
      cNotified = true
    })

    // Change the root value
    aOp.inputs.val.setValue(5)

    // Both downstream operators should be notified
    expect(bNotified).toBe(true)
    expect(cNotified).toBe(true)
  })
})
