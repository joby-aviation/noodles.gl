import type { NodeJSON } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Edge } from './noodles'
import type { OpType } from './operators'
import { ContainerOp, GraphInputOp, GraphOutputOp } from './operators'
import { opMap } from './store'
import { transformGraph } from './transform-graph'

describe('Container Integration with Transform Graph', () => {
  beforeEach(() => {
    opMap.clear()
  })

  afterEach(() => {
    opMap.clear()
  })

  it('creates proper connections between containers and child GraphInputOps', () => {
    // Create test nodes with qualified paths
    const nodes: NodeJSON<OpType>[] = [
      {
        id: '/analysis',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/input',
        type: 'GraphInputOp',
        position: { x: 100, y: 100 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/output',
        type: 'GraphOutputOp',
        position: { x: 200, y: 200 },
        data: { inputs: {} },
      },
      {
        id: '/other/input',
        type: 'GraphInputOp',
        position: { x: 300, y: 300 },
        data: { inputs: {} },
      },
    ]

    const edges: Edge[] = []

    // Transform the graph
    const operators = transformGraph({ nodes, edges })

    // Verify operators were created with correct IDs
    expect(operators).toHaveLength(4)
    expect(operators.map(op => op.id)).toContain('/analysis')
    expect(operators.map(op => op.id)).toContain('/analysis/input')
    expect(operators.map(op => op.id)).toContain('/analysis/output')
    expect(operators.map(op => op.id)).toContain('/other/input')

    // Verify the container and its child are in opMap
    const container = opMap.get('/analysis') as ContainerOp
    const childInput = opMap.get('/analysis/input') as GraphInputOp
    const childOutput = opMap.get('/analysis/output') as GraphOutputOp
    const otherInput = opMap.get('/other/input') as GraphInputOp

    expect(container).toBeInstanceOf(ContainerOp)
    expect(childInput).toBeInstanceOf(GraphInputOp)
    expect(childOutput).toBeInstanceOf(GraphOutputOp)
    expect(otherInput).toBeInstanceOf(GraphInputOp)

    // Verify that the container's input is connected to the child's parentValue
    // This connection should be created automatically by transformGraph
    const parentValueField = childInput.inputs.parentValue
    expect(parentValueField.subscriptions.size).toBe(1)

    // The connection should be from the container's 'in' field
    const connectionId = `container_in_to_child_${childInput.id}`
    expect(parentValueField.subscriptions.has(connectionId)).toBe(true)

    // Verify that the other input (not a child of this container) is not connected
    const otherParentValueField = otherInput.inputs.parentValue
    expect(otherParentValueField.subscriptions.size).toBe(0)
  })

  it('handles nested containers correctly', () => {
    const nodes: NodeJSON<OpType>[] = [
      {
        id: '/analysis',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/preprocessing',
        type: 'ContainerOp',
        position: { x: 50, y: 50 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/input',
        type: 'GraphInputOp',
        position: { x: 100, y: 100 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/preprocessing/filter-input',
        type: 'GraphInputOp',
        position: { x: 150, y: 150 },
        data: { inputs: {} },
      },
    ]

    const edges: Edge[] = []

    // Transform the graph
    const operators = transformGraph({ nodes, edges })

    // Verify operators were created
    expect(operators).toHaveLength(4)

    // Get the operators
    const rootContainer = opMap.get('/analysis')
    const nestedContainer = opMap.get('/analysis/preprocessing')
    const rootInput = opMap.get('/analysis/input') as GraphInputOp
    const nestedInput = opMap.get('/analysis/preprocessing/filter-input') as GraphInputOp

    expect(rootContainer).toBeInstanceOf(ContainerOp)
    expect(nestedContainer).toBeInstanceOf(ContainerOp)
    expect(rootInput).toBeInstanceOf(GraphInputOp)
    expect(nestedInput).toBeInstanceOf(GraphInputOp)

    // Verify the root container is connected to its direct child input
    const rootInputParentValue = rootInput.inputs.parentValue
    expect(rootInputParentValue.subscriptions.size).toBe(1)

    // Verify the nested container is connected to its direct child input
    const nestedInputParentValue = nestedInput.inputs.parentValue
    expect(nestedInputParentValue.subscriptions.size).toBe(1)

    // Verify that the nested input is NOT connected to the root container
    // (it should only be connected to its direct parent)
    const rootConnectionId = `container_in_to_child_${rootInput.id}`
    const nestedConnectionId = `container_in_to_child_${nestedInput.id}`
    expect(rootInputParentValue.subscriptions.has(rootConnectionId)).toBe(true)
    expect(nestedInputParentValue.subscriptions.has(nestedConnectionId)).toBe(true)
  })

  it('container execution works with qualified paths', () => {
    const nodes: NodeJSON<OpType>[] = [
      {
        id: '/analysis',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/output',
        type: 'GraphOutputOp',
        position: { x: 100, y: 100 },
        data: { inputs: {} },
      },
    ]

    const edges: Edge[] = []

    // Transform the graph
    transformGraph({ nodes, edges })

    // Get the operators
    const container = opMap.get('/analysis') as ContainerOp
    const output = opMap.get('/analysis/output') as GraphOutputOp

    // Set a value in the GraphOutputOp
    output.outputs.propagatedValue.setValue('container-output-value')

    // Execute the container
    const result = container.execute({ in: null })

    // The container should return the value from its child GraphOutputOp
    expect(result.out).toBe('container-output-value')
  })
})
