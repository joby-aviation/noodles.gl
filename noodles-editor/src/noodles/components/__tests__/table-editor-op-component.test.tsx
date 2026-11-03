// Tests for the TableEditorOp node's local schema state
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectModificationActionsProvider } from '../../contexts/project-modification-actions-context'
import type { TableEditorOp } from '../../operators'
import { clearOps, getOp } from '../../store'
import type { TableSchema } from '../../table-schema'
import { transformGraph } from '../../transform-graph'
import { registerPropertyMutationCallback } from '../../utils/property-history'
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
    registerPropertyMutationCallback(undefined)
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

  it('records connected-data cell edits as compact, mergeable table patches', () => {
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
    op.inputs.data.subscriptions.set('upstream-data', {} as never)
    const mutation = vi.fn()
    registerPropertyMutationCallback(mutation)
    renderTableEditorNode('/table')

    fireEvent.doubleClick(screen.getByText('Los Angeles'))
    const editor = screen.getByRole('textbox')
    fireEvent.change(editor, { target: { value: 'Seattle' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(mutation).toHaveBeenCalledTimes(1)
    const [description, before, after, options] = mutation.mock.calls[0]
    expect(description).toBe('Edit cell city')
    expect(JSON.parse(before)).toMatchObject({ $tableHistory: 1 })
    expect(JSON.parse(after)).toMatchObject({ $tableHistory: 1 })
    expect(options).toEqual({
      mergeKey: 'table-data:/table',
      mergeWindowMs: 1_500,
      mergedDescription: 'Edit table data',
    })
  })
})
