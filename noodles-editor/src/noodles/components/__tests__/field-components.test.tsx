// Integration tests for field components, especially CodeFieldComponent edge management
import { render } from '@testing-library/react'
import type { Edge, Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeField } from '../../fields'
import type { DuckDbOp } from '../../operators'
import { clearOps, getOp } from '../../store'
import { transformGraph } from '../../transform-graph'
import { CodeFieldComponent } from '../field-components'

// Create a spy that will be used across all tests
const setEdgesSpy = vi.fn()
const getNodeSpy = vi.fn()
const getEdgesSpy = vi.fn(() => [])

// Mock useReactFlow to return our spy
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({
      setEdges: setEdgesSpy,
      getNode: getNodeSpy,
      getEdges: getEdgesSpy,
      setNodes: vi.fn(),
      getNodes: vi.fn(() => []),
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

// Mock CodeiumEditor to avoid loading Monaco in tests
vi.mock('@codeium/react-code-editor', () => ({
  CodeiumEditor: ({ defaultValue }: { defaultValue: string }) => {
    return <textarea data-testid="mock-code-editor" defaultValue={defaultValue} readOnly />
  },
}))

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

describe('CodeFieldComponent edge management', () => {
  beforeEach(() => {
    clearOps()
    // Clear the spy before each test
    setEdgesSpy.mockClear()
    getEdgesSpy.mockClear()
  })

  afterEach(() => {
    clearOps()
  })

  // Helper to setup a graph with operators
  const setupGraph = (nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[]) => {
    return transformGraph({ nodes, edges: [] })
  }

  // Helper to render CodeFieldComponent within the required contexts
  const renderCodeFieldComponent = (field: CodeField, disabled = false) => {
    return render(
      <ReactFlowProvider>
        <div data-node-id={field.op.id}>
          <CodeFieldComponent id={field.pathToProps.join('.')} field={field} disabled={disabled} />
        </div>
      </ReactFlowProvider>
    )
  }

  it('creates ReferenceEdges when field value contains mustache templates', () => {
    const nodes = [
      {
        id: '/bounds',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/duckdb-query',
        type: 'DuckDbOp',
        position: { x: 200, y: 0 },
        data: {
          inputs: {
            query: 'SELECT * FROM data WHERE x = {{./bounds.out.val}}',
          },
        },
      },
    ]

    setupGraph(nodes)

    const queryOp = getOp('/duckdb-query') as DuckDbOp
    expect(queryOp).toBeDefined()

    const queryField = queryOp.inputs.query as CodeField

    renderCodeFieldComponent(queryField)

    // setEdges should have been called during component mount
    expect(setEdgesSpy).toHaveBeenCalled()

    // Get the updater function that was passed to setEdges
    const lastCall = setEdgesSpy.mock.calls[setEdgesSpy.mock.calls.length - 1][0]

    // Call the updater function with an empty edges array
    const newEdges = typeof lastCall === 'function' ? lastCall([]) : []

    // Should have created one ReferenceEdge
    const referenceEdges = newEdges.filter((e: Edge) => e.type === 'ReferenceEdge')
    expect(referenceEdges).toHaveLength(1)
    expect(referenceEdges[0].source).toBe('/bounds')
    expect(referenceEdges[0].sourceHandle).toBe('out.val')
    expect(referenceEdges[0].target).toBe('/duckdb-query')
  })

  it('creates only one ReferenceEdge for multiple references to the same field with different array accessors', () => {
    // This is the key test case: multiple mustache templates with array accessors
    // should create only ONE ReferenceEdge (deduplication happens in getFieldReferences)
    const query = `SELECT * FROM data
WHERE
  bbox.xmin >= {{./bounds.out.bounds.0.0}}
  AND bbox.xmax <= {{./bounds.out.bounds.1.0}}
  AND bbox.ymin >= {{./bounds.out.bounds.0.1}}
  AND bbox.ymax <= {{./bounds.out.bounds.1.1}}`

    const nodes = [
      {
        id: '/bounds',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/duckdb-query',
        type: 'DuckDbOp',
        position: { x: 200, y: 0 },
        data: { inputs: { query } },
      },
    ]

    setupGraph(nodes)

    const queryOp = getOp('/duckdb-query') as DuckDbOp
    const queryField = queryOp.inputs.query as CodeField

    renderCodeFieldComponent(queryField)

    expect(setEdgesSpy).toHaveBeenCalled()

    const lastCall = setEdgesSpy.mock.calls[setEdgesSpy.mock.calls.length - 1][0]
    const newEdges = typeof lastCall === 'function' ? lastCall([]) : []

    const referenceEdges = newEdges.filter((e: Edge) => e.type === 'ReferenceEdge')

    // CRITICAL: Should create only ONE edge, not four!
    expect(referenceEdges).toHaveLength(1)
    expect(referenceEdges[0].sourceHandle).toBe('out.bounds')
    expect(referenceEdges[0].id).toBe('/bounds.out.bounds->/duckdb-query.par.query')
  })

  it('creates multiple ReferenceEdges when templates reference different fields', () => {
    const query = `SELECT * FROM data
WHERE id = {{./source1.out.val}}
  AND name = {{./source2.out.val}}`

    const nodes = [
      {
        id: '/source1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/source2',
        type: 'NumberOp',
        position: { x: 0, y: 100 },
        data: { inputs: { val: 10 } },
      },
      {
        id: '/duckdb-query',
        type: 'DuckDbOp',
        position: { x: 200, y: 0 },
        data: { inputs: { query } },
      },
    ]

    setupGraph(nodes)

    const queryOp = getOp('/duckdb-query') as DuckDbOp
    const queryField = queryOp.inputs.query as CodeField

    renderCodeFieldComponent(queryField)

    expect(setEdgesSpy).toHaveBeenCalled()

    const lastCall = setEdgesSpy.mock.calls[setEdgesSpy.mock.calls.length - 1][0]
    const newEdges = typeof lastCall === 'function' ? lastCall([]) : []

    const referenceEdges = newEdges.filter((e: Edge) => e.type === 'ReferenceEdge')

    // Should create edges for both fields
    expect(referenceEdges).toHaveLength(2)

    const sourceHandles = referenceEdges.map((e: Edge) => e.sourceHandle).sort()
    expect(sourceHandles).toEqual(['out.val', 'out.val'])

    const sources = referenceEdges.map((e: Edge) => e.source).sort()
    expect(sources).toEqual(['/source1', '/source2'])
  })

  it('updates edges when field value changes', () => {
    const initialQuery = 'SELECT {{./source1.out.val}}'

    const nodes = [
      {
        id: '/source1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/source2',
        type: 'NumberOp',
        position: { x: 0, y: 100 },
        data: { inputs: { val: 10 } },
      },
      {
        id: '/duckdb-query',
        type: 'DuckDbOp',
        position: { x: 200, y: 0 },
        data: { inputs: { query: initialQuery } },
      },
    ]

    setupGraph(nodes)

    const queryOp = getOp('/duckdb-query') as DuckDbOp
    const queryField = queryOp.inputs.query as CodeField

    const { rerender } = renderCodeFieldComponent(queryField)

    const initialCallCount = setEdgesSpy.mock.calls.length

    // Update the field value to reference a different field
    queryField.setValue('SELECT {{./source2.out.val}}')

    // Re-render to trigger the effect
    rerender(
      <ReactFlowProvider>
        <div data-node-id={queryField.op.id}>
          <CodeFieldComponent
            id={queryField.pathToProps.join('.')}
            field={queryField}
            disabled={false}
          />
        </div>
      </ReactFlowProvider>
    )

    // setEdges should have been called again after the value change
    expect(setEdgesSpy.mock.calls.length).toBeGreaterThan(initialCallCount)
  })

  it('does not call setEdges excessively on multiple re-renders with same value', () => {
    const query = 'SELECT {{./bounds.out.val}}'

    const nodes = [
      {
        id: '/bounds',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/duckdb-query',
        type: 'DuckDbOp',
        position: { x: 200, y: 0 },
        data: { inputs: { query } },
      },
    ]

    setupGraph(nodes)

    const queryOp = getOp('/duckdb-query') as DuckDbOp
    const queryField = queryOp.inputs.query as CodeField

    const { rerender } = renderCodeFieldComponent(queryField)

    const initialCallCount = setEdgesSpy.mock.calls.length

    // Re-render multiple times without changing the field value
    for (let i = 0; i < 3; i++) {
      rerender(
        <ReactFlowProvider>
          <div data-node-id={queryField.op.id}>
            <CodeFieldComponent
              id={queryField.pathToProps.join('.')}
              field={queryField}
              disabled={false}
            />
          </div>
        </ReactFlowProvider>
      )
    }

    // setEdges should not be called excessively (React should batch/optimize)
    const finalCallCount = setEdgesSpy.mock.calls.length
    expect(finalCallCount - initialCallCount).toBeLessThan(10)
  })
})
