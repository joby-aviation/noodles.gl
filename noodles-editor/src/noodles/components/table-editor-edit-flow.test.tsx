import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { TableEditorOp } from '../operators'
import type { TableSchema } from '../table-schema'
import { TableEditor } from './table-editor'

describe('TableEditor - Edit Flow', () => {
  const mockOp = new TableEditorOp('/test-table')

  afterEach(() => {
    cleanup()
  })

  const schema: TableSchema = {
    columns: [
      { name: 'name', type: 'string', defaultValue: '' },
      { name: 'count', type: 'number', defaultValue: 0 },
    ],
  }

  const data = [
    { name: 'Alice', count: 10 },
    { name: 'Bob', count: 20 },
  ]

  describe('Single edit cycle', () => {
    it('should commit string cell edit on first blur', async () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()

      const { getByText, container } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      // Click cell to start editing
      const cell = getByText('Alice')
      fireEvent.click(cell)

      // Find input and change value
      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      expect(input).not.toBeNull()
      expect(input.value).toBe('Alice')

      fireEvent.change(input, { target: { value: 'Charlie' } })
      expect(input.value).toBe('Charlie')

      // Blur to commit
      fireEvent.blur(input)

      // Should call onDataChange with new value
      expect(onDataChange).toHaveBeenCalledWith(
        [
          { name: 'Charlie', count: 10 },
          { name: 'Bob', count: 20 },
        ],
        'Edit cell name'
      )
    })

    it('should allow number cell to be clicked and edited', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()

      const { getByText, container } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      // Find and click the count cell to open editor
      const countCell = getByText('10')
      fireEvent.click(countCell)

      // Verify input editor appears (now using InputText instead of InputNumber)
      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      expect(input).not.toBeNull()
      expect(input.value).toBe('10')

      // Change value
      fireEvent.change(input, { target: { value: '20' } })
      fireEvent.blur(input)

      // Should commit on first blur
      expect(onDataChange).toHaveBeenCalledWith(
        [
          { name: 'Alice', count: 20 },
          { name: 'Bob', count: 20 },
        ],
        'Edit cell count'
      )
    })

    it('should render string literals as a dropdown and commit the selection immediately', () => {
      const onDataChange = vi.fn()
      const literalSchema: TableSchema = {
        columns: [
          {
            name: 'anchor',
            type: 'stringLiteral',
            defaultValue: 'start',
            options: { values: ['start', 'middle', 'end'] },
          },
        ],
      }

      const { getByText, getByRole } = render(
        <TableEditor
          op={mockOp}
          data={[{ anchor: 'start' }]}
          schema={literalSchema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

      fireEvent.click(getByText('start'))

      const dropdown = getByRole('combobox') as HTMLSelectElement
      expect(Array.from(dropdown.options, option => option.value)).toEqual([
        'start',
        'middle',
        'end',
      ])

      fireEvent.change(dropdown, { target: { value: 'end' } })

      expect(onDataChange).toHaveBeenCalledWith([{ anchor: 'end' }], 'Edit cell anchor')
    })

    it('should allow free text editing when a string literal has no configured choices', () => {
      const onDataChange = vi.fn()
      const literalSchema: TableSchema = {
        columns: [{ name: 'anchor', type: 'stringLiteral', defaultValue: '' }],
      }

      const { getByText, getByRole, queryByRole } = render(
        <TableEditor
          op={mockOp}
          data={[{ anchor: 'custom' }]}
          schema={literalSchema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

      fireEvent.click(getByText('custom'))

      expect(queryByRole('combobox')).toBeNull()
      const input = getByRole('textbox') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'updated' } })
      fireEvent.blur(input)

      expect(onDataChange).toHaveBeenCalledWith([{ anchor: 'updated' }], 'Edit cell anchor')
    })
  })

  describe('Multiple edit cycles', () => {
    it('should allow editing same cell twice', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()

      const { getByText, container, rerender } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      // First edit: Alice → Charlie
      const cell = getByText('Alice')
      fireEvent.click(cell)

      let input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'Charlie' } })
      fireEvent.blur(input)

      expect(onDataChange).toHaveBeenCalledWith(
        [
          { name: 'Charlie', count: 10 },
          { name: 'Bob', count: 20 },
        ],
        'Edit cell name'
      )

      // Simulate parent updating with new data
      const updatedData = [
        { name: 'Charlie', count: 10 },
        { name: 'Bob', count: 20 },
      ]
      rerender(
        <TableEditor
          op={mockOp}
          data={updatedData}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      // Second edit: Charlie → David
      const charlieCell = getByText('Charlie')
      fireEvent.click(charlieCell)

      input = container.querySelector('input.p-inputtext') as HTMLInputElement
      expect(input.value).toBe('Charlie') // Should start with Charlie, not Alice

      fireEvent.change(input, { target: { value: 'David' } })
      fireEvent.blur(input)

      expect(onDataChange).toHaveBeenCalledWith(
        [
          { name: 'David', count: 10 },
          { name: 'Bob', count: 20 },
        ],
        'Edit cell name'
      )
    })
  })

  describe('Committing the active cell when another target is clicked', () => {
    // Real pointer input is required here: the bug was a mousedown/blur/mouseup
    // ordering problem that synthetic fireEvent.click() cannot reproduce.
    const renderTable = (onDataChange: (data: unknown[], description?: string) => void) =>
      render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

    const startEdit = async (container: HTMLElement, text: string, newValue: string) => {
      await userEvent.click(screen.getByText(text))
      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      await userEvent.fill(input, newValue)
      return input
    }

    it('commits a pending edit when another cell is clicked', async () => {
      const onDataChange = vi.fn()
      const { container } = renderTable(onDataChange)

      await startEdit(container, 'Alice', 'Charlie')
      await userEvent.click(screen.getByText('Bob'))

      expect(onDataChange).toHaveBeenCalledWith(
        [
          { name: 'Charlie', count: 10 },
          { name: 'Bob', count: 20 },
        ],
        'Edit cell name'
      )
    })

    it('commits a pending edit before adding a row, and still adds the row', async () => {
      const onDataChange = vi.fn()
      const { container } = renderTable(onDataChange)

      await startEdit(container, 'Alice', 'Charlie')
      await userEvent.click(screen.getByRole('button', { name: /add row/i }))

      const descriptions = onDataChange.mock.calls.map(call => call[1])
      expect(descriptions).toEqual(['Edit cell name', 'Add table row'])

      const finalData = onDataChange.mock.calls.at(-1)?.[0]
      expect(finalData).toHaveLength(3)
      expect(finalData[0]).toEqual({ name: 'Charlie', count: 10 })
    })

    it('commits a pending edit before deleting a row, and still deletes the row', async () => {
      const onDataChange = vi.fn()
      const { container } = renderTable(onDataChange)

      await startEdit(container, 'Alice', 'Charlie')

      const deleteButtons = screen.getAllByRole('button', { name: /delete row/i })
      await userEvent.click(deleteButtons[1])

      const descriptions = onDataChange.mock.calls.map(call => call[1])
      expect(descriptions).toEqual(['Edit cell name', 'Delete table row'])

      // The committed edit must survive the delete
      expect(onDataChange.mock.calls.at(-1)?.[0]).toEqual([{ name: 'Charlie', count: 10 }])
    })

    it('commits the pending edit only once', async () => {
      const onDataChange = vi.fn()
      const { container } = renderTable(onDataChange)

      await startEdit(container, 'Alice', 'Charlie')
      await userEvent.click(screen.getByText('Bob'))

      const editCalls = onDataChange.mock.calls.filter(call => call[1] === 'Edit cell name')
      expect(editCalls).toHaveLength(1)
    })

    it('keeps at most one cell in edit mode at a time', async () => {
      const onDataChange = vi.fn()
      const { container } = renderTable(onDataChange)
      const activeEditors = () => container.querySelectorAll('input.p-inputtext').length

      await userEvent.click(screen.getByText('Alice'))
      expect(activeEditors()).toBe(1)

      // A different column in a different row
      await userEvent.click(screen.getByText('20'))
      expect(activeEditors()).toBe(1)

      // A different column in the same row
      await userEvent.click(screen.getByText('Bob'))
      expect(activeEditors()).toBe(1)
    })

    it('leaves no cell in edit mode after a row mutation', async () => {
      const onDataChange = vi.fn()
      const { container } = renderTable(onDataChange)
      const activeEditors = () => container.querySelectorAll('input.p-inputtext').length

      await userEvent.click(screen.getByText('Alice'))
      expect(activeEditors()).toBe(1)

      await userEvent.click(screen.getByRole('button', { name: /add row/i }))
      expect(activeEditors()).toBe(0)

      await userEvent.click(screen.getByText('Bob'))
      expect(activeEditors()).toBe(1)

      await userEvent.click(screen.getAllByRole('button', { name: /delete row/i })[0])
      expect(activeEditors()).toBe(0)
    })

    it('deletes a row normally when no cell is being edited', async () => {
      const onDataChange = vi.fn()
      renderTable(onDataChange)

      const deleteButtons = screen.getAllByRole('button', { name: /delete row/i })
      await userEvent.click(deleteButtons[1])

      expect(onDataChange).toHaveBeenCalledWith([{ name: 'Alice', count: 10 }], 'Delete table row')
    })
  })

  describe('Free typing', () => {
    it('should allow typing in string fields without state resets', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()

      const { getByText, container } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      // Test with string field (which we CAN test properly)
      const aliceCell = getByText('Alice')
      fireEvent.click(aliceCell)

      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      expect(input).not.toBeNull()
      expect(input.value).toBe('Alice')

      // Type partial values
      fireEvent.change(input, { target: { value: 'A' } })
      expect(input.value).toBe('A')

      fireEvent.change(input, { target: { value: 'Al' } })
      expect(input.value).toBe('Al')

      fireEvent.change(input, { target: { value: 'Ali' } })
      expect(input.value).toBe('Ali')

      // No updates should happen until blur
      expect(onDataChange).not.toHaveBeenCalled()

      // Complete typing
      fireEvent.change(input, { target: { value: 'Alicia' } })
      fireEvent.blur(input)

      // Now it should commit
      expect(onDataChange).toHaveBeenCalledWith(
        [
          { name: 'Alicia', count: 10 },
          { name: 'Bob', count: 20 },
        ],
        'Edit cell name'
      )
    })
  })

  describe('updateData comparison logic', () => {
    it('should skip update when value is unchanged', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()

      render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      // The updateData function should check if value changed
      // and skip calling onDataChange if it hasn't
      // This is tested implicitly by the "should not commit if value unchanged" test
    })
  })

  describe('Edit cancellation', () => {
    it('should not commit if value unchanged', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()

      const { getByText, container } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      // Click and blur without changing
      const cell = getByText('Alice')
      fireEvent.click(cell)

      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.blur(input)

      // Should NOT call onDataChange
      expect(onDataChange).not.toHaveBeenCalled()
    })

    it('should not commit if value reverted', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()

      const { getByText, container } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      const cell = getByText('Alice')
      fireEvent.click(cell)

      const input = container.querySelector('input.p-inputtext') as HTMLInputElement

      // Change then revert
      fireEvent.change(input, { target: { value: 'Charlie' } })
      fireEvent.change(input, { target: { value: 'Alice' } })
      fireEvent.blur(input)

      // Should NOT call onDataChange since we ended up with same value
      expect(onDataChange).not.toHaveBeenCalled()
    })
  })

  describe('Number field string handling', () => {
    it('should handle number field string editing without over-eager parsing', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()
      const schema: TableSchema = {
        columns: [{ name: 'amount', type: 'number', defaultValue: 0 }],
      }
      const data = [{ amount: 500 }]

      const { container, getByText } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      // Start editing
      const cell = getByText('500')
      fireEvent.click(cell)

      // Input should show "500" as string
      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      expect(input.value).toBe('500')

      // Delete "5", type "4" → should allow "400"
      fireEvent.change(input, { target: { value: '50' } })
      expect(input.value).toBe('50')

      fireEvent.change(input, { target: { value: '400' } })
      expect(input.value).toBe('400')

      // Blur to commit
      fireEvent.blur(input)

      // Should parse to 400
      expect(onDataChange).toHaveBeenCalledWith(
        expect.arrayContaining([{ amount: 400 }]),
        'Edit cell amount'
      )
    })

    it('should handle number field parsing edge cases', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()
      const schema: TableSchema = {
        columns: [
          {
            name: 'score',
            type: 'number',
            defaultValue: 0,
            options: { min: 0, max: 100 },
          },
        ],
      }
      const data = [{ score: 50 }]

      const { container, getByText } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      const cell = getByText('50')

      // Test invalid input defaults to 0
      fireEvent.click(cell)
      let input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'abc' } })
      fireEvent.blur(input)
      expect(onDataChange).toHaveBeenCalledWith([{ score: 0 }], 'Edit cell score')

      onDataChange.mockClear()

      // Test max clamping
      fireEvent.click(cell)
      input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.change(input, { target: { value: '150' } })
      fireEvent.blur(input)
      expect(onDataChange).toHaveBeenCalledWith([{ score: 100 }], 'Edit cell score')

      onDataChange.mockClear()

      // Test min clamping
      fireEvent.click(cell)
      input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.change(input, { target: { value: '-10' } })
      fireEvent.blur(input)
      expect(onDataChange).toHaveBeenCalledWith([{ score: 0 }], 'Edit cell score')
    })

    it('should handle escape key to cancel number edit', () => {
      const onDataChange = vi.fn()
      const onSchemaChange = vi.fn()
      const schema: TableSchema = {
        columns: [{ name: 'amount', type: 'number', defaultValue: 0 }],
      }
      const data = [{ amount: 500 }]

      const { container, getByText } = render(
        <TableEditor
          op={mockOp}
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={onSchemaChange}
        />
      )

      const cell = getByText('500')
      fireEvent.click(cell)

      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.change(input, { target: { value: '999' } })

      // Press Escape - should revert and not commit
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(onDataChange).not.toHaveBeenCalled()
    })
  })
})
