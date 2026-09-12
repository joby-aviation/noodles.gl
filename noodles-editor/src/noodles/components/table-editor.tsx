import {
  type ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import cx from 'classnames'
import { AutoComplete } from 'primereact/autocomplete'
import { Button } from 'primereact/button'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TableEditorOp } from '../operators'
import type { ColumnSchema, ColumnType, DateTimeValue, TableSchema } from '../table-schema'
import { getDefaultValue, validateTableData } from '../table-schema'
import { getTimezoneOptions } from '../utils/timezone-utils'
import { ColorSwatch } from './color-swatch'
import { DraggableNumberInput } from './draggable-number-input'
import { GeocodingDialog } from './geocoding-dialog'
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
  const initialValueRef = useRef(value as number)
  const defaultValue = typeof column.defaultValue === 'number' ? column.defaultValue : 0

  const applyConstraints = (newValue: number) => {
    let constrainedValue = newValue
    if (column.options?.min !== undefined && constrainedValue < column.options.min) {
      constrainedValue = column.options.min
    }
    if (column.options?.max !== undefined && constrainedValue > column.options.max) {
      constrainedValue = column.options.max
    }

    return constrainedValue
  }

  const handleNumberChange = (newValue: number) => {
    onChange(applyConstraints(newValue))
  }

  const parseAndCommit = (inputValue: string) => {
    const parsed = Number.parseFloat(inputValue)
    handleNumberChange(Number.isNaN(parsed) ? defaultValue : parsed)
    onComplete()
  }

  return (
    <DraggableNumberInput
      value={typeof value === 'number' ? value : defaultValue}
      onChange={handleNumberChange}
      onBlur={event => parseAndCommit(event.currentTarget.value)}
      onDragEnd={onComplete}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          parseAndCommit(e.currentTarget.value)
        }
        if (e.key === 'Escape') {
          // Revert to initial value captured at mount
          onChange(initialValueRef.current)
          // Give the onChange time to propagate before completing
          requestAnimationFrame(() => onComplete())
        }
      }}
      min={column.options?.min}
      max={column.options?.max}
      softMin={column.options?.softMin}
      softMax={column.options?.softMax}
      step={column.options?.step ?? 1}
      autoFocus
      className={cx('p-inputtext', s.cellEditor)}
      wrapperClassName={s.numberInputWrapper}
      formatDisplayValue={String}
      aria-label={`Edit ${column.name}`}
    />
  )
}

function StringCellEditor({ value, onChange, onComplete }: CellEditorProps) {
  return (
    <InputText
      value={value as string}
      onChange={e => onChange(e.target.value)}
      onBlur={onComplete}
      onKeyDown={e => {
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

function StringLiteralCellEditor({ value, onChange, onComplete, column }: CellEditorProps) {
  const selectRef = useRef<HTMLSelectElement>(null)
  const currentValue = String(value ?? '')
  const [localValue, setLocalValue] = useState(currentValue)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const configuredValues = column.options?.values ?? []
  const freeform = column.options?.freeform ?? false
  const values = configuredValues.includes(currentValue)
    ? configuredValues
    : [currentValue, ...configuredValues]

  useEffect(() => {
    selectRef.current?.focus()
  }, [])

  if (!freeform && configuredValues.length === 0) {
    return (
      <StringCellEditor value={value} onChange={onChange} onComplete={onComplete} column={column} />
    )
  }

  if (!freeform) {
    return (
      <select
        ref={selectRef}
        value={currentValue}
        onChange={e => {
          onChange(e.currentTarget.value)
          onComplete()
        }}
        onBlur={onComplete}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            onComplete()
          }
        }}
        aria-label={`Edit ${column.name}`}
        className={cx('p-inputtext', s.cellEditor)}
      >
        {values.map(option => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }

  const filteredValues = configuredValues.filter(option =>
    option.toLowerCase().includes(localValue.toLowerCase())
  )

  return (
    <div style={{ position: 'relative' }}>
      <InputText
        value={localValue}
        onChange={e => {
          setLocalValue(e.target.value)
          onChange(e.target.value)
          setSuggestionsOpen(true)
        }}
        onFocus={() => setSuggestionsOpen(true)}
        onBlur={() => {
          setTimeout(() => setSuggestionsOpen(false), 150)
          onComplete()
        }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            onComplete()
          }
        }}
        autoFocus
        className={s.cellEditor}
        placeholder="Type or select…"
      />
      {suggestionsOpen && filteredValues.length > 0 && (
        <ul className={s.cellSuggestions}>
          {filteredValues.map(option => (
            <li
              key={option}
              onMouseDown={() => {
                setLocalValue(option)
                onChange(option)
                setSuggestionsOpen(false)
                onComplete()
              }}
              className={s.cellSuggestion}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BooleanCellEditor({ value, onChange, onComplete }: CellEditorProps) {
  return (
    <InputSwitch
      checked={value as boolean}
      onChange={e => {
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
      onKeyDown={e => {
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
  const initialValueRef = useRef([lng, lat] as [number, number])
  const latestRef = useRef([lng, lat] as [number, number])
  const [geocodingOpen, setGeocodingOpen] = useState(false)

  const updateLng = (newValue: number) => {
    const newVal: [number, number] = [newValue, latestRef.current[1]]
    latestRef.current = newVal
    onChange(newVal)
  }

  const updateLat = (newValue: number) => {
    const newVal: [number, number] = [latestRef.current[0], newValue]
    latestRef.current = newVal
    onChange(newVal)
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    updateValue: (value: number) => void
  ) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      if (e.currentTarget.value === '') updateValue(0)
      onComplete()
    }
    if (e.key === 'Escape') {
      onChange(initialValueRef.current)
      requestAnimationFrame(() => onComplete())
    }
  }

  const handleBlur = (event: React.FocusEvent<HTMLFieldSetElement>) => {
    const nextTarget = event.relatedTarget
    if (
      !geocodingOpen &&
      !(nextTarget instanceof Node && event.currentTarget.contains(nextTarget))
    ) {
      onComplete()
    }
  }

  const handleLocationSelected = (result: { longitude: number; latitude: number }) => {
    const newVal: [number, number] = [result.longitude, result.latitude]
    latestRef.current = newVal
    onChange(newVal)
    setGeocodingOpen(false)
    onComplete()
  }

  return (
    <fieldset className={s.point2dEditor} onBlur={handleBlur} aria-label={`Edit ${column.name}`}>
      <DraggableNumberInput
        value={latestRef.current[0]}
        onChange={updateLng}
        onBlur={event => {
          if (event.currentTarget.value === '') updateLng(0)
        }}
        onDragEnd={onComplete}
        onKeyDown={event => handleKeyDown(event, updateLng)}
        step={column.options?.step ?? (column.type === 'point2d' ? 0.0001 : 0.1)}
        autoFocus
        className={cx('p-inputtext', s.coordInput)}
        wrapperClassName={s.vectorInputWrapper}
        formatDisplayValue={String}
        aria-label={column.type === 'point2d' ? 'Longitude' : 'X'}
      />
      <DraggableNumberInput
        value={latestRef.current[1]}
        onChange={updateLat}
        onBlur={event => {
          if (event.currentTarget.value === '') updateLat(0)
        }}
        onDragEnd={onComplete}
        onKeyDown={event => handleKeyDown(event, updateLat)}
        step={column.options?.step ?? (column.type === 'point2d' ? 0.0001 : 0.1)}
        className={cx('p-inputtext', s.coordInput)}
        wrapperClassName={s.vectorInputWrapper}
        formatDisplayValue={String}
        aria-label={column.type === 'point2d' ? 'Latitude' : 'Y'}
      />
      {column.options?.geocoder && (
        <button
          type="button"
          className={s.geocoderButton}
          onMouseDown={e => e.preventDefault()}
          onClick={() => setGeocodingOpen(true)}
          title="Geocode address"
        >
          📍
        </button>
      )}
      {column.options?.geocoder && (
        <GeocodingDialog
          open={geocodingOpen}
          onOpenChange={open => {
            setGeocodingOpen(open)
            if (!open) onComplete()
          }}
          mode="update-field"
          initialValue={{ longitude: latestRef.current[0], latitude: latestRef.current[1] }}
          onLocationSelected={handleLocationSelected}
        />
      )}
    </fieldset>
  )
}

function Vec3CellEditor({ value, onChange, onComplete, column }: CellEditorProps) {
  const [x, y, z] = (value as [number, number, number]) || [0, 0, 0]
  const initialValueRef = useRef([x, y, z] as [number, number, number])
  const latestRef = useRef([x, y, z] as [number, number, number])

  const updateX = (newValue: number) => {
    const newVal: [number, number, number] = [newValue, latestRef.current[1], latestRef.current[2]]
    latestRef.current = newVal
    onChange(newVal)
  }

  const updateY = (newValue: number) => {
    const newVal: [number, number, number] = [latestRef.current[0], newValue, latestRef.current[2]]
    latestRef.current = newVal
    onChange(newVal)
  }

  const updateZ = (newValue: number) => {
    const newVal: [number, number, number] = [latestRef.current[0], latestRef.current[1], newValue]
    latestRef.current = newVal
    onChange(newVal)
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    updateValue: (value: number) => void
  ) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      if (e.currentTarget.value === '') updateValue(0)
      onComplete()
    }
    if (e.key === 'Escape') {
      onChange(initialValueRef.current)
      requestAnimationFrame(() => onComplete())
    }
  }

  const handleBlur = (event: React.FocusEvent<HTMLFieldSetElement>) => {
    const nextTarget = event.relatedTarget
    if (!(nextTarget instanceof Node && event.currentTarget.contains(nextTarget))) {
      onComplete()
    }
  }

  const stepForChannel = (index: number) =>
    column.options?.step ?? (column.type === 'point3d' && index < 2 ? 0.0001 : 0.1)

  const channelNames =
    column.type === 'point3d' ? ['Longitude', 'Latitude', 'Altitude'] : ['X', 'Y', 'Z']

  return (
    <fieldset className={s.vec3Editor} onBlur={handleBlur} aria-label={`Edit ${column.name}`}>
      <DraggableNumberInput
        value={latestRef.current[0]}
        onChange={updateX}
        onBlur={event => {
          if (event.currentTarget.value === '') updateX(0)
        }}
        onDragEnd={onComplete}
        onKeyDown={event => handleKeyDown(event, updateX)}
        step={stepForChannel(0)}
        autoFocus
        className={cx('p-inputtext', s.vecInput)}
        wrapperClassName={s.vectorInputWrapper}
        formatDisplayValue={String}
        aria-label={channelNames[0]}
      />
      <DraggableNumberInput
        value={latestRef.current[1]}
        onChange={updateY}
        onBlur={event => {
          if (event.currentTarget.value === '') updateY(0)
        }}
        onDragEnd={onComplete}
        onKeyDown={event => handleKeyDown(event, updateY)}
        step={stepForChannel(1)}
        className={cx('p-inputtext', s.vecInput)}
        wrapperClassName={s.vectorInputWrapper}
        formatDisplayValue={String}
        aria-label={channelNames[1]}
      />
      <DraggableNumberInput
        value={latestRef.current[2]}
        onChange={updateZ}
        onBlur={event => {
          if (event.currentTarget.value === '') updateZ(0)
        }}
        onDragEnd={onComplete}
        onKeyDown={event => handleKeyDown(event, updateZ)}
        step={stepForChannel(2)}
        className={cx('p-inputtext', s.vecInput)}
        wrapperClassName={s.vectorInputWrapper}
        formatDisplayValue={String}
        aria-label={channelNames[2]}
      />
    </fieldset>
  )
}

function DateCellEditor({ value, onChange, onComplete }: CellEditorProps) {
  return (
    <InputText
      type="date"
      value={value as string}
      onChange={e => onChange(e.target.value)}
      onBlur={onComplete}
      onKeyDown={e => {
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

function DateTimeCellEditor({ value, onChange, onComplete, column }: CellEditorProps) {
  const timezoneOptions = useState(() => getTimezoneOptions())[0]

  // Extract datetime and timezone from DateTimeValue
  const dateTimeValue =
    value && typeof value === 'object' && 'datetime' in value && 'timezone' in value
      ? (value as DateTimeValue)
      : { datetime: '', timezone: 'UTC' }

  const [filteredTimezones, setFilteredTimezones] = useState<string[]>(timezoneOptions)
  const [timezoneInputValue, setTimezoneInputValue] = useState<string>(dateTimeValue.timezone)
  const [pendingTimezone, setPendingTimezone] = useState<string>(dateTimeValue.timezone)
  const [datetimeValue, setDatetimeValue] = useState<string>(dateTimeValue.datetime)
  const containerRef = useRef<HTMLDivElement>(null)

  // Apply pending timezone change to cell value
  const applyTimezoneChange = () => {
    if (
      pendingTimezone &&
      pendingTimezone !== dateTimeValue.timezone &&
      timezoneOptions.includes(pendingTimezone)
    ) {
      // Update cell value with new timezone
      const newValue: DateTimeValue = {
        datetime: datetimeValue,
        timezone: pendingTimezone,
      }
      onChange(newValue)
    }
  }

  // Update cell value when datetime changes
  const handleDatetimeChange = (newDatetime: string) => {
    setDatetimeValue(newDatetime)
    const newValue: DateTimeValue = {
      datetime: newDatetime,
      timezone: pendingTimezone,
    }
    onChange(newValue)
  }

  // Handle blur - check if focus is moving to AutoComplete panel
  const handleBlur = (e: React.FocusEvent) => {
    // Use setTimeout to allow new focus target to be set
    setTimeout(() => {
      const activeElement = document.activeElement
      const container = containerRef.current

      // Check if focus moved to AutoComplete dropdown panel
      const isInAutocompletePanel = activeElement?.closest('.p-autocomplete-panel')
      const isInContainer = container && container.contains(activeElement)

      // Only complete if focus truly left (not in container and not in dropdown panel)
      if (!isInContainer && !isInAutocompletePanel) {
        applyTimezoneChange()
        onComplete()
      }
    }, 0)
  }

  return (
    <div ref={containerRef} className={s.dateTimeCellEditor} onBlur={handleBlur}>
      <InputText
        type="datetime-local"
        step={0.001}
        value={datetimeValue}
        onChange={e => handleDatetimeChange(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            onComplete()
          }
        }}
        autoFocus
        className={s.cellEditor}
      />
      <AutoComplete
        value={timezoneInputValue}
        suggestions={filteredTimezones}
        completeMethod={e => {
          const query = e.query.toLowerCase()
          const filtered = query
            ? timezoneOptions.filter(tz => tz.toLowerCase().includes(query))
            : timezoneOptions
          // Always set suggestions immediately to avoid spinner
          setFilteredTimezones(filtered.length > 0 ? filtered : timezoneOptions)
        }}
        onChange={e => {
          setTimezoneInputValue(e.value || dateTimeValue.timezone)
        }}
        onDropdownClick={() => {
          setFilteredTimezones(timezoneOptions)
        }}
        onSelect={e => {
          if (e.value && typeof e.value === 'string' && timezoneOptions.includes(e.value)) {
            setPendingTimezone(e.value)
            setTimezoneInputValue(e.value)
          }
        }}
        dropdown
        autoHighlight={false}
        placeholder="TZ"
        className={s.timezoneDropdown}
        panelClassName={s.timezonePanel}
        itemTemplate={item => (
          <div
            onMouseDown={() => {
              setPendingTimezone(item)
            }}
          >
            {item}
          </div>
        )}
      />
    </div>
  )
}

// Get cell editor component for column type
function getCellEditor(type: ColumnType) {
  switch (type) {
    case 'number':
      return NumberCellEditor
    case 'string':
      return StringCellEditor
    case 'stringLiteral':
      return StringLiteralCellEditor
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

function renderNumberCell(value: unknown): React.ReactNode {
  if (typeof value !== 'number') return '0'
  return value.toLocaleString()
}

function renderBooleanCell(value: unknown): string {
  return value ? '✓' : '✗'
}

function renderColorCell(value: unknown): React.ReactNode {
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

function renderDateTimeCell(value: unknown, column: ColumnSchema): string {
  // Only handle DateTimeValue format
  if (value && typeof value === 'object' && 'datetime' in value && 'timezone' in value) {
    const dateTimeValue = value as DateTimeValue
    const tzAbbrev =
      dateTimeValue.timezone === 'UTC'
        ? 'UTC'
        : (dateTimeValue.timezone.split('/').pop() ?? dateTimeValue.timezone)
    return `${dateTimeValue.datetime} ${tzAbbrev}`
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
    default:
      return renderStringCell
  }
}

// Tracks the cell currently in edit mode so row mutations can commit it first.
// Without this, clicking "Add Row" or a delete button while a cell is mid-edit
// can drop the pending value.
interface ActiveEdit {
  set: (commit: () => void) => void
  clear: () => void
  flush: () => void
}

function useActiveEdit(): ActiveEdit {
  const commitRef = useRef<(() => void) | null>(null)

  return useMemo(
    () => ({
      set: commit => {
        commitRef.current = commit
      },
      clear: () => {
        commitRef.current = null
      },
      flush: () => {
        const commit = commitRef.current
        commitRef.current = null
        commit?.()
      },
    }),
    []
  )
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
        activeEdit: ActiveEdit
      }
    }
  }
}

function EditableCell({ getValue, row, column, table }: EditableCellProps) {
  const currentValue = getValue()
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(currentValue)
  const valueRef = useRef(currentValue)
  const prevValueRef = useRef(currentValue)
  const isEditingRef = useRef(false)

  // Sync state with current value when not editing
  if (!isEditing && currentValue !== prevValueRef.current) {
    setValue(currentValue)
    valueRef.current = currentValue
    prevValueRef.current = currentValue
  }

  const colSchema = table.options.meta?.schema.columns.find(col => col.name === column.id)
  if (!colSchema) {
    return <div className={s.cell}>{String(currentValue)}</div>
  }

  const EditorComponent = getCellEditor(colSchema.type)
  const renderer = getCellRenderer(colSchema.type)

  const activeEdit = table.options.meta?.activeEdit

  const handleChange = (newValue: unknown) => {
    setValue(newValue)
    valueRef.current = newValue
  }

  const handleComplete = () => {
    // Guard against committing twice when a flush is followed by the blur it caused
    if (!isEditingRef.current) return
    isEditingRef.current = false
    setIsEditing(false)
    activeEdit?.clear()
    table.options.meta?.updateData(row.index, column.id, valueRef.current)
  }

  const startEditing = () => {
    // Commit any other cell still in edit mode before taking over
    activeEdit?.flush()
    isEditingRef.current = true
    setIsEditing(true)
    activeEdit?.set(handleComplete)
  }

  const renderedValue =
    colSchema.type === 'dateTime'
      ? (renderer as (value: unknown, column: ColumnSchema) => React.ReactNode)(
          currentValue,
          colSchema
        )
      : (renderer as (value: unknown) => React.ReactNode)(currentValue)

  if (isEditing) {
    return (
      <div className={cx(s.cell, s.editing)}>
        <span className={s.editingPlaceholder} aria-hidden="true">
          {renderedValue}
        </span>
        <div className={s.editorOverlay}>
          <EditorComponent
            value={value}
            onChange={handleChange}
            onComplete={handleComplete}
            column={colSchema}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={s.cell}
      onClick={startEditing}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          startEditing()
        }
      }}
      tabIndex={0}
    >
      {renderedValue}
    </div>
  )
}

// Main table component

interface TableEditorProps {
  op: TableEditorOp
  data: unknown[]
  schema: TableSchema
  onDataChange: (data: unknown[], description?: string) => void
  onSchemaChange: (schema: TableSchema, data?: unknown[]) => void
}

export function TableEditor({ data, schema, onDataChange, onSchemaChange }: TableEditorProps) {
  const [tableData, setTableData] = useState(() => validateTableData(data, schema))
  const activeEdit = useActiveEdit()
  const previousDataRef = useRef(data)
  const previousSchemaRef = useRef(schema)

  // Mirrors tableData so a flushed cell edit and the row mutation that triggered
  // it can both run in one tick without the second reading stale state
  const tableDataRef = useRef(tableData)
  tableDataRef.current = tableData

  const commitData = (newData: unknown[], description: string) => {
    tableDataRef.current = newData
    setTableData(newData)
    onDataChange(newData, description)
  }

  useEffect(() => {
    const dataChanged = previousDataRef.current !== data
    const schemaChanged = previousSchemaRef.current !== schema

    // Commit and clear any active cell editor before external props replace the
    // table state. For a schema-only update, normalize the just-committed local
    // rows so compatible edits survive the schema transition.
    activeEdit.flush()
    const sourceData = schemaChanged && !dataChanged ? tableDataRef.current : data
    const newTableData = validateTableData(sourceData, schema)
    tableDataRef.current = newTableData
    setTableData(newTableData)
    previousDataRef.current = data
    previousSchemaRef.current = schema
  }, [activeEdit, data, schema])

  const addRow = () => {
    activeEdit.flush()
    const newRow: Record<string, unknown> = {}
    for (const col of schema.columns) {
      newRow[col.name] = col.defaultValue ?? getDefaultValue(col)
    }
    commitData([...tableDataRef.current, newRow], 'Add table row')
  }

  const handleSchemaChange = (newSchema: TableSchema) => {
    activeEdit.flush()
    // Preserve valid cells and materialize the new schema's declared defaults for
    // missing or invalid cells. This is the same path used when a schema arrives
    // through a connection, so custom vector and string-literal defaults agree.
    const newData = validateTableData(tableDataRef.current, newSchema)

    onSchemaChange(newSchema, newData)
    tableDataRef.current = newData
    setTableData(newData)
  }

  const columnHelper = createColumnHelper<Record<string, unknown>>()

  // Add row number column and action column
  const columns: ColumnDef<Record<string, unknown>>[] = [
    columnHelper.display({
      id: '_rowNumber',
      header: '#',
      cell: props => <div className={s.rowNumber}>{props.row.index + 1}</div>,
      size: 50,
    }),
    ...schema.columns.map(colSchema =>
      columnHelper.accessor(colSchema.name, {
        header: colSchema.name,
        cell: EditableCell,
      })
    ),
    columnHelper.display({
      id: '_actions',
      header: () => <SchemaEditorDialog schema={schema} onChange={handleSchemaChange} />,
      cell: props => (
        <Button
          icon="pi pi-trash"
          className={`p-button-text p-button-sm ${s.deleteButton}`}
          // Suppress the editor blur so unmounting it doesn't reflow the row and
          // move this button out from under the pointer before mouseup lands
          onMouseDown={e => e.preventDefault()}
          onClick={() => props.table.options.meta?.deleteRow(props.row.index)}
          tooltip="Delete row"
          aria-label="Delete row"
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
        // Only update if value actually changed
        const currentData = tableDataRef.current
        const currentValue = currentData[rowIndex]?.[columnId]
        if (currentValue === value) {
          return
        }
        const newData = [...currentData]
        newData[rowIndex] = {
          ...newData[rowIndex],
          [columnId]: value,
        }
        commitData(newData, `Edit cell ${columnId}`)
      },
      deleteRow: (rowIndex: number) => {
        activeEdit.flush()
        const newData = tableDataRef.current.filter((_, index) => index !== rowIndex)
        commitData(newData, 'Delete table row')
      },
      schema,
      activeEdit,
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
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
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
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className={s.row}>
                {row.getVisibleCells().map(cell => (
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
          onMouseDown={e => e.preventDefault()}
          onClick={addRow}
          className={`p-button-sm p-button-text ${s.addRowButton}`}
        />
        <div className={s.stats}>
          {tableData.length} row{tableData.length !== 1 ? 's' : ''} × {schema.columns.length} column
          {schema.columns.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  )
}
