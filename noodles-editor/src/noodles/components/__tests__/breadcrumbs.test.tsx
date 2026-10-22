import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  const renderBreadcrumbs = (projectName?: string) => {
    return render(
      <ReactFlowProvider>
        <Breadcrumbs projectName={projectName} />
      </ReactFlowProvider>
    )
  }

  describe('Breadcrumb rendering', () => {
    it('renders root breadcrumb at root level', () => {
      useNestingStore.setState({ currentContainerId: '/' })
      renderBreadcrumbs('root')
      expect(screen.getByRole('button', { name: /root/i })).toBeInTheDocument()
    })

    it('renders breadcrumb trail for nested container', () => {
      useNestingStore.setState({ currentContainerId: '/container1/container2' })
      renderBreadcrumbs('root')

      expect(screen.getAllByRole('button', { name: /root/i })[0]).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /container1/i })[0]).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /container2/i })[0]).toBeInTheDocument()
    })
  })
})
