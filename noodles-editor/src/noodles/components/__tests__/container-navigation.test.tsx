// Tests for ContainerOpComponent double-click navigation
import { render, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockReactFlow } from '../../../test-utils/react-flow-test-utils'
import * as analyticsModule from '../../../utils/analytics'
import type { ContainerOp } from '../../operators'
import { clearOps, getOp, useNestingStore } from '../../store'
import { transformGraph } from '../../transform-graph'
import { nodeComponents } from '../op-components'

// Initialize React Flow test environment
mockReactFlow()

// Mock analytics
vi.mock('../../../utils/analytics', () => ({
  analytics: {
    track: vi.fn(),
  },
}))

describe('ContainerOpComponent double-click navigation', () => {
  beforeEach(() => {
    clearOps()
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
        <ReactFlow>
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
        </ReactFlow>
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
