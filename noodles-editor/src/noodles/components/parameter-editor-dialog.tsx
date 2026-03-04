import * as Dialog from '@radix-ui/react-dialog'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Cross2Icon,
  EyeOpenIcon,
  PlusIcon,
  TrashIcon,
} from '@radix-ui/react-icons'
import { useEdges } from '@xyflow/react'
import { useCallback, useState } from 'react'
import type { CustomFieldDefinition, IOperator, Operator } from '../operators'
import { findFieldReferences } from '../utils/field-references'
import { debugParams } from '../../utils/debug'
import s from './parameter-editor-dialog.module.css'

interface ParameterEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  operator: Operator<IOperator>
  onSave: (definitions: CustomFieldDefinition[]) => void
}

export function ParameterEditorDialog({
  open,
  onOpenChange,
  operator,
  onSave,
}: ParameterEditorDialogProps) {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([
    ...operator.customInputDefinitions,
  ])
  const [editingField, setEditingField] = useState<string | null>(null)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const edges = useEdges()

  // Built-in field names (read-only, shown greyed out)
  const builtInFieldNames = Object.keys(operator.createInputs())

  // Validation
  const validateFieldName = useCallback(
    (name: string, excludeId?: string): string | null => {
      return operator.validateCustomFieldName(name, excludeId)
    },
    [operator]
  )

  // Add new field
  const handleAddField = useCallback(() => {
    const newDef: CustomFieldDefinition = {
      id: crypto.randomUUID(),
      name: `param${definitions.length + 1}`,
      type: 'number',
      order: definitions.length,
      defaultValue: 0,
    }
    setDefinitions([...definitions, newDef])
    setEditingField(newDef.id)
  }, [definitions])

  // Delete field
  const handleDeleteField = useCallback(
    (id: string) => {
      const def = definitions.find(d => d.id === id)
      if (!def) return

      // Check for references before deleting
      const references = findFieldReferences(operator.id, def.name, edges)
      if (references.length > 0) {
        const message =
          `This field is referenced in ${references.length} place(s):\n` +
          references.map(r => `- ${r.opId} (${r.location})`).join('\n') +
          '\n\nDeleting it may break your project. Continue?'

        if (!window.confirm(message)) {
          return
        }
      }

      setDefinitions(definitions.filter(d => d.id !== id))
      if (editingField === id) {
        setEditingField(null)
      }
    },
    [definitions, operator, edges, editingField]
  )

  // Move field up
  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return
      const newDefs = [...definitions]
      const temp = newDefs[index]
      newDefs[index] = newDefs[index - 1]
      newDefs[index - 1] = temp
      // Update order
      newDefs.forEach((def, i) => {
        def.order = i
      })
      setDefinitions(newDefs)
    },
    [definitions]
  )

  // Move field down
  const handleMoveDown = useCallback(
    (index: number) => {
      if (index === definitions.length - 1) return
      const newDefs = [...definitions]
      const temp = newDefs[index]
      newDefs[index] = newDefs[index + 1]
      newDefs[index + 1] = temp
      // Update order
      newDefs.forEach((def, i) => {
        def.order = i
      })
      setDefinitions(newDefs)
    },
    [definitions]
  )

  // Update field
  const handleUpdateField = useCallback(
    (id: string, updates: Partial<CustomFieldDefinition>) => {
      setDefinitions(definitions.map(d => (d.id === id ? { ...d, ...updates } : d)))
      // Clear error for this field if name was updated
      if (updates.name) {
        const newErrors = new Map(errors)
        newErrors.delete(id)
        setErrors(newErrors)
      }
    },
    [definitions, errors]
  )

  // Save changes
  const handleSave = useCallback(() => {
    // Validate all fields
    let hasErrors = false
    const newErrors = new Map<string, string>()

    for (const def of definitions) {
      const error = validateFieldName(def.name, def.id)
      if (error) {
        newErrors.set(def.id, error)
        hasErrors = true
      }
    }

    if (hasErrors) {
      setErrors(newErrors)
      return
    }

    debugParams('handleSave: %d definitions: %O', definitions.length, definitions)
    onSave(definitions)
    onOpenChange(false)
  }, [definitions, validateFieldName, onSave, onOpenChange])

  // Quick add templates
  const handleQuickAdd = useCallback(
    (template: FieldTemplate) => {
      const nextOrder = definitions.length
      const newDefs = template.fields.map((field, index) => ({
        ...field,
        id: crypto.randomUUID(),
        order: nextOrder + index,
      }))
      setDefinitions([...definitions, ...newDefs])
    },
    [definitions]
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>
            Edit Parameters: {operator.constructor.displayName}
          </Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Add, edit, or remove custom parameters for this operator.
          </Dialog.Description>

          <div className={s.parameterList}>
            {/* Built-in fields (read-only) */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Built-in Parameters</h3>
              {builtInFieldNames.map(name => (
                <div key={name} className={s.builtInFieldRow}>
                  <span className={s.fieldName}>{name}</span>
                  <span className={s.builtInBadge}>Built-in</span>
                </div>
              ))}
            </div>

            {/* Custom fields (editable) */}
            <div className={s.section}>
              <div className={s.sectionHeader}>
                <h3 className={s.sectionTitle}>Custom Parameters</h3>
                <button type="button" className={s.addFieldButtonSmall} onClick={handleAddField}>
                  <PlusIcon /> Add
                </button>
              </div>
              {definitions.length === 0 && (
                <p className={s.emptyMessage}>No custom parameters yet.</p>
              )}
              {definitions.map((def, index) => (
                <CustomFieldRow
                  key={def.id}
                  definition={def}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === definitions.length - 1}
                  isEditing={editingField === def.id}
                  error={errors.get(def.id)}
                  onEdit={() => setEditingField(editingField === def.id ? null : def.id)}
                  onDelete={() => handleDeleteField(def.id)}
                  onUpdate={updates => handleUpdateField(def.id, updates)}
                  onMoveUp={() => handleMoveUp(index)}
                  onMoveDown={() => handleMoveDown(index)}
                  onValidate={name => validateFieldName(name, def.id)}
                />
              ))}
            </div>

            {/* Quick add templates */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Quick Add Templates</h3>
              <div className={s.templateGrid}>
                {FIELD_TEMPLATES.map(template => (
                  <button
                    key={template.name}
                    type="button"
                    className={s.templateButton}
                    onClick={() => handleQuickAdd(template)}
                    title={template.description}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={s.dialogFooter}>
            <button type="button" className={s.cancelButton} onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button type="button" className={s.saveButton} onClick={handleSave}>
              Save Changes
            </button>
          </div>

          <Dialog.Close asChild>
            <button type="button" className={s.closeButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Custom field row component
interface CustomFieldRowProps {
  definition: CustomFieldDefinition
  index: number
  isFirst: boolean
  isLast: boolean
  isEditing: boolean
  error?: string
  onEdit: () => void
  onDelete: () => void
  onUpdate: (updates: Partial<CustomFieldDefinition>) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onValidate: (name: string) => string | null
}

function CustomFieldRow({
  definition,
  isFirst,
  isLast,
  isEditing,
  error,
  onEdit,
  onDelete,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onValidate,
}: CustomFieldRowProps) {
  return (
    <div className={s.fieldRow}>
      <div className={s.fieldContent}>
        {isEditing ? (
          <FieldEditor
            definition={definition}
            onUpdate={onUpdate}
            onValidate={onValidate}
            error={error}
          />
        ) : (
          <FieldDisplay definition={definition} />
        )}
      </div>

      <div className={s.fieldActions}>
        <button
          type="button"
          className={s.moveButton}
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
        >
          <ChevronUpIcon />
        </button>
        <button
          type="button"
          className={s.moveButton}
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
        >
          <ChevronDownIcon />
        </button>
        <button type="button" className={s.editButton} onClick={onEdit}>
          {isEditing ? 'Done' : 'Edit'}
        </button>
        <button type="button" className={s.deleteButton} onClick={onDelete} title="Delete">
          <TrashIcon />
        </button>
      </div>
    </div>
  )
}

// Field editor form
interface FieldEditorProps {
  definition: CustomFieldDefinition
  onUpdate: (updates: Partial<CustomFieldDefinition>) => void
  onValidate: (name: string) => string | null
  error?: string
}

function FieldEditor({ definition, onUpdate, onValidate, error }: FieldEditorProps) {
  const [localName, setLocalName] = useState(definition.name)
  const [localError, setLocalError] = useState<string | null>(error || null)
  const [showEnableExpression, setShowEnableExpression] = useState(!!definition.enableExpression)

  const handleNameChange = (newName: string) => {
    setLocalName(newName)
    const validationError = onValidate(newName)
    setLocalError(validationError)
    if (!validationError) {
      onUpdate({ name: newName })
    }
  }

  const handleBlur = () => {
    // Final validation on blur
    const validationError = onValidate(localName)
    if (validationError) {
      setLocalError(validationError)
    }
  }

  const handleToggleConditionalShow = () => {
    if (showEnableExpression) {
      // Turning off - clear the expression
      onUpdate({ enableExpression: undefined })
    }
    setShowEnableExpression(!showEnableExpression)
  }

  return (
    <div className={s.fieldEditor}>
      <div className={s.formRow}>
        <label className={s.label}>
          Name
          <input
            type="text"
            value={localName}
            onChange={e => handleNameChange(e.target.value)}
            onBlur={handleBlur}
            className={localError ? s.inputError : s.input}
            placeholder="Field name"
          />
          {localError && <span className={s.errorText}>{localError}</span>}
        </label>
      </div>

      <div className={s.formRow}>
        <label className={s.label}>
          Type
          <select
            value={definition.type}
            onChange={e => onUpdate({ type: e.target.value })}
            className={s.select}
          >
            <option value="number">Number</option>
            <option value="string">String</option>
            <option value="boolean">Boolean</option>
            <option value="color">Color</option>
            <option value="vec2">Vec2</option>
            <option value="vec3">Vec3</option>
            <option value="geopoint-2d">GeoPoint 2D</option>
            <option value="date">Date</option>
            <option value="expression">Expression</option>
          </select>
        </label>
      </div>

      <div className={s.formRow}>
        <div className={s.conditionalShowHeader}>
          <button
            type="button"
            className={`${s.conditionalShowToggle} ${showEnableExpression ? s.active : ''}`}
            onClick={handleToggleConditionalShow}
            title={
              showEnableExpression
                ? 'Disable conditional visibility'
                : 'Enable conditional visibility'
            }
          >
            <EyeOpenIcon />
          </button>
          <span className={s.conditionalShowLabel}>
            {showEnableExpression ? 'Conditionally Show' : 'Conditionally Show (off)'}
          </span>
        </div>
        {showEnableExpression && (
          <>
            <input
              type="text"
              value={definition.enableExpression || ''}
              onChange={e => onUpdate({ enableExpression: e.target.value || undefined })}
              className={s.input}
              placeholder="par.showAdvanced === true"
            />
            <span className={s.hintText}>
              JavaScript expression to conditionally show this field
            </span>
          </>
        )}
      </div>

      {/* Type-specific options */}
      <FieldTypeOptions definition={definition} onUpdate={onUpdate} />
    </div>
  )
}

// Field display (collapsed state)
function FieldDisplay({ definition }: { definition: CustomFieldDefinition }) {
  return (
    <div className={s.fieldDisplay}>
      <span className={s.fieldName}>{definition.name}</span>
      <span className={s.fieldType}>({definition.type})</span>
    </div>
  )
}

// Type-specific options editor
function FieldTypeOptions({
  definition,
  onUpdate,
}: {
  definition: CustomFieldDefinition
  onUpdate: (updates: Partial<CustomFieldDefinition>) => void
}) {
  const options = definition.options || {}

  if (definition.type === 'number') {
    return (
      <div className={s.typeOptions}>
        <label className={s.label}>
          Min
          <input
            type="number"
            value={options.min ?? ''}
            onChange={e =>
              onUpdate({
                options: {
                  ...options,
                  min: e.target.value ? parseFloat(e.target.value) : undefined,
                },
              })
            }
            className={s.input}
            placeholder="No limit"
          />
        </label>
        <label className={s.label}>
          Max
          <input
            type="number"
            value={options.max ?? ''}
            onChange={e =>
              onUpdate({
                options: {
                  ...options,
                  max: e.target.value ? parseFloat(e.target.value) : undefined,
                },
              })
            }
            className={s.input}
            placeholder="No limit"
          />
        </label>
        <label className={s.label}>
          Step
          <input
            type="number"
            value={options.step ?? 1}
            onChange={e =>
              onUpdate({
                options: { ...options, step: parseFloat(e.target.value) || 1 },
              })
            }
            className={s.input}
          />
        </label>
        <label className={s.label}>
          Default Value
          <input
            type="number"
            value={(definition.defaultValue as number) ?? 0}
            onChange={e => onUpdate({ defaultValue: parseFloat(e.target.value) || 0 })}
            className={s.input}
          />
        </label>
      </div>
    )
  }

  if (definition.type === 'string') {
    return (
      <div className={s.typeOptions}>
        <label className={s.label}>
          Default Value
          <input
            type="text"
            value={(definition.defaultValue as string) ?? ''}
            onChange={e => onUpdate({ defaultValue: e.target.value })}
            className={s.input}
          />
        </label>
      </div>
    )
  }

  if (definition.type === 'boolean') {
    return (
      <div className={s.typeOptions}>
        <label className={s.label}>
          Default Value
          <input
            type="checkbox"
            checked={(definition.defaultValue as boolean) ?? false}
            onChange={e => onUpdate({ defaultValue: e.target.checked })}
          />
        </label>
      </div>
    )
  }

  // Add more type-specific options as needed
  return null
}

// Field templates
interface FieldTemplate {
  name: string
  description: string
  fields: Omit<CustomFieldDefinition, 'id' | 'order'>[]
}

const FIELD_TEMPLATES: FieldTemplate[] = [
  {
    name: 'Position XYZ',
    description: 'Add X, Y, Z position parameters',
    fields: [
      { name: 'x', type: 'number', defaultValue: 0, options: { step: 0.1 } },
      { name: 'y', type: 'number', defaultValue: 0, options: { step: 0.1 } },
      { name: 'z', type: 'number', defaultValue: 0, options: { step: 0.1 } },
    ],
  },
  {
    name: 'Color RGB',
    description: 'Add R, G, B color channels',
    fields: [
      { name: 'r', type: 'number', defaultValue: 255, options: { min: 0, max: 255, step: 1 } },
      { name: 'g', type: 'number', defaultValue: 255, options: { min: 0, max: 255, step: 1 } },
      { name: 'b', type: 'number', defaultValue: 255, options: { min: 0, max: 255, step: 1 } },
    ],
  },
  {
    name: 'Lat/Lng',
    description: 'Add latitude and longitude',
    fields: [
      {
        name: 'lat',
        type: 'number',
        defaultValue: 0,
        options: { min: -90, max: 90, step: 0.00001 },
      },
      {
        name: 'lng',
        type: 'number',
        defaultValue: 0,
        options: { min: -180, max: 180, step: 0.00001 },
      },
    ],
  },
]
