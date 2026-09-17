import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableEditorOp } from '../operators'
import type { TableSchema } from '../table-schema'
import { TableEditor } from './table-editor'

describe('TableEditor row virtualization in Chromium', () => {
  afterEach(cleanup)

  it('keeps a 300px viewport bounded and keyboard-navigates to the final row', async () => {
    const schema: TableSchema = {
      columns: [{ name: 'label', type: 'string', defaultValue: '' }],
    }
    const data = Array.from({ length: 1_000 }, (_, index) => ({ label: `Row ${index + 1}` }))

    render(
      <div style={{ width: 600, height: 300 }}>
        <TableEditor
          op={new TableEditorOp('/real-virtual-table')}
          data={data}
          schema={schema}
          onDataChange={vi.fn()}
          onSchemaChange={vi.fn()}
        />
      </div>
    )

    await act(async () => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })

    const firstCell = screen.getByText('Row 1')
    const mountedRows = new Set(
      [...document.querySelectorAll<HTMLElement>('[data-grid-row]')].map(
        cell => cell.dataset.gridRow
      )
    )
    expect(mountedRows.size).toBeGreaterThan(0)
    expect(mountedRows.size).toBeLessThan(50)

    const firstGridCell = firstCell.closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(firstGridCell)
    fireEvent.keyDown(firstGridCell, { key: 'ArrowDown', ctrlKey: true })

    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })
    const lastCell = screen.getByText('Row 1000')
    expect(lastCell.closest('[role="gridcell"]')).toHaveAttribute('tabindex', '0')
    expect(screen.queryByText('Row 1')).toBeNull()
  })
})
