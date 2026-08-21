import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import type { Edge } from '@xyflow/react'
import { useReactFlow, useStore } from '@xyflow/react'
import cx from 'classnames'
import { LayoutGrid } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { KeyframeIndicator } from '../../timeline/components/KeyframeIndicator'
import { fieldValueToKeyframeValue, getFieldPath } from '../../timeline/field-bindings'
import {
  captureTimelineState,
  fireTimelineMutation,
  getTimelineStore,
  useTimelineStore,
} from '../../timeline/timeline-store'
import type { KeyframeValue } from '../../timeline/types'
import { analytics } from '../../utils/analytics'
import {
  CompoundPropsField,
  type Field,
  type IField,
  IN_NS,
  ListField,
  OUT_NS,
  type Vec2Field,
} from '../fields'
import { useObservable } from '../hooks/use-observable'
import type { IOperator, OpType, Operator } from '../operators'
import { OutOp } from '../operators'
import { getOpStore, useNestingStore, useUIStore } from '../store'
import type { ConnectionPlan } from '../utils/auto-connect'
import { edgeId } from '../utils/id-utils'
import {
  moveEdgeWithinGroup,
  normalizeMultiInputEdges,
  orderedEdgeIdsForHandle,
} from '../utils/multi-input-utils'
import { type NodeType, createNodesForType } from '../utils/node-creation-utils'
import { getBaseName, parseHandleId } from '../utils/path-utils'
import { ErrorBoundary } from './error-boundary'
import {
  BooleanFieldComponent,
  ColorFieldComponent,
  canFieldBeDriven,
  DateFieldComponent,
  ExpressionDrivenInput,
  NumberFieldComponent,
  TextFieldComponent,
  toggleFieldExpression,
  VectorFieldComponent,
} from './field-components'
import menuStyles from './menu.module.css'
import type { AutoLayoutSettings } from '../utils/serialization'
import s from './node-properties.module.css'
import { handleClass, headerClass, typeCategory } from './op-components'
import { RenderSettingsPanel } from './render-settings-panel'
import { SuggestedNodesSection } from './SuggestedNodes'

// === Field Visibility Helper Functions ===

// Get the default visible fields based on field.showByDefault
function getDefaultVisibleFields(op: Operator<IOperator>): Set<string> {
  return new Set(
    Object.entries(op.inputs)
      .filter(([_, field]) => field.showByDefault)
      .map(([name]) => name)
  )
}

// Check if a field can be hidden (can't hide fields with connections)
function canHideField(
  op: Operator<IOperator>,
  name: string,
  edges: Edge[]
): { canHide: boolean; reason?: string } {
  const hasConnection = edges.some(
    e => e.target === op.id && (e.targetHandle === name || e.targetHandle === `par.${name}`)
  )
  if (hasConnection) {
    return { canHide: false, reason: 'Disconnect this field first' }
  }
  return { canHide: true }
}

// Hide a field (remove from visible set and reset to default value)
function hideField(op: Operator<IOperator>, name: string) {
  const current = op.visibleFields.value ?? getDefaultVisibleFields(op)
  // Skip if already hidden
  if (!current.has(name)) return
  const newSet = new Set(current)
  newSet.delete(name)
  op.visibleFields.next(newSet)

  // Reset the field to its default value so it executes with defaults
  const field = op.inputs[name]
  if (field?.defaultValue !== undefined) {
    field.setValue(field.defaultValue)
  }
}

// Check if a field's current value differs from its default value
function hasNonDefaultValue(field: IField): boolean {
  if (field.defaultValue === undefined) {
    return false
  }
  // Use JSON.stringify for deep comparison of objects/arrays
  try {
    return JSON.stringify(field.value) !== JSON.stringify(field.defaultValue)
  } catch {
    // If serialization fails, fall back to reference equality
    return field.value !== field.defaultValue
  }
}

// Calculate what would change when resetting to defaults
// Connected fields are excluded from toHide because they'll remain visible via heuristic
function getVisibilityChanges(
  op: Operator<IOperator>,
  edges: Edge[]
): { toHide: string[]; toShow: string[] } {
  const currentVisible = op.visibleFields.value ?? getDefaultVisibleFields(op)
  const defaultVisible = getDefaultVisibleFields(op)

  // Get connected field names for this operator
  const connectedFields = new Set(
    edges
      .filter(e => e.target === op.id)
      .map(e => parseHandleId(e.targetHandle)?.fieldName)
      .filter((name): name is string => name !== undefined)
  )

  const toHide: string[] = []
  const toShow: string[] = []

  // Fields currently visible but not in defaults → will be hidden
  // EXCEPT connected fields, which will remain visible via heuristic
  for (const name of currentVisible) {
    if (!defaultVisible.has(name) && !connectedFields.has(name)) {
      toHide.push(name)
    }
  }

  // Fields currently hidden but in defaults → will be shown
  for (const name of defaultVisible) {
    if (!currentVisible.has(name)) {
      toShow.push(name)
    }
  }

  return { toHide, toShow }
}

// Reset to default visibility (and reset all newly-hidden fields to defaults)
// Connected fields remain visible via heuristic, so their values aren't reset
function resetToDefaults(op: Operator<IOperator>, edges: Edge[]) {
  // Get current visible fields before reset
  const currentVisible = op.visibleFields.value ?? getDefaultVisibleFields(op)
  const defaultVisible = getDefaultVisibleFields(op)

  // Get connected field names for this operator
  const connectedFields = new Set(
    edges
      .filter(e => e.target === op.id)
      .map(e => parseHandleId(e.targetHandle)?.fieldName)
      .filter((name): name is string => name !== undefined)
  )

  // Reset any fields that were visible but are now hidden by default
  // Skip connected fields since they'll remain visible via heuristic
  for (const name of currentVisible) {
    if (!defaultVisible.has(name) && !connectedFields.has(name)) {
      const field = op.inputs[name]
      if (field?.defaultValue !== undefined) {
        field.setValue(field.defaultValue)
      }
    }
  }

  // Reset visibility
  op.visibleFields.next(null)
}

function copy(text: string) {
  navigator.clipboard.writeText(text)
}

function Tooltip({
  text,
  position = 'top',
  children,
}: {
  text: string
  position?: 'top' | 'right' | 'bottom' | 'left'
  children: React.ReactNode
}) {
  return (
    <div className={s.tooltipContainer}>
      {children}
      <span className={cx(s.tooltipText, s[position])}>{text}</span>
    </div>
  )
}

function AddRemoveButton({
  type,
  onClick,
  disabled = false,
}: {
  type: 'add' | 'remove'
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={cx(s.addRemoveBtn, type === 'add' ? s.addBtn : s.removeBtn)}
      onClick={onClick}
      disabled={disabled}
    >
      {type === 'add' ? '+' : '−'}
    </button>
  )
}

// Wraps an editable field input with a highlight when the field has keyframes
function FieldInputWithHighlight({
  opId,
  fieldName,
  field,
  subPath,
  expandTimeline,
}: {
  opId: string
  fieldName: string
  field: Field
  subPath?: string[]
  expandTimeline?: () => void
}) {
  const channelKeys = (field.constructor as typeof Vec2Field).channelKeys ?? null
  const hasKeyframes = useTimelineStore(state =>
    channelKeys
      ? channelKeys.some(
          k => (state.tracks.get(getFieldPath(opId, fieldName, [k]))?.keyframes.length ?? 0) > 0
        )
      : (state.tracks.get(getFieldPath(opId, fieldName, subPath))?.keyframes.length ?? 0) > 0
  )
  return (
    <div className={cx(s.editableFieldContent, { [s.keyframedField]: hasKeyframes })}>
      <EditableFieldInput
        fieldName={subPath?.[0] ?? fieldName}
        field={field}
        disabled={false}
        opId={opId}
        expandTimeline={expandTimeline}
      />
    </div>
  )
}

// Render an editable field input based on field type
function EditableFieldInput({
  fieldName,
  field,
  disabled,
  opId,
  expandTimeline,
}: {
  fieldName: string
  field: Field
  disabled: boolean
  opId?: string
  expandTimeline?: () => void
}) {
  const { type } = field.constructor as typeof Field

  // Expression-driven fields show the expression editor regardless of type.
  // The canvas variant is safe here: the whole Layout — this panel included — renders
  // inside timeline-editor's ReactFlowProvider (this file already relies on that via
  // useReactFlow/useStore above), and it keeps reference edges synced when expressions
  // are edited from the panel. Use ExpressionInputBase instead if that ever changes.
  const expression = useObservable(field.expression$, field.expression)
  if (expression !== null) {
    return <ExpressionDrivenInput id={fieldName} field={field} disabled={disabled} />
  }

  switch (type) {
    case 'number':
      // biome-ignore lint/suspicious/noExplicitAny: Type checked at runtime
      return <NumberFieldComponent id={fieldName} field={field as any} disabled={disabled} />
    case 'boolean':
      // biome-ignore lint/suspicious/noExplicitAny: Type checked at runtime
      return <BooleanFieldComponent id={fieldName} field={field as any} disabled={disabled} />
    case 'color':
      // biome-ignore lint/suspicious/noExplicitAny: Type checked at runtime
      return <ColorFieldComponent id={fieldName} field={field as any} disabled={disabled} />
    case 'string':
    case 'string-literal':
      // biome-ignore lint/suspicious/noExplicitAny: Type checked at runtime
      return <TextFieldComponent id={fieldName} field={field as any} disabled={disabled} />
    case 'date':
      // biome-ignore lint/suspicious/noExplicitAny: Type checked at runtime
      return <DateFieldComponent id={fieldName} field={field as any} disabled={disabled} />
    case 'vec2':
    case 'vec3':
    case 'geopoint-2d':
    case 'geopoint-3d': {
      // biome-ignore lint/suspicious/noExplicitAny: Type checked at runtime
      const vecField = field as any
      return (
        <VectorFieldComponent
          id={fieldName}
          field={vecField}
          disabled={disabled}
          opId={opId}
          fieldName={fieldName}
          expandTimeline={expandTimeline}
        />
      )
    }
    default:
      // For other animatable types that don't have specialized components, show a placeholder
      return (
        <div className={s.fieldPlaceholder}>
          {fieldName}: {type}
        </div>
      )
  }
}

// Returns true for scalar/value field types that can show an editable input
function isValueField(field: Field): boolean {
  const { type } = field.constructor as typeof Field
  return [
    'number',
    'boolean',
    'color',
    'string',
    'string-literal',
    'date',
    'vec2',
    'vec3',
    'geopoint-2d',
    'geopoint-3d',
  ].includes(type)
}

// Renders compound field sub-fields inline with labels, inputs, and keyframe indicators
function CompoundSubFields({
  field,
  opId,
  fieldName,
  expandTimeline,
}: {
  field: CompoundPropsField
  opId: string
  fieldName: string
  expandTimeline: () => void
}) {
  return (
    <div className={s.compoundSubFields}>
      {Object.entries(field.fields).map(([subName, subField]) => {
        if (!isValueField(subField as Field)) return null
        let currentValue: KeyframeValue
        try {
          currentValue = fieldValueToKeyframeValue(
            subField as Field,
            subField.value
          ) as KeyframeValue
        } catch {
          currentValue = subField.value as KeyframeValue
        }
        return (
          <div key={subName} className={s.compoundSubField}>
            <span className={s.compoundSubFieldLabel}>{subName}</span>
            <FieldInputWithHighlight
              opId={opId}
              fieldName={fieldName}
              field={subField as Field}
              subPath={[subName]}
            />
            <KeyframeIndicator
              opId={opId}
              fieldName={fieldName}
              subPath={[subName]}
              currentValue={currentValue}
              disabled={false}
              size="small"
              onKeyframeAdded={expandTimeline}
            />
          </div>
        )
      })}
    </div>
  )
}

// Exported for testing
export function NodeProperties({ nodeId }: { nodeId: string }) {
  const { setEdges, addNodes, addEdges, getEdges } = useReactFlow()
  const onEdgesChange = useStore(s => s.onEdgesChange)
  // Only re-renders when this node's incoming edges change (not on position updates)
  const edges = useStore(
    s => s.edges.filter(e => e.target === nodeId),
    (a, b) => a.length === b.length && a.every((e, i) => e.id === b[i].id)
  )
  // Only re-renders when node type changes (stable during drag)
  const nodeType = useStore(s => s.nodes.find(n => n.id === nodeId)?.type ?? '')
  // Only re-renders when this node's position changes
  const nodePosition = useStore(s => {
    const n = s.nodes.find(n => n.id === nodeId)
    return n ? { x: n.position.x, y: n.position.y } : { x: 0, y: 0 }
  })
  const currentContainerId = useNestingStore(state => state.currentContainerId)
  const expandTimeline = useCallback(() => {
    useUIStore.getState().setTimelineExpanded(true)
  }, [])
  const dragDataRef = useRef<{ inputName: string; index: number } | null>(null)
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false)
  const [pendingHideField, setPendingHideField] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    codeRef: string
    mustacheRef: string
    fieldName: string
    fieldValue?: string
    fieldPath?: string
    inputName?: string // field name for "Reset to default"
    keyframeEntries?: Array<{ path: string; value: KeyframeValue }> // for "Sequence"
    listFieldInputName?: string // field name when it's a ListField with connections
    isVisible?: boolean // whether the field is currently shown
    hasConnection?: boolean // whether the field has an incoming edge
    expressionField?: Field // field instance when expression mode can be toggled
  } | null>(null)
  const descriptionRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<HTMLElement | null>(null)
  const store = getOpStore()
  const op = store.getOp(nodeId)

  const { displayName, description } = op
    ? (op.constructor as typeof Operator)
    : { displayName: '', description: '' }

  // Subscribe to visibility changes to re-render this panel
  // (op-components handle their own subscriptions for node UI updates)
  const [, setVisibility] = useState(op?.visibleFields.value)
  useEffect(() => {
    if (!op) return
    const subscription = op.visibleFields.subscribe(setVisibility)
    return () => subscription.unsubscribe()
  }, [op])

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  // Check if description is truncated
  useEffect(() => {
    if (descriptionRef.current && description) {
      const isTruncated = descriptionRef.current.scrollHeight > descriptionRef.current.clientHeight
      setIsTruncated(isTruncated)
    }
  }, [description])

  // Handler to add a suggested node and connect it
  const handleAddNode = useCallback(
    (opType: OpType, connection: ConnectionPlan) => {
      // Calculate position to the right of current node
      const newPosition = {
        x: nodePosition.x + 300,
        y: nodePosition.y,
      }

      // Create new node
      const { nodes: newNodes, edges: newEdges } = createNodesForType(
        opType as NodeType,
        newPosition,
        currentContainerId
      )

      if (newNodes.length === 0) return

      const newNodeId = newNodes[0].id

      // Create connection edge
      const connectionEdge = {
        id: edgeId({
          source: nodeId,
          sourceHandle: `out.${connection.sourceOutput}`,
          target: newNodeId,
          targetHandle: `par.${connection.targetInput}`,
        }),
        source: nodeId,
        target: newNodeId,
        sourceHandle: `out.${connection.sourceOutput}`,
        targetHandle: `par.${connection.targetInput}`,
      }

      addNodes(newNodes)
      addEdges([...newEdges, connectionEdge])
    },
    [nodeId, nodePosition.x, nodePosition.y, currentContainerId, addNodes, addEdges]
  )

  // Early return after all hooks
  if (!op) return null

  const inputs = Object.entries(op.inputs).map(([name, input]) => {
    const { type } = input.constructor as typeof Field
    return {
      name,
      type,
      codeRef: `op('${op.id}').${IN_NS}.${name}`,
      mustacheRef: `{{${op.id}.${IN_NS}.${name}}}`,
      handleClass: handleClass(input),
      field: input,
    }
  })

  const outputs = Object.entries(op.outputs).map(([name, output]) => {
    const { type } = output.constructor as typeof Field
    return {
      name,
      type,
      codeRef: `op('${op.id}').${OUT_NS}.${name}`,
      mustacheRef: `{{${op.id}.${OUT_NS}.${name}}}`,
      handleClass: handleClass(output),
      field: output,
    }
  })

  const openInputContextMenu = (
    input: (typeof inputs)[number],
    incomers: Edge[],
    fieldCurrentValue: KeyframeValue | undefined,
    position: { x: number; y: number }
  ) => {
    const isAnimatable = isValueField(input.field) && incomers.length === 0
    const channelKeys = isAnimatable
      ? ((input.field.constructor as typeof Vec2Field).channelKeys ?? null)
      : null
    let keyframeEntries: Array<{ path: string; value: KeyframeValue }> | undefined
    if (isAnimatable) {
      if (channelKeys) {
        const raw = input.field.value as Record<string, number> | number[]
        keyframeEntries = channelKeys.map((k, i) => ({
          path: getFieldPath(op.id, input.name, [k]),
          value: (Array.isArray(raw) ? raw[i] : raw[k]) as number,
        }))
      } else {
        keyframeEntries = [{ path: getFieldPath(op.id, input.name), value: fieldCurrentValue! }]
      }
    }
    let fieldValue: string | undefined
    if (isValueField(input.field)) {
      try {
        const v = input.field.value
        fieldValue = typeof v === 'string' ? v : JSON.stringify(v)
      } catch {
        /* ignore */
      }
    }
    setContextMenu({
      ...position,
      codeRef: input.codeRef,
      mustacheRef: input.mustacheRef,
      fieldName: input.name,
      fieldValue,
      fieldPath: isAnimatable ? getFieldPath(op.id, input.name) : undefined,
      inputName:
        incomers.length === 0 &&
        input.field.defaultValue !== undefined &&
        hasNonDefaultValue(input.field)
          ? input.name
          : undefined,
      keyframeEntries,
      listFieldInputName:
        input.field instanceof ListField && incomers.length > 0 ? input.name : undefined,
      isVisible: op.isFieldVisible(input.name),
      hasConnection: incomers.length > 0,
      // Expression mode: drivable when the type allows it and nothing is wired in;
      // always removable while driven
      expressionField:
        (canFieldBeDriven(input.field) && incomers.length === 0) || input.field.expression !== null
          ? input.field
          : undefined,
    })
  }

  const handleMoveConnection = (inputName: string, fromIndex: number, toIndex: number) => {
    const input = op.inputs[inputName]
    if (!(input instanceof ListField)) return

    const handleId = `${IN_NS}.${inputName}`
    const edges = getEdges()
    const groupIds = orderedEdgeIdsForHandle(edges, nodeId, handleId)
    if (groupIds.length < 2 || !groupIds[fromIndex]) return

    const next = normalizeMultiInputEdges(moveEdgeWithinGroup(edges, groupIds[fromIndex], toIndex))
    setEdges(next)
    input.setConnectionOrder(orderedEdgeIdsForHandle(next, nodeId, handleId))
  }

  const handleDragStart = (e: React.DragEvent, inputName: string, index: number) => {
    dragDataRef.current = { inputName, index }
    draggingRef.current = e.currentTarget as HTMLElement
    e.currentTarget.classList.add('dragging')
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    const draggingEl = draggingRef.current
    if (!draggingEl) return

    const container = e.currentTarget as HTMLElement
    const siblings = Array.from(container.children).filter(
      child => child !== draggingEl && child.classList.contains(s.connection)
    )

    const nextSibling = siblings.find(sibling => {
      const rect = sibling.getBoundingClientRect()
      const offset = e.clientY - rect.top - rect.height / 2
      return offset < 0
    })

    if (nextSibling) {
      container.insertBefore(draggingEl, nextSibling)
    } else {
      container.appendChild(draggingEl)
    }
  }

  const handleDragEnd = (e: React.DragEvent, inputName: string, _incomers: Edge[]) => {
    e.currentTarget.classList.remove('dragging')
    const container = e.currentTarget.parentElement
    if (!container) return

    const dragData = dragDataRef.current
    if (!dragData || dragData.inputName !== inputName) return

    const newIndex = Array.from(container.children).indexOf(e.currentTarget)
    const oldIndex = dragData.index

    if (oldIndex !== newIndex) {
      handleMoveConnection(inputName, oldIndex, newIndex)
    }

    dragDataRef.current = null
    draggingRef.current = null
  }

  const handleResetToDefaults = () => {
    setIsResetDialogOpen(true)
  }

  const confirmResetToDefaults = () => {
    resetToDefaults(op, edges)
    setIsResetDialogOpen(false)
  }

  const confirmHideField = () => {
    if (pendingHideField) {
      hideField(op, pendingHideField)
      setPendingHideField(null)
    }
  }

  return (
    <>
      <div className={s.header}>
        <div className={s.title}>
          {getBaseName(op.id)}
          <div className={cx(s.capsule, headerClass(nodeType))}>{typeCategory(nodeType)}</div>
        </div>
      </div>
      {op instanceof OutOp && (
        <div className={s.section}>
          <div className={s.sectionTitle}>Render Settings</div>
          <RenderSettingsPanel op={op} />
        </div>
      )}
      {(displayName || description) && (
        <div className={s.opMeta}>
          {displayName && <div className={s.opDisplayName}>{displayName}</div>}
          {description && (
            <div
              className={cx(s.descriptionSection, {
                [s.descriptionSectionWithButton]: isTruncated || isDescriptionExpanded,
              })}
            >
              <div
                ref={descriptionRef}
                className={cx(s.description, { [s.descriptionExpanded]: isDescriptionExpanded })}
              >
                {description}
              </div>
              {(isTruncated || isDescriptionExpanded) && (
                <button
                  type="button"
                  className={s.readMoreButton}
                  onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                >
                  {isDescriptionExpanded ? 'Read less' : 'Read more'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <div className={s.sectionTitle}>Inputs</div>
          {Object.keys(op.inputs).length > 0 &&
            op.visibleFields.value !== null &&
            (() => {
              const { toHide, toShow } = getVisibilityChanges(op, edges)
              const hasChanges = toHide.length > 0 || toShow.length > 0
              return hasChanges ? (
                <div className={s.sectionActions}>
                  <button type="button" className={s.resetButton} onClick={handleResetToDefaults}>
                    Reset
                  </button>
                </div>
              ) : null
            })()}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: flex layout requires div */}
        <div className={s.propertyList} role="list" onContextMenu={e => e.preventDefault()}>
          <ErrorBoundary
            title="Field Rendering Error"
            fallback={
              <div style={{ padding: '1rem', color: 'var(--color-text-secondary)' }}>
                <p>
                  Error rendering fields. Try resetting field visibility or refreshing the page.
                </p>
              </div>
            }
          >
            {(() => {
              const handleShowField = (fieldName: string) => {
                op.showField(fieldName)
              }

              const handleHideField = (fieldName: string) => {
                const field = op.inputs[fieldName]
                // Check if field has a non-default value - warn before losing data
                if (field && hasNonDefaultValue(field)) {
                  setPendingHideField(fieldName)
                  return
                }
                hideField(op, fieldName)
              }

              const renderInput = (input: (typeof inputs)[0]) => {
                const isVisible = op.isFieldVisible(input.name)
                const incomers = edges.filter(
                  e =>
                    e.target === nodeId &&
                    (e.targetHandle === input.name || e.targetHandle === `par.${input.name}`)
                )
                const hideCheck = canHideField(op, input.name, edges)
                const canHide = hideCheck.canHide
                let fieldCurrentValue: KeyframeValue | undefined
                if (isValueField(input.field)) {
                  try {
                    fieldCurrentValue = fieldValueToKeyframeValue(
                      input.field,
                      input.field.value
                    ) as KeyframeValue
                  } catch {
                    fieldCurrentValue = input.field.value as KeyframeValue
                  }
                }

                return (
                  // biome-ignore lint/a11y/useSemanticElements: property list uses div containers for flex layout
                  <div
                    key={input.name}
                    role="listitem"
                    className={cx(s.property, s.propertyWithAction)}
                    onContextMenu={e => {
                      e.preventDefault()
                      openInputContextMenu(input, incomers, fieldCurrentValue, {
                        x: e.clientX,
                        y: e.clientY,
                      })
                    }}
                  >
                    <div className={s.propertyRow}>
                      {isVisible ? (
                        <Tooltip
                          text={canHide ? 'Hide field' : hideCheck.reason || 'Cannot hide'}
                          position="right"
                        >
                          <span>
                            <AddRemoveButton
                              type="remove"
                              onClick={() => handleHideField(input.name)}
                              disabled={!canHide}
                            />
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip text="Show field" position="right">
                          <span>
                            <AddRemoveButton
                              type="add"
                              onClick={() => handleShowField(input.name)}
                            />
                          </span>
                        </Tooltip>
                      )}
                      <div className={cx(s.port, input.handleClass)} />
                      <span className={s.propertyLabel}>{input.name}</span>
                      {/* Value type, not connected: editable input + keyframe indicator */}
                      {isValueField(input.field) && incomers.length === 0 && (
                        <>
                          <FieldInputWithHighlight
                            opId={op.id}
                            fieldName={input.name}
                            field={input.field}
                            expandTimeline={expandTimeline}
                          />
                          {/* Vec fields render per-channel indicators inside VectorFieldComponent */}
                          {!(input.field.constructor as typeof Vec2Field).channelKeys && (
                            <KeyframeIndicator
                              opId={op.id}
                              fieldName={input.name}
                              currentValue={fieldCurrentValue!}
                              disabled={false}
                              size="small"
                              onKeyframeAdded={expandTimeline}
                            />
                          )}
                        </>
                      )}
                    </div>
                    {/* Compound field: expand sub-fields inline */}
                    {input.field instanceof CompoundPropsField && (
                      <CompoundSubFields
                        field={input.field}
                        opId={op.id}
                        fieldName={input.name}
                        expandTimeline={expandTimeline}
                      />
                    )}
                    {/* List field with connections: draggable reorder list */}
                    {input.field instanceof ListField && incomers.length > 0 && (
                      // biome-ignore lint/a11y/useSemanticElements: Drag-and-drop list requires div with role
                      <div className={s.connections} role="list" onDragOver={handleDragOver}>
                        {incomers.map((edge, index) => (
                          // biome-ignore lint/a11y/useSemanticElements: Draggable list item requires div with role
                          <div
                            key={edge.id}
                            className={s.connection}
                            role="listitem"
                            tabIndex={incomers.length > 1 ? 0 : -1}
                            draggable={incomers.length > 1}
                            onDragStart={e => handleDragStart(e, input.name, index)}
                            onDragEnd={e => handleDragEnd(e, input.name, incomers)}
                          >
                            {incomers.length > 1 && <div className={s.dragHandle} />}
                            <div className={s.connectionSource}>
                              {getBaseName(edge.source)}.{edge.sourceHandle}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }

              return <>{inputs.map(input => renderInput(input))}</>
            })()}
          </ErrorBoundary>
        </div>
      </div>
      <div className={s.section}>
        <div className={s.sectionTitle}>Outputs</div>
        {/* biome-ignore lint/a11y/useSemanticElements: flex layout requires div */}
        <div className={s.propertyList} role="list" onContextMenu={e => e.preventDefault()}>
          {outputs.map(output => (
            // biome-ignore lint/a11y/useSemanticElements: property list uses div containers for flex layout
            <div
              key={output.name}
              role="listitem"
              className={s.property}
              onContextMenu={e => {
                e.preventDefault()
                let fieldValue: string | undefined
                try {
                  const v = output.field.value
                  fieldValue = typeof v === 'string' ? v : JSON.stringify(v)
                } catch {
                  /* ignore non-serializable */
                }
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  codeRef: output.codeRef,
                  mustacheRef: output.mustacheRef,
                  fieldName: output.name,
                  fieldValue,
                })
              }}
            >
              <div className={cx(s.propertyRow, s.outputRow)}>
                <div className={cx(s.port, output.handleClass)} />
                <span className={s.propertyLabel}>{output.name}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <SuggestedNodesSection operator={op} nodeId={nodeId} onAddNode={handleAddNode} />

      {/* Reset to defaults confirmation dialog */}
      <Dialog.Root open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={menuStyles.dialogOverlay} />
          <Dialog.Content className={menuStyles.dialogContent}>
            <Dialog.Title className={menuStyles.dialogTitle}>Reset Field Visibility</Dialog.Title>
            <Dialog.Description className={menuStyles.dialogDescription}>
              This will reset field visibility to the operator defaults.
            </Dialog.Description>

            {(() => {
              const { toHide, toShow } = getVisibilityChanges(op, edges)
              return (
                <div className={s.dialogFieldLists}>
                  {toHide.length > 0 && (
                    <div className={s.dialogFieldList}>
                      <div className={s.dialogFieldListTitle}>Will be hidden:</div>
                      <ul>
                        {toHide.map(name => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {toShow.length > 0 && (
                    <div className={s.dialogFieldList}>
                      <div className={s.dialogFieldListTitle}>Will be shown:</div>
                      <ul>
                        {toShow.map(name => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })()}

            <div className={menuStyles.dialogRightSlot}>
              <button
                type="button"
                className={cx(menuStyles.dialogButton, menuStyles.violet)}
                onClick={() => setIsResetDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cx(menuStyles.dialogButton, menuStyles.green)}
                onClick={confirmResetToDefaults}
              >
                Reset
              </button>
            </div>

            <Dialog.Close asChild>
              <button type="button" className={menuStyles.dialogIconButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Hide field with non-default value warning dialog */}
      <Dialog.Root
        open={pendingHideField !== null}
        onOpenChange={open => !open && setPendingHideField(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={menuStyles.dialogOverlay} />
          <Dialog.Content className={menuStyles.dialogContent}>
            <Dialog.Title className={menuStyles.dialogTitle}>Hide Field?</Dialog.Title>
            <Dialog.Description className={menuStyles.dialogDescription}>
              The field "{pendingHideField}" has a custom value that will be reset to its default
              when hidden. Are you sure you want to continue?
            </Dialog.Description>

            <div className={menuStyles.dialogRightSlot}>
              <button
                type="button"
                className={cx(menuStyles.dialogButton, menuStyles.violet)}
                onClick={() => setPendingHideField(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cx(menuStyles.dialogButton, menuStyles.green)}
                onClick={confirmHideField}
              >
                Hide Field
              </button>
            </div>

            <Dialog.Close asChild>
              <button type="button" className={menuStyles.dialogIconButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Right-click context menu */}
      {contextMenu &&
        createPortal(
          <div
            className={s.contextMenu}
            ref={el => {
              if (!el) return
              const rect = el.getBoundingClientRect()
              let tx = ''
              let ty = ''
              if (rect.right > window.innerWidth) {
                tx = '-100%'
              }
              if (rect.bottom > window.innerHeight) {
                ty = '-100%'
              }
              if (tx || ty) {
                el.style.transform = `translate(${tx || '0'}, ${ty || '0'})`
              }
            }}
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
            }}
            onPointerDown={e => e.stopPropagation()}
          >
            <button
              type="button"
              className={s.contextMenuItem}
              disabled={contextMenu.fieldValue === undefined}
              onClick={() => {
                if (contextMenu.fieldValue === undefined) return
                copy(contextMenu.fieldValue)
                setContextMenu(null)
              }}
            >
              Copy value
            </button>
            <div className={s.contextMenuSeparator} />
            <button
              type="button"
              className={s.contextMenuItem}
              onClick={() => {
                copy(contextMenu.fieldName)
                setContextMenu(null)
              }}
            >
              Copy field name
            </button>
            <button
              type="button"
              className={s.contextMenuItem}
              onClick={() => {
                copy(contextMenu.codeRef)
                setContextMenu(null)
              }}
            >
              Copy code reference
            </button>
            <button
              type="button"
              className={s.contextMenuItem}
              onClick={() => {
                copy(contextMenu.mustacheRef)
                setContextMenu(null)
              }}
            >
              Copy mustache reference
            </button>
            {contextMenu.isVisible !== undefined && (
              <>
                <div className={s.contextMenuSeparator} />
                {contextMenu.fieldPath &&
                getTimelineStore().hasKeyframesForField(contextMenu.fieldPath) ? (
                  <button
                    type="button"
                    className={s.contextMenuItem}
                    onClick={() => {
                      const before = captureTimelineState()
                      const store = getTimelineStore()
                      store.deleteTrack(contextMenu.fieldPath!)
                      fireTimelineMutation('Make static', before)
                      setContextMenu(null)
                    }}
                  >
                    Make static
                  </button>
                ) : (
                  <button
                    type="button"
                    className={s.contextMenuItem}
                    disabled={!contextMenu.keyframeEntries}
                    onClick={() => {
                      if (!contextMenu.keyframeEntries) return
                      const store = getTimelineStore()
                      const position = store.position
                      const before = captureTimelineState()
                      for (const { path, value } of contextMenu.keyframeEntries) {
                        store.getOrCreateTrack(path, value)
                        store.addKeyframe(path, { position, value, interpolation: 'bezier' })
                      }
                      fireTimelineMutation('Add keyframe', before)
                      expandTimeline()
                      setContextMenu(null)
                    }}
                  >
                    Sequence
                  </button>
                )}
                <button
                  type="button"
                  className={s.contextMenuItem}
                  disabled={!contextMenu.inputName}
                  onClick={() => {
                    if (!contextMenu.inputName) return
                    const field = op.inputs[contextMenu.inputName]
                    if (!field) return
                    const fp = getFieldPath(op.id, contextMenu.inputName)
                    const store = getTimelineStore()
                    if (store.hasKeyframesForField(fp)) {
                      const before = captureTimelineState()
                      store.deleteTrack(fp)
                      fireTimelineMutation('Reset to default', before)
                    }
                    field.setValue(field.defaultValue)
                    setContextMenu(null)
                  }}
                >
                  Reset to default
                </button>
                <button
                  type="button"
                  className={s.contextMenuItem}
                  disabled={!contextMenu.expressionField}
                  onClick={() => {
                    if (!contextMenu.expressionField) return
                    toggleFieldExpression(contextMenu.expressionField)
                    setContextMenu(null)
                  }}
                >
                  {contextMenu.expressionField?.expression != null
                    ? 'Remove expression'
                    : 'Add expression'}
                </button>
                <button
                  type="button"
                  className={s.contextMenuItem}
                  disabled={!contextMenu.listFieldInputName}
                  onClick={() => {
                    if (!contextMenu.listFieldInputName) return
                    const name = contextMenu.listFieldInputName
                    const toRemove = edges.filter(
                      e =>
                        e.target === nodeId &&
                        (e.targetHandle === name || e.targetHandle === `par.${name}`)
                    )
                    onEdgesChange(toRemove.map(e => ({ type: 'remove' as const, id: e.id })))
                    setContextMenu(null)
                  }}
                >
                  Disconnect all inputs
                </button>
                <div className={s.contextMenuSeparator} />
                {contextMenu.isVisible ? (
                  <button
                    type="button"
                    className={s.contextMenuItem}
                    disabled={contextMenu.hasConnection}
                    onClick={() => {
                      if (contextMenu.hasConnection) return
                      const field = op.inputs[contextMenu.fieldName]
                      if (field && hasNonDefaultValue(field)) {
                        setPendingHideField(contextMenu.fieldName)
                      } else {
                        hideField(op, contextMenu.fieldName)
                      }
                      setContextMenu(null)
                    }}
                  >
                    Hide field
                  </button>
                ) : (
                  <button
                    type="button"
                    className={s.contextMenuItem}
                    onClick={() => {
                      op.showField(contextMenu.fieldName)
                      setContextMenu(null)
                    }}
                  >
                    Show field
                  </button>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </>
  )
}

interface PropertyPanelProps {
  onAutoLayout?: () => void
  autoLayout?: AutoLayoutSettings
}

export function PropertyPanel({ onAutoLayout, autoLayout }: PropertyPanelProps) {
  // Only re-renders when selection changes, not on position updates during drag
  const { selectedNodeId, selectedNodeCount, selectedEdgeCount } = useStore(
    s => {
      const selectedNodes = s.nodes.filter(n => n.selected)
      return {
        selectedNodeId: selectedNodes.length === 1 ? selectedNodes[0].id : null,
        selectedNodeCount: selectedNodes.length,
        selectedEdgeCount: s.edges.filter(e => e.selected).length,
      }
    },
    (a, b) =>
      a.selectedNodeId === b.selectedNodeId &&
      a.selectedNodeCount === b.selectedNodeCount &&
      a.selectedEdgeCount === b.selectedEdgeCount
  )

  return (
    <div className={s.panel}>
      {selectedNodeId != null ? (
        <NodeProperties nodeId={selectedNodeId} />
      ) : (
        <>
          <div className={s.header}>
            <div className={s.title}>Page</div>
          </div>
          {selectedNodeCount > 1 ? (
            <div className={s.selectionInfo}>
              <div>{selectedNodeCount} nodes selected</div>
              <div>{selectedEdgeCount} edges selected</div>
              {selectedNodeCount >= 2 && onAutoLayout && (
                <button
                  type="button"
                  className={s.layoutButton}
                  onClick={onAutoLayout}
                  title="Layout selected nodes (Cmd/Ctrl+L)"
                >
                  <LayoutGrid size={16} />
                  <span>Layout</span>
                </button>
              )}
            </div>
          ) : (
            <div className={s.opMeta}>Select a node to see properties</div>
          )}
        </>
      )}
    </div>
  )
}
