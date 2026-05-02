import {
  type ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import cx from 'classnames'
import { Button } from 'primereact/button'
import { InputNumber } from 'primereact/inputnumber'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState } from 'react'
import type { TableEditorOp } from '../operators'
import type { ColumnSchema, ColumnType, TableSchema } from '../table-schema'
import { convertValue, getDefaultValue } from '../table-schema'
import { ColorSwatch } from './color-swatch'
import { SchemaEditorDialog } from './schema-editor-dialog'
import s from './table-editor.module.css'

// Cell editor components for each column type

interface CellEditorProps {
  value: unknown
  onChange: (value: unknown) => void
  onComplete: () => void
  column: ColumnSchema
}

function NumberCellEditor({ value, onChange, onComplete, column }: CellEditorProps) {
  return (
    <InputNumber
      value={value as number}
      min={column.options?.min}
      max={column.options?.max}
      step={column.options?.step ?? 1}
      onValueChange={(e) => onChange(e.value ?? 0)}
      onBlur={onComplete}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          onComplete()
        }
      }}
      autoFocus
      className={s.cellEditor}
    />
  )
}

function StringCellEditor({ value, onChange, onComplete }: CellEditorProps) {
  return (
    <InputText
      value={value as string}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onComplete}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          onComplete()
        }
        if (e.key === 'Escape') {
          onComplete()
        }
      }}
      autoFocus
      className={s.cellEditor}
    />
  )
}

function BooleanCellEditor({ value, onChange, onComplete }: CellEditorProps) {
  return (
    <InputSwitch
      checked={value as boolean}
      onChange={(e) => {
        onChange(e.value)
        onComplete()
      }}
      autoFocus
    />
  )
}

function ColorCellEditor({ value, onChange, onComplete }: CellEditorProps) {
  return (
    <div
      onBlur={onComplete}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          onComplete()
        }
      }}
    >
      <ColorSwatch color={(value as string) || '#000000'} onChange={onChange} />
    </div>
  )
}

function Point2DCellEditor({ value, onChange, onComplete, column }: CellEditorProps) {
  const [lng, lat] = (value as [number, number]) || [0, 0]

  return (
    <div className={s.point2dEditor}>
      <InputNumber
        value={lng}
        step={0.0001}
        onValueChange={(e) => onChange([e.value ?? 0, lat])}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            onComplete()
          }
        }}
        placeholder="lng"
        className={s.coordInput}
      />
      <InputNumber
        value={lat}
        step={0.0001}
        onValueChange={(e) => onChange([lng, e.value ?? 0])}
        onBlur={onComplete}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            onComplete()
          }
        }}
        placeholder="lat"
        className={s.coordInput}
      />
      {column.options?.geocoder && (
        <button
          type="button"
          className={s.geocoderButton}
          onClick={() => {
            // TODO: Open geocoder dialog
            console.log('Geocoder not yet implemented')
          }}
          title="Geocode address"
        >
          📍
        </button>
      )}
    </div>
  )
}

function Vec3CellEditor({ value, onChange, onComplete }: CellEditorProps) {
  const [x, y, z] = (value as [number, number, number]) || [0, 0, 0]

  return (
    <div className={s.vec3Editor}>
      <InputNumber
        value={x}
        onValueChange={(e) => onChange([e.value ?? 0, y, z])}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            onComplete()
          }
        }}
        placeholder="x"
        className={s.vecInput}
      />
      <InputNumber
        value={y}
        onValueChange={(e) => onChange([x, e.value ?? 0, z])}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            onComplete()
          }
        }}
        placeholder="y"
        className={s.vecInput}
      />
      <InputNumber
        value={z}
        onValueChange={(e) => onChange([x, y, e.value ?? 0])}
        onBlur={onComplete}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            onComplete()
          }
        }}
        placeholder="z"
        className={s.vecInput}
      />
    </div>
  )
}

function DateCellEditor({ value, onChange, onComplete }: CellEditorProps) {
  return (
    <InputText
      type="date"
      value={value as string}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onComplete}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          onComplete()
        }
      }}
      autoFocus
      className={s.cellEditor}
    />
  )
}

function DateTimeCellEditor({ value, onChange, onComplete }: CellEditorProps) {
  return (
    <InputText
      type="datetime-local"
      step={0.001} // Enable millisecond precision
      value={value as string}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onComplete}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          onComplete()
        }
      }}
      autoFocus
      className={s.cellEditor}
    />
  )
}

// Get cell editor component for column type
function getCellEditor(type: ColumnType) {
  switch (type) {
    case 'number':
      return NumberCellEditor
    case 'string':
    case 'stringLiteral':
      return StringCellEditor
    case 'boolean':
      return BooleanCellEditor
    case 'color':
      return ColorCellEditor
    case 'point2d':
      return Point2DCellEditor
    case 'vec2':
      return Point2DCellEditor // Vec2 uses same editor as Point2D
    case 'vec3':
    case 'point3d':
      return Vec3CellEditor
    case 'date':
      return DateCellEditor
    case 'dateTime':
      return DateTimeCellEditor
    default:
      return StringCellEditor
  }
}

// Cell renderer functions for display mode

function renderNumberCell(value: unknown): string {
  if (typeof value !== 'number') return '0'
  return value.toLocaleString()
}

function renderBooleanCell(value: unknown): string {
  return value ? '✓' : '✗'
}

function renderColorCell(value: unknown): JSX.Element {
  const color = typeof value === 'string' ? value : '#000000'
  return (
    <div className={s.colorDisplay}>
      <div className={s.colorSwatch} style={{ backgroundColor: color }} />
      <span>{color}</span>
    </div>
  )
}

function renderPoint2DCell(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 2) return '[0, 0]'
  const [lng, lat] = value
  return `[${(lng as number).toFixed(4)}, ${(lat as number).toFixed(4)}]`
}

function renderVec3Cell(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 3) return '[0, 0, 0]'
  const [x, y, z] = value
  return `[${(x as number).toFixed(2)}, ${(y as number).toFixed(2)}, ${(z as number).toFixed(2)}]`
}

function renderDateCell(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString().split('T')[0]
  return ''
}

function renderDateTimeCell(value: unknown): string {
  if (typeof value === 'string') {
    return value // Display ISO datetime string as-is
  }
  return ''
}

function renderStringCell(value: unknown): string {
  return String(value ?? '')
}

// Get cell renderer for column type
function getCellRenderer(type: ColumnType) {
  switch (type) {
    case 'number':
      return renderNumberCell
    case 'boolean':
      return renderBooleanCell
    case 'color':
      return renderColorCell
    case 'point2d':
    case 'vec2':
      return renderPoint2DCell
    case 'vec3':
    case 'point3d':
      return renderVec3Cell
    case 'date':
      return renderDateCell
    case 'dateTime':
      return renderDateTimeCell
    case 'string':
    case 'stringLiteral':
    default:
      return renderStringCell
  }
}

// Editable cell component
interface EditableCellProps {
  getValue: () => unknown
  row: { index: number }
  column: { id: string }
  table: {
    options: {
      meta?: {
        updateData: (rowIndex: number, columnId: string, value: unknown) => void
        deleteRow: (rowIndex: number) => void
        schema: TableSchema
      }
    }
  }
}

function EditableCell({ getValue, row, column, table }: EditableCellProps) {
  const initialValue = getValue()
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(initialValue)

  const colSchema = table.options.meta?.schema.columns.find((col) => col.name === column.id)
  if (!colSchema) {
    return <div className={s.cell}>{String(initialValue)}</div>
  }

  const EditorComponent = getCellEditor(colSchema.type)
  const renderer = getCellRenderer(colSchema.type)

  const handleComplete = () => {
    setIsEditing(false)
    if (value !== initialValue) {
      table.options.meta?.updateData(row.index, column.id, value)
    }
  }

  if (isEditing) {
    return (
      <div className={cx(s.cell, s.editing)}>
        <EditorComponent
          value={value}
          onChange={setValue}
          onComplete={handleComplete}
          column={colSchema}
        />
      </div>
    )
  }

  return (
    <div
      className={s.cell}
      onClick={() => setIsEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          setIsEditing(true)
        }
      }}
      tabIndex={0}
    >
      {renderer(initialValue)}
    </div>
  )
}

// Main table component

interface TableEditorProps {
  op: TableEditorOp
  data: unknown[]
  schema: TableSchema
  onDataChange: (data: unknown[]) => void
  onSchemaChange: (schema: TableSchema) => void
}

export function TableEditor({
  op,
  data,
  schema,
  onDataChange,
  onSchemaChange,
}: TableEditorProps) {
  const [tableData, setTableData] = useState(data)

  useEffect(() => {
    setTableData(data)
  }, [data])

  const addRow = () => {
    const newRow: Record<string, unknown> = {}
    for (const col of schema.columns) {
      newRow[col.name] = col.defaultValue ?? getDefaultValue(col)
    }
    const newData = [...tableData, newRow]
    setTableData(newData)
    onDataChange(newData)
  }

  const handleSchemaChange = (newSchema: TableSchema) => {
    // Update data to match new schema
    const newData = tableData.map((row) => {
      const newRow: Record<string, unknown> = {}
      for (const col of newSchema.columns) {
        const existingValue = row[col.name]
        // Convert existing value to new type, or use default if missing
        if (existingValue !== undefined) {
          newRow[col.name] = convertValue(existingValue, col.type)
        } else {
          newRow[col.name] = col.defaultValue ?? getDefaultValue(col)
        }
      }
      return newRow
    })

    onSchemaChange(newSchema)
    setTableData(newData)
    onDataChange(newData)
  }

  const columnHelper = createColumnHelper<Record<string, unknown>>()

  // Add row number column and action column
  const columns: ColumnDef<Record<string, unknown>>[] = [
    columnHelper.display({
      id: '_rowNumber',
      header: '#',
      cell: (props) => <div className={s.rowNumber}>{props.row.index + 1}</div>,
      size: 50,
    }),
    ...schema.columns.map((colSchema) =>
      columnHelper.accessor(colSchema.name, {
        header: colSchema.name,
        cell: EditableCell,
      })
    ),
    columnHelper.display({
      id: '_actions',
      header: () => (
        <SchemaEditorDialog schema={schema} onChange={handleSchemaChange} />
      ),
      cell: (props) => (
        <Button
          icon="pi pi-trash"
          className={`p-button-text p-button-sm ${s.deleteButton}`}
          onClick={() => props.table.options.meta?.deleteRow(props.row.index)}
          tooltip="Delete row"
        />
      ),
      size: 50,
    }),
  ]

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData: (rowIndex: number, columnId: string, value: unknown) => {
        const newData = [...tableData]
        newData[rowIndex] = {
          ...newData[rowIndex],
          [columnId]: value,
        }
        setTableData(newData)
        onDataChange(newData)
      },
      deleteRow: (rowIndex: number) => {
        const newData = tableData.filter((_, index) => index !== rowIndex)
        setTableData(newData)
        onDataChange(newData)
      },
      schema,
    },
  })

  if (!tableData || tableData.length === 0) {
    return (
      <div className={s.emptyState}>
        <p>No data. Add rows to get started.</p>
        <Button label="Add Row" icon="pi pi-plus" onClick={addRow} />
        <SchemaEditorDialog schema={schema} onChange={handleSchemaChange} />
      </div>
    )
  }

  return (
    <div className={s.tableContainer}>
      <div className={s.tableWrapper}>
        <table className={s.table}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className={s.header}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={s.row}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={s.cellContainer}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={s.toolbar}>
        <Button
          label="Add Row"
          icon="pi pi-plus"
          onClick={addRow}
          className={`p-button-sm p-button-text ${s.addRowButton}`}
        />
        <div className={s.stats}>
          {tableData.length} row{tableData.length !== 1 ? 's' : ''} × {schema.columns.length}{' '}
          column{schema.columns.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  )
}
