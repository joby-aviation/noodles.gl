// Test for ContainerOpComponent children count reactivity
import { render } from '@testing-library/react'
import type { Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContainerOp } from '../../operators'
import { clearOps, deleteOp, getOp } from '../../store'
import { transformGraph } from '../../transform-graph'
import { nodeComponents } from '../op-components'

describe('ContainerOpComponent children count reactivity', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    clearOps()
  })

  // Helper to setup a graph with operators
  const setupGraph = (nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[]) => {
    return transformGraph({ nodes, edges: [] })
  }

  // Helper to render ContainerOpComponent within the required contexts
  const renderContainerOpComponent = (containerId: string) => {
    const containerOp = getOp(containerId) as ContainerOp
    expect(containerOp).toBeDefined()

    const ContainerComponent = nodeComponents.ContainerOp

    return render(
      <ReactFlowProvider>
        <ContainerComponent
          id={containerId}
          type="ContainerOp"
          selected={false}
          data={{ inputs: {} }}
          isConnectable={true}
          zIndex={0}
          dragging={false}
        />
      </ReactFlowProvider>
    )
  }

  it('displays initial children count of 0 for empty container', () => {
    const nodes = [
      {
        id: '/my-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
    ]

    setupGraph(nodes)

    const { container } = renderContainerOpComponent('/my-container')

    // Should display "Children: 0"
    expect(container.textContent).toContain('Children: 0')
  })

  it('displays correct children count for container with existing children', () => {
    const nodes = [
      {
        id: '/my-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/my-container/child1',
        type: 'NumberOp',
        position: { x: 100, y: 100 },
        data: { inputs: { val: 42 } },
      },
      {
        id: '/my-container/child2',
        type: 'NumberOp',
        position: { x: 100, y: 200 },
        data: { inputs: { val: 100 } },
      },
    ]

    setupGraph(nodes)

    const { container } = renderContainerOpComponent('/my-container')

    // Should display "Children: 2"
    expect(container.textContent).toContain('Children: 2')
  })

  it('updates children count reactively when a new operator is added to the container', () => {
    // Start with container and one child
    const initialNodes = [
      {
        id: '/my-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/my-container/child1',
        type: 'NumberOp',
        position: { x: 100, y: 100 },
        data: { inputs: { val: 42 } },
      },
    ]

    setupGraph(initialNodes)

    const { container, rerender } = renderContainerOpComponent('/my-container')

    // Initial count should be 1
    expect(container.textContent).toContain('Children: 1')

    // Add all nodes including the new child
    const updatedNodes = [
      ...initialNodes,
      {
        id: '/my-container/child2',
        type: 'NumberOp',
        position: { x: 100, y: 200 },
        data: { inputs: { val: 100 } },
      },
    ]

    // Transform the updated graph to add the new operator to the store
    setupGraph(updatedNodes)

    // Re-render to trigger the component update with Zustand subscription
    const ContainerComponent = nodeComponents.ContainerOp
    rerender(
      <ReactFlowProvider>
        <ContainerComponent
          id="/my-container"
          type="ContainerOp"
          selected={false}
          data={{ inputs: {} }}
          isConnectable={true}
          zIndex={0}
          dragging={false}
        />
      </ReactFlowProvider>
    )

    // Count should now be 2 because Zustand store updated
    expect(container.textContent).toContain('Children: 2')
  })

  it('updates children count reactively when an operator is removed from the container', () => {
    const nodes = [
      {
        id: '/my-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/my-container/child1',
        type: 'NumberOp',
        position: { x: 100, y: 100 },
        data: { inputs: { val: 42 } },
      },
      {
        id: '/my-container/child2',
        type: 'NumberOp',
        position: { x: 100, y: 200 },
        data: { inputs: { val: 100 } },
      },
    ]

    setupGraph(nodes)

    const { container, rerender } = renderContainerOpComponent('/my-container')

    // Initial count should be 2
    expect(container.textContent).toContain('Children: 2')

    // Remove a child from the store
    deleteOp('/my-container/child2')

    // Re-render to trigger the component update
    const ContainerComponent = nodeComponents.ContainerOp
    rerender(
      <ReactFlowProvider>
        <ContainerComponent
          id="/my-container"
          type="ContainerOp"
          selected={false}
          data={{ inputs: {} }}
          isConnectable={true}
          zIndex={0}
          dragging={false}
        />
      </ReactFlowProvider>
    )

    // Count should now be 1
    expect(container.textContent).toContain('Children: 1')
  })

  it('does not count operators from other containers or root level', () => {
    const nodes = [
      {
        id: '/my-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/my-container/child1',
        type: 'NumberOp',
        position: { x: 100, y: 100 },
        data: { inputs: { val: 42 } },
      },
      {
        id: '/other-container',
        type: 'ContainerOp',
        position: { x: 300, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/other-container/child1',
        type: 'NumberOp',
        position: { x: 400, y: 100 },
        data: { inputs: { val: 99 } },
      },
      {
        id: '/root-level-op',
        type: 'NumberOp',
        position: { x: 600, y: 0 },
        data: { inputs: { val: 200 } },
      },
    ]

    setupGraph(nodes)

    const { container } = renderContainerOpComponent('/my-container')

    // Should only count its own child, not other containers' children or root-level ops
    expect(container.textContent).toContain('Children: 1')
  })

  it('handles nested containers correctly', () => {
    const nodes = [
      {
        id: '/outer-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/outer-container/inner-container',
        type: 'ContainerOp',
        position: { x: 100, y: 100 },
        data: { inputs: {} },
      },
      {
        id: '/outer-container/inner-container/deep-child',
        type: 'NumberOp',
        position: { x: 200, y: 200 },
        data: { inputs: { val: 42 } },
      },
    ]

    setupGraph(nodes)

    // Outer container should have 1 child (the inner container)
    const { container: outerContainer } = renderContainerOpComponent('/outer-container')
    expect(outerContainer.textContent).toContain('Children: 1')

    // Inner container should have 1 child (the deep child)
    const { container: innerContainer } = renderContainerOpComponent(
      '/outer-container/inner-container'
    )
    expect(innerContainer.textContent).toContain('Children: 1')
  })
})
