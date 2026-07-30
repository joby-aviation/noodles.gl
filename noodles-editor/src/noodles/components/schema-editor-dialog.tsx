import * as Dialog from '@radix-ui/react-dialog'
import { Button } from 'primereact/button'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import { useState } from 'react'
import type { ColumnSchema, ColumnType, TableSchema } from '../table-schema'
import { getDefaultValue } from '../table-schema'
import s from './schema-editor-dialog.module.css'

interface SchemaEditorDialogProps {
  schema: TableSchema
  onChange: (schema: TableSchema) => void
  onClose?: () => void
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
  onDelete: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

function ColumnEditor({ column, onChange, onDelete, onMoveUp, onMoveDown }: ColumnEditorProps) {
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
            icon="pi pi-trash"
            className="p-button-text p-button-sm p-button-danger"
            onClick={onDelete}
          />
        </div>
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
            <InputText
              value={column.options?.values?.join(', ') ?? ''}
              onChange={e =>
                onChange({
                  ...column,
                  options: {
                    ...column.options,
                    values: e.target.value
                      .split(',')
                      .map(v => v.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="option1, option2, option3"
              className={s.fullWidthInput}
            />
          </label>
        </div>
      )}
    </div>
  )
}

export function SchemaEditorDialog({ schema, onChange, onClose }: SchemaEditorDialogProps) {
  const [open, setOpen] = useState(false)
  const [localSchema, setLocalSchema] = useState<TableSchema>(schema)

  const handleOpen = () => {
    setLocalSchema(schema) // Reset to current schema
    setOpen(true)
  }

  const handleSave = () => {
    onChange(localSchema)
    setOpen(false)
    onClose?.()
  }

  const addColumn = () => {
    const newColumn: ColumnSchema = {
      name: `column_${localSchema.columns.length + 1}`,
      type: 'string',
      defaultValue: '',
    }
    setLocalSchema({
      columns: [...localSchema.columns, newColumn],
    })
  }

  const updateColumn = (index: number, updates: ColumnSchema) => {
    const newColumns = [...localSchema.columns]
    newColumns[index] = updates
    setLocalSchema({ columns: newColumns })
  }

  const deleteColumn = (index: number) => {
    setLocalSchema({
      columns: localSchema.columns.filter((_, i) => i !== index),
    })
  }

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newColumns = [...localSchema.columns]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newColumns.length) return

    const [moved] = newColumns.splice(index, 1)
    newColumns.splice(targetIndex, 0, moved)
    setLocalSchema({ columns: newColumns })
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

    setLocalSchema({
      columns: [...localSchema.columns, ...newColumns],
    })
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
            {localSchema.columns.length === 0 ? (
              <div className={s.emptyState}>
                <p>No columns defined. Add columns to get started.</p>
              </div>
            ) : (
              <div className={s.columnList}>
                {localSchema.columns.map((col, index) => (
                  <ColumnEditor
                    key={index}
                    column={col}
                    onChange={updated => updateColumn(index, updated)}
                    onDelete={() => deleteColumn(index)}
                    onMoveUp={index > 0 ? () => moveColumn(index, 'up') : undefined}
                    onMoveDown={
                      index < localSchema.columns.length - 1
                        ? () => moveColumn(index, 'down')
                        : undefined
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
