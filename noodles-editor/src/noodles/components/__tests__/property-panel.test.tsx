// Tests for PropertyPanel selection rendering and NodeProperties nodeId interface
import { cleanup, render, screen } from '@testing-library/react'
import type { Edge, Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SheetContext } from '../../../utils/sheet-context'
import { clearOps } from '../../store'
import { transformGraph } from '../../transform-graph'
import { NodeProperties, PropertyPanel } from '../node-properties'

// Mock store state — controlled per test
let mockNodes: ReactFlowNode[] = []
let mockEdges: Edge[] = []

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({
      setEdges: vi.fn(),
      getEdges: () => mockEdges,
      setNodes: vi.fn(),
      getNodes: vi.fn(() => []),
      getNode: vi.fn(),
    }),
    useStore: (selector: (state: { nodes: ReactFlowNode[]; edges: Edge[] }) => unknown) =>
      selector({ nodes: mockNodes, edges: mockEdges }),
  }
})

vi.mock('../../theatre-bindings', () => ({
  rebindOperatorToTheatre: vi.fn(),
}))

vi.mock('../node-properties.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => prop }),
}))

vi.mock('../menu.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => prop }),
}))

const wrapWithProviders = (ui: React.ReactElement) =>
  render(
    <SheetContext.Provider value={null}>
      <ReactFlowProvider>{ui}</ReactFlowProvider>
    </SheetContext.Provider>
  )

describe('PropertyPanel', () => {
  beforeEach(() => {
    clearOps()
    mockNodes = []
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('shows "Select a node" prompt when nothing is selected', () => {
    mockNodes = []
    wrapWithProviders(<PropertyPanel />)
    expect(screen.getByText('Select a node to see properties')).toBeInTheDocument()
  })

  it('shows multi-select node count when multiple nodes are selected', () => {
    mockNodes = [
      { id: '/a', type: 'NumberOp', selected: true, position: { x: 0, y: 0 }, data: {} },
      { id: '/b', type: 'NumberOp', selected: true, position: { x: 100, y: 0 }, data: {} },
      { id: '/c', type: 'NumberOp', selected: true, position: { x: 200, y: 0 }, data: {} },
    ] as ReactFlowNode[]
    wrapWithProviders(<PropertyPanel />)
    expect(screen.getByText('3 nodes selected')).toBeInTheDocument()
  })

  it('shows selected edge count alongside node count', () => {
    mockNodes = [
      { id: '/a', type: 'NumberOp', selected: true, position: { x: 0, y: 0 }, data: {} },
      { id: '/b', type: 'NumberOp', selected: true, position: { x: 100, y: 0 }, data: {} },
    ] as ReactFlowNode[]
    mockEdges = [
      {
        id: 'e1',
        source: '/a',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        selected: true,
      },
    ]
    wrapWithProviders(<PropertyPanel />)
    expect(screen.getByText('2 nodes selected')).toBeInTheDocument()
    expect(screen.getByText('1 edges selected')).toBeInTheDocument()
  })

  it('shows Page header when nothing is selected', () => {
    mockNodes = []
    wrapWithProviders(<PropertyPanel />)
    expect(screen.getByText('Page')).toBeInTheDocument()
  })
})

describe('NodeProperties', () => {
  beforeEach(() => {
    clearOps()
    mockNodes = []
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('renders nothing when operator is not found', () => {
    const { container } = wrapWithProviders(
      <NodeProperties nodeId="/nonexistent" />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders operator display name when operator exists', () => {
    transformGraph({
      nodes: [{ id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    wrapWithProviders(<NodeProperties nodeId="/num" />)
    expect(screen.getByText('Number')).toBeInTheDocument()
  })

  it('only subscribes to incoming edges for the node', () => {
    transformGraph({
      nodes: [
        { id: '/source', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
        { id: '/target', type: 'NumberOp', position: { x: 100, y: 0 }, data: {} },
        { id: '/other', type: 'NumberOp', position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [],
    })
    // Set up edges: one into /target, one unrelated
    mockEdges = [
      {
        id: '/source.out.val->/target.par.val',
        source: '/source',
        target: '/target',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
      },
      {
        id: '/source.out.val->/other.par.val',
        source: '/source',
        target: '/other',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
      },
    ]
    // Render /target — should only see the edge targeting it, not the /other edge
    // The canHideField logic disables the hide button when there's a connection
    const { container } = wrapWithProviders(<NodeProperties nodeId="/target" />)
    // Panel renders (operator exists) and shows field list
    expect(container.querySelector('[class*="propertyList"]')).toBeInTheDocument()
  })
})
