import type { NodeJSON } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getExecutor } from './graph-executor'
import type { Edge } from './noodles'
import type { OpType } from './operators'
import {
  type CodeOp,
  ContainerOp,
  GraphInputOp,
  GraphOutputOp,
  type PointOp,
  type ViewerOp,
} from './operators'
import { clearOps, getOp } from './store'
import { transformGraph } from './transform-graph'

describe('Container Integration with Transform Graph', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    clearOps()
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
    const { operators } = transformGraph({ nodes, edges })

    // Verify operators were created with correct IDs
    expect(operators).toHaveLength(4)
    expect(operators.map(op => op.id)).toContain('/analysis')
    expect(operators.map(op => op.id)).toContain('/analysis/input')
    expect(operators.map(op => op.id)).toContain('/analysis/output')
    expect(operators.map(op => op.id)).toContain('/other/input')

    // Verify the container and its child are in opMap
    const container = getOp('/analysis') as ContainerOp
    const childInput = getOp('/analysis/input') as GraphInputOp
    const childOutput = getOp('/analysis/output') as GraphOutputOp
    const otherInput = getOp('/other/input') as GraphInputOp

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
    const { operators } = transformGraph({ nodes, edges })

    // Verify operators were created
    expect(operators).toHaveLength(4)

    // Get the operators
    const rootContainer = getOp('/analysis')
    const nestedContainer = getOp('/analysis/preprocessing')
    const rootInput = getOp('/analysis/input') as GraphInputOp
    const nestedInput = getOp('/analysis/preprocessing/filter-input') as GraphInputOp

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
    const container = getOp('/analysis') as ContainerOp
    const output = getOp('/analysis/output') as GraphOutputOp

    // Set a value in the GraphOutputOp
    output.outputs.propagatedValue.setValue('container-output-value')

    // Execute the container
    const result = container.execute({ in: null })

    // The container should return the value from its child GraphOutputOp
    expect(result.out).toBe('container-output-value')
  })

  it('pulls the child GraphOutput before publishing the initial container output', async () => {
    const nodes: NodeJSON<OpType>[] = [
      {
        id: '/analysis',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: { in: 5 } },
      },
      {
        id: '/analysis/input',
        type: 'GraphInputOp',
        position: { x: 100, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/double',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'multiply', b: 2 } },
      },
      {
        id: '/analysis/output',
        type: 'GraphOutputOp',
        position: { x: 300, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/viewer',
        type: 'ViewerOp',
        position: { x: 400, y: 0 },
        data: { inputs: {} },
      },
    ]
    const edges: Edge[] = [
      {
        id: '/analysis/input.out.value->/analysis/double.par.a',
        source: '/analysis/input',
        target: '/analysis/double',
        sourceHandle: 'out.value',
        targetHandle: 'par.a',
      },
      {
        id: '/analysis/double.out.result->/analysis/output.par.value',
        source: '/analysis/double',
        target: '/analysis/output',
        sourceHandle: 'out.result',
        targetHandle: 'par.value',
      },
      {
        id: '/analysis.out.out->/viewer.par.data',
        source: '/analysis',
        target: '/viewer',
        sourceHandle: 'out.out',
        targetHandle: 'par.data',
      },
    ]

    transformGraph({ nodes, edges })
    await getExecutor()!.executeFrame(performance.now())

    const output = getOp('/analysis/output') as GraphOutputOp
    const container = getOp('/analysis') as ContainerOp
    const viewer = getOp('/viewer') as ViewerOp
    expect(output.outputs.propagatedValue.value).toBe(10)
    expect(container.outputs.out.value).toBe(10)
    expect(viewer.inputs.data.value).toBe(10)

    container.inputs.in.setValue(7)
    await getExecutor()!.executeFrame(performance.now())
    expect(output.outputs.propagatedValue.value).toBe(14)
    expect(container.outputs.out.value).toBe(14)
    expect(viewer.inputs.data.value).toBe(14)
  })

  it('pulls an upstream container input before executing the child graph on first load', async () => {
    const nodes: NodeJSON<OpType>[] = [
      {
        id: '/point',
        type: 'PointOp',
        position: { x: 0, y: 0 },
        data: { inputs: { coordinates: { lng: -117.94, lat: 34.25 } } },
      },
      {
        id: '/analysis',
        type: 'ContainerOp',
        position: { x: 100, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/input',
        type: 'GraphInputOp',
        position: { x: 200, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/read-coordinates',
        type: 'CodeOp',
        position: { x: 300, y: 0 },
        data: { inputs: { code: ['return d.geometry.coordinates'] } },
      },
      {
        id: '/analysis/output',
        type: 'GraphOutputOp',
        position: { x: 400, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/viewer',
        type: 'ViewerOp',
        position: { x: 500, y: 0 },
        data: { inputs: {} },
      },
    ]
    const edges: Edge[] = [
      {
        id: '/point.out.feature->/analysis.par.in',
        source: '/point',
        target: '/analysis',
        sourceHandle: 'out.feature',
        targetHandle: 'par.in',
      },
      {
        id: '/analysis/input.out.value->/analysis/read-coordinates.par.data',
        source: '/analysis/input',
        target: '/analysis/read-coordinates',
        sourceHandle: 'out.value',
        targetHandle: 'par.data',
      },
      {
        id: '/analysis/read-coordinates.out.data->/analysis/output.par.value',
        source: '/analysis/read-coordinates',
        target: '/analysis/output',
        sourceHandle: 'out.data',
        targetHandle: 'par.value',
      },
      {
        id: '/analysis.out.out->/viewer.par.data',
        source: '/analysis',
        target: '/viewer',
        sourceHandle: 'out.out',
        targetHandle: 'par.data',
      },
    ]

    transformGraph({ nodes, edges })
    const executor = getExecutor()!
    executor.stop()

    // Make the upstream value arrive after the child graph would otherwise
    // read PointOp's empty FeatureCollection default. This deterministically
    // reproduces the fresh-load race from the LA scale container.
    const point = getOp('/point') as PointOp
    const executePoint = point.execute.bind(point)
    point.execute = (async inputs => {
      await Promise.resolve()
      await Promise.resolve()
      return executePoint(inputs)
    }) as typeof point.execute

    await executor.executeFrame(performance.now())

    const graphInput = getOp('/analysis/input') as GraphInputOp
    const code = getOp('/analysis/read-coordinates') as CodeOp
    const container = getOp('/analysis') as ContainerOp
    const viewer = getOp('/viewer') as ViewerOp
    expect(executor.getUpstream(graphInput.id)).toContain(point.id)
    expect(code.executionState.value.status).toBe('success')
    expect(container.outputs.out.value).toEqual([-117.94, 34.25])
    expect(viewer.inputs.data.value).toEqual([-117.94, 34.25])

    const edgesWithoutContainerInput = edges.filter(edge => edge.target !== '/analysis')
    transformGraph({ nodes, edges: edgesWithoutContainerInput })

    const operatorDependencies = (
      getOp('/analysis/input') as unknown as {
        _upstreamDependencies: Set<unknown>
      }
    )._upstreamDependencies
    expect(executor.getUpstream(graphInput.id)).not.toContain(point.id)
    expect(operatorDependencies.has(point)).toBe(false)
  })

  it('uses the same GraphOutput for scheduling and execution when a container has multiple', async () => {
    const nodes: NodeJSON<OpType>[] = [
      {
        id: '/analysis',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/selected-output',
        type: 'GraphOutputOp',
        position: { x: 300, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/analysis/other-output',
        type: 'GraphOutputOp',
        position: { x: 300, y: 100 },
        data: { inputs: {} },
      },
      {
        id: '/selected-value',
        type: 'NumberOp',
        position: { x: 100, y: 0 },
        data: { inputs: { val: 10 } },
      },
      {
        id: '/other-value',
        type: 'NumberOp',
        position: { x: 100, y: 100 },
        data: { inputs: { val: 20 } },
      },
      {
        id: '/viewer',
        type: 'ViewerOp',
        position: { x: 400, y: 0 },
        data: { inputs: {} },
      },
    ]
    const edges: Edge[] = [
      {
        id: '/selected-value.out.val->/analysis/selected-output.par.value',
        source: '/selected-value',
        target: '/analysis/selected-output',
        sourceHandle: 'out.val',
        targetHandle: 'par.value',
      },
      {
        id: '/other-value.out.val->/analysis/other-output.par.value',
        source: '/other-value',
        target: '/analysis/other-output',
        sourceHandle: 'out.val',
        targetHandle: 'par.value',
      },
      {
        id: '/analysis.out.out->/viewer.par.data',
        source: '/analysis',
        target: '/viewer',
        sourceHandle: 'out.out',
        targetHandle: 'par.data',
      },
    ]

    transformGraph({ nodes, edges })
    await getExecutor()!.executeFrame(performance.now())

    const container = getOp('/analysis') as ContainerOp
    const viewer = getOp('/viewer') as ViewerOp
    expect(container.outputs.out.value).toBe(10)
    expect(viewer.inputs.data.value).toBe(10)
  })

  describe('Container Custom Field Integration', () => {
    it('GraphInputOp mirrors container custom parameters as outputs', () => {
      const nodes: NodeJSON<OpType>[] = [
        {
          id: '/analysis',
          type: 'ContainerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
            customInputs: [
              { id: '1', name: 'threshold', type: 'number', order: 0, defaultValue: 50 },
              { id: '2', name: 'enabled', type: 'boolean', order: 1, defaultValue: true },
            ],
          },
        },
        {
          id: '/analysis/input',
          type: 'GraphInputOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
      ]

      const edges: Edge[] = []

      // Transform the graph
      transformGraph({ nodes, edges })

      // Get the operators
      const container = getOp('/analysis') as ContainerOp
      const graphInput = getOp('/analysis/input') as GraphInputOp

      // Verify container has custom inputs
      expect(container.customInputDefinitions).toHaveLength(2)
      expect(container.inputs.threshold).toBeDefined()
      expect(container.inputs.enabled).toBeDefined()

      // Verify GraphInputOp has dynamic outputs mirroring container's custom inputs
      expect(graphInput.outputs.value).toBeDefined() // Base output
      expect(graphInput.outputs.threshold).toBeDefined() // Custom output
      expect(graphInput.outputs.enabled).toBeDefined() // Custom output
    })

    it('GraphInputOp inputs are wired to container custom inputs', () => {
      const nodes: NodeJSON<OpType>[] = [
        {
          id: '/analysis',
          type: 'ContainerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
            customInputs: [
              { id: '1', name: 'multiplier', type: 'number', order: 0, defaultValue: 2 },
            ],
          },
        },
        {
          id: '/analysis/input',
          type: 'GraphInputOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
      ]

      const edges: Edge[] = []

      // Transform the graph
      transformGraph({ nodes, edges })

      // Get the operators
      const graphInput = getOp('/analysis/input') as GraphInputOp

      // The GraphInputOp input should be connected to the container input
      const multiplierInput = graphInput.inputs.multiplier
      expect(multiplierInput).toBeDefined()
      expect(multiplierInput.subscriptions.size).toBe(1)

      // Verify the connection exists
      const connectionId = `container_custom_multiplier_to_child_${graphInput.id}`
      expect(multiplierInput.subscriptions.has(connectionId)).toBe(true)
    })

    it('custom parameter values propagate from container to GraphInputOp outputs', () => {
      const nodes: NodeJSON<OpType>[] = [
        {
          id: '/analysis',
          type: 'ContainerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
            customInputs: [
              { id: '1', name: 'multiplier', type: 'number', order: 0, defaultValue: 2 },
            ],
          },
        },
        {
          id: '/analysis/input',
          type: 'GraphInputOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
      ]

      // Transform the graph
      transformGraph({ nodes, edges: [] })

      const container = getOp('/analysis') as ContainerOp
      const graphInput = getOp('/analysis/input') as GraphInputOp

      // Set value on container
      container.inputs.multiplier.setValue(10)

      // Execute GraphInputOp to propagate values
      const result = graphInput.execute(graphInput.data)

      // Verify output has the value
      expect(result.multiplier).toBe(10)
    })

    it('multiple custom fields propagate correctly', () => {
      const nodes: NodeJSON<OpType>[] = [
        {
          id: '/analysis',
          type: 'ContainerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
            customInputs: [
              { id: '1', name: 'threshold', type: 'number', order: 0, defaultValue: 50 },
              { id: '2', name: 'enabled', type: 'boolean', order: 1, defaultValue: true },
              { id: '3', name: 'label', type: 'string', order: 2, defaultValue: 'test' },
            ],
          },
        },
        {
          id: '/analysis/input',
          type: 'GraphInputOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
      ]

      // Transform the graph
      transformGraph({ nodes, edges: [] })

      const container = getOp('/analysis') as ContainerOp
      const graphInput = getOp('/analysis/input') as GraphInputOp

      // Set values on container
      container.inputs.threshold.setValue(75)
      container.inputs.enabled.setValue(false)
      container.inputs.label.setValue('updated')

      // Execute GraphInputOp to propagate values
      const result = graphInput.execute(graphInput.data)

      // Verify all outputs have their values
      expect(result.threshold).toBe(75)
      expect(result.enabled).toBe(false)
      expect(result.label).toBe('updated')
    })

    it('value changes propagate reactively', () => {
      const nodes: NodeJSON<OpType>[] = [
        {
          id: '/analysis',
          type: 'ContainerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
            customInputs: [{ id: '1', name: 'count', type: 'number', order: 0, defaultValue: 0 }],
          },
        },
        {
          id: '/analysis/input',
          type: 'GraphInputOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
      ]

      // Transform the graph
      transformGraph({ nodes, edges: [] })

      const container = getOp('/analysis') as ContainerOp
      const graphInput = getOp('/analysis/input') as GraphInputOp

      // Initial value
      container.inputs.count.setValue(5)
      let result = graphInput.execute(graphInput.data)
      expect(result.count).toBe(5)

      // Change value
      container.inputs.count.setValue(10)
      result = graphInput.execute(graphInput.data)
      expect(result.count).toBe(10)

      // Change again
      container.inputs.count.setValue(100)
      result = graphInput.execute(graphInput.data)
      expect(result.count).toBe(100)
    })

    it('default values are available before explicit setValue', () => {
      const nodes: NodeJSON<OpType>[] = [
        {
          id: '/analysis',
          type: 'ContainerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
            customInputs: [
              { id: '1', name: 'threshold', type: 'number', order: 0, defaultValue: 42 },
            ],
          },
        },
        {
          id: '/analysis/input',
          type: 'GraphInputOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
      ]

      // Transform the graph
      transformGraph({ nodes, edges: [] })

      const graphInput = getOp('/analysis/input') as GraphInputOp

      // Execute GraphInputOp - should get default value from subscription
      const result = graphInput.execute(graphInput.data)

      // Default value should be propagated
      expect(result.threshold).toBe(42)
    })

    it('GraphInputOp updates when container custom fields change', () => {
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
      ]

      const edges: Edge[] = []

      // Transform the graph
      transformGraph({ nodes, edges })

      // Get the operators
      const container = getOp('/analysis') as ContainerOp
      const graphInput = getOp('/analysis/input') as GraphInputOp

      // Initially, GraphInputOp should only have the base output
      expect(Object.keys(graphInput.outputs)).toEqual(['value'])

      // Add a custom field to the container
      container.customInputDefinitions = [
        { id: '1', name: 'newParam', type: 'number', order: 0, defaultValue: 100 },
      ]
      container.rebuildInputs()

      // Retransform to apply changes
      transformGraph({ nodes, edges })

      // Now GraphInputOp should have the new output
      const updatedGraphInput = getOp('/analysis/input') as GraphInputOp
      expect(updatedGraphInput.outputs.newParam).toBeDefined()
    })
  })
})
