import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTableImportSchema,
  TableImportDialog,
  type TableImportRequest,
} from './table-import-dialog'

afterEach(cleanup)

describe('TableImportDialog', () => {
  it('applies edited names and types across the complete payload', () => {
    const result = applyTableImportSchema(
      {
        format: 'tsv',
        schema: { columns: [{ name: 'value', type: 'number', defaultValue: 0 }] },
        data: [{ value: 42 }, { value: 7 }],
        sourceRows: [['42'], ['7']],
      },
      { columns: [{ name: 'amount', type: 'number', defaultValue: 0 }] }
    )

    expect(result.data).toEqual([{ amount: 42 }, { amount: 7 }])
    expect(result.conversionCounts).toEqual({ preserved: 0, coerced: 2, reset: 0 })
  })

  it('counts and converts only the raw anchored paste rectangle', () => {
    const result = applyTableImportSchema(
      {
        format: 'tsv',
        schema: {
          columns: [
            { name: 'existing', type: 'string', defaultValue: '' },
            { name: 'incoming', type: 'string', defaultValue: '' },
          ],
        },
        data: [
          { existing: 'untouched', incoming: '' },
          { existing: 'also untouched', incoming: '42' },
        ],
        sourceRows: [['42']],
        sourceOrigin: { row: 1, column: 1 },
      },
      {
        columns: [
          { name: 'existing', type: 'string', defaultValue: '' },
          { name: 'amount', type: 'number', defaultValue: 0 },
        ],
      },
      1
    )

    expect(result.data).toEqual([
      { existing: 'untouched', amount: 0 },
      { existing: 'also untouched', amount: 42 },
    ])
    expect(result.conversionCounts).toEqual({ preserved: 0, coerced: 1, reset: 0 })
  })

  it('shows no more than 50 preview rows while reporting the full row count', () => {
    const request: TableImportRequest = {
      mode: 'canvas',
      format: 'tsv',
      createPreview: () => ({
        format: 'tsv',
        schema: { columns: [{ name: 'value', type: 'number', defaultValue: 0 }] },
        data: Array.from({ length: 75 }, (_, value) => ({ value })),
      }),
    }
    render(<TableImportDialog open request={request} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByText('75 rows')).toBeDefined()
    expect(screen.getByText('Showing the first 50 rows.')).toBeDefined()
    expect(document.querySelectorAll('tbody tr')).toHaveLength(50)
  })

  it('defaults headers on for canvas imports and rebuilds when toggled', () => {
    const createPreview = vi.fn((firstRowContainsHeaders: boolean) => ({
      format: 'tsv',
      schema: {
        columns: [
          {
            name: firstRowContainsHeaders ? 'Population' : 'Column 1',
            type: 'number' as const,
            defaultValue: 0,
          },
        ],
      },
      data: [{ [firstRowContainsHeaders ? 'Population' : 'Column 1']: 10 }],
    }))
    const request: TableImportRequest = { mode: 'canvas', format: 'tsv', createPreview }
    render(<TableImportDialog open request={request} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    const headerToggle = screen.getByRole('checkbox', {
      name: 'First row contains column names',
    })
    expect(headerToggle).toBeChecked()
    expect(screen.getByLabelText('Column 1 name')).toHaveValue('Population')

    fireEvent.click(headerToggle)
    expect(createPreview).toHaveBeenLastCalledWith(false)
    expect(screen.getByLabelText('Column 1 name')).toHaveValue('Column 1')
  })

  it('defaults headers off for an existing-table overflow import', () => {
    const request: TableImportRequest = {
      mode: 'overflow',
      format: 'tsv',
      createPreview: () => ({
        format: 'tsv',
        schema: { columns: [{ name: 'Column 1', type: 'string', defaultValue: '' }] },
        data: [{ 'Column 1': 'value' }],
      }),
    }
    render(<TableImportDialog open request={request} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(
      screen.getByRole('checkbox', { name: 'First row contains column names' })
    ).not.toBeChecked()
  })

  it('only exposes appended overflow columns for editing and describes review reasons', () => {
    const request: TableImportRequest = {
      mode: 'overflow',
      format: 'tsv',
      editableColumnStart: 1,
      reasons: ['Pasted data extends beyond the last column.'],
      createPreview: () => ({
        format: 'tsv',
        schema: {
          columns: [
            { name: 'existing', type: 'string', defaultValue: '' },
            { name: 'appended', type: 'number', defaultValue: 0 },
          ],
        },
        data: [{ existing: 'keep', appended: 1 }],
      }),
    }
    render(<TableImportDialog open request={request} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.queryByLabelText('Column 1 name')).toBeNull()
    expect(screen.getByLabelText('Column 2 name')).toHaveValue('appended')
    expect(
      screen.getByRole('list', { name: 'Reasons this import needs review' })
    ).toHaveTextContent('Pasted data extends beyond the last column.')
    expect(screen.getByText('Review the inferred columns before importing the data.')).toBeDefined()
  })

  it('provides a named, keyboard-scrollable table preview', () => {
    const request: TableImportRequest = {
      mode: 'canvas',
      format: 'tsv',
      createPreview: () => ({
        format: 'tsv',
        schema: { columns: [{ name: 'value', type: 'string', defaultValue: '' }] },
        data: [{ value: 'one' }],
      }),
    }
    render(<TableImportDialog open request={request} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole('region', { name: 'Imported table data preview' })).toHaveAttribute(
      'tabindex',
      '0'
    )
    expect(screen.getByRole('table', { name: 'Imported table data' })).toBeDefined()
    expect(screen.getByRole('columnheader', { name: 'value' })).toHaveAttribute('scope', 'col')
  })

  it('starts an anchored preview at the pasted rows and reports the paste dimensions', () => {
    const request: TableImportRequest = {
      mode: 'overflow',
      format: 'tsv',
      editableColumnStart: 1,
      createPreview: () => ({
        format: 'tsv',
        schema: {
          columns: [
            { name: 'existing', type: 'string', defaultValue: '' },
            { name: 'incoming', type: 'string', defaultValue: '' },
          ],
        },
        data: Array.from({ length: 80 }, (_, index) => ({
          existing: `existing ${index}`,
          incoming: index === 70 ? 'pasted value' : '',
        })),
        sourceRows: [['pasted value']],
        sourceOrigin: { row: 70, column: 1 },
      }),
    }
    render(<TableImportDialog open request={request} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByText('pasted value')).toBeDefined()
    expect(screen.queryByText('existing 0')).toBeNull()
    expect(screen.getByText('Showing rows 71–71 around the pasted data.')).toBeDefined()
    expect(screen.getByText('1 rows')).toBeDefined()
    expect(screen.getByText('1 columns')).toBeDefined()
    expect(screen.getByText('80 × 2 resulting table')).toBeDefined()
  })

  it('makes reset confirmation explicit', () => {
    const request: TableImportRequest = {
      mode: 'overflow',
      format: 'tsv',
      createPreview: () => ({
        format: 'tsv',
        schema: { columns: [{ name: 'value', type: 'number', defaultValue: 0 }] },
        data: [{ value: 'not a number' }],
        sourceRows: [['not a number']],
      }),
    }
    render(<TableImportDialog open request={request} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByText('1 values reset')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Import and Reset' })).toBeDefined()
  })

  it('submits schema and converted data together after edits', () => {
    const onConfirm = vi.fn()
    const request: TableImportRequest = {
      mode: 'canvas',
      format: 'tsv',
      createPreview: () => ({
        format: 'tsv',
        schema: { columns: [{ name: 'value', type: 'string', defaultValue: '' }] },
        data: [{ value: '42' }],
      }),
    }
    render(
      <TableImportDialog open request={request} onOpenChange={vi.fn()} onConfirm={onConfirm} />
    )

    fireEvent.change(screen.getByLabelText('Column 1 name'), { target: { value: 'amount' } })
    fireEvent.change(screen.getByLabelText('Type for amount'), { target: { value: 'number' } })
    const defaultInput = screen.getByLabelText('Default value for amount')
    fireEvent.change(defaultInput, { target: { value: '5' } })
    fireEvent.blur(defaultInput)
    fireEvent.change(screen.getByLabelText('min for amount'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('softMax for amount'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Table' }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'tsv',
        schema: {
          columns: [
            {
              name: 'amount',
              type: 'number',
              defaultValue: 5,
              options: { min: 1, softMax: 100 },
            },
          ],
        },
        data: [{ amount: 42 }],
      })
    )
  })

  it('does not import when canceled', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    const request: TableImportRequest = {
      mode: 'canvas',
      format: 'tsv',
      createPreview: () => ({
        format: 'tsv',
        schema: { columns: [{ name: 'value', type: 'string', defaultValue: '' }] },
        data: [{ value: 'one' }],
      }),
    }
    render(
      <TableImportDialog open request={request} onOpenChange={onOpenChange} onConfirm={onConfirm} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
