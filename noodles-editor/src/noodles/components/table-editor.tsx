import * as ContextMenu from '@radix-ui/react-context-menu'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  type CellContext,
  type ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type RowData,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import cx from 'classnames'
import { AutoComplete } from 'primereact/autocomplete'
import { Button } from 'primereact/button'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { analytics } from '../../utils/analytics'
import type { TableEditorOp } from '../operators'
import {
  type AnchoredTablePastePlan,
  inferTableData,
  normalizeTableColumnNames,
  type ParsedTableDataClipboard,
  parseTableClipboard,
  planAnchoredTablePaste,
  serializeTableRangeClipboard,
  TABLE_RANGE_CLIPBOARD_MIME,
} from '../table-data-clipboard'
import type { ColumnSchema, ColumnType, DateTimeValue, TableSchema } from '../table-schema'
import {
  getDefaultValue,
  isTableSchema,
  transitionTableData,
  validateTableData,
} from '../table-schema'
import {
  applySchemaOverlayPreview,
  createSchemaOverlayPreview,
  type ParsedSchemaClipboard,
  parseSchemaClipboard,
  type SchemaOverlayPreview,
  serializeColumnClipboard,
  serializeSchemaClipboard,
} from '../table-schema-clipboard'
import { getTimezoneOptions } from '../utils/timezone-utils'
import { ColorSwatch } from './color-swatch'
import { DraggableNumberInput, type InitialNumberDrag } from './draggable-number-input'
import { GeocodingDialog } from './geocoding-dialog'
import { type SchemaChangeMetadata, SchemaEditorDialog } from './schema-editor-dialog'
import {
  ClipboardPasteDialog,
  type SchemaOverlayDecisions,
  SchemaOverlayDialog,
} from './schema-overlay-dialog'
import s from './table-editor.module.css'
import {
  createTableImportRequest as createTableImportDialogRequest,
  TableImportDialog,
  type TableImportRequest,
} from './table-import-dialog'

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    updateData?: (rowIndex: number, columnIndex: number, value: unknown) => void
    deleteRow?: (rowIndex: number) => void
    schema?: TableSchema
    activeEdit?: ActiveEdit
    columnIndexById?: ReadonlyMap<string, number>
    editingCell?: TableCellCoordinate | null
    editingSeed?: string
    initialNumberDrag?: InitialNumberDrag
    finishEditing?: (coordinate: TableCellCoordinate, advance?: EditAdvance) => void
    cancelEditing?: (coordinate: TableCellCoordinate) => void
  }
}

// Cell editor components for each column type

type EditAdvance = 'next-row' | 'next-column' | 'previous-column'

interface CellEditorProps {
  value: unknown
  onChange: (value: unknown) => void
  onComplete: (advance?: EditAdvance) => void
  onCancel: () => void
  column: ColumnSchema
  initialNumberDrag?: InitialNumberDrag
}

function NumberCellEditor({
  value,
  onChange,
  onComplete,
  onCancel,
  column,
  initialNumberDrag,
}: CellEditorProps) {
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

  const parseAndCommit = (inputValue: string, advance?: EditAdvance) => {
    const parsed = Number.parseFloat(inputValue)
    handleNumberChange(Number.isNaN(parsed) ? defaultValue : parsed)
    onComplete(advance)
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
          parseAndCommit(e.currentTarget.value, 'next-row')
        }
        if (e.key === 'Escape') {
          onCancel()
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
      initialDrag={initialNumberDrag}
      aria-label={`Edit ${column.name}`}
    />
  )
}

function StringCellEditor({ value, onChange, onComplete, onCancel }: CellEditorProps) {
  return (
    <InputText
      value={value as string}
      onChange={e => onChange(e.target.value)}
      onBlur={() => onComplete()}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') onComplete('next-row')
        if (e.key === 'Escape') onCancel()
      }}
      autoFocus
      className={s.cellEditor}
    />
  )
}

function StringLiteralCellEditor({
  value,
  onChange,
  onComplete,
  onCancel,
  column,
}: CellEditorProps) {
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
      <StringCellEditor
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        onCancel={onCancel}
        column={column}
      />
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
        onBlur={() => onComplete()}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') onComplete('next-row')
          if (e.key === 'Escape') onCancel()
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
          if (e.key === 'Enter') onComplete('next-row')
          if (e.key === 'Escape') onCancel()
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

function ColorCellEditor({ value, onChange, onComplete, onCancel }: CellEditorProps) {
  return (
    <fieldset
      className={s.cellEditorGroup}
      onBlur={() => onComplete()}
      onKeyDown={e => {
        if (e.key === 'Enter') onComplete('next-row')
        if (e.key === 'Escape') onCancel()
      }}
    >
      <ColorSwatch value={(value as string) || '#000000'} onChange={color => onChange(color)} />
    </fieldset>
  )
}

function Point2DCellEditor({ value, onChange, onComplete, onCancel, column }: CellEditorProps) {
  const [lng, lat] = (value as [number, number]) || [0, 0]
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
      onComplete('next-row')
    }
    if (e.key === 'Escape') {
      onCancel()
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

function Vec3CellEditor({ value, onChange, onComplete, onCancel, column }: CellEditorProps) {
  const [x, y, z] = (value as [number, number, number]) || [0, 0, 0]
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
      onComplete('next-row')
    }
    if (e.key === 'Escape') {
      onCancel()
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

function DateCellEditor({ value, onChange, onComplete, onCancel }: CellEditorProps) {
  return (
    <InputText
      type="date"
      value={value as string}
      onChange={e => onChange(e.target.value)}
      onBlur={() => onComplete()}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') onComplete('next-row')
        if (e.key === 'Escape') onCancel()
      }}
      autoFocus
      className={s.cellEditor}
    />
  )
}

function DateTimeCellEditor({
  value,
  onChange,
  onComplete,
  onCancel,
  column: _column,
}: CellEditorProps) {
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
  const containerRef = useRef<HTMLFieldSetElement>(null)

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
  const handleBlur = () => {
    // Use setTimeout to allow new focus target to be set
    setTimeout(() => {
      const activeElement = document.activeElement
      const container = containerRef.current

      // Check if focus moved to AutoComplete dropdown panel
      const isInAutocompletePanel = activeElement?.closest('.p-autocomplete-panel')
      const isInContainer = container?.contains(activeElement)

      // Only complete if focus truly left (not in container and not in dropdown panel)
      if (!isInContainer && !isInAutocompletePanel) {
        applyTimezoneChange()
        onComplete()
      }
    }, 0)
  }

  return (
    <fieldset ref={containerRef} className={s.dateTimeCellEditor} onBlur={handleBlur}>
      <InputText
        type="datetime-local"
        step={0.001}
        value={datetimeValue}
        onChange={e => handleDatetimeChange(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') onComplete('next-row')
          if (e.key === 'Escape') onCancel()
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
            role="option"
            aria-selected={item === pendingTimezone}
            tabIndex={-1}
            onMouseDown={() => {
              setPendingTimezone(item)
            }}
          >
            {item}
          </div>
        )}
      />
    </fieldset>
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

function renderDateTimeCell(value: unknown): string {
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

export interface TableCellCoordinate {
  row: number
  column: number
}

interface TableCellSelection {
  anchor: TableCellCoordinate
  focus: TableCellCoordinate
}

interface TableSelectionRect {
  firstRow: number
  lastRow: number
  firstColumn: number
  lastColumn: number
}

function getSelectionRect(selection: TableCellSelection | null): TableSelectionRect | null {
  if (!selection) return null
  return {
    firstRow: Math.min(selection.anchor.row, selection.focus.row),
    lastRow: Math.max(selection.anchor.row, selection.focus.row),
    firstColumn: Math.min(selection.anchor.column, selection.focus.column),
    lastColumn: Math.max(selection.anchor.column, selection.focus.column),
  }
}

function coordinateInRect(
  coordinate: TableCellCoordinate,
  rect: TableSelectionRect | null
): boolean {
  return Boolean(
    rect &&
      coordinate.row >= rect.firstRow &&
      coordinate.row <= rect.lastRow &&
      coordinate.column >= rect.firstColumn &&
      coordinate.column <= rect.lastColumn
  )
}

function cloneCellValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneCellValue)
  if (value instanceof Date) return new Date(value.getTime())
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cloneCellValue(item),
      ])
    )
  }
  return value
}

function coordinatesEqual(
  left: TableCellCoordinate | null | undefined,
  right: TableCellCoordinate | null | undefined
): boolean {
  return left?.row === right?.row && left?.column === right?.column
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
type EditableCellProps = CellContext<Record<string, unknown>, unknown>

function EditableCell({ getValue, row, column, table }: EditableCellProps) {
  const currentValue = getValue()
  const [value, setValue] = useState(currentValue)
  const valueRef = useRef(currentValue)
  const prevValueRef = useRef(currentValue)
  const isEditingRef = useRef(false)
  const meta = table.options.meta
  const columnIndex = meta?.columnIndexById?.get(column.id)
  const coordinate = useMemo(
    () => (columnIndex === undefined ? null : { row: row.index, column: columnIndex }),
    [columnIndex, row.index]
  )
  const isEditing = coordinate !== null && coordinatesEqual(meta?.editingCell, coordinate)

  // Sync state with current value when not editing
  if (!isEditing && currentValue !== prevValueRef.current) {
    setValue(currentValue)
    valueRef.current = currentValue
    prevValueRef.current = currentValue
  }

  const colSchema = columnIndex === undefined ? undefined : meta?.schema?.columns[columnIndex]

  const handleChange = (newValue: unknown) => {
    setValue(newValue)
    valueRef.current = newValue
  }

  const handleComplete = useCallback(
    (advance?: EditAdvance) => {
      // Guard against committing twice when a flush is followed by the blur it caused
      if (!isEditingRef.current) return
      isEditingRef.current = false
      meta?.activeEdit?.clear()
      if (columnIndex !== undefined) meta?.updateData?.(row.index, columnIndex, valueRef.current)
      if (coordinate) meta?.finishEditing?.(coordinate, advance)
    },
    [columnIndex, coordinate, meta, row.index]
  )

  const handleCancel = () => {
    if (!isEditingRef.current) return
    isEditingRef.current = false
    valueRef.current = currentValue
    setValue(currentValue)
    meta?.activeEdit?.clear()
    if (coordinate) meta?.cancelEditing?.(coordinate)
  }
  useLayoutEffect(() => {
    if (!isEditing || !colSchema) {
      isEditingRef.current = false
      return
    }

    // An external schema update can re-render this cell before TableEditor gets to
    // flush the active edit. Keep the user's buffered value and the commit
    // callback from the render where editing began instead of re-seeding from
    // the incoming props.
    if (isEditingRef.current) return

    let seededValue = currentValue
    if (meta?.editingSeed !== undefined) {
      if (colSchema.type === 'string' || colSchema.type === 'stringLiteral') {
        seededValue = meta.editingSeed
      } else if (colSchema.type === 'number') {
        const parsedSeed = Number(meta.editingSeed)
        if (Number.isFinite(parsedSeed)) {
          const minimum = colSchema.options?.min ?? Number.NEGATIVE_INFINITY
          const maximum = colSchema.options?.max ?? Number.POSITIVE_INFINITY
          seededValue = Math.min(maximum, Math.max(minimum, parsedSeed))
        }
      }
    }
    valueRef.current = seededValue
    setValue(seededValue)
    isEditingRef.current = true
    meta?.activeEdit?.set(handleComplete)
  }, [colSchema, currentValue, handleComplete, isEditing, meta?.activeEdit, meta?.editingSeed])

  if (!colSchema) {
    return <div className={s.cell}>{String(currentValue)}</div>
  }

  const EditorComponent = getCellEditor(colSchema.type)
  const renderer = getCellRenderer(colSchema.type)

  const renderedValue = (renderer as (value: unknown) => React.ReactNode)(currentValue)

  if (isEditing) {
    return (
      <div
        className={cx(s.cell, s.editing)}
        onKeyDownCapture={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            handleCancel()
          } else if (event.key === 'Tab') {
            event.preventDefault()
            event.stopPropagation()
            handleComplete(event.shiftKey ? 'previous-column' : 'next-column')
          }
        }}
      >
        <span className={s.editingPlaceholder} aria-hidden="true">
          {renderedValue}
        </span>
        <div className={s.editorOverlay}>
          <EditorComponent
            value={value}
            onChange={handleChange}
            onComplete={handleComplete}
            onCancel={handleCancel}
            column={colSchema}
            initialNumberDrag={meta?.initialNumberDrag}
          />
        </div>
      </div>
    )
  }

  return <div className={s.cell}>{renderedValue}</div>
}

interface SchemaAction {
  label: string
  icon: string
  onSelect: () => void
  danger?: boolean
}

function SchemaDropdownMenu({
  label,
  actions,
  compact = false,
}: {
  label: string
  actions: SchemaAction[]
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cx(s.menuTrigger, compact && s.compactMenuTrigger)}
          aria-label={label}
          title={label}
        >
          <i className="pi pi-ellipsis-v" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={s.actionMenu} sideOffset={4} align="end">
          {actions.map(action => (
            <DropdownMenu.Item
              key={action.label}
              className={cx(s.actionMenuItem, action.danger && s.dangerAction)}
              onSelect={event => {
                event.preventDefault()
                setOpen(false)
                action.onSelect()
              }}
            >
              <i className={`pi ${action.icon}`} aria-hidden="true" />
              {action.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function SchemaContextMenu({
  children,
  actions,
}: {
  children: React.ReactNode
  actions: SchemaAction[]
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={s.actionMenu}>
          {actions.map(action => (
            <ContextMenu.Item
              key={action.label}
              className={cx(s.actionMenuItem, action.danger && s.dangerAction)}
              onSelect={action.onSelect}
            >
              <i className={`pi ${action.icon}`} aria-hidden="true" />
              {action.label}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function ColumnHeader({ name, actions }: { name: string; actions: SchemaAction[] }) {
  return (
    <SchemaContextMenu actions={actions}>
      <div className={s.columnHeader}>
        <span>{name}</span>
        <SchemaDropdownMenu label={`Column actions for ${name}`} actions={actions} compact />
      </div>
    </SchemaContextMenu>
  )
}

interface ClipboardTextApi {
  read?: () => Promise<ClipboardItem[]>
  readText: () => Promise<string>
  writeText: (text: string) => Promise<void>
  write?: (data: ClipboardItem[]) => Promise<void>
}

interface TableClipboardInput {
  plainText: string
  html: string
  richText: string
}

type SchemaActionSource = 'table_menu' | 'column_menu' | 'schema_editor'

const ROW_NUMBER_COLUMN_ID = '__noodles_row_number'
const ROW_ACTIONS_COLUMN_ID = '__noodles_row_actions'
const DATA_COLUMN_ID_PREFIX = '__noodles_data_'

function getGridAccessibilityProps(rowCount: number, columnCount: number) {
  return {
    role: 'grid' as const,
    'aria-rowcount': rowCount,
    'aria-colcount': columnCount,
    'aria-multiselectable': true,
  }
}

function getGridCellAccessibilityProps(columnIndex: number, selected: boolean) {
  return {
    role: 'gridcell' as const,
    'aria-colindex': columnIndex + 2,
    'aria-selected': selected,
  }
}

function getAuxiliaryGridCellAccessibilityProps(columnIndex: number) {
  return {
    role: 'gridcell' as const,
    'aria-colindex': columnIndex + 1,
  }
}

function getVirtualSpacerAccessibilityProps() {
  return { role: 'presentation' as const }
}

function getDataColumnId(index: number): string {
  return `${DATA_COLUMN_ID_PREFIX}${index}`
}

async function writeClipboardText(
  text: string,
  clipboard: Pick<ClipboardTextApi, 'writeText'> | undefined
): Promise<void> {
  if (clipboard?.writeText) {
    await clipboard.writeText(text)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()
  const copied = document.execCommand?.('copy')
  textArea.remove()
  if (!copied) throw new Error('Clipboard access is unavailable')
}

function isNativeClipboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select, [contenteditable="true"]') ||
      target.closest('input, textarea, select, [contenteditable="true"]') !== null)
  )
}

type SerializedTableRange = ReturnType<typeof serializeTableRangeClipboard>

async function writeTableRangeClipboard(
  serialized: SerializedTableRange,
  clipboard: ClipboardTextApi | undefined
): Promise<void> {
  if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([serialized.plainText], { type: 'text/plain' }),
          'text/html': new Blob([serialized.html], { type: 'text/html' }),
          [TABLE_RANGE_CLIPBOARD_MIME]: new Blob([serialized.richText], {
            type: TABLE_RANGE_CLIPBOARD_MIME,
          }),
        }),
      ])
      return
    } catch {
      // Safari and some permission policies reject custom clipboard MIME types.
      // Retry the interoperable formats together before falling back to TSV.
      try {
        await clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([serialized.plainText], { type: 'text/plain' }),
            'text/html': new Blob([serialized.html], { type: 'text/html' }),
          }),
        ])
        return
      } catch {
        // Some permission policies reject ClipboardItem entirely.
      }
    }
  }
  await writeClipboardText(serialized.plainText, clipboard)
}

async function readTableClipboard(
  clipboard: ClipboardTextApi | undefined
): Promise<TableClipboardInput> {
  if (clipboard?.read) {
    try {
      const items = await clipboard.read()
      const input: TableClipboardInput = { plainText: '', html: '', richText: '' }
      for (const item of items) {
        if (!input.richText && item.types.includes(TABLE_RANGE_CLIPBOARD_MIME)) {
          input.richText = await (await item.getType(TABLE_RANGE_CLIPBOARD_MIME)).text()
        }
        if (!input.html && item.types.includes('text/html')) {
          input.html = await (await item.getType('text/html')).text()
        }
        if (!input.plainText && item.types.includes('text/plain')) {
          input.plainText = await (await item.getType('text/plain')).text()
        }
      }
      if (input.plainText || input.html || input.richText) return input
    } catch {
      // Fall through to readText for browsers that expose read() but deny rich formats.
    }
  }
  if (!clipboard?.readText) throw new Error('Clipboard read is unavailable')
  return { plainText: await clipboard.readText(), html: '', richText: '' }
}

function getDuplicateColumnName(name: string, columns: ColumnSchema[]): string {
  const existingNames = new Set(columns.map(column => column.name))
  const baseName = (name || 'column').replace(/-\d+$/, '')
  let suffix = 1
  while (existingNames.has(`${baseName}-${suffix}`)) suffix += 1
  return `${baseName}-${suffix}`
}

// Main table component

export interface TableDataPastePreviewRequest {
  request: TableImportRequest
  anchor: TableCellCoordinate
  schema: TableSchema
  data: unknown[]
  reasons: string[]
}

interface TableEditorProps {
  op: TableEditorOp
  data: unknown[]
  schema: TableSchema
  onDataChange: (data: unknown[], description?: string) => void
  onSchemaChange: (schema: TableSchema, data?: unknown[]) => void
  onDataPastePreview?: (request: TableDataPastePreviewRequest) => void
  /** Injectable for deterministic tests and non-browser hosts. */
  clipboard?: ClipboardTextApi
}

export function TableEditor({
  data,
  schema,
  onDataChange,
  onSchemaChange,
  onDataPastePreview,
  clipboard: clipboardOverride,
}: TableEditorProps) {
  const [tableData, setTableData] = useState(() => validateTableData(data, schema))
  const [schemaEditorOpen, setSchemaEditorOpen] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [overlayPayload, setOverlayPayload] = useState<ParsedSchemaClipboard>()
  const [overlayPreview, setOverlayPreview] = useState<SchemaOverlayPreview>()
  const [overlayError, setOverlayError] = useState<string>()
  const [pasteCatcherOpen, setPasteCatcherOpen] = useState(false)
  const [dataPasteCatcherOpen, setDataPasteCatcherOpen] = useState(false)
  const [clipboardMessage, setClipboardMessage] = useState('')
  const [dataImportOpen, setDataImportOpen] = useState(false)
  const [dataImportRequest, setDataImportRequest] = useState<TableImportRequest>()
  const [activeCell, setActiveCell] = useState<TableCellCoordinate | null>(() =>
    data.length > 0 && schema.columns.length > 0 ? { row: 0, column: 0 } : null
  )
  const [selection, setSelection] = useState<TableCellSelection | null>(() =>
    data.length > 0 && schema.columns.length > 0
      ? { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }
      : null
  )
  const [editingCell, setEditingCell] = useState<TableCellCoordinate | null>(null)
  const [editingSeed, setEditingSeed] = useState<string>()
  const [initialNumberDrag, setInitialNumberDrag] = useState<InitialNumberDrag>()
  const overlaySourceRef = useRef<SchemaActionSource>('table_menu')
  const dataPasteAnalyticsRef = useRef<
    | {
        actionSource: 'keyboard' | 'cell_menu' | 'table_menu' | 'empty_state'
        format: string
        rowCount: number
        columnCount: number
      }
    | undefined
  >(undefined)
  const tableWrapperRef = useRef<HTMLDivElement>(null)
  const pointerSelectingRef = useRef(false)
  const pendingNumberDragCleanupRef = useRef<(() => void) | null>(null)
  const numberDragTokenRef = useRef(0)
  const activeEdit = useActiveEdit()
  const previousDataRef = useRef(data)
  const previousSchemaRef = useRef(schema)

  // Mirrors tableData so a flushed cell edit and the row mutation that triggered
  // it can both run in one tick without the second reading stale state
  const tableDataRef = useRef(tableData)
  tableDataRef.current = tableData

  const selectionRect = getSelectionRect(selection)

  const commitData = useCallback(
    (newData: unknown[], description: string) => {
      tableDataRef.current = newData
      setTableData(newData)
      onDataChange(newData, description)
    },
    [onDataChange]
  )

  useEffect(() => {
    const dataChanged = previousDataRef.current !== data
    const schemaChanged = previousSchemaRef.current !== schema

    // Commit and clear any active cell editor before external props replace the
    // table state. For a schema-only update, normalize the just-committed local
    // rows so compatible edits survive the schema transition.
    activeEdit.flush()
    const sourceData = schemaChanged && !dataChanged ? tableDataRef.current : data
    // A combined schema+data update (schema paste, undo/redo, or load) has already
    // remapped its row keys atomically. Re-running identity matching against the
    // previous schema would reject an exact-name lineage adoption by design and
    // reset the correctly remapped values. Schema-only updates still need the
    // authoritative transition helper used by direct edits.
    const transition =
      schemaChanged && dataChanged
        ? { data: validateTableData(sourceData, schema), renamedColumns: [] }
        : schemaChanged
          ? transitionTableData(sourceData, previousSchemaRef.current, schema)
          : { data: validateTableData(sourceData, schema), renamedColumns: [] }
    const newTableData = transition.data
    tableDataRef.current = newTableData
    setTableData(newTableData)

    if (schemaChanged && !dataChanged && transition.renamedColumns.length > 0) {
      onDataChange(newTableData, 'Apply table schema rename')
    }
    previousDataRef.current = data
    previousSchemaRef.current = schema
  }, [activeEdit, data, onDataChange, schema])

  useEffect(() => {
    const lastRow = tableData.length - 1
    const lastColumn = schema.columns.length - 1
    if (lastRow < 0 || lastColumn < 0) {
      setActiveCell(null)
      setSelection(null)
      setEditingCell(null)
      setEditingSeed(undefined)
      setInitialNumberDrag(undefined)
      return
    }

    const clampCoordinate = (coordinate: TableCellCoordinate): TableCellCoordinate => ({
      row: Math.max(0, Math.min(lastRow, coordinate.row)),
      column: Math.max(0, Math.min(lastColumn, coordinate.column)),
    })
    setActiveCell(current => (current ? clampCoordinate(current) : { row: 0, column: 0 }))
    setSelection(current =>
      current
        ? { anchor: clampCoordinate(current.anchor), focus: clampCoordinate(current.focus) }
        : { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }
    )
    setEditingCell(current => (current ? clampCoordinate(current) : null))
  }, [schema.columns.length, tableData.length])

  useEffect(() => {
    const endPointerSelection = () => {
      pointerSelectingRef.current = false
    }
    document.addEventListener('pointerup', endPointerSelection)
    document.addEventListener('pointercancel', endPointerSelection)
    return () => {
      document.removeEventListener('pointerup', endPointerSelection)
      document.removeEventListener('pointercancel', endPointerSelection)
      pendingNumberDragCleanupRef.current?.()
    }
  }, [])

  const addRow = () => {
    activeEdit.flush()
    const newRow: Record<string, unknown> = {}
    for (const col of schema.columns) {
      newRow[col.name] = col.defaultValue ?? getDefaultValue(col)
    }
    commitData([...tableDataRef.current, newRow], 'Add table row')
  }

  const handleSchemaChange = useCallback(
    (newSchema: TableSchema, metadata?: SchemaChangeMetadata) => {
      if (!isTableSchema(newSchema)) {
        setClipboardMessage('The table schema is invalid and was not saved')
        return
      }
      activeEdit.flush()
      const newData = transitionTableData(tableDataRef.current, schema, newSchema, {
        sourceColumnNames: metadata?.sourceColumnNames,
      }).data

      onSchemaChange(newSchema, newData)
      tableDataRef.current = newData
      setTableData(newData)
    },
    [activeEdit, onSchemaChange, schema]
  )

  const showOverlayPreview = useCallback(
    (text: string) => {
      const parsed = parseSchemaClipboard(text)
      setOverlayOpen(true)
      if (!parsed.success) {
        analytics.track('table_schema_pasted', {
          actionSource: overlaySourceRef.current,
          format: 'unknown',
          columnCount: 0,
          success: false,
        })
        setOverlayPayload(undefined)
        setOverlayPreview(undefined)
        setOverlayError(parsed.error)
        return
      }

      const columnCount =
        parsed.payload.kind === 'table-schema' ? parsed.payload.schema.columns.length : 1
      analytics.track('table_schema_pasted', {
        actionSource: overlaySourceRef.current,
        format: parsed.payload.kind,
        columnCount,
        success: true,
      })
      setOverlayError(undefined)
      setOverlayPayload(parsed.payload)
      setOverlayPreview(createSchemaOverlayPreview(schema, tableDataRef.current, parsed.payload))
    },
    [schema]
  )

  const pasteSchemaOverlay = useCallback(
    async (source: SchemaActionSource = 'table_menu') => {
      activeEdit.flush()
      overlaySourceRef.current = source
      try {
        const clipboard = clipboardOverride ?? globalThis.navigator?.clipboard
        if (!clipboard?.readText) throw new Error('Clipboard read is unavailable')
        const text = await clipboard.readText()
        showOverlayPreview(text)
      } catch {
        analytics.track('table_schema_pasted', {
          actionSource: source,
          format: 'unavailable',
          columnCount: 0,
          success: false,
        })
        setPasteCatcherOpen(true)
      }
    },
    [activeEdit, clipboardOverride, showOverlayPreview]
  )

  const copySchema = useCallback(
    (schemaToCopy: TableSchema = schema, source: SchemaActionSource = 'table_menu') => {
      try {
        const clipboard = clipboardOverride ?? globalThis.navigator?.clipboard
        const text = serializeSchemaClipboard(schemaToCopy)
        void writeClipboardText(text, clipboard)
          .then(() => {
            analytics.track('table_schema_copied', {
              actionSource: source,
              format: 'table-schema',
              columnCount: schemaToCopy.columns.length,
              success: true,
            })
            setClipboardMessage('Table schema copied')
          })
          .catch(() => {
            analytics.track('table_schema_copied', {
              actionSource: source,
              format: 'table-schema',
              columnCount: schemaToCopy.columns.length,
              success: false,
            })
            setClipboardMessage('Could not copy the table schema')
          })
      } catch {
        analytics.track('table_schema_copied', {
          actionSource: source,
          format: 'table-schema',
          columnCount: schemaToCopy.columns.length,
          success: false,
        })
        setClipboardMessage('Could not copy the table schema')
      }
    },
    [clipboardOverride, schema]
  )

  const copyColumn = useCallback(
    (column: ColumnSchema, source: SchemaActionSource = 'column_menu') => {
      try {
        const clipboard = clipboardOverride ?? globalThis.navigator?.clipboard
        const text = serializeColumnClipboard(column)
        void writeClipboardText(text, clipboard)
          .then(() => {
            analytics.track('table_schema_copied', {
              actionSource: source,
              format: 'column-schema',
              columnCount: 1,
              success: true,
            })
            setClipboardMessage(`Column schema ${column.name} copied`)
          })
          .catch(() => {
            analytics.track('table_schema_copied', {
              actionSource: source,
              format: 'column-schema',
              columnCount: 1,
              success: false,
            })
            setClipboardMessage(`Could not copy column schema ${column.name}`)
          })
      } catch {
        analytics.track('table_schema_copied', {
          actionSource: source,
          format: 'column-schema',
          columnCount: 1,
          success: false,
        })
        setClipboardMessage(`Could not copy column schema ${column.name}`)
      }
    },
    [clipboardOverride]
  )

  const renameOverlayColumn = useCallback(
    (incomingIndex: number, name: string) => {
      if (!overlayPayload) return
      const payload: ParsedSchemaClipboard =
        overlayPayload.kind === 'table-schema'
          ? {
              ...overlayPayload,
              schema: {
                columns: overlayPayload.schema.columns.map((column, index) =>
                  index === incomingIndex ? { ...column, name } : column
                ),
              },
            }
          : {
              ...overlayPayload,
              column:
                incomingIndex === 0 ? { ...overlayPayload.column, name } : overlayPayload.column,
            }
      setOverlayPayload(payload)
      setOverlayPreview(createSchemaOverlayPreview(schema, tableDataRef.current, payload))
    },
    [overlayPayload, schema]
  )

  const applyOverlay = useCallback(
    (decisions: SchemaOverlayDecisions) => {
      if (!overlayPreview) return
      activeEdit.flush()
      const appliedColumns = overlayPreview.columns.filter(
        column => (decisions[column.incomingIndex] ?? column.defaultDecision) === 'apply'
      )
      const counts = appliedColumns.reduce(
        (total, column) => ({
          preserved: total.preserved + column.counts.preserved,
          coerced: total.coerced + column.counts.coerced,
          reset: total.reset + column.counts.reset,
        }),
        { preserved: 0, coerced: 0, reset: 0 }
      )
      try {
        const result = applySchemaOverlayPreview(overlayPreview, decisions)
        tableDataRef.current = result.data
        setTableData(result.data)
        onSchemaChange(result.schema, result.data)
        analytics.track('table_schema_overlay_applied', {
          actionSource: overlaySourceRef.current,
          format: overlayPayload?.kind ?? 'unknown',
          columnCount: appliedColumns.length,
          preservedCount: counts.preserved,
          coercedCount: counts.coerced,
          resetCount: counts.reset,
          success: true,
        })
        setOverlayOpen(false)
      } catch {
        analytics.track('table_schema_overlay_applied', {
          actionSource: overlaySourceRef.current,
          format: overlayPayload?.kind ?? 'unknown',
          columnCount: appliedColumns.length,
          preservedCount: counts.preserved,
          coercedCount: counts.coerced,
          resetCount: counts.reset,
          success: false,
        })
        setOverlayError('The selected schema changes could not be applied.')
      }
    },
    [activeEdit, onSchemaChange, overlayPayload, overlayPreview]
  )

  const openSchemaEditor = useCallback(() => {
    activeEdit.flush()
    setSchemaEditorOpen(true)
  }, [activeEdit])

  const selectCell = useCallback(
    (coordinate: TableCellCoordinate, extend = false) => {
      if (!coordinatesEqual(editingCell, coordinate)) activeEdit.flush()
      setActiveCell(coordinate)
      setSelection(current => ({
        anchor: extend && current ? current.anchor : coordinate,
        focus: coordinate,
      }))
    },
    [activeEdit, editingCell]
  )

  const selectRange = useCallback(
    (anchor: TableCellCoordinate, focus: TableCellCoordinate) => {
      activeEdit.flush()
      setEditingCell(null)
      setEditingSeed(undefined)
      setInitialNumberDrag(undefined)
      setActiveCell(focus)
      setSelection({ anchor, focus })
    },
    [activeEdit]
  )

  const beginEditing = useCallback(
    (coordinate: TableCellCoordinate, seed?: string, numberDrag?: InitialNumberDrag) => {
      activeEdit.flush()
      setActiveCell(coordinate)
      setSelection({ anchor: coordinate, focus: coordinate })
      setEditingSeed(seed)
      setInitialNumberDrag(numberDrag)
      setEditingCell(coordinate)
    },
    [activeEdit]
  )

  const startNumberDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, coordinate: TableCellCoordinate) => {
      if (event.button !== 0 || event.shiftKey) return false

      pendingNumberDragCleanupRef.current?.()
      pointerSelectingRef.current = false
      selectCell(coordinate)

      const { clientX: startX, clientY: startY, pointerId } = event
      let cleanup: () => void
      const finishPendingDrag = () => cleanup()
      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY)
        if (distance <= 5) return

        cleanup()
        numberDragTokenRef.current += 1
        beginEditing(coordinate, undefined, {
          token: numberDragTokenRef.current,
          startX,
          startY,
          currentX: moveEvent.clientX,
          currentY: moveEvent.clientY,
        })
      }

      cleanup = () => {
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', finishPendingDrag)
        document.removeEventListener('pointercancel', finishPendingDrag)
        if (pendingNumberDragCleanupRef.current === cleanup) {
          pendingNumberDragCleanupRef.current = null
        }
      }
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', finishPendingDrag)
      document.addEventListener('pointercancel', finishPendingDrag)
      pendingNumberDragCleanupRef.current = cleanup
      return true
    },
    [beginEditing, selectCell]
  )

  const finishEditing = useCallback(
    (coordinate: TableCellCoordinate, advance?: EditAdvance) => {
      setEditingCell(null)
      setEditingSeed(undefined)
      setInitialNumberDrag(undefined)
      if (!advance) return

      const rowCount = tableDataRef.current.length
      const columnCount = schema.columns.length
      let next = coordinate
      if (advance === 'next-row') {
        next = { row: Math.min(rowCount - 1, coordinate.row + 1), column: coordinate.column }
      } else {
        const linearIndex = coordinate.row * columnCount + coordinate.column
        const offset = advance === 'next-column' ? 1 : -1
        const nextIndex = Math.max(0, Math.min(rowCount * columnCount - 1, linearIndex + offset))
        next = { row: Math.floor(nextIndex / columnCount), column: nextIndex % columnCount }
      }
      setActiveCell(next)
      setSelection({ anchor: next, focus: next })
    },
    [schema.columns.length]
  )

  const cancelEditing = useCallback((coordinate: TableCellCoordinate) => {
    setEditingCell(null)
    setEditingSeed(undefined)
    setInitialNumberDrag(undefined)
    setActiveCell(coordinate)
    setSelection({ anchor: coordinate, focus: coordinate })
  }, [])

  const clearRange = useCallback(
    (rect: TableSelectionRect) => {
      activeEdit.flush()
      const nextData = tableDataRef.current.map((rawRow, rowIndex) => {
        if (rowIndex < rect.firstRow || rowIndex > rect.lastRow) return rawRow
        const nextRow = { ...(rawRow as Record<string, unknown>) }
        for (let columnIndex = rect.firstColumn; columnIndex <= rect.lastColumn; columnIndex += 1) {
          const column = schema.columns[columnIndex]
          if (column) nextRow[column.name] = column.defaultValue ?? getDefaultValue(column)
        }
        return nextRow
      })
      commitData(nextData, 'Clear table selection')
    },
    [activeEdit, commitData, schema.columns]
  )

  const clearSelection = useCallback(() => {
    const rect = getSelectionRect(selection)
    if (rect) clearRange(rect)
  }, [clearRange, selection])

  const serializeRange = useCallback(
    (rect: TableSelectionRect, includeColumnNames = false) => {
      const columns = schema.columns.slice(rect.firstColumn, rect.lastColumn + 1)
      const rows = tableDataRef.current.slice(rect.firstRow, rect.lastRow + 1).map(rawRow => {
        const row = rawRow as Record<string, unknown>
        return columns.map(column => row[column.name])
      })
      return serializeTableRangeClipboard(columns, rows, { includeColumnNames })
    },
    [schema.columns]
  )

  const copyRange = useCallback(
    async (
      rect: TableSelectionRect,
      includeColumnNames: boolean,
      actionSource: 'cell_menu' | 'column_menu' | 'table_menu' | 'keyboard'
    ) => {
      const serialized = serializeRange(rect, includeColumnNames)
      const rowCount = rect.lastRow - rect.firstRow + 1
      const columnCount = rect.lastColumn - rect.firstColumn + 1
      try {
        const clipboard = clipboardOverride ?? globalThis.navigator?.clipboard
        await writeTableRangeClipboard(serialized, clipboard)
        analytics.track('table_data_copied', {
          actionSource,
          format: 'table-range',
          rowCount,
          columnCount,
          success: true,
        })
        setClipboardMessage(`${rowCount} × ${columnCount} table range copied`)
      } catch {
        analytics.track('table_data_copied', {
          actionSource,
          format: 'table-range',
          rowCount,
          columnCount,
          success: false,
        })
        setClipboardMessage('Could not copy the selected table range')
      }
    },
    [clipboardOverride, serializeRange]
  )

  const handleGridCopy = useCallback(
    (event: React.ClipboardEvent<HTMLTableElement>) => {
      if (isNativeClipboardTarget(event.target)) {
        event.stopPropagation()
        return
      }
      const rect = getSelectionRect(selection)
      if (!rect || !event.clipboardData) return
      const serialized = serializeRange(rect)
      event.preventDefault()
      event.stopPropagation()
      event.clipboardData.setData('text/plain', serialized.plainText)
      event.clipboardData.setData('text/html', serialized.html)
      try {
        event.clipboardData.setData(TABLE_RANGE_CLIPBOARD_MIME, serialized.richText)
      } catch {
        // Custom MIME types are best-effort; TSV and HTML remain interoperable.
      }
      analytics.track('table_data_copied', {
        actionSource: 'keyboard',
        format: 'table-range',
        rowCount: rect.lastRow - rect.firstRow + 1,
        columnCount: rect.lastColumn - rect.firstColumn + 1,
        success: true,
      })
    },
    [selection, serializeRange]
  )

  const createBlankImportRequest = useCallback(
    (parsed: ParsedTableDataClipboard): TableImportRequest =>
      createTableImportDialogRequest(parsed, 'blank'),
    []
  )

  const createOverflowImportRequest = useCallback(
    (
      parsed: ParsedTableDataClipboard,
      plan: AnchoredTablePastePlan,
      reasons: string[]
    ): TableImportRequest => ({
      mode: 'overflow',
      format: parsed.format,
      defaultFirstRowContainsHeaders: false,
      firstRowContainsHeadersEditable: !(parsed.columns?.length || parsed.columnNames?.length),
      editableColumnStart: schema.columns.length,
      reasons,
      createPreview: firstRowContainsHeaders => {
        const hasExplicitMetadata = Boolean(parsed.columns?.length || parsed.columnNames?.length)
        const sourceRows =
          firstRowContainsHeaders && !hasExplicitMetadata
            ? plan.sourceRows.slice(1)
            : plan.sourceRows
        const inferred = inferTableData(plan.sourceRows, {
          firstRowContainsHeaders,
          columnNames: parsed.columnNames,
          columns: parsed.columns,
        })
        const replanned = planAnchoredTablePaste(
          schema,
          tableDataRef.current,
          sourceRows,
          plan.anchor
        )
        const inBoundsSourceColumns = Math.max(0, schema.columns.length - plan.anchor.column)
        const incomingOverflow = inferred.schema.columns.slice(inBoundsSourceColumns)
        const normalizedNames = normalizeTableColumnNames([
          ...schema.columns.map(column => column.name),
          ...incomingOverflow.map(column => column.name),
        ])
        const existingIds = new Set(
          schema.columns.flatMap(column => (column.id ? [column.id] : []))
        )
        const overflowColumns = incomingOverflow.map((column, index) => {
          const id = column.id && !existingIds.has(column.id) ? column.id : undefined
          if (id) existingIds.add(id)
          return {
            ...column,
            ...(id ? { id } : { id: undefined }),
            name: normalizedNames[schema.columns.length + index],
          }
        })
        const mergedSchema: TableSchema = {
          columns: [...schema.columns, ...overflowColumns],
        }
        const mergedData = replanned.data.map(rawRow => {
          const row = { ...(rawRow as Record<string, unknown>) }
          for (const column of overflowColumns) {
            row[column.name] = cloneCellValue(column.defaultValue ?? getDefaultValue(column))
          }
          return row
        })

        for (const [sourceRowIndex, sourceRow] of sourceRows.entries()) {
          const target = mergedData[plan.anchor.row + sourceRowIndex]
          if (!target) continue
          for (const [sourceColumnIndex, value] of sourceRow.entries()) {
            const targetColumnIndex = plan.anchor.column + sourceColumnIndex
            const column = mergedSchema.columns[targetColumnIndex]
            if (!column) continue
            target[column.name] = cloneCellValue(value)
          }
        }

        return {
          format: parsed.format,
          schema: mergedSchema,
          data: mergedData,
          sourceRows,
          sourceOrigin: plan.anchor,
        }
      },
    }),
    [schema]
  )

  const openDataImportPreview = useCallback(
    (
      request: TableImportRequest,
      anchor: TableCellCoordinate,
      reasons: string[],
      analyticsDetails: typeof dataPasteAnalyticsRef.current
    ) => {
      dataPasteAnalyticsRef.current = analyticsDetails
      const previewRequest: TableDataPastePreviewRequest = {
        request,
        anchor,
        schema,
        data: tableDataRef.current,
        reasons,
      }
      if (onDataPastePreview) {
        onDataPastePreview(previewRequest)
        return
      }
      setDataImportRequest(request)
      setDataImportOpen(true)
    },
    [onDataPastePreview, schema]
  )

  const applyParsedTablePaste = useCallback(
    (
      parsed: ParsedTableDataClipboard,
      anchor: TableCellCoordinate,
      actionSource: 'keyboard' | 'cell_menu' | 'table_menu' | 'empty_state'
    ) => {
      activeEdit.flush()
      const rowCount = parsed.rows.length
      const columnCount = parsed.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
      const analyticsDetails = {
        actionSource,
        format: parsed.format,
        rowCount,
        columnCount,
      }

      if (schema.columns.length === 0) {
        openDataImportPreview(
          createBlankImportRequest(parsed),
          anchor,
          ['A schema must be created for the pasted data.'],
          analyticsDetails
        )
        return
      }

      const plan = planAnchoredTablePaste(schema, tableDataRef.current, parsed.rows, anchor)
      if (plan.needsPreview) {
        const reasons = []
        if (plan.overflowColumnCount > 0) {
          reasons.push(
            `${plan.overflowColumnCount} pasted column${plan.overflowColumnCount === 1 ? ' extends' : 's extend'} beyond the table.`
          )
        }
        if (plan.counts.reset > 0) {
          reasons.push(
            `${plan.counts.reset} value${plan.counts.reset === 1 ? '' : 's'} cannot be converted without resetting.`
          )
        }
        openDataImportPreview(
          createOverflowImportRequest(parsed, plan, reasons),
          anchor,
          reasons,
          analyticsDetails
        )
        return
      }

      commitData(plan.data, 'Paste table data')
      const lastRow = Math.min(plan.data.length - 1, anchor.row + Math.max(0, plan.rowCount - 1))
      const lastColumn = Math.min(
        schema.columns.length - 1,
        anchor.column + Math.max(0, plan.columnCount - 1)
      )
      selectRange(anchor, { row: lastRow, column: lastColumn })
      analytics.track('table_data_pasted', { ...analyticsDetails, success: true })
    },
    [
      activeEdit,
      commitData,
      createBlankImportRequest,
      createOverflowImportRequest,
      openDataImportPreview,
      schema,
      selectRange,
    ]
  )

  const routeTableClipboard = useCallback(
    (
      input: TableClipboardInput,
      actionSource: 'keyboard' | 'cell_menu' | 'table_menu' | 'empty_state',
      anchor: TableCellCoordinate
    ) => {
      const parsed = parseTableClipboard(input, {
        allowScalar: schema.columns.length > 0 && tableDataRef.current.length > 0,
      })
      if (parsed.kind === 'table') {
        applyParsedTablePaste(parsed, anchor, actionSource)
        return
      }
      if (parsed.kind === 'schema') {
        overlaySourceRef.current = actionSource === 'cell_menu' ? 'column_menu' : 'table_menu'
        showOverlayPreview(input.plainText)
        return
      }
      setClipboardMessage(
        parsed.kind === 'graph'
          ? 'Graph nodes cannot be pasted into a selected table range'
          : 'The clipboard does not contain table data'
      )
      analytics.track('table_data_pasted', {
        actionSource,
        format: parsed.kind,
        rowCount: 0,
        columnCount: 0,
        success: false,
      })
    },
    [applyParsedTablePaste, schema.columns.length, showOverlayPreview]
  )

  const pasteTableDataFromClipboard = useCallback(
    async (
      actionSource: 'cell_menu' | 'table_menu' | 'empty_state',
      anchor = activeCell ?? { row: 0, column: 0 }
    ) => {
      activeEdit.flush()
      try {
        const clipboard = clipboardOverride ?? globalThis.navigator?.clipboard
        const input = await readTableClipboard(clipboard)
        routeTableClipboard(input, actionSource, anchor)
      } catch {
        dataPasteAnalyticsRef.current = {
          actionSource,
          format: 'unavailable',
          rowCount: 0,
          columnCount: 0,
        }
        setDataPasteCatcherOpen(true)
      }
    },
    [activeCell, activeEdit, clipboardOverride, routeTableClipboard]
  )

  const handleGridPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTableElement>) => {
      if (isNativeClipboardTarget(event.target)) {
        event.stopPropagation()
        return
      }
      if (!activeCell) return
      event.preventDefault()
      event.stopPropagation()
      const rect = getSelectionRect(selection)
      routeTableClipboard(
        {
          plainText: event.clipboardData.getData('text/plain'),
          html: event.clipboardData.getData('text/html'),
          richText: event.clipboardData.getData(TABLE_RANGE_CLIPBOARD_MIME),
        },
        'keyboard',
        rect ? { row: rect.firstRow, column: rect.firstColumn } : activeCell
      )
    },
    [activeCell, routeTableClipboard, selection]
  )

  const getCellActions = useCallback(
    (coordinate: TableCellCoordinate): SchemaAction[] => {
      const currentRect = getSelectionRect(selection)
      const rect = coordinateInRect(coordinate, currentRect)
        ? (currentRect as TableSelectionRect)
        : {
            firstRow: coordinate.row,
            lastRow: coordinate.row,
            firstColumn: coordinate.column,
            lastColumn: coordinate.column,
          }
      const anchor = { row: rect.firstRow, column: rect.firstColumn }
      return [
        {
          label: 'Copy',
          icon: 'pi-copy',
          onSelect: () => void copyRange(rect, false, 'cell_menu'),
        },
        {
          label: 'Copy with Column Names',
          icon: 'pi-copy',
          onSelect: () => void copyRange(rect, true, 'cell_menu'),
        },
        {
          label: 'Paste',
          icon: 'pi-download',
          onSelect: () => void pasteTableDataFromClipboard('cell_menu', anchor),
        },
        {
          label: 'Clear Selection',
          icon: 'pi-eraser',
          onSelect: () => clearRange(rect),
        },
      ]
    },
    [clearRange, copyRange, pasteTableDataFromClipboard, selection]
  )

  const getColumnActions = useCallback(
    (column: ColumnSchema, index: number): SchemaAction[] => [
      {
        label: 'Copy Column Values',
        icon: 'pi-copy',
        onSelect: () => {
          if (tableDataRef.current.length === 0) return
          void copyRange(
            {
              firstRow: 0,
              lastRow: tableDataRef.current.length - 1,
              firstColumn: index,
              lastColumn: index,
            },
            false,
            'column_menu'
          )
        },
      },
      { label: 'Edit Column', icon: 'pi-pencil', onSelect: openSchemaEditor },
      {
        label: 'Copy Column Schema',
        icon: 'pi-copy',
        onSelect: () => copyColumn(column, 'column_menu'),
      },
      {
        label: 'Paste Column Schema Overlay',
        icon: 'pi-download',
        onSelect: () => void pasteSchemaOverlay('column_menu'),
      },
      {
        label: 'Duplicate Column',
        icon: 'pi-clone',
        onSelect: () => {
          const duplicate: ColumnSchema = {
            ...column,
            id: crypto.randomUUID(),
            name: getDuplicateColumnName(column.name, schema.columns),
            ...(column.options && { options: { ...column.options } }),
            defaultValue: Array.isArray(column.defaultValue)
              ? [...column.defaultValue]
              : column.defaultValue,
          }
          const columns = [...schema.columns]
          columns.splice(index + 1, 0, duplicate)
          const sourceColumnNames = schema.columns.map(item => item.name)
          sourceColumnNames.splice(index + 1, 0, column.name)
          handleSchemaChange({ columns }, { sourceColumnNames })
        },
      },
      {
        label: 'Delete Column',
        icon: 'pi-trash',
        danger: true,
        onSelect: () =>
          handleSchemaChange({
            columns: schema.columns.filter((_, itemIndex) => itemIndex !== index),
          }),
      },
    ],
    [copyColumn, copyRange, handleSchemaChange, openSchemaEditor, pasteSchemaOverlay, schema]
  )

  const tableSchemaActions = useMemo<SchemaAction[]>(
    () => [
      {
        label: 'Copy All Data',
        icon: 'pi-copy',
        onSelect: () => {
          if (tableDataRef.current.length === 0 || schema.columns.length === 0) return
          void copyRange(
            {
              firstRow: 0,
              lastRow: tableDataRef.current.length - 1,
              firstColumn: 0,
              lastColumn: schema.columns.length - 1,
            },
            true,
            'table_menu'
          )
        },
      },
      {
        label: 'Paste Data',
        icon: 'pi-download',
        onSelect: () => {
          const rect = getSelectionRect(selection)
          const anchor = rect
            ? { row: rect.firstRow, column: rect.firstColumn }
            : (activeCell ?? { row: 0, column: 0 })
          void pasteTableDataFromClipboard('table_menu', anchor)
        },
      },
      { label: 'Edit Schema', icon: 'pi-pencil', onSelect: openSchemaEditor },
      {
        label: 'Copy Schema',
        icon: 'pi-copy',
        onSelect: () => copySchema(schema, 'table_menu'),
      },
      {
        label: 'Paste Schema Overlay',
        icon: 'pi-download',
        onSelect: () => void pasteSchemaOverlay('table_menu'),
      },
    ],
    [
      activeCell,
      copyRange,
      copySchema,
      openSchemaEditor,
      pasteSchemaOverlay,
      pasteTableDataFromClipboard,
      schema,
      selection,
    ]
  )

  const columnHelper = createColumnHelper<Record<string, unknown>>()
  const columnIndexById = new Map(
    schema.columns.map((_, columnIndex) => [getDataColumnId(columnIndex), columnIndex])
  )

  // Add row number column and action column
  const columns: ColumnDef<Record<string, unknown>>[] = [
    columnHelper.display({
      id: ROW_NUMBER_COLUMN_ID,
      header: '#',
      cell: props => <div className={s.rowNumber}>{props.row.index + 1}</div>,
      size: 50,
    }),
    ...schema.columns.map((colSchema, columnIndex) =>
      columnHelper.accessor(row => row[colSchema.name], {
        id: getDataColumnId(columnIndex),
        header: () => (
          <ColumnHeader
            name={colSchema.name}
            actions={getColumnActions(colSchema, schema.columns.indexOf(colSchema))}
          />
        ),
        cell: EditableCell,
      })
    ),
    columnHelper.display({
      id: ROW_ACTIONS_COLUMN_ID,
      header: () => <SchemaDropdownMenu label="Table actions" actions={tableSchemaActions} />,
      cell: props => (
        <Button
          icon="pi pi-trash"
          className={`p-button-text p-button-sm ${s.deleteButton}`}
          // Suppress the editor blur so unmounting it doesn't reflow the row and
          // move this button out from under the pointer before mouseup lands
          onMouseDown={e => e.preventDefault()}
          onClick={() => props.table.options.meta?.deleteRow?.(props.row.index)}
          tooltip="Delete row"
          aria-label="Delete row"
        />
      ),
      size: 50,
    }),
  ]

  const table = useReactTable<Record<string, unknown>>({
    data: tableData as Array<Record<string, unknown>>,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData: (rowIndex: number, columnIndex: number, value: unknown) => {
        const columnSchema = schema.columns[columnIndex]
        if (!columnSchema) return
        // Only update if value actually changed
        const currentData = tableDataRef.current
        const currentRow = currentData[rowIndex] as Record<string, unknown> | undefined
        const currentValue = currentRow?.[columnSchema.name]
        if (currentValue === value) {
          return
        }
        const newData = [...currentData]
        newData[rowIndex] = {
          ...(newData[rowIndex] as Record<string, unknown>),
          [columnSchema.name]: value,
        }
        commitData(newData, `Edit cell ${columnSchema.name}`)
      },
      deleteRow: (rowIndex: number) => {
        activeEdit.flush()
        const newData = tableDataRef.current.filter((_, index) => index !== rowIndex)
        commitData(newData, 'Delete table row')
      },
      schema,
      activeEdit,
      columnIndexById,
      editingCell,
      editingSeed,
      initialNumberDrag,
      finishEditing,
      cancelEditing,
    },
  })

  const tableRows = table.getRowModel().rows
  const virtualizeRows = tableRows.length > 200
  const rowVirtualizer = useVirtualizer({
    count: virtualizeRows ? tableRows.length : 0,
    getScrollElement: () => tableWrapperRef.current,
    estimateSize: () => 36,
    overscan: 10,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const renderedRowIndexes = virtualizeRows
    ? virtualRows.map(virtualRow => virtualRow.index)
    : tableRows.map((_, rowIndex) => rowIndex)
  const virtualPaddingTop =
    virtualizeRows && virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0
  const virtualPaddingBottom =
    virtualizeRows && virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0

  const moveActiveCell = useCallback(
    (rowOffset: number, columnOffset: number, extend: boolean) => {
      if (tableDataRef.current.length === 0 || schema.columns.length === 0) return
      activeEdit.flush()
      setEditingCell(null)
      setEditingSeed(undefined)
      const current = activeCell ?? { row: 0, column: 0 }
      const next = {
        row: Math.max(0, Math.min(tableDataRef.current.length - 1, current.row + rowOffset)),
        column: Math.max(0, Math.min(schema.columns.length - 1, current.column + columnOffset)),
      }
      if (virtualizeRows) rowVirtualizer.scrollToIndex(next.row, { align: 'auto' })
      setActiveCell(next)
      setSelection(previous => ({
        anchor: extend && previous ? previous.anchor : next,
        focus: next,
      }))
    },
    [activeCell, activeEdit, rowVirtualizer, schema.columns.length, virtualizeRows]
  )

  useEffect(() => {
    if (!activeCell || editingCell) return
    const focusCell = () => {
      tableWrapperRef.current
        ?.querySelector<HTMLElement>(
          `[data-grid-row="${activeCell.row}"][data-grid-column="${activeCell.column}"]`
        )
        ?.focus({ preventScroll: true })
    }
    if (virtualizeRows) {
      rowVirtualizer.scrollToIndex(activeCell.row, { align: 'auto' })
      requestAnimationFrame(focusCell)
    } else {
      focusCell()
    }
  }, [activeCell, editingCell, rowVirtualizer, virtualizeRows])

  const handleCellKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableCellElement>, coordinate: TableCellCoordinate) => {
      if (coordinatesEqual(editingCell, coordinate)) return
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          moveActiveCell(
            event.ctrlKey || event.metaKey ? -tableDataRef.current.length : -1,
            0,
            event.shiftKey
          )
          return
        case 'ArrowDown':
          event.preventDefault()
          moveActiveCell(
            event.ctrlKey || event.metaKey ? tableDataRef.current.length : 1,
            0,
            event.shiftKey
          )
          return
        case 'ArrowLeft':
          event.preventDefault()
          moveActiveCell(0, -1, event.shiftKey)
          return
        case 'ArrowRight':
          event.preventDefault()
          moveActiveCell(0, 1, event.shiftKey)
          return
        case 'Enter':
        case 'F2':
          event.preventDefault()
          beginEditing(coordinate)
          return
        case 'Escape':
          event.preventDefault()
          selectCell(coordinate)
          return
        case 'Backspace':
        case 'Delete':
          event.preventDefault()
          clearSelection()
          return
        case 'Tab':
          event.preventDefault()
          moveActiveCell(0, event.shiftKey ? -1 : 1, false)
          return
        default:
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            beginEditing(coordinate, event.key)
          }
      }
    },
    [beginEditing, clearSelection, editingCell, moveActiveCell, selectCell]
  )

  const schemaDialogs = (
    <>
      <SchemaEditorDialog
        schema={schema}
        onChange={handleSchemaChange}
        trigger={null}
        open={schemaEditorOpen}
        onOpenChange={setSchemaEditorOpen}
        onCopySchema={schemaToCopy => copySchema(schemaToCopy, 'schema_editor')}
        onPasteSchema={() => void pasteSchemaOverlay('schema_editor')}
        onCopyColumn={column => copyColumn(column, 'schema_editor')}
        onPasteColumn={() => void pasteSchemaOverlay('schema_editor')}
      />
      <SchemaOverlayDialog
        open={overlayOpen}
        preview={overlayPreview}
        error={overlayError}
        onOpenChange={setOverlayOpen}
        onRenameIncoming={renameOverlayColumn}
        onApply={applyOverlay}
      />
      <ClipboardPasteDialog
        open={pasteCatcherOpen}
        onOpenChange={setPasteCatcherOpen}
        onPasteText={showOverlayPreview}
      />
      <ClipboardPasteDialog
        open={dataPasteCatcherOpen}
        onOpenChange={setDataPasteCatcherOpen}
        onPasteText={text => {
          const rect = getSelectionRect(selection)
          routeTableClipboard(
            { plainText: text, html: '', richText: '' },
            dataPasteAnalyticsRef.current?.actionSource ?? 'table_menu',
            rect
              ? { row: rect.firstRow, column: rect.firstColumn }
              : (activeCell ?? { row: 0, column: 0 })
          )
        }}
        title="Paste Table Data"
        description="Clipboard access is unavailable. Press Cmd+V or Ctrl+V in the field below."
        ariaLabel="Paste table data"
        placeholder="Paste table data here"
      />
      <TableImportDialog
        open={dataImportOpen}
        request={dataImportRequest}
        onOpenChange={setDataImportOpen}
        onConfirm={result => {
          activeEdit.flush()
          tableDataRef.current = result.data
          setTableData(result.data)
          onSchemaChange(result.schema, result.data)
          const details = dataPasteAnalyticsRef.current
          analytics.track('table_data_pasted', {
            actionSource: details?.actionSource ?? 'table_menu',
            format: details?.format ?? result.format,
            rowCount: details?.rowCount ?? result.data.length,
            columnCount: details?.columnCount ?? result.schema.columns.length,
            success: true,
          })
          setDataImportOpen(false)
        }}
      />
      <span className={s.visuallyHidden} role="status" aria-live="polite">
        {clipboardMessage}
      </span>
    </>
  )

  if (!tableData || tableData.length === 0) {
    return (
      <>
        <SchemaContextMenu actions={tableSchemaActions}>
          <div className={s.emptyState}>
            <p>No data. Add rows to get started.</p>
            <div className={s.emptyActions}>
              <Button
                label="Paste Data"
                icon="pi pi-download"
                onClick={() =>
                  void pasteTableDataFromClipboard('empty_state', { row: 0, column: 0 })
                }
              />
              <Button
                label="Add Row"
                icon="pi pi-plus"
                className="p-button-text"
                onClick={addRow}
              />
              <Button
                label="Edit Schema"
                icon="pi pi-pencil"
                className="p-button-text"
                onClick={openSchemaEditor}
              />
              <SchemaDropdownMenu label="Table actions" actions={tableSchemaActions} />
            </div>
          </div>
        </SchemaContextMenu>
        {schemaDialogs}
      </>
    )
  }

  return (
    <>
      <SchemaContextMenu actions={tableSchemaActions}>
        <div className={s.tableContainer}>
          <div
            ref={tableWrapperRef}
            className={s.tableWrapper}
            onScrollCapture={() => {
              if (editingCell) activeEdit.flush()
            }}
          >
            <table
              {...getGridAccessibilityProps(tableData.length + 1, schema.columns.length + 2)}
              className={cx(s.table, 'nokey')}
              data-table-editor-grid="true"
              onCopy={handleGridCopy}
              onPaste={handleGridPaste}
            >
              <thead>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header, visibleColumnIndex) => {
                      const columnIndex = columnIndexById.get(header.column.id)
                      const isCorner = header.column.id === ROW_NUMBER_COLUMN_ID
                      const isSelected =
                        columnIndex !== undefined &&
                        selectionRect?.firstColumn === columnIndex &&
                        selectionRect.lastColumn === columnIndex &&
                        selectionRect.firstRow === 0 &&
                        selectionRect.lastRow === tableData.length - 1
                      return (
                        <th
                          key={header.id}
                          className={cx(s.header, isSelected && s.selectedHeader)}
                          scope="col"
                          aria-colindex={visibleColumnIndex + 1}
                          aria-selected={isSelected || undefined}
                          onClick={event => {
                            if ((event.target as HTMLElement).closest('button')) return
                            if (isCorner) {
                              selectRange(
                                { row: 0, column: 0 },
                                { row: tableData.length - 1, column: schema.columns.length - 1 }
                              )
                            } else if (columnIndex !== undefined) {
                              selectRange(
                                { row: 0, column: columnIndex },
                                { row: tableData.length - 1, column: columnIndex }
                              )
                            }
                          }}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {virtualPaddingTop > 0 && (
                  <tr {...getVirtualSpacerAccessibilityProps()}>
                    <td
                      {...getVirtualSpacerAccessibilityProps()}
                      colSpan={columns.length}
                      style={{ height: virtualPaddingTop, padding: 0 }}
                    />
                  </tr>
                )}
                {renderedRowIndexes.map(rowIndex => {
                  const row = tableRows[rowIndex]
                  if (!row) return null
                  return (
                    <tr key={row.id} className={s.row} aria-rowindex={row.index + 2}>
                      {row.getVisibleCells().map(cell => {
                        const columnIndex = columnIndexById.get(cell.column.id)
                        if (columnIndex === undefined) {
                          if (cell.column.id === ROW_NUMBER_COLUMN_ID) {
                            const rowSelected =
                              selectionRect?.firstRow === row.index &&
                              selectionRect.lastRow === row.index &&
                              selectionRect.firstColumn === 0 &&
                              selectionRect.lastColumn === schema.columns.length - 1
                            return (
                              <th
                                key={cell.id}
                                className={cx(
                                  s.cellContainer,
                                  s.rowHeader,
                                  rowSelected && s.selectedHeader
                                )}
                                scope="row"
                                aria-colindex={1}
                                aria-selected={rowSelected || undefined}
                                onClick={() =>
                                  selectRange(
                                    { row: row.index, column: 0 },
                                    { row: row.index, column: schema.columns.length - 1 }
                                  )
                                }
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </th>
                            )
                          }
                          return (
                            <td
                              {...getAuxiliaryGridCellAccessibilityProps(schema.columns.length + 1)}
                              key={cell.id}
                              className={s.cellContainer}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          )
                        }

                        const coordinate = { row: row.index, column: columnIndex }
                        const isActive = coordinatesEqual(activeCell, coordinate)
                        const isSelected = coordinateInRect(coordinate, selectionRect)
                        return (
                          <SchemaContextMenu key={cell.id} actions={getCellActions(coordinate)}>
                            <td
                              {...getGridCellAccessibilityProps(columnIndex, isSelected)}
                              className={cx(
                                s.cellContainer,
                                isSelected && s.selectedCell,
                                isActive && s.activeCell
                              )}
                              tabIndex={
                                isActive && !coordinatesEqual(editingCell, coordinate) ? 0 : -1
                              }
                              data-grid-row={row.index}
                              data-grid-column={columnIndex}
                              onContextMenuCapture={() => {
                                if (!isSelected) selectCell(coordinate)
                              }}
                              onPointerDown={event => {
                                if (event.button !== 0) return
                                if (
                                  schema.columns[columnIndex]?.type === 'number' &&
                                  startNumberDrag(event, coordinate)
                                ) {
                                  return
                                }
                                pointerSelectingRef.current = true
                                selectCell(coordinate, event.shiftKey)
                              }}
                              onPointerEnter={() => {
                                if (!pointerSelectingRef.current) return
                                setActiveCell(coordinate)
                                setSelection(current => ({
                                  anchor: current?.anchor ?? coordinate,
                                  focus: coordinate,
                                }))
                              }}
                              onClick={event => selectCell(coordinate, event.shiftKey)}
                              onDoubleClick={() => beginEditing(coordinate)}
                              onKeyDown={event => handleCellKeyDown(event, coordinate)}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          </SchemaContextMenu>
                        )
                      })}
                    </tr>
                  )
                })}
                {virtualPaddingBottom > 0 && (
                  <tr {...getVirtualSpacerAccessibilityProps()}>
                    <td
                      {...getVirtualSpacerAccessibilityProps()}
                      colSpan={columns.length}
                      style={{ height: virtualPaddingBottom, padding: 0 }}
                    />
                  </tr>
                )}
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
              {tableData.length} row{tableData.length !== 1 ? 's' : ''} × {schema.columns.length}{' '}
              column
              {schema.columns.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </SchemaContextMenu>
      {schemaDialogs}
    </>
  )
}
