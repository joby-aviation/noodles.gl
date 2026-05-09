import { InputText } from 'primereact/inputtext'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import type { Field, IField } from '../fields'
import type { OpId } from '../utils/id-utils'
import { usePropertyHistory } from '../utils/property-history'
import { AttributeToggle, type AttributeMode } from './attribute-toggle'
import s from '../noodles.module.css'

interface AttributeFieldWrapperProps {
  id: OpId
  field: Field<IField>
  disabled: boolean
  children: ReactNode
}

function isAttributeReference(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'attributeName' in value &&
    typeof (value as { attributeName: unknown }).attributeName === 'string'
  )
}

function isExpression(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'expression' in value &&
    typeof (value as { expression: unknown }).expression === 'string'
  )
}

function getAttributeMode(value: unknown): AttributeMode {
  if (isAttributeReference(value)) return 'attribute'
  if (isExpression(value)) return 'expression'
  return 'uniform'
}

export function AttributeFieldWrapper({
  id,
  field,
  disabled,
  children,
}: AttributeFieldWrapperProps) {
  const { captureStart, commitChange } = usePropertyHistory()
  const [mode, setMode] = useState<AttributeMode>(() => getAttributeMode(field.value))
  const [attributeName, setAttributeName] = useState<string>('')
  const [expressionValue, setExpressionValue] = useState<string>('')

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      const newMode = getAttributeMode(newVal)
      setMode(newMode)

      if (isAttributeReference(newVal)) {
        setAttributeName((newVal as { attributeName: string }).attributeName)
      } else if (isExpression(newVal)) {
        setExpressionValue((newVal as { expression: string }).expression)
      }
    })
    return () => sub.unsubscribe()
  }, [field])

  const handleModeChange = useCallback(
    (newMode: AttributeMode) => {
      captureStart()

      // Batch setValue calls to prevent cascading updates
      field.beginBatch()

      if (newMode === 'uniform') {
        const defaultValue = (field.constructor as typeof Field).defaultValue
        field.setValue(defaultValue)
      } else if (newMode === 'attribute') {
        const defaultAttr = field.defaultAttribute || 'value'
        setAttributeName(defaultAttr)
        field.setValue({ attributeName: defaultAttr })
      } else if (newMode === 'expression') {
        const defaultExpr = 'd.value'
        setExpressionValue(defaultExpr)
        field.setValue({ expression: defaultExpr })
      }

      field.endBatch()

      commitChange(`Change to ${newMode} mode`)
      setMode(newMode)
    },
    [field, captureStart, commitChange]
  )

  const handleAttributeNameChange = useCallback(
    (name: string) => {
      setAttributeName(name)
      field.setValue({ attributeName: name })
    },
    [field]
  )

  const handleExpressionChange = useCallback(
    (expr: string) => {
      setExpressionValue(expr)
      field.setValue({ expression: expr })
    },
    [field]
  )

  if (!field.defaultAttribute) {
    return <>{children}</>
  }

  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel} htmlFor={id}>
        {id}
        <AttributeToggle mode={mode} onChange={handleModeChange} disabled={disabled} />
      </label>

      {mode === 'uniform' && children}

      {mode === 'attribute' && (
        <InputText
          id={id}
          value={attributeName}
          onChange={e => handleAttributeNameChange(e.target.value)}
          onBlur={() => commitChange('Change attribute name')}
          onFocus={captureStart}
          disabled={disabled}
          placeholder={field.defaultAttribute}
          className={s.fieldInput}
          title={`Read from attribute: ${attributeName || field.defaultAttribute}`}
        />
      )}

      {mode === 'expression' && (
        <InputText
          id={id}
          value={expressionValue}
          onChange={e => handleExpressionChange(e.target.value)}
          onBlur={() => commitChange('Change expression')}
          onFocus={captureStart}
          disabled={disabled}
          placeholder="d.value"
          className={s.fieldInput}
          title={`Expression: ${expressionValue}`}
        />
      )}
    </div>
  )
}
