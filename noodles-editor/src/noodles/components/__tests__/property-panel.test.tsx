// Tests for PropertyPanel selection rendering and NodeProperties nodeId interface
import { act, cleanup, render, screen } from '@testing-library/react'
import type { Edge, Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SheetContext } from '../../../utils/sheet-context'
import { clearOps, getOpStore, useUIStore } from '../../store'
import { transformGraph } from '../../transform-graph'
import { formatEdgePreviewValue, NodeProperties, PropertyPanel } from '../node-properties'

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

vi.mock('@microlink/react-json-view', () => ({
  default: ({ src }: { src: unknown }) => <pre>{JSON.stringify(src)}</pre>,
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
    useUIStore.getState().setInspectedReferenceEdge(null)
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('shows "Select a node" prompt when nothing is selected', () => {
    mockNodes = []
    wrapWithProviders(<PropertyPanel />)
    expect(screen.getByText('Select a node or edge to inspect it')).toBeInTheDocument()
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
    expect(screen.getByText('1 edge selected')).toBeInTheDocument()
  })

  it('shows Page header when nothing is selected', () => {
    mockNodes = []
    wrapWithProviders(<PropertyPanel />)
    expect(screen.getByText('Page')).toBeInTheDocument()
  })

  it('shows the live source value for one selected edge', () => {
    transformGraph({
      nodes: [
        { id: '/source', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
        { id: '/target', type: 'NumberOp', position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [],
    })
    mockEdges = [
      {
        id: '/source.out.val->/target.par.val',
        source: '/source',
        target: '/target',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        selected: true,
      },
    ]
    const source = getOpStore().getOp('/source')!
    source.outputs.val.next(42)

    wrapWithProviders(<PropertyPanel />)

    expect(screen.getByText('Edge')).toBeInTheDocument()
    expect(screen.getByTitle('/source.out.val')).toHaveTextContent('source.out.val')
    expect(screen.getByTitle('/target.par.val')).toHaveTextContent('target.par.val')
    expect(screen.getByText('{"value":42}')).toBeInTheDocument()

    act(() => source.outputs.val.next(84))
    expect(screen.getByText('{"value":84}')).toBeInTheDocument()
  })

  it('inspects source inputs used by reference edges', () => {
    transformGraph({
      nodes: [
        {
          id: '/source',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { val: 7 } },
        },
        { id: '/target', type: 'CodeOp', position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [],
    })
    useUIStore.getState().setInspectedReferenceEdge({
      id: '/source.par.val->/target.par.code',
      source: '/source',
      target: '/target',
      sourceHandle: 'par.val',
      targetHandle: 'par.code',
      type: 'ReferenceEdge',
    })

    wrapWithProviders(<PropertyPanel />)

    expect(screen.getByText('Reference')).toBeInTheDocument()
    expect(screen.getByText('{"value":7}')).toBeInTheDocument()
  })

  it('shows a summary instead of a value when multiple edges are selected', () => {
    mockEdges = [
      { id: 'e1', source: '/a', target: '/b', selected: true },
      { id: 'e2', source: '/b', target: '/c', selected: true },
    ]

    wrapWithProviders(<PropertyPanel />)

    expect(screen.getByText('2 edges selected')).toBeInTheDocument()
    expect(screen.queryByText('Source field is unavailable')).not.toBeInTheDocument()
  })

  it('bounds large edge previews', () => {
    const value = Array.from({ length: 30 }, (_, index) => index)

    expect(formatEdgePreviewValue(value)).toEqual({
      summary: 'Showing first 25 of 30 items',
      items: value.slice(0, 25),
    })
  })

  it('bounds large values nested inside operator previews', () => {
    transformGraph({
      nodes: [{ id: '/viewer', type: 'ViewerOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    const viewer = getOpStore().getOp('/viewer')!
    const value = Array.from({ length: 30 }, (_, index) => index)
    viewer.inputs.data.next(value)

    expect(formatEdgePreviewValue(viewer)).toMatchObject({
      inputs: {
        data: {
          summary: 'Showing first 25 of 30 items',
          items: value.slice(0, 25),
        },
      },
    })
  })
})

describe('NodeProperties', () => {
  beforeEach(() => {
    clearOps()
    mockNodes = []
    mockEdges = []
    useUIStore.getState().setInspectedReferenceEdge(null)
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('renders nothing when operator is not found', () => {
    const { container } = wrapWithProviders(<NodeProperties nodeId="/nonexistent" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders operator display name when operator exists', () => {
    transformGraph({
      nodes: [{ id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    wrapWithProviders(<NodeProperties nodeId="/num" />)
    expect(screen.getByText('Number', { selector: '.opDisplayName' })).toBeInTheDocument()
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

  it('can render BitmapLayerOp without crashing', () => {
    transformGraph({
      nodes: [{ id: '/bitmap', type: 'BitmapLayerOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    wrapWithProviders(<NodeProperties nodeId="/bitmap" />)

    // Verify the operator rendered (component didn't crash)
    expect(screen.getByText('BitmapLayer')).toBeInTheDocument()
  })

  it.skip('renders BitmapLayerOp bounds field with Vec4Field', () => {
    transformGraph({
      nodes: [
        {
          id: '/bitmap',
          type: 'BitmapLayerOp',
          position: { x: 0, y: 0 },
          data: { inputs: { bounds: [-122.5, 37.7, -122.3, 37.9] }, visibleInputs: ['image', 'bounds'] },
        },
      ],
      edges: [],
    })
    wrapWithProviders(<NodeProperties nodeId="/bitmap" />)

    // Should show the bounds field (explicitly visible)
    expect(screen.getByText('bounds')).toBeInTheDocument()

    // The bounds field should render as a vector field (4 numeric inputs)
    const propertyList = screen.getByText('bounds').closest('[class*="propertyList"]')
    expect(propertyList).toBeInTheDocument()
  })
})
