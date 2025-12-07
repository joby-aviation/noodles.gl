// Tests for ContainerOpComponent double-click navigation
import { render, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as analyticsModule from '../../../utils/analytics'
import type { ContainerOp } from '../../operators'
import { clearOps, getOp, useNestingStore } from '../../store'
import { transformGraph } from '../../transform-graph'
import { nodeComponents } from '../op-components'

// Create spies for React Flow methods
const fitViewSpy = vi.fn()
const setNodesSpy = vi.fn()

// Mock useReactFlow to return our spies
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({
      fitView: fitViewSpy,
      setNodes: setNodesSpy,
      getNodes: vi.fn(() => []),
      setEdges: vi.fn(),
      getEdges: vi.fn(() => []),
      addNodes: vi.fn(),
      addEdges: vi.fn(),
      deleteElements: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      setCenter: vi.fn(),
      toObject: vi.fn(),
      getZoom: vi.fn(() => 1),
      setViewport: vi.fn(),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      project: vi.fn(),
      screenToFlowPosition: vi.fn(),
      flowToScreenPosition: vi.fn(),
      updateNode: vi.fn(),
      updateNodeData: vi.fn(),
      getNode: vi.fn(),
      getIntersectingNodes: vi.fn(() => []),
    }),
  }
})

// Mock analytics
vi.mock('../../../utils/analytics', () => ({
  analytics: {
    track: vi.fn(),
  },
}))

describe('ContainerOpComponent double-click navigation', () => {
  beforeEach(() => {
    clearOps()
    // Clear spies before each test
    fitViewSpy.mockClear()
    setNodesSpy.mockClear()
    vi.clearAllMocks()
    useNestingStore.setState({ currentContainerId: '/' })
  })

  afterEach(() => {
    clearOps()
  })

  // Helper to setup a graph with operators
  const setupGraph = (nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[]) => {
    return transformGraph({ nodes, edges: [] })
  }

  // Helper to render ContainerOpComponent within ReactFlow
  const renderContainerInFlow = (containerId: string) => {
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
          draggable={true}
          selectable={true}
          deletable={true}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>
    )
  }

  it('navigates into container when double-clicked', async () => {
    const user = userEvent.setup()
    const nodes = [
      {
        id: '/my-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
    ]

    setupGraph(nodes)
    const { container } = renderContainerInFlow('/my-container')

    // Double-click the container node
    const containerElement = container.querySelector('[role="tree"]')
    expect(containerElement).toBeTruthy()

    await user.dblClick(containerElement!)

    await waitFor(() => {
      expect(useNestingStore.getState().currentContainerId).toBe('/my-container')
    })
  })

  it('tracks analytics when double-clicked', async () => {
    const user = userEvent.setup()
    const nodes = [
      {
        id: '/my-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
    ]

    setupGraph(nodes)
    const { container } = renderContainerInFlow('/my-container')

    const containerElement = container.querySelector('[role="tree"]')
    await user.dblClick(containerElement!)

    await waitFor(() => {
      expect(analyticsModule.analytics.track).toHaveBeenCalledWith('container_navigated', {
        method: 'double_click',
      })
    })
  })

  it('uses requestAnimationFrame for fitView timing', async () => {
    const user = userEvent.setup()
    const nodes = [
      {
        id: '/my-container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
    ]

    setupGraph(nodes)

    // Spy on requestAnimationFrame
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

    const { container } = renderContainerInFlow('/my-container')

    const containerElement = container.querySelector('[role="tree"]')
    await user.dblClick(containerElement!)

    await waitFor(() => {
      expect(rafSpy).toHaveBeenCalled()
    })

    rafSpy.mockRestore()
  })
})
