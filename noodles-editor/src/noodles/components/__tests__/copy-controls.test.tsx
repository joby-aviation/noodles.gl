// Component-level tests for CopyControls verifying that copy uses graphRef
// to access out-of-scope container children. These tests would FAIL if someone
// reverted the graphRef wiring and relied solely on toObject()/getNodes().
import { act, render } from '@testing-library/react'
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { createRef, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOps } from '../../store'
import { transformGraph } from '../../transform-graph'
import type { GraphRef } from '../../types'
import { CopyControls, type CopyControlsRef } from '../copy-controls'
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
    <ReactFlow nodes={displayedNodes} edges={displayedEdges}>
      <CopyControls graphRef={graphRef} ref={copyRef} />
    </ReactFlow>
  )
}

describe('CopyControls — graphRef integration', () => {
  beforeEach(() => {
    clearOps()
    lastClipboardData = null
    mockClipboardWrite.mockClear()
  })

  afterEach(() => {
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
    transformGraph({ nodes: allNodes, edges: internalEdges })

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

    transformGraph({ nodes: allNodes, edges: allEdges })

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

    transformGraph({ nodes: allNodes, edges: allEdges })

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
})
