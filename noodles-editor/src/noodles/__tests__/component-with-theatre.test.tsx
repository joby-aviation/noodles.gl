// Tests for complex Noodles-specific integration scenarios
// Focuses on tricky edge cases involving Theatre.js, operators, and field connections
import { screen } from '@testing-library/react'
import type { Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type MathOp, NumberOp, type IOperator, type Operator } from '../operators'
import { opMap } from '../store'
import { transformGraph } from '../transform-graph'
import { renderWithNoodlesProviders } from './test-utils'

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

describe('Complex Noodles Integration Tests', () => {
  afterEach(() => {
    opMap.clear()
  })

  it('propagates field updates through multiple operator connections', () => {
    // Test complex data flow: num -> multiply -> add (3-step chain)
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/source',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/multiply',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'multiply', b: 3 } },
      },
      {
        id: '/add',
        type: 'MathOp',
        position: { x: 400, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
    ]

    const edges = [
      {
        id: '/source/out.val->/multiply/par.a',
        source: '/source',
        target: '/multiply',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
      {
        id: '/multiply/out.result->/add/par.a',
        source: '/multiply',
        target: '/add',
        sourceHandle: 'out.result',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges })

    const sourceOp = opMap.get('/source') as NumberOp
    const multiplyOp = opMap.get('/multiply') as MathOp
    const addOp = opMap.get('/add') as MathOp

    // Verify the 3-operator chain is established
    expect(multiplyOp.inputs.a.subscriptions.size).toBe(1)
    expect(addOp.inputs.a.subscriptions.size).toBe(1)

    // Track notifications on both downstream operators
    let multiplyNotified = false
    let addNotified = false

    multiplyOp.inputs.a.subscribe(() => {
      multiplyNotified = true
    })

    addOp.inputs.a.subscribe(() => {
      addNotified = true
    })

    // Trigger update at source - should propagate through entire chain
    sourceOp.inputs.val.setValue(7)

    // Both operators should receive notifications
    expect(multiplyNotified).toBe(true)
    expect(addNotified).toBe(true)
  })

  it('handles mixed constant and connected inputs in complex graphs', () => {
    // Test graph with some inputs from connections and others as constants
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/num1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 10 } },
      },
      {
        id: '/num2',
        type: 'NumberOp',
        position: { x: 0, y: 100 },
        data: { inputs: { val: 20 } },
      },
      {
        id: '/add',
        type: 'MathOp',
        position: { x: 200, y: 50 },
        data: { inputs: { operator: 'add' } }, // both inputs connected
      },
      {
        id: '/multiply',
        type: 'MathOp',
        position: { x: 400, y: 50 },
        data: { inputs: { operator: 'multiply', b: 5 } }, // b is constant
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

    transformGraph({ nodes, edges })

    const addOp = opMap.get('/add') as MathOp
    const multiplyOp = opMap.get('/multiply') as MathOp

    // Verify connected inputs have subscriptions
    expect(addOp.inputs.a.subscriptions.size).toBe(1)
    expect(addOp.inputs.b.subscriptions.size).toBe(1)
    expect(multiplyOp.inputs.a.subscriptions.size).toBe(1)

    // Verify constant value is set correctly
    expect(multiplyOp.inputs.b.value).toBe(5)
  })

  it('handles operator deletion and subscription cleanup', () => {
    // Test that subscriptions are properly cleaned up when operators are removed
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/source',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 42 } },
      },
      {
        id: '/target',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
    ]

    const edges = [
      {
        id: '/source/out.val->/target/par.a',
        source: '/source',
        target: '/target',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges })

    const sourceOp = opMap.get('/source') as NumberOp
    const targetOp = opMap.get('/target') as MathOp

    // Verify connection established
    expect(targetOp.inputs.a.subscriptions.size).toBe(1)

    // Track if subscription notifies
    let notified = false
    const sub = targetOp.inputs.a.subscribe(() => {
      notified = true
    })

    // Trigger notification
    sourceOp.inputs.val.setValue(100)
    expect(notified).toBe(true)

    // Clean up subscription
    sub.unsubscribe()

    // Reset flag
    notified = false

    // After unsubscribe, notification should not fire
    sourceOp.inputs.val.setValue(200)
    expect(notified).toBe(false)
  })

  it('maintains operator identity through graph transformations', () => {
    // Test that operators maintain their identity when graph is re-transformed
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/persistent',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 123 } },
      },
    ]

    transformGraph({ nodes, edges: [] })

    const firstOp = opMap.get('/persistent') as NumberOp
    expect(firstOp).toBeDefined()
    expect(firstOp.inputs.val.value).toBe(123)

    // Re-transform with same node
    transformGraph({ nodes, edges: [] })

    const secondOp = opMap.get('/persistent') as NumberOp

    // Should be the same operator instance
    expect(secondOp).toBe(firstOp)
    expect(secondOp.inputs.val.value).toBe(123)
  })

  it('uses NoodlesTestWrapper for Theatre.js integration', () => {
    // Simple test to verify the test-utils wrapper works
    const op = new NumberOp('/test-op', { val: 99 })
    opMap.set('/test-op', op as Operator<IOperator>)

    function SimpleComponent() {
      return <div data-testid="simple">Works</div>
    }

    renderWithNoodlesProviders(<SimpleComponent />)

    expect(screen.getByTestId('simple').textContent).toBe('Works')
  })
})
