import { cleanup, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectModificationActionsProvider } from '../../contexts/project-modification-actions-context'
import type { TableEditorOp } from '../../operators'
import { clearOps, getOp } from '../../store'
import { transformGraph } from '../../transform-graph'
import { nodeComponents } from '../op-components'

describe('TableEditorOpComponent', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('renders its data input handle without hiding the table editor', () => {
    const schema = {
      columns: [{ name: 'Location', type: 'string' as const, defaultValue: '' }],
    }
    const rows = [{ Location: 'New York' }]
    const edge = {
      id: '/source.out.data->/table.par.data',
      source: '/source',
      sourceHandle: 'out.data',
      target: '/table',
      targetHandle: 'par.data',
    }
    transformGraph({
      nodes: [
        {
          id: '/source',
          type: 'TableEditorOp',
          position: { x: -500, y: 0 },
          data: { inputs: { data: rows, schema } },
        },
        {
          id: '/table',
          type: 'TableEditorOp',
          position: { x: 0, y: 0 },
          data: { inputs: { schema } },
        },
      ],
      edges: [edge],
    })
    const source = getOp('/source') as TableEditorOp
    source.outputs.data.setValue(rows)

    const TableEditorNode = nodeComponents.TableEditorOp
    const { container } = render(
      <ProjectModificationActionsProvider updateOperatorId={vi.fn()}>
        <ReactFlowProvider>
          <TableEditorNode
            id="/table"
            type="TableEditorOp"
            selected={false}
            data={{ inputs: { schema } }}
            isConnectable
            zIndex={0}
            dragging={false}
          />
        </ReactFlowProvider>
      </ProjectModificationActionsProvider>
    )

    expect(container.querySelector('[data-handleid="par.data"]')).toBeInTheDocument()
    expect(screen.getByText('New York')).toBeInTheDocument()
  })
})
