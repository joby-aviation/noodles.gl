// Tests for NodeProperties, focused on ListField (multi-input) connection display and
// sidebar drag-to-reorder keeping edge order and field data order in sync
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { Edge } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConcatOp } from '../../operators'
import { clearOps, getOpStore } from '../../store'
import { transformGraph } from '../../transform-graph'
import { NodeProperties } from '../node-properties'

let mockEdges: Edge[] = []
const setEdges = (update: Edge[] | ((edges: Edge[]) => Edge[])) => {
  mockEdges = typeof update === 'function' ? update(mockEdges) : update
}

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({
      setEdges,
      getEdges: () => mockEdges,
      setNodes: vi.fn(),
      getNodes: vi.fn(() => []),
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

const listEdge = (source: string, target = '/concat', targetHandle = 'par.values'): Edge => ({
  id: `${source}.out.val->${target}.${targetHandle}`,
  source,
  target,
  sourceHandle: 'out.val',
  targetHandle,
})

const numberNode = (id: string, val: number) => ({
  id,
  type: 'NumberOp',
  position: { x: 0, y: 0 },
  data: { inputs: { val } },
})

const buildGraph = (edges: Edge[]) => {
  mockEdges = edges
  transformGraph({
    nodes: [
      numberNode('/a', 1),
      numberNode('/b', 2),
      numberNode('/c', 3),
      { id: '/concat', type: 'ConcatOp', position: { x: 0, y: 0 }, data: {} },
    ],
    edges,
  })
}

const renderNodeProperties = (nodeId: string) =>
  render(
    <ReactFlowProvider>
      <NodeProperties nodeId={nodeId} />
    </ReactFlowProvider>
  )

const connectionSources = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.connectionSource')).map(el => el.textContent)

describe('NodeProperties ListField connections', () => {
  beforeEach(() => {
    clearOps()
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('renders connections in edge-array order with qualified handle ids', () => {
    buildGraph([listEdge('/a'), listEdge('/b'), listEdge('/c')])
    const { container } = renderNodeProperties('/concat')

    expect(connectionSources(container)).toEqual(['a.out.val', 'b.out.val', 'c.out.val'])
  })

  it('reflects a different edge order', () => {
    buildGraph([listEdge('/c'), listEdge('/a'), listEdge('/b')])
    const { container } = renderNodeProperties('/concat')

    expect(connectionSources(container)).toEqual(['c.out.val', 'a.out.val', 'b.out.val'])
  })

  it('renders no connection list for a ListField without connections', () => {
    buildGraph([])
    const { container } = renderNodeProperties('/concat')

    expect(container.querySelectorAll('.connectionSource')).toHaveLength(0)
  })

  it('renders no connection list for non-ListField inputs with connections', () => {
    // /a's out.val drives /b's plain NumberField input — not a multi-input
    mockEdges = [
      {
        id: '/a.out.val->/b.par.val',
        source: '/a',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
      },
    ]
    transformGraph({
      nodes: [numberNode('/a', 1), numberNode('/b', 2)],
      edges: mockEdges,
    })
    const { container } = renderNodeProperties('/b')

    expect(container.querySelectorAll('.connectionSource')).toHaveLength(0)
  })

  it('drag-reordering a connection updates edge order and the ListField data order', () => {
    buildGraph([listEdge('/a'), listEdge('/b'), listEdge('/c')])
    const { container } = renderNodeProperties('/concat')

    const list = container.querySelector('[role="list"].connections') as HTMLElement
    const items = Array.from(list.querySelectorAll('.connection')) as HTMLElement[]
    expect(items).toHaveLength(3)

    // Drag the last connection (/c) to the top. handleDragOver normally reorders the DOM
    // during the drag; simulate its end state directly, then drop.
    fireEvent.dragStart(items[2])
    list.insertBefore(items[2], items[0])
    fireEvent.dragEnd(items[2])

    const groupIds = mockEdges
      .filter(e => e.target === '/concat' && e.targetHandle === 'par.values')
      .map(e => e.id)
    expect(groupIds).toEqual([listEdge('/c').id, listEdge('/a').id, listEdge('/b').id])

    // The derived slot caches are renormalized in the same update
    expect(mockEdges.map(e => e.data?.orderIndex)).toEqual([0, 1, 2])

    // The operator's actual data order follows the new edge order (connection ids are
    // the order source; values stay at defaults here since the executor doesn't run)
    const concat = getOpStore().getOp('/concat') as ConcatOp
    expect(Array.from(concat.inputs.values.fields.keys())).toEqual([
      listEdge('/c').id,
      listEdge('/a').id,
      listEdge('/b').id,
    ])
  })
})
