import type { NodeJSON } from 'SKIP-@xyflow/react'
import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import type { Edge } from '@xyflow/react'
import { useEdges, useNodes, useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import { useContext, useEffect, useRef, useState } from 'react'

import { SheetContext } from '../../utils/sheet-context'
import { type Field, IN_NS, ListField, OUT_NS } from '../fields'
import type { IOperator, Operator } from '../operators'
import { OutOp } from '../operators'
import { getOpStore } from '../store'
import { rebindOperatorToTheatre } from '../theatre-bindings'
import menuStyles from './menu.module.css'
import s from './node-properties.module.css'
import { handleClass, headerClass, typeCategory } from './op-components'
import { RenderSettingsPanel } from './render-settings-panel'

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

// Show a field (add to visible set)
function showField(op: Operator<IOperator>, name: string) {
  if (op.visibleFields === null) {
    op.visibleFields = new Set(getDefaultVisibleFields(op))
  }
  op.visibleFields.add(name)
}

// Hide a field (remove from visible set and reset to default value)
function hideField(op: Operator<IOperator>, name: string) {
  if (op.visibleFields === null) {
    op.visibleFields = new Set(getDefaultVisibleFields(op))
  }
  op.visibleFields.delete(name)

  // Reset the field to its default value so it executes with defaults
  const field = op.inputs[name]
  if (field && field.defaultValue !== undefined) {
    field.setValue(field.defaultValue)
  }
}

// Reset to default visibility (and reset all newly-hidden fields to defaults)
function resetToDefaults(op: Operator<IOperator>) {
  // Get current visible fields before reset
  const currentVisible = op.visibleFields ?? getDefaultVisibleFields(op)
  const defaultVisible = getDefaultVisibleFields(op)

  // Reset visibility
  op.visibleFields = null

  // Reset any fields that were visible but are now hidden by default
  for (const name of currentVisible) {
    if (!defaultVisible.has(name)) {
      const field = op.inputs[name]
      if (field && field.defaultValue !== undefined) {
        field.setValue(field.defaultValue)
      }
    }
  }
}

function copy(text: string) {
  navigator.clipboard.writeText(text)
}

function ReferenceIcon({
  codeReference,
  altReference,
}: {
  codeReference: string
  altReference: string
}) {
  const [isShiftHeld, setIsShiftHeld] = useState(false)
  const [isHovering, setIsHovering] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && isHovering) {
        setIsShiftHeld(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftHeld(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isHovering])

  return (
    <Tooltip text={isShiftHeld ? 'Copy Mustache Format' : 'Copy Code Format'} position="left">
      <svg
        className={s.referenceIcon}
        role="img"
        aria-label="Copy reference"
        onClick={e => {
          const reference = e.shiftKey ? altReference : codeReference
          copy(reference)
        }}
        onMouseEnter={e => {
          setIsHovering(true)
          setIsShiftHeld(e.shiftKey)
        }}
        onMouseLeave={() => {
          setIsHovering(false)
          setIsShiftHeld(false)
        }}
        viewBox="0 -960 960 960"
      >
        <title>{isShiftHeld ? 'Copy Mustache Format' : 'Copy Code Format'}</title>
        <path d="M360-240q-29.7 0-50.85-21.15Q288-282.3 288-312v-480q0-29.7 21.15-50.85Q330.3-864 360-864h384q29.7 0 50.85 21.15Q816-821.7 816-792v480q0 29.7-21.15 50.85Q773.7-240 744-240H360Zm0-72h384v-480H360v480ZM216-96q-29.7 0-50.85-21.15Q144-138.3 144-168v-552h72v552h456v72H216Zm144-216v-480 480Z" />
      </svg>
    </Tooltip>
  )
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

function PencilIcon({ onClick, isActive }: { onClick: () => void; isActive: boolean }) {
  return (
    <svg
      className={cx(s.editIcon, { [s.editIconActive]: isActive })}
      onClick={onClick}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{isActive ? 'Exit edit mode' : 'Edit fields'}</title>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
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
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
    >
      {type === 'add' ? '+' : '−'}
    </button>
  )
}

function NodeProperties({ node }: { node: NodeJSON<unknown> }) {
  const { setEdges, setNodes } = useReactFlow()
  const edges = useEdges()
  const sheet = useContext(SheetContext)
  const dragDataRef = useRef<{ inputName: string; index: number } | null>(null)
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false)
  const [, forceUpdate] = useState({}) // Force re-render when visibility changes

  // Trigger React Flow node re-render (for op-component to pick up visibility changes)
  const triggerNodeUpdate = () => {
    setNodes(nodes => nodes.map(n => (n.id === node.id ? { ...n } : n)))
  }
  const descriptionRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<HTMLElement | null>(null)
  const store = getOpStore()
  const op = store.getOp(node.id)

  const { displayName, description } = op
    ? (op.constructor as typeof Operator)
    : { displayName: '', description: '' }

  // Exit edit mode when switching to a different node
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run when node.id changes
  useEffect(() => {
    setIsEditMode(false)
  }, [node.id])

  // Check if description is truncated
  useEffect(() => {
    if (descriptionRef.current && description) {
      const isTruncated = descriptionRef.current.scrollHeight > descriptionRef.current.clientHeight
      setIsTruncated(isTruncated)
    }
  }, [description])

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

  const handleMoveConnection = (inputName: string, fromIndex: number, toIndex: number) => {
    const input = op.inputs[inputName]
    if (!(input instanceof ListField)) return

    setEdges(edges => {
      // Get all edges connected to this input
      const relevantEdges = edges.filter(e => e.target === node.id && e.targetHandle === inputName)
      if (relevantEdges.length < 2) return edges

      // Create new array with reordered edges
      const newEdges = [...edges]
      const edgeIndexMap = new Map(
        relevantEdges.map((e, _i) => [e.id, edges.findIndex(edge => edge.id === e.id)])
      )
      const [movedEdge] = newEdges.splice(edgeIndexMap.get(relevantEdges[fromIndex].id)!, 1)
      const targetIndex = edgeIndexMap.get(relevantEdges[toIndex].id)!
      newEdges.splice(targetIndex, 0, movedEdge)

      // Update the ListField's internal order
      input.reorderInputs(fromIndex, toIndex)

      return newEdges
    })
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
    resetToDefaults(op)
    if (sheet) {
      rebindOperatorToTheatre(op, sheet)
    }
    triggerNodeUpdate()
    forceUpdate({})
    setIsResetDialogOpen(false)
  }

  return (
    <>
      <div className={s.header}>
        <div className={s.title}>
          {displayName}
          <div className={cx(s.capsule, headerClass(node.type))}>{typeCategory(node.type)}</div>
        </div>
      </div>
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
      {op instanceof OutOp && (
        <div className={s.section}>
          <div className={s.sectionTitle}>Render Settings</div>
          <RenderSettingsPanel op={op} />
        </div>
      )}
      <div className={s.section}>
        <label className={s.input}>
          <span>ID</span>
          <input type="text" value={op.id} readOnly />
        </label>
      </div>
      <div className={s.section}>
        <div className={s.sectionTitle}>Position</div>
        <div className={s.position}>
          <label className={s.input}>
            <span>X</span>
            <input type="text" value={Math.round(node.position.x)} readOnly />
          </label>
          <label className={s.input}>
            <span>Y</span>
            <input type="text" value={Math.round(node.position.y)} readOnly />
          </label>
        </div>
      </div>
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <div className={s.sectionTitle}>Inputs</div>
          {Object.keys(op.inputs).length > 0 && (
            <div className={s.sectionActions}>
              {isEditMode && op.visibleFields !== null && (
                <button type="button" className={s.resetButton} onClick={handleResetToDefaults}>
                  Reset
                </button>
              )}
              <PencilIcon onClick={() => setIsEditMode(!isEditMode)} isActive={isEditMode} />
            </div>
          )}
        </div>
        <div className={s.propertyList}>
          {(() => {
            // Filter inputs by visibility
            const visibleInputs = inputs.filter(input => op.isFieldVisible(input.name))
            const hiddenInputs = inputs.filter(input => !op.isFieldVisible(input.name))

            const handleShowField = (fieldName: string) => {
              showField(op, fieldName)
              if (sheet) {
                rebindOperatorToTheatre(op, sheet)
              }
              triggerNodeUpdate()
              forceUpdate({})
            }

            const handleHideField = (fieldName: string) => {
              hideField(op, fieldName)
              if (sheet) {
                rebindOperatorToTheatre(op, sheet)
              }
              triggerNodeUpdate()
              forceUpdate({})
            }

            const renderInput = (input: (typeof inputs)[0], isVisible: boolean) => {
              const incomers = edges.filter(
                e =>
                  e.target === node.id &&
                  (e.targetHandle === input.name || e.targetHandle === `par.${input.name}`)
              )
              const hideCheck = canHideField(op, input.name, edges)
              const canHide = hideCheck.canHide

              return (
                <div
                  key={input.name}
                  className={cx(s.property, { [s.propertyWithAction]: isEditMode })}
                  title={input.codeRef}
                >
                  <div className={s.propertyHeader}>
                    <div className={s.propertyName}>
                      {isEditMode && isVisible && (
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
                      )}
                      {isEditMode && !isVisible && (
                        <AddRemoveButton type="add" onClick={() => handleShowField(input.name)} />
                      )}
                      <span>{input.name}</span>
                    </div>
                    <div className={s.propertyDetails}>
                      <div>{input.type}</div>
                      <div className={cx(s.port, input.handleClass)} />
                      <ReferenceIcon
                        codeReference={input.codeRef}
                        altReference={input.mustacheRef}
                      />
                    </div>
                  </div>
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
                          <div className={s.connectionSource}>{edge.sourceHandle}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <>
                {/* Visible fields (with hide button in edit mode) */}
                {visibleInputs.map(input => renderInput(input, true))}

                {/* Divider and hidden fields (only in edit mode) */}
                {isEditMode && hiddenInputs.length > 0 && (
                  <>
                    <div className={s.fieldDivider}>
                      <span>Hidden fields</span>
                    </div>
                    {hiddenInputs.map(input => renderInput(input, false))}
                  </>
                )}
              </>
            )
          })()}
        </div>
      </div>
      <div className={s.section}>
        <div className={s.sectionTitle}>Outputs</div>
        <div className={s.propertyList}>
          {outputs.map(output => (
            <div key={output.name} className={s.property} title={output.codeRef}>
              <div className={s.propertyHeader}>
                <div>{output.name}</div>
                <div className={s.propertyDetails}>
                  <div>{output.type}</div>
                  <div className={cx(s.port, output.handleClass)} />
                  <ReferenceIcon codeReference={output.codeRef} altReference={output.mustacheRef} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reset to defaults confirmation dialog */}
      <Dialog.Root open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={menuStyles.dialogOverlay} />
          <Dialog.Content className={menuStyles.dialogContent}>
            <Dialog.Title className={menuStyles.dialogTitle}>Reset Field Visibility</Dialog.Title>
            <Dialog.Description className={menuStyles.dialogDescription}>
              This will reset field visibility to the operator defaults. Any hidden fields will be
              shown, and any custom visibility settings will be cleared.
            </Dialog.Description>

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
    </>
  )
}

export function PropertyPanel() {
  const nodes = useNodes()
  const edges = useEdges()
  const selectedNodes = nodes.filter(n => n.selected)
  const selectedEdges = edges.filter(n => n.selected)

  return (
    <div className={s.panel}>
      {selectedNodes.length === 1 ? (
        <NodeProperties node={selectedNodes[0]} />
      ) : (
        <>
          <div className={s.header}>
            <div className={s.title}>Page</div>
          </div>
          {selectedNodes.length > 1 ? (
            <div>
              <div>{selectedNodes.length} nodes selected</div>
              <div>{selectedEdges.length} edges selected</div>
            </div>
          ) : (
            <div>Select a node to see properties</div>
          )}
        </>
      )}
    </div>
  )
}
