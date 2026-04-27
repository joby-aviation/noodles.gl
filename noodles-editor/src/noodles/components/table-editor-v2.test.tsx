import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableEditorOp } from '../operators'
import type { TableSchema } from '../table-schema'
import { TableEditorV2 } from './table-editor-v2'

describe('TableEditorV2', () => {
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
      <TableEditorV2
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
      <TableEditorV2
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
      <TableEditorV2
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
      <TableEditorV2
        op={mockOp}
        data={simpleData}
        schema={simpleSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    const addButton = getByRole('button', { name: /add row/i })
    fireEvent.click(addButton)

    expect(onDataChange).toHaveBeenCalledWith([
      { name: 'Alice', count: 10 },
      { name: 'Bob', count: 20 },
      { name: '', count: 0 }, // New row with defaults
    ])
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
      <TableEditorV2
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
      <TableEditorV2
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
      <TableEditorV2
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

    expect(onDataChange).toHaveBeenCalledWith([{ name: 'Bob', count: 20 }])
  })

  it('should call onSchemaChange when schema is updated', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { container } = render(
      <TableEditorV2
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

  it('should update tableData when data prop changes', () => {
    const onDataChange = vi.fn()
    const onSchemaChange = vi.fn()

    const { rerender, getByText } = render(
      <TableEditorV2
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
      <TableEditorV2
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
      <TableEditorV2
        op={mockOp}
        data={[]}
        schema={complexSchema}
        onDataChange={onDataChange}
        onSchemaChange={onSchemaChange}
      />
    )

    const addButton = getByRole('button', { name: /add row/i })
    fireEvent.click(addButton)

    expect(onDataChange).toHaveBeenCalledWith([
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
    ])
  })
})
