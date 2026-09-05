import * as Dialog from '@radix-ui/react-dialog'
import { Button } from 'primereact/button'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import { useEffect, useState } from 'react'
import type { ColumnSchema, ColumnType, DateTimeValue, TableSchema } from '../table-schema'
import { getDefaultValue, validateValue } from '../table-schema'
import { getTimezoneOptions } from '../utils/timezone-utils'
import { ColorSwatch } from './color-swatch'
import s from './schema-editor-dialog.module.css'

interface SchemaEditorDialogProps {
  schema: TableSchema
  onChange: (schema: TableSchema, metadata?: SchemaChangeMetadata) => void
  onClose?: () => void
}

export interface SchemaChangeMetadata {
  // Aligned with the new schema, so renamed and duplicated columns can retain source values.
  sourceColumnNames: Array<string | undefined>
}

const COLUMN_TYPES: Array<{ label: string; value: ColumnType }> = [
  { label: 'Number', value: 'number' },
  { label: 'String', value: 'string' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Color', value: 'color' },
  { label: 'Point 2D', value: 'point2d' },
  { label: 'Point 3D', value: 'point3d' },
  { label: 'Vector 2D', value: 'vec2' },
  { label: 'Vector 3D', value: 'vec3' },
  { label: 'Date', value: 'date' },
  { label: 'Date & Time', value: 'dateTime' },
  { label: 'String Literal', value: 'stringLiteral' },
]

interface ColumnEditorProps {
  column: ColumnSchema
  onChange: (column: ColumnSchema) => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

interface ColumnDraft {
  column: ColumnSchema
  sourceName?: string
}

function normalizeColumnDefault(column: ColumnSchema): ColumnSchema {
  if (column.defaultValue !== undefined && validateValue(column.defaultValue, column)) {
    return column
  }

  return { ...column, defaultValue: getDefaultValue(column) }
}

function createColumnDrafts(schema: TableSchema): ColumnDraft[] {
  return schema.columns.map(column => ({
    column: normalizeColumnDefault(column),
    sourceName: column.name,
  }))
}

function getDuplicateColumnName(name: string, columns: ColumnSchema[]): string {
  const existingNames = new Set(columns.map(column => column.name))
  const baseName = `${name || 'column'} copy`
  let duplicateName = baseName
  let suffix = 2

  while (existingNames.has(duplicateName)) {
    duplicateName = `${baseName} ${suffix}`
    suffix += 1
  }

  return duplicateName
}

function StringLiteralValuesInput({
  values,
  onChange,
}: {
  values: string[] | undefined
  onChange: (values: string[]) => void
}) {
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    setInputValue(values?.join(', ') ?? '')
  }, [values])

  const handleBlur = () => {
    const parsed = inputValue
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
    onChange(parsed)
  }

  return (
    <InputText
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onBlur={handleBlur}
      placeholder="option1, option2, option3"
      className={s.fullWidthInput}
    />
  )
}

function VectorDefaultEditor({
  column,
  dimensions,
  onChange,
}: {
  column: ColumnSchema
  dimensions: 2 | 3
  onChange: (defaultValue: number[]) => void
}) {
  const fallback = getDefaultValue(column) as number[]
  const value =
    Array.isArray(column.defaultValue) && column.defaultValue.length === dimensions
      ? column.defaultValue
      : fallback
  const axes = dimensions === 2 ? ['x', 'y'] : ['x', 'y', 'z']

  return (
    <div className={s.vectorDefaultInputs}>
      {axes.map((axis, index) => (
        <label key={axis}>
          {axis.toUpperCase()}:
          <InputNumber
            value={value[index] as number}
            onValueChange={event => {
              const nextValue = [...value]
              nextValue[index] = event.value ?? 0
              onChange(nextValue)
            }}
            aria-label={`Default ${axis} for ${column.name}`}
            className={s.optionInput}
          />
        </label>
      ))}
    </div>
  )
}

function DefaultValueEditor({
  column,
  onChange,
}: {
  column: ColumnSchema
  onChange: (defaultValue: unknown) => void
}) {
  const defaultValue = column.defaultValue ?? getDefaultValue(column)

  switch (column.type) {
    case 'number':
      return (
        <InputNumber
          value={defaultValue as number}
          min={column.options?.min}
          max={column.options?.max}
          step={column.options?.step ?? 1}
          onValueChange={event => onChange(event.value ?? getDefaultValue(column))}
          aria-label={`Default value for ${column.name}`}
          className={s.defaultInput}
        />
      )
    case 'string':
      return (
        <InputText
          value={defaultValue as string}
          onChange={event => onChange(event.target.value)}
          aria-label={`Default value for ${column.name}`}
          className={s.defaultInput}
        />
      )
    case 'stringLiteral': {
      const values = column.options?.values ?? []
      return values.length > 0 && !column.options?.freeform ? (
        <Dropdown
          value={defaultValue as string}
          options={values}
          onChange={event => onChange(event.value)}
          appendTo="self"
          aria-label={`Default value for ${column.name}`}
          className={s.defaultInput}
        />
      ) : (
        <InputText
          value={defaultValue as string}
          onChange={event => onChange(event.target.value)}
          aria-label={`Default value for ${column.name}`}
          className={s.defaultInput}
        />
      )
    }
    case 'boolean':
      return (
        <InputSwitch
          checked={defaultValue as boolean}
          onChange={event => onChange(event.value)}
          aria-label={`Default value for ${column.name}`}
        />
      )
    case 'color':
      return <ColorSwatch value={defaultValue as string} onChange={onChange} />
    case 'point2d':
    case 'vec2':
      return <VectorDefaultEditor column={column} dimensions={2} onChange={onChange} />
    case 'point3d':
    case 'vec3':
      return <VectorDefaultEditor column={column} dimensions={3} onChange={onChange} />
    case 'date':
      return (
        <InputText
          type="date"
          value={defaultValue as string}
          onChange={event => onChange(event.target.value)}
          aria-label={`Default value for ${column.name}`}
          className={s.defaultInput}
        />
      )
    case 'dateTime': {
      const dateTimeValue = defaultValue as DateTimeValue
      return (
        <div className={s.dateTimeDefaultInputs}>
          <InputText
            type="datetime-local"
            step={0.001}
            value={dateTimeValue.datetime}
            onChange={event => onChange({ ...dateTimeValue, datetime: event.target.value })}
            aria-label={`Default date and time for ${column.name}`}
            className={s.defaultInput}
          />
          <Dropdown
            value={dateTimeValue.timezone}
            options={getTimezoneOptions()}
            onChange={event => onChange({ ...dateTimeValue, timezone: event.value })}
            filter
            appendTo="self"
            aria-label={`Default timezone for ${column.name}`}
            className={s.timezoneDropdown}
          />
        </div>
      )
    }
  }
}

function ColumnEditor({
  column,
  onChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: ColumnEditorProps) {
  return (
    <div className={s.columnRow}>
      <div className={s.columnControls}>
        <InputText
          value={column.name}
          onChange={e => onChange({ ...column, name: e.target.value })}
          placeholder="Column name"
          className={s.columnNameInput}
        />
        <Dropdown
          value={column.type}
          options={COLUMN_TYPES}
          optionLabel="label"
          optionValue="value"
          onChange={e => {
            const newType = e.value as ColumnType
            onChange({
              ...column,
              type: newType,
              defaultValue: getDefaultValue({ name: column.name, type: newType }),
              options: undefined, // Reset options when type changes
            })
          }}
          appendTo="self"
          className={s.typeDropdown}
        />
        <div className={s.actions}>
          {onMoveUp && (
            <Button
              icon="pi pi-arrow-up"
              className="p-button-text p-button-sm"
              onClick={onMoveUp}
              disabled={!onMoveUp}
            />
          )}
          {onMoveDown && (
            <Button
              icon="pi pi-arrow-down"
              className="p-button-text p-button-sm"
              onClick={onMoveDown}
              disabled={!onMoveDown}
            />
          )}
          <Button
            icon="pi pi-copy"
            className="p-button-text p-button-sm"
            onClick={onDuplicate}
            tooltip="Duplicate column"
            aria-label={`Duplicate column ${column.name}`}
          />
          <Button
            icon="pi pi-trash"
            className="p-button-text p-button-sm p-button-danger"
            onClick={onDelete}
          />
        </div>
      </div>

      <div
        className={s.defaultValueRow}
        role="group"
        aria-label={`Default value for ${column.name}`}
      >
        <span className={s.optionLabel}>Default:</span>
        <DefaultValueEditor
          column={column}
          onChange={defaultValue => onChange({ ...column, defaultValue })}
        />
      </div>

      {column.type === 'number' && (
        <div className={s.typeOptions}>
          <label>
            Min:
            <InputNumber
              value={column.options?.min}
              onChange={e =>
                onChange({
                  ...column,
                  options: { ...column.options, min: e.value ?? undefined },
                })
              }
              placeholder="No limit"
              className={s.optionInput}
            />
          </label>
          <label>
            Max:
            <InputNumber
              value={column.options?.max}
              onChange={e =>
                onChange({
                  ...column,
                  options: { ...column.options, max: e.value ?? undefined },
                })
              }
              placeholder="No limit"
              className={s.optionInput}
            />
          </label>
          <label>
            Step:
            <InputNumber
              value={column.options?.step ?? 1}
              step={0.001}
              onChange={e =>
                onChange({
                  ...column,
                  options: { ...column.options, step: e.value ?? 1 },
                })
              }
              className={s.optionInput}
            />
          </label>
        </div>
      )}

      {column.type === 'point2d' && (
        <div className={s.typeOptions}>
          <label className={s.switchLabel}>
            <span>Geocoder:</span>
            <InputSwitch
              checked={column.options?.geocoder ?? false}
              onChange={e =>
                onChange({
                  ...column,
                  options: { ...column.options, geocoder: e.value },
                })
              }
            />
          </label>
        </div>
      )}

      {column.type === 'stringLiteral' && (
        <div className={s.typeOptions}>
          <label>
            Values (comma-separated):
            <StringLiteralValuesInput
              values={column.options?.values}
              onChange={values =>
                onChange({
                  ...column,
                  options: { ...column.options, values },
                })
              }
            />
          </label>

          <label className={s.switchLabel}>
            <span>Freeform input:</span>
            <InputSwitch
              checked={column.options?.freeform ?? false}
              onChange={e =>
                onChange({
                  ...column,
                  options: { ...column.options, freeform: e.value },
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  )
}

export function SchemaEditorDialog({ schema, onChange, onClose }: SchemaEditorDialogProps) {
  const [open, setOpen] = useState(false)
  const [columnDrafts, setColumnDrafts] = useState<ColumnDraft[]>(() => createColumnDrafts(schema))

  const handleOpen = () => {
    setColumnDrafts(createColumnDrafts(schema)) // Reset to current schema
    setOpen(true)
  }

  const handleSave = () => {
    const newSchema = { columns: columnDrafts.map(draft => draft.column) }
    const sourceColumnNames = columnDrafts.map(draft => draft.sourceName)
    const hasRemappedColumns = columnDrafts.some(
      ({ column, sourceName }) => sourceName !== undefined && sourceName !== column.name
    )

    if (hasRemappedColumns) {
      onChange(newSchema, { sourceColumnNames })
    } else {
      onChange(newSchema)
    }
    setOpen(false)
    onClose?.()
  }

  const addColumn = () => {
    const newColumn: ColumnSchema = {
      name: `column_${columnDrafts.length + 1}`,
      type: 'string',
      defaultValue: '',
    }
    setColumnDrafts([...columnDrafts, { column: newColumn }])
  }

  const updateColumn = (index: number, updates: ColumnSchema) => {
    const newDrafts = [...columnDrafts]
    newDrafts[index] = { ...newDrafts[index], column: normalizeColumnDefault(updates) }
    setColumnDrafts(newDrafts)
  }

  const duplicateColumn = (index: number) => {
    const source = columnDrafts[index]
    const duplicate: ColumnSchema = {
      ...source.column,
      name: getDuplicateColumnName(
        source.column.name,
        columnDrafts.map(draft => draft.column)
      ),
      options: source.column.options ? { ...source.column.options } : undefined,
      defaultValue: Array.isArray(source.column.defaultValue)
        ? [...source.column.defaultValue]
        : source.column.defaultValue,
    }
    const newDrafts = [...columnDrafts]
    newDrafts.splice(index + 1, 0, {
      column: duplicate,
      sourceName: source.sourceName,
    })
    setColumnDrafts(newDrafts)
  }

  const deleteColumn = (index: number) => {
    setColumnDrafts(columnDrafts.filter((_, i) => i !== index))
  }

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newDrafts = [...columnDrafts]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newDrafts.length) return

    const [moved] = newDrafts.splice(index, 1)
    newDrafts.splice(targetIndex, 0, moved)
    setColumnDrafts(newDrafts)
  }

  const addQuickTemplate = (template: 'position' | 'color' | 'latLng') => {
    let newColumns: ColumnSchema[] = []

    switch (template) {
      case 'position':
        newColumns = [
          { name: 'x', type: 'number', defaultValue: 0 },
          { name: 'y', type: 'number', defaultValue: 0 },
          { name: 'z', type: 'number', defaultValue: 0 },
        ]
        break
      case 'color':
        newColumns = [
          { name: 'r', type: 'number', defaultValue: 0, options: { min: 0, max: 255, step: 1 } },
          { name: 'g', type: 'number', defaultValue: 0, options: { min: 0, max: 255, step: 1 } },
          { name: 'b', type: 'number', defaultValue: 0, options: { min: 0, max: 255, step: 1 } },
        ]
        break
      case 'latLng':
        newColumns = [{ name: 'position', type: 'point2d', defaultValue: [0, 0] }]
        break
    }

    setColumnDrafts([...columnDrafts, ...newColumns.map(column => ({ column }))])
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          icon="pi pi-cog"
          onClick={handleOpen}
          className={`p-button-text p-button-sm ${s.trigger}`}
          tooltip="Edit Schema"
        />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          <Dialog.Title className={s.title}>Table Schema Editor</Dialog.Title>
          <Dialog.Description className={s.description}>
            Define column types and options for your table.
          </Dialog.Description>

          <div className={s.body}>
            {columnDrafts.length === 0 ? (
              <div className={s.emptyState}>
                <p>No columns defined. Add columns to get started.</p>
              </div>
            ) : (
              <div className={s.columnList}>
                {columnDrafts.map(({ column }, index) => (
                  <ColumnEditor
                    key={index}
                    column={column}
                    onChange={updated => updateColumn(index, updated)}
                    onDuplicate={() => duplicateColumn(index)}
                    onDelete={() => deleteColumn(index)}
                    onMoveUp={index > 0 ? () => moveColumn(index, 'up') : undefined}
                    onMoveDown={
                      index < columnDrafts.length - 1 ? () => moveColumn(index, 'down') : undefined
                    }
                  />
                ))}
              </div>
            )}

            <div className={s.addButtons}>
              <Button
                label="Add Column"
                icon="pi pi-plus"
                onClick={addColumn}
                className="p-button-sm"
              />
              <div className={s.templates}>
                <span className={s.templatesLabel}>Quick add:</span>
                <Button
                  label="Position XYZ"
                  onClick={() => addQuickTemplate('position')}
                  className="p-button-text p-button-sm"
                />
                <Button
                  label="Color RGB"
                  onClick={() => addQuickTemplate('color')}
                  className="p-button-text p-button-sm"
                />
                <Button
                  label="Lat/Lng"
                  onClick={() => addQuickTemplate('latLng')}
                  className="p-button-text p-button-sm"
                />
              </div>
            </div>
          </div>

          <div className={s.footer}>
            <Dialog.Close asChild>
              <Button label="Cancel" className="p-button-text" />
            </Dialog.Close>
            <Button label="Save" icon="pi pi-check" onClick={handleSave} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
