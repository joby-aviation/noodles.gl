import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'
import ReactJson from '@microlink/react-json-view'
import * as Tooltip from '@radix-ui/react-tooltip'
import { type ISheet, onChange, types, val } from '@theatre/core'
import studio from '@theatre/studio'
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
  useNodes,
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
import { isHexColor } from 'validator'

import { colorToRgba, hexToRgba, type Rgba, rgbaToHex } from '../../utils/color'
import { SheetContext } from '../../utils/sheet-context'
import {
  ArrayField,
  BooleanField,
  ColorField,
  CompoundPropsField,
  DateField,
  type Field,
  ListField,
  NumberField,
  Point2DField,
  Point3DField,
  StringField,
  StringLiteralField,
  Vec2Field,
  Vec3Field,
} from '../fields'
import s from '../noodles.module.css'
import type { ExecutionState, IOperator, OperatorInstance, OpType } from '../operators'
import {
  type ContainerOp,
  type GeocoderOp,
  type MouseOp,
  mathOps,
  mathOpDescriptions,
  Operator,
  opTypes,
  type TableEditorOp,
  type TimeOp,
  type ViewerOp,
} from '../operators'
import { opMap, setHoveredOutputHandle, useOp, useSlice } from '../store'
import type { NodeDataJSON } from '../transform-graph'
import { edgeId } from '../utils/id-utils'
import { generateQualifiedPath, getBaseName, getParentPath } from '../utils/path-utils'
import type { NodeType } from './add-node-menu'
import { FieldComponent, type inputComponents } from './field-components'
import previewStyles from './handle-preview.module.css'

const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

const SLOW_EXECUTION_THRESHOLD_MS = 100

// Hook to subscribe to operator execution state
function useExecutionState(op: OperatorInstance): ExecutionState {
  const [executionState, setExecutionState] = useState<ExecutionState>({ status: 'idle' })

  useEffect(() => {
    const subscription = op.executionState.subscribe(setExecutionState)
    return () => subscription.unsubscribe()
  }, [op])

  return executionState
}

const defaultNodeComponents = {} as Record<OpType, typeof NodeComponent>
for (const key of Object.keys(opTypes)) {
  defaultNodeComponents[key] = NodeComponent
}

export const nodeComponents = {
  ...defaultNodeComponents,
  GeocoderOp: GeocoderOpComponent,
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

export const categories = {
  code: ['AccessorOp', 'CodeOp', 'DuckDbOp', 'JSONOp', 'ExpressionOp'],
  grouping: [
    'ContainerOp',
    'ForLoop',
    'ForLoopOp',
    'ForLoopBeginOp',
    'ForLoopEndOp',
    'GraphInputOp',
    'GraphOutputOp',
  ],
  color: [
    'CategoricalColorRampOp',
    'ColorOp',
    'ColorRampOp',
    'CombineRGBAOp',
    'HSLOp',
    'SplitRGBAOp',
  ],
  data: [
    'ArcOp',
    'BoundingBoxOp',
    'BoundsOp',
    'DateOp',
    'DeckRendererOp',
    'DirectionsOp',
    'FileOp',
    'FilterOp',
    'GeocoderOp',
    'MergeOp',
    'NetworkOp',
    'ObjectMergeOp',
    'OutOp',
    'RandomizeAttributeOp',
    'ScatterOp',
    'SelectOp',
    'SliceOp',
    'SortOp',
    'SwitchOp',
    'TableEditorOp',
    'ViewerOp',
    'ViewStateOp',
  ],
  geojson: [
    'AreaOp',
    'BearingOp',
    'BufferOp',
    'CentroidOp',
    'DegreesToRadiansOp',
    'DestinationOp',
    'DistanceOp',
    'GeoJsonOp',
    'GeoJsonTransformOp',
    'LengthOp',
    'PointOp',
    'RadiansToDegreesOp',
    'RectangleOp',
    'SimplifyOp',
    'SpatialJoinOp',
  ],
  layer: [
    'A5LayerOp',
    'ArcLayerOp',
    'BitmapLayerOp',
    'ColumnLayerOp',
    'ContourLayerOp',
    'GeoJsonLayerOp',
    'GeohashLayerOp',
    'GreatCircleLayerOp',
    'GridCellLayerOp',
    'GridLayerOp',
    'H3ClusterLayerOp',
    'H3HexagonLayerOp',
    'HeatmapLayerOp',
    'HexagonLayerOp',
    'IconLayerOp',
    'LineLayerOp',
    'MVTLayerOp',
    'PathLayerOp',
    'PointCloudLayerOp',
    'PolygonLayerOp',
    'QuadkeyLayerOp',
    'RasterTileLayerOp',
    'S2LayerOp',
    'ScatterplotLayerOp',
    'ScenegraphLayerOp',
    'ScreenGridLayerOp',
    'SimpleMeshLayerOp',
    'SolidPolygonLayerOp',
    'TerrainLayerOp',
    'TextLayerOp',
    'Tile3DLayerOp',
    'TileLayerOp',
    'TripsLayerOp',
  ],
  extension: [
    'BrightnessContrastExtensionOp',
    'BrushingExtensionOp',
    'ClipExtensionOp',
    'CollisionFilterExtensionOp',
    'DataFilterExtensionOp',
    'FillStyleExtensionOp',
    'HueSaturationExtensionOp',
    'Mask3DExtensionOp',
    'MaskExtensionOp',
    'PathStyleExtensionOp',
    'TerrainExtensionOp',
    'VibranceExtensionOp',
  ],
  number: [
    'NumberOp',
    'MapRangeOp',
    'ExtentOp',
    'MathOp',
    'BezierCurveOp',
    ...Object.keys(mathOps),
    'TimeOp',
  ],
  string: ['StringOp'],
  utility: [
    'BooleanOp',
    'ConsoleOp',
    'LayerPropsOp',
    'MouseOp',
    'ProjectOp',
    'UnprojectOp',
    'MapStyleOp',
  ],
  vector: ['CombineXYOp', 'CombineXYZOp', 'SplitXYOp', 'SplitXYZOp'],
  view: [
    'FirstPersonViewOp',
    'GlobeViewOp',
    'MaplibreBasemapOp',
    'MapViewOp',
    'MapViewStateOp',
    'OrbitViewOp',
    'SplitMapViewStateOp',
  ],
  widget: ['FpsWidgetOp'],
} as const as Record<string, NodeType[]>

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
  for (const [category, types] of Object.entries(categories)) {
    if (types.includes(type)) {
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
  for (const [category, types] of Object.entries(categories)) {
    if (types.includes(type)) {
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
  date: s.handleNumber,
  effect: s.handleEffect,
  expression: s.handleCode,
  extension: s.handleExtension,
  feature: s.handleData,
  'feature-collection': s.handleData,
  file: s.handleString,
  function: s.handleCode,
  geometry: s.handleData,
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
  if (field instanceof ListField || field instanceof ArrayField) {
    return cx(handleClasses[field.constructor.type], handleClass(field.field))
  }
  return handleClasses[field.constructor.type]
}

export const SOURCE_HANDLE = 'source'
export const TARGET_HANDLE = 'target'
export const PAR_NAMESPACE = 'par'
export const OUT_NAMESPACE = 'out'

function colorToTheatreColor(color: [number, number, number, number] | string): Rgba {
  const val =
    typeof color === 'string' && isHexColor(color)
      ? hexToRgba(color)
      : Array.isArray(color)
        ? colorToRgba(color)
        : color
  return val as Rgba
}

function fieldToTheatreProp(input: Field<IField>, fields: [string, Field<IField>][]) {
  try {
    if (input instanceof NumberField) {
      return types.number(input.value, {
        range: [input.min, input.max],
        nudgeMultiplier: input.step,
      })
    }
    if (input instanceof BooleanField) {
      return types.boolean(input.value)
    }
    if (input instanceof StringField) {
      return types.string(input.value)
    }
    if (input instanceof StringLiteralField) {
      return types.stringLiteral(
        input.value,
        Object.fromEntries(input.choices.map(({ label, value }) => [label, value]))
      )
    }
    if (input instanceof ColorField) {
      return types.rgba(colorToTheatreColor(input.value))
    }
    if (input instanceof DateField) {
      return types.number(+input.value)
    }
    if (input instanceof CompoundPropsField) {
      return types.compound(fieldsToTheatreProps({}, input.fields, fields))
    }
    if (input instanceof Vec2Field) {
      return types.compound({
        x: types.number('x' in input.value ? input.value.x : input.value[0]),
        y: types.number('y' in input.value ? input.value.y : input.value[1]),
      })
    }
    if (input instanceof Vec3Field) {
      return types.compound({
        x: types.number('x' in input.value ? input.value.x : input.value[0]),
        y: types.number('y' in input.value ? input.value.y : input.value[1]),
        z: types.number('z' in input.value ? input.value.z : input.value[2]),
      })
    }
    if (input instanceof Point2DField) {
      return types.compound({
        lng: types.number('lng' in input.value ? input.value.lng : input.value[0]),
        lat: types.number('lat' in input.value ? input.value.lat : input.value[1]),
      })
    }
    if (input instanceof Point3DField) {
      return types.compound({
        lng: types.number('lng' in input.value ? input.value.lng : input.value[0]),
        lat: types.number('lat' in input.value ? input.value.lat : input.value[1]),
        alt: types.number('alt' in input.value ? input.value.alt : input.value[2]),
      })
    }
  } catch (e) {
    // When thrown, theatre will create a Sheet Object for this field, and this should subsequently be addressed.
    const link = input.subscriptions.keys().next().value
    console.error(`Caught TheatreJS prop error (${link})`, e)
  }
}
function fieldsToTheatreProps(
  propConfig: Record<string, types.PropTypeConfig>,
  inputs: Record<string, Field<IField>>,
  fields: Field<IField>[]
) {
  const theatreFields = Object.entries(inputs)
    .map(([k, f]) => (f instanceof ListField ? [k, f.field] : [k, f]))
    .filter(
      ([_, f]) =>
        // Accessor functions should not be passed to Theatre
        typeof f.value !== 'function'
    )
    .filter(
      ([_, f]) =>
        f instanceof NumberField ||
        f instanceof ColorField ||
        f instanceof DateField ||
        f instanceof BooleanField ||
        f instanceof StringField ||
        f instanceof StringLiteralField ||
        f instanceof CompoundPropsField ||
        f instanceof Vec2Field ||
        f instanceof Vec3Field ||
        f instanceof Point2DField ||
        f instanceof Point3DField
    )

  for (const [key, field] of theatreFields) {
    const theatreProp = fieldToTheatreProp(field, fields)
    if (theatreProp) {
      propConfig[key] = theatreProp
      fields.push([key, field])
    }
  }
  return propConfig
}

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
                    <tr key={i}>
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
            <HandlePreviewContent data={previewData} name={id} type={field.constructor.type} />
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
  const op = useOp(id)

  const sheet = useContext(SheetContext) as ISheet
  const sheetObjects = useSlice(state => state.sheetObjects)

  const locked = useLocked(op)

  useEffect(() => {
    const untapFns = [] as (() => void)[]
    const fields = [] as [string, Field<IField>][]
    const propConfig = fieldsToTheatreProps({}, op.inputs, fields)

    if (!Object.keys(propConfig).length) return

    const basename = getBaseName(id)
    const obj = sheet.object(basename, propConfig)
    sheetObjects.set(id, obj)

    for (const [_key, input] of fields) {
      const pathToProps = input.pathToProps.slice(2) // Skip the object id and par/out keys
      let updating = false
      let pointer = obj.props
      for (const p of pathToProps) {
        pointer = pointer[p]
      }
      const unsub = input.subscribe(value_ => {
        if (op.locked.value) return
        // Note: Transactions can only run after the theatre project is "ready"
        if (updating) return
        updating = true
        studio.transaction(({ set }) => {
          try {
            // Try to detect an infinite loop for setting values to Theatre
            const value = input instanceof ColorField ? colorToTheatreColor(value_) : value_

            // TODO: This has a bug with StringLiterals where the value is not updated, but removing
            // the value check causes another bug.

            // Prevent infinite loop
            if (input instanceof CompoundPropsField) return

            if (val(pointer) !== value) {
              set(pointer, value)
            }
          } catch (e) {
            console.warn(e)
            debugger
          }
          updating = false
        })
      })
      untapFns.push(unsub.unsubscribe.bind(unsub))

      // Parse Theatre values to Op input field types
      const untapFn = onChange(pointer, value_ => {
        if (op.locked.value) return
        try {
          if (updating) return
          updating = true

          const value =
            input instanceof ColorField
              ? rgbaToHex(value_)
              : input instanceof DateField
                ? new Date(value_)
                : value_

          if (input.value !== value && value !== undefined) {
            input.setValue(value)
          }
        } catch (_e) {
          debugger
        }
        updating = false
      })
      untapFns.push(untapFn)
    }

    return () => {
      for (const untapFn of untapFns) {
        untapFn()
      }
      sheet?.detachObject(basename)
      sheetObjects.delete(id)
    }
  }, [sheet, op.locked.value, id, op.inputs, sheetObjects])

  const executionState = useExecutionState(op)

  return (
    <div
      className={cx(s.wrapper, {
        [s.wrapperError]: executionState.status === 'error',
        [s.wrapperExecuting]: executionState.status === 'executing',
      })}
    >
      <NodeHeader id={id} type={type} op={op} />
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
        <div
          className={cx(s.executionIndicator, s.executionIndicatorError)}
          title={`Error: ${error}`}
        >
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

const headerHeight = 49
function NodeHeader({ id, type, op }: { id: string; type: OpType; op: OperatorInstance }) {
  const [locked, setLocked] = useState(op.locked.value)
  const executionState = useExecutionState(op)

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
      return newQualifiedId !== id && opMap.has(newQualifiedId)
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

      const newQualifiedId = generateQualifiedPath(trimmedName, op.containerId)
      const isContainer = type === 'ContainerOp'

      // Update the operator itself
      opMap.set(newQualifiedId, op)
      op.id = newQualifiedId

      // If this is a container, update all children nodes and their operators
      if (isContainer) {
        const childOps = Array.from(opMap.values()).filter(childOp =>
          childOp.id.startsWith(`${id}/`)
        )

        for (const childOp of childOps) {
          const oldChildId = childOp.id
          // Replace only the exact container path at the start
          const newChildId = newQualifiedId + oldChildId.slice(id.length)
          opMap.set(newChildId, childOp)
          childOp.id = newChildId
          // TODO: this is a hack. We should hook into some sort of "after update" event
          queueMicrotask(() => opMap.delete(oldChildId))
        }
      }

      // Give React time to update the component tree before deleting the old id
      // TODO: this is a hack. We should hook into some sort of "after update" event
      queueMicrotask(() => {
        opMap.delete(id)
      })

      // Update React Flow nodes and edges
      setNodes(nodes =>
        nodes.map(n => {
          // Update the node itself if it matches
          if (n.id === id) {
            return { ...n, id: newQualifiedId }
          }
          // Update children if this is a container
          if (isContainer && n.id.startsWith(`${id}/`)) {
            return { ...n, id: newQualifiedId + n.id.slice(id.length) }
          }
          return n
        })
      )

      setEdges(edges =>
        edges.map(edge => {
          const sourceNeedsUpdate =
            edge.source === id || (isContainer && edge.source.startsWith(`${id}/`))
          const targetNeedsUpdate =
            edge.target === id || (isContainer && edge.target.startsWith(`${id}/`))

          if (!sourceNeedsUpdate && !targetNeedsUpdate) return edge

          const updatedEdge = {
            ...edge,
            source: sourceNeedsUpdate
              ? edge.source === id
                ? newQualifiedId
                : newQualifiedId + edge.source.slice(id.length)
              : edge.source,
            target: targetNeedsUpdate
              ? edge.target === id
                ? newQualifiedId
                : newQualifiedId + edge.target.slice(id.length)
              : edge.target,
          }

          return { ...updatedEdge, id: edgeId(updatedEdge) }
        })
      )
      setEditing(false)
      setHasConflict(false)
      setInputValue('')
    },
    [id, op, type, setNodes, setEdges, checkForConflict]
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

  return (
    <div className={cx(s.header, headerClass(type))}>
      <div className={s.headerTitle} title={`${id} (${op.constructor.displayName})`}>
        {editableId} ({op.constructor.displayName})
      </div>
      <ExecutionIndicator {...executionState} />
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
  const op = useOp(id)

  const containerRef = useRef<HTMLDivElement>(null)
  const geocoderRef = useRef<MapboxGeocoder>()

  useLayoutEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current

    const g = new MapboxGeocoder({
      accessToken: MAPBOX_ACCESS_TOKEN,
      collapsed: true,
    })

    g.on('query', e => {
      op.inputs.query.setValue(e.query)
    })

    g.on('result', e => {
      const [lng, lat] = e.result.geometry.coordinates as [number, number]
      op.outputs.location.next({ lng, lat })
    })

    g.addTo(container)

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
    }
  }, [op])

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
          />
        ))}
        <div ref={containerRef} className={s.fieldWrapper} />
        <div className={s.outputHandleContainer}>
          {Object.entries(op.outputs).map(([key, field]) => (
            <OutputHandle key={key} id={key} field={field} />
          ))}
        </div>
      </div>
    </>
  )
}

function MouseOpComponent({
  id,
  type,
}: ReactFlowNodeProps<NodeDataJSON<MouseOp>> & { type: 'MouseOp' }) {
  const op = useOp(id)

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
  const op = useOp(id)

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
    return {
      id: value.id,
      type: value.constructor.displayName,
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
    value instanceof Date
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
  const op = useOp(id)

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
  const op = useOp(id)

  const { setCurrentContainerId } = useSlice(state => state.nesting)
  const nodes = useNodes()
  const children = nodes.filter(node => getParentPath(node.id) === id)

  const locked = useLocked(op)

  return (
    // Add a specific class for styling the container
    <div
      role="tree"
      onDoubleClick={() => {
        setCurrentContainerId(op.id)
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
        <div>Children: {children.length}</div>
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
  const op = useOp(id)
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
