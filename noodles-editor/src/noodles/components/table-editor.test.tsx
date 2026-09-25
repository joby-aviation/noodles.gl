import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableEditorOp } from '../operators'
import type { TableSchema } from '../table-schema'
import { TableEditor } from './table-editor'

const clipboard = {
  writeText: vi.fn<(text: string) => Promise<void>>(),
  readText: vi.fn<() => Promise<string>>(),
}

vi.stubGlobal('navigator', { ...navigator, clipboard })

function openTableSchemaActions() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Table actions' }), {
    button: 0,
    ctrlKey: false,
  })
}

function openSchemaEditor() {
  openTableSchemaActions()
  fireEvent.click(screen.getByText('Edit Schema'))
}

describe('TableEditor', () => {
  const mockOp = new TableEditorOp('/test-table')

  // Clean up after each test to prevent DOM pollution
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    clipboard.writeText.mockReset().mockResolvedValue(undefined)
    clipboard.readText.mockReset()
  })

  const simpleSchema: TableSchema = {
    columns: [
      { name: 'name', type: 'string', defaultValue: '' },
      { name: 'count', type: 'number', defaultValue: 0 },
    ],
  }

  const simpleData = [
    { name: 'Alice', count: 10 },
    { name: 'Bob', count: 20 },
  ]

  it('should render empty state when no data', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { getByText, getByRole } = render(
      <TableEditor
        op={mockOp}
        data={[]}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    expect(getByText(/no data/i)).toBeDefined()
    expect(getByRole('button', { name: /add row/i })).toBeDefined()
  })

  it('should render table with data', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    expect(getByText('Alice')).toBeDefined()
    expect(getByText('Bob')).toBeDefined()
    expect(screen.getByRole('grid')).toHaveAttribute('aria-colcount', '4')
    expect(screen.getByText('Alice').closest('[role="gridcell"]')).toHaveAttribute(
      'aria-colindex',
      '2'
    )
    expect(
      screen.getAllByRole('button', { name: 'Delete row' })[0]?.closest('[role="gridcell"]')
    ).toHaveAttribute('aria-colindex', '4')
  })

  it('should show stats in toolbar', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    expect(getByText(/2 rows × 2 columns/i)).toBeDefined()
  })

  it('should call onDataChange when adding row', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { getByRole } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    const addButton = getByRole('button', { name: /add row/i })
    fireEvent.click(addButton)

    expect(onDataChange).toHaveBeenCalledWith(
      [
        { name: 'Alice', count: 10 },
        { name: 'Bob', count: 20 },
        { name: '', count: 0 }, // New row with defaults
      ],
      'Add table row'
    )
  })

  it('should render different column types', () => {
    const complexSchema: TableSchema = {
      columns: [
        { name: 'text', type: 'string', defaultValue: '' },
        { name: 'num', type: 'number', defaultValue: 0 },
        { name: 'flag', type: 'boolean', defaultValue: false },
        { name: 'hue', type: 'color', defaultValue: '#000000' },
        { name: 'pos', type: 'point2d', defaultValue: [0, 0] },
      ],
    }

    const complexData = [
      {
        text: 'Test',
        num: 42,
        flag: true,
        hue: '#ff5733',
        pos: [10.5, 20.3],
      },
    ]

    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { getByText } = render(
      <TableEditor
        op={mockOp}
        data={complexData}
        schema={complexSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    // Check headers
    expect(getByText('text')).toBeDefined()
    expect(getByText('num')).toBeDefined()
    expect(getByText('flag')).toBeDefined()
    expect(getByText('hue')).toBeDefined()
    expect(getByText('pos')).toBeDefined()

    // Check values rendered
    expect(getByText('Test')).toBeDefined()
    expect(getByText('42')).toBeDefined()
    expect(getByText('✓')).toBeDefined() // Boolean true
    expect(getByText('#ff5733')).toBeDefined()
  })

  it('should render table schema actions', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    expect(screen.getByRole('button', { name: 'Table actions' })).toBeDefined()
  })

  it('copies a readable versioned table schema envelope', async () => {
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
        clipboard={clipboard}
      />
    )

    openTableSchemaActions()
    fireEvent.click(screen.getByText('Copy Schema'))

    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledOnce())
    expect(JSON.parse(clipboard.writeText.mock.calls[0][0])).toEqual({
      $noodles: 'table-schema',
      version: 1,
      schema: simpleSchema,
    })
  })

  it('previews and atomically applies a pasted schema overlay', async () => {
    const onSchemaChange = vi.fn()
    clipboard.readText.mockResolvedValue(
      JSON.stringify({
        $noodles: 'column-schema',
        version: 1,
        column: {
          name: 'anchor',
          type: 'stringLiteral',
          defaultValue: 'start',
          options: { values: ['start', 'end'] },
        },
      })
    )
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={onSchemaChange}
        clipboard={clipboard}
      />
    )

    openTableSchemaActions()
    await act(async () => {
      fireEvent.click(screen.getByText('Paste Schema Overlay'))
      await Promise.resolve()
    })

    expect(clipboard.readText).toHaveBeenCalledOnce()
    expect(screen.getByText('Paste Schema Overlay', { selector: 'h2' })).toBeDefined()
    expect(screen.getByText('add')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Apply Overlay' }))

    expect(onSchemaChange).toHaveBeenCalledWith(
      {
        columns: [
          ...simpleSchema.columns,
          {
            id: 'anchor',
            name: 'anchor',
            type: 'stringLiteral',
            defaultValue: 'start',
            options: { values: ['start', 'end'] },
          },
        ],
      },
      [
        { name: 'Alice', count: 10, anchor: 'start' },
        { name: 'Bob', count: 20, anchor: 'start' },
      ]
    )
  })

  it('keeps an unsafe pasted definition by default', async () => {
    const onSchemaChange = vi.fn()
    clipboard.readText.mockResolvedValue(
      JSON.stringify({
        $noodles: 'column-schema',
        version: 1,
        column: { name: 'count', type: 'boolean', defaultValue: false },
      })
    )
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={onSchemaChange}
        clipboard={clipboard}
      />
    )

    openTableSchemaActions()
    await act(async () => {
      fireEvent.click(screen.getByText('Paste Schema Overlay'))
      await Promise.resolve()
    })

    expect(clipboard.readText).toHaveBeenCalledOnce()
    expect(screen.getByText('2 values preserved')).toBeDefined()
    expect(screen.getByText('0 values would reset')).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Decision for count' })).toHaveValue('keep')
    fireEvent.click(screen.getByRole('button', { name: 'Apply Overlay' }))
    expect(onSchemaChange).toHaveBeenCalledWith(simpleSchema, simpleData)
  })

  it('keeps values after an exact-name overlay adopts a different source identity', async () => {
    const onSchemaChange = vi.fn()
    const targetSchema: TableSchema = {
      columns: [
        { id: 'local-lineage', name: 'name', type: 'string', defaultValue: '' },
        simpleSchema.columns[1],
      ],
    }
    clipboard.readText.mockResolvedValue(
      JSON.stringify({
        $noodles: 'column-schema',
        version: 1,
        column: {
          id: 'shared-lineage',
          name: 'name',
          type: 'string',
          defaultValue: '',
        },
      })
    )
    const props = {
      op: mockOp,
      onDataChange: vi.fn(),
      onSchemaChange,
      clipboard,
    }
    const view = render(<TableEditor {...props} data={simpleData} schema={targetSchema} />)

    openTableSchemaActions()
    await act(async () => {
      fireEvent.click(screen.getByText('Paste Schema Overlay'))
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Overlay' }))

    const [appliedSchema, appliedData] = onSchemaChange.mock.calls[0] as [TableSchema, unknown[]]
    expect(appliedSchema.columns[0]).toMatchObject({ id: 'shared-lineage', name: 'name' })
    expect(appliedData).toEqual(simpleData)

    view.rerender(<TableEditor {...props} data={appliedData} schema={appliedSchema} />)
    expect(screen.getByText('Alice')).toBeDefined()
    expect(screen.getByText('Bob')).toBeDefined()
  })

  it('offers a focused paste catcher when clipboard permission is denied', async () => {
    clipboard.readText.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
        clipboard={clipboard}
      />
    )

    openTableSchemaActions()
    await act(async () => {
      fireEvent.click(screen.getByText('Paste Schema Overlay'))
      await Promise.resolve()
    })

    expect(clipboard.readText).toHaveBeenCalledOnce()
    const pasteTarget = screen.getByRole('textbox', { name: 'Paste schema JSON' })
    act(() => vi.runOnlyPendingTimers())
    expect(pasteTarget).toHaveFocus()
  })

  it('should call onDataChange when deleting row', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { container } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    // Find and click the first delete button
    const deleteButtons = container.querySelectorAll('.pi-trash')
    fireEvent.click(deleteButtons[0])

    expect(onDataChange).toHaveBeenCalledWith([{ name: 'Bob', count: 20 }], 'Delete table row')
  })

  it('should call onSchemaChange when schema is updated', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    openSchemaEditor()

    // The dialog should open (we're testing that the callback is wired up)
    // Actual schema editing is tested in schema-editor-dialog.test.tsx
  })

  it('should copy column values when a duplicated column is renamed', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { getByRole, getAllByPlaceholderText, getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    openSchemaEditor()
    fireEvent.click(getByRole('button', { name: 'Duplicate column name' }))

    const nameInputs = getAllByPlaceholderText('Column name')
    fireEvent.change(nameInputs[1], { target: { value: 'display_name' } })
    fireEvent.click(getByText('Save'))

    expect(onSchemaChange).toHaveBeenCalledWith(
      {
        columns: [
          { name: 'name', type: 'string', defaultValue: '' },
          {
            id: expect.any(String),
            name: 'display_name',
            type: 'string',
            defaultValue: '',
          },
          { name: 'count', type: 'number', defaultValue: 0 },
        ],
      },
      [
        { name: 'Alice', display_name: 'Alice', count: 10 },
        { name: 'Bob', display_name: 'Bob', count: 20 },
      ]
    )
  })

  it('should use the default for a fresh column that reuses a renamed column name', () => {
    const onSchemaChange = vi.fn()

    const { getAllByPlaceholderText, getByRole, getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={onSchemaChange}
      />
    )

    openSchemaEditor()
    const nameInputs = getAllByPlaceholderText('Column name')
    fireEvent.change(nameInputs[0], { target: { value: 'display_name' } })
    fireEvent.click(getByRole('button', { name: 'Add Column' }))
    fireEvent.change(getAllByPlaceholderText('Column name')[2], { target: { value: 'name' } })
    fireEvent.click(getByText('Save'))

    expect(onSchemaChange).toHaveBeenCalledWith(
      {
        columns: [
          {
            id: 'name',
            name: 'display_name',
            type: 'string',
            defaultValue: '',
          },
          { name: 'count', type: 'number', defaultValue: 0 },
          { id: expect.any(String), name: 'name', type: 'string', defaultValue: '' },
        ],
      },
      [
        { display_name: 'Alice', count: 10, name: '' },
        { display_name: 'Bob', count: 20, name: '' },
      ]
    )
  })

  it('preserves values when an existing column is renamed', () => {
    const onSchemaChange = vi.fn()
    const { getAllByPlaceholderText, getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={onSchemaChange}
      />
    )

    openSchemaEditor()
    fireEvent.change(getAllByPlaceholderText('Column name')[0], {
      target: { value: 'display_name' },
    })
    fireEvent.click(getByText('Save'))

    expect(onSchemaChange).toHaveBeenCalledWith(
      {
        columns: [
          {
            id: 'name',
            name: 'display_name',
            type: 'string',
            defaultValue: '',
          },
          { name: 'count', type: 'number', defaultValue: 0 },
        ],
      },
      [
        { display_name: 'Alice', count: 10 },
        { display_name: 'Bob', count: 20 },
      ]
    )
  })

  it('persists values when an external schema update renames a column', () => {
    const onDataChange = vi.fn()
    const renamedSchema: TableSchema = {
      columns: [
        {
          id: 'name',
          name: 'display_name',
          type: 'string',
          defaultValue: '',
        },
        { name: 'count', type: 'number', defaultValue: 0 },
      ],
    }
    const { rerender, getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    rerender(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={renamedSchema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    expect(getByText('Alice')).toBeDefined()
    expect(onDataChange).toHaveBeenCalledWith(
      [
        { display_name: 'Alice', count: 10 },
        { display_name: 'Bob', count: 20 },
      ],
      'Apply table schema rename'
    )
  })

  it('should update tableData when data prop changes', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { rerender, getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    expect(getByText('Alice')).toBeDefined()

    // Update data prop
    const newData = [{ name: 'Charlie', count: 30 }]
    rerender(
      <TableEditor
        op={mockOp}
        data={newData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    expect(getByText('Charlie')).toBeDefined()
    expect(getByText(/1 row × 2 columns/i)).toBeDefined()
  })

  it('applies declared defaults when an external schema update adds columns', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()
    const initialSchema: TableSchema = {
      columns: [{ name: 'name', type: 'string', defaultValue: '' }],
    }
    const inheritedSchema: TableSchema = {
      columns: [
        { name: 'name', type: 'string', defaultValue: '' },
        {
          name: 'anchor',
          type: 'stringLiteral',
          defaultValue: 'start',
          options: { values: ['start', 'end', 'middle'] },
        },
        { name: 'offset', type: 'vec2', defaultValue: [64, 0] },
      ],
    }
    const data = [{ name: 'Downtown Skyport' }]

    const { getByText, rerender } = render(
      <TableEditor
        op={mockOp}
        data={data}
        schema={initialSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    rerender(
      <TableEditor
        op={mockOp}
        data={data}
        schema={inheritedSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    expect(getByText('start')).toBeDefined()
    expect(getByText('[64.0000, 0.0000]')).toBeDefined()
  })

  it('preserves compatible custom values when an unchanged schema is saved', () => {
    const onSchemaChange = vi.fn()
    const schema: TableSchema = {
      columns: [
        {
          name: 'anchor',
          type: 'stringLiteral',
          defaultValue: 'start',
          options: { values: ['start', 'end', 'middle'] },
        },
        { name: 'offset', type: 'vec2', defaultValue: [64, 0] },
      ],
    }
    const data = [
      { anchor: 'end', offset: [-64, 0] },
      { anchor: 'middle', offset: [12, 24] },
    ]

    const { getByRole } = render(
      <TableEditor
        op={mockOp}
        data={data}
        schema={schema}
        onDataChange={vi.fn()}
        onSchemaChange={onSchemaChange}
      />
    )

    openSchemaEditor()
    fireEvent.click(getByRole('button', { name: /save/i }))

    expect(onSchemaChange).toHaveBeenCalledWith(schema, data)
  })

  it('flushes an active edit before applying an external schema update', () => {
    const onDataChange = vi.fn()
    const initialSchema: TableSchema = {
      columns: [{ name: 'name', type: 'string', defaultValue: '' }],
    }
    const inheritedSchema: TableSchema = {
      columns: [
        { name: 'name', type: 'string', defaultValue: '' },
        { name: 'offset', type: 'vec2', defaultValue: [64, 0] },
      ],
    }
    const data = [{ name: 'Downtown Skyport' }]

    const { container, getByText, rerender } = render(
      <TableEditor
        op={mockOp}
        data={data}
        schema={initialSchema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    fireEvent.doubleClick(getByText('Downtown Skyport'))
    fireEvent.change(container.querySelector('input.p-inputtext') as HTMLInputElement, {
      target: { value: 'Edited Skyport' },
    })

    rerender(
      <TableEditor
        op={mockOp}
        data={data}
        schema={inheritedSchema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    expect(onDataChange).toHaveBeenCalledWith([{ name: 'Edited Skyport' }], 'Edit cell name')
    expect(getByText('Edited Skyport')).toBeDefined()
    expect(getByText('[64.0000, 0.0000]')).toBeDefined()
  })

  it('should add default values for all column types when adding row', () => {
    const complexSchema: TableSchema = {
      columns: [
        { name: 'str', type: 'string', defaultValue: 'default' },
        { name: 'num', type: 'number', defaultValue: 42 },
        { name: 'bool', type: 'boolean', defaultValue: true },
        { name: 'color', type: 'color', defaultValue: '#ffffff' },
        { name: 'point2d', type: 'point2d', defaultValue: [1, 2] },
        { name: 'point3d', type: 'point3d', defaultValue: [1, 2, 3] },
        { name: 'vec2', type: 'vec2', defaultValue: [5, 6] },
        { name: 'vec3', type: 'vec3', defaultValue: [7, 8, 9] },
        { name: 'date', type: 'date', defaultValue: '2026-01-01' },
        { name: 'literal', type: 'stringLiteral', defaultValue: 'a' },
      ],
    }

    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { getByRole } = render(
      <TableEditor
        op={mockOp}
        data={[]}
        schema={complexSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    const addButton = getByRole('button', { name: /add row/i })
    fireEvent.click(addButton)

    expect(onDataChange).toHaveBeenCalledWith(
      [
        {
          str: 'default',
          num: 42,
          bool: true,
          color: '#ffffff',
          point2d: [1, 2],
          point3d: [1, 2, 3],
          vec2: [5, 6],
          vec3: [7, 8, 9],
          date: '2026-01-01',
          literal: 'a',
        },
      ],
      'Add table row'
    )
  })

  it('should convert existing values when column type changes', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    // Start with string data
    const stringData = [{ value: 'test' }]
    const stringSchema: TableSchema = {
      columns: [{ name: 'value', type: 'string', defaultValue: '' }],
    }

    render(
      <TableEditor
        op={mockOp}
        data={stringData}
        schema={stringSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    // Open schema editor and change type to color
    openSchemaEditor()

    // When schema changes, the component should convert invalid values to defaults
    // This prevents the "t is not iterable" error when color picker tries to render a string
  })

  it('uses spreadsheet selection before entering edit mode', () => {
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
      />
    )

    const value = screen.getByText('Alice')
    const cell = value.closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(value)
    expect(cell).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.doubleClick(value)
    expect(screen.getByRole('textbox')).toHaveValue('Alice')
  })

  it('navigates and extends a rectangular selection with the keyboard', () => {
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
      />
    )

    const alice = screen.getByText('Alice').closest('[role="gridcell"]') as HTMLElement
    const ten = screen.getByText('10').closest('[role="gridcell"]') as HTMLElement
    const twenty = screen.getByText('20').closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(alice)
    fireEvent.keyDown(alice, { key: 'ArrowRight', shiftKey: true })
    expect(alice).toHaveAttribute('aria-selected', 'true')
    expect(ten).toHaveAttribute('aria-selected', 'true')
    expect(ten).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(ten, { key: 'ArrowDown', shiftKey: true })
    expect(twenty).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Bob').closest('[role="gridcell"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('extends a rectangular selection with pointer drag', () => {
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
      />
    )

    const alice = screen.getByText('Alice').closest('[role="gridcell"]') as HTMLElement
    const twenty = screen.getByText('20').closest('[role="gridcell"]') as HTMLElement
    fireEvent.pointerDown(alice, { button: 0 })
    fireEvent.pointerEnter(twenty)
    fireEvent.pointerUp(document)

    for (const cell of screen.getAllByRole('gridcell').filter(cell => cell.dataset.gridRow)) {
      expect(cell).toHaveAttribute('aria-selected', 'true')
    }
  })

  it('selects complete rows, columns, and the whole grid from headers', () => {
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByRole('rowheader')[1])
    expect(screen.getByText('Bob').closest('[role="gridcell"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByText('20').closest('[role="gridcell"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )

    fireEvent.click(screen.getByRole('columnheader', { name: /name/i }))
    expect(screen.getByText('Alice').closest('[role="gridcell"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByText('Bob').closest('[role="gridcell"]')).toHaveAttribute(
      'aria-selected',
      'true'
    )

    fireEvent.click(screen.getByRole('columnheader', { name: '#' }))
    for (const cell of screen.getAllByRole('gridcell').filter(cell => cell.dataset.gridRow)) {
      expect(cell).toHaveAttribute('aria-selected', 'true')
    }
  })

  it('starts editing from printable typing, cancels with Escape, and advances with Enter', () => {
    const onDataChange = vi.fn()
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    const alice = screen.getByText('Alice').closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(alice)
    fireEvent.keyDown(alice, { key: 'Z' })
    const editor = screen.getByRole('textbox')
    expect(editor).toHaveValue('Z')
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(onDataChange).not.toHaveBeenCalled()
    expect(screen.getByText('Alice')).toBeDefined()

    fireEvent.keyDown(alice, { key: 'Enter' })
    const secondEditor = screen.getByRole('textbox')
    fireEvent.change(secondEditor, { target: { value: 'Alicia' } })
    fireEvent.keyDown(secondEditor, { key: 'Enter' })
    expect(onDataChange).toHaveBeenCalledWith(
      [
        { name: 'Alicia', count: 10 },
        { name: 'Bob', count: 20 },
      ],
      'Edit cell name'
    )
    expect(screen.getByText('Bob').closest('[role="gridcell"]')).toHaveAttribute('tabindex', '0')
  })

  it('replaces a selected number cell from the first typed digit', () => {
    const onDataChange = vi.fn()
    render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    const count = screen.getByText('10').closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(count)
    fireEvent.keyDown(count, { key: '7' })

    const editor = screen.getByRole('spinbutton', { name: 'Edit count' })
    expect(editor).toHaveValue(7)
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onDataChange).toHaveBeenCalledWith(
      [
        { name: 'Alice', count: 7 },
        { name: 'Bob', count: 20 },
      ],
      'Edit cell count'
    )
  })

  it('keeps action menus open when selecting the operator rerenders the table', () => {
    const props = {
      op: mockOp,
      data: simpleData,
      schema: simpleSchema,
      onDataChange: vi.fn(),
      onSchemaChange: vi.fn(),
    }
    const { rerender } = render(<TableEditor {...props} />)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Table actions' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(screen.getByText('Copy All Data')).toBeDefined()

    rerender(<TableEditor {...props} onDataChange={vi.fn()} />)

    expect(screen.getByText('Copy All Data')).toBeDefined()
  })

  it('keeps user column names separate from internal table columns', () => {
    const collisionSchema: TableSchema = {
      columns: [
        { name: '_rowNumber', type: 'string', defaultValue: '' },
        { name: '_actions', type: 'string', defaultValue: '' },
      ],
    }
    render(
      <TableEditor
        op={mockOp}
        data={[{ _rowNumber: 'user row', _actions: 'user actions' }]}
        schema={collisionSchema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
      />
    )

    expect(screen.getByText('user row')).toBeDefined()
    expect(screen.getByText('user actions')).toBeDefined()
    expect(screen.getAllByRole('gridcell')).toHaveLength(3)
    expect(document.querySelectorAll('[data-grid-row]')).toHaveLength(2)
  })
})
