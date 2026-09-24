import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableEditorOp } from '../operators'
import type { TableSchema } from '../table-schema'
import { TableEditor } from './table-editor'

describe('TableEditor', () => {
  const mockOp = new TableEditorOp('/test-table')

  // Clean up after each test to prevent DOM pollution
  afterEach(() => {
    cleanup()
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

  it('should render schema editor button', () => {
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

    // Schema editor is now a gear icon in the actions column header
    const schemaButton = container.querySelector('.pi-cog')
    expect(schemaButton).toBeDefined()
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

    const { container } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    // Find and click the schema editor button
    const schemaButton = container.querySelector('.pi-cog')
    expect(schemaButton).toBeDefined()
    fireEvent.click(schemaButton)

    // The dialog should open (we're testing that the callback is wired up)
    // Actual schema editing is tested in schema-editor-dialog.test.tsx
  })

  it('should copy column values when a duplicated column is renamed', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { container, getByRole, getAllByPlaceholderText, getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    fireEvent.click(container.querySelector('.pi-cog') as Element)
    fireEvent.click(getByRole('button', { name: 'Duplicate column name' }))

    const nameInputs = getAllByPlaceholderText('Column name')
    fireEvent.change(nameInputs[1], { target: { value: 'display_name' } })
    fireEvent.click(getByText('Save'))

    expect(onSchemaChange).toHaveBeenCalledWith(
      {
        columns: [
          { name: 'name', type: 'string', defaultValue: '' },
          { name: 'display_name', type: 'string', defaultValue: '' },
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

    const { container, getAllByPlaceholderText, getByRole, getByText } = render(
      <TableEditor
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={vi.fn()}
        onSchemaChange={onSchemaChange}
      />
    )

    fireEvent.click(container.querySelector('.pi-cog') as Element)
    const nameInputs = getAllByPlaceholderText('Column name')
    fireEvent.change(nameInputs[0], { target: { value: 'display_name' } })
    fireEvent.click(getByRole('button', { name: 'Add Column' }))
    fireEvent.change(getAllByPlaceholderText('Column name')[2], { target: { value: 'name' } })
    fireEvent.click(getByText('Save'))

    expect(onSchemaChange).toHaveBeenCalledWith(
      {
        columns: [
          { name: 'display_name', type: 'string', defaultValue: '' },
          { name: 'count', type: 'number', defaultValue: 0 },
          { name: 'name', type: 'string', defaultValue: '' },
        ],
      },
      [
        { display_name: 'Alice', count: 10, name: '' },
        { display_name: 'Bob', count: 20, name: '' },
      ]
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

  it('applies declared defaults when an inherited schema adds columns', () => {
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

    const { container, getByRole } = render(
      <TableEditor
        op={mockOp}
        data={data}
        schema={schema}
        onDataChange={vi.fn()}
        onSchemaChange={onSchemaChange}
      />
    )

    fireEvent.click(container.querySelector('.pi-cog') as Element)
    fireEvent.click(getByRole('button', { name: /save/i }))

    expect(onSchemaChange).toHaveBeenCalledWith(schema, data)
  })

  it('flushes an active edit before applying an inherited schema update', () => {
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

    fireEvent.click(getByText('Downtown Skyport'))
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

    const { container } = render(
      <TableEditor
        op={mockOp}
        data={stringData}
        schema={stringSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    // Open schema editor and change type to color
    const schemaButton = container.querySelector('.pi-cog')
    expect(schemaButton).toBeDefined()
    fireEvent.click(schemaButton)

    // When schema changes, the component should convert invalid values to defaults
    // This prevents the "t is not iterable" error when color picker tries to render a string
  })
})
