// Tests for context menu actions in NodeProperties
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Edge } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOps, getOp } from '../../store'
import { transformGraph } from '../../transform-graph'
import { NodeProperties } from '../node-properties'

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
    useStore: (selector: (state: { nodes: unknown[]; edges: Edge[] }) => unknown) =>
      selector({ nodes: [], edges: mockEdges }),
  }
})

vi.mock('../node-properties.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => prop }),
}))

vi.mock('../menu.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => prop }),
}))

const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue(''),
}
vi.stubGlobal('navigator', {
  ...navigator,
  clipboard: mockClipboard,
})

const renderNodeProperties = (nodeId: string) => {
  return render(
    <ReactFlowProvider>
      <NodeProperties nodeId={nodeId} />
    </ReactFlowProvider>
  )
}

const openContextMenuOnField = (fieldName: string) => {
  const label = screen.getByText(fieldName, { selector: 'span' })
  const listItem = label.closest('[role="listitem"]')
  expect(listItem).toBeInTheDocument()
  fireEvent.contextMenu(listItem!)
}

// The property row also renders a "Hide field"/"Show field" icon button, so
// context menu items must be queried within the menu itself to avoid ambiguity.
const getContextMenu = () => {
  const menu = document.querySelector('.contextMenu')
  expect(menu).toBeInTheDocument()
  return menu as HTMLElement
}

describe('Context menu copy actions', () => {
  beforeEach(() => {
    clearOps()
    mockEdges = []
    mockClipboard.writeText.mockClear()
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('disables "Copy value" for non-value fields (e.g., data)', () => {
    transformGraph({
      nodes: [{ id: '/layer', type: 'ScatterplotLayerOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    renderNodeProperties('/layer')
    openContextMenuOnField('data')

    expect(screen.getByText('Copy value')).toBeDisabled()
  })

  it('enables "Copy value" for value fields with data', () => {
    transformGraph({
      nodes: [
        {
          id: '/geo',
          type: 'GeoJsonLayerOp',
          position: { x: 0, y: 0 },
          data: { inputs: { opacity: 0.5 } },
        },
      ],
      edges: [],
    })
    renderNodeProperties('/geo')
    openContextMenuOnField('opacity')

    expect(screen.getByText('Copy value')).not.toBeDisabled()
  })

  it('clicking "Copy value" writes to clipboard', () => {
    transformGraph({
      nodes: [
        {
          id: '/geo',
          type: 'GeoJsonLayerOp',
          position: { x: 0, y: 0 },
          data: { inputs: { opacity: 0.5 } },
        },
      ],
      edges: [],
    })
    renderNodeProperties('/geo')
    openContextMenuOnField('opacity')
    fireEvent.click(screen.getByText('Copy value'))

    expect(mockClipboard.writeText).toHaveBeenCalledWith('0.5')
  })

  it('clicking "Copy reference" writes absolute code ref to clipboard', () => {
    transformGraph({
      nodes: [
        {
          id: '/geo',
          type: 'GeoJsonLayerOp',
          position: { x: 0, y: 0 },
          data: { inputs: { opacity: 0.5 } },
        },
      ],
      edges: [],
    })
    renderNodeProperties('/geo')
    openContextMenuOnField('opacity')

    fireEvent.click(screen.getByText('Copy reference'))

    expect(mockClipboard.writeText).toHaveBeenCalledWith("op('/geo').par.opacity")
  })
})

describe('Context menu Sequence/Make static', () => {
  beforeEach(() => {
    clearOps()
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('shows "Sequence" for animatable fields without keyframes', () => {
    transformGraph({
      nodes: [
        {
          id: '/geo',
          type: 'GeoJsonLayerOp',
          position: { x: 0, y: 0 },
          data: { inputs: { opacity: 0.5 } },
        },
      ],
      edges: [],
    })
    renderNodeProperties('/geo')
    openContextMenuOnField('opacity')

    expect(screen.getByText('Sequence')).toBeInTheDocument()
    expect(screen.queryByText('Make static')).not.toBeInTheDocument()
  })

  it('disables "Sequence" for non-animatable fields (connected)', () => {
    const edges: Edge[] = [
      {
        id: '/src.out.val->/geo.par.opacity',
        source: '/src',
        target: '/geo',
        sourceHandle: 'out.val',
        targetHandle: 'par.opacity',
      },
    ]
    transformGraph({
      nodes: [
        { id: '/src', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { val: 0.5 } } },
        { id: '/geo', type: 'GeoJsonLayerOp', position: { x: 100, y: 0 }, data: {} },
      ],
      edges,
    })
    mockEdges = edges
    renderNodeProperties('/geo')
    openContextMenuOnField('opacity')

    expect(screen.getByText('Sequence')).toBeDisabled()
  })
})

describe('Context menu Hide/Show field', () => {
  beforeEach(() => {
    clearOps()
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('shows "Hide field" for visible fields', () => {
    transformGraph({
      nodes: [{ id: '/deck', type: 'DeckRendererOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    renderNodeProperties('/deck')
    openContextMenuOnField('layers')

    expect(within(getContextMenu()).getByRole('button', { name: 'Hide field' })).toBeInTheDocument()
  })

  it('shows "Show field" for hidden fields', () => {
    transformGraph({
      nodes: [{ id: '/deck', type: 'DeckRendererOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    renderNodeProperties('/deck')
    // 'effects' is hidden by default on DeckRendererOp
    openContextMenuOnField('effects')

    expect(within(getContextMenu()).getByRole('button', { name: 'Show field' })).toBeInTheDocument()
  })

  it('disables "Hide field" when field has an incoming connection', () => {
    const edges: Edge[] = [
      {
        id: '/src.out.val->/deck.par.layers',
        source: '/src',
        target: '/deck',
        sourceHandle: 'out.val',
        targetHandle: 'par.layers',
      },
    ]
    transformGraph({
      nodes: [
        { id: '/src', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
        { id: '/deck', type: 'DeckRendererOp', position: { x: 100, y: 0 }, data: {} },
      ],
      edges,
    })
    mockEdges = edges
    renderNodeProperties('/deck')
    openContextMenuOnField('layers')

    expect(within(getContextMenu()).getByRole('button', { name: 'Hide field' })).toBeDisabled()
  })

  it('clicking "Show field" makes the field visible', () => {
    transformGraph({
      nodes: [{ id: '/deck', type: 'DeckRendererOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    renderNodeProperties('/deck')

    const op = getOp('/deck')!
    expect(op.isFieldVisible('effects')).toBe(false)

    openContextMenuOnField('effects')
    fireEvent.click(within(getContextMenu()).getByRole('button', { name: 'Show field' }))

    expect(op.isFieldVisible('effects')).toBe(true)
  })

  it('clicking "Hide field" hides a field without custom value', () => {
    transformGraph({
      nodes: [
        {
          id: '/deck',
          type: 'DeckRendererOp',
          position: { x: 0, y: 0 },
          data: { visibleInputs: ['layers', 'views', 'basemap', 'effects'] },
        },
      ],
      edges: [],
    })
    renderNodeProperties('/deck')

    const op = getOp('/deck')!
    expect(op.isFieldVisible('effects')).toBe(true)

    openContextMenuOnField('effects')
    fireEvent.click(within(getContextMenu()).getByRole('button', { name: 'Hide field' }))

    expect(op.isFieldVisible('effects')).toBe(false)
  })
})

describe('Context menu on output fields', () => {
  beforeEach(() => {
    clearOps()
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('does not show input-only actions for output fields', () => {
    transformGraph({
      nodes: [{ id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    renderNodeProperties('/num')

    // Right-click on the output field "val"
    const label = screen.getAllByText('val').find(el => {
      const listItem = el.closest('[role="listitem"]')
      return listItem?.querySelector('[class*="outputRow"]')
    })
    expect(label).toBeDefined()
    fireEvent.contextMenu(label!.closest('[role="listitem"]')!)

    // Input-only actions should not be present
    const menu = within(getContextMenu())
    expect(menu.queryByRole('button', { name: 'Hide field' })).not.toBeInTheDocument()
    expect(menu.queryByRole('button', { name: 'Show field' })).not.toBeInTheDocument()
    expect(menu.queryByText('Sequence')).not.toBeInTheDocument()
    expect(menu.queryByText('Reset to default')).not.toBeInTheDocument()
    expect(menu.queryByText('Disconnect all inputs')).not.toBeInTheDocument()

    // Copy actions should still be present
    expect(menu.getByText('Copy value')).toBeInTheDocument()
    expect(menu.getByText('Copy reference')).toBeInTheDocument()
  })
})

describe('Context menu Disconnect all inputs', () => {
  beforeEach(() => {
    clearOps()
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('disables "Disconnect all inputs" for non-ListField fields', () => {
    transformGraph({
      nodes: [
        {
          id: '/geo',
          type: 'GeoJsonLayerOp',
          position: { x: 0, y: 0 },
          data: { inputs: { opacity: 0.5 } },
        },
      ],
      edges: [],
    })
    renderNodeProperties('/geo')
    openContextMenuOnField('opacity')

    expect(screen.getByText('Disconnect all inputs')).toBeDisabled()
  })

  it('disables "Disconnect all inputs" for ListField without connections', () => {
    transformGraph({
      nodes: [{ id: '/deck', type: 'DeckRendererOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    renderNodeProperties('/deck')
    openContextMenuOnField('layers')

    expect(screen.getByText('Disconnect all inputs')).toBeDisabled()
  })

  it('enables "Disconnect all inputs" for ListField with connections', () => {
    const edges: Edge[] = [
      {
        id: '/src.out.val->/deck.par.layers',
        source: '/src',
        target: '/deck',
        sourceHandle: 'out.val',
        targetHandle: 'par.layers',
      },
    ]
    transformGraph({
      nodes: [
        { id: '/src', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
        { id: '/deck', type: 'DeckRendererOp', position: { x: 100, y: 0 }, data: {} },
      ],
      edges,
    })
    mockEdges = edges
    renderNodeProperties('/deck')
    openContextMenuOnField('layers')

    expect(screen.getByText('Disconnect all inputs')).not.toBeDisabled()
  })
})

describe('Context menu expression actions', () => {
  beforeEach(() => {
    clearOps()
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('shows "Edit expression" for drivable fields and enters expression mode', () => {
    transformGraph({
      nodes: [{ id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    renderNodeProperties('/num')
    // NumberOp has both an input and an output named 'val'; inputs render first
    const label = screen.getAllByText('val', { selector: 'span' })[0]
    fireEvent.contextMenu(label.closest('[role="listitem"]')!)

    const item = screen.getByText('Edit expression')
    expect(item).not.toBeDisabled()
    fireEvent.click(item)

    expect(getOp('/num')?.inputs.val.expression).toEqual('0')
  })

  it('shows "Remove expression" for driven fields and exits keeping the value', () => {
    transformGraph({
      nodes: [{ id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
    const field = getOp('/num')!.inputs.val
    field.setExpression('40 + 2')
    renderNodeProperties('/num')
    // NumberOp has both an input and an output named 'val'; inputs render first
    const label = screen.getAllByText('val', { selector: 'span' })[0]
    fireEvent.contextMenu(label.closest('[role="listitem"]')!)

    fireEvent.click(screen.getByText('Remove expression'))

    expect(field.expression).toBeNull()
    expect(field.value).toEqual(42)
  })

  it('disables the expression item for connected fields', () => {
    const edges = [
      {
        id: '/src.out.val->/num.par.val',
        source: '/src',
        target: '/num',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
      },
    ]
    transformGraph({
      nodes: [
        { id: '/src', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
        { id: '/num', type: 'NumberOp', position: { x: 100, y: 0 }, data: {} },
      ],
      edges,
    })
    mockEdges = edges
    renderNodeProperties('/num')
    // NumberOp has both an input and an output named 'val'; inputs render first
    const label = screen.getAllByText('val', { selector: 'span' })[0]
    fireEvent.contextMenu(label.closest('[role="listitem"]')!)

    expect(screen.getByText('Edit expression')).toBeDisabled()
  })
})
