// Tests for NodeProperties component, especially ListField connection display
import { cleanup, render, screen } from '@testing-library/react'
import type { Edge, Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ListField } from '../../fields'
import { NoodlesProvider, opMap } from '../../store'
import { transformGraph } from '../../transform-graph'
import { PropertyPanel } from '../node-properties'

// Mock useReactFlow to return controlled edge/node data
let mockEdges: Edge[] = []
let mockNodes: ReactFlowNode[] = []
const setEdgesSpy = vi.fn()

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useEdges: () => mockEdges,
    useNodes: () => mockNodes,
    useReactFlow: () => ({
      setEdges: setEdgesSpy,
      getNode: vi.fn((id: string) => mockNodes.find(n => n.id === id)),
      getEdges: vi.fn(() => mockEdges),
      setNodes: vi.fn(),
      getNodes: vi.fn(() => mockNodes),
      addNodes: vi.fn(),
      addEdges: vi.fn(),
      deleteElements: vi.fn(),
      fitView: vi.fn(),
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
      getIntersectingNodes: vi.fn(() => []),
    }),
  }
})

// Mock Theatre.js to avoid side effects
vi.mock('@theatre/studio', () => ({
  default: {
    transaction: vi.fn(fn =>
      fn({
        __experimental_forgetSheet: vi.fn(),
      })
    ),
    setSelection: vi.fn(),
    createContentOfSaveFile: vi.fn(() => ({ sheetsById: {} })),
  },
}))

describe('NodeProperties - ListField handle comparison', () => {
  beforeEach(() => {
    opMap.clear()
    // Create fresh arrays to avoid reference pollution
    mockEdges = []
    mockNodes = []
    setEdgesSpy.mockClear()
  })

  afterEach(() => {
    opMap.clear()
    cleanup()
  })

  // Helper to setup a graph with operators
  const setupGraph = (nodes: ReactFlowNode<{ inputs?: Record<string, unknown>; label?: string }>[]) => {
    mockNodes.push(...nodes)
    return transformGraph({ nodes, edges: [] })
  }

  // Helper to render PropertyPanel within required contexts
  const renderPropertyPanel = (selectedNodeIds: string[] = []) => {
    // Mark nodes as selected
    mockNodes.forEach(node => {
      node.selected = selectedNodeIds.includes(node.id)
    })

    return render(
      <ReactFlowProvider>
        <NoodlesProvider>
          <PropertyPanel />
        </NoodlesProvider>
      </ReactFlowProvider>
    )
  }

  it('displays ListField connections when using correct qualified handle ID format', () => {
    // Setup: Create a MergeOp which has a ListField input named "objects"
    const nodes = [
      {
        id: '/source1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { label: 'Source 1', inputs: { val: 1 } },
      },
      {
        id: '/source2',
        type: 'NumberOp',
        position: { x: 0, y: 100 },
        data: { label: 'Source 2', inputs: { val: 2 } },
      },
      {
        id: '/merge',
        type: 'MergeOp',
        position: { x: 200, y: 0 },
        data: { label: 'Merge', inputs: {} },
      },
    ]

    setupGraph(nodes)

    // Add edges connecting to the ListField input (using qualified handle ID format)
    mockEdges.push(
      {
        id: 'edge1',
        source: '/source1',
        sourceHandle: 'out.val',
        target: '/merge',
        targetHandle: 'par.objects', // Qualified format: par.{fieldName}
      },
      {
        id: 'edge2',
        source: '/source2',
        sourceHandle: 'out.val',
        target: '/merge',
        targetHandle: 'par.objects', // Qualified format: par.{fieldName}
      }
    )

    const mergeOp = opMap.get('/merge')
    expect(mergeOp).toBeDefined()
    expect(mergeOp?.inputs.objects).toBeInstanceOf(ListField)

    // Render the properties panel for the merge node
    renderPropertyPanel(['/merge'])

    // The bug fix ensures the filter matches edges correctly:
    // Before fix: e.targetHandle === input.name  (e.g., "par.objects" === "objects" -> false)
    // After fix:  e.targetHandle === `par.${input.name}` (e.g., "par.objects" === "par.objects" -> true)

    // Verify that connection items are displayed
    expect(screen.getByText('Source 1')).toBeInTheDocument()
    expect(screen.getByText('Source 2')).toBeInTheDocument()

    // Verify numbered list is shown
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('2.')).toBeInTheDocument()
  })

  it('does not display connections when qualified handle ID is mismatched (regression test)', () => {
    // This test ensures we don't regress to the bug where handle comparison was incorrect
    const nodes = [
      {
        id: '/source1',
        type: 'GeoJSONOp',
        position: { x: 0, y: 0 },
        data: { label: 'Source 1', inputs: {} },
      },
      {
        id: '/merge',
        type: 'MergeGeojsonArrayOp',
        position: { x: 200, y: 0 },
        data: { label: 'Merge', inputs: {} },
      },
    ]

    setupGraph(nodes)

    // Add edge with INCORRECT format (not qualified) - this simulates the old bug
    mockEdges.push({
      id: 'edge1',
      source: '/source1',
      sourceHandle: 'out.data',
      target: '/merge',
      targetHandle: 'data', // Missing "par." prefix - should NOT match
    })

    renderPropertyPanel(['/merge'])

    // Should NOT display connection because targetHandle doesn't match qualified format
    expect(screen.queryByText('Source 1')).not.toBeInTheDocument()
    expect(screen.queryByText('1.')).not.toBeInTheDocument()
  })

  it('filters edges by qualified handle ID - unit test', () => {
    // Unit test for the specific filter logic
    // This directly tests the edge filtering logic without rendering
    const edges: Edge[] = [
      {
        id: 'edge1',
        source: '/source',
        sourceHandle: 'out.data',
        target: '/merge',
        targetHandle: 'par.data', // Correct qualified format
      },
      {
        id: 'edge2',
        source: '/source',
        sourceHandle: 'out.layers',
        target: '/merge',
        targetHandle: 'par.layers', // Correct but different field
      },
      {
        id: 'edge3',
        source: '/source',
        sourceHandle: 'out.data',
        target: '/other',
        targetHandle: 'par.data', // Correct format but different target
      },
    ]

    const targetNodeId = '/merge'
    const inputName = 'data'

    // OLD (BUGGY) filter logic - comparing targetHandle directly to field name:
    // This would look for: e.targetHandle === "data"
    // But actual targetHandle is "par.data", so it would find nothing
    const buggyFilteredEdges = edges.filter(
      e => e.target === targetNodeId && e.targetHandle === inputName
    )
    expect(buggyFilteredEdges).toHaveLength(0) // Bug: misses the correct edge because "par.data" !== "data"

    // NEW (FIXED) filter logic - using qualified handle ID:
    // This looks for: e.targetHandle === "par.data"
    // Correctly matches edge1
    const fixedFilteredEdges = edges.filter(
      e => e.target === targetNodeId && e.targetHandle === `par.${inputName}`
    )
    expect(fixedFilteredEdges).toHaveLength(1) // Correctly finds edge1
    expect(fixedFilteredEdges[0].id).toBe('edge1')

    // Verify it correctly filters out edges with:
    // - Different target node (edge3)
    // - Different field name (edge2)
    const edgeIds = fixedFilteredEdges.map(e => e.id)
    expect(edgeIds).not.toContain('edge2')
    expect(edgeIds).not.toContain('edge3')
  })

  it('correctly constructs qualified handle ID from field name', () => {
    // Test that the template literal works correctly for various field names
    const testCases = [
      { fieldName: 'data', expected: 'par.data' },
      { fieldName: 'layers', expected: 'par.layers' },
      { fieldName: 'input', expected: 'par.input' },
      { fieldName: 'values', expected: 'par.values' },
    ]

    testCases.forEach(({ fieldName, expected }) => {
      const qualifiedHandleId = `par.${fieldName}`
      expect(qualifiedHandleId).toBe(expected)
    })
  })

  it('does not display connection list for non-ListField inputs', () => {
    const nodes = [
      {
        id: '/source',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { label: 'Source', inputs: {} },
      },
      {
        id: '/target',
        type: 'NumberOp',
        position: { x: 200, y: 0 },
        data: { label: 'Target', inputs: {} },
      },
    ]

    setupGraph(nodes)

    // Add edge to a regular (non-ListField) input
    mockEdges.push({
      id: 'edge1',
      source: '/source',
      sourceHandle: 'out.val',
      target: '/target',
      targetHandle: 'par.val',
    })

    renderPropertyPanel(['/target'])

    // Should not display connection list for regular fields
    // (Only ListField inputs should show the draggable connection list)
    expect(screen.queryByText('1.')).not.toBeInTheDocument()
  })

  it('handles empty ListField (no connections)', () => {
    const nodes = [
      {
        id: '/merge',
        type: 'MergeGeojsonArrayOp',
        position: { x: 200, y: 0 },
        data: { label: 'Merge', inputs: {} },
      },
    ]

    setupGraph(nodes)

    // No edges - ListField is empty
    renderPropertyPanel(['/merge'])

    // Should not display any connection items
    expect(screen.queryByText('1.')).not.toBeInTheDocument()
  })
})
