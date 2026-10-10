// Tests for the TableEditorOp node's local schema state
import { act, cleanup, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectModificationActionsProvider } from '../../contexts/project-modification-actions-context'
import type { TableEditorOp } from '../../operators'
import { clearOps, getOp } from '../../store'
import type { TableSchema } from '../../table-schema'
import { transformGraph } from '../../transform-graph'
import { nodeComponents, resolveTableEditorSchema } from '../op-components'

const cityData = [{ city: 'Los Angeles' }]
const editedSchema: TableSchema = {
  columns: [{ id: 'city', name: 'metro', type: 'string', defaultValue: '' }],
}

function renderTableEditorNode(id: string) {
  const TableEditorComponent = nodeComponents.TableEditorOp
  return render(
    <ProjectModificationActionsProvider updateOperatorId={vi.fn()}>
      <ReactFlowProvider>
        <TableEditorComponent
          id={id}
          type="TableEditorOp"
          selected={false}
          data={{ inputs: {} }}
          isConnectable={true}
          zIndex={0}
          dragging={false}
        />
      </ReactFlowProvider>
    </ProjectModificationActionsProvider>
  )
}

describe('resolveTableEditorSchema', () => {
  it('prefers a valid local snapshot', () => {
    expect(resolveTableEditorSchema(editedSchema, cityData)).toBe(editedSchema)
  })

  it('infers columns when the snapshot is unset', () => {
    expect(resolveTableEditorSchema(null, cityData)).toEqual({
      columns: [{ name: 'city', type: 'string', defaultValue: '' }],
    })
  })

  it('infers columns when the snapshot is malformed', () => {
    expect(resolveTableEditorSchema({ columns: [{ name: 'city' }] }, cityData)).toEqual({
      columns: [{ name: 'city', type: 'string', defaultValue: '' }],
    })
  })
})

describe('TableEditorOpComponent schema state', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('re-infers columns when an undo clears the local schema', () => {
    transformGraph({
      nodes: [
        {
          id: '/table',
          type: 'TableEditorOp',
          position: { x: 0, y: 0 },
          data: { inputs: { data: cityData } },
        },
      ],
      edges: [],
    })
    const op = getOp('/table') as unknown as TableEditorOp
    renderTableEditorNode('/table')

    expect(screen.getByText('city')).toBeDefined()

    // First schema edit renames the inferred column and remaps its rows
    act(() => {
      op.inputs.schema.setValue(editedSchema)
      op.inputs.data.setValue([{ metro: 'Los Angeles' }])
    })
    expect(screen.getByText('metro')).toBeDefined()

    // Undo restores rows before clearing the schema, matching applyOperatorInputs order
    act(() => {
      op.inputs.data.setValue(cityData)
      op.inputs.schema.setValue(null)
    })
    expect(screen.getByText('city')).toBeDefined()
    expect(screen.queryByText('metro')).toBeNull()
  })
})
