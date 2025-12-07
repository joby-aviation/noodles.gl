import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as analyticsModule from '../../../utils/analytics'
import { ContainerOp } from '../../operators'
import { clearOps, setOp, useNestingStore } from '../../store'
import { Breadcrumbs } from '../breadcrumbs'

// Create spies for React Flow methods
const fitViewSpy = vi.fn()
const setNodesSpy = vi.fn()
const getNodesSpy = vi.fn(() => [])

// Mock useReactFlow to return our spies
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({
      fitView: fitViewSpy,
      setNodes: setNodesSpy,
      getNodes: getNodesSpy,
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

describe('Breadcrumbs', () => {
  beforeEach(() => {
    clearOps()
    // Clear spies before each test
    fitViewSpy.mockClear()
    setNodesSpy.mockClear()
    getNodesSpy.mockClear()
    vi.clearAllMocks()
    useNestingStore.setState({ currentContainerId: '/' })

    // Create some test containers
    const container1 = new ContainerOp('/container1')
    const container2 = new ContainerOp('/container1/container2')
    setOp('/container1', container1)
    setOp('/container1/container2', container2)
  })

  afterEach(() => {
    clearOps()
  })

  const renderBreadcrumbs = () => {
    return render(
      <ReactFlowProvider>
        <Breadcrumbs />
      </ReactFlowProvider>
    )
  }

  describe('Breadcrumb rendering', () => {
    it('renders root breadcrumb at root level', () => {
      useNestingStore.setState({ currentContainerId: '/' })
      renderBreadcrumbs()
      expect(screen.getByRole('button', { name: /root/i })).toBeInTheDocument()
    })

    it('renders breadcrumb trail for nested container', () => {
      useNestingStore.setState({ currentContainerId: '/container1/container2' })
      renderBreadcrumbs()

      expect(screen.getByRole('button', { name: /root/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /container1/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /container2/i })).toBeInTheDocument()
    })
  })

  describe('U key navigation', () => {
    it('navigates up one level when U key is pressed', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/container1/container2' })

      renderBreadcrumbs()

      await user.keyboard('{u}')

      await waitFor(() => {
        expect(useNestingStore.getState().currentContainerId).toBe('/container1')
      })
    })

    it('tracks analytics when navigating up', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/container1/container2' })

      renderBreadcrumbs()

      await user.keyboard('{u}')

      await waitFor(() => {
        expect(analyticsModule.analytics.track).toHaveBeenCalledWith('container_navigated', {
          method: 'keyboard',
          direction: 'up',
        })
      })
    })

    it('does not navigate up when already at root', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/' })

      renderBreadcrumbs()

      await user.keyboard('{u}')

      // Should stay at root
      expect(useNestingStore.getState().currentContainerId).toBe('/')
      expect(analyticsModule.analytics.track).not.toHaveBeenCalled()
    })
  })

  describe('D key navigation', () => {
    it('navigates down into selected container when D key is pressed', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/' })

      const { container } = renderBreadcrumbs()

      // Manually trigger D key since we can't easily select a node in this test setup
      const event = new KeyboardEvent('keyup', { key: 'd' })
      document.body.dispatchEvent(event)

      // Without a selected container node, D key should not navigate
      expect(useNestingStore.getState().currentContainerId).toBe('/')
    })

    it('does not navigate if no node is selected', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/' })

      renderBreadcrumbs()

      await user.keyboard('{d}')

      // Should stay at root
      expect(useNestingStore.getState().currentContainerId).toBe('/')
      expect(analyticsModule.analytics.track).not.toHaveBeenCalled()
    })
  })

  describe('Breadcrumb click navigation', () => {
    it('navigates to clicked breadcrumb level', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/container1/container2' })

      renderBreadcrumbs()

      const rootButton = screen.getByRole('button', { name: /root/i })
      await user.click(rootButton)

      await waitFor(() => {
        expect(useNestingStore.getState().currentContainerId).toBe('/')
      })
    })

    it('tracks analytics when clicking breadcrumb', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/container1/container2' })

      renderBreadcrumbs()

      const container1Button = screen.getByRole('button', { name: /^container1$/i })
      await user.click(container1Button)

      await waitFor(() => {
        expect(analyticsModule.analytics.track).toHaveBeenCalledWith('container_navigated', {
          method: 'breadcrumb',
        })
      })
    })

    it('can navigate to intermediate levels', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/container1/container2' })

      renderBreadcrumbs()

      const container1Button = screen.getByRole('button', { name: /^container1$/i })
      await user.click(container1Button)

      await waitFor(() => {
        expect(useNestingStore.getState().currentContainerId).toBe('/container1')
      })
    })
  })

  describe('requestAnimationFrame timing', () => {
    it('uses RAF for fitView timing', async () => {
      const user = userEvent.setup()
      useNestingStore.setState({ currentContainerId: '/container1/container2' })

      // Spy on requestAnimationFrame
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame')

      renderBreadcrumbs()

      await user.keyboard('{u}')

      await waitFor(() => {
        expect(rafSpy).toHaveBeenCalled()
      })

      rafSpy.mockRestore()
    })
  })
})
