// Component-level tests for CopyControls verifying that copy uses graphRef
// to access out-of-scope container children. These tests would FAIL if someone
// reverted the graphRef wiring and relied solely on toObject()/getNodes().
import { act, cleanup, render, screen } from '@testing-library/react'
import type {
  OnEdgesChange,
  OnNodesChange,
  Edge as ReactFlowEdge,
  Node as ReactFlowNode,
} from '@xyflow/react'
import {
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useStoreApi,
} from '@xyflow/react'
import { createRef, useEffect, useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOps } from '../../store'
import { transformGraph } from '../../transform-graph'
import type { GraphRef } from '../../types'
import {
  ConnectedCopyControls,
  CopyControls,
  type CopyControlsRef,
  parseGraphClipboard,
} from '../copy-controls'
import { UndoRedoHandler, type UndoRedoHandlerRef } from '../UndoRedoHandler'
import '../../operators'

vi.mock('../../globals', () => ({
  projectId: 'test-project',
  safeMode: false,
  IS_PROD: false,
  DEFAULT_LATITUDE: 40.7128,
  DEFAULT_LONGITUDE: -74.006,
}))

// Capture what was written to clipboard
let lastClipboardData: string | null = null
let clipboardWritePromise: Promise<void> | null = null
const mockClipboardWrite = vi.fn((data: any[]) => {
  const item = data[0]
  const blob = item.items['text/plain'] as Blob
  clipboardWritePromise = blob.text().then(text => {
    lastClipboardData = text
  })
  return clipboardWritePromise
})
Object.defineProperty(navigator, 'clipboard', {
  value: { write: mockClipboardWrite },
  writable: true,
  configurable: true,
})
globalThis.ClipboardItem = class MockClipboardItem {
  items: Record<string, Blob>
  constructor(items: Record<string, Blob>) {
    this.items = items
  }
} as any

function makeNode(
  id: string,
  type = 'NumberOp',
  selected = false
): ReactFlowNode<{ inputs: Record<string, unknown> }> {
  return { id, type, position: { x: 0, y: 0 }, data: { inputs: {} }, selected }
}

function makeEdge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string
): ReactFlowEdge {
  return {
    id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  }
}

function loadGraph(nodes: ReactFlowNode[], edges: ReactFlowEdge[]) {
  transformGraph({ nodes: nodes as never, edges: edges as never })
}

function dispatchClipboardEvent(
  target: EventTarget,
  type: 'copy' | 'paste',
  data: Record<string, string> = {}
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (mime: string) => data[mime] ?? '' },
  })
  act(() => target.dispatchEvent(event))
  return event
}

// Test harness: renders CopyControls with a controlled graphRef and ReactFlow state
function CopyControlsHarness({
  displayedNodes,
  displayedEdges,
  fullNodes,
  fullEdges,
  copyRef,
}: {
  displayedNodes: ReactFlowNode[]
  displayedEdges: ReactFlowEdge[]
  fullNodes: ReactFlowNode[]
  fullEdges: ReactFlowEdge[]
  copyRef: React.RefObject<CopyControlsRef | null>
}) {
  const graphRef = useRef({ nodes: fullNodes, edges: fullEdges }) as GraphRef
  graphRef.current = { nodes: fullNodes, edges: fullEdges }

  return (
    <ReactFlow
      nodes={displayedNodes}
      edges={displayedEdges}
      onNodesChange={() => {}}
      onEdgesChange={() => {}}
    >
      <CopyControls graphRef={graphRef} onNodesChange={() => {}} ref={copyRef} />
    </ReactFlow>
  )
}

function ClipboardImportHarness({
  undoRef,
  onNodes,
}: {
  undoRef: React.RefObject<UndoRedoHandlerRef | null>
  onNodes: (nodes: ReactFlowNode[]) => void
}) {
  const [nodes, , onNodesChange] = useNodesState<ReactFlowNode>([])
  const [edges, , onEdgesChange] = useEdgesState<ReactFlowEdge>([])
  const graphRef = useRef({ nodes, edges }) as GraphRef
  graphRef.current = { nodes, edges }

  useEffect(() => onNodes(nodes), [nodes, onNodes])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
    >
      <ReactFlowChangeBridge onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} />
      <ConnectedCopyControls graphRef={graphRef} />
      <UndoRedoHandler ref={undoRef} graphRef={graphRef} />
    </ReactFlow>
  )
}

function ReactFlowChangeBridge({
  onNodesChange,
  onEdgesChange,
}: {
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
}) {
  const store = useStoreApi()
  useLayoutEffect(() => {
    store.setState({ onNodesChange, onEdgesChange })
  }, [onEdgesChange, onNodesChange, store])
  return null
}

describe('CopyControls — graphRef integration', () => {
  beforeEach(() => {
    clearOps()
    lastClipboardData = null
    mockClipboardWrite.mockClear()
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('copy includes container children from graphRef that are NOT in displayed scope', async () => {
    const allNodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      makeNode('/source'),
      makeNode('/container', 'ContainerOp', true), // selected for copy
      makeNode('/container/child1', 'GraphInputOp'),
      makeNode('/container/child2', 'GraphOutputOp'),
      makeNode('/container/worker', 'MathOp'),
      makeNode('/sink'),
    ]
    const internalEdges: ReactFlowEdge[] = [
      makeEdge('/container/child1', 'out.parentValue', '/container/worker', 'par.a'),
    ]

    // Set up operator store so serializeNodes can find ops
    loadGraph(allNodes, internalEdges)

    // Root scope: only root-level nodes visible to ReactFlow
    const displayedNodes = [
      makeNode('/source'),
      makeNode('/container', 'ContainerOp', true),
      makeNode('/sink'),
    ]

    const copyRef = createRef<CopyControlsRef>()

    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={displayedNodes}
          displayedEdges={[]}
          fullNodes={allNodes}
          fullEdges={internalEdges}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )

    // Trigger copy via imperative handle
    act(() => {
      copyRef.current!.copy()
    })

    // Wait for async blob text resolution
    expect(mockClipboardWrite).toHaveBeenCalled()
    await clipboardWritePromise

    // Parse clipboard content
    const clipboardJson = JSON.parse(lastClipboardData!)
    const copiedNodeIds = clipboardJson.nodes.map((n: any) => n.id)

    // Must include container children from graphRef
    expect(copiedNodeIds).toContain('/container')
    expect(copiedNodeIds).toContain('/container/child1')
    expect(copiedNodeIds).toContain('/container/child2')
    expect(copiedNodeIds).toContain('/container/worker')

    // Must include internal edge
    expect(clipboardJson.edges.length).toBeGreaterThan(0)
    const edgeSources = clipboardJson.edges.map((e: any) => e.source)
    expect(edgeSources).toContain('/container/child1')
  })

  it('copy WITHOUT graphRef (simulated) would miss container children', () => {
    // This test documents the bug that graphRef fixes.
    // If doCopy only used toObject() (which returns displayedNodes),
    // children would not be collected because collectContainerChildren
    // searches the fullNodes array (from graphRef.current).

    const allNodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      makeNode('/container', 'ContainerOp', true),
      makeNode('/container/child1', 'GraphInputOp'),
      makeNode('/container/child2', 'GraphOutputOp'),
    ]
    const allEdges: ReactFlowEdge[] = []

    loadGraph(allNodes, allEdges)

    // If graphRef only had the displayed scope (the bug scenario):
    const displayedOnlyNodes = [makeNode('/container', 'ContainerOp', true)]
    const displayedOnlyEdges: ReactFlowEdge[] = []

    const copyRef = createRef<CopyControlsRef>()

    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={displayedOnlyNodes}
          displayedEdges={displayedOnlyEdges}
          fullNodes={displayedOnlyNodes} // Simulating broken state: graphRef = displayed only
          fullEdges={displayedOnlyEdges}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )

    act(() => {
      copyRef.current!.copy()
    })

    // Clipboard is written but children are missing
    if (lastClipboardData) {
      const clipboardJson = JSON.parse(lastClipboardData)
      const copiedNodeIds = clipboardJson.nodes.map((n: any) => n.id)
      // Children NOT collected — this is the bug condition
      expect(copiedNodeIds).not.toContain('/container/child1')
      expect(copiedNodeIds).not.toContain('/container/child2')
    }
  })

  it('copy with nested containers collects all descendants via graphRef', async () => {
    const allNodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      makeNode('/outer', 'ContainerOp', true),
      makeNode('/outer/inner', 'ContainerOp'),
      makeNode('/outer/inner/deep', 'NumberOp'),
      makeNode('/outer/worker', 'MathOp'),
    ]
    const allEdges: ReactFlowEdge[] = []

    loadGraph(allNodes, allEdges)

    const displayedNodes = [makeNode('/outer', 'ContainerOp', true)]

    const copyRef = createRef<CopyControlsRef>()

    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={displayedNodes}
          displayedEdges={[]}
          fullNodes={allNodes}
          fullEdges={allEdges}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )

    act(() => {
      copyRef.current!.copy()
    })

    expect(mockClipboardWrite).toHaveBeenCalled()
    await clipboardWritePromise

    const clipboardJson = JSON.parse(lastClipboardData!)
    const copiedNodeIds = clipboardJson.nodes.map((n: any) => n.id)

    expect(copiedNodeIds).toContain('/outer')
    expect(copiedNodeIds).toContain('/outer/inner')
    expect(copiedNodeIds).toContain('/outer/inner/deep')
    expect(copiedNodeIds).toContain('/outer/worker')
  })

  it('only parses JSON with graph clipboard structure', () => {
    expect(parseGraphClipboard('not json')).toBeUndefined()
    expect(parseGraphClipboard('{"rows":[[1,2]]}')).toBeUndefined()
    expect(parseGraphClipboard('{"nodes":{},"edges":[]}')).toBeUndefined()
    expect(parseGraphClipboard('{"nodes":[{}],"edges":[]}')).toBeUndefined()
    expect(parseGraphClipboard('{"nodes":[],"edges":[]}')).toEqual({ nodes: [], edges: [] })
    const node = { id: '/x', type: 'NumberOp', position: { x: 0, y: 0 } }
    expect(parseGraphClipboard(JSON.stringify({ nodes: [node, node], edges: [] }))).toBeUndefined()
    expect(
      parseGraphClipboard(
        JSON.stringify({ nodes: [node], edges: [{ id: '', source: '/x', target: '/x' }] })
      )
    ).toBeUndefined()
  })

  it('does not invoke graph copy for events owned by a table grid', () => {
    const nodes = [makeNode('/source', 'NumberOp', true)]
    loadGraph(nodes, [])
    const copyRef = createRef<CopyControlsRef>()
    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={nodes}
          displayedEdges={[]}
          fullNodes={nodes}
          fullEdges={[]}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )
    const grid = document.createElement('div')
    grid.dataset.tableEditorGrid = 'true'
    document.body.append(grid)

    const event = dispatchClipboardEvent(grid, 'copy')

    expect(event.defaultPrevented).toBe(false)
    expect(mockClipboardWrite).not.toHaveBeenCalled()
    grid.remove()
  })

  it('does not claim or throw for arbitrary paste text', () => {
    const copyRef = createRef<CopyControlsRef>()
    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={[]}
          displayedEdges={[]}
          fullNodes={[]}
          fullEdges={[]}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )

    const event = dispatchClipboardEvent(window, 'paste', { 'text/plain': 'ordinary text' })
    expect(event.defaultPrevented).toBe(false)

    const tableWithoutCanvasTarget = dispatchClipboardEvent(window, 'paste', {
      'text/plain': 'name\tvalue\nAlpha\t42',
    })
    expect(tableWithoutCanvasTarget.defaultPrevented).toBe(false)
    expect(screen.queryByRole('button', { name: 'Create Table' })).toBeNull()

    const schemaEvent = dispatchClipboardEvent(window, 'paste', {
      'text/plain': JSON.stringify({
        $noodles: 'table-schema',
        version: 1,
        schema: { columns: [{ name: 'value', type: 'number', defaultValue: 0 }] },
      }),
    })
    expect(schemaEvent.defaultPrevented).toBe(false)
    expect(screen.queryByRole('button', { name: 'Create Table' })).toBeNull()
  })

  it('prefers a rich table range over graph JSON in plain text', () => {
    const copyRef = createRef<CopyControlsRef>()
    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={[]}
          displayedEdges={[]}
          fullNodes={[]}
          fullEdges={[]}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )
    const pane = document.querySelector<HTMLElement>('.react-flow__pane')
    expect(pane).not.toBeNull()

    const event = dispatchClipboardEvent(pane!, 'paste', {
      'text/plain': JSON.stringify({ nodes: [], edges: [] }),
      'application/x-noodles-table-range+json': JSON.stringify({
        $noodles: 'table-range',
        version: 1,
        columns: [{ name: 'value', type: 'number', defaultValue: 0 }],
        values: [[1]],
      }),
    })

    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole('button', { name: 'Create Table' })).toBeDefined()
    expect(screen.getByText('1 rows')).toBeDefined()
  })

  it('opens a canvas import for a structured one-cell JSON table', () => {
    const copyRef = createRef<CopyControlsRef>()
    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={[]}
          displayedEdges={[]}
          fullNodes={[]}
          fullEdges={[]}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )
    const pane = document.querySelector<HTMLElement>('.react-flow__pane')
    expect(pane).not.toBeNull()

    const event = dispatchClipboardEvent(pane!, 'paste', {
      'text/plain': JSON.stringify([{ value: 1 }]),
    })

    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole('button', { name: 'Create Table' })).toBeDefined()
    expect(screen.getByLabelText('Column 1 name')).toHaveValue('value')
  })

  it('does not replace a pending canvas import from a dialog paste', () => {
    const copyRef = createRef<CopyControlsRef>()
    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={[]}
          displayedEdges={[]}
          fullNodes={[]}
          fullEdges={[]}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )
    const pane = document.querySelector<HTMLElement>('.react-flow__pane')
    expect(pane).not.toBeNull()
    dispatchClipboardEvent(pane!, 'paste', { 'text/plain': 'name\tvalue\nAlpha\t42' })
    expect(screen.getByLabelText('Column 1 name')).toHaveValue('name')

    const createButton = screen.getByRole('button', { name: 'Create Table' })
    const event = dispatchClipboardEvent(createButton, 'paste', {
      'text/plain': 'replacement\tdata\nBeta\t7',
    })

    expect(event.defaultPrevented).toBe(false)
    expect(screen.getByLabelText('Column 1 name')).toHaveValue('name')
  })

  it('clears empty-canvas eligibility when keyboard focus moves to a control', () => {
    const copyRef = createRef<CopyControlsRef>()
    render(
      <ReactFlowProvider>
        <CopyControlsHarness
          displayedNodes={[]}
          displayedEdges={[]}
          fullNodes={[]}
          fullEdges={[]}
          copyRef={copyRef}
        />
      </ReactFlowProvider>
    )
    const pane = document.querySelector<HTMLElement>('.react-flow__pane')
    expect(pane).not.toBeNull()
    act(() =>
      pane!.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 })
      )
    )
    const toolbarButton = document.createElement('button')
    toolbarButton.textContent = 'Toolbar action'
    document.body.append(toolbarButton)
    act(() => toolbarButton.focus())

    const event = dispatchClipboardEvent(toolbarButton, 'paste', {
      'text/plain': 'name\tvalue\nAlpha\t42',
    })

    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('button', { name: 'Create Table' })).toBeNull()
    toolbarButton.remove()
  })

  it('creates one selected TableEditor through undo-aware node changes', async () => {
    const undoRef = createRef<UndoRedoHandlerRef>()
    let latestNodes: ReactFlowNode[] = []
    let resolveNodeAdded: (() => void) | undefined
    let resolveNodeRemoved: (() => void) | undefined
    const nodeAdded = new Promise<void>(resolve => {
      resolveNodeAdded = resolve
    })
    const nodeRemoved = new Promise<void>(resolve => {
      resolveNodeRemoved = resolve
    })
    let awaitingRemoval = false
    const handleNodes = (nodes: ReactFlowNode[]) => {
      latestNodes = nodes
      if (nodes.length === 1) resolveNodeAdded?.()
      if (awaitingRemoval && nodes.length === 0) resolveNodeRemoved?.()
    }
    render(
      <ReactFlowProvider>
        <ClipboardImportHarness undoRef={undoRef} onNodes={handleNodes} />
      </ReactFlowProvider>
    )

    const pane = document.querySelector<HTMLElement>('.react-flow__pane')
    expect(pane).not.toBeNull()
    vi.spyOn(pane!, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 500,
      bottom: 350,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    })

    const event = dispatchClipboardEvent(pane!, 'paste', {
      'text/plain': 'name\tvalue\nAlpha\t42',
    })
    expect(event.defaultPrevented).toBe(true)
    expect(latestNodes).toHaveLength(0)
    expect(screen.getByText('1 values converted')).toBeDefined()

    act(() => screen.getByRole('button', { name: 'Create Table' }).click())
    await nodeAdded

    expect(latestNodes).toHaveLength(1)
    expect(latestNodes[0]).toMatchObject({
      type: 'TableEditorOp',
      selected: true,
      data: {
        inputs: {
          schema: {
            columns: [
              expect.objectContaining({ name: 'name', type: 'string' }),
              expect.objectContaining({ name: 'value', type: 'number' }),
            ],
          },
          data: [{ name: 'Alpha', value: 42 }],
        },
      },
    })
    expect(latestNodes[0].position).toEqual({ x: 300, y: 200 })

    await vi.waitFor(() => expect(undoRef.current?.canUndo()).toBe(true))
    awaitingRemoval = true
    act(() => undoRef.current?.undo())
    await nodeRemoved
    expect(latestNodes).toHaveLength(0)
  })
})
