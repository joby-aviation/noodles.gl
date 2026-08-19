// Integration tests for the CodeField editor's graph ownership boundary.
import { render } from '@testing-library/react'
import type { Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeField } from '../../fields'
import type { CodeOp } from '../../operators'
import { referenceDependencyModel } from '../../reference-dependencies'
import { clearOps, getOp } from '../../store'
import { transformGraph } from '../../transform-graph'
import { CodeFieldComponent } from '../field-components'

const setEdgesSpy = vi.fn()
const getNodeSpy = vi.fn()
const getEdgesSpy = vi.fn(() => [])

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

vi.mock('@codeium/react-code-editor', () => ({
  CodeiumEditor: ({ defaultValue }: { defaultValue: string }) => (
    <textarea data-testid="mock-code-editor" defaultValue={defaultValue} readOnly />
  ),
}))

describe('CodeFieldComponent reference ownership', () => {
  beforeEach(() => {
    clearOps()
    setEdgesSpy.mockClear()
    getEdgesSpy.mockClear()
  })

  afterEach(() => {
    referenceDependencyModel.reset()
    clearOps()
  })

  it('never synchronizes reference edges into React Flow state', () => {
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
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
        id: '/code',
        type: 'CodeOp',
        position: { x: 200, y: 0 },
        data: { inputs: { code: 'return op("./source1").out.val' } },
      },
    ]

    transformGraph({ nodes: nodes as never, edges: [] })
    const codeOp = getOp('/code') as CodeOp
    const codeField = codeOp.inputs.code as CodeField

    const { rerender } = render(
      <ReactFlowProvider>
        <div data-node-id={codeField.op.id}>
          <CodeFieldComponent id="code" field={codeField} disabled={false} />
        </div>
      </ReactFlowProvider>
    )

    expect(referenceDependencyModel.getSnapshot()).toHaveLength(1)
    expect(setEdgesSpy).not.toHaveBeenCalled()

    codeField.setValue('return op("./source2").out.val')
    rerender(
      <ReactFlowProvider>
        <div data-node-id={codeField.op.id}>
          <CodeFieldComponent id="code" field={codeField} disabled={false} />
        </div>
      </ReactFlowProvider>
    )

    expect(referenceDependencyModel.getSnapshot()[0].source).toBe('/source2')
    expect(setEdgesSpy).not.toHaveBeenCalled()
  })
})
