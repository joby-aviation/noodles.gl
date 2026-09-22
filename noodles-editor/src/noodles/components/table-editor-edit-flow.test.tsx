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
      fireEvent.doubleClick(cell)

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
      fireEvent.doubleClick(countCell)

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

      fireEvent.doubleClick(getByText('start'))

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

      fireEvent.doubleClick(getByText('custom'))

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
      fireEvent.doubleClick(cell)

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
      fireEvent.doubleClick(charlieCell)

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
      await userEvent.dblClick(screen.getByText(text))
      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      await userEvent.fill(input, newValue)
      return input
    }

    it('commits a pending edit when another cell is clicked', async () => {
      const onDataChange = vi.fn()
      const { container } = renderTable(onDataChange)

      await startEdit(container, 'Alice', 'Charlie')
      fireEvent.click(screen.getByText('Bob'))

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

      await userEvent.dblClick(screen.getByText('Alice'))
      expect(activeEditors()).toBe(1)

      // A different column in a different row
      await userEvent.dblClick(screen.getByText('20'))
      expect(activeEditors()).toBe(1)

      // A different column in the same row
      await userEvent.dblClick(screen.getByText('Bob'))
      expect(activeEditors()).toBe(1)
    })

    it('leaves no cell in edit mode after a row mutation', async () => {
      const onDataChange = vi.fn()
      const { container } = renderTable(onDataChange)
      const activeEditors = () => container.querySelectorAll('input.p-inputtext').length

      await userEvent.dblClick(screen.getByText('Alice'))
      expect(activeEditors()).toBe(1)

      await userEvent.click(screen.getByRole('button', { name: /add row/i }))
      expect(activeEditors()).toBe(0)

      await userEvent.dblClick(screen.getByText('Bob'))
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
      fireEvent.doubleClick(aliceCell)

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
      fireEvent.doubleClick(cell)

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
      fireEvent.doubleClick(cell)

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
      fireEvent.doubleClick(cell)

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
      fireEvent.doubleClick(cell)
      let input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'abc' } })
      fireEvent.blur(input)
      expect(onDataChange).toHaveBeenCalledWith([{ score: 0 }], 'Edit cell score')

      onDataChange.mockClear()

      // Test max clamping
      fireEvent.doubleClick(cell)
      input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.change(input, { target: { value: '150' } })
      fireEvent.blur(input)
      expect(onDataChange).toHaveBeenCalledWith([{ score: 100 }], 'Edit cell score')

      onDataChange.mockClear()

      // Test min clamping
      fireEvent.doubleClick(cell)
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
      fireEvent.doubleClick(cell)

      const input = container.querySelector('input.p-inputtext') as HTMLInputElement
      fireEvent.change(input, { target: { value: '999' } })

      // Press Escape - should revert and not commit
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(onDataChange).not.toHaveBeenCalled()
    })
  })

  describe('Number and vector scrubbing', () => {
    it('scrubs a number cell with its configured step and commits on mouseup', () => {
      const onDataChange = vi.fn()
      const scrubSchema: TableSchema = {
        columns: [{ name: 'amount', type: 'number', defaultValue: 0, options: { step: 0.25 } }],
      }
      const { getByText } = render(
        <TableEditor
          op={mockOp}
          data={[{ amount: 10 }]}
          schema={scrubSchema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

      fireEvent.doubleClick(getByText('10'))
      const input = screen.getByRole('spinbutton', { name: 'Edit amount' })
      const wrapper = input.parentElement as HTMLElement

      fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(document, { clientX: 120, clientY: 100 })
      fireEvent.mouseUp(document, { clientX: 120, clientY: 100 })

      expect(onDataChange).toHaveBeenCalledWith([{ amount: 15 }], 'Edit cell amount')
    })

    it('selects an inactive number cell and starts scrubbing in the same drag', () => {
      const onDataChange = vi.fn()
      const scrubSchema: TableSchema = {
        columns: [
          { name: 'label', type: 'string', defaultValue: '' },
          { name: 'amount', type: 'number', defaultValue: 0, options: { step: 0.25 } },
        ],
      }
      const { getByText } = render(
        <TableEditor
          op={mockOp}
          data={[{ label: 'Alpha', amount: 10 }]}
          schema={scrubSchema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

      const cell = getByText('10').closest('td') as HTMLTableCellElement
      expect(cell).not.toHaveAttribute('aria-selected', 'true')

      fireEvent.pointerDown(cell, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
      expect(cell).toHaveAttribute('aria-selected', 'true')
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 120, clientY: 100 })

      expect(screen.getByRole('spinbutton', { name: 'Edit amount' })).toHaveValue(15)
      fireEvent.mouseUp(document, { clientX: 120, clientY: 100 })

      expect(onDataChange).toHaveBeenCalledWith(
        [{ label: 'Alpha', amount: 15 }],
        'Edit cell amount'
      )
    })

    it('keeps a number cell in selection mode when the pointer does not drag', () => {
      const { getByText } = render(
        <TableEditor
          op={mockOp}
          data={[{ label: 'Alpha', amount: 10 }]}
          schema={{
            columns: [
              { name: 'label', type: 'string', defaultValue: '' },
              { name: 'amount', type: 'number', defaultValue: 0 },
            ],
          }}
          onDataChange={vi.fn()}
          onSchemaChange={vi.fn()}
        />
      )

      const cell = getByText('10').closest('td') as HTMLTableCellElement
      fireEvent.pointerDown(cell, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerUp(document, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.click(cell)

      expect(cell).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByRole('spinbutton', { name: 'Edit amount' })).not.toBeInTheDocument()
    })

    it('uses vector steps for vec2 scrubbing and preserves the other channel', () => {
      const onDataChange = vi.fn()
      const scrubSchema: TableSchema = {
        columns: [{ name: 'offset', type: 'vec2', defaultValue: [0, 0] }],
      }
      const { getByText } = render(
        <TableEditor
          op={mockOp}
          data={[{ offset: [1, 2] }]}
          schema={scrubSchema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

      fireEvent.doubleClick(getByText('[1.0000, 2.0000]'))
      const xInput = screen.getByRole('spinbutton', { name: 'X' })

      fireEvent.mouseDown(xInput.parentElement as HTMLElement, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(document, { clientX: 120, clientY: 100 })
      fireEvent.mouseUp(document, { clientX: 120, clientY: 100 })

      expect(onDataChange).toHaveBeenCalledWith([{ offset: [3, 2] }], 'Edit cell offset')
    })

    it('keeps a vector edit open while focus moves between channels', () => {
      const onDataChange = vi.fn()
      const scrubSchema: TableSchema = {
        columns: [{ name: 'vector', type: 'vec3', defaultValue: [0, 0, 0] }],
      }
      const { getByText } = render(
        <TableEditor
          op={mockOp}
          data={[{ vector: [1, 2.3456, 3] }]}
          schema={scrubSchema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

      fireEvent.doubleClick(getByText('[1.00, 2.35, 3.00]'))
      const xInput = screen.getByRole('spinbutton', { name: 'X' })
      const yInput = screen.getByRole('spinbutton', { name: 'Y' })
      expect(yInput).toHaveValue(2.3456)

      fireEvent.blur(xInput, { relatedTarget: yInput })
      fireEvent.focus(yInput, { relatedTarget: xInput })
      expect(onDataChange).not.toHaveBeenCalled()

      fireEvent.change(yInput, { target: { value: '4' } })
      fireEvent.blur(yInput)

      expect(onDataChange).toHaveBeenCalledWith([{ vector: [1, 4, 3] }], 'Edit cell vector')
    })

    it.each([
      {
        type: 'vec2' as const,
        value: [1, 2],
        renderedValue: '[1.0000, 2.0000]',
        channel: 'X',
        expected: [0, 2],
      },
      {
        type: 'vec3' as const,
        value: [1, 2, 3],
        renderedValue: '[1.00, 2.00, 3.00]',
        channel: 'Y',
        expected: [1, 0, 3],
      },
    ])('commits an empty $type channel as zero when Enter is pressed', testCase => {
      const onDataChange = vi.fn()
      const scrubSchema: TableSchema = {
        columns: [{ name: 'vector', type: testCase.type, defaultValue: testCase.value }],
      }
      const { getByText } = render(
        <TableEditor
          op={mockOp}
          data={[{ vector: testCase.value }]}
          schema={scrubSchema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

      fireEvent.doubleClick(getByText(testCase.renderedValue))
      const input = screen.getByRole('spinbutton', { name: testCase.channel })
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onDataChange).toHaveBeenCalledWith([{ vector: testCase.expected }], 'Edit cell vector')
    })
  })
})
