import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'
import ReactJson from '@microlink/react-json-view'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { ISheet } from '@theatre/core'
import {
  BaseEdge,
  type EdgeProps,
  getStraightPath,
  Handle,
  NodeResizer,
  Position,
  type EdgeTypes as ReactFlowEdgeTypes,
  type NodeProps as ReactFlowNodeProps,
  type NodeTypes as ReactFlowNodeTypes,
  useNodeId,
  useReactFlow,
} from '@xyflow/react'
import cx from 'classnames'
import { Layer } from 'deck.gl'
import { isPlainObject } from 'lodash'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Temporal } from 'temporal-polyfill'

import { analytics } from '../../utils/analytics'
import { SheetContext } from '../../utils/sheet-context'
import { ArrayField, type Field, type IField, ListField } from '../fields'
import { useKeysStore } from '../keys-store'
import s from '../noodles.module.css'
import type { ExecutionState, IOperator, OpType } from '../operators'
import {
  type ContainerOp,
  type DirectionsOp,
  type GeocoderOp,
  type MouseOp,
  mathOpDescriptions,
  mathOps,
  Operator,
  opTypes,
  type TableEditorOp,
  type TimeOp,
  type ViewerOp,
} from '../operators'
import {
  getOp,
  hasOp,
  setHoveredOutputHandle,
  updateOperatorId,
  useNestingStore,
  useOperatorStore,
} from '../store'
import type { NodeDataJSON } from '../transform-graph'
import type { NodeType } from '../utils/node-creation-utils'
import { generateQualifiedPath, getBaseName, getParentPath } from '../utils/path-utils'
import { categories as baseCategories, nodeTypeToDisplayName } from './categories'
import { FieldComponent, type inputComponents } from './field-components'
import previewStyles from './handle-preview.module.css'

// Extend categories with mathOps for UI purposes (add node menu, header classes, typeCategory)
// Base categories.ts doesn't include mathOps to keep it clean for context generation
const categories: Record<string, string[]> = Object.fromEntries(
  Object.entries(baseCategories).map(([key, value]) => {
    if (key === 'number') {
      return [key, [...value, ...Object.keys(mathOps)]]
    }
    return [key, [...value]]
  })
)

const SLOW_EXECUTION_THRESHOLD_MS = 100

// Hook to subscribe to operator execution state
function useExecutionState(op: Operator<IOperator>): ExecutionState {
  const [executionState, setExecutionState] = useState<ExecutionState>({ status: 'idle' })

  useEffect(() => {
    const subscription = op.executionState.subscribe(setExecutionState)
    return () => subscription.unsubscribe()
  }, [op])

  return executionState
}

// Hook to subscribe to operator connection errors
function useConnectionErrors(op: Operator<IOperator>): Map<string, string> {
  const [connectionErrors, setConnectionErrors] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const subscription = op.connectionErrors.subscribe(setConnectionErrors)
    return () => subscription.unsubscribe()
  }, [op])

  return connectionErrors
}

const defaultNodeComponents = {} as Record<OpType, typeof NodeComponent>
for (const key of Object.keys(opTypes)) {
  defaultNodeComponents[key] = NodeComponent
}

export const nodeComponents = {
  ...defaultNodeComponents,
  GeocoderOp: GeocoderOpComponent,
  DirectionsOp: DirectionsOpComponent,
  MouseOp: MouseOpComponent,
  TableEditorOp: TableEditorOpComponent,
  TimeOp: TimeOpComponent,
  ViewerOp: ViewerOpComponent,
  ContainerOp: ContainerOpComponent,
} as const as ReactFlowNodeTypes

export const edgeComponents = {
  ReferenceEdge: ReferenceEdgeComponent,
} as const as ReactFlowEdgeTypes

function ReferenceEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  })

  return (
    <BaseEdge path={edgePath} markerEnd={markerEnd} className={s.referenceEdge} style={style} />
  )
}

export const resizeableNodes = [
  'ViewerOp',
  'TableEditorOp',
  'CodeOp',
  'DuckDbOp',
  'JSONOp',
] as const

function toPascal(str: string) {
  return `${str[0].toUpperCase()}${str.slice(1)}`
}

export function typeDisplayName(type: NodeType) {
  return type.replace(/Op$/, '')
}

// Get the description for any node type, including special cases like ForLoop and math operators
export function getNodeDescription(type: NodeType): string {
  // Check for regular operators first
  if (type in opTypes) {
    return opTypes[type]?.description || ''
  }

  // Check for math operators
  if (type in mathOps) {
    return mathOpDescriptions[type] || 'Perform a mathematical operation'
  }

  // Check for ForLoop
  if (type === 'ForLoop') {
    return 'Control flow to loop over all elements in an array'
  }

  return ''
}

export function typeCategory(type: NodeType) {
  // Check for type directly first (handles mathOps like AddOp, MultiplyOp, etc.)
  for (const [category, types] of Object.entries(categories)) {
    if ((types as readonly string[]).includes(type)) {
      return toPascal(category)
    }
  }
  // Fall back to checking display name (handles regular operators)
  const displayName = nodeTypeToDisplayName(type)
  for (const [category, types] of Object.entries(categories)) {
    if ((types as readonly string[]).includes(displayName)) {
      return toPascal(category)
    }
  }
  return 'Unknown'
}

const headerClasses = {
  code: s.headerCode,
  color: s.headerColor,
  data: s.headerData,
  effect: s.headerEffect,
  extension: s.headerExtension,
  geojson: s.headerGeojson,
  grouping: s.headerGrouping,
  layer: s.headerLayer,
  number: s.headerNumber,
  string: s.headerString,
  utility: s.headerUtility,
  vector: s.headerVector,
  view: s.headerView,
  widget: s.headerWidget,
} as const as Record<keyof typeof categories, string>

export function headerClass(type: NodeType) {
  // Check for type directly first (handles mathOps like AddOp, MultiplyOp, etc.)
  for (const [category, types] of Object.entries(categories)) {
    if ((types as readonly string[]).includes(type)) {
      return headerClasses[category]
    }
  }
  // Fall back to checking display name (handles regular operators)
  const displayName = nodeTypeToDisplayName(type)
  for (const [category, types] of Object.entries(categories)) {
    if ((types as readonly string[]).includes(displayName)) {
      return headerClasses[category]
    }
  }
  return s.headerData
}

const handleClasses = {
  array: s.handleArray,
  'bezier-curve': s.handleData,
  boolean: s.handleBoolean,
  'category-color-ramp': s.handleColor,
  code: s.handleCode,
  color: s.handleColor,
  'color-ramp': s.handleColor,
  compound: s.handleCompound,
  data: s.handleData,
  effect: s.handleEffect,
  expression: s.handleCode,
  extension: s.handleExtension,
  file: s.handleString,
  function: s.handleCode,
  geojson: s.handleGeojson,
  'geopoint-2d': s.handleVector,
  'geopoint-3d': s.handleVector,
  'json-url': s.handleString,
  layer: s.handleLayer,
  list: s.handleList,
  number: s.handleNumber,
  string: s.handleString,
  'string-literal': s.handleString,
  unknown: s.handleData,
  vec2: s.handleVector,
  vec3: s.handleVector,
  vec4: s.handleVector,
  view: s.handleView,
  visualization: s.handleData,
  widget: s.handleWidget,
} as const as Record<keyof typeof inputComponents, string>

export const handleClass = (field: Field<IField>): string => {
  const { type } = field.constructor as typeof Field
  if (field instanceof ListField || field instanceof ArrayField) {
    return cx(handleClasses[type], handleClass(field.field))
  }
  return handleClasses[type]
}

export const SOURCE_HANDLE = 'source'
export const TARGET_HANDLE = 'target'
export const PAR_NAMESPACE = 'par'
export const OUT_NAMESPACE = 'out'

function useLocked(op: Operator<IOperator>) {
  const [locked, setLocked] = useState(op.locked.value)
  useEffect(() => {
    op.locked.subscribe(setLocked)
  }, [op])
  return locked
}

function HandlePreviewContent({ data, name, type }: { data: unknown; name: string; type: string }) {
  return (
    <>
      <div className={previewStyles.handlePreviewHeader}>
        <span className={previewStyles.handlePreviewName}>{name}</span>
        <span className={previewStyles.handlePreviewType}>({type})</span>
      </div>
      <div className={previewStyles.handlePreviewBody}>
        {data === null || data === undefined ? (
          <div className={previewStyles.handlePreviewEmpty}>No data</div>
        ) : data instanceof Element ? (
          <ViewerDOMContent content={data} />
        ) : data instanceof Set ? (
          <ReactJson src={Array.from(data)} theme="twilight" collapsed={1} />
        ) : Array.isArray(data) &&
          data.length > 0 &&
          data.length < 10 &&
          isPlainObject(data[0]) &&
          Object.keys(data[0]).length < 10 ? (
          (() => {
            const keys = Object.keys(data[0] || {})
            return (
              <table className={previewStyles.handlePreviewTable}>
                <thead>
                  <tr>
                    {keys.map(key => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={`row-${i}-${JSON.stringify(row).slice(0, 50)}`}>
                      {keys.map(key => (
                        <td key={key}>
                          {typeof row[key] === 'string' ? row[key] : JSON.stringify(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()
        ) : data instanceof Operator ? (
          <ReactJson src={data} theme="twilight" />
        ) : data instanceof Promise ? (
          <div className={previewStyles.handlePreviewEmpty}>Loading...</div>
        ) : (
          <ReactJson src={data} theme="twilight" />
        )}
      </div>
    </>
  )
}

// Output handle component that renders just a handle (no label, no input UI)
function OutputHandle({ id, field }: { id: string; field: Field<IField> }) {
  const nid = useNodeId()
  const qualifiedFieldId = `${OUT_NAMESPACE}.${id}`

  // Handle preview state
  const [previewData, setPreviewData] = useState<unknown>(null)
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 })
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Track hovered output handle for viewer creation
      if (nid) {
        setHoveredOutputHandle({ nodeId: nid, handleId: qualifiedFieldId })
      }

      // Store the current target immediately
      const currentTarget = e.currentTarget
      hoverTimerRef.current = setTimeout(() => {
        // Get the handle's position in the viewport
        const rect = currentTarget.getBoundingClientRect()
        setPreviewPosition({ x: rect.right, y: rect.top })
        setPreviewData(viewerFormatter(field.value))
      }, 1000)
    },
    [field, nid, qualifiedFieldId]
  )

  const handleMouseLeave = useCallback(() => {
    // Clear hovered output handle
    setHoveredOutputHandle(null)

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setPreviewData(null)
  }, [])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  const { type } = field.constructor as typeof Field

  return (
    <div style={{ position: 'relative', flex: 1, pointerEvents: 'auto' }}>
      <Handle
        id={qualifiedFieldId}
        className={handleClass(field)}
        style={{ transform: 'translate(4px, -50%)' }}
        type="source"
        position={Position.Right}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
      {previewData &&
        createPortal(
          <div
            className={previewStyles.handlePreview}
            style={{
              left: `${previewPosition.x}px`,
              top: `${previewPosition.y}px`,
            }}
          >
            <HandlePreviewContent data={previewData} name={id} type={type} />
          </div>,
          document.body
        )}
    </div>
  )
}

function NodeComponent({
  id,
  type,
  selected,
}: ReactFlowNodeProps<NodeDataJSON<Operator<IOperator>>> & { type: OpType }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }
  const locked = useLocked(op)
  const executionState = useExecutionState(op)
  const connectionErrors = useConnectionErrors(op)
  const hasConnectionErrors = connectionErrors.size > 0

  return (
    <div
      className={cx(s.wrapper, {
        [s.wrapperError]: executionState.status === 'error' || hasConnectionErrors,
        [s.wrapperExecuting]: executionState.status === 'executing',
      })}
    >
      <NodeHeader id={id} type={type} op={op} connectionErrors={connectionErrors} />
      {resizeableNodes.includes(type) && (
        <NodeResizer isVisible={selected} minWidth={200} minHeight={100} />
      )}
      <div className={s.content}>
        {Object.entries(op.inputs).map(([key, field]) => (
          <FieldComponent
            key={key}
            id={key}
            field={field}
            disabled={locked}
            handle={{ type: TARGET_HANDLE, namespace: PAR_NAMESPACE }}
          />
        ))}
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </div>
  )
}

const ERROR_SHOW_DELAY_MS = 5000 // Wait 5s before showing error popover
const ERROR_AUTO_DISMISS_MS = 4000 // Auto-dismiss after 4s

// Error indicator with delayed popover.
// Shows error icon immediately, but popover only auto-shows if error persists for 5s.
// Hovering immediately shows the popover and disables all timeouts.
// Popover auto-dismisses after 4s when not hovered.
function ErrorIndicator({ error }: { error?: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [shownError, setShownError] = useState<string | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const showDelayRef = useRef<number | null>(null)
  const dismissRef = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (showDelayRef.current) {
      clearTimeout(showDelayRef.current)
      showDelayRef.current = null
    }
    if (dismissRef.current) {
      clearTimeout(dismissRef.current)
      dismissRef.current = null
    }
  }, [])

  const startDismissTimer = useCallback(() => {
    if (dismissRef.current) clearTimeout(dismissRef.current)
    dismissRef.current = window.setTimeout(() => setIsOpen(false), ERROR_AUTO_DISMISS_MS)
  }, [])

  // Handle error state changes - delayed auto-show
  useEffect(() => {
    if (error) {
      // New/different error - start delay timer (only if not hovered)
      if (error !== shownError && !isHovered) {
        clearTimers()
        setIsOpen(false)
        showDelayRef.current = window.setTimeout(() => {
          setShownError(error)
          setIsOpen(true)
        }, ERROR_SHOW_DELAY_MS)
      }
    } else {
      // Error resolved - cancel any pending show and close if open
      clearTimers()
      setIsOpen(false)
      setShownError(null)
    }

    return clearTimers
  }, [error, shownError, isHovered, clearTimers])

  // Start dismiss timer when popover opens (only if not hovered)
  useEffect(() => {
    if (isOpen && !isHovered) {
      startDismissTimer()
    }
  }, [isOpen, isHovered, startDismissTimer])

  const onMouseEnter = useCallback(() => {
    setIsHovered(true)
    clearTimers() // Cancel any pending show delay or dismiss
    if (error) {
      setShownError(error)
      setIsOpen(true) // Immediately show on hover
    }
  }, [error, clearTimers])

  const onMouseLeave = useCallback(() => {
    setIsHovered(false)
    if (isOpen) {
      startDismissTimer() // Start dismiss countdown when mouse leaves
    }
  }, [isOpen, startDismissTimer])

  return (
    <Tooltip.Provider>
      <Tooltip.Root open={isOpen}>
        <Tooltip.Trigger asChild>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Hover to show tooltip */}
          <div
            className={cx(s.executionIndicator, s.executionIndicatorError)}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            <i className="pi pi-exclamation-triangle" />
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            className={s.errorTooltipContent}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            {error}
            <Tooltip.Arrow className={s.tooltipArrow} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

const ExecutionIndicator = ({ status, error, executionTime }: ExecutionState) => {
  switch (status) {
    case 'executing':
      return (
        <div
          className={cx(s.executionIndicator, s.executionIndicatorExecuting)}
          title="Executing..."
        >
          <i className="pi pi-spin pi-spinner" />
        </div>
      )
    case 'error':
      return <ErrorIndicator error={error} />
    case 'success':
      return executionTime && executionTime > SLOW_EXECUTION_THRESHOLD_MS ? (
        <div
          className={cx(s.executionIndicator, s.executionIndicatorSlow)}
          title={`Executed in ${executionTime.toFixed(1)}ms`}
        >
          <i className="pi pi-clock" />
        </div>
      ) : null
    default:
      return null
  }
}

function NodeHeader({
  id,
  type,
  op,
  connectionErrors,
}: {
  id: string
  type: OpType
  op: Operator<IOperator>
  connectionErrors?: Map<string, string>
}) {
  const [locked, setLocked] = useState(op.locked.value)
  const executionState = useExecutionState(op)
  const hasConnectionErrors = connectionErrors && connectionErrors.size > 0

  const toggleLock = () => {
    op.locked.next(!op.locked.value)
  }

  useEffect(() => {
    op.locked.subscribe(setLocked)
  }, [op])

  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [hasConflict, setHasConflict] = useState(false)
  const { setNodes, setEdges } = useReactFlow()

  const checkForConflict = useCallback(
    (newBaseName: string): boolean => {
      if (!newBaseName.trim()) return false
      const newQualifiedId = generateQualifiedPath(newBaseName.trim(), op.containerId)
      return newQualifiedId !== id && hasOp(newQualifiedId)
    },
    [id, op.containerId]
  )

  // Extract base name from qualified path for display and editing
  const baseName = getBaseName(id)

  const updateId = useCallback(
    (newBaseName: string) => {
      const trimmedName = newBaseName.trim()

      // If empty, just reset to original
      if (!trimmedName) {
        setEditing(false)
        setHasConflict(false)
        setInputValue('')
        return
      }

      // If conflict, show error briefly then reset
      if (checkForConflict(trimmedName)) {
        setHasConflict(true)
        setInputValue(trimmedName)
        // Show error for a moment, then reset
        setTimeout(() => {
          setEditing(false)
          setHasConflict(false)
          setInputValue('')
        }, 1500)
        return
      }

      const isContainer = type === 'ContainerOp'

      // Call the store function to update the operator
      updateOperatorId(id, trimmedName, isContainer, setNodes, setEdges)

      setEditing(false)
      setHasConflict(false)
      setInputValue('')
    },
    [id, type, setNodes, setEdges, checkForConflict]
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setInputValue(value)
      setHasConflict(checkForConflict(value))
    },
    [checkForConflict]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        updateId(e.currentTarget.value)
      } else if (e.key === 'Escape') {
        setEditing(false)
        setHasConflict(false)
        setInputValue('')
      }
    },
    [updateId]
  )

  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      updateId(e.currentTarget.value)
    },
    [updateId]
  )

  const onEditingStart = useCallback(() => {
    setEditing(true)
    setInputValue(baseName)
    setHasConflict(false)
  }, [baseName])

  const onNodeHeaderDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      e.stopPropagation()
      onEditingStart()
    },
    [onEditingStart]
  )

  const errorMessage = hasConflict ? `Duplicate name: ${inputValue} already exists` : ''

  const editableId = editing ? (
    <Tooltip.Provider>
      <Tooltip.Root open={hasConflict}>
        <Tooltip.Trigger asChild>
          <input
            className={cx(s.headerId, s.headerIdInput, {
              [s.headerIdInputError]: hasConflict,
            })}
            value={inputValue}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="bottom" className={s.tooltipContent}>
            {errorMessage}
            <Tooltip.Arrow className={s.tooltipArrow} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  ) : (
    // biome-ignore lint/a11y/useSemanticElements: Inline editable text requires span with role
    <span className={s.headerId} role="button" tabIndex={0} onDoubleClick={onNodeHeaderDoubleClick}>
      {baseName}
    </span>
  )

  const downloadable = Boolean(op.asDownload)
  const createDownload = useCallback(() => {
    if (!op.asDownload) return
    // TODO: make this more generic, or have the op handle it
    const data = op.asDownload()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [op, baseName])

  const { displayName } = op.constructor as typeof Operator

  // Format connection error tooltip
  const connectionErrorTooltip = hasConnectionErrors
    ? Array.from(connectionErrors!.values()).join('\n')
    : ''

  return (
    <div className={cx(s.header, headerClass(type))}>
      <div className={s.headerTitle} title={`${id} (${displayName})`}>
        {editableId} ({displayName})
      </div>
      <ExecutionIndicator {...executionState} />
      {hasConnectionErrors && (
        <div
          className={cx(s.executionIndicator, s.executionIndicatorError)}
          title={connectionErrorTooltip}
        >
          <i className="pi pi-link" />
        </div>
      )}
      <div className={s.headerActions}>
        {downloadable && (
          <Button
            icon="pi pi-download"
            className={s.headerDownload}
            onClick={createDownload}
            title="Download Data"
            rounded
            text
          />
        )}
        <Button
          icon={`pi ${locked ? 'pi-lock' : 'pi-lock-open'}`}
          className={cx(s.headerLock, locked && s.headerLockLocked)}
          onClick={toggleLock}
          title="Toggle lock"
          rounded
          text
        />
      </div>
    </div>
  )
}

// TODO: Implement a custom geocoder component
// The MapboxGeocoder is super broken and doesn't work well with React - click events don't propagate
function GeocoderOpComponent({
  id,
  type,
}: ReactFlowNodeProps<NodeDataJSON<GeocoderOp>> & { type: 'GeocoderOp' }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const geocoderRef = useRef<MapboxGeocoder>()
  const [error, setError] = useState<string | null>(null)

  // Get API key directly from store (reactive)
  const apiKey = useKeysStore(state => state.getKey('mapbox'))

  useLayoutEffect(() => {
    // Clear previous error
    setError(null)

    if (!containerRef.current) {
      return
    }

    // Check if Mapbox API key is available
    if (!apiKey) {
      setError('API key required (Settings > API Keys)')
      return
    }

    const container = containerRef.current

    let g: MapboxGeocoder
    try {
      g = new MapboxGeocoder({
        accessToken: apiKey,
        collapsed: true,
      })

      g.on('query', (e: { query: string }) => {
        op.inputs.query.setValue(e.query)
      })

      g.on('result', (e: { result: { geometry: { coordinates: [number, number] } } }) => {
        const [lng, lat] = e.result.geometry.coordinates as [number, number]
        op.outputs.location.next({ lng, lat })
      })

      g.addTo(container)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid token'
      setError(`Geocoder error: ${message}`)
      return
    }

    g.query(op.inputs.query.value)

    // Hack for the MapboxGecoder to not automatically open the dropdown.
    // It focuses the input field on results which is not what we want. Honestly might be easier to
    // just implement our own geocoder with a react typeahead component
    let removed = false
    setTimeout(() => {
      if (removed) return
      g._typeahead.list.hide()
    }, 500)

    geocoderRef.current = g

    return () => {
      removed = true
      g.onRemove()
      geocoderRef.current = undefined
    }
  }, [op, apiKey])

  const locked = useLocked(op)
  useEffect(() => {
    const inputEl = geocoderRef.current?._inputEl
    if (inputEl) {
      inputEl.disabled = locked
    }
  }, [locked])

  return (
    <>
      <NodeHeader id={id} type={type} op={op} />
      <div className={s.content}>
        {Object.entries(op.inputs).map(([key, field]) => (
          <FieldComponent
            key={key}
            id={key}
            field={field}
            disabled={locked}
            handle={{ type: TARGET_HANDLE, namespace: PAR_NAMESPACE }}
            renderInput={false}
          />
        ))}
        {error && (
          <div className={s.fieldWrapper} style={{ padding: '8px', color: '#ff6b6b' }}>
            ⚠️ {error}
          </div>
        )}
        <div
          ref={containerRef}
          className={s.fieldWrapper}
          style={{ display: error ? 'none' : 'block' }}
        />
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </>
  )
}

function DirectionsOpComponent({
  id,
  type,
}: ReactFlowNodeProps<NodeDataJSON<DirectionsOp>> & { type: 'DirectionsOp' }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }

  // Reactive - automatically updates when keys change
  const hasMapboxKey = useKeysStore(state => state.hasKey('mapbox'))
  const hasGoogleMapsKey = useKeysStore(state => state.hasKey('googleMaps'))

  // Track previous values to detect additions
  const prevHasMapboxKey = useRef(hasMapboxKey)
  const prevHasGoogleMapsKey = useRef(hasGoogleMapsKey)

  useEffect(() => {
    const mapboxKeyAdded = !prevHasMapboxKey.current && hasMapboxKey
    const googleMapsKeyAdded = !prevHasGoogleMapsKey.current && hasGoogleMapsKey

    if (mapboxKeyAdded || googleMapsKeyAdded) {
      // Trigger re-execution by touching one of the input fields
      // This will invalidate the memoization cache and cause the operator to re-execute
      const currentOrigin = op.inputs.origin.value
      op.inputs.origin.setValue(currentOrigin)
    }

    // Update refs for next check
    prevHasMapboxKey.current = hasMapboxKey
    prevHasGoogleMapsKey.current = hasGoogleMapsKey
  }, [op, hasMapboxKey, hasGoogleMapsKey])

  return <NodeComponent id={id} type={type} />
}

function MouseOpComponent({
  id,
  type,
}: ReactFlowNodeProps<NodeDataJSON<MouseOp>> & { type: 'MouseOp' }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }

  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // Inject the container element into the operator
  useEffect(() => {
    const container = document.querySelector('.transform-scale')
    if (container) {
      op.setContainer(container)
    }
  }, [op])

  // Subscribe to output for display
  useEffect(() => {
    const sub = op.outputs.position.subscribe(setMousePosition)
    return () => {
      sub.unsubscribe()
    }
  }, [op])

  return (
    <>
      <NodeHeader id={id} type={type} op={op} />
      <div className={s.content}>
        <div className={s.fieldWrapper}>
          <div>Mouse Data</div>
          <div>
            x: {mousePosition.x.toFixed(2)}
            <br />
            y: {mousePosition.y.toFixed(2)}
          </div>
        </div>
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </>
  )
}

function TableEditorOpComponent({
  id,
  type,
  selected,
}: ReactFlowNodeProps<NodeDataJSON<TableEditorOp>> & { type: 'TableEditorOp' }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }

  const [dataArray, setDataArray] = useState(op.inputs.data.value as unknown[])
  useEffect(() => {
    const sub = op.inputs.data.subscribe(newVal => {
      setDataArray(newVal as unknown[])
    })
    return () => sub.unsubscribe()
  }, [op])

  const columns =
    dataArray?.length > 0
      ? Object.keys(dataArray[0]).map(field => ({
          field,
          header: field,
        }))
      : []

  const onCellEditComplete = e => {
    const { rowData, newValue, field, newRowData, rowIndex } = e

    // In the future we can have custom formatters, like for dates, currency, etc.
    // if (field === '....')

    // Set the value for the DataTable. The API wants us to mutate the row
    rowData[field] = newValue

    // Update the row data in the state
    op.inputs.data.setValue([
      ...dataArray.slice(0, rowIndex),
      newRowData,
      ...dataArray.slice(rowIndex + 1),
    ])
  }

  const addColumn = () => {
    const field = prompt('Enter the column name')
    const newData = dataArray.map(row => ({ ...row, [field]: '' }))
    op.inputs.data.setValue(newData)
  }

  const cellEditor = options => {
    return typeof options.value === 'number' ? (
      <InputNumber
        value={options.value}
        minFractionDigits={1}
        onValueChange={e => options.editorCallback(e.value)}
        onKeyDown={e => e.stopPropagation()}
      />
    ) : (
      <InputText
        type="text"
        value={options.value}
        onChange={e => options.editorCallback(e.target.value)}
        onKeyDown={e => e.stopPropagation()}
      />
    )
  }

  const locked = useLocked(op)

  return (
    <>
      <NodeHeader id={id} type={type} op={op} />
      <NodeResizer isVisible={selected} minWidth={400} minHeight={200} />
      <div className={s.content}>
        {Object.entries(op.inputs).map(([key, field]) => (
          <FieldComponent
            key={key}
            id={key}
            field={field}
            disabled={locked}
            handle={{ type: TARGET_HANDLE, namespace: PAR_NAMESPACE }}
          />
        ))}
        <div className="card p-fluid">
          <DataTable
            value={dataArray}
            editMode="cell"
            size="small"
            resizableColumns
            reorderableRows
            onRowReorder={e => {
              op.inputs.data.setValue(e.value.slice())
            }}
            showGridlines
            stripedRows
            scrollable
            scrollHeight="400px"
            tableStyle={{ minWidth: '50rem' }}
          >
            <Column rowReorder style={{ width: '3rem' }} />
            {columns.map((col, _i) => (
              <Column
                key={col.field}
                field={col.field}
                header={col.header}
                editor={options => cellEditor(options)}
                onCellEditComplete={onCellEditComplete}
                sortable
              />
            ))}
            <Column
              header={
                columns.length ? (
                  <Button
                    label="+"
                    icon="pi pi-plus"
                    className="p-button-success mr-2"
                    onClick={addColumn}
                  />
                ) : null
              }
            />
          </DataTable>
        </div>
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </>
  )
}

// Helper for ViewerOp to format Layer and Operator instances
const viewerFormatter = (value: unknown) => {
  if (value instanceof Layer) {
    // Guard against ReactJson crash since layer.props has no `hasOwnProperty` method
    const { lifecycle, count, isLoaded, props } = value
    return { lifecycle, count, isLoaded, props: { ...props } }
  }
  if (value instanceof Operator) {
    const { displayName } = value.constructor as typeof Operator
    return {
      id: value.id,
      type: displayName,
      inputs: Object.fromEntries(
        Object.entries(value.inputs).map(([key, field]) => [key, viewerFormatter(field.value)])
      ),
      outputs: Object.fromEntries(
        Object.entries(value.outputs).map(([key, field]) => [key, viewerFormatter(field.value)])
      ),
    }
  }
  if (typeof value === 'function') {
    return { value: `Function(${value.name || 'anonymous'})` }
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date ||
    value instanceof Temporal.PlainDateTime
  ) {
    return { value }
  }
  return value
}

function ViewerDOMContent({ content }: { content: Element }) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    contentRef.current?.replaceChildren(content)
  }, [content])

  return <div ref={contentRef} />
}

function ViewerOpComponent({
  id,
  type,
  selected,
}: ReactFlowNodeProps<NodeDataJSON<ViewerOp>> & { type: 'ViewerOp' }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }

  // TODO: use react-flow helpers
  const [viewerData, setViewerData] = useState(viewerFormatter(op.inputs.data.value))

  useEffect(() => {
    const sub = op.inputs.data.subscribe(newVal => {
      setViewerData(viewerFormatter(newVal))
    })
    return () => sub.unsubscribe()
  }, [op])

  let content = null
  if (viewerData === null) {
    content = <div>No data</div>
  } else if (viewerData instanceof Element) {
    content = <ViewerDOMContent content={viewerData} />
  } else if (viewerData instanceof Set) {
    content = <ReactJson src={Array.from(viewerData)} theme="twilight" />
  } else if (
    Array.isArray(viewerData) &&
    viewerData.length > 0 &&
    viewerData.length < 20 &&
    isPlainObject(viewerData[0]) &&
    Object.keys(viewerData[0]).length < 20
  ) {
    const keys = Object.keys(viewerData[0] || {})
    content = (
      <table>
        <thead>
          <tr>{viewerData.length > 0 && keys.map(key => <th key={key}>{key}</th>)}</tr>
        </thead>
        <tbody>
          {viewerData.map((row, _i) => (
            <tr key={`${JSON.stringify(row)}`}>
              {keys.map((key, _j) => (
                <td key={key}>
                  {typeof row[key] === 'string' ? row[key] : JSON.stringify(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  } else if (viewerData instanceof Operator) {
    content = <ReactJson src={viewerFormatter(viewerData)} theme="twilight" />
  } else if (viewerData instanceof Promise) {
    content = 'Loading...'
  } else {
    content = <ReactJson src={viewerData} theme="twilight" />
  }

  const locked = useLocked(op)

  return (
    <>
      <NodeHeader id={id} type={type} op={op} />
      <NodeResizer isVisible={selected} minWidth={400} minHeight={200} />
      <div className={s.content}>
        {Object.entries(op.inputs).map(([key, field]) => (
          <FieldComponent
            key={key}
            id={key}
            field={field}
            disabled={locked}
            handle={{ type: TARGET_HANDLE, namespace: PAR_NAMESPACE }}
          />
        ))}
        {content}
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </>
  )
}

function ContainerOpComponent({
  id,
  type,
  selected,
}: ReactFlowNodeProps<NodeDataJSON<ContainerOp>>) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }

  const setCurrentContainerId = useNestingStore(state => state.setCurrentContainerId)
  const reactFlow = useReactFlow()

  // Subscribe to operator store to get reactive children count
  const childrenCount = useOperatorStore(state => {
    return Array.from(state.operators.keys()).filter(opId => getParentPath(opId) === id).length
  })

  const locked = useLocked(op)

  return (
    // Add a specific class for styling the container
    <div
      role="tree"
      onDoubleClick={() => {
        // Clear selection when changing levels
        reactFlow.setNodes(nodes => nodes.map(node => ({ ...node, selected: false })))
        setCurrentContainerId(op.id)
        analytics.track('container_navigated', { method: 'double_click', direction: 'into' })
        reactFlow.fitView({ duration: 0 })
      }}
    >
      <NodeHeader id={id} type={type} op={op} />
      <NodeResizer isVisible={selected} minWidth={200} minHeight={50} />
      <div className={s.content}>
        {Object.entries(op.inputs).map(([key, field]) => (
          <FieldComponent
            key={key}
            id={key}
            field={field}
            disabled={locked}
            handle={{ type: TARGET_HANDLE, namespace: PAR_NAMESPACE }}
          />
        ))}
        <div>Children: {childrenCount}</div>
        {/* Children nodes are rendered by React Flow normally */}
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TimeOpComponent({
  id,
  type,
}: ReactFlowNodeProps<NodeDataJSON<TimeOp>> & { type: 'TimeOp' }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }
  const sheet = useContext(SheetContext) as ISheet

  const [now, setNow] = useState(0)
  const [sequenceTime, setSequenceTime] = useState(0)
  const [tick, setTick] = useState(0)

  // Inject Theatre sheet into operator on mount
  useEffect(() => {
    if (sheet) {
      op.setTheatreSheet(sheet)
    }
  }, [sheet, op])

  // Subscribe to outputs for display
  useEffect(() => {
    const subs = [
      op.outputs.now.subscribe(setNow),
      op.outputs.sequenceTime.subscribe(setSequenceTime),
      op.outputs.tick.subscribe(setTick),
    ]
    return () => {
      for (const sub of subs) {
        sub.unsubscribe()
      }
    }
  }, [op])

  return (
    <>
      <NodeHeader id={id} type={type} op={op} />
      <div className={s.content}>
        <div>
          Now: {now}
          <br />
          Sequence time: {sequenceTime.toFixed(2)}
          <br />
          Tick: {tick}
        </div>
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </>
  )
}
