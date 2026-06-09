import { InputText } from 'primereact/inputtext'
import { type ReactNode, cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react'
import { InfoCircledIcon } from '@radix-ui/react-icons'
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
  const { captureStart, commitChange} = usePropertyHistory()

  // Always compute mode from current field value (not from stale state)
  const currentValue = field.value
  const mode = getAttributeMode(currentValue)

  // Track last known uniform value to restore when switching back from attribute/expression mode
  const lastUniformValueRef = useRef(
    mode === 'uniform' ? currentValue : (field.constructor as typeof Field).defaultValue
  )

  const [attributeName, setAttributeName] = useState<string>(() =>
    isAttributeReference(currentValue) ? (currentValue as { attributeName: string }).attributeName : ''
  )
  const [expressionValue, setExpressionValue] = useState<string>(() =>
    isExpression(currentValue) ? (currentValue as { expression: string }).expression : ''
  )

  useEffect(() => {
    // Subscribe to field changes to keep local state in sync
    const sub = field.subscribe(newVal => {
      const newMode = getAttributeMode(newVal)
      if (isAttributeReference(newVal)) {
        setAttributeName((newVal as { attributeName: string }).attributeName)
      } else if (isExpression(newVal)) {
        setExpressionValue((newVal as { expression: string }).expression)
      } else if (newMode === 'uniform') {
        // Update the last known uniform value when in uniform mode
        lastUniformValueRef.current = newVal
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
        // Restore the last known uniform value instead of resetting to default
        field.setValue(lastUniformValueRef.current)
        field.autoDetected = false
      } else if (newMode === 'attribute') {
        const defaultAttr = field.defaultAttribute || 'value'
        setAttributeName(defaultAttr)
        field.setValue({ attributeName: defaultAttr })
        field.autoDetected = false
      } else if (newMode === 'expression') {
        const defaultExpr = 'd.value'
        setExpressionValue(defaultExpr)
        field.setValue({ expression: defaultExpr })
        field.autoDetected = false
      }

      field.endBatch()

      commitChange(`Change to ${newMode} mode`)
      // Mode will update automatically on next render from field.value
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
        {field.autoDetected && (
          <span
            style={{
              fontSize: '0.75rem',
              color: '#3b82f6',
              marginLeft: '0.5rem',
              fontWeight: 'normal',
            }}
            title="Auto-detected from data schema"
          >
            🔍 auto
          </span>
        )}
      </label>

      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flex: 2 }}>
        <AttributeToggle mode={mode} onChange={handleModeChange} disabled={disabled} />

        {mode === 'uniform' && isValidElement(children) && cloneElement(children, { hideLabel: true })}

        {mode === 'attribute' && (
          <InputText
            id={id}
            value={attributeName}
            onChange={e => {
              handleAttributeNameChange(e.target.value)
              field.autoDetected = false
            }}
            onBlur={() => commitChange('Change attribute name')}
            onFocus={captureStart}
            disabled={disabled}
            placeholder={field.defaultAttribute}
            className={s.fieldInput}
            style={{ flex: 1 }}
            title={field.autoDetected ? `Auto-detected from '${attributeName}' column` : `Read from attribute: ${attributeName || field.defaultAttribute}`}
          />
        )}

        {mode === 'expression' && (
          <>
            <InputText
              id={id}
              value={expressionValue}
              onChange={e => {
                handleExpressionChange(e.target.value)
                field.autoDetected = false
              }}
              onBlur={() => commitChange('Change expression')}
              onFocus={captureStart}
              disabled={disabled}
              placeholder="d.value"
              className={s.fieldInput}
              style={{ flex: 1 }}
              title={field.autoDetected ? `Auto-detected expression: ${expressionValue}` : `Expression: ${expressionValue}`}
            />
            <InfoCircledIcon
              style={{
                width: '16px',
                height: '16px',
                color: '#888',
                cursor: 'help',
                flexShrink: 0,
              }}
              title={`Expression Syntax Help:
• Access current item: d.columnName
• Multi-component: [d.lng, d.lat, 0]
• Conditionals: d.value > 100 ? [255,0,0,255] : [0,255,0,255]
• Math: d.value * 2 + 10

Available globals:
• d3 - D3.js library
• turf - Turf.js geospatial functions
• deck - Deck.gl utilities
• utils - Helper functions (getArc, hexToColor, etc.)

Examples:
• Position: [d.lng, d.lat, 0]
• Color: [d.r, d.g, d.b, 255]
• Radius: d.population / 1000`}
            />
          </>
        )}
      </div>
    </div>
  )
}
