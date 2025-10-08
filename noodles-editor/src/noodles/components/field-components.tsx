import { CodeiumEditor } from '@codeium/react-code-editor'
import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEdges, useNodeId, useReactFlow } from '@xyflow/react'
import cx from 'classnames'
import type { ScaleLinear, ScaleOrdinal } from 'd3'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { colorToHex } from '../../utils/color'
import {
  type BezierCurveField,
  type BooleanField,
  CategoricalColorRampField,
  type CodeField,
  type ColorField,
  type ColorRampField,
  type CompoundPropsField,
  type DateField,
  type Field,
  type FileField,
  getFieldReferences,
  type IField,
  type NumberField,
  Point2DField,
  Point3DField,
  StringLiteralField,
  Vec2Field,
  Vec3Field,
} from '../fields'
import { useFileSystemStore } from '../filesystem-store'
import type { Edge } from '../noodles'
import s from '../noodles.module.css'
import type { IOperator, Operator } from '../operators'
import { checkAssetExists, writeAsset } from '../storage'
import { projectScheme } from '../utils/filesystem'
import { edgeId, type OpId } from '../utils/id-utils'
import menuStyles from './menu.module.css'

type InputComponent = React.ComponentType<{
  id: OpId
  field: Field
  disabled: boolean
}>

export const inputComponents = {
  array: EmptyFieldComponent,
  'bezier-curve': BezierCurveFieldComponent,
  boolean: BooleanFieldComponent,
  'category-color-ramp': ColorRampComponent,
  color: ColorFieldComponent,
  'color-ramp': ColorRampComponent,
  code: CodeFieldComponent,
  compound: CompoundFieldComponent,
  data: EmptyFieldComponent,
  date: DateFieldComponent,
  expression: TextFieldComponent,
  effect: EmptyFieldComponent,
  file: FileFieldComponent,
  function: EmptyFieldComponent,
  'geopoint-2d': VectorFieldComponent,
  'geopoint-3d': VectorFieldComponent,
  'json-url': TextFieldComponent,
  layer: EmptyFieldComponent,
  list: EmptyFieldComponent,
  number: NumberFieldComponent,
  string: TextFieldComponent,
  'string-literal': TextFieldComponent,
  unknown: EmptyFieldComponent,
  vec2: VectorFieldComponent,
  vec3: VectorFieldComponent,
  vec4: VectorFieldComponent,
  view: EmptyFieldComponent,
  visualization: EmptyFieldComponent,
} as const as Record<string, InputComponent>

// Guard on accessor callbacks in `setValue`/`useState` for when fields are disconnected
function guardAccessorFallback<V>(value: V): V | (() => V) {
  return typeof value === 'function' ? () => value : value
}

const formatText = (val: unknown) =>
  typeof val === 'function'
    ? 'function'
    : typeof val === 'string'
      ? val
      : JSON.stringify(val, null, 2)

export function TextFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: Field<IField>
  disabled: boolean
}) {
  const [value, setValue] = useState(formatText(field.value))

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      setValue(formatText(newVal))
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const val = e.currentTarget.value
    if (val !== field.value) {
      field.setValue(val)
    }
  }

  let input = null
  if (field instanceof StringLiteralField) {
    input = (
      <select
        id={id}
        className={cx(s.fieldInput, s.fieldInputSelect)}
        value={value}
        onChange={onChange}
        disabled={disabled}
      >
        {field.choices.map(({ label, value }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    )
  } else {
    input = (
      <input
        id={id}
        className={s.fieldInput}
        title={value}
        value={value}
        onBlur={onChange}
        onChange={onChange}
        disabled={disabled}
      />
    )
  }

  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel} htmlFor={id}>
        {id}
      </label>
      <div className={s.fieldInputWrapper}>{input}</div>
    </div>
  )
}

function VectorNumberInput({
  keyName,
  value,
  objectKey,
  disabled,
  onChange,
  onCommit,
}: {
  keyName: string
  value: number
  objectKey: string | number
  disabled: boolean
  onChange: (key: string | number, val: number) => void
  onCommit: () => void
}) {
  const handleChange = useCallback(
    (val: number) => {
      onChange(objectKey, val)
    },
    [objectKey, onChange]
  )

  return (
    <Fragment>
      <div className={cx(s.fieldLabel, s.fieldLabelVector)}>{keyName}</div>
      <DraggableNumberInput
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onCommit={onCommit}
        step={0.1}
        className={cx(s.fieldInput, s.fieldInputVector, s.fieldInputNumber)}
        title={`${keyName}: ${value}`}
      />
    </Fragment>
  )
}

export function VectorFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: Vec2Field | Vec3Field | Point2DField | Point3DField
  disabled: boolean
}) {
  const [value, setValue] = useState<
    { [key: string]: number } | [number, number] | [number, number, number]
  >(guardAccessorFallback(field.value))

  const keys =
    field instanceof Point3DField
      ? ['lng', 'lat', 'alt']
      : field instanceof Point2DField
        ? ['lng', 'lat']
        : field instanceof Vec2Field
          ? ['x', 'y']
          : field instanceof Vec3Field
            ? ['x', 'y', 'z']
            : Object.keys(value)

  // Track the latest value in a ref for onCommit
  const latestValueRef = useRef(value)
  latestValueRef.current = value

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = useCallback(
    (key: number | keyof typeof keys, val: number) => {
      setValue(prevValue => {
        const updated =
          field.returnType === 'tuple'
            ? prevValue.map((v, i) => (i === key ? val : v))
            : { ...prevValue, [key]: val }
        latestValueRef.current = updated
        return updated
      })
    },
    [field.returnType]
  )

  const onCommit = useCallback(() => {
    field.setValue(latestValueRef.current)
  }, [field])

  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel} htmlFor={id}>
        {id}
      </label>
      <div id={id} className={s.fieldInputWrapper}>
        {keys.map((key, i) => {
          const objectKey = field.returnType === 'tuple' ? i : key
          return (
            <VectorNumberInput
              key={key}
              keyName={key}
              value={value[objectKey]}
              objectKey={objectKey}
              disabled={disabled}
              onChange={onChange}
              onCommit={onCommit}
            />
          )
        })}
      </div>
    </div>
  )
}

export function CodeFieldComponent({
  field,
  disabled,
}: {
  id: string
  field: CodeField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))
  const { setEdges, getEdges, getNode } = useReactFlow()
  const editorRef = useRef<unknown>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const edges = getEdges()
  const nodeId = useNodeId() as string

  const node = getNode(nodeId)
  const nodeHeight = node?.height || 300

  // We assume the field name is the last in the pathToProps, but that may not hold true for nested fields.
  // We don't use any nested CodeFields at the moment so this is fine
  const fieldName = field.pathToProps[field.pathToProps.length - 1]
  const thisFieldId = `par.${fieldName}`
  const thisOpId = field.op.id

  const handleEditorChange = useCallback(
    (value: string | undefined, _event) => {
      if (disabled || value === undefined) return
      field.setValue(value)
    },
    [field, disabled]
  )

  const handleEditorDidMount = useCallback((editor: unknown) => {
    editorRef.current = editor
    editor.layout()
  }, [])

  // Force layout update on load and when node height changes
  useLayoutEffect(() => {
    if (editorRef.current) {
      editorRef.current.layout()
    }
  }, [nodeHeight])

  useEffect(() => {
    const sub = field.subscribe(_ => {
      setValue(field.value)
    })
    return () => sub.unsubscribe()
  }, [field])

  const subscribedFields = useMemo(
    () => edges.filter(e => e.target === nodeId && e.targetHandle === thisFieldId),
    [edges, nodeId, thisFieldId]
  )

  const fieldReferences = useMemo(() => getFieldReferences(value, thisOpId), [value, thisOpId])

  const toAdd = useMemo(
    () =>
      fieldReferences.filter(ref => !subscribedFields.some(f => f.sourceHandle === ref.handleId)),
    [fieldReferences, subscribedFields]
  )
  const toRemove = useMemo(
    () =>
      subscribedFields.filter(f => !fieldReferences.some(ref => ref.handleId === f.sourceHandle)),
    [fieldReferences, subscribedFields]
  )

  useEffect(() => {
    if (toAdd.length === 0 && toRemove.length === 0) return

    setEdges(oldEdges => {
      let newEdges = oldEdges

      // Remove edges first
      if (toRemove.length > 0) {
        const idsToRemove = new Set(toRemove.map(e => e.id))
        newEdges = newEdges.filter(e => !idsToRemove.has(e.id))
      }

      // Add new edges
      if (toAdd.length > 0) {
        const existingIds = new Set(newEdges.map(e => e.id))
        const edgesToAdd = toAdd
          .map(({ opId, handleId }) => {
            const connection = {
              source: opId,
              sourceHandle: handleId,
              target: thisOpId,
              targetHandle: thisFieldId,
            }
            const edgeIdStr = edgeId(connection)

            // Skip if already exists
            if (existingIds.has(edgeIdStr)) return null

            return {
              id: edgeIdStr,
              type: 'ReferenceEdge',
              selectable: false,
              deletable: false,
              focusable: false,
              reconnectable: false,
              source: opId,
              target: thisOpId,
              sourceHandle: handleId,
              targetHandle: thisFieldId,
            } as Edge<Operator<IOperator>, Operator<IOperator>>
          })
          .filter((e): e is Edge<Operator<IOperator>, Operator<IOperator>> => e !== null)

        if (edgesToAdd.length > 0) {
          newEdges = [...newEdges, ...edgesToAdd]
        }
      }

      return newEdges === oldEdges ? oldEdges : newEdges
    })
  }, [thisOpId, thisFieldId, toAdd, toRemove, setEdges])

  return (
    <div className={cx(s.fieldWrapper, s.fieldWrapperCode)} ref={containerRef}>
      <div className={s.fieldInputWrapperCodeEditor}>
        <CodeiumEditor
          language={field.language}
          options={{
            tabSize: 2,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            automaticLayout: true,
            fixedOverflowWidgets: true,
            scrollbar: {
              vertical: 'visible',
              horizontal: 'visible',
            },
          }}
          theme="vs-dark"
          width="100%"
          height={nodeHeight - 80}
          defaultValue={field.value}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
        />
      </div>
    </div>
  )
}

export function FileFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: FileField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.currentTarget.value
    if (val !== field.value) {
      setValue(val)
    }
  }

  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.currentTarget.value
    if (val !== field.value) {
      field.setValue(val)
    }
  }

  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<{ name: string; contents: string } | null>(null)

  const onReupload = async () => {
    // Get current project and storage type
    const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
    if (!currentProjectName) {
      throw new Error('No project loaded. Please save or load a project first.')
    }

    const [fileHandle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'CSV and JSON Files',
          accept: {
            'text/csv': ['.csv'],
            'application/json': ['.json'],
          },
        },
      ],
      excludeAcceptAllOption: true,
      multiple: false,
    })
    const file = await fileHandle.getFile()
    const contents = await file.text()

    // Check if file already exists
    const exists = await checkAssetExists(activeStorageType, currentProjectName, file.name)
    if (exists) {
      // Show confirmation dialog
      setPendingFile({ name: file.name, contents })
      setReplaceDialogOpen(true)
      return
    }

    // Write directly if file doesn't exist
    const result = await writeAsset(activeStorageType, currentProjectName, file.name, contents)

    if (!result.success) {
      throw new Error(result.error?.message || `Failed to write file: ${file.name}`)
    }

    field.setValue(projectScheme + file.name)
  }

  const onConfirmReplace = async () => {
    if (!pendingFile) return

    const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
    if (!currentProjectName) return

    // Write with overwrite option
    const result = await writeAsset(
      activeStorageType,
      currentProjectName,
      pendingFile.name,
      pendingFile.contents,
      { overwrite: true }
    )

    if (!result.success) {
      throw new Error(result.error?.message || `Failed to write file: ${pendingFile.name}`)
    }

    field.setValue(projectScheme + pendingFile.name)
    setReplaceDialogOpen(false)
    setPendingFile(null)
  }

  const onCancelReplace = () => {
    setReplaceDialogOpen(false)
    setPendingFile(null)
  }

  return (
    <>
      <div className="node-field-wrapper">
        <label className="node-field-label" htmlFor={id}>
          {id}
        </label>
        <div className="p-inputgroup node-field-input-group">
          <InputText
            id={id}
            placeholder="https://"
            className="node-field-input"
            value={value}
            onBlur={onBlur}
            onChange={onChange}
            disabled={disabled}
          />
          <Button
            icon="pi pi-upload"
            className="node-field-input--upload"
            onClick={onReupload}
            title="Upload Data"
            size="small"
          />
        </div>
      </div>

      <Dialog.Root open={replaceDialogOpen} onOpenChange={setReplaceDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={menuStyles.dialogOverlay} />
          <Dialog.Content className={menuStyles.dialogContent}>
            <Dialog.Title className={menuStyles.dialogTitle}>Replace file</Dialog.Title>
            <Dialog.Description className={menuStyles.dialogDescription}>
              A file named "{pendingFile?.name}" already exists. Do you want to replace it?
            </Dialog.Description>
            <div className={menuStyles.dialogRightSlot}>
              <Dialog.Close asChild>
                <button type="button" className={menuStyles.dialogButton} onClick={onCancelReplace}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className={cx(menuStyles.dialogButton, menuStyles.red)}
                onClick={onConfirmReplace}
              >
                Replace
              </button>
            </div>
            <Dialog.Close asChild onClick={onCancelReplace}>
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

type DragState = {
  startX: number
  startY: number
  startValue: number
  totalDistanceMoved: number
  detected: boolean
}

type UseDragOptions = {
  disabled?: boolean
  onDragStart?: (e: MouseEvent | TouchEvent) => boolean
  onDrag?: (deltaX: number, deltaY: number, e: MouseEvent | TouchEvent) => void
  onDragEnd?: (e: MouseEvent | TouchEvent) => void
}

function useDrag(options: UseDragOptions) {
  const { disabled, onDragStart, onDrag, onDragEnd } = options
  const [isDragging, setIsDragging] = useState(false)
  const dragStateRef = useRef<DragState | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return
      if (onDragStart && !onDragStart(e.nativeEvent)) return

      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startValue: 0,
        totalDistanceMoved: 0,
        detected: false,
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragStateRef.current) return

        const { startX, startY, detected } = dragStateRef.current
        const deltaX = e.clientX - startX
        const deltaY = startY - e.clientY // Invert Y axis so up is positive

        if (!detected) {
          dragStateRef.current.totalDistanceMoved += Math.abs(deltaX) + Math.abs(deltaY)
          if (dragStateRef.current.totalDistanceMoved > 5) {
            // Drag detection threshold
            dragStateRef.current.detected = true
            setIsDragging(true)
          }
        }

        if (dragStateRef.current.detected && onDrag) {
          onDrag(deltaX, deltaY, e)
        }
      }

      const handleMouseUp = (e: MouseEvent) => {
        if (dragStateRef.current?.detected) {
          setIsDragging(false)
          onDragEnd?.(e)
        }
        dragStateRef.current = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [disabled, onDragStart, onDrag, onDragEnd]
  )

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return
      if (onDragStart && !onDragStart(e)) return

      dragStateRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startValue: 0,
        totalDistanceMoved: 0,
        detected: false,
      }

      const handleTouchMove = (e: TouchEvent) => {
        if (!dragStateRef.current) return

        const { startX, startY, detected } = dragStateRef.current
        const deltaX = e.touches[0].clientX - startX
        const deltaY = startY - e.touches[0].clientY

        if (!detected) {
          dragStateRef.current.totalDistanceMoved += Math.abs(deltaX) + Math.abs(deltaY)
          if (dragStateRef.current.totalDistanceMoved > 5) {
            dragStateRef.current.detected = true
            setIsDragging(true)
          }
        }

        if (dragStateRef.current.detected && onDrag) {
          onDrag(deltaX, deltaY, e)
        }
      }

      const handleTouchEnd = (e: TouchEvent) => {
        if (dragStateRef.current?.detected) {
          setIsDragging(false)
          onDragEnd?.(e)
        }
        dragStateRef.current = null
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleTouchEnd)
      }

      document.addEventListener('touchmove', handleTouchMove)
      document.addEventListener('touchend', handleTouchEnd)
    },
    [disabled, onDragStart, onDrag, onDragEnd]
  )

  return {
    isDragging,
    handleMouseDown,
    handleTouchStart,
  }
}

function StepLadder({
  baseStep,
  currentStepMultiplier,
  mousePos,
  containerRect,
}: {
  baseStep: number
  currentStepMultiplier: number
  mousePos: { x: number; y: number }
  containerRect?: DOMRect | null
}) {
  // Generate step ladder showing current and neighboring step sizes (largest on top)
  const steps = []
  for (let i = 2; i >= -2; i--) {
    // Reverse order: 2, 1, 0, -1, -2
    const multiplier = Math.pow(10, i)
    const stepSize = baseStep * multiplier

    // Check if this step size matches the current snapped step size
    const isActive = Math.abs(currentStepMultiplier - multiplier) < 0.01

    steps.push({
      multiplier,
      stepSize,
      isActive,
      label:
        stepSize >= 1
          ? stepSize.toString()
          : stepSize.toFixed(Math.max(0, -Math.floor(Math.log10(stepSize)))),
    })
  }

  // Position the ladder behind the mouse cursor, relative to container
  const defaultStepIndex = steps.findIndex(step => step.multiplier === 1)
  const stepItemHeight = 28 // Adjusted height based on CSS: padding(3px) + margin(1px) + font + borders

  let topPosition = 0
  let leftPosition = 0

  if (containerRect) {
    // Convert global mouse coordinates to relative coordinates within the container
    const relativeMouseX = mousePos.x - containerRect.left
    const relativeMouseY = mousePos.y - containerRect.top

    // Position so the default step (1x) is centered at the mouse position
    topPosition = relativeMouseY - (defaultStepIndex * stepItemHeight + stepItemHeight / 2)
    leftPosition = relativeMouseX - 40 // Increased offset to better center behind cursor
  }

  return (
    <div
      className={s.stepLadder}
      style={{
        left: `${leftPosition}px`,
        top: `${topPosition}px`,
        transform: 'none',
      }}
    >
      {steps.map(({ multiplier, stepSize, isActive, label }) => (
        <div
          key={multiplier}
          className={cx(s.stepLadderItem, {
            [s.stepLadderItemActive]: isActive,
          })}
          title={`Step size: ${stepSize}`}
        >
          <span className={s.stepLadderLabel}>{label}</span>
        </div>
      ))}
    </div>
  )
}

function DraggableNumberInput({
  id,
  value,
  disabled,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  className,
  title,
}: {
  id?: string
  value: number
  disabled: boolean
  onChange: (val: number) => void
  onCommit?: () => void
  min?: number
  max?: number
  step?: number
  className?: string
  title?: string
}) {
  const [displayValue, setDisplayValue] = useState<string>(value.toString())
  const [isActive, setIsActive] = useState<boolean>(false)
  const [currentStepMultiplier, setCurrentStepMultiplier] = useState<number>(1)
  const [isDragStarted, setIsDragStarted] = useState<boolean>(false)
  const [showLadder, setShowLadder] = useState<boolean>(false)
  const [initialMousePos, setInitialMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const startValueRef = useRef<number>(0)
  const isHorizontalLockedRef = useRef<boolean>(false)
  const lockedStepMultiplierRef = useRef<number>(1)
  const ladderTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setDisplayValue(value.toString())
  }, [value])

  useEffect(() => {
    const cleanup = () => {
      if (isDragStarted) {
        setIsDragStarted(false)
        setShowLadder(false)
        isHorizontalLockedRef.current = false
        setCurrentStepMultiplier(1)
        lockedStepMultiplierRef.current = 1
        if (ladderTimerRef.current) {
          clearTimeout(ladderTimerRef.current)
          ladderTimerRef.current = null
        }
      }
    }

    document.addEventListener('mouseup', cleanup)
    window.addEventListener('blur', cleanup)
    return () => {
      document.removeEventListener('mouseup', cleanup)
      window.removeEventListener('blur', cleanup)
    }
  }, [isDragStarted])

  const onInputChange = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const newValue = e.currentTarget.value
      setDisplayValue(newValue)
      if (newValue !== '') {
        onChange(+newValue)
      }
    },
    [onChange]
  )

  const { isDragging, handleMouseDown, handleTouchStart } = useDrag({
    disabled,
    onDragStart: e => {
      const target = e.target as HTMLInputElement
      if (
        target.type === 'number' &&
        ('offsetX' in e ? e.offsetX : (e as any).touches[0].clientX - target.offsetLeft) >
          target.offsetWidth - 20
      ) {
        return false
      }

      startValueRef.current = value
      setInitialMousePos({
        x: 'clientX' in e ? e.clientX : (e as any).touches[0].clientX,
        y: 'clientY' in e ? e.clientY : (e as any).touches[0].clientY,
      })
      setCurrentStepMultiplier(1)
      isHorizontalLockedRef.current = false
      setIsDragStarted(true)
      lockedStepMultiplierRef.current = 1

      ladderTimerRef.current = setTimeout(() => {
        window.getSelection()?.removeAllRanges()
        setShowLadder(true)
      }, 400)

      return true
    },
    onDrag: (deltaX, deltaY) => {
      const horizontalMovement = Math.abs(deltaX) > 15

      let snappedStepMultiplier = 1

      if (!isHorizontalLockedRef.current) {
        const rawStepMultiplier = Math.pow(10, deltaY / 20)
        const logMultiplier = Math.log10(rawStepMultiplier)
        const snappedLogMultiplier = Math.round(logMultiplier)
        const clampedLogMultiplier = Math.max(-2, Math.min(2, snappedLogMultiplier))
        snappedStepMultiplier = Math.pow(10, clampedLogMultiplier)
      }

      if (!isHorizontalLockedRef.current) {
        if (!horizontalMovement) {
          setCurrentStepMultiplier(snappedStepMultiplier)
        } else {
          lockedStepMultiplierRef.current = snappedStepMultiplier
          isHorizontalLockedRef.current = true
        }
      }

      if (horizontalMovement || isHorizontalLockedRef.current) {
        const activeStepMultiplier = isHorizontalLockedRef.current
          ? lockedStepMultiplierRef.current
          : snappedStepMultiplier
        const stepSize = activeStepMultiplier * step
        const valueChange = Math.round(deltaX) * stepSize
        const newValue = startValueRef.current + valueChange
        const clampedValue =
          min !== undefined && max !== undefined ? Math.min(Math.max(newValue, min), max) : newValue
        const fixedValue = parseFloat(clampedValue.toFixed(7))

        setDisplayValue(fixedValue.toString())
        onChange(fixedValue)
      }
    },
    onDragEnd: () => {
      setCurrentStepMultiplier(1)
      isHorizontalLockedRef.current = false
      lockedStepMultiplierRef.current = 1
      setIsDragStarted(false)
      setShowLadder(false)
      if (ladderTimerRef.current) {
        clearTimeout(ladderTimerRef.current)
        ladderTimerRef.current = null
      }
      onCommit?.()
    },
  })

  const shouldShowLadder = showLadder && isDragStarted && !isHorizontalLockedRef.current
  const containerRect = containerRef.current?.getBoundingClientRect()
  const formatted =
    displayValue === '' ? '' : Math.round((+displayValue + Number.EPSILON) * 100) / 100

  return (
    <div
      className={s.fieldInputWrapper}
      style={{ position: 'relative' }}
      tabIndex={-1}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      ref={containerRef}
    >
      <input
        id={id}
        ref={inputRef}
        type="number"
        onFocus={() => setIsActive(true)}
        onBlur={() => {
          setIsActive(false)
          onCommit?.()
        }}
        className={cx(className, {
          [s.fieldInputNumberDragging]: isDragging,
        })}
        value={isActive ? displayValue : formatted}
        title={title || displayValue}
        onChange={onInputChange}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
      />
      {shouldShowLadder && (
        <StepLadder
          baseStep={step}
          currentStepMultiplier={currentStepMultiplier}
          mousePos={initialMousePos}
          containerRect={containerRect}
        />
      )}
    </div>
  )
}

export function NumberFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: NumberField
  disabled: boolean
}) {
  const [value, setValue] = useState<number>(guardAccessorFallback(field.value))

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const handleChange = useCallback(
    (val: number) => {
      setValue(val)
      field.setValue(val)
    },
    [field]
  )

  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel} htmlFor={id}>
        {id}
      </label>
      <DraggableNumberInput
        id={id}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        min={field.min}
        max={field.max}
        step={field.step}
        className={cx(s.fieldInput, s.fieldInputNumber)}
        title={value.toString()}
      />
    </div>
  )
}

export function BooleanFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: BooleanField
  disabled: boolean
}) {
  const [value, setValue] = useState<boolean>(guardAccessorFallback(field.value))

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      field.setValue(e.currentTarget.checked)
    },
    [field]
  )

  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel} htmlFor={id}>
        {id}
      </label>
      <div className={s.fieldInputWrapper}>
        <input
          id={id}
          className={cx('revert', s.fieldInput, s.fieldInputCheckbox)}
          type="checkbox"
          checked={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

export function DateFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: DateField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = e => {
    field.setValue(new Date(`${e.currentTarget.value}:00.000Z`))
  }

  const isoString = value.toISOString()
  const formatted = isoString.substring(0, isoString.indexOf('T') + 6)

  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel} htmlFor={id}>
        {id}
      </label>
      <div className={s.fieldInputWrapper}>
        <input
          id={id}
          type="datetime-local"
          className={s.fieldInput}
          value={formatted}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

export function ColorFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: ColorField
  disabled: boolean
}) {
  const [value, setValue] = useState(guardAccessorFallback(field.value))

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      if (typeof newVal === 'function') return
      setValue(newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const onChange = e => {
    field.setValue(e.currentTarget.value)
  }

  const formatted = typeof value === 'string' ? value : colorToHex(value, false)

  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel} htmlFor={id}>
        {id}
      </label>
      <div className={s.fieldInputWrapper}>
        <input
          id={id}
          type="color"
          className={cx(s.fieldInput, s.fieldInputColor)}
          value={formatted}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

export function ColorRampComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: ColorRampField | CategoricalColorRampField
  disabled: boolean
}) {
  const [interpolate, setInterpolate] = useState<
    ScaleOrdinal<string, string> | ScaleLinear<number, string>
  >(() => field.value)
  const steps = field instanceof CategoricalColorRampField ? field.count : 512

  useEffect(() => {
    const sub = field.subscribe(newVal => {
      setInterpolate(() => newVal)
    })
    return () => sub.unsubscribe()
  }, [field])

  const _onChange = e => {
    if (disabled) return
    field.setValue(e.currentTarget.value)
  }

  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // const gradient = ctx.createLinearGradient(0, 0, 200, 0)
    // gradient.addColorStop(0, 'red')
    // gradient.addColorStop(0.5, 'green')
    // gradient.addColorStop(1, 'blue')

    // ctx.fillStyle = gradient
    // ctx.fillRect(0, 0, 200, 100)

    for (let i = 0; i < steps; ++i) {
      const val = field instanceof CategoricalColorRampField ? `${id}-${i}` : i / (steps - 1)
      ctx.fillStyle = interpolate(val)
      ctx.fillRect(i, 0, 1, 1)
    }
  }, [interpolate, field, id, steps])

  return (
    <div className={s.fieldWrapper}>
      <canvas className={s.fieldInputColorRamp} ref={canvasRef} width={steps} height={1} />
    </div>
  )
}

export function CompoundFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: CompoundPropsField
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel} htmlFor={id} onClick={() => setExpanded(e => !e)}>
        {id}
        <span>{expanded ? ' <' : ' >'}</span>
      </label>
      {expanded && (
        <div id={id} className={s.fieldCompoundWrapper}>
          {Object.entries(field.fields).map(([key, subField]) => (
            <FieldComponent key={key} id={key} field={subField} disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  )
}

export function EmptyFieldComponent({ id }: { id: OpId; field: Field<IField> }) {
  return (
    <div className={s.fieldWrapper}>
      <label className={s.fieldLabel}>{id}</label>
    </div>
  )
}

export function BezierCurveFieldComponent({
  id,
  field,
  disabled,
}: {
  id: OpId
  field: BezierCurveField
  disabled: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<{
    isDragging: boolean
    dragIndex: number
    dragType: 'point' | 'handle-left' | 'handle-right'
    startX: number
    startY: number
  } | null>(null)

  const svgSize = { width: 200, height: 150 }
  const padding = { top: 10, right: 10, bottom: 20, left: 20 }
  const graphArea = {
    width: svgSize.width - padding.left - padding.right,
    height: svgSize.height - padding.top - padding.bottom,
  }

  // Convert SVG coordinates to curve coordinates (0-1, 0-1)
  const svgToCurve = useCallback(
    (x: number, y: number) => {
      const curveX = (x - padding.left) / graphArea.width
      const curveY = 1 - (y - padding.top) / graphArea.height // Flip Y axis
      return {
        x: Math.max(0, Math.min(1, curveX)),
        y: Math.max(0, Math.min(1, curveY)),
      }
    },
    [graphArea.width, graphArea.height]
  )

  // Convert curve coordinates to SVG coordinates
  const curveToSvg = useCallback(
    (x: number, y: number) => ({
      x: padding.left + x * graphArea.width,
      y: padding.top + (1 - y) * graphArea.height, // Flip Y axis
    }),
    [graphArea.width, graphArea.height]
  )

  // Generate SVG path for the bezier curve
  const generateCurvePath = useCallback(() => {
    const { points } = field.value
    if (points.length === 0) return ''

    let pathData = ''

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i]
      const p1 = points[i + 1]

      const startPos = curveToSvg(p0.x, p0.y)
      const endPos = curveToSvg(p1.x, p1.y)

      const cp1 = curveToSvg(
        p0.handleRightX ?? p0.x + (p1.x - p0.x) * 0.33,
        p0.handleRightY ?? p0.y
      )
      const cp2 = curveToSvg(p1.handleLeftX ?? p1.x - (p1.x - p0.x) * 0.33, p1.handleLeftY ?? p1.y)

      if (i === 0) {
        pathData += `M ${startPos.x} ${startPos.y} `
      }

      pathData += `C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${endPos.x} ${endPos.y} `
    }

    return pathData
  }, [field.value, curveToSvg])

  // Generate grid lines
  const generateGridLines = useCallback(() => {
    const lines = []

    // Vertical grid lines
    for (let i = 0; i <= 4; i++) {
      const x = padding.left + (i / 4) * graphArea.width
      lines.push(
        <line
          key={`v-${i}`}
          x1={x}
          y1={padding.top}
          x2={x}
          y2={padding.top + graphArea.height}
          stroke="#333"
          strokeWidth="1"
        />
      )
    }

    // Horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (i / 4) * graphArea.height
      lines.push(
        <line
          key={`h-${i}`}
          x1={padding.left}
          y1={y}
          x2={padding.left + graphArea.width}
          y2={y}
          stroke="#333"
          strokeWidth="1"
        />
      )
    }

    return lines
  }, [graphArea])

  // Find what the user is trying to interact with
  const getInteractionTarget = useCallback(
    (x: number, y: number) => {
      const { points } = field.value

      for (let i = 0; i < points.length; i++) {
        const point = points[i]

        // Check control point
        const pos = curveToSvg(point.x, point.y)
        const distanceToPoint = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2))

        if (distanceToPoint <= 6) {
          return { type: 'point' as const, index: i }
        }

        // Check left handle
        if (point.handleLeftX !== undefined && point.handleLeftY !== undefined) {
          const handlePos = curveToSvg(point.handleLeftX, point.handleLeftY)
          const distanceToHandle = Math.sqrt(
            Math.pow(x - handlePos.x, 2) + Math.pow(y - handlePos.y, 2)
          )

          if (distanceToHandle <= 6) {
            return { type: 'handle-left' as const, index: i }
          }
        }

        // Check right handle
        if (point.handleRightX !== undefined && point.handleRightY !== undefined) {
          const handlePos = curveToSvg(point.handleRightX, point.handleRightY)
          const distanceToHandle = Math.sqrt(
            Math.pow(x - handlePos.x, 2) + Math.pow(y - handlePos.y, 2)
          )

          if (distanceToHandle <= 6) {
            return { type: 'handle-right' as const, index: i }
          }
        }
      }

      return null
    },
    [field.value, curveToSvg]
  )

  // Get mouse position relative to SVG with proper scaling
  const getMousePosition = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }

    // Create an SVG point and use the SVG coordinate transformation
    const point = svg.createSVGPoint()
    point.x = e.clientX
    point.y = e.clientY

    // Transform the point to SVG coordinates
    const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse())

    return {
      x: svgPoint.x,
      y: svgPoint.y,
    }
  }, [])

  // Handle mouse events
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (disabled) return

      const { x, y } = getMousePosition(e)
      const target = getInteractionTarget(x, y)

      if (target) {
        setDragState({
          isDragging: true,
          dragIndex: target.index,
          dragType: target.type,
          startX: x,
          startY: y,
        })
      } else {
        // Add new point if clicking on empty space within the graph area
        const curvePos = svgToCurve(x, y)
        if (curvePos.x >= 0 && curvePos.x <= 1 && curvePos.y >= 0 && curvePos.y <= 1) {
          field.addPoint(curvePos.x, curvePos.y)
        }
      }
    },
    [disabled, getInteractionTarget, svgToCurve, field, getMousePosition]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragState?.isDragging) return

      const { x, y } = getMousePosition(e)
      const curvePos = svgToCurve(x, y)

      const { dragIndex, dragType } = dragState

      if (dragType === 'point') {
        field.updatePoint(dragIndex, { x: curvePos.x, y: curvePos.y })
      } else if (dragType === 'handle-left') {
        field.updatePoint(dragIndex, {
          handleLeftX: curvePos.x,
          handleLeftY: curvePos.y,
        })
      } else if (dragType === 'handle-right') {
        field.updatePoint(dragIndex, {
          handleRightX: curvePos.x,
          handleRightY: curvePos.y,
        })
      }
    },
    [dragState, svgToCurve, field, getMousePosition]
  )

  const handleMouseUp = useCallback(() => {
    setDragState(null)
  }, [])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (disabled) return

      const { x, y } = getMousePosition(e)
      const target = getInteractionTarget(x, y)

      if (target && target.type === 'point') {
        // Remove point on double-click
        field.removePoint(target.index)
      }
    },
    [disabled, getInteractionTarget, field, getMousePosition]
  )

  // Handle point selection for showing controls
  const handlePointClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (disabled) return

      const { x, y } = getMousePosition(e)
      const target = getInteractionTarget(x, y)

      if (target && target.type === 'point') {
        field.setSelectedPoint(target.index)
      } else {
        field.setSelectedPoint(null)
      }
    },
    [disabled, getInteractionTarget, field, getMousePosition]
  )

  const { points } = field.value
  const selectedPoint = field.getSelectedPoint()
  const selectedIndex = field.selectedPointIndex
  const curvePath = generateCurvePath()
  const gridLines = generateGridLines()

  return (
    <div className={s.fieldWrapper} ref={containerRef}>
      <label className={s.fieldLabel} htmlFor={id}>
        {id}
      </label>
      <div className="bezier-curve-editor">
        <svg
          ref={svgRef}
          width={svgSize.width}
          height={svgSize.height}
          viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onClick={handlePointClick}
          style={{
            cursor: dragState?.isDragging ? 'grabbing' : 'crosshair',
            border: '1px solid #555',
            borderRadius: '4px',
            backgroundColor: '#1a1a1a',
            display: 'block',
            maxWidth: '100%',
            height: 'auto',
          }}
        >
          {/* Background */}
          <rect width={svgSize.width} height={svgSize.height} fill="#1a1a1a" />

          {/* Grid */}
          {gridLines}

          {/* Border */}
          <rect
            x={padding.left}
            y={padding.top}
            width={graphArea.width}
            height={graphArea.height}
            fill="none"
            stroke="#555"
            strokeWidth="1"
          />

          {/* Curve path */}
          {curvePath && <path d={curvePath} fill="none" stroke="#ffffff" strokeWidth="2" />}

          {/* Control points and handles */}
          {points.map((point, index) => {
            const pos = curveToSvg(point.x, point.y)
            const isSelected = selectedIndex === index

            return (
              <g key={index}>
                {/* Left handle */}
                {point.handleLeftX !== undefined && point.handleLeftY !== undefined && (
                  <g>
                    <line
                      x1={pos.x}
                      y1={pos.y}
                      x2={curveToSvg(point.handleLeftX, point.handleLeftY).x}
                      y2={curveToSvg(point.handleLeftX, point.handleLeftY).y}
                      stroke="#888"
                      strokeWidth="1"
                    />
                    <circle
                      cx={curveToSvg(point.handleLeftX, point.handleLeftY).x}
                      cy={curveToSvg(point.handleLeftX, point.handleLeftY).y}
                      r="3"
                      fill="#888"
                    />
                  </g>
                )}

                {/* Right handle */}
                {point.handleRightX !== undefined && point.handleRightY !== undefined && (
                  <g>
                    <line
                      x1={pos.x}
                      y1={pos.y}
                      x2={curveToSvg(point.handleRightX, point.handleRightY).x}
                      y2={curveToSvg(point.handleRightX, point.handleRightY).y}
                      stroke="#888"
                      strokeWidth="1"
                    />
                    <circle
                      cx={curveToSvg(point.handleRightX, point.handleRightY).x}
                      cy={curveToSvg(point.handleRightX, point.handleRightY).y}
                      r="3"
                      fill="#888"
                    />
                  </g>
                )}

                {/* Control point */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r="4"
                  fill={isSelected ? '#ff8800' : '#ffffff'}
                  stroke={isSelected ? '#ffffff' : 'none'}
                  strokeWidth={isSelected ? '1' : '0'}
                />
              </g>
            )
          })}
        </svg>

        {/* Active point controls */}
        {selectedPoint && selectedIndex !== null && (
          <div
            className="bezier-point-controls"
            style={{
              marginTop: '8px',
              padding: '6px',
              backgroundColor: '#2a2a2a',
              borderRadius: '4px',
              border: '1px solid #555',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
            }}
          >
            {/* Position controls */}
            <input
              type="number"
              title="X Position"
              value={selectedPoint.x.toFixed(4)}
              onChange={e => {
                const newX = parseFloat(e.target.value)
                if (!Number.isNaN(newX)) {
                  field.updatePoint(selectedIndex, { x: newX })
                }
              }}
              style={{
                width: '50px',
                padding: '2px 4px',
                fontSize: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
              }}
              step="0.0001"
              min="0"
              max="1"
              disabled={disabled}
            />
            <input
              type="number"
              title="Y Position"
              value={selectedPoint.y.toFixed(4)}
              onChange={e => {
                const newY = parseFloat(e.target.value)
                if (!Number.isNaN(newY)) {
                  field.updatePoint(selectedIndex, { y: newY })
                }
              }}
              style={{
                width: '50px',
                padding: '2px 4px',
                fontSize: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #555',
                borderRadius: '2px',
                color: '#fff',
              }}
              step="0.0001"
              min="0"
              max="1"
              disabled={disabled}
            />

            {/* Handle type toggle group */}
            <div
              style={{
                display: 'flex',
                border: '1px solid #555',
                borderRadius: '3px',
                overflow: 'hidden',
                marginLeft: '8px',
              }}
            >
              {[
                { value: 'auto', icon: '○', title: 'Auto' },
                { value: 'vector', icon: '▶', title: 'Vector' },
                { value: 'auto-clamped', icon: '─', title: 'Auto Clamped' },
                { value: 'free', icon: '●', title: 'Free' },
              ].map(handleType => {
                const isLeftSelected =
                  selectedPoint.handleLeftType === handleType.value ||
                  (!selectedPoint.handleLeftType && handleType.value === 'free')
                const isRightSelected =
                  selectedPoint.handleRightType === handleType.value ||
                  (!selectedPoint.handleRightType && handleType.value === 'free')
                const isSelected = isLeftSelected && isRightSelected

                return (
                  <button
                    key={handleType.value}
                    type="button"
                    title={`${handleType.title} Handle`}
                    onClick={() => {
                      field.updateHandleType(
                        selectedIndex,
                        'left',
                        handleType.value as 'auto' | 'vector' | 'auto-clamped' | 'free'
                      )
                      field.updateHandleType(
                        selectedIndex,
                        'right',
                        handleType.value as 'auto' | 'vector' | 'auto-clamped' | 'free'
                      )
                    }}
                    style={{
                      padding: '3px 6px',
                      fontSize: '10px',
                      backgroundColor: isSelected ? '#555' : '#333',
                      border: 'none',
                      color: isSelected ? '#fff' : '#aaa',
                      cursor: disabled ? 'default' : 'pointer',
                      minWidth: '20px',
                    }}
                    disabled={disabled}
                  >
                    {handleType.icon}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div
          className="bezier-curve-controls"
          style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}
        >
          Click to add point • Click point to select • Double-click to remove • Drag to move
        </div>
      </div>
    </div>
  )
}

export function FieldComponent({
  id: fieldId,
  field,
  disabled,
}: {
  id: OpId
  field: Field<IField>
  disabled: boolean
}) {
  const nid = useNodeId()
  const edges = useEdges()
  const qualifiedFieldId = `par.${fieldId}`
  const incomers = edges.filter(
    edge =>
      edge.target === nid && edge.targetHandle === qualifiedFieldId && edge.type !== 'ReferenceEdge'
  )

  if (incomers.length > 0) {
    return <EmptyFieldComponent id={fieldId} field={field} />
  }

  const ctor = field.constructor as unknown as Field<IField>

  const InputComp = inputComponents[ctor.type]
  return <InputComp id={fieldId} field={field} disabled={disabled} />
}
