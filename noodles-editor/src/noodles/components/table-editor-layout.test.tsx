import 'primereact/resources/themes/viva-dark/theme.css'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableEditorOp } from '../operators'
import type { TableSchema } from '../table-schema'
import { TableEditor } from './table-editor'

describe('TableEditor layout', () => {
  afterEach(cleanup)

  it('keeps the table and row dimensions stable when an empty cell enters edit mode', () => {
    const schema: TableSchema = {
      columns: [
        { name: 'name', type: 'string', defaultValue: '' },
        { name: 'notes', type: 'string', defaultValue: '' },
        { name: 'address', type: 'string', defaultValue: '' },
      ],
    }

    const { getByText } = render(
      <TableEditor
        op={new TableEditorOp('/test-table')}
        data={[{ name: 'Opa Locka Airport', notes: '', address: '4201 NW 42nd Ave' }]}
        schema={schema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
      />
    )

    const cell = getByText('Opa Locka Airport')
    const row = cell.closest('tr')
    const table = cell.closest('table')
    expect(row).not.toBeNull()
    expect(table).not.toBeNull()
    const emptyCell = row?.cells[2].querySelector('[tabindex="0"]')
    expect(emptyCell).not.toBeNull()

    const rowRect = row?.getBoundingClientRect()
    const tableRect = table?.getBoundingClientRect()
    const columnWidths = Array.from(
      row?.cells ?? [],
      tableCell => tableCell.getBoundingClientRect().width
    )

    fireEvent.click(emptyCell as HTMLElement)

    expect(row?.getBoundingClientRect().height).toBe(rowRect?.height)
    expect(table?.getBoundingClientRect().width).toBe(tableRect?.width)
    expect(
      Array.from(row?.cells ?? [], tableCell => tableCell.getBoundingClientRect().width)
    ).toEqual(columnWidths)
  })

  it('keeps compound editors within narrow cell bounds', () => {
    const schema: TableSchema = {
      columns: [{ name: 'vector', type: 'vec3', defaultValue: [0, 0, 0] }],
    }

    const { container, getByText } = render(
      <div style={{ width: 160 }}>
        <TableEditor
          op={new TableEditorOp('/test-table')}
          data={[{ vector: [1, 2, 3] }]}
          schema={schema}
          onDataChange={vi.fn()}
          onSchemaChange={vi.fn()}
        />
      </div>
    )

    fireEvent.click(getByText('[1.00, 2.00, 3.00]'))

    const inputs = container.querySelectorAll('input.p-inputtext')
    expect(inputs).toHaveLength(3)
    const compoundEditor = inputs[0].parentElement
    expect(compoundEditor).not.toBeNull()
    expect(compoundEditor?.scrollWidth).toBeLessThanOrEqual(compoundEditor?.clientWidth ?? 0)
  })
})
