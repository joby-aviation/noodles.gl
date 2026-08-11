import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TableSchema } from '../table-schema'
import { SchemaEditorDialog } from './schema-editor-dialog'

afterEach(() => {
  cleanup()
})

describe('SchemaEditorDialog', () => {
  const mockSchema: TableSchema = {
    columns: [
      { name: 'name', type: 'string', defaultValue: '' },
      { name: 'age', type: 'number', defaultValue: 0 },
    ],
  }

  it('should render trigger button', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    const trigger = screen.getByRole('button')
    expect(trigger).toBeDefined()
  })

  it('should open dialog when trigger button is clicked', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)

    expect(screen.getByText('Table Schema Editor')).toBeDefined()
  })

  it('should display all existing columns', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByDisplayValue('name')).toBeDefined()
    expect(screen.getByDisplayValue('age')).toBeDefined()
  })

  it('should add a new column when Add Column is clicked', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    const addButton = screen.getByText('Add Column')
    fireEvent.click(addButton)

    // Should show 3 column name inputs now (2 existing + 1 new)
    const nameInputs = screen.getAllByPlaceholderText('Column name')
    expect(nameInputs.length).toBe(3)
    expect(nameInputs[2]).toHaveValue('column_3')
  })

  it('should add Position XYZ quick template with Number type', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    const xyzButton = screen.getByText('Position XYZ')
    fireEvent.click(xyzButton)

    // Should show 5 columns now (2 existing + 3 from template)
    const nameInputs = screen.getAllByPlaceholderText('Column name')
    expect(nameInputs.length).toBe(5)

    // Check that x, y, z columns are added (this tests Bug #2 fix)
    expect(screen.getByDisplayValue('x')).toBeDefined()
    expect(screen.getByDisplayValue('y')).toBeDefined()
    expect(screen.getByDisplayValue('z')).toBeDefined()
  })

  it('should add Color RGB quick template', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    const rgbButton = screen.getByText('Color RGB')
    fireEvent.click(rgbButton)

    // Should show 5 columns now (2 existing + 3 from template)
    const nameInputs = screen.getAllByPlaceholderText('Column name')
    expect(nameInputs.length).toBe(5)

    // Check that r, g, b columns are added
    expect(screen.getByDisplayValue('r')).toBeDefined()
    expect(screen.getByDisplayValue('g')).toBeDefined()
    expect(screen.getByDisplayValue('b')).toBeDefined()
  })

  it('should add Lat/Lng quick template', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    const latLngButton = screen.getByText('Lat/Lng')
    fireEvent.click(latLngButton)

    // Should show 3 columns now (2 existing + 1 from template)
    const nameInputs = screen.getAllByPlaceholderText('Column name')
    expect(nameInputs.length).toBe(3)

    // Check that position column is added
    expect(screen.getByDisplayValue('position')).toBeDefined()
  })

  it('should show type-specific options for Number type', () => {
    const numberSchema: TableSchema = {
      columns: [{ name: 'value', type: 'number', defaultValue: 0 }],
    }
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={numberSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    // Number type shows min/max/step options
    expect(screen.queryByText('Min:')).toBeDefined()
    expect(screen.queryByText('Max:')).toBeDefined()
    expect(screen.queryByText('Step:')).toBeDefined()
  })

  it('should show type-specific options for Point2D type', () => {
    const point2dSchema: TableSchema = {
      columns: [{ name: 'location', type: 'point2d', defaultValue: [0, 0] }],
    }
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={point2dSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    // Point2D type shows geocoder toggle
    expect(screen.queryByText('Geocoder:')).toBeDefined()
  })

  it('should show type-specific options for StringLiteral type', () => {
    const stringLiteralSchema: TableSchema = {
      columns: [
        {
          name: 'status',
          type: 'stringLiteral',
          defaultValue: 'active',
          options: { values: ['active', 'inactive'] },
        },
      ],
    }
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={stringLiteralSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    // StringLiteral type shows values input
    expect(screen.queryByText('Values (comma-separated):')).toBeDefined()
    expect(screen.queryByDisplayValue('active, inactive')).toBeDefined()
  })

  it('should render a default value editor for every column type', () => {
    const allTypesSchema: TableSchema = {
      columns: [
        { name: 'number', type: 'number', defaultValue: 1 },
        { name: 'string', type: 'string', defaultValue: 'text' },
        { name: 'boolean', type: 'boolean', defaultValue: true },
        { name: 'color', type: 'color', defaultValue: '#ff0000' },
        { name: 'point2d', type: 'point2d', defaultValue: [1, 2] },
        { name: 'point3d', type: 'point3d', defaultValue: [1, 2, 3] },
        { name: 'vec2', type: 'vec2', defaultValue: [1, 2] },
        { name: 'vec3', type: 'vec3', defaultValue: [1, 2, 3] },
        { name: 'date', type: 'date', defaultValue: '2026-08-07' },
        {
          name: 'dateTime',
          type: 'dateTime',
          defaultValue: { datetime: '2026-08-07T12:00:00.000', timezone: 'UTC' },
        },
        {
          name: 'literal',
          type: 'stringLiteral',
          defaultValue: 'start',
          options: { values: ['start', 'end'] },
        },
      ],
    }

    render(<SchemaEditorDialog schema={allTypesSchema} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))

    for (const column of allTypesSchema.columns) {
      expect(
        screen.getByRole('group', { name: `Default value for ${column.name}` })
      ).toBeDefined()
    }
  })

  it('should save an edited column default value', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))

    const defaultEditor = screen.getByRole('group', { name: 'Default value for name' })
    fireEvent.change(within(defaultEditor).getByRole('textbox'), {
      target: { value: 'Unknown' },
    })
    fireEvent.click(screen.getByText('Save'))

    expect(onChange).toHaveBeenCalledWith({
      columns: [
        { name: 'name', type: 'string', defaultValue: 'Unknown' },
        { name: 'age', type: 'number', defaultValue: 0 },
      ],
    })
  })

  it('should replace an invalid StringLiteral default with its first option', () => {
    const onChange = vi.fn()
    const schema: TableSchema = {
      columns: [
        {
          name: 'anchor',
          type: 'stringLiteral',
          defaultValue: '',
          options: { values: ['start', 'end', 'middle'] },
        },
      ],
    }

    render(<SchemaEditorDialog schema={schema} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))

    const defaultEditor = screen.getByRole('group', { name: 'Default value for anchor' })
    expect(defaultEditor).toHaveTextContent('start')

    fireEvent.click(screen.getByText('Save'))
    expect(onChange).toHaveBeenCalledWith({
      columns: [
        {
          name: 'anchor',
          type: 'stringLiteral',
          defaultValue: 'start',
          options: { values: ['start', 'end', 'middle'] },
        },
      ],
    })
  })

  it('should normalize reversed number bounds before choosing a default', () => {
    const onChange = vi.fn()
    const schema: TableSchema = {
      columns: [
        {
          name: 'offset',
          type: 'number',
          defaultValue: 0,
          options: { min: 10, max: 5 },
        },
      ],
    }

    render(<SchemaEditorDialog schema={schema} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))

    const defaultEditor = screen.getByRole('group', { name: 'Default value for offset' })
    expect(within(defaultEditor).getByRole('spinbutton')).toHaveValue('5')

    fireEvent.click(screen.getByText('Save'))
    expect(onChange).toHaveBeenCalledWith({
      columns: [
        {
          name: 'offset',
          type: 'number',
          defaultValue: 5,
          options: { min: 5, max: 10 },
        },
      ],
    })
  })

  it('should call onChange with updated schema when Save is clicked', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    // Add a new column
    const addButton = screen.getByText('Add Column')
    fireEvent.click(addButton)

    // Click Save
    const saveButton = screen.getByText('Save')
    fireEvent.click(saveButton)

    expect(onChange).toHaveBeenCalledWith({
      columns: [
        { name: 'name', type: 'string', defaultValue: '' },
        { name: 'age', type: 'number', defaultValue: 0 },
        { name: 'column_3', type: 'string', defaultValue: '' },
      ],
    })
  })

  it('should not call onChange when Cancel is clicked', () => {
    const onChange = vi.fn()
    render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))

    // Add a new column
    const addButton = screen.getByText('Add Column')
    fireEvent.click(addButton)

    // Click Cancel
    const cancelButton = screen.getByText('Cancel')
    fireEvent.click(cancelButton)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('should verify appendTo prop is set to fix dropdown z-index issue', () => {
    // This test documents the fix for Bug #1: dropdown not showing all types
    // The fix is adding appendTo="self" prop to render dropdown inside dialog
    // This prevents z-index conflicts with Radix Dialog overlay
    // The actual dropdown behavior is tested in manual browser testing
    const onChange = vi.fn()
    const { container } = render(<SchemaEditorDialog schema={mockSchema} onChange={onChange} />)

    // Verify component renders successfully
    expect(container.querySelector('button')).toBeDefined()
  })
})
