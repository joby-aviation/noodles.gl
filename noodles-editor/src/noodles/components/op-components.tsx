import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'
import ReactJson from '@microlink/react-json-view'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  BaseEdge,
  type EdgeProps,
  getBezierPath,
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
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import {
  type ComponentType,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Temporal } from 'temporal-polyfill'

import { analytics } from '../../utils/analytics'
import { ArrayField, type Field, type IField, ListField } from '../fields'
import { useKeysStore } from '../keys-store'
import s from '../noodles.module.css'
import { inferSchema, type TableSchema } from '../table-schema'
import type { ExecutionState, IOperator, OpType } from '../operators'
import {
  type ContainerOp,
  type DirectionsOp,
  type GeocoderOp,
  type MouseOp,
  mathOpDescriptions,
  mathOps,
  Operator,
  type OutOp,
  opTypes,
  type RampInterpType,
  type RampOp,
  type RerouteOp,
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
  useUIStore,
} from '../store'
import type { NodeDataJSON } from '../transform-graph'
import { canConnect } from '../utils/can-connect'
import {
  evaluateEnableExpression,
  getEnableExpressionDependencies,
} from '../utils/enable-expression-evaluator'
import type { NodeType } from '../utils/node-creation-utils'
import { generateQualifiedPath, getBaseName, getParentPath } from '../utils/path-utils'
import {
  captureOperatorInputs,
  firePropertyMutation,
  usePropertyHistory,
} from '../utils/property-history'
import { categories as baseCategories, nodeTypeToDisplayName } from './categories'
import { FieldComponent, type inputComponents } from './field-components'
import previewStyles from './handle-preview.module.css'
import RampEditor, { type RampStop } from './ramp-editor'
import { TableEditor } from './table-editor'
import { useObservable } from '../hooks/use-observable'
import { MapStyleConfiguratorOpComponent } from './map-style-configurator-op'

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype

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
  return useObservable(op.executionState, { status: 'idle' })
}

// Hook to subscribe to operator connection errors
function useConnectionErrors(op: Operator<IOperator>): Map<string, string> {
  return useObservable(op.connectionErrors, new Map())
}

// Hook to check if a node should be dimmed during connection drag
export function useNodeDimmed(nodeId: string): boolean {
  return useUIStore(state => {
    const drag = state.connectionDragState
    if (!drag) return false
    if (drag.sourceNodeId === nodeId) return false
    return !drag.compatibleNodeIds.has(nodeId)
  })
}

// Hook to check if a handle should be dimmed during connection drag
export function useHandleDimmed(nodeId: string, handleId: string): boolean {
  const drag = useUIStore(state => state.connectionDragState)

  if (!drag) return false
  // Dim all handles on the source node except the one being dragged (no self-connections)
  if (drag.sourceNodeId === nodeId) return drag.sourceHandleId !== handleId
  // If the node is not compatible, handles are already dimmed via node dimming
  if (!drag.compatibleNodeIds.has(nodeId)) return false

  // Parse handle IDs to get namespace (par/out) and field name
  const sourceHandleParts = drag.sourceHandleId.split('.')
  const sourceNamespace = sourceHandleParts[0] as 'par' | 'out'
  const sourceFieldName = sourceHandleParts.slice(1).join('.')

  const targetHandleParts = handleId.split('.')
  const targetNamespace = targetHandleParts[0] as 'par' | 'out'
  const targetFieldName = targetHandleParts.slice(1).join('.')

  // Can only connect output to input (out -> par or par -> out)
  const canPotentiallyConnect =
    (sourceNamespace === 'out' && targetNamespace === 'par') ||
    (sourceNamespace === 'par' && targetNamespace === 'out')

  if (!canPotentiallyConnect) return true

  // Get operators and fields
  const sourceOp = getOp(drag.sourceNodeId)
  const targetOp = getOp(nodeId)
  if (!sourceOp || !targetOp) return true

  const sourceField =
    sourceNamespace === 'out' ? sourceOp.outputs[sourceFieldName] : sourceOp.inputs[sourceFieldName]

  const targetField =
    targetNamespace === 'out' ? targetOp.outputs[targetFieldName] : targetOp.inputs[targetFieldName]

  if (!sourceField || !targetField) return true

  // canConnect(from, to) where from is output field, to is input field
  if (sourceNamespace === 'out') {
    return !canConnect(sourceField, targetField)
  }
  return !canConnect(targetField, sourceField)
}

// Custom comparison function for node components
// During drag, React Flow passes new position/data objects but id/type/selected don't change
// By only comparing these three props, we prevent re-renders during drag operations
// Exported for testing
export function nodePropsAreEqual(
  prevProps: ReactFlowNodeProps,
  nextProps: ReactFlowNodeProps
): boolean {
  return (
    prevProps.id === nextProps.id &&
    prevProps.type === nextProps.type &&
    prevProps.selected === nextProps.selected
  )
}

// Memoized once - all node types in the registry share this single wrapper
const MemoNodeComponent = memo(NodeComponent, nodePropsAreEqual)

const defaultNodeComponents: Record<string, ComponentType<ReactFlowNodeProps>> = {}
for (const key of Object.keys(opTypes)) {
  defaultNodeComponents[key] = MemoNodeComponent
}

export const nodeComponents = {
  ...defaultNodeComponents,
  GeocoderOp: memo(GeocoderOpComponent, nodePropsAreEqual),
  MapStyleConfiguratorOp: memo(MapStyleConfiguratorOpComponent, nodePropsAreEqual),
  DirectionsOp: memo(DirectionsOpComponent, nodePropsAreEqual),
  MouseOp: memo(MouseOpComponent, nodePropsAreEqual),
  OutOp: memo(OutOpComponent, nodePropsAreEqual),
  RampOp: memo(RampOpComponent, nodePropsAreEqual),
  RerouteOp: memo(RerouteOpComponent, nodePropsAreEqual),
  TableEditorOp: memo(TableEditorOpComponent, nodePropsAreEqual),
  TimeOp: memo(TimeOpComponent, nodePropsAreEqual),
  ViewerOp: memo(ViewerOpComponent, nodePropsAreEqual),
  ContainerOp: memo(ContainerOpComponent, nodePropsAreEqual),
} as const as ReactFlowNodeTypes

export const edgeComponents = {
  default: DefaultEdgeComponent,
  ReferenceEdge: ReferenceEdgeComponent,
  MultiInputEdge: MultiInputEdgeComponent,
} as const as ReactFlowEdgeTypes

function DefaultEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const targetedEdge = useUIStore(s => s.targetedEdge)
  const nodeDragState = useUIStore(s => s.nodeDragState)
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  // Edge is targeted if either connection drag or node drag is targeting it
  const isConnectionTarget = targetedEdge?.id === id
  const isNodeDropTarget = nodeDragState?.targetedEdge?.id === id
  const isTarget = isConnectionTarget || isNodeDropTarget

  let edgeClassName: string | undefined
  if (isConnectionTarget) {
    edgeClassName = targetedEdge.compatible ? s.targetedEdge : s.targetedEdgeIncompatible
  } else if (isNodeDropTarget) {
    edgeClassName = nodeDragState.targetedEdge.canInsert
      ? s.targetedEdge
      : s.targetedEdgeIncompatible
  }

  return <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} className={edgeClassName} />
}

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

function MultiInputEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  // Calculate y-offset based on order index
  const SLOT_HEIGHT = 6
  const SLOT_GAP = 1.5
  const SLOT_SPACING = SLOT_HEIGHT + SLOT_GAP

  const orderIndex = (data as { orderIndex?: number })?.orderIndex ?? 0
  const yOffset = orderIndex * SLOT_SPACING

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY: targetY + yOffset,
    sourcePosition: sourcePosition || Position.Right,
    targetPosition: targetPosition || Position.Left,
  })

  return <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
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

const categoryCache = new Map<string, string>()

export function headerClass(type: NodeType) {
  // Check cache first for O(1) lookup
  if (categoryCache.has(type)) {
    return headerClasses[categoryCache.get(type) as keyof typeof categories]
  }

  // Check for type directly first (handles mathOps like AddOp, MultiplyOp, etc.)
  for (const [category, types] of Object.entries(categories)) {
    if ((types as readonly string[]).includes(type)) {
      categoryCache.set(type, category)
      return headerClasses[category]
    }
  }
  // Fall back to checking display name (handles regular operators)
  const displayName = nodeTypeToDisplayName(type)
  for (const [category, types] of Object.entries(categories)) {
    if ((types as readonly string[]).includes(displayName)) {
      categoryCache.set(type, category)
      return headerClasses[category]
    }
  }
  categoryCache.set(type, 'data')
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
  'file-url': s.handleString,
  function: s.handleCode,
  geojson: s.handleGeojson,
  'geopoint-2d': s.handleVector,
  'geopoint-3d': s.handleVector,
  layer: s.handleLayer,
  list: s.handleList,
  'map-style': s.handleString,
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

// Stable constant - avoids creating a new object on every render inside .map()
export const PAR_HANDLE_OPTIONS = { type: TARGET_HANDLE, namespace: PAR_NAMESPACE } as const

export function useLocked(op: Operator<IOperator>) {
  const [locked, setLocked] = useState(op.locked.value)
  useEffect(() => {
    const subscription = op.locked.subscribe(setLocked)
    return () => subscription.unsubscribe()
  }, [op])
  return locked
}

function useBreakpoint(op: Operator<IOperator>): [boolean, (checked: boolean) => void] {
  const [enabled, setEnabled] = useState(op.breakpointEnabled.value)

  useEffect(() => {
    const subscription = op.breakpointEnabled.subscribe(setEnabled)
    return () => subscription.unsubscribe()
  }, [op])

  const toggle = useCallback(
    (checked: boolean) => {
      op.breakpointEnabled.next(checked)
    },
    [op]
  )

  return [enabled, toggle]
}

// Hook to subscribe to field visibility changes and trigger re-render
export function useFieldVisibility(op: Operator<IOperator>) {
  const [, setVisibility] = useState(op.visibleFields.value)
  useEffect(() => {
    const subscription = op.visibleFields.subscribe(setVisibility)
    return () => subscription.unsubscribe()
  }, [op])
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
            // Derive union of all keys across rows to avoid silently dropping columns
            const allKeys = new Set<string>()
            for (const row of data) {
              if (isPlainObject(row)) {
                for (const key of Object.keys(row)) {
                  allKeys.add(key)
                }
              }
            }
            const keys = Array.from(allKeys)
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
                          {key in (row as Record<string, unknown>)
                            ? typeof row[key] === 'string'
                              ? row[key]
                              : JSON.stringify(row[key])
                            : ''}
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
export function OutputHandle({ id, field }: { id: string; field: Field<IField> }) {
  const nid = useNodeId()
  const qualifiedFieldId = `${OUT_NAMESPACE}.${id}`
  const isHandleDimmed = useHandleDimmed(nid ?? '', qualifiedFieldId)

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
        className={cx(handleClass(field), { [s.handleDimmed]: isHandleDimmed })}
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

// Hook to subscribe to field value changes for reactive enable expressions
// Only subscribes to fields referenced in enable expressions for performance
function useFieldValueChanges(op: Operator<IOperator>) {
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const customFieldDefs = op.customInputDefinitions
    if (!customFieldDefs || customFieldDefs.length === 0) {
      return
    }

    // Collect fields referenced in enable expressions
    const referencedFields = new Set<string>()
    for (const def of customFieldDefs) {
      if (def.enableExpression) {
        const deps = getEnableExpressionDependencies(def.enableExpression)
        for (const dep of deps) {
          if (dep.type === 'local-par') {
            referencedFields.add(dep.field)
          }
        }
      }
    }

    if (referencedFields.size === 0) {
      return
    }

    // Subscribe only to referenced fields
    const allInputs = (op.constructor as typeof Operator).supportsCustomFields
      ? op.getAllInputs()
      : op.inputs
    const subscriptions = Array.from(referencedFields)
      .map(fieldName => allInputs[fieldName])
      .filter(Boolean)
      .map(field => field.subscribe(() => forceUpdate(n => n + 1)))

    return () => subscriptions.forEach(sub => sub.unsubscribe())
  }, [op])
}

function NodeComponent({
  id,
  type,
  selected,
}: ReactFlowNodeProps<NodeDataJSON<Operator<IOperator>>> & { type: OpType }) {
  // Memoize operator lookup to avoid redundant store access in hooks
  const op = useMemo(() => {
    const operator = getOp(id as string)
    if (!operator) {
      throw new Error(`Operator with id ${id} not found`)
    }
    return operator
  }, [id])
  const locked = useLocked(op)
  const [breakpointEnabled, toggleBreakpoint] = useBreakpoint(op)
  const executionState = useExecutionState(op)
  const connectionErrors = useConnectionErrors(op)
  const hasConnectionErrors = connectionErrors.size > 0
  const isDimmed = useNodeDimmed(id)
  const isDropTarget = useUIStore(
    s => s.nodeDragState?.nodeId === id && s.nodeDragState?.targetedEdge !== null
  )
  useFieldVisibility(op)

  // Subscribe to field value changes for reactive enable expressions
  useFieldValueChanges(op)

  // Get all inputs (including custom fields for operators that support them)
  const allInputs = (op.constructor as typeof Operator).supportsCustomFields
    ? op.getAllInputs()
    : op.inputs

  // Get custom field definitions for enable expression checking
  const customFieldDefs = op.customInputDefinitions
  const builtInFieldNames = Object.keys(op.createInputs())

  // Track enable expression errors
  const [enableExpressionErrors, setEnableExpressionErrors] = useState<Map<string, string>>(
    new Map()
  )

  // Check if a field should be visible based on its enable expression
  const isFieldEnabled = useCallback(
    (fieldName: string): boolean => {
      // Built-in fields are always enabled
      if (builtInFieldNames.includes(fieldName)) {
        return true
      }
      // Find the custom field definition
      const def = customFieldDefs.find(d => d.name === fieldName)
      if (!def || !def.enableExpression) {
        return true // No expression means always enabled
      }
      const result = evaluateEnableExpression(def.enableExpression, op, getOp)

      // Track errors for display
      if (result.error) {
        setEnableExpressionErrors(prev => {
          const next = new Map(prev)
          next.set(fieldName, result.error!)
          return next
        })
      } else {
        setEnableExpressionErrors(prev => {
          if (prev.has(fieldName)) {
            const next = new Map(prev)
            next.delete(fieldName)
            return next
          }
          return prev
        })
      }

      return result.enabled
    },
    [builtInFieldNames, customFieldDefs, op]
  )

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={cx(s.wrapper, {
            [s.wrapperError]:
              executionState.status === 'error' ||
              hasConnectionErrors ||
              enableExpressionErrors.size > 0,
            [s.wrapperExecuting]: executionState.status === 'executing',
            [s.wrapperDimmed]: isDimmed,
            [s.nodeDropTarget]: isDropTarget,
          })}
        >
          <NodeHeader
            id={id}
            type={type}
            op={op}
            connectionErrors={connectionErrors}
            enableExpressionErrors={enableExpressionErrors}
          />
          {(resizeableNodes as readonly string[]).includes(type) && (
            <NodeResizer isVisible={selected} minWidth={200} minHeight={100} />
          )}
          <div className={s.content}>
            {Object.entries(allInputs)
              .filter(([key]) => op.isFieldVisible(key) && isFieldEnabled(key))
              .map(([key, field]) => (
                <FieldComponent
                  key={key}
                  id={key}
                  field={field}
                  disabled={locked}
                  handle={PAR_HANDLE_OPTIONS}
                />
              ))}
            <div className={s.outputHandleContainer}>
              {Object.entries(op.outputs).map(([key, field]) => (
                <OutputHandle key={key} id={key} field={field} />
              ))}
            </div>
          </div>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className={s.contextMenu} sideOffset={5}>
          <ContextMenu.CheckboxItem
            className={s.contextMenuItem}
            checked={breakpointEnabled}
            onCheckedChange={toggleBreakpoint}
          >
            <ContextMenu.ItemIndicator className={s.contextMenuIndicator}>
              <i className="pi pi-check" style={{ fontSize: '12px' }} />
            </ContextMenu.ItemIndicator>
            Debug Breakpoint
          </ContextMenu.CheckboxItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

// Renders a popover anchored directly to the trigger element via position:absolute
// so it stays inside the ReactFlow canvas coordinate space (avoids fixed-positioning
// issues caused by CSS transforms on the ReactFlow viewport).
function ErrorPopover({
  error,
  trigger,
  open,
  onDismiss,
}: {
  error: string
  trigger: ReactNode
  open: boolean
  onDismiss: () => void
}) {
  const handleTriggerClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      navigator.clipboard
        .writeText(error)
        .then(() => {
          console.log('[Noodles] Error copied to clipboard')
        })
        .catch(err => {
          console.error('[Noodles] Failed to copy error:', err)
        })
    },
    [error]
  )

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      onDismiss()
    },
    [onDismiss]
  )

  return (
    <div className={s.errorPopoverAnchor}>
      <div onClick={handleTriggerClick} style={{ cursor: 'pointer' }} title="Click to copy error">
        {trigger}
      </div>
      {open && (
        <div className={s.errorPopover}>
          <span className={s.errorPopoverMessage}>{error}</span>
          <button className={s.errorPopoverClose} onClick={handleCloseClick} type="button">
            <i className="pi pi-times" />
          </button>
        </div>
      )}
    </div>
  )
}

function makeDefaultStops(): RampStop[] {
  return [
    { id: crypto.randomUUID(), pos: 0, val: 0, interp: 'smooth' },
    { id: crypto.randomUUID(), pos: 1, val: 1, interp: 'smooth' },
  ]
}

function RampOpComponent({
  id,
  type,
}: ReactFlowNodeProps<NodeDataJSON<RampOp>> & { type: 'RampOp' }) {
  const op = getOp(id as string) as RampOp | undefined
  if (!op) throw new Error(`Operator with id ${id} not found`)
  const locked = useLocked(op)
  const executionState = useExecutionState(op)
  const connectionErrors = useConnectionErrors(op)
  const hasConnectionErrors = connectionErrors.size > 0
  const isDimmed = useNodeDimmed(id)

  const [stops, setStops] = useState<RampStop[]>(() => {
    const v = op.inputs.stops.value as RampStop[] | null
    return v && v.length > 0 ? v : makeDefaultStops()
  })
  const [activeStopId, setActiveStopId] = useState<string | null>(() => {
    const v = op.inputs.stops.value as RampStop[] | null
    const s = v && v.length > 0 ? v : makeDefaultStops()
    return s[0]?.id ?? null
  })

  // Subscribe to stops to handle undo/redo and project load
  useEffect(() => {
    const stopsSub = op.inputs.stops.subscribe(newVal => {
      const v = newVal as RampStop[] | null
      const nextStops = v && v.length > 0 ? v : makeDefaultStops()
      setStops(nextStops)
      // Keep active stop if still present, otherwise fall back to first
      setActiveStopId(prev =>
        nextStops.find(s => s.id === prev) ? prev : (nextStops[0]?.id ?? null)
      )
    })
    return () => stopsSub.unsubscribe()
  }, [op.inputs.stops])

  // Seed default stops on first render if empty
  useEffect(() => {
    const v = op.inputs.stops.value as RampStop[] | null
    if (!v || v.length === 0) op.inputs.stops.setValue(makeDefaultStops())
  }, [op.inputs.stops])

  // History helpers
  const { captureStart, commitChange } = usePropertyHistory()

  // Continuous drag update — no history commit per frame; history bracketed by drag start/end
  const handleChange = useCallback(
    (newStops: RampStop[]) => {
      if (locked) return
      op.inputs.stops.setValue(newStops)
    },
    [op.inputs.stops, locked]
  )

  // Structural change (add/delete from ramp-editor) — atomic history commit
  const handleStructuralChange = useCallback(
    (newStops: RampStop[], description: string) => {
      if (locked) return
      const before = captureOperatorInputs()
      op.inputs.stops.setValue(newStops)
      firePropertyMutation(description, before)
    },
    [op.inputs.stops, locked]
  )

  const handleDragStart = useCallback(() => captureStart(), [captureStart])
  const handleDragEnd = useCallback(() => commitChange('Move ramp stop'), [commitChange])

  const activeStop = stops.find(s => s.id === activeStopId) ?? null

  const handleActivate = useCallback((stopId: string) => setActiveStopId(stopId), [])

  // Debounced history commit for continuous text input
  const inputBeforeRef = useRef<string | null>(null)
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const commitInputDebounced = useCallback((description: string) => {
    if (inputTimerRef.current) clearTimeout(inputTimerRef.current)
    inputTimerRef.current = setTimeout(() => {
      if (inputBeforeRef.current !== null) {
        firePropertyMutation(description, inputBeforeRef.current)
        inputBeforeRef.current = null
      }
    }, 600)
  }, [])

  const handlePosChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!activeStopId || locked) return
      const sorted = [...stops].sort((a, b) => a.pos - b.pos)
      const isFirst = sorted[0]?.id === activeStopId
      const isLast = sorted[sorted.length - 1]?.id === activeStopId
      if (isFirst || isLast) return
      const pos = Math.max(0, Math.min(1, Number.parseFloat(e.target.value)))
      if (Number.isNaN(pos)) return
      if (inputBeforeRef.current === null) inputBeforeRef.current = captureOperatorInputs()
      op.inputs.stops.setValue(
        stops.map(s => (s.id === activeStopId ? { ...s, pos } : s)).sort((a, b) => a.pos - b.pos)
      )
      commitInputDebounced('Update ramp stop position')
    },
    [activeStopId, locked, stops, op.inputs.stops, commitInputDebounced]
  )

  const handleValChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!activeStopId || locked) return
      const val = Math.max(0, Math.min(1, Number.parseFloat(e.target.value)))
      if (Number.isNaN(val)) return
      if (inputBeforeRef.current === null) inputBeforeRef.current = captureOperatorInputs()
      op.inputs.stops.setValue(stops.map(s => (s.id === activeStopId ? { ...s, val } : s)))
      commitInputDebounced('Update ramp stop value')
    },
    [activeStopId, locked, stops, op.inputs.stops, commitInputDebounced]
  )

  const handleInterpChange = useCallback(
    (interp: RampInterpType) => {
      if (!activeStopId || locked) return
      const before = captureOperatorInputs()
      op.inputs.stops.setValue(stops.map(s => (s.id === activeStopId ? { ...s, interp } : s)))
      firePropertyMutation('Change ramp interpolation', before)
    },
    [activeStopId, locked, stops, op.inputs.stops]
  )

  const handleDeleteActiveStop = useCallback(() => {
    if (!activeStopId || locked || stops.length <= 2) return
    const before = captureOperatorInputs()
    op.inputs.stops.setValue(stops.filter(s => s.id !== activeStopId))
    firePropertyMutation('Delete ramp stop', before)
  }, [activeStopId, locked, stops, op.inputs.stops])

  const canDelete = !!activeStop && stops.length > 2

  return (
    <div
      className={cx(s.wrapper, {
        [s.wrapperError]: executionState.status === 'error' || hasConnectionErrors,
        [s.wrapperExecuting]: executionState.status === 'executing',
        [s.wrapperDimmed]: isDimmed,
      })}
    >
      <NodeHeader id={id} type={type} op={op} connectionErrors={connectionErrors} />
      <div className={s.content}>
        <FieldComponent
          id="position"
          field={op.inputs.position}
          disabled={locked}
          handle={PAR_HANDLE_OPTIONS}
        />
        <div style={{ position: 'relative', padding: '4px 0' }}>
          <RampEditor
            stops={stops}
            onChange={handleChange}
            onStructuralChange={handleStructuralChange}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            disabled={locked}
            activeStopId={activeStopId}
            onActivate={handleActivate}
          />
          {canDelete && !locked && (
            <button
              type="button"
              title="Delete stop"
              onClick={handleDeleteActiveStop}
              style={{
                position: 'absolute',
                top: 8,
                right: 4,
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                background: 'rgba(30,38,52,0.85)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 3,
                color: '#e2dede',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              −
            </button>
          )}
        </div>
        <div className={s.fieldWrapper}>
          <label className={s.fieldLabel} style={{ whiteSpace: 'nowrap' }}>
            {activeStop ? `stop ${stops.indexOf(activeStop) + 1}` : 'stop'}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 2, minWidth: 0 }}>
            <label
              className={s.fieldLabelVector}
              title="position"
              style={{ cursor: 'default', flexShrink: 0 }}
            >
              p
            </label>
            <input
              type="number"
              className={s.fieldInput}
              value={activeStop?.pos.toFixed(3) ?? ''}
              min={0}
              max={1}
              step={0.001}
              disabled={locked || !activeStop}
              onChange={handlePosChange}
              style={{ flex: 1, minWidth: 0 }}
            />
            <label
              className={s.fieldLabelVector}
              title="value"
              style={{ cursor: 'default', flexShrink: 0 }}
            >
              v
            </label>
            <input
              type="number"
              className={s.fieldInput}
              value={activeStop?.val.toFixed(3) ?? ''}
              min={0}
              max={1}
              step={0.001}
              disabled={locked || !activeStop}
              onChange={handleValChange}
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        </div>
        <div className={s.fieldWrapper}>
          <label className={s.fieldLabel}>interp</label>
          <div
            style={{
              display: 'flex',
              borderRadius: 12,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.15)',
              opacity: !activeStop ? 0.4 : 1,
            }}
          >
            {(['linear', 'smooth', 'hold'] as RampInterpType[]).map((type, i) => {
              const active = (activeStop?.interp ?? 'smooth') === type
              return (
                <button
                  key={type}
                  type="button"
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: '0.75em',
                    fontWeight: active ? 600 : 400,
                    cursor: locked || !activeStop ? 'default' : 'pointer',
                    background: active ? '#3b82f6' : 'transparent',
                    color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                    border: 'none',
                    borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.15)' : 'none',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  disabled={locked || !activeStop}
                  onClick={() => handleInterpChange(type)}
                >
                  {type}
                </button>
              )
            })}
          </div>
        </div>
        <div className={s.outputHandleContainer}>
          <OutputHandle id="value" field={op.outputs.value} />
        </div>
      </div>
    </div>
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
      return (
        <div className={cx(s.executionIndicator, s.executionIndicatorError)}>
          <i className="pi pi-exclamation-triangle" />
        </div>
      )
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

export function NodeHeader({
  id,
  type,
  op,
  connectionErrors,
  enableExpressionErrors,
}: {
  id: string
  type: OpType
  op: Operator<IOperator>
  connectionErrors?: Map<string, string>
  enableExpressionErrors?: Map<string, string>
}) {
  const [locked, setLocked] = useState(op.locked.value)
  const executionState = useExecutionState(op)
  const hasConnectionErrors = connectionErrors && connectionErrors.size > 0
  const hasEnableExpressionErrors = enableExpressionErrors && enableExpressionErrors.size > 0

  // Popover visibility state for execution errors
  const [execAutoShow, setExecAutoShow] = useState(false)
  const [execDismissed, setExecDismissed] = useState(false)
  // Popover visibility state for connection errors
  const [connAutoShow, setConnAutoShow] = useState(false)
  const [connDismissed, setConnDismissed] = useState(false)
  // Popover visibility state for enable expression errors
  const [exprAutoShow, setExprAutoShow] = useState(false)
  const [exprDismissed, setExprDismissed] = useState(false)
  const [headerHovered, setHeaderHovered] = useState(false)

  const execErrorKey = executionState.status === 'error' ? (executionState.error ?? '') : null
  const connErrorKey = hasConnectionErrors
    ? Array.from(connectionErrors!.values()).join('\n')
    : null
  const exprErrorKey = hasEnableExpressionErrors
    ? Array.from(enableExpressionErrors!.entries())
        .map(([field, error]) => `${field}: ${error}`)
        .join('\n')
    : null

  useEffect(() => {
    if (execErrorKey !== null) {
      setExecAutoShow(true)
      setExecDismissed(false)
      const t = setTimeout(() => setExecAutoShow(false), 10_000)
      return () => clearTimeout(t)
    }
    setExecAutoShow(false)
    setExecDismissed(false)
  }, [execErrorKey])

  useEffect(() => {
    if (connErrorKey !== null) {
      setConnAutoShow(true)
      setConnDismissed(false)
      const t = setTimeout(() => setConnAutoShow(false), 10_000)
      return () => clearTimeout(t)
    }
    setConnAutoShow(false)
    setConnDismissed(false)
  }, [connErrorKey])

  useEffect(() => {
    if (exprErrorKey !== null) {
      setExprAutoShow(true)
      setExprDismissed(false)
      const t = setTimeout(() => setExprAutoShow(false), 10_000)
      return () => clearTimeout(t)
    }
    setExprAutoShow(false)
    setExprDismissed(false)
  }, [exprErrorKey])

  const execPopoverOpen =
    execErrorKey !== null && ((execAutoShow && !execDismissed) || headerHovered)
  const connPopoverOpen =
    connErrorKey !== null && ((connAutoShow && !connDismissed) || headerHovered)
  const exprPopoverOpen =
    exprErrorKey !== null && ((exprAutoShow && !exprDismissed) || headerHovered)

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
    const data = op.asDownload()

    if (data instanceof Element) {
      const svgEl = data instanceof SVGElement ? data : data.querySelector('svg')
      if (svgEl) {
        const svgStr = new XMLSerializer().serializeToString(svgEl)
        const blob = new Blob([svgStr], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${baseName}.svg`
        a.click()
        URL.revokeObjectURL(url)
        return
      }
    }

    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [op, baseName])

  const { displayName } = op.constructor as typeof Operator

  // Memoize event handlers to avoid recreating on every render
  const handleMouseEnter = useCallback(() => setHeaderHovered(true), [])
  const handleMouseLeave = useCallback(() => setHeaderHovered(false), [])

  return (
    <div
      className={cx(s.header, s.dragHandle, headerClass(type))}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={s.headerTitle} title={`${id} (${displayName})`}>
        {editableId} ({displayName})
      </div>
      {execErrorKey !== null ? (
        <ErrorPopover
          error={`Error: ${execErrorKey}`}
          open={execPopoverOpen}
          onDismiss={() => setExecDismissed(true)}
          trigger={<ExecutionIndicator {...executionState} />}
        />
      ) : (
        <ExecutionIndicator {...executionState} />
      )}
      {hasConnectionErrors && connErrorKey && (
        <ErrorPopover
          error={connErrorKey}
          open={connPopoverOpen}
          onDismiss={() => setConnDismissed(true)}
          trigger={
            <div className={cx(s.executionIndicator, s.executionIndicatorError)}>
              <i className="pi pi-link" />
            </div>
          }
        />
      )}
      {hasEnableExpressionErrors && exprErrorKey && (
        <ErrorPopover
          error={`Enable expression error:\n${exprErrorKey}`}
          open={exprPopoverOpen}
          onDismiss={() => setExprDismissed(true)}
          trigger={
            <div className={cx(s.executionIndicator, s.executionIndicatorError)}>
              <i className="pi pi-eye-slash" />
            </div>
          }
        />
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
  const isDimmed = useNodeDimmed(id)

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
  useFieldVisibility(op)
  useEffect(() => {
    const inputEl = geocoderRef.current?._inputEl
    if (inputEl) {
      inputEl.disabled = locked
    }
  }, [locked])

  return (
    <div className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}>
      <NodeHeader id={id} type={type} op={op} />
      <div className={s.content}>
        {Object.entries(op.inputs)
          .filter(([key]) => op.isFieldVisible(key))
          .map(([key, field]) => (
            <FieldComponent
              key={key}
              id={key}
              field={field}
              disabled={locked}
              handle={PAR_HANDLE_OPTIONS}
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
    </div>
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
  const isDimmed = useNodeDimmed(id)

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
    <div className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}>
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
    </div>
  )
}

export function TableEditorOpComponent({
  id,
  type,
  selected,
}: ReactFlowNodeProps<NodeDataJSON<TableEditorOp>> & { type: 'TableEditorOp' }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }

  const isDimmed = useNodeDimmed(id)
  const locked = useLocked(op)
  useFieldVisibility(op)

  const [data, setData] = useState(op.inputs.data.value as unknown[])
  const [schema, setSchema] = useState(() => {
    // Get schema from output or infer from data
    const outputSchema = op.outputs.schema.value
    if (outputSchema && typeof outputSchema === 'object' && 'columns' in outputSchema) {
      return outputSchema as TableSchema
    }
    return inferSchema(data)
  })

  // Subscribe to data and schema changes
  useEffect(() => {
    const dataSub = op.inputs.data.subscribe(newData => {
      setData(newData as unknown[])
    })
    const schemaSub = op.outputs.schema.subscribe(newSchema => {
      if (newSchema && typeof newSchema === 'object' && 'columns' in newSchema) {
        setSchema(newSchema as TableSchema)
      }
    })
    return () => {
      dataSub.unsubscribe()
      schemaSub.unsubscribe()
    }
  }, [op])

  const handleDataChange = (newData: unknown[]) => {
    op.inputs.data.setValue(newData)
    op.outputs.data.setValue(newData)
  }

  const handleSchemaChange = (newSchema: TableSchema) => {
    op.inputs.schema.setValue(newSchema)
    op.outputs.schema.setValue(newSchema)
    setSchema(newSchema)
  }

  return (
    <div className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}>
      <NodeHeader id={id} type={type} op={op} />
      <NodeResizer isVisible={selected} minWidth={500} minHeight={300} />
      <div className={s.content}>
        {Object.entries(op.inputs)
          .filter(([key]) => op.isFieldVisible(key) && key !== 'data')
          .map(([key, field]) => (
            <FieldComponent
              key={key}
              id={key}
              field={field}
              disabled={locked}
              handle={PAR_HANDLE_OPTIONS}
            />
          ))}
        <TableEditor
          op={op}
          data={data}
          schema={schema}
          onDataChange={handleDataChange}
          onSchemaChange={handleSchemaChange}
        />
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </div>
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

  const isDimmed = useNodeDimmed(id)

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
    // Derive union of all keys across rows to avoid silently dropping columns
    const allKeys = new Set<string>()
    for (const row of viewerData) {
      if (isPlainObject(row)) {
        for (const key of Object.keys(row)) {
          allKeys.add(key)
        }
      }
    }
    const keys = Array.from(allKeys)
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
                  {key in row
                    ? typeof row[key] === 'string'
                      ? row[key]
                      : JSON.stringify(row[key])
                    : ''}
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
  useFieldVisibility(op)

  return (
    <div className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}>
      <NodeHeader id={id} type={type} op={op} />
      <NodeResizer isVisible={selected} minWidth={400} minHeight={200} />
      <div className={s.content}>
        {Object.entries(op.inputs)
          .filter(([key]) => op.isFieldVisible(key))
          .map(([key, field]) => (
            <FieldComponent
              key={key}
              id={key}
              field={field}
              disabled={locked}
              handle={PAR_HANDLE_OPTIONS}
            />
          ))}
        {content}
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </div>
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

  const isDimmed = useNodeDimmed(id)
  const setCurrentContainerId = useNestingStore(state => state.setCurrentContainerId)
  const reactFlow = useReactFlow()

  // Subscribe to operator store to get reactive children count
  const childrenCount = useOperatorStore(state => {
    return Array.from(state.operators.keys()).filter(opId => getParentPath(opId) === id).length
  })

  const locked = useLocked(op)
  useFieldVisibility(op)

  return (
    <div
      role="tree"
      className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}
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
        {Object.entries(op.inputs)
          .filter(([key]) => op.isFieldVisible(key))
          .map(([key, field]) => (
            <FieldComponent
              key={key}
              id={key}
              field={field}
              disabled={locked}
              handle={PAR_HANDLE_OPTIONS}
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
  const isDimmed = useNodeDimmed(id)

  const [now, setNow] = useState(0)
  const [sequenceTime, setSequenceTime] = useState(0)
  const [tick, setTick] = useState(0)

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
    <div className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}>
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
    </div>
  )
}

function RerouteOpComponent({
  id,
}: ReactFlowNodeProps<NodeDataJSON<RerouteOp>> & { type: 'RerouteOp' }) {
  const isDimmed = useNodeDimmed(id)
  const isInputDimmed = useHandleDimmed(id, 'par.value')
  const isOutputDimmed = useHandleDimmed(id, 'out.value')

  return (
    <div className={cx(s.rerouteNode, s.dragHandle, { [s.wrapperDimmed]: isDimmed })}>
      <Handle
        id="par.value"
        type="target"
        position={Position.Left}
        className={cx(s.rerouteHandle, { [s.handleDimmed]: isInputDimmed })}
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      />
      <Handle
        id="out.value"
        type="source"
        position={Position.Right}
        className={cx(s.rerouteHandle, { [s.handleDimmed]: isOutputDimmed })}
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>
  )
}

// OutOp component that only shows the vis input.
// Render settings are hidden from the node UI and shown in the properties panel instead.
function OutOpComponent({ id, type }: ReactFlowNodeProps<NodeDataJSON<OutOp>> & { type: 'OutOp' }) {
  const op = getOp(id as string)
  if (!op) {
    throw new Error(`Operator with id ${id} not found`)
  }
  const locked = useLocked(op)
  const executionState = useExecutionState(op)
  const connectionErrors = useConnectionErrors(op)
  const hasConnectionErrors = connectionErrors.size > 0
  const isDimmed = useNodeDimmed(id)

  // Only show the 'vis' input, hide render settings
  const visibleInputs = { vis: op.inputs.vis }

  return (
    <div
      className={cx(s.wrapper, {
        [s.wrapperError]: executionState.status === 'error' || hasConnectionErrors,
        [s.wrapperExecuting]: executionState.status === 'executing',
        [s.wrapperDimmed]: isDimmed,
      })}
    >
      <NodeHeader id={id} type={type} op={op} connectionErrors={connectionErrors} />
      <div className={s.content}>
        {Object.entries(visibleInputs).map(([key, field]) => (
          <FieldComponent
            key={key}
            id={key}
            field={field}
            disabled={locked}
            handle={PAR_HANDLE_OPTIONS}
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
