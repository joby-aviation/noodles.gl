import { extname } from 'node:path'
import type {
  ContourLayerProps,
  GridLayerProps,
  HeatmapLayerProps,
  HexagonLayerProps,
  ScreenGridLayerProps,
} from '@deck.gl/aggregation-layers'
import { LayerExtension, type LayerProps, WebMercatorViewport } from '@deck.gl/core'
import {
  BrushingExtension,
  ClipExtension,
  CollisionFilterExtension,
  DataFilterExtension,
  FillStyleExtension,
  MaskExtension,
  PathStyleExtension,
  _TerrainExtension as TerrainExtension,
} from '@deck.gl/extensions'
import type {
  A5LayerProps,
  GeohashLayerProps,
  GreatCircleLayerProps,
  H3ClusterLayerProps,
  H3HexagonLayerProps,
  MVTLayerProps,
  QuadkeyLayerProps,
  S2LayerProps,
  TerrainLayerProps,
  Tile3DLayerProps,
  TileLayerProps,
  TripsLayerProps,
} from '@deck.gl/geo-layers'
import type {
  ArcLayerProps,
  BitmapBoundingBox,
  BitmapLayerProps,
  ColumnLayerProps,
  GeoJsonLayerProps,
  GridCellLayerProps,
  IconLayerProps,
  LineLayerProps,
  PathLayerProps,
  PointCloudLayerProps,
  PolygonLayerProps,
  ScatterplotLayerProps,
  SolidPolygonLayerProps,
  TextLayerProps,
} from '@deck.gl/layers'
import type { ScenegraphLayerProps, SimpleMeshLayerProps } from '@deck.gl/mesh-layers'
import type { Tileset3D } from '@loaders.gl/tiles'
import { brightnessContrast, hueSaturation, vibrance } from '@luma.gl/effects'
import { fitBounds } from '@math.gl/web-mercator'
import * as Plot from '@observablehq/plot'
import * as turf from '@turf/turf'
import * as d3 from 'd3'
import {
  csv,
  csvParse,
  type DSVRowArray,
  color as d3Color,
  hsl,
  interpolate,
  scaleLinear,
  scaleOrdinal,
  tsv,
  tsvParse,
} from 'd3'
import * as deck from 'deck.gl'
import type {
  Feature as GeoJsonFeature,
  FeatureCollection as GeoJsonFeatureCollection,
} from 'geojson'
import { BehaviorSubject, combineLatest, Subject, type Subscription } from 'rxjs'
import { distinctUntilChanged, filter, mergeMap, skip } from 'rxjs/operators'
import { Temporal } from 'temporal-polyfill'
import z from 'zod/v4'

import './utils/bigint-fix' // BigInt JSON polyfill for DuckDB
import { getRenderSurfaceSize, subscribeToRenderSurfaceSize } from '../render/render-surface-size'
import { getTransformScaleFactor } from '../render/transform-scale'
import { duckDbInstance } from '../runtime/duckdb'
import { subscribeToPosition } from '../timeline/timeline-store'
import * as utils from '../utils'
import { analytics } from '../utils/analytics'
import { getArc } from '../utils/arc-geometry'
import { colorToHex, hexToColor } from '../utils/color'
import { debugDirty, debugDirtyTrace, debugExecute, debugParams, debugPull } from '../utils/debug'
import { getDirections } from '../utils/directions'
import { geocodeWithMapbox } from '../utils/geocoding'
import {
  applyStyleOverrides,
  type MaplibreStyle,
  type StyleConfiguratorData,
} from '../utils/map-style-utils'
import { CARTO_DARK } from '../utils/map-styles'
import { mulberry32 } from '../utils/random'
import { sqlIdentifier, sqlLiteral } from '../utils/sql'
import {
  categoricalSchemesFixed,
  categoricalSchemesStepped,
  continuousInterpolators,
} from './color-schemes'
import { FilterColorExtension } from './extensions/filter-color-extension'
import { Mask3DExtension, toMaskTargetPosition } from './extensions/mask-3d-extension'
import {
  ArrayField,
  applyNodeUIMetadata,
  applySerializedFieldValue,
  BboxField,
  BezierCurveField,
  BooleanField,
  CategoricalColorRampField,
  CodeField,
  ColorField,
  ColorRampField,
  CompoundPropsField,
  captureNodeUIMetadata,
  DataField,
  DateField,
  EffectField,
  ExpressionField,
  ExtensionField,
  type Field,
  type FieldReference,
  FileUrlField,
  FunctionField,
  fieldTypeToClass,
  GeoJsonField,
  IN_NS,
  type InOut,
  LayerField,
  ListField,
  MapLibreLayerField,
  MapStyleField,
  mustacheRe,
  NumberField,
  OUT_NS,
  Point2DField,
  Point3DField,
  StringField,
  StringLiteralField,
  selfParMustacheRe,
  UnknownField,
  Vec2Field,
  Vec3Field,
  ViewField,
  type VisualizationDeckProps,
  VisualizationField,
  WidgetField,
} from './fields'
import { DEFAULT_LATITUDE, DEFAULT_LONGITUDE, safeMode } from './globals'
import { getKeysStore } from './keys-store'
import { type OpView, resolveOp } from './op-resolver'
import { prepareTableDataForOutput, type TableSchema, validateTableData } from './table-schema'
import type { ExtensionConstructorArgs, LayerPropsValue } from './types'
import { composeAccessor, isAccessor } from './utils/accessor-helpers'
import {
  detectGeoKey,
  type Geography,
  type GeoKey,
  getBoundaries,
  joinDataToFeatures,
} from './utils/choropleth-boundaries'
import { deepEqual } from './utils/deep-equal'
import type { ExtractProps } from './utils/extract-props'
import { projectScheme } from './utils/filesystem'
import type { OpId } from './utils/id-utils'
import { isDirectChild } from './utils/path-utils'
import { pick } from './utils/pick'
import { getTimelineContext } from './utils/timeline-context'
import { subscribeOpToTimeline, unsubscribeOpFromTimeline } from './utils/timeline-dependencies'
// Side-effect import: registers the field expression evaluator so { $expr } payloads
// applied in the Operator constructor evaluate immediately
import { interpolateRamp, type RampInterpType } from '../utils/curves'
import { osmToGeoJson } from '../utils/osm-to-geojson'
import { validateViewState } from './utils/viewstate-helpers'

// https://stackoverflow.com/questions/66044717/typescript-infer-type-of-abstract-methods-implementation
export interface IOperator {
  createInputs(): Record<string, Field<z.ZodType>>
  createOutputs(): Record<string, Field<z.ZodType>>
}

// Custom field definition for dynamic parameters
export interface CustomFieldDefinition {
  id: string // UUID
  name: string // Field name (valid JS identifier)
  type: string // Field type ('number', 'string', 'boolean', etc.)
  order: number // Display order
  options?: Record<string, unknown> // Type-specific options (min, max, step, etc.)
  defaultValue?: unknown // Default value
  enableExpression?: string // JavaScript expression for conditional visibility (e.g., "par.mode === 'advanced'")
}

// Deserializers can throw on bad input, such as a date that isn't ISO
function parseSavedOutput(field: Field, value: unknown) {
  try {
    return field.schema.safeParse((field.constructor as typeof Field).deserialize(value))
  } catch {
    return { success: false as const }
  }
}

// An Operator is a collection of Fields, and a transform function responsible
// for taking in a set of input fields and mapping them to the output.
export abstract class Operator<OP extends IOperator> {
  static displayName = 'Operator'
  static description = ''

  // Opt-in flag for operators that support custom fields
  static supportsCustomFields = false

  inputs: ReturnType<OP['createInputs']>
  outputs: ReturnType<OP['createOutputs']>

  par = proxyFields(this, 'inputs')

  out = proxyFields(this, 'outputs')

  // If the operator allows its data to be downloaded, override this method
  asDownload?: () => Blob | string | ArrayBuffer
  public containerId?: string

  // Custom field definitions for dynamic parameters
  customInputDefinitions: CustomFieldDefinition[] = []

  // Emits when custom field definitions change (for reactive updates like GraphInputOp)
  customFieldsChanged = new Subject<CustomFieldDefinition[]>()

  abstract createInputs(): ReturnType<OP['createInputs']>
  abstract createOutputs(): ReturnType<OP['createOutputs']>
  abstract execute(
    props: ExtractProps<(typeof this)['inputs']>
  ): ExtractProps<(typeof this)['outputs']> | Promise<ExtractProps<(typeof this)['outputs']>> | null

  subs: Subscription[] = []

  locked = new BehaviorSubject<boolean>(false)

  // Debug breakpoint - when enabled, execution pauses at this operator
  breakpointEnabled = new BehaviorSubject<boolean>(false)

  // Execution state for visual debugging
  executionState = new BehaviorSubject<ExecutionState>({ status: 'idle' })

  // Connection errors - tracks errors from incompatible connections
  // Map of edgeId -> error message
  connectionErrors = new BehaviorSubject<Map<string, string>>(new Map())

  // === Field visibility ===
  // Per-instance visible fields (null = use defaults from field.showByDefault)
  visibleFields = new BehaviorSubject<Set<string> | null>(null)

  constructor(
    public id: OpId,
    data?: Partial<ExtractProps<ReturnType<OP['createInputs']>>>,
    locked = false,
    public containerId?: string
  ) {
    this.inputs = this.createInputs()
    this.outputs = this.createOutputs()

    const assignPathToProps = (field: Field, key: string, parentPath: string[] = []) => {
      const currentPath = [...parentPath, key]
      field.pathToProps = currentPath
      field.op = this

      // ListField, DataField, ArrayField - Fields that wrap fields
      if (field.field !== undefined) {
        field.field.pathToProps = currentPath
      }
      if (field instanceof CompoundPropsField) {
        for (const [k, f] of Object.entries(field.fields)) {
          assignPathToProps(f, k, currentPath)
        }
      }
    }

    // Use the fully qualified path (id) for pathToProps assignment
    for (const [key, field] of Object.entries(this.inputs)) {
      assignPathToProps(field, key, [id, IN_NS])
    }
    for (const [key, field] of Object.entries(this.outputs)) {
      assignPathToProps(field, key, [id, OUT_NS])
    }

    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (key in this.inputs) {
          // Routes { $expr } payloads to setExpression, plain values to setValue
          applySerializedFieldValue(this.inputs[key], value)
        }
      }
    }

    if (locked) {
      this.locked.next(true)
    }
  }

  get data() {
    const data = {} as { [key: string]: z.ZodType }
    for (const [key, field] of Object.entries(this.inputs)) {
      data[key] = field.value
    }
    return data as ExtractProps<(typeof this)['inputs']>
  }

  get outputData() {
    const outputData = {} as { [key: string]: z.ZodType }
    for (const [key, field] of Object.entries(this.outputs)) {
      outputData[key] = field.value
    }
    return outputData as ExtractProps<typeof this.outputs>
  }

  // Left open for sub-classes to override
  onError(_err: Error) {}

  // === Connection error methods ===

  // Add a connection error for a specific edge
  addConnectionError(edgeId: string, error: string) {
    const errors = new Map(this.connectionErrors.value)
    errors.set(edgeId, error)
    this.connectionErrors.next(errors)
  }

  // Remove a connection error for a specific edge
  removeConnectionError(edgeId: string) {
    const errors = new Map(this.connectionErrors.value)
    if (errors.delete(edgeId)) {
      this.connectionErrors.next(errors)
    }
  }

  // Check if the operator has any connection errors
  hasConnectionErrors(): boolean {
    return this.connectionErrors.value.size > 0
  }

  // Get all connection error messages
  getConnectionErrorMessages(): string[] {
    return Array.from(this.connectionErrors.value.values())
  }

  // === Field visibility methods ===

  // Check if a field is visible (for UI rendering)
  isFieldVisible(name: string): boolean {
    const visible = this.visibleFields.value
    if (visible === null) {
      // Use defaults: showByDefault defaults to true
      return this.inputs[name]?.showByDefault ?? true
    }
    return visible.has(name)
  }

  // Show a field (add to visible set)
  // Used for auto-showing fields when connections are established or values are set programmatically
  showField(name: string): void {
    // Skip if inputs not initialized yet or field doesn't exist
    if (!this.inputs || !(name in this.inputs)) return
    // Skip if already visible
    if (this.isFieldVisible(name)) return

    // Get current visible fields, or compute defaults from showByDefault
    const current =
      this.visibleFields.value ??
      new Set(
        Object.entries(this.inputs)
          .filter(([_, field]) => field.showByDefault)
          .map(([fieldName]) => fieldName)
      )

    const newSet = new Set(current)
    newSet.add(name)
    this.visibleFields.next(newSet)
  }

  // Hide a field (remove from visible set)
  hideField(name: string): void {
    // Skip if inputs not initialized yet or field doesn't exist
    if (!this.inputs || !(name in this.inputs)) return
    // Skip if already hidden
    if (!this.isFieldVisible(name)) return

    // Get current visible fields, or compute defaults from showByDefault
    const current =
      this.visibleFields.value ??
      new Set(
        Object.entries(this.inputs)
          .filter(([_, field]) => field.showByDefault)
          .map(([fieldName]) => fieldName)
      )

    const newSet = new Set(current)
    newSet.delete(name)
    this.visibleFields.next(newSet)
  }

  // Set field visibility (show or hide based on boolean)
  setFieldVisibility(name: string, visible: boolean): void {
    if (visible) {
      this.showField(name)
    } else {
      this.hideField(name)
    }
  }

  // === Pull-based execution methods ===

  unsubscribeListeners() {
    for (const sub of this.subs) {
      sub.unsubscribe()
    }
  }

  // === Custom Field Management ===

  // Get all inputs (built-in + custom)
  getAllInputs(): Record<string, Field> {
    const builtIn = this.inputs
    const custom = this.getCustomInputFields()
    return { ...builtIn, ...custom }
  }

  // Get custom input fields as Field instances
  getCustomInputFields(): Record<string, Field> {
    debugParams(
      'getCustomInputFields %s: %d definitions',
      this.id,
      this.customInputDefinitions.length
    )
    const fields: Record<string, Field> = {}
    for (const def of this.customInputDefinitions) {
      const field = this.createFieldFromDefinition(def)
      debugParams('created field "%s" type=%s value=%O', def.name, def.type, field.value)
      fields[def.name] = field
    }
    return fields
  }

  // Create a Field instance from a custom field definition
  protected createFieldFromDefinition(def: CustomFieldDefinition): Field {
    debugParams(
      'createFieldFromDefinition type=%s name=%s defaultValue=%O',
      def.type,
      def.name,
      def.defaultValue
    )
    const FieldClass = fieldTypeToClass[def.type]
    if (!FieldClass) {
      debugParams('unknown field type: %s', def.type)
      throw new Error(`Unknown field type: ${def.type}`)
    }
    const field = new FieldClass(def.defaultValue, def.options)
    // If value is still undefined, the defaultValue passed was invalid for this field type
    if (field.value === undefined) {
      debugParams(
        'field value undefined after construction: type=%s name=%s defaultValue=%O',
        def.type,
        def.name,
        def.defaultValue
      )
      throw new Error(
        `Invalid default value for field "${def.name}" (type: ${def.type}): ${JSON.stringify(def.defaultValue)}`
      )
    }
    return field
  }

  // Validate custom field name
  validateCustomFieldName(name: string, excludeId?: string): string | null {
    if (!name.trim()) {
      return 'Name is required'
    }
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
      return 'Invalid identifier (use only letters, numbers, _, $)'
    }
    const builtInFieldNames = Object.keys(this.createInputs())
    if (builtInFieldNames.includes(name)) {
      return 'Name conflicts with built-in field'
    }
    if (this.customInputDefinitions.some(d => d.id !== excludeId && d.name === name)) {
      return 'Name already exists'
    }
    return null
  }

  // Add custom field
  addCustomInput(def: CustomFieldDefinition): void {
    const error = this.validateCustomFieldName(def.name, def.id)
    if (error) {
      throw new Error(error)
    }
    this.customInputDefinitions.push(def)
    this.rebuildInputs()
  }

  // Remove custom field
  removeCustomInput(id: string): void {
    this.customInputDefinitions = this.customInputDefinitions.filter(d => d.id !== id)
    this.rebuildInputs()
  }

  // Update custom field definition
  updateCustomInput(id: string, updates: Partial<CustomFieldDefinition>): void {
    const index = this.customInputDefinitions.findIndex(d => d.id === id)
    if (index >= 0) {
      const updated = { ...this.customInputDefinitions[index], ...updates }
      if (updates.name) {
        const error = this.validateCustomFieldName(updates.name, id)
        if (error) {
          throw new Error(error)
        }
      }
      this.customInputDefinitions[index] = updated
      this.rebuildInputs()
    }
  }

  // Reorder custom fields
  reorderCustomInputs(fromIndex: number, toIndex: number): void {
    const defs = [...this.customInputDefinitions]
    const [moved] = defs.splice(fromIndex, 1)
    defs.splice(toIndex, 0, moved)
    // Update order property
    defs.forEach((def, index) => {
      def.order = index
    })
    this.customInputDefinitions = defs
    // No need to rebuild inputs, just update order
  }

  // Rebuild inputs when custom fields change
  rebuildInputs(): void {
    debugParams(
      'rebuildInputs start %s, %d custom definitions',
      this.id,
      this.customInputDefinitions.length
    )
    // Preserve existing field values and connections
    const oldValues = new Map<string, unknown>()
    const oldUIMetadata = captureNodeUIMetadata(this.inputs)
    const oldConnections = new Map<
      string,
      Array<{ id: string; field: Field; connectionType: 'reference' | 'value' }>
    >()

    for (const [name, field] of Object.entries(this.inputs)) {
      oldValues.set(name, field.value)
      const connections = []
      for (const [id, _subscription] of field.subscriptions) {
        // We can't easily get the field reference, so we'll need to rely on transform-graph to reconnect
        connections.push({ id, field: field, connectionType: 'value' })
      }
      if (connections.length > 0) {
        oldConnections.set(name, connections)
      }
    }

    // Recreate inputs (built-in + custom)
    const builtInInputs = this.createInputs()
    const customInputs = this.getCustomInputFields() // may throw on invalid field definitions
    debugParams(
      'rebuildInputs built %d custom inputs for %s',
      Object.keys(customInputs).length,
      this.id
    )

    this.inputs = { ...builtInInputs, ...customInputs } as ReturnType<OP['createInputs']>

    // Restore values
    for (const [name, field] of Object.entries(this.inputs)) {
      if (oldValues.has(name)) {
        try {
          field.setValue(oldValues.get(name))
        } catch (err) {
          console.warn(`Failed to restore value for field ${name}:`, err)
        }
      }
    }

    // Re-assign pathToProps for all fields
    const assignPathToProps = (field: Field, key: string, parentPath: string[] = []) => {
      const currentPath = [...parentPath, key]
      field.pathToProps = currentPath
      field.op = this

      if (field.field !== undefined) {
        field.field.pathToProps = currentPath
      }
      if (field instanceof CompoundPropsField) {
        for (const [k, f] of Object.entries(field.fields)) {
          assignPathToProps(f, k, currentPath)
        }
      }
    }

    for (const [key, field] of Object.entries(this.inputs)) {
      assignPathToProps(field, key, [this.id, IN_NS])
    }

    applyNodeUIMetadata(this.inputs, oldUIMetadata)

    // Note: Connections will be restored by transform-graph.ts when edges are re-applied

    // Notify listeners that custom fields have changed
    this.customFieldsChanged.next(this.customInputDefinitions)
    debugParams('rebuildInputs complete %s', this.id)
  }

  dispose() {
    this.unsubscribeListeners()
    this.executionState.complete()
    this.customFieldsChanged.complete()

    // Cleanup timeline subscriptions
    unsubscribeOpFromTimeline(this.id)
  }
}

export const mathOps = {
  DivideOp: 'divide',
  MultiplyOp: 'multiply',
  SubtractOp: 'subtract',
  AddOp: 'add',
  ModuloOp: 'modulo',
  SineOp: 'sine',
  CosineOp: 'cosine',
  MinOp: 'min',
  MaxOp: 'max',
  RoundOp: 'round',
  FloorOp: 'floor',
  CeilOp: 'ceil',
  AbsOp: 'abs',
} as const

export const mathOpDescriptions = {
  DivideOp: 'Divide two numbers',
  MultiplyOp: 'Multiply two numbers',
  SubtractOp: 'Subtract two numbers',
  AddOp: 'Add two numbers',
  ModuloOp: 'Calculate the remainder of division',
  SineOp: 'Calculate the sine of a number',
  CosineOp: 'Calculate the cosine of a number',
  MinOp: 'Get the minimum of two numbers',
  MaxOp: 'Get the maximum of two numbers',
  RoundOp: 'Round a number to the nearest integer',
  FloorOp: 'Round down to the nearest integer',
  CeilOp: 'Round up to the nearest integer',
  AbsOp: 'Get the absolute value of a number',
} as const as Record<keyof typeof mathOps, string>

export type MathOpType = keyof typeof mathOps

export class BezierCurveOp extends Operator<BezierCurveOp> {
  static displayName = 'BezierCurve'
  static description = 'Bezier curve for mapping input values using an interactive graph editor'
  createInputs() {
    return {
      factor: new NumberField(0.5, { min: 0, max: 1, step: 0.01, accessor: true }),
      curve: new BezierCurveField(),
    }
  }
  createOutputs() {
    return {
      value: new NumberField(),
    }
  }
  execute({
    factor,
    curve: _curve,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const curveField = this.inputs.curve as BezierCurveField
    // Use composeAccessor helper to handle both static values and accessor functions
    const value = composeAccessor(factor, (f: number) => curveField.evaluate(f))
    return { value } as ExtractProps<typeof this.outputs>
  }
}

export class FileOp extends Operator<FileOp> {
  static displayName = 'File'
  static description =
    'Fetch a file from a URL or text. Supports csv, tsv, json, text, and binary formats'
  asDownload = () => this.outputData

  constructor(id: OpId, inputs?: unknown, locked?: boolean) {
    super(id, inputs, locked)

    const sub = this.inputs.format.subscribe(format => {
      this.setFieldVisibility('autoType', format === 'csv' || format === 'tsv')
    })
    this.subs.push(sub)
  }

  createInputs() {
    return {
      format: new StringLiteralField('json', { values: ['json', 'csv', 'tsv', 'text', 'binary'] }),
      url: new FileUrlField(),
      text: new StringField(), // TODO: make this mutually exclusive with `url`
      autoType: new BooleanField(true, { showByDefault: false }),
      pulse: new NumberField(0, { min: 0, step: 1, showByDefault: false }),
    }
  }

  createOutputs() {
    return {
      data: new DataField(),
    }
  }

  // Helper method to read from project assets
  private async readFromProjectAsset(
    url: string,
    binary = false
  ): Promise<string | ArrayBuffer | null> {
    if (!url?.startsWith(projectScheme)) {
      return null
    }

    // Lazy imports to avoid circular dependency
    const { readAsset, readAssetBinary } = await import('./storage')
    const { useFileSystemStore } = await import('./filesystem-store')

    // Get current project and storage type
    const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
    if (!currentProjectName) {
      throw new Error('No project loaded. Please save or load a project first.')
    }

    const fileName = url.substring(projectScheme.length)

    // Use appropriate read function based on binary flag
    if (binary) {
      const result = await readAssetBinary(activeStorageType, currentProjectName, fileName)
      if (!result.success) {
        throw new Error(result.error.message)
      }
      return result.data
    }
    const result = await readAsset(activeStorageType, currentProjectName, fileName)
    if (!result.success) {
      throw new Error(result.error.message)
    }
    return result.data
  }

  // Helper method to fetch from URL
  private async fetchFromUrl(
    url: string,
    format: 'json' | 'csv' | 'tsv' | 'text' | 'binary'
  ): Promise<unknown> {
    if (format === 'csv') {
      const parseFn = this.inputs.autoType.value ? d3.autoType : null
      return await csv(url, parseFn)
    }
    if (format === 'tsv') {
      const parseFn = this.inputs.autoType.value ? d3.autoType : null
      return await tsv(url, parseFn)
    }

    const resp = await fetch(url)

    switch (format) {
      case 'json':
        return await resp.json()
      case 'text':
        return await resp.text()
      case 'binary':
        return await resp.arrayBuffer()
      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  }

  // Helper method to process data based on format
  private processData(
    data: string | ArrayBuffer | DSVRowArray<string> | unknown,
    format: string,
    autoType: boolean
  ): ExtractProps<typeof this.outputs> {
    if (format === 'csv' && typeof data === 'string') {
      const parseFn = autoType ? d3.autoType : null
      return { data: csvParse(data, parseFn) }
    }
    if (format === 'tsv' && typeof data === 'string') {
      const parseFn = autoType ? d3.autoType : null
      return { data: tsvParse(data, parseFn) }
    }
    if (format === 'json' && typeof data === 'string') {
      return { data: JSON.parse(data) }
    }
    return { data }
  }

  // Helper method to process text input
  private processText(
    text: string,
    format: string,
    autoType: boolean
  ): ExtractProps<typeof this.outputs> {
    switch (format) {
      case 'csv': {
        const parseFn = autoType ? d3.autoType : null
        return { data: csvParse(text, parseFn) }
      }
      case 'tsv': {
        const parseFn = autoType ? d3.autoType : null
        return { data: tsvParse(text, parseFn) }
      }
      case 'json':
        return { data: JSON.parse(text) }
      case 'text':
        return { data: text }
      case 'binary': {
        // Convert text to Uint8Array for binary format
        const encoder = new TextEncoder()
        return { data: encoder.encode(text) }
      }
      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  }

  // Helper method to get empty result based on format
  private getEmptyResult(format: string): ExtractProps<typeof this.outputs> {
    switch (format) {
      case 'csv':
      case 'tsv':
        return { data: [] }
      case 'json':
        return { data: {} }
      case 'text':
        return { data: '' }
      case 'binary':
        return { data: new Uint8Array() }
      default:
        return { data: null }
    }
  }

  async execute({
    format,
    url,
    text,
    autoType,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    try {
      // Try reading from project asset first
      if (url) {
        const assetData = await this.readFromProjectAsset(url, format === 'binary')
        if (assetData !== null) {
          return this.processData(assetData, format, autoType)
        }

        // Not a project asset, fetch from URL
        const data = await this.fetchFromUrl(
          url,
          format as 'json' | 'csv' | 'tsv' | 'text' | 'binary'
        )
        return this.processData(data, format, autoType)
      }

      // Handle text input
      if (text) {
        return this.processText(text, format, autoType)
      }

      // No input provided, return empty result
      return this.getEmptyResult(format)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Unable to read file "${url}": ${errorMessage}`)
    }
  }
}

export class ChartOp extends Operator<ChartOp> {
  static displayName = 'Chart'
  static description = 'Create charts using Observable Plot (bar, histogram, scatter)'

  // Subscribe here, not in createInputs: chartType emits on subscribe, and this.inputs
  // doesn't exist until createInputs returns
  constructor(id: OpId, inputs?: unknown, locked?: boolean) {
    super(id, inputs, locked)

    const sub = this.inputs.chartType.subscribe(type => {
      // Hide yField for histogram (only needs x-axis)
      this.setFieldVisibility('yField', type !== 'histogram')
    })
    this.subs.push(sub)
  }

  createInputs() {
    const data = new DataField()
    const chartType = new StringLiteralField('bar', { values: ['bar', 'histogram', 'scatter'] })
    const xField = new StringLiteralField('', [])
    const yField = new StringLiteralField('', [])

    // Dynamic field population pattern (from FilterOp)
    data.subscribe((data: unknown[]) => {
      if (Array.isArray(data) && data.length > 0) {
        const keys = Object.keys(data[0])
        xField.updateChoices(keys)
        yField.updateChoices(keys)
      }
    })

    return {
      data,
      chartType,
      xField,
      yField,
      width: new NumberField(640, { min: 100, max: 2000, step: 10 }),
      height: new NumberField(400, { min: 100, max: 2000, step: 10 }),
      color: new ColorField('#4269d0'),
      title: new StringField(''),
      xLabel: new StringField(''),
      yLabel: new StringField(''),
    }
  }

  createOutputs() {
    return {
      // Plot.plot() returns a <figure> element containing the chart SVG
      chart: new UnknownField(),
    }
  }

  execute({
    data,
    chartType,
    xField,
    yField,
    width,
    height,
    color,
    title,
    xLabel,
    yLabel,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Validate inputs
    if (!Array.isArray(data) || data.length === 0) {
      return { chart: null }
    }

    // Validate that fields are populated (not empty strings)
    // This prevents Observable Plot from receiving undefined field names
    if (!xField || (chartType !== 'histogram' && !yField)) {
      console.warn(
        `[ChartOp] Field validation failed - xField: "${xField}", yField: "${yField}", chartType: "${chartType}"`
      )
      return { chart: null }
    }

    try {
      // Build marks based on chart type
      let marks: Plot.Markish[]
      switch (chartType) {
        case 'bar':
          marks = [Plot.barY(data, { x: xField, y: yField, fill: color })]
          break
        case 'histogram':
          marks = [Plot.rectY(data, Plot.binX({ y: 'count' }, { x: xField, fill: color }))]
          break
        case 'scatter':
          marks = [Plot.dot(data, { x: xField, y: yField, fill: color })]
          break
      }

      // Generate and return plot
      const chart = Plot.plot({
        width,
        height,
        title,
        marks,
        x: { label: xLabel || xField },
        y: { label: yLabel || yField },
      })

      return { chart }
    } catch (error) {
      console.error('[ChartOp] Plot generation failed:', error)
      analytics.captureException(error as Error, {
        source: 'chart_op',
        chartType,
        hasData: data?.length > 0,
        hasXField: !!xField,
        hasYField: !!yField,
        dataLength: data?.length,
      })
      return { chart: null }
    }
  }
}

export class BoundingBoxOp extends Operator<BoundingBoxOp> {
  static displayName = 'BoundingBox'
  static description =
    'Calculate the geographic bounds of your points (with lat/lng keys) or GeoJSON and get a camera position (center, zoom) that fits them all in view.'
  asDownload = () => this.outputData

  constructor(
    id: OpId,
    data?: Partial<ExtractProps<ReturnType<BoundingBoxOp['createInputs']>>>,
    locked = false,
    containerId?: string
  ) {
    super(id, data, locked, containerId)
    // The fit depends on the render surface, not just inputs; refit when it resizes
    this.subs.push(subscribeToRenderSurfaceSize(() => this.markDirty('render surface resize')))
  }

  createInputs() {
    return {
      // Points, or a GeoJSON FeatureCollection, Feature or Geometry (e.g. a GeoJson operator's output)
      data: orSchema(new ArrayField(new Point2DField()), geoJsonSchema),
      // TODO: could be a union, either a number or object with top, right, bottom, left
      padding: new NumberField(0, { softMin: -1_000, softMax: 1_000 }),
    }
  }
  createOutputs() {
    return {
      bounds: new ArrayField(new Point2DField([0, 0], { returnType: 'tuple' })),
      longitude: new NumberField(),
      latitude: new NumberField(),
      zoom: new NumberField(),
      viewState: new CompoundPropsField({
        longitude: new NumberField(),
        latitude: new NumberField(),
        zoom: new NumberField(),
      }),
    }
  }
  execute({ data, padding }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    let east = -180
    let west = 180
    let north = -90
    let south = 90
    // Should this be a turf function? Do we need to cast data to GeoJSON first?
    // Or allow the lat / lng keys to be configurable?
    const points = Array.isArray(data) ? data : geoJsonBoundsCorners(data)
    for (const d of points) {
      if (d.lng < west) {
        west = d.lng
      }
      if (d.lng > east) {
        east = d.lng
      }
      if (d.lat < south) {
        south = d.lat
      }
      if (d.lat > north) {
        north = d.lat
      }
    }
    const bounds = [
      [west, south],
      [east, north],
    ] as [[number, number], [number, number]]

    const { width, height } = getRenderSurfaceSize()

    const { longitude, latitude, zoom } = fitBounds({
      bounds,
      width,
      height,
      padding,
    })

    const viewState = {
      longitude,
      latitude,
      zoom,
    }

    return { bounds, longitude, latitude, zoom, viewState }
  }
}

export class GeocoderOp extends Operator<GeocoderOp> {
  static displayName = 'Geocoder'
  static description = 'Get the location of a query string'
  createInputs() {
    return {
      query: new StringField(),
    }
  }
  createOutputs() {
    return {
      location: new Point2DField(),
      results: new DataField(),
    }
  }
  async execute({
    query,
  }: ExtractProps<typeof this.inputs>): Promise<ExtractProps<typeof this.outputs>> {
    const { getKey } = getKeysStore()
    const apiKey = getKey('mapbox')
    if (!apiKey) {
      throw new Error('Mapbox API key required (Settings > API Keys)')
    }

    const emptyResult = { location: { lng: 0, lat: 0 }, results: [] }
    if (!query.trim()) return emptyResult

    const results = await geocodeWithMapbox(query, apiKey)
    const [result] = results
    if (!result) return emptyResult

    return {
      location: {
        lng: result.coordinates.longitude,
        lat: result.coordinates.latitude,
      },
      results,
    }
  }
}

export class DirectionsOp extends Operator<DirectionsOp> {
  static displayName = 'Directions'
  static description = 'Get driving, traffic-aware driving, or transit directions between points'
  asDownload = () => this.outputData
  createInputs() {
    return {
      origin: new Point2DField(),
      destination: new Point2DField(),
      mode: new StringLiteralField('transit', {
        values: [
          { value: 'driving', label: 'Driving (Mapbox / OSRM)' },
          { value: 'driving-traffic', label: 'Driving with traffic (Google)' },
          { value: 'transit', label: 'Transit (Google)' },
        ],
      }),
      departureMode: new StringLiteralField('now', {
        values: [
          { value: 'now', label: 'Depart now' },
          { value: 'scheduled', label: 'Schedule departure' },
        ],
      }),
      departureTime: new DateField(),
      trafficModel: new StringLiteralField('best-guess', {
        values: [
          { value: 'best-guess', label: 'Best guess' },
          { value: 'pessimistic', label: 'Pessimistic' },
          { value: 'optimistic', label: 'Optimistic' },
        ],
      }),
      avoidTolls: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      route: new CompoundPropsField(
        {
          distance: new NumberField(0, { min: 0, optional: true }),
          duration: new NumberField(0, { min: 0, optional: true }),
          durationFormatted: new StringField('', { optional: true }),
          timestamps: new ArrayField(new NumberField()),
          path: new ArrayField(new Point2DField([0, 0], { returnType: 'tuple' })),
          hasTolls: new BooleanField(false, { optional: true }),
          tollAmount: new NumberField(0, { min: 0, optional: true }),
          tollCurrency: new StringField('', { optional: true }),
        },
        { passthrough: true }
      ),
    }
  }
  override isFieldVisible(name: string): boolean {
    if (name === 'departureMode' || name === 'trafficModel' || name === 'avoidTolls') {
      return this.inputs.mode.value === 'driving-traffic'
    }
    if (name === 'departureTime') {
      return (
        this.inputs.mode.value === 'driving-traffic' &&
        this.inputs.departureMode.value === 'scheduled'
      )
    }
    return super.isFieldVisible(name)
  }
  async execute({
    origin,
    destination,
    mode,
    departureMode,
    departureTime,
    trafficModel,
    avoidTolls,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Guard on default values
    if (
      (origin.lng === 0 && origin.lat === 0) ||
      (destination.lng === 0 && destination.lat === 0) ||
      !(mode === 'driving' || mode === 'driving-traffic' || mode === 'transit')
    ) {
      console.debug('Invalid origin, destination or mode', origin, destination, mode)
      return { route: { timestamps: [], path: [] } }
    }

    const route = await getDirections({
      origin,
      destination,
      mode,
      departureTime:
        mode === 'driving-traffic' && departureMode === 'scheduled' ? departureTime : undefined,
      trafficModel,
      avoidTolls,
    })

    return { route }
  }
}

function isTemporal(
  value: unknown
): value is
  | Temporal.PlainDate
  | Temporal.PlainDateTime
  | Temporal.Instant
  | Temporal.ZonedDateTime {
  return (
    value instanceof Temporal.PlainDate ||
    value instanceof Temporal.PlainDateTime ||
    value instanceof Temporal.Instant ||
    value instanceof Temporal.ZonedDateTime
  )
}

// Helper function to interpolate between two Temporal objects
function interpolateTemporal(a: unknown, b: unknown, t: number): unknown {
  // Convert both to epoch milliseconds for interpolation
  let aMs: number
  let bMs: number
  let type: 'Instant' | 'ZonedDateTime' | 'PlainDateTime' | 'PlainDate'

  if (a instanceof Temporal.Instant) {
    aMs = a.epochMilliseconds
    bMs = b.epochMilliseconds
    type = 'Instant'
  } else if (a instanceof Temporal.ZonedDateTime) {
    aMs = a.epochMilliseconds
    bMs = b.epochMilliseconds
    type = 'ZonedDateTime'
  } else if (a instanceof Temporal.PlainDateTime) {
    // Convert to a reference Instant (using UTC as reference)
    aMs = a.toZonedDateTime('UTC').epochMilliseconds
    bMs = b.toZonedDateTime('UTC').epochMilliseconds
    type = 'PlainDateTime'
  } else if (a instanceof Temporal.PlainDate) {
    // Convert to a reference Instant (start of day in UTC)
    aMs = a.toZonedDateTime({
      timeZone: 'UTC',
      plainTime: Temporal.PlainTime.from('00:00'),
    }).epochMilliseconds
    bMs = b.toZonedDateTime({
      timeZone: 'UTC',
      plainTime: Temporal.PlainTime.from('00:00'),
    }).epochMilliseconds
    type = 'PlainDate'
  } else {
    throw new Error('Unsupported Temporal type for interpolation')
  }

  // Interpolate the milliseconds
  const interpolatedMs = Math.round(aMs + (bMs - aMs) * t)

  // Convert back to the appropriate Temporal type
  if (type === 'Instant') {
    return Temporal.Instant.fromEpochMilliseconds(interpolatedMs)
  }
  if (type === 'ZonedDateTime') {
    const instant = Temporal.Instant.fromEpochMilliseconds(interpolatedMs)
    return instant.toZonedDateTimeISO((a as Temporal.ZonedDateTime).timeZoneId)
  }
  if (type === 'PlainDateTime') {
    const instant = Temporal.Instant.fromEpochMilliseconds(interpolatedMs)
    return instant.toZonedDateTimeISO('UTC').toPlainDateTime()
  }
  // PlainDate
  const instant = Temporal.Instant.fromEpochMilliseconds(interpolatedMs)
  return instant.toZonedDateTimeISO('UTC').toPlainDate()
}

export class MergeOp extends Operator<MergeOp> {
  static displayName = 'Merge'
  static description = 'Merge multiple objects into one (think Object.assign)'
  createInputs() {
    return {
      objects: new ListField(new DataField()),
    }
  }
  createOutputs() {
    return {
      object: new DataField(),
    }
  }
  execute({ objects }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Check if any objects are accessor functions
    const hasAccessors = objects.some(isAccessor)

    if (hasAccessors) {
      // Return an accessor function that evaluates all objects and merges them
      const result = (...args: unknown[]) => {
        const evaluatedObjects = objects.map(item => (isAccessor(item) ? item(...args) : item))
        return Object.assign({}, ...evaluatedObjects)
      }
      return { object: result }
    }

    // Static evaluation
    const object = Object.assign({}, ...objects)
    return { object }
  }
}

export class MouseOp extends Operator<MouseOp> {
  static displayName = 'Mouse'
  static description = 'Get the current mouse position on the screen'

  private mousePosition$ = new BehaviorSubject({ x: 0, y: 0 })
  private mouseListener?: (e: MouseEvent) => void
  private containerElement?: Element

  constructor(id: OpId, inputs?: unknown, locked?: boolean) {
    super(id, inputs, locked)
    // Initialize mouse position updates after outputs are created
    this.initializeMouseUpdates()
  }

  createInputs() {
    return {}
  }

  createOutputs() {
    return {
      position: new Vec2Field(),
    }
  }

  private initializeMouseUpdates() {
    // Subscribe output to the behavior subject
    const sub = this.mousePosition$.subscribe(pos => {
      this.outputs.position.next(pos)
    })
    this.subs.push(sub)
  }

  // Called by the component to inject the container element
  setContainer(container: Element) {
    // Clean up old listener if any
    if (this.mouseListener && this.containerElement) {
      window.removeEventListener('mousemove', this.mouseListener, false)
    }

    this.containerElement = container

    this.mouseListener = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const scale = getTransformScaleFactor(container)
      this.mousePosition$.next({
        x: (e.clientX - rect.left) / scale.x,
        y: (e.clientY - rect.top) / scale.y,
      })
    }

    window.addEventListener('mousemove', this.mouseListener, false)
  }

  dispose() {
    if (this.mouseListener) {
      window.removeEventListener('mousemove', this.mouseListener, false)
    }
    this.mousePosition$.complete()
    super.dispose()
  }

  execute(_: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Output is driven by the BehaviorSubject, not by execute()
    return null
  }
}

export class CustomMapLibreLayerOp extends Operator<CustomMapLibreLayerOp> {
  static displayName = 'CustomMapLibreLayer'
  static description =
    'Define a custom MapLibre GL layer with WebGL rendering. ' +
    'The code must return an object with onAdd, render, and onRemove methods. ' +
    'Access parameters via `params` object and map instance via `map`.'

  createInputs() {
    return {
      id: new StringField('custom-layer'),
      code: new CodeField('', { language: 'javascript' }),
      renderingMode: new StringLiteralField('3d', {
        values: ['2d', '3d'],
      }),
      beforeId: new StringField('', {
        optional: true,
        showByDefault: false,
      }),
      params: new UnknownField(
        {},
        {
          optional: true,
          showByDefault: false,
        }
      ),
    }
  }

  createOutputs() {
    return {
      layer: new MapLibreLayerField(),
    }
  }

  execute({
    id,
    code: codeString,
    renderingMode,
    beforeId,
    params,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!codeString || codeString.trim() === '') {
      throw new Error('CustomMapLibreLayer code cannot be empty')
    }

    return {
      layer: {
        id,
        type: 'custom',
        code: codeString,
        renderingMode: renderingMode || '3d',
        beforeId,
        params: params || {},
      },
    }
  }
}

export class MapStyleConfiguratorOp extends Operator<MapStyleConfiguratorOp> {
  static displayName = 'MapStyleConfigurator'
  static description =
    'Visually edit Maplibre style layer colors, fonts, and visibility. Connect the output to MaplibreBasemap.'

  // Cache to avoid re-fetching the same style URL on every override change
  private _cachedStyleUrl: string | null = null
  private _cachedStyle: MaplibreStyle | null = null

  createInputs() {
    return {
      baseStyle: new FileUrlField(CARTO_DARK, { accept: '.json' }),
      // Stores layer + global overrides as { layers: LayerOverride[], global: StyleGlobalOverrides }
      overrides: new UnknownField({ layers: [], global: {} }),
    }
  }

  createOutputs() {
    return {
      // UnknownField because execute() returns a full style object, not just a URL string
      mapStyle: new UnknownField(),
    }
  }

  async execute({
    baseStyle,
    overrides,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!baseStyle) return { mapStyle: '' }

    let styleObj: MaplibreStyle
    if (typeof baseStyle === 'string') {
      if (this._cachedStyleUrl !== baseStyle) {
        const resp = await fetch(baseStyle)
        if (!resp.ok) throw new Error(`Failed to fetch map style: ${resp.statusText}`)
        this._cachedStyle = await resp.json()
        this._cachedStyleUrl = baseStyle
      }
      styleObj = this._cachedStyle!
    } else {
      styleObj = baseStyle as MaplibreStyle
    }

    const config = (overrides ?? { layers: [], global: {} }) as StyleConfiguratorData
    return { mapStyle: applyStyleOverrides(styleObj, config) }
  }
}

function createBaseViewFields() {
  return {
    x: new NumberField(0, { showByDefault: false }),
    y: new NumberField(0, { showByDefault: false }),
    width: new StringField('100%'),
    height: new StringField('100%'),
    padding: new CompoundPropsField({
      top: new NumberField(0, { min: 0 }),
      right: new NumberField(0, { min: 0 }),
      bottom: new NumberField(0, { min: 0 }),
      left: new NumberField(0, { min: 0 }),
    }),
    clear: new BooleanField(false, { showByDefault: false }),
    clearColor: new ColorField('#00000000', { transform: hexToColor, showByDefault: false }),
    parameters: new CompoundPropsField({}, { showByDefault: false }),
  }
}

function createGeoViewFields() {
  return {
    altitude: new NumberField(1.5, {
      softMin: -100_000,
      softMax: 100_000,
      step: 0.1,
      showByDefault: false,
    }),
    nearZMultiplier: new NumberField(0.1, {
      min: 0,
      softMax: 1_000,
      step: 0.1,
      showByDefault: false,
    }),
    farZMultiplier: new NumberField(1.01, { min: 0, softMax: 1_000, showByDefault: false }),
  }
}

function createGeoViewStateFields() {
  return {
    latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
    longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
  }
}

function createFrustumViewFields() {
  return {
    near: new NumberField(0.1, { min: 0, softMax: 1_000_000, step: 0.1, showByDefault: false }),
    far: new NumberField(100000, { min: 0, softMax: 1_000_000, showByDefault: false }),
  }
}

export class LayerPropsOp extends Operator<LayerPropsOp> {
  static displayName = 'LayerProps'
  static description =
    'Add additional props to a layer (e.g., operation: "mask" for mask layers, beforeId for maplibre layer ordering)'
  createInputs() {
    return {
      layer: new LayerField(),
      operation: new StringField('', { optional: true }),
      beforeId: new StringField('', { optional: true }),
      additionalProps: new UnknownField({}, { optional: true }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField(),
    }
  }
  execute({
    layer,
    operation,
    beforeId,
    additionalProps,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const mergedLayer = {
      ...layer,
      ...(operation ? { operation } : {}),
      ...(beforeId ? { beforeId } : {}),
      ...additionalProps,
    }
    return { layer: mergedLayer }
  }
}

function gatherTriggers(
  inputs: Record<string, Field<z.ZodType>>,
  props: ExtractProps<typeof inputs>
) {
  const triggers = {} as Record<string, ((...args: unknown[]) => unknown)[]>
  for (const [key, field] of Object.entries(inputs)) {
    if (field.accessor && props[key]) {
      triggers[key] = [props[key]]
    }
  }
  return triggers
}

type ExtensionDescriptor = { type: string; [key: string]: unknown }

type LayerExtensionFieldReturnValue = null | {
  extension: ExtensionDescriptor | LayerExtension
  props: Record<string, LayerPropsValue>
}

// Map of extension type names to extension classes or wrapped classes with constructor args
export const extensionMap: Record<
  string,
  | (new (
      ...args: ExtensionConstructorArgs
    ) => LayerExtension)
  | {
      ExtensionClass: new (...args: ExtensionConstructorArgs) => LayerExtension
      args: ExtensionConstructorArgs
    }
> = {
  BrushingExtension,
  ClipExtension,
  CollisionFilterExtension,
  DataFilterExtension,
  FillStyleExtension,
  Mask3DExtension,
  MaskExtension,
  PathStyleExtension,
  TerrainExtension,
  // Filter color extensions - these wrap FilterColorExtension with specific effects
  BrightnessContrastExtension: { ExtensionClass: FilterColorExtension, args: brightnessContrast },
  HueSaturationExtension: { ExtensionClass: FilterColorExtension, args: hueSaturation },
  VibranceExtension: { ExtensionClass: FilterColorExtension, args: vibrance },
}

// Turns an extension descriptor into a LayerExtension. Instances built by the user
// (e.g. in a CodeOp) pass through unchanged. Returns null for unknown types.
export function instantiateExtension(
  ext: ExtensionDescriptor | LayerExtension
): LayerExtension | null {
  if (ext instanceof LayerExtension) return ext

  const { type, ...constructorArgs } = ext
  const extensionDef = extensionMap[type]
  if (!extensionDef) return null

  // Wrapped extensions carry their own constructor args
  if ('ExtensionClass' in extensionDef) {
    return new extensionDef.ExtensionClass(extensionDef.args)
  }
  return Object.keys(constructorArgs).length > 0
    ? new extensionDef(constructorArgs)
    : new extensionDef()
}

// Deck layers can have extensions that are passed in as props, but the props to the extensions are not
// passed to the extension constructor, but rather to the root props on the layer.
// Descriptors are kept as POJOs here and instantiated later (instantiateExtension, in noodles.tsx);
// LayerExtension instances built in a CodeOp pass through as-is.
function parseLayerProps<P extends LayerProps>({
  extensions = [],
  ...props
}: {
  extensions: LayerExtensionFieldReturnValue[]
} & P) {
  const validExtensions = extensions.filter(
    (e): e is Exclude<LayerExtensionFieldReturnValue, null> => e !== null
  )

  const result = { ...props }

  if (validExtensions.length > 0) {
    // Keep extensions as POJOs for now - they'll be instantiated later in noodles.tsx
    result.extensions = validExtensions.map(e => e.extension)

    // Merge extension props into the layer props
    for (const ext of validExtensions) {
      Object.assign(result, ext.props)
    }
  }

  return result
}

const DEFAULT_COLOR_RANGE = [
  [255, 255, 178],
  [254, 217, 118],
  [254, 178, 76],
  [253, 141, 60],
  [240, 59, 32],
  [189, 0, 38],
]

export class BrushingExtensionOp extends Operator<BrushingExtensionOp> {
  static displayName = 'BrushingExtension'
  static description =
    'Only render the points within a given radius of the mouse position. Used with most layer types.'
  createInputs() {
    return {
      brushingRadius: new NumberField(100, { min: 0, softMax: 100_000 }),
      brushingEnabled: new BooleanField(true),
      brushingTarget: new StringLiteralField('source', {
        values: ['source', 'target', 'source_target', 'custom'],
      }),
      getBrushingTarget: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'BrushingExtension' },
      props,
    }
    return { extension }
  }
}

export class PathStyleExtensionOp extends Operator<PathStyleExtensionOp> {
  static displayName = 'PathStyleExtension'
  static description = 'Style a path (used with PathLayer, PolygonLayer, and GeoJSONLayer)'
  createInputs() {
    return {
      dash: new BooleanField(true),
      highPrecisionDash: new BooleanField(false, { showByDefault: false }),
      offset: new BooleanField(false),
      dashMode: new StringLiteralField('segment', ['segment', 'path']),
      dashJustified: new BooleanField(false),
      dashUnits: new StringLiteralField('widths', ['widths', 'pixels', 'meters', 'common']),
      getDashArray: new Vec2Field([4, 4], { returnType: 'tuple', accessor: true }),
      getOffset: new NumberField(0, { softMin: -10_000, softMax: 10_000, accessor: true }),
      dashGapPickable: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute({
    dash,
    highPrecisionDash,
    offset,
    dashMode,
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: {
        type: 'PathStyleExtension',
        dash,
        dashMode: highPrecisionDash ? 'path' : dashMode,
        offset,
      },
      props,
    }
    return { extension }
  }
}

type FunctionWithSource = ((...args: unknown[]) => unknown | Promise<unknown>) & { source: string }
// biome-ignore lint/complexity/useArrowFunction: This is a function declaration
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// Count occurrences of a character in a string (for bracket matching)
function countChar(str: string, char: string): number {
  return (str.match(new RegExp(`\\${char}`, 'g')) || []).length
}

// Convert cryptic JS errors to actionable messages based on code analysis
export function getFriendlyErrorMessage(jsError: string, userCode: string): string {
  // Count unmatched delimiters - used for multiple error types
  const brackets = countChar(userCode, '[') - countChar(userCode, ']')
  const parens = countChar(userCode, '(') - countChar(userCode, ')')
  const braces = countChar(userCode, '{') - countChar(userCode, '}')

  // Handle "Unexpected end of input" or "Unexpected token '}'" or "Unexpected token ')'"
  // These typically mean something is unclosed
  if (
    jsError.includes('Unexpected end of input') ||
    jsError.includes("Unexpected token '}'") ||
    jsError.includes("Unexpected token ')'")
  ) {
    if (brackets > 0) return `Missing ${brackets} closing ']'`
    if (parens > 0) return `Missing ${parens} closing ')'`
    if (braces > 0) return `Missing ${braces} closing '}'`

    // Check for trailing operators
    if (/[+\-*/%&|^=!<>]+\s*$/.test(userCode)) {
      return 'Expression incomplete - missing value after operator'
    }

    // Check for trailing dot (property access)
    if (/\.\s*$/.test(userCode)) {
      return 'Expression incomplete - missing property name after "."'
    }

    // Check for trailing comma
    if (/,\s*$/.test(userCode)) {
      return 'Expression incomplete - trailing comma'
    }
  }

  // Handle unterminated strings
  if (jsError.includes('Unterminated string')) {
    const singleQuotes = countChar(userCode, "'") % 2
    const doubleQuotes = countChar(userCode, '"') % 2
    const backticks = countChar(userCode, '`') % 2

    if (singleQuotes) return "Missing closing ' (single quote)"
    if (doubleQuotes) return 'Missing closing " (double quote)'
    if (backticks) return 'Missing closing ` (backtick)'
    return 'Unclosed string literal'
  }

  // Handle unexpected tokens - check if we have unclosed delimiters anyway
  if (jsError.includes('Unexpected token')) {
    if (brackets > 0) return `Missing ${brackets} closing ']'`
    if (parens > 0) return `Missing ${parens} closing ')'`
    if (braces > 0) return `Missing ${braces} closing '}'`
    return jsError
  }

  // Fallback to original error
  return jsError
}

// Format a syntax error message to be more helpful
function formatSyntaxError(error: Error, id: string, body: string): string {
  const errorType = error.name === 'SyntaxError' ? 'Syntax error' : error.name

  // Strip "return " prefix if present (added by ExpressionOp/AccessorOp)
  const userCode = body.startsWith('return ') ? body.slice(7) : body

  // Try to provide actionable message based on code analysis
  const friendly = getFriendlyErrorMessage(error.message, userCode)

  let message = `${errorType} in ${id}: ${friendly}`

  // For single-line code, show the code inline
  if (body.split('\n').length === 1 && userCode.length < 60) {
    message += `\n  Code: ${userCode}`
  }

  return message
}

// Create a function with a source property for debugging
export function fnWithSource(args: string[], body: string, id: string): FunctionWithSource {
  try {
    // Duck typing to check if the function is async
    const isAsync = /\bawait\b/.test(body)
    const FunctionConstructor = isAsync ? AsyncFunction : Function
    const func = new FunctionConstructor(...args, [`// ID: ${id}`, body].join('\n'))
    const displayName = `${id} execute`
    Object.defineProperties(func, {
      name: { value: displayName, configurable: true, writable: false },
      source: { value: body, configurable: true, writable: false },
    })
    return func
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    // Use debugExecute since syntax errors during editing are expected
    debugExecute(formatSyntaxError(error, id, body))

    // Strip "return " prefix for user code analysis
    const userCode = body.startsWith('return ') ? body.slice(7) : body

    // Throw error with friendly message for UI display
    const friendlyMessage = getFriendlyErrorMessage(error.message, userCode)
    const FriendlyError = error.constructor as ErrorConstructor
    throw new FriendlyError(friendlyMessage)
  }
}

// Creates a safe wrapper around getOp that throws a clear error when operator not found.
function safeOpGetter(contextOpId: string): (path: string) => OpView {
  return (path: string) => {
    const op = resolveOp(path, contextOpId)
    if (!op) {
      throw new Error(`Operator '${path}' not found`)
    }
    return op
  }
}

export class CodeOp extends Operator<CodeOp> {
  static displayName = 'Code'
  static description =
    'Run custom JavaScript code to transform your data. Available variables: `data` (all input data), `d` (first element), `op()` (access other operators), `sequenceTime` (timeline position), `frame` (current frame), `totalFrames`, `sequence` (timeline metadata). Includes d3, turf, and other utilities. Use `this` to store state between executions.'
  static supportsCustomFields = true
  asDownload = () => this.outputs.data.value
  createInputs() {
    return {
      data: new ListField(new DataField()),
      code: new CodeField('', { language: 'javascript' }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  async execute({
    data,
    code: codeString,
  }: ExtractProps<typeof this.inputs>): Promise<ExtractProps<typeof this.outputs>> {
    // Replace self-parameter shorthand {{par.field}} with op() calls referencing this operator
    let processedCode = codeString
      .trim()
      .replace(selfParMustacheRe, (_match, _inOut, fieldPath) => {
        return `op('${this.id}').par.${fieldPath}`
      })

    // Replace standard mustache references with op() calls, handling relative paths
    processedCode = processedCode.replace(mustacheRe, (_match, opId, inOut, fieldPath) => {
      return `op('${opId}').${inOut}.${fieldPath}`
    })

    // Get current timeline values
    const timelineContext = getTimelineContext()

    // Subscribe to timeline changes for reactive updates
    subscribeOpToTimeline(this)

    // Create a context-aware getOp function for the code execution
    const contextualGetOp = safeOpGetter(this.id)
    const fn = fnWithSource(
      [
        'data',
        'd',
        'op',
        'sequenceTime',
        'frame',
        'totalFrames',
        'sequence',
        ...Object.keys(freeExports),
      ],
      processedCode,
      this.id
    )
    const result = fn.call(
      this,
      data,
      data[0],
      contextualGetOp,
      timelineContext.sequenceTime,
      timelineContext.frame,
      timelineContext.totalFrames,
      timelineContext.sequence,
      ...Object.values(freeExports)
    )

    const output = result instanceof Promise ? await result : result
    return { data: output }
  }
}

export { monotoneSlopes, type RampInterpType } from '../utils/curves'


export class BufferOp extends Operator<BufferOp> {
  static displayName = 'Buffer'
  static description = 'Create a buffer zone around input geometry at a given distance'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      radius: new NumberField(1, { min: 0, step: 0.1 }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
      }),
      steps: new NumberField(64, { min: 4, max: 256, step: 1, showByDefault: false }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    radius,
    units,
    steps,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const buffered = turf.buffer(geojson, radius, { units: units as 'kilometers', steps })
    return { featureCollection: buffered || { type: 'FeatureCollection', features: [] } }
  }
}

export class UnionOp extends Operator<UnionOp> {
  static displayName = 'Union'
  static description = 'Merge multiple polygons into a single combined polygon'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const polygons = geojson.features.filter(
      (f: { geometry: { type: string } }) =>
        f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
    )
    if (polygons.length === 0)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    let merged = polygons[0]
    for (let i = 1; i < polygons.length; i++) {
      merged = turf.union(turf.featureCollection([merged, polygons[i]])) || merged
    }
    return { featureCollection: { type: 'FeatureCollection', features: [merged] } }
  }
}

export class DifferenceOp extends Operator<DifferenceOp> {
  static displayName = 'Difference'
  static description = 'Subtract one polygon from another (A minus B)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      a: new GeoJsonField(),
      b: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ a, b }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!a?.features?.length || !b?.features?.length)
      return { featureCollection: a || { type: 'FeatureCollection', features: [] } }
    const polyA = a.features[0]
    const polyB = b.features[0]
    const result = turf.difference(turf.featureCollection([polyA, polyB]))
    return { featureCollection: { type: 'FeatureCollection', features: result ? [result] : [] } }
  }
}

export class IntersectOp extends Operator<IntersectOp> {
  static displayName = 'Intersect'
  static description = 'Find the overlapping area between two polygons'
  asDownload = () => this.outputData
  createInputs() {
    return {
      a: new GeoJsonField(),
      b: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ a, b }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!a?.features?.length || !b?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const polyA = a.features[0]
    const polyB = b.features[0]
    const result = turf.intersect(turf.featureCollection([polyA, polyB]))
    return { featureCollection: { type: 'FeatureCollection', features: result ? [result] : [] } }
  }
}

export class CentroidOp extends Operator<CentroidOp> {
  static displayName = 'Centroid'
  static description = 'Calculate the centroid (center of mass) of each feature'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const centroids = geojson.features.map((f: GeoJSON.Feature) => {
      const c = turf.centroid(f)
      c.properties = { ...f.properties, ...c.properties }
      return c
    })
    return { featureCollection: { type: 'FeatureCollection', features: centroids } }
  }
}

export class ConvexHullOp extends Operator<ConvexHullOp> {
  static displayName = 'ConvexHull'
  static description = 'Calculate the convex hull (smallest enclosing polygon) of features'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const hull = turf.convex(geojson)
    return { featureCollection: { type: 'FeatureCollection', features: hull ? [hull] : [] } }
  }
}

export class VoronoiOp extends Operator<VoronoiOp> {
  static displayName = 'Voronoi'
  static description = 'Generate Voronoi polygons from a set of points'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const bbox = turf.bbox(geojson)
    const voronoi = turf.voronoi(geojson, { bbox })
    return { featureCollection: voronoi || { type: 'FeatureCollection', features: [] } }
  }
}

export class DissolveOp extends Operator<DissolveOp> {
  static displayName = 'Dissolve'
  static description = 'Dissolve polygons that share a common property value into single features'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      propertyName: new StringField(''),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    propertyName,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const dissolved = turf.dissolve(geojson, { propertyName: propertyName || undefined })
    return { featureCollection: dissolved }
  }
}

export class ClipOp extends Operator<ClipOp> {
  static displayName = 'Clip'
  static description = 'Clip features to a bounding polygon (mask)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      mask: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson, mask }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || !mask?.features?.length)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const maskPoly = mask.features[0]
    const clipped = geojson.features
      .map((f: GeoJSON.Feature) => {
        try {
          return turf.booleanWithin(f, maskPoly)
            ? f
            : turf.intersect(turf.featureCollection([f, maskPoly]))
        } catch {
          return null
        }
      })
      .filter(Boolean)
    return { featureCollection: { type: 'FeatureCollection', features: clipped } }
  }
}

// ==================== Spatial Analysis ====================

export class SpatialJoinOp extends Operator<SpatialJoinOp> {
  static displayName = 'SpatialJoin'
  static description = 'Join attributes from one layer to another based on spatial relationship'
  asDownload = () => this.outputData
  createInputs() {
    return {
      target: new GeoJsonField(),
      join: new GeoJsonField(),
      relationship: new StringLiteralField('within', {
        values: ['within', 'intersects', 'contains'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    target,
    join,
    relationship,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!target?.features?.length || !join?.features?.length)
      return { featureCollection: target || { type: 'FeatureCollection', features: [] } }
    const check =
      relationship === 'within'
        ? turf.booleanWithin
        : relationship === 'contains'
          ? turf.booleanContains
          : turf.booleanIntersects
    const joined = target.features.map((targetFeat: GeoJSON.Feature) => {
      const matching = join.features.find((joinFeat: GeoJSON.Feature) => {
        try {
          return check(targetFeat, joinFeat)
        } catch {
          return false
        }
      })
      return {
        ...targetFeat,
        properties: { ...targetFeat.properties, ...(matching?.properties || {}) },
      }
    })
    return { featureCollection: { type: 'FeatureCollection', features: joined } }
  }
}

export class PointInPolygonOp extends Operator<PointInPolygonOp> {
  static displayName = 'PointInPolygon'
  static description = 'Filter points that fall within a polygon boundary'
  asDownload = () => this.outputData
  createInputs() {
    return {
      points: new GeoJsonField(),
      polygon: new GeoJsonField(),
      invert: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      inside: new GeoJsonField(),
      outside: new GeoJsonField(),
    }
  }
  execute({
    points,
    polygon,
    invert,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const empty = { type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] }
    if (!points?.features?.length || !polygon?.features?.length)
      return { inside: empty, outside: empty }
    const poly = polygon.features[0]
    const inside: GeoJSON.Feature[] = []
    const outside: GeoJSON.Feature[] = []
    for (const pt of points.features) {
      if (pt.geometry.type !== 'Point') {
        outside.push(pt)
        continue
      }
      const isInside = turf.booleanPointInPolygon(pt, poly)
      if (isInside !== invert) inside.push(pt)
      else outside.push(pt)
    }
    return {
      inside: { type: 'FeatureCollection', features: inside },
      outside: { type: 'FeatureCollection', features: outside },
    }
  }
}

export class NearestPointOp extends Operator<NearestPointOp> {
  static displayName = 'NearestPoint'
  static description = 'Find the nearest point in a collection to a target point'
  asDownload = () => this.outputData
  createInputs() {
    return {
      targetPoint: new Point2DField([0, 0]),
      points: new GeoJsonField(),
    }
  }
  createOutputs() {
    return {
      nearest: new GeoJsonField(),
      distance: new NumberField(0),
    }
  }
  execute({
    targetPoint,
    points,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!points?.features?.length)
      return { nearest: { type: 'FeatureCollection', features: [] }, distance: 0 }
    const target = turf.point(targetPoint)
    const nearest = turf.nearestPoint(target, points)
    const dist = nearest.properties?.distanceToPoint ?? 0
    return {
      nearest: { type: 'FeatureCollection', features: [nearest] },
      distance: dist as number,
    }
  }
}

export class AreaOp extends Operator<AreaOp> {
  static displayName = 'Area'
  static description = 'Calculate the area of polygon features in specified units'
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      units: new StringLiteralField('squareKilometers', {
        values: ['squareMeters', 'squareKilometers', 'squareMiles', 'acres', 'hectares'],
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(),
      totalArea: new NumberField(0),
    }
  }
  execute({ geojson, units }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] }, totalArea: 0 }
    const conversions: Record<string, number> = {
      squareMeters: 1,
      squareKilometers: 1e-6,
      squareMiles: 3.861e-7,
      acres: 0.000247105,
      hectares: 0.0001,
    }
    const factor = conversions[units] || 1
    let total = 0
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      const areaM2 = turf.area(f)
      const area = areaM2 * factor
      total += area
      return { ...f, properties: { ...f.properties, area } }
    })
    return { featureCollection: { type: 'FeatureCollection', features }, totalArea: total }
  }
}

export class LengthOp extends Operator<LengthOp> {
  static displayName = 'Length'
  static description = 'Calculate the length of line features in specified units'
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'nauticalmiles'],
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(),
      totalLength: new NumberField(0),
    }
  }
  execute({ geojson, units }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] }, totalLength: 0 }
    let total = 0
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      const len = turf.length(f, { units: units as 'kilometers' })
      total += len
      return { ...f, properties: { ...f.properties, length: len } }
    })
    return { featureCollection: { type: 'FeatureCollection', features }, totalLength: total }
  }
}

export class ReprojectOp extends Operator<ReprojectOp> {
  static displayName = 'Reproject'
  static description = 'Transform coordinates between WGS84 and Web Mercator projections'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      from: new StringLiteralField('EPSG:4326', { values: ['EPSG:4326', 'EPSG:3857'] }),
      to: new StringLiteralField('EPSG:3857', { values: ['EPSG:4326', 'EPSG:3857'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    from,
    to,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || from === to)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const toMercator = (lng: number, lat: number): [number, number] => {
      const x = (lng * 20037508.34) / 180
      const y =
        ((Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * 20037508.34) / 180
      return [x, y]
    }
    const toWGS84 = (x: number, y: number): [number, number] => {
      const lng = (x * 180) / 20037508.34
      const lat = (Math.atan(Math.exp((y * Math.PI) / 20037508.34)) * 360) / Math.PI - 90
      return [lng, lat]
    }
    const transform = from === 'EPSG:4326' ? toMercator : toWGS84
    const transformCoords = (coords: unknown): unknown => {
      if (typeof coords[0] === 'number') return transform(coords[0] as number, coords[1] as number)
      return (coords as unknown[]).map(transformCoords)
    }
    const features = geojson.features.map((f: GeoJSON.Feature) => ({
      ...f,
      geometry: {
        ...f.geometry,
        coordinates: transformCoords((f.geometry as { coordinates: unknown }).coordinates),
      },
    }))
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class PointGridOp extends Operator<PointGridOp> {
  static displayName = 'PointGrid'
  static description = 'Generate a regular grid of points within a bounding box'
  asDownload = () => this.outputData
  createInputs() {
    return {
      bbox: new BboxField({
        southwest: { lng: -180, lat: -90 },
        northeast: { lng: 180, lat: 90 },
      }),
      cellSize: new NumberField(10, { min: 0.001, step: 1 }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    bbox,
    cellSize,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const turfBbox: [number, number, number, number] = [
      bbox.southwest.lng,
      bbox.southwest.lat,
      bbox.northeast.lng,
      bbox.northeast.lat,
    ]
    const grid = turf.pointGrid(turfBbox, cellSize, {
      units: units as 'kilometers',
    })
    return { featureCollection: grid }
  }
}

export class HexGridOp extends Operator<HexGridOp> {
  static displayName = 'HexGrid'
  static description = 'Generate a hexagonal grid within a bounding box'
  asDownload = () => this.outputData
  createInputs() {
    return {
      bbox: new BboxField({
        southwest: { lng: -180, lat: -90 },
        northeast: { lng: 180, lat: 90 },
      }),
      cellSize: new NumberField(10, { min: 0.001, step: 1 }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    bbox,
    cellSize,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const turfBbox: [number, number, number, number] = [
      bbox.southwest.lng,
      bbox.southwest.lat,
      bbox.northeast.lng,
      bbox.northeast.lat,
    ]
    const grid = turf.hexGrid(turfBbox, cellSize, {
      units: units as 'kilometers',
    })
    return { featureCollection: grid }
  }
}

export class SquareGridOp extends Operator<SquareGridOp> {
  static displayName = 'SquareGrid'
  static description = 'Generate a square grid within a bounding box'
  asDownload = () => this.outputData
  createInputs() {
    return {
      bbox: new BboxField({
        southwest: { lng: -180, lat: -90 },
        northeast: { lng: 180, lat: 90 },
      }),
      cellSize: new NumberField(10, { min: 0.001, step: 1 }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    bbox,
    cellSize,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const turfBbox: [number, number, number, number] = [
      bbox.southwest.lng,
      bbox.southwest.lat,
      bbox.northeast.lng,
      bbox.northeast.lat,
    ]
    const grid = turf.squareGrid(turfBbox, cellSize, {
      units: units as 'kilometers',
    })
    return { featureCollection: grid }
  }
}

export class TinOp extends Operator<TinOp> {
  static displayName = 'Tin'
  static description = 'Generate a Triangulated Irregular Network (TIN) from points'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      zProperty: new StringField(''),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    zProperty,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const tin = turf.tin(geojson, zProperty || undefined)
    return { featureCollection: tin }
  }
}

export class IsolineOp extends Operator<IsolineOp> {
  static displayName = 'Isoline'
  static description = 'Generate isolines (contour lines) from point data with Z values'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      zProperty: new StringField('elevation'),
      breaks: new UnknownField([100, 200, 500, 1000, 2000]),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    zProperty,
    breaks,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const isolines = turf.isolines(geojson, breaks as number[], { zProperty })
    return { featureCollection: isolines }
  }
}

export class LineToPolygonOp extends Operator<LineToPolygonOp> {
  static displayName = 'LineToPolygon'
  static description = 'Convert closed LineString features to Polygon features'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
        try {
          return turf.lineToPolygon(f)
        } catch {
          return f
        }
      }
      return f
    })
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class PolygonToLineOp extends Operator<PolygonToLineOp> {
  static displayName = 'PolygonToLine'
  static description = 'Convert Polygon features to LineString features (extract boundaries)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
        return turf.polygonToLine(f)
      }
      return f
    })
    const flat = features.flat ? features.flat() : features
    return { featureCollection: { type: 'FeatureCollection', features: flat } }
  }
}

export class ExplodeOp extends Operator<ExplodeOp> {
  static displayName = 'Explode'
  static description =
    'Break multi-part geometries into individual features, or extract all vertices as points'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      mode: new StringLiteralField('vertices', { values: ['vertices', 'parts'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson, mode }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    if (mode === 'vertices') {
      const exploded = turf.explode(geojson)
      return { featureCollection: exploded }
    }
    const parts = turf.flatten(geojson)
    return { featureCollection: parts }
  }
}

export class AggregateOp extends Operator<AggregateOp> {
  static displayName = 'Aggregate'
  static description = 'Aggregate point data into polygons (count, sum, mean, min, max per zone)'
  createInputs() {
    return {
      polygons: new GeoJsonField(),
      points: new GeoJsonField(),
      field: new StringField(''),
      operation: new StringLiteralField('count', {
        values: ['count', 'sum', 'mean', 'min', 'max'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    polygons,
    points,
    field,
    operation,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!polygons?.features?.length || !points?.features?.length)
      return { featureCollection: polygons || { type: 'FeatureCollection', features: [] } }
    const features = polygons.features.map((poly: GeoJSON.Feature) => {
      const inside = points.features.filter((pt: GeoJSON.Feature) => {
        try {
          return pt.geometry.type === 'Point' && turf.booleanPointInPolygon(pt, poly)
        } catch {
          return false
        }
      })
      let value: number
      if (operation === 'count') {
        value = inside.length
      } else {
        const values = inside
          .map((p: GeoJSON.Feature) => Number(p.properties?.[field]))
          .filter((v: number) => !Number.isNaN(v))
        if (values.length === 0) value = 0
        else if (operation === 'sum') value = values.reduce((a: number, b: number) => a + b, 0)
        else if (operation === 'mean')
          value = values.reduce((a: number, b: number) => a + b, 0) / values.length
        else if (operation === 'min') value = Math.min(...values)
        else value = Math.max(...values)
      }
      return {
        ...poly,
        properties: { ...poly.properties, [`${operation}_${field || 'points'}`]: value },
      }
    })
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class KMeansClusterOp extends Operator<KMeansClusterOp> {
  static displayName = 'KMeansCluster'
  static description = 'Cluster points into k groups using k-means algorithm'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      numberOfClusters: new NumberField(5, { min: 2, max: 100, step: 1 }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    numberOfClusters,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const clustered = turf.clustersKmeans(geojson, { numberOfClusters })
    return { featureCollection: clustered }
  }
}

export class DBScanClusterOp extends Operator<DBScanClusterOp> {
  static displayName = 'DBScanCluster'
  static description = 'Cluster points using DBSCAN density-based algorithm'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      maxDistance: new NumberField(1, { min: 0, step: 0.1 }),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
      minPoints: new NumberField(3, { min: 1, step: 1 }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    maxDistance,
    units,
    minPoints,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const clustered = turf.clustersDbscan(geojson, maxDistance, {
      units: units as 'kilometers',
      minPoints,
    })
    return { featureCollection: clustered }
  }
}

export class InterpolateOp extends Operator<InterpolateOp> {
  static displayName = 'Interpolate'
  static description = 'Interpolate scattered point data to a regular grid (IDW)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      cellSize: new NumberField(1, { min: 0.01, step: 0.1 }),
      property: new StringField('value'),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
      weight: new NumberField(2, { min: 0.1, max: 10, step: 0.1, showByDefault: false }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    cellSize,
    property,
    units,
    weight,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const interpolated = turf.interpolate(geojson, cellSize, {
      gridType: 'point',
      property,
      units: units as 'kilometers',
      weight,
    })
    return { featureCollection: interpolated }
  }
}

export class AlongOp extends Operator<AlongOp> {
  static displayName = 'Along'
  static description = 'Find a point at a specified distance along a line'
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      distance: new NumberField(1, { min: 0, step: 0.1 }),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    distance,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const features = geojson.features
      .filter((f: GeoJSON.Feature) => f.geometry.type === 'LineString')
      .map((f: GeoJSON.Feature) =>
        turf.along(f as GeoJSON.Feature<GeoJSON.LineString>, distance, {
          units: units as 'kilometers',
        })
      )
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class LineSliceOp extends Operator<LineSliceOp> {
  static displayName = 'LineSlice'
  static description = 'Extract a segment of a line between two distances along it'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      startDistance: new NumberField(0, { min: 0, step: 0.1 }),
      stopDistance: new NumberField(1, { min: 0, step: 0.1 }),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    startDistance,
    stopDistance,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const features = geojson.features
      .filter((f: GeoJSON.Feature) => f.geometry.type === 'LineString')
      .map((f: GeoJSON.Feature) => {
        const start = turf.along(f as GeoJSON.Feature<GeoJSON.LineString>, startDistance, {
          units: units as 'kilometers',
        })
        const stop = turf.along(f as GeoJSON.Feature<GeoJSON.LineString>, stopDistance, {
          units: units as 'kilometers',
        })
        return turf.lineSlice(start, stop, f as GeoJSON.Feature<GeoJSON.LineString>)
      })
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class TransformRotateOp extends Operator<TransformRotateOp> {
  static displayName = 'TransformRotate'
  static description = 'Rotate features by an angle around a pivot point'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      angle: new NumberField(0, { min: -360, max: 360, step: 1 }),
      pivot: new StringLiteralField('centroid', { values: ['centroid', 'center'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    angle,
    pivot,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || angle === 0)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      const pivotPt = pivot === 'centroid' ? turf.centroid(f) : turf.center(f)
      return turf.transformRotate(f, angle, { pivot: pivotPt })
    })
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class TransformScaleOp extends Operator<TransformScaleOp> {
  static displayName = 'TransformScale'
  static description = 'Scale features by a factor around their center'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      factor: new NumberField(1, { min: 0.01, max: 100, step: 0.1 }),
      origin: new StringLiteralField('centroid', {
        values: ['centroid', 'center', 'sw', 'se', 'nw', 'ne'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    factor,
    origin,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || factor === 1)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const features = geojson.features.map((f: GeoJSON.Feature) =>
      turf.transformScale(f, factor, { origin: origin as 'centroid' })
    )
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class TransformTranslateOp extends Operator<TransformTranslateOp> {
  static displayName = 'TransformTranslate'
  static description = 'Move features by a distance in a direction'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      distance: new NumberField(0, { min: 0, step: 0.1 }),
      direction: new NumberField(0, { min: 0, max: 360, step: 1 }),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    distance,
    direction,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || distance === 0)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const features = geojson.features.map((f: GeoJSON.Feature) =>
      turf.transformTranslate(f, distance, direction, { units: units as 'kilometers' })
    )
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class KmlToGeoJsonOp extends Operator<KmlToGeoJsonOp> {
  static displayName = 'KmlToGeoJson'
  static description = 'Convert KML string to GeoJSON FeatureCollection'
  asDownload = () => this.outputData
  createInputs() {
    return {
      kml: new CodeField('', { language: 'xml' }),
    }
  }
  createOutputs() {
    return {
      geojson: new DataField(),
    }
  }
  async execute({ kml }: ExtractProps<typeof this.inputs>) {
    const geojson = await utils.kmlToGeoJson(kml)
    return { geojson }
  }
}

export class GeoJsonTransformOp extends Operator<GeoJsonTransformOp> {
  static displayName = 'GeoJsonTransform'
  static description = 'Transform a GeoJSON feature with scale, translate, and rotate operations'
  asDownload = () => this.outputData
  createInputs() {
    return {
      feature: new GeoJsonField(),
      scale: new NumberField(1, { min: 0.001, softMax: 100, step: 0.1 }),
      translateX: new NumberField(0, { softMin: -10000, softMax: 10000, step: 0.1 }),
      translateY: new NumberField(0, { softMin: -10000, softMax: 10000, step: 0.1 }),
      rotate: new NumberField(0, { softMin: -360, softMax: 360, step: 1 }),
    }
  }
  createOutputs() {
    return {
      feature: new GeoJsonField(),
    }
  }
  execute({
    feature,
    scale,
    translateX,
    translateY,
    rotate,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    let transformed = feature

    // Get centroid of ORIGINAL feature to use as pivot for all transformations
    const centroid = turf.centroid(feature)
    const origin = centroid.geometry.coordinates as [number, number]

    // Apply rotation first (around original centroid)
    if (rotate !== 0) {
      transformed = turf.transformRotate(transformed, rotate, { pivot: origin })
    }

    // Apply scale second (around original centroid)
    if (scale !== 1) {
      transformed = turf.transformScale(transformed, scale, { origin })
    }

    // Apply translation last (after rotation and scale)
    if (translateX !== 0 || translateY !== 0) {
      const distance = Math.sqrt(translateX * translateX + translateY * translateY)
      const direction = (Math.atan2(translateX, translateY) * 180) / Math.PI
      transformed = turf.transformTranslate(transformed, distance, direction)
    }

    return { feature: transformed }
  }
}

// ==================== Choropleth ====================

// Shared geography and geoKey options
const GEOGRAPHY_OPTIONS: { value: Geography; label: string }[] = [
  { value: 'us-states', label: 'US States' },
  { value: 'world-countries', label: 'World Countries' },
  { value: 'ca-provinces', label: 'Canadian Provinces' },
  { value: 'custom', label: 'Custom (use boundaries input)' },
]

const GEO_KEY_OPTIONS: { value: GeoKey; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'name', label: 'Name' },
  { value: 'abbrev', label: 'Abbreviation / Code' },
  { value: 'fips', label: 'FIPS Code (US)' },
  { value: 'iso2', label: 'ISO Alpha-2' },
  { value: 'iso3', label: 'ISO Alpha-3' },
]

async function joinDataToFeaturesViaDuckDb(
  boundaries: GeoJsonFeatureCollection,
  data: Record<string, unknown>[],
  customSQL: string
): Promise<GeoJsonFeatureCollection> {
  // Flatten boundary features to rows (no geometry) keyed by __idx for round-tripping
  const boundaryRows = boundaries.features.map((f, i) => ({
    __idx: i,
    ...(f.properties ?? {}),
  }))

  const db = await duckDbInstance
  const suffix = Math.random().toString(36).slice(2)
  const boundsFile = `__choropleth_bounds_${suffix}.json`
  const dataFile = `__choropleth_data_${suffix}.json`

  await db.registerFileText(boundsFile, JSON.stringify(boundaryRows))
  await db.registerFileText(dataFile, JSON.stringify(data))

  const conn = await db.connect()
  try {
    await conn.query(
      `CREATE OR REPLACE TEMP VIEW boundaries AS SELECT * FROM read_json('${boundsFile}', format='array')`
    )
    await conn.query(
      `CREATE OR REPLACE TEMP VIEW data AS SELECT * FROM read_json('${dataFile}', format='array')`
    )

    const result = await conn.query(customSQL)
    const rows: Record<string, unknown>[] = result.toArray().map(r => {
      const obj: Record<string, unknown> = {}
      for (const [k, v] of r as Iterable<[string, unknown]>) obj[k] = v
      return obj
    })

    // Re-attach joined properties back to original features using __idx
    const rowByIdx = new Map<number, Record<string, unknown>>()
    for (const row of rows) {
      if (row.__idx != null) rowByIdx.set(row.__idx as number, row)
    }

    const features = boundaries.features.map((f, i) => {
      const match = rowByIdx.get(i)
      if (!match) return f
      const { __idx: _, ...matchProps } = match
      return { ...f, properties: { ...f.properties, ...matchProps } }
    })

    return { type: 'FeatureCollection', features }
  } finally {
    await conn.close().catch(() => null)
    await db.dropFile(boundsFile).catch(() => null)
    await db.dropFile(dataFile).catch(() => null)
  }
}

function buildChoroplethInputs() {
  const data = new DataField(new ArrayField(new UnknownField()))
  const geography = new StringLiteralField('us-states', GEOGRAPHY_OPTIONS)
  const boundaries = new GeoJsonField()
  const joinKey = new StringLiteralField('', [])
  const geoKey = new StringLiteralField('auto', GEO_KEY_OPTIONS)
  const customSQL = new CodeField('', { language: 'sql', showByDefault: false })

  data.subscribe((d: unknown[]) => {
    if (d.length > 0) joinKey.updateChoices(Object.keys(d[0]))
  })

  return { data, geography, boundaries, joinKey, geoKey, customSQL }
}

async function resolveBoundariesAndJoin(
  data: unknown[],
  geography: string,
  boundaries: unknown,
  joinKey: string,
  geoKey: string,
  customSQL?: string
) {
  const geo = geography as Geography
  const gk = geoKey as GeoKey
  const userBoundaries =
    geography === 'custom' ? (boundaries as GeoJsonFeatureCollection) : undefined
  const resolvedBoundaries = await getBoundaries(geo, userBoundaries)

  const rows = data as Record<string, unknown>[]

  if (customSQL?.trim()) {
    return joinDataToFeaturesViaDuckDb(resolvedBoundaries, rows, customSQL)
  }

  const resolvedGeoKey =
    gk === 'auto' && geo !== 'custom'
      ? detectGeoKey(rows, joinKey, geo)
      : gk === 'auto'
        ? 'name'
        : gk

  return joinDataToFeatures(resolvedBoundaries, rows, joinKey, resolvedGeoKey)
}

export class ChoroplethJoinOp extends Operator<ChoroplethJoinOp> {
  static displayName = 'ChoroplethJoin'
  static description =
    'Join tabular data onto geographic boundaries (US states, world countries, Canadian provinces) to produce a colored FeatureCollection'

  asDownload = () => this.outputData

  createInputs() {
    return buildChoroplethInputs()
  }

  createOutputs() {
    return {
      features: new GeoJsonField(),
    }
  }

  async execute({
    data,
    geography,
    boundaries,
    joinKey,
    geoKey,
    customSQL,
  }: ExtractProps<typeof this.inputs>): Promise<ExtractProps<typeof this.outputs>> {
    const features = await resolveBoundariesAndJoin(
      data,
      geography,
      boundaries,
      joinKey,
      geoKey,
      customSQL
    )
    return { features }
  }
}

export class ChoroplethLayerOp extends Operator<ChoroplethLayerOp> {
  static displayName = 'ChoroplethLayer'
  static description =
    'All-in-one choropleth: joins tabular data onto geographic boundaries and renders with a color scale'
  static cacheable = false

  createInputs() {
    const base = buildChoroplethInputs()
    const valueColumn = new StringLiteralField('', [])
    const colorScheme = new StringLiteralField('viridis', {
      values: Object.keys(continuousInterpolators),
      displayAs: 'color-scheme',
    })
    const opacity = new NumberField(0.85, { min: 0, max: 1, step: 0.01 })
    const stroked = new BooleanField(true, { showByDefault: false })
    const getLineColor = new ColorField('#000000', { transform: hexToColor, showByDefault: false })
    const getLineWidth = new NumberField(1, { min: 0, softMax: 100, showByDefault: false })
    const visible = new BooleanField(true)

    base.data.subscribe((d: unknown[]) => {
      if (d.length > 0) valueColumn.updateChoices(Object.keys(d[0]))
    })

    return {
      ...base,
      valueColumn,
      colorScheme,
      opacity,
      stroked,
      getLineColor,
      getLineWidth,
      visible,
    }
  }

  createOutputs() {
    return {
      layer: new LayerField<GeoJsonLayerProps>(),
    }
  }

  async execute({
    data,
    geography,
    boundaries,
    joinKey,
    geoKey,
    customSQL,
    valueColumn,
    colorScheme,
    opacity,
    stroked,
    getLineColor,
    getLineWidth,
    visible,
  }: ExtractProps<typeof this.inputs>): Promise<ExtractProps<typeof this.outputs>> {
    const featureCollection = await resolveBoundariesAndJoin(
      data,
      geography,
      boundaries,
      joinKey,
      geoKey,
      customSQL
    )

    const interpolator =
      continuousInterpolators[colorScheme as keyof typeof continuousInterpolators] ??
      continuousInterpolators.viridis

    // Auto-compute domain from matched features' valueColumn
    const values = featureCollection.features
      .map(f => f.properties?.[valueColumn])
      .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v))

    const domainMin = values.length > 0 ? Math.min(...values) : 0
    const domainMax = values.length > 0 ? Math.max(...values) : 1
    const range = domainMax - domainMin || 1

    const getFillColor = (f: GeoJsonFeature) => {
      const val = f.properties?.[valueColumn]
      if (typeof val !== 'number' || Number.isNaN(val))
        return [180, 180, 180, 100] as [number, number, number, number]
      const t = (val - domainMin) / range
      const hex = d3Color(interpolator(t))?.formatHex() ?? '#808080'
      return hexToColor(hex) ?? ([128, 128, 128, 255] as [number, number, number, number])
    }

    const layer = {
      type: 'GeoJsonLayer' as const,
      id: this.id,
      data: featureCollection,
      visible,
      opacity,
      filled: true,
      stroked,
      getFillColor,
      getLineColor,
      getLineWidth,
      updateTriggers: {
        getFillColor: [valueColumn, colorScheme, domainMin, domainMax],
      },
    }

    return { layer }
  }
}

export class SimplifyOp extends Operator<SimplifyOp> {
  static displayName = 'Simplify'
  static description = 'Simplify GeoJSON geometries using Ramer-Douglas-Peucker algorithm'
  asDownload = () => this.outputData

  createInputs() {
    return {
      feature: new GeoJsonField(),
      tolerance: new NumberField(0.01, { min: 0, softMax: 1, step: 0.01 }),
      highQuality: new BooleanField(false),
    }
  }

  createOutputs() {
    return {
      feature: new GeoJsonField(),
    }
  }

  execute({
    feature,
    tolerance,
    highQuality,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Apply Ramer-Douglas-Peucker simplification
    const simplified = turf.simplify(feature, {
      tolerance,
      highQuality,
      mutate: false, // Never mutate input to avoid side effects
    })

    return { feature: simplified }
  }
}

export class LineInterpolationOp extends Operator<LineInterpolationOp> {
  static displayName = 'Line Interpolation'
  static description =
    'Interpolate GeoJSON lines with D3 curves or round corners with a physical turn radius'
  asDownload = () => this.outputData

  createInputs() {
    return {
      feature: new GeoJsonField(),
      method: new StringLiteralField('catmull-rom', {
        values: [
          { value: 'linear', label: 'Linear' },
          { value: 'catmull-rom', label: 'Catmull–Rom' },
          { value: 'cardinal', label: 'Cardinal' },
          { value: 'basis', label: 'Basis' },
          { value: 'natural', label: 'Natural' },
          { value: 'monotone-x', label: 'Monotone X' },
          { value: 'monotone-y', label: 'Monotone Y' },
          { value: 'turn-radius', label: 'Turn radius' },
        ],
      }),
      samplesPerSegment: new NumberField(12, { min: 1, max: 64, step: 1 }),
      alpha: new NumberField(0.5, { min: 0, max: 1, step: 0.05, showByDefault: false }),
      tension: new NumberField(0, { min: 0, max: 1, step: 0.05, showByDefault: false }),
      turnRadiusMeters: new NumberField(250, {
        min: 0,
        softMax: 10_000,
        step: 10,
      }),
    }
  }

  createOutputs() {
    return { feature: new GeoJsonField() }
  }

  execute({
    feature,
    method,
    samplesPerSegment,
    alpha,
    tension,
    turnRadiusMeters,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return {
      feature: utils.interpolateGeoJsonLines(feature, {
        method: method as utils.LineInterpolationMethod,
        samplesPerSegment,
        alpha,
        tension,
        turnRadiusMeters,
      }),
    }
  }
}

export class SmoothOp extends Operator<SmoothOp> {
  static displayName = 'Smooth'
  static description = 'Apply smoothing to LineString coordinates using Gaussian or boxcar kernel'
  asDownload = () => this.outputData

  createInputs() {
    return {
      feature: new GeoJsonField(),
      windowSize: new NumberField(5, { min: 1, max: 100, step: 2 }),
      method: new StringLiteralField('gaussian', ['gaussian', 'boxcar']),
    }
  }

  createOutputs() {
    return {
      feature: new GeoJsonField(),
    }
  }

  execute({
    feature,
    windowSize,
    method,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Handle LineString
    if (feature.geometry.type === 'LineString') {
      if (feature.geometry.coordinates.length <= 1) {
        return { feature }
      }

      const smoothedCoords = this.smoothCoordinates(
        feature.geometry.coordinates,
        windowSize,
        method
      )
      return { feature: turf.lineString(smoothedCoords, feature.properties) }
    }

    // Handle MultiLineString
    if (feature.geometry.type === 'MultiLineString') {
      const smoothedLines = feature.geometry.coordinates.map(line =>
        this.smoothCoordinates(line, windowSize, method)
      )
      return { feature: turf.multiLineString(smoothedLines, feature.properties) }
    }

    // Pass through other geometry types unchanged
    return { feature }
  }

  private smoothCoordinates(
    coords: number[][],
    windowSize: number,
    method: 'boxcar' | 'gaussian'
  ): number[][] {
    const radius = Math.floor(windowSize / 2)
    const sigma = method === 'gaussian' ? windowSize / 6 : 0

    return coords.map((pt, i) => {
      let lonSum = 0
      let latSum = 0
      let weightSum = 0

      // Iterate over window centered on current point
      for (let j = i - radius; j <= i + radius; j++) {
        if (j < 0 || j >= coords.length) continue

        // Calculate weight based on smoothing method
        let weight: number
        if (method === 'gaussian') {
          const distance = Math.abs(j - i)
          weight = Math.exp(-0.5 * Math.pow(distance / sigma, 2))
        } else {
          weight = 1 // Boxcar: uniform weights
        }

        lonSum += coords[j][0] * weight
        latSum += coords[j][1] * weight
        weightSum += weight
      }

      // Return smoothed lon/lat plus preserved extra channels
      return [
        lonSum / weightSum,
        latSum / weightSum,
        ...pt.slice(2), // Preserve altitude, timestamps, etc.
      ]
    })
  }
}

// ==================== Core Layers (@deck.gl/layers) ====================

export class BitmapLayerOp extends Operator<BitmapLayerOp> {
  static displayName = 'BitmapLayer'
  static description = 'Render a raster image at specified boundaries'

  createInputs() {
    return {
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      image: new FileUrlField('', {
        accept: '.png,.jpg,.jpeg,.gif,.webp,.svg',
      }),
      bounds: new BboxField(
        { southwest: { lng: -122.5, lat: 37.7 }, northeast: { lng: -122.3, lat: 37.9 } },
        { returnType: 'tuple' }
      ),
      desaturate: new NumberField(0, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      transparentColor: new ColorField(null, {
        optional: true,
        transform: hexToColor,
        showByDefault: false,
      }),
      tintColor: new ColorField(null, {
        optional: true,
        transform: hexToColor,
        showByDefault: false,
      }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<BitmapLayerProps>(),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const { bounds, image, transparentColor, tintColor, ...restProps } = props
    let deckBounds: BitmapBoundingBox
    if (
      Array.isArray(bounds) &&
      bounds.length === 4 &&
      bounds.every((coordinate: unknown) => typeof coordinate === 'number')
    ) {
      // Preserve the flat format accepted by Deck.gl and older direct callers.
      deckBounds = [...bounds] as BitmapBoundingBox
    } else if (
      Array.isArray(bounds) &&
      bounds.length === 2 &&
      Array.isArray(bounds[0]) &&
      Array.isArray(bounds[1]) &&
      typeof bounds[0][0] === 'number' &&
      typeof bounds[0][1] === 'number' &&
      typeof bounds[1][0] === 'number' &&
      typeof bounds[1][1] === 'number'
    ) {
      // BboxField returns [southwest, northeast], while Deck.gl requires a flat bbox.
      deckBounds = [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]]
    } else {
      throw new Error(
        `[BitmapLayerOp] Invalid bounds format. Expected [minLng, minLat, maxLng, maxLat] or [[minLng, minLat], [maxLng, maxLat]], got: ${JSON.stringify(bounds)}`
      )
    }

    const layer = {
      ...parseLayerProps<BitmapLayerProps>({
        ...restProps,
        image,
        // Let Deck.gl apply its array-valued defaults. Passing null overrides those defaults
        // and crashes BitmapLayer.draw when it calls .map()/.slice() on the colors.
        ...(transparentColor ? { transparentColor } : {}),
        ...(tintColor ? { tintColor } : {}),
      }),
      bounds: deckBounds,
      type: 'BitmapLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class ColumnLayerOp extends Operator<ColumnLayerOp> {
  static displayName = 'ColumnLayer'
  static description = 'Render extruded cylinders (columns) at given positions'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      diskResolution: new NumberField(20, { min: 3, softMax: 100, showByDefault: false }),
      vertices: new UnknownField(null, { optional: true, showByDefault: false }),
      offset: new Vec3Field([0, 0, 0], { returnType: 'tuple', showByDefault: false }),
      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false, { showByDefault: false }),
      extruded: new BooleanField(true),
      wireframe: new BooleanField(false, { showByDefault: false }),
      flatShading: new BooleanField(false, { showByDefault: false }),
      radiusUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      lineWidthUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', {
        accessor: true,
        transform: hexToColor,
        showByDefault: false,
      }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true, showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ColumnLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ColumnLayerProps>(props),
      type: 'ColumnLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class GridCellLayerOp extends Operator<GridCellLayerOp> {
  static displayName = 'GridCellLayer'
  static description = 'Render a grid of cells at specified coordinates'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSize: new NumberField(1000, { min: 1, softMax: 100000 }),
      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      extruded: new BooleanField(true),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      wireframe: new BooleanField(false, { showByDefault: false }),
      flatShading: new BooleanField(false, { showByDefault: false }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<GridCellLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<GridCellLayerProps>(props),
      type: 'GridCellLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class LineLayerOp extends Operator<LineLayerOp> {
  static displayName = 'LineLayer'
  static description = 'Render straight lines between source and target coordinates'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      widthUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      widthScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      widthMinPixels: new NumberField(0, { min: 0, softMax: 100, showByDefault: false }),
      widthMaxPixels: new NumberField(100, { min: 0, softMax: 1000, showByDefault: false }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      getSourcePosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getTargetPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(1, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<LineLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<LineLayerProps>(props),
      type: 'LineLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class PointCloudLayerOp extends Operator<PointCloudLayerOp> {
  static displayName = 'PointCloudLayer'
  static description = 'Render a point cloud with millions of 3D points'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      sizeUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      pointSize: new NumberField(10, { min: 0, max: 100 }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getNormal: new Vec3Field([0, 0, 1], {
        returnType: 'tuple',
        accessor: true,
        showByDefault: false,
      }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<PointCloudLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<PointCloudLayerProps>(props),
      type: 'PointCloudLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class PolygonLayerOp extends Operator<PolygonLayerOp> {
  static displayName = 'PolygonLayer'
  static description = 'Render filled and/or stroked polygons'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(true),
      extruded: new BooleanField(false),
      wireframe: new BooleanField(false, { showByDefault: false }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      lineWidthUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      lineWidthScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      lineWidthMinPixels: new NumberField(0, { min: 0, softMax: 100, showByDefault: false }),
      lineWidthMaxPixels: new NumberField(100, { min: 0, softMax: 1000, showByDefault: false }),
      lineJointRounded: new BooleanField(false, { showByDefault: false }),
      lineMiterLimit: new NumberField(4, { min: 0, softMax: 10, showByDefault: false }),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      getPolygon: new UnknownField((d: unknown) => d?.polygon || [], { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<PolygonLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<PolygonLayerProps>(props),
      type: 'PolygonLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

// ==================== Aggregation Layers ====================

export class ContourLayerOp extends Operator<ContourLayerOp> {
  static displayName = 'ContourLayer'
  static description = 'Aggregate data and render contour lines or filled contour bands'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSize: new NumberField(1000, { min: 1, softMax: 100000 }),
      gpuAggregation: new BooleanField(true, { showByDefault: false }),
      aggregation: new StringLiteralField('SUM', { values: ['SUM', 'MEAN', 'MIN', 'MAX'] }),
      contours: new UnknownField([
        { threshold: 1, color: [255, 0, 0] },
        { threshold: 5, color: [0, 255, 0] },
        { threshold: 10, color: [0, 0, 255] },
      ]),
      zOffset: new NumberField(0.005, { min: 0, max: 1, step: 0.001, showByDefault: false }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getWeight: new NumberField(1, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ContourLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ContourLayerProps>(props),
      type: 'ContourLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class ScreenGridLayerOp extends Operator<ScreenGridLayerOp> {
  static displayName = 'ScreenGridLayer'
  static description = 'Aggregate data into a grid in screen space and visualize as a heatmap'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSizePixels: new NumberField(50, { min: 1, softMax: 1000 }),
      cellMarginPixels: new NumberField(2, { min: 0, softMax: 100, showByDefault: false }),
      colorRange: new UnknownField(DEFAULT_COLOR_RANGE, { optional: true }),
      colorDomain: new UnknownField(null, { optional: true, showByDefault: false }),
      aggregation: new StringLiteralField('SUM', { values: ['SUM', 'MEAN', 'MIN', 'MAX'] }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getWeight: new NumberField(1, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ScreenGridLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ScreenGridLayerProps>(props),
      type: 'ScreenGridLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

// ==================== Geo Layers ====================

export class GreatCircleLayerOp extends Operator<GreatCircleLayerOp> {
  static displayName = 'GreatCircleLayer'
  static description = 'Render great circle arcs between pairs of source and target coordinates'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      numSegments: new NumberField(20, { min: 1, softMax: 100, showByDefault: false }),
      widthUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      widthScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      widthMinPixels: new NumberField(0, { min: 0, softMax: 100, showByDefault: false }),
      widthMaxPixels: new NumberField(100, { min: 0, softMax: 1000, showByDefault: false }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      getSourcePosition: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
      getTargetPosition: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
      getSourceColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getTargetColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(1, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<GreatCircleLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<GreatCircleLayerProps>(props),
      type: 'GreatCircleLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class H3ClusterLayerOp extends Operator<H3ClusterLayerOp> {
  static displayName = 'H3ClusterLayer'
  static description = 'Render hexagons from H3 hexagon indices and cluster them by density'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getHexagons: new UnknownField((d: unknown) => d?.hexagons || [], { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<H3ClusterLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<H3ClusterLayerProps>(props),
      type: 'H3ClusterLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class GeohashLayerOp extends Operator<GeohashLayerOp> {
  static displayName = 'GeohashLayer'
  static description = 'Render filled and/or stroked polygons based on geohash strings'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getGeohash: new StringField('', { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<GeohashLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<GeohashLayerProps>(props),
      type: 'GeohashLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class S2LayerOp extends Operator<S2LayerOp> {
  static displayName = 'S2Layer'
  static description = 'Render filled and/or stroked polygons based on S2 tokens'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getS2Token: new StringField('', { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<S2LayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<S2LayerProps>(props),
      type: 'S2Layer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class QuadkeyLayerOp extends Operator<QuadkeyLayerOp> {
  static displayName = 'QuadkeyLayer'
  static description = 'Render filled and/or stroked polygons based on quadkey strings'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getQuadkey: new StringField('', { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<QuadkeyLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<QuadkeyLayerProps>(props),
      type: 'QuadkeyLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class MVTLayerOp extends Operator<MVTLayerOp> {
  static displayName = 'MVTLayer'
  static description = 'Render Mapbox Vector Tiles (MVT)'
  createInputs() {
    return {
      data: new StringField('https://example.com/tiles/{z}/{x}/{y}.mvt'),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      minZoom: new NumberField(0, { min: 0, max: 24 }),
      maxZoom: new NumberField(24, { min: 0, max: 24 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      lineWidthMinPixels: new NumberField(1, { min: 0, showByDefault: false }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getPointRadius: new NumberField(1, { accessor: true }),
      pointRadiusUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      autoLabels: new BooleanField(false, { optional: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<MVTLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<MVTLayerProps>(props),
      type: 'MVTLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

||||||| parent of 4322dbd7 (refactor: delete the operator-graph editor and executor)
export class RampOp extends Operator<RampOp> {
  static displayName = 'Ramp'
  static description = 'Map a position (0–1) to a value using a user-defined curve'

  createInputs() {
    return {
      // softMin/softMax suggests 0-1 in the UI without hard-clamping accessor functions
      position: new NumberField(0, { softMin: 0, softMax: 1, step: 0.01, accessor: true }),
      stops: new DataField(),
    }
  }

  createOutputs() {
    return {
      value: new NumberField(),
    }
  }

  execute({
    position,
    stops,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const rampStops: Array<{ pos: number; val: number; interp?: RampInterpType }> =
      !stops || (stops as unknown[]).length === 0
        ? [
            { pos: 0, val: 0, interp: 'smooth' as RampInterpType },
            { pos: 1, val: 1, interp: 'smooth' as RampInterpType },
          ]
        : [...(stops as Array<{ pos: number; val: number; interp?: RampInterpType }>)].sort(
            (a, b) => a.pos - b.pos
          )

    const value = composeAccessor(position, (p: number) => interpolateRamp(p, rampStops))
    return { value }
  }
}

export class RectangleOp extends Operator<RectangleOp> {
  static displayName = 'Rectangle'
  static description =
    'Generate a rectangle GeoJSON geometry from a center point and dimensions in kilometers'
  asDownload = () => this.outputData
  createInputs() {
    return {
      center: new Point2DField([DEFAULT_LONGITUDE, DEFAULT_LATITUDE], { returnType: 'object' }),
      altitude: new NumberField(0, { step: 0.1 }),
      width: new NumberField(10, { min: 0.001, softMax: 10000, step: 0.1 }),
      height: new NumberField(10, { min: 0.001, softMax: 10000, step: 0.1 }),
      properties: new DataField({}),
    }
  }
  createOutputs() {
    return {
      feature: new GeoJsonField(),
    }
  }
  execute({
    center,
    altitude,
    width,
    height,
    properties,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Calculate the distance in kilometers from center to each edge
    const halfWidth = width / 2
    const halfHeight = height / 2

    // Create a point at the center
    const centerPoint = turf.point([center.lng, center.lat])

    // Calculate corner points using turf.destination
    // bearing: 0=north, 90=east, 180=south, 270=west
    const topRight = turf.destination(centerPoint, halfWidth, 90)
    const topRightFinal = turf.destination(topRight, halfHeight, 0)

    const bottomRight = turf.destination(centerPoint, halfWidth, 90)
    const bottomRightFinal = turf.destination(bottomRight, halfHeight, 180)

    const bottomLeft = turf.destination(centerPoint, halfWidth, 270)
    const bottomLeftFinal = turf.destination(bottomLeft, halfHeight, 180)

    const topLeft = turf.destination(centerPoint, halfWidth, 270)
    const topLeftFinal = turf.destination(topLeft, halfHeight, 0)

    // Create a polygon from the corner coordinates
    const coordinates = [
      [
        topRightFinal.geometry.coordinates,
        bottomRightFinal.geometry.coordinates,
        bottomLeftFinal.geometry.coordinates,
        topLeftFinal.geometry.coordinates,
        topRightFinal.geometry.coordinates, // Close the polygon
      ],
    ]

    const polygon = turf.polygon(coordinates, { altitude, ...properties })

    return { feature: polygon }
  }
}

export class PointOp extends Operator<PointOp> {
  static displayName = 'Point'
  static description = 'Create a GeoJSON Point feature from coordinates'
  createInputs() {
    return {
      coordinates: new Point2DField(),
      properties: new DataField({}),
    }
  }
  createOutputs() {
    return {
      feature: new GeoJsonField(),
    }
  }
  execute({
    coordinates,
    properties,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const feature = turf.point(
      typeof coordinates === 'object' && 'lng' in coordinates
        ? [coordinates.lng, coordinates.lat]
        : coordinates,
      properties
    )
    return { feature }
  }
}

export class GeoJsonOp extends Operator<GeoJsonOp> {
  static displayName = 'GeoJson'
  static description = 'Create a GeoJSON FeatureCollection from a list of features'
  asDownload = () => this.outputData
  createInputs() {
    return {
      features: new ListField(new GeoJsonField()),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(),
    }
  }
  execute({ features }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const featureCollection = {
      type: 'FeatureCollection',
      features,
    }
    return { featureCollection }
  }
}

export class GeoEditorOp extends Operator<GeoEditorOp> {
  static displayName = 'GeoEditor'
  static description = 'Draw and edit GeoJSON geometry with a visual editor'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new CodeField(JSON.stringify({ type: 'FeatureCollection', features: [] }, null, 2), {
        language: 'json',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(),
    }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    try {
      const parsed = typeof geojson === 'string' ? JSON.parse(geojson) : geojson
      if (parsed.type === 'FeatureCollection') return { featureCollection: parsed }
      if (parsed.type === 'Feature')
        return { featureCollection: { type: 'FeatureCollection', features: [parsed] } }
      return {
        featureCollection: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: parsed, properties: {} }],
        },
      }
    } catch {
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    }
  }
}

export class GeoParquetOp extends Operator<GeoParquetOp> {
  static displayName = 'GeoParquet'
  static description =
    'Load a GeoParquet file and output GeoJSON FeatureCollection via DuckDB Spatial'
  asDownload = () => this.outputData
  createInputs() {
    return {
      url: new FileUrlField(),
      geometryColumn: new StringField('geometry'),
      limit: new NumberField(0, { min: 0, step: 1 }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(),
      data: new DataField(),
    }
  }
  async execute({
    url,
    geometryColumn,
    limit,
  }: ExtractProps<typeof this.inputs>): Promise<ExtractProps<typeof this.outputs>> {
    if (!url) return { featureCollection: { type: 'FeatureCollection', features: [] }, data: [] }
    const db = await duckDbInstance
    const conn = await db.connect()
    try {
      await conn.query('INSTALL spatial; LOAD spatial;')
      const limitClause = limit > 0 ? `LIMIT ${Math.floor(limit)}` : ''
      // Quote both interpolations so URLs and column names containing quotes stay literal
      const geomIdent = sqlIdentifier(geometryColumn)
      const result = await conn.query(
        `SELECT ST_AsGeoJSON(${geomIdent}) as geojson, * EXCLUDE(${geomIdent}) FROM read_parquet(${sqlLiteral(url)}) ${limitClause}`
      )
      const rows = result
        .toArray()
        .map((row: { toJSON: () => Record<string, unknown> }) => row.toJSON())
      const features = rows.map((row: Record<string, unknown>) => {
        const { geojson, ...properties } = row
        return {
          type: 'Feature',
          geometry: JSON.parse(geojson as string),
          properties,
        }
      })
      return {
        featureCollection: { type: 'FeatureCollection', features },
        data: rows,
      }
    } finally {
      await conn.close()
    }
  }
}

export class ShapefileOp extends Operator<ShapefileOp> {
  static displayName = 'Shapefile'
  static description = 'Load a Shapefile (.shp) and convert to GeoJSON'
  asDownload = () => this.outputData
  createInputs() {
    return {
      url: new FileUrlField(),
      encoding: new StringField('utf-8'),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(),
    }
  }
  async execute({
    url,
    encoding,
  }: ExtractProps<typeof this.inputs>): Promise<ExtractProps<typeof this.outputs>> {
    if (!url) return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const shapefile = await import('shapefile')
    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    const geojson = await shapefile.read(buffer, undefined, { encoding })
    return { featureCollection: geojson }
  }
}

export class PMTilesOp extends Operator<PMTilesOp> {
  static displayName = 'PMTiles'
  static description = 'Load a PMTiles archive as a MapLibre vector or raster source'
  createInputs() {
    return {
      url: new FileUrlField(),
      sourceLayer: new StringField(''),
      minZoom: new NumberField(0, { min: 0, max: 22 }),
      maxZoom: new NumberField(14, { min: 0, max: 22 }),
    }
  }
  createOutputs() {
    return {
      sourceConfig: new UnknownField(null),
    }
  }
  execute({
    url,
    sourceLayer,
    minZoom,
    maxZoom,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!url) return { sourceConfig: null }
    return {
      sourceConfig: {
        type: 'vector',
        url: `pmtiles://${url}`,
        minzoom: minZoom,
        maxzoom: maxZoom,
        ...(sourceLayer ? { sourceLayer } : {}),
      },
    }
  }
}

export class XYZTileOp extends Operator<XYZTileOp> {
  static displayName = 'XYZTile'
  static description = 'Configure a raster XYZ tile source from a URL template ({z}/{x}/{y})'
  createInputs() {
    return {
      url: new StringField('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
      subdomains: new StringField('abc'),
      tileSize: new NumberField(256, { min: 64, max: 1024, step: 64 }),
      minZoom: new NumberField(0, { min: 0, max: 22 }),
      maxZoom: new NumberField(19, { min: 0, max: 22 }),
      attribution: new StringField(''),
    }
  }
  createOutputs() {
    return {
      sourceConfig: new UnknownField(null),
    }
  }
  execute({
    url,
    subdomains,
    tileSize,
    minZoom,
    maxZoom,
    attribution,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!url) return { sourceConfig: null }
    const tiles = subdomains ? subdomains.split('').map(s => url.replace('{s}', s)) : [url]
    return {
      sourceConfig: {
        type: 'raster',
        tiles,
        tileSize,
        minzoom: minZoom,
        maxzoom: maxZoom,
        ...(attribution ? { attribution } : {}),
      },
    }
  }
}

// ==================== Geometry Operations ====================

export class BufferOp extends Operator<BufferOp> {
  static displayName = 'Buffer'
  static description = 'Create a buffer zone around input geometry at a given distance'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      radius: new NumberField(1, { min: 0, step: 0.1 }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
      }),
      steps: new NumberField(64, { min: 4, max: 256, step: 1, showByDefault: false }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    radius,
    units,
    steps,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const buffered = turf.buffer(geojson, radius, { units: units as 'kilometers', steps })
    return { featureCollection: buffered || { type: 'FeatureCollection', features: [] } }
  }
}

export class UnionOp extends Operator<UnionOp> {
  static displayName = 'Union'
  static description = 'Merge multiple polygons into a single combined polygon'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const polygons = geojson.features.filter(
      (f: { geometry: { type: string } }) =>
        f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
    )
    if (polygons.length === 0)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    let merged = polygons[0]
    for (let i = 1; i < polygons.length; i++) {
      merged = turf.union(turf.featureCollection([merged, polygons[i]])) || merged
    }
    return { featureCollection: { type: 'FeatureCollection', features: [merged] } }
  }
}

export class DifferenceOp extends Operator<DifferenceOp> {
  static displayName = 'Difference'
  static description = 'Subtract one polygon from another (A minus B)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      a: new GeoJsonField(),
      b: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ a, b }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!a?.features?.length || !b?.features?.length)
      return { featureCollection: a || { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const polyA = a.features[0]
    const polyB = b.features[0]
    const result = turf.difference(turf.featureCollection([polyA, polyB]))
    return { featureCollection: { type: 'FeatureCollection', features: result ? [result] : [] } }
  }
}

export class IntersectOp extends Operator<IntersectOp> {
  static displayName = 'Intersect'
  static description = 'Find the overlapping area between two polygons'
  asDownload = () => this.outputData
  createInputs() {
    return {
      a: new GeoJsonField(),
      b: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ a, b }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!a?.features?.length || !b?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const polyA = a.features[0]
    const polyB = b.features[0]
    const result = turf.intersect(turf.featureCollection([polyA, polyB]))
    return { featureCollection: { type: 'FeatureCollection', features: result ? [result] : [] } }
  }
}

export class CentroidOp extends Operator<CentroidOp> {
  static displayName = 'Centroid'
  static description = 'Calculate the centroid (center of mass) of each feature'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const centroids = geojson.features.map((f: GeoJSON.Feature) => {
      const c = turf.centroid(f)
      c.properties = { ...f.properties, ...c.properties }
      return c
    })
    return { featureCollection: { type: 'FeatureCollection', features: centroids } }
  }
}

export class ConvexHullOp extends Operator<ConvexHullOp> {
  static displayName = 'ConvexHull'
  static description = 'Calculate the convex hull (smallest enclosing polygon) of features'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const hull = turf.convex(geojson)
    return { featureCollection: { type: 'FeatureCollection', features: hull ? [hull] : [] } }
  }
}

export class VoronoiOp extends Operator<VoronoiOp> {
  static displayName = 'Voronoi'
  static description = 'Generate Voronoi polygons from a set of points'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const bbox = turf.bbox(geojson)
    const voronoi = turf.voronoi(geojson, { bbox })
    return { featureCollection: voronoi || { type: 'FeatureCollection', features: [] } }
  }
}

export class DissolveOp extends Operator<DissolveOp> {
  static displayName = 'Dissolve'
  static description = 'Dissolve polygons that share a common property value into single features'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      propertyName: new StringField(''),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    propertyName,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const dissolved = turf.dissolve(geojson, { propertyName: propertyName || undefined })
    return { featureCollection: dissolved }
  }
}

export class ClipOp extends Operator<ClipOp> {
  static displayName = 'Clip'
  static description = 'Clip features to a bounding polygon (mask)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      mask: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson, mask }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || !mask?.features?.length)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const maskPoly = mask.features[0]
    const clipped = geojson.features
      .map((f: GeoJSON.Feature) => {
        try {
          return turf.booleanWithin(f, maskPoly)
            ? f
            : turf.intersect(turf.featureCollection([f, maskPoly]))
        } catch {
          return null
        }
      })
      .filter(Boolean)
    return { featureCollection: { type: 'FeatureCollection', features: clipped } }
  }
}

// ==================== Spatial Analysis ====================

export class SpatialJoinOp extends Operator<SpatialJoinOp> {
  static displayName = 'SpatialJoin'
  static description = 'Join attributes from one layer to another based on spatial relationship'
  asDownload = () => this.outputData
  createInputs() {
    return {
      target: new GeoJsonField(),
      join: new GeoJsonField(),
      relationship: new StringLiteralField('within', {
        values: ['within', 'intersects', 'contains'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    target,
    join,
    relationship,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!target?.features?.length || !join?.features?.length)
      return { featureCollection: target || { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const check =
      relationship === 'within'
        ? turf.booleanWithin
        : relationship === 'contains'
          ? turf.booleanContains
          : turf.booleanIntersects
    const joined = target.features.map((targetFeat: GeoJSON.Feature) => {
      const matching = join.features.find((joinFeat: GeoJSON.Feature) => {
        try {
          return check(targetFeat, joinFeat)
        } catch {
          return false
        }
      })
      return {
        ...targetFeat,
        properties: { ...targetFeat.properties, ...(matching?.properties || {}) },
      }
    })
    return { featureCollection: { type: 'FeatureCollection', features: joined } }
  }
}

export class PointInPolygonOp extends Operator<PointInPolygonOp> {
  static displayName = 'PointInPolygon'
  static description = 'Filter points that fall within a polygon boundary'
  asDownload = () => this.outputData
  createInputs() {
    return {
      points: new GeoJsonField(),
      polygon: new GeoJsonField(),
      invert: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      inside: new GeoJsonField(),
      outside: new GeoJsonField(),
    }
  }
  execute({
    points,
    polygon,
    invert,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const empty = { type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] }
    if (!points?.features?.length || !polygon?.features?.length)
      return { inside: empty, outside: empty }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const poly = polygon.features[0]
    const inside: GeoJSON.Feature[] = []
    const outside: GeoJSON.Feature[] = []
    for (const pt of points.features) {
      if (pt.geometry.type !== 'Point') {
        outside.push(pt)
        continue
      }
      const isInside = turf.booleanPointInPolygon(pt, poly)
      if (isInside !== invert) inside.push(pt)
      else outside.push(pt)
    }
    return {
      inside: { type: 'FeatureCollection', features: inside },
      outside: { type: 'FeatureCollection', features: outside },
    }
  }
}

export class NearestPointOp extends Operator<NearestPointOp> {
  static displayName = 'NearestPoint'
  static description = 'Find the nearest point in a collection to a target point'
  asDownload = () => this.outputData
  createInputs() {
    return {
      targetPoint: new Point2DField([0, 0]),
      points: new GeoJsonField(),
    }
  }
  createOutputs() {
    return {
      nearest: new GeoJsonField(),
      distance: new NumberField(0),
    }
  }
  execute({
    targetPoint,
    points,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!points?.features?.length)
      return { nearest: { type: 'FeatureCollection', features: [] }, distance: 0 }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const target = turf.point(targetPoint)
    const nearest = turf.nearestPoint(target, points)
    const dist = nearest.properties?.distanceToPoint ?? 0
    return {
      nearest: { type: 'FeatureCollection', features: [nearest] },
      distance: dist as number,
    }
  }
}

export class AreaOp extends Operator<AreaOp> {
  static displayName = 'Area'
  static description = 'Calculate the area of polygon features in specified units'
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      units: new StringLiteralField('squareKilometers', {
        values: ['squareMeters', 'squareKilometers', 'squareMiles', 'acres', 'hectares'],
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(),
      totalArea: new NumberField(0),
    }
  }
  execute({ geojson, units }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] }, totalArea: 0 }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const conversions: Record<string, number> = {
      squareMeters: 1,
      squareKilometers: 1e-6,
      squareMiles: 3.861e-7,
      acres: 0.000247105,
      hectares: 0.0001,
    }
    const factor = conversions[units] || 1
    let total = 0
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      const areaM2 = turf.area(f)
      const area = areaM2 * factor
      total += area
      return { ...f, properties: { ...f.properties, area } }
    })
    return { featureCollection: { type: 'FeatureCollection', features }, totalArea: total }
  }
}

export class LengthOp extends Operator<LengthOp> {
  static displayName = 'Length'
  static description = 'Calculate the length of line features in specified units'
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'nauticalmiles'],
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(),
      totalLength: new NumberField(0),
    }
  }
  execute({ geojson, units }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] }, totalLength: 0 }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    let total = 0
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      const len = turf.length(f, { units: units as 'kilometers' })
      total += len
      return { ...f, properties: { ...f.properties, length: len } }
    })
    return { featureCollection: { type: 'FeatureCollection', features }, totalLength: total }
  }
}

export class ReprojectOp extends Operator<ReprojectOp> {
  static displayName = 'Reproject'
  static description = 'Transform coordinates between WGS84 and Web Mercator projections'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      from: new StringLiteralField('EPSG:4326', { values: ['EPSG:4326', 'EPSG:3857'] }),
      to: new StringLiteralField('EPSG:3857', { values: ['EPSG:4326', 'EPSG:3857'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    from,
    to,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || from === to)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const toMercator = (lng: number, lat: number): [number, number] => {
      const x = (lng * 20037508.34) / 180
      const y =
        ((Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * 20037508.34) / 180
      return [x, y]
    }
    const toWGS84 = (x: number, y: number): [number, number] => {
      const lng = (x * 180) / 20037508.34
      const lat = (Math.atan(Math.exp((y * Math.PI) / 20037508.34)) * 360) / Math.PI - 90
      return [lng, lat]
    }
    const transform = from === 'EPSG:4326' ? toMercator : toWGS84
    const transformCoords = (coords: unknown): unknown => {
      if (typeof coords[0] === 'number') return transform(coords[0] as number, coords[1] as number)
      return (coords as unknown[]).map(transformCoords)
    }
    const features = geojson.features.map((f: GeoJSON.Feature) => ({
      ...f,
      geometry: {
        ...f.geometry,
        coordinates: transformCoords((f.geometry as { coordinates: unknown }).coordinates),
      },
    }))
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class PointGridOp extends Operator<PointGridOp> {
  static displayName = 'PointGrid'
  static description = 'Generate a regular grid of points within a bounding box'
  asDownload = () => this.outputData
  createInputs() {
    return {
      bbox: new BboxField({
        southwest: { lng: -180, lat: -90 },
        northeast: { lng: 180, lat: 90 },
      }),
      cellSize: new NumberField(10, { min: 0.001, step: 1 }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    bbox,
    cellSize,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const turfBbox: [number, number, number, number] = [
      bbox.southwest.lng,
      bbox.southwest.lat,
      bbox.northeast.lng,
      bbox.northeast.lat,
    ]
    const grid = turf.pointGrid(turfBbox, cellSize, {
      units: units as 'kilometers',
    })
    return { featureCollection: grid }
  }
}

export class HexGridOp extends Operator<HexGridOp> {
  static displayName = 'HexGrid'
  static description = 'Generate a hexagonal grid within a bounding box'
  asDownload = () => this.outputData
  createInputs() {
    return {
      bbox: new BboxField({
        southwest: { lng: -180, lat: -90 },
        northeast: { lng: 180, lat: 90 },
      }),
      cellSize: new NumberField(10, { min: 0.001, step: 1 }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    bbox,
    cellSize,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const turfBbox: [number, number, number, number] = [
      bbox.southwest.lng,
      bbox.southwest.lat,
      bbox.northeast.lng,
      bbox.northeast.lat,
    ]
    const grid = turf.hexGrid(turfBbox, cellSize, {
      units: units as 'kilometers',
    })
    return { featureCollection: grid }
  }
}

export class SquareGridOp extends Operator<SquareGridOp> {
  static displayName = 'SquareGrid'
  static description = 'Generate a square grid within a bounding box'
  asDownload = () => this.outputData
  createInputs() {
    return {
      bbox: new BboxField({
        southwest: { lng: -180, lat: -90 },
        northeast: { lng: 180, lat: 90 },
      }),
      cellSize: new NumberField(10, { min: 0.001, step: 1 }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    bbox,
    cellSize,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const turfBbox: [number, number, number, number] = [
      bbox.southwest.lng,
      bbox.southwest.lat,
      bbox.northeast.lng,
      bbox.northeast.lat,
    ]
    const grid = turf.squareGrid(turfBbox, cellSize, {
      units: units as 'kilometers',
    })
    return { featureCollection: grid }
  }
}

export class TinOp extends Operator<TinOp> {
  static displayName = 'Tin'
  static description = 'Generate a Triangulated Irregular Network (TIN) from points'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      zProperty: new StringField(''),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    zProperty,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const tin = turf.tin(geojson, zProperty || undefined)
    return { featureCollection: tin }
  }
}

export class IsolineOp extends Operator<IsolineOp> {
  static displayName = 'Isoline'
  static description = 'Generate isolines (contour lines) from point data with Z values'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      zProperty: new StringField('elevation'),
      breaks: new UnknownField([100, 200, 500, 1000, 2000]),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    zProperty,
    breaks,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const isolines = turf.isolines(geojson, breaks as number[], { zProperty })
    return { featureCollection: isolines }
  }
}

export class LineToPolygonOp extends Operator<LineToPolygonOp> {
  static displayName = 'LineToPolygon'
  static description = 'Convert closed LineString features to Polygon features'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
        try {
          return turf.lineToPolygon(f)
        } catch {
          return f
        }
      }
      return f
    })
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class PolygonToLineOp extends Operator<PolygonToLineOp> {
  static displayName = 'PolygonToLine'
  static description = 'Convert Polygon features to LineString features (extract boundaries)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
        return turf.polygonToLine(f)
      }
      return f
    })
    const flat = features.flat ? features.flat() : features
    return { featureCollection: { type: 'FeatureCollection', features: flat } }
  }
}

export class ExplodeOp extends Operator<ExplodeOp> {
  static displayName = 'Explode'
  static description =
    'Break multi-part geometries into individual features, or extract all vertices as points'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      mode: new StringLiteralField('vertices', { values: ['vertices', 'parts'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({ geojson, mode }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    if (mode === 'vertices') {
      const exploded = turf.explode(geojson)
      return { featureCollection: exploded }
    }
    const parts = turf.flatten(geojson)
    return { featureCollection: parts }
  }
}

export class AggregateOp extends Operator<AggregateOp> {
  static displayName = 'Aggregate'
  static description = 'Aggregate point data into polygons (count, sum, mean, min, max per zone)'
  createInputs() {
    return {
      polygons: new GeoJsonField(),
      points: new GeoJsonField(),
      field: new StringField(''),
      operation: new StringLiteralField('count', {
        values: ['count', 'sum', 'mean', 'min', 'max'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    polygons,
    points,
    field,
    operation,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!polygons?.features?.length || !points?.features?.length)
      return { featureCollection: polygons || { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const features = polygons.features.map((poly: GeoJSON.Feature) => {
      const inside = points.features.filter((pt: GeoJSON.Feature) => {
        try {
          return pt.geometry.type === 'Point' && turf.booleanPointInPolygon(pt, poly)
        } catch {
          return false
        }
      })
      let value: number
      if (operation === 'count') {
        value = inside.length
      } else {
        const values = inside
          .map((p: GeoJSON.Feature) => Number(p.properties?.[field]))
          .filter((v: number) => !Number.isNaN(v))
        if (values.length === 0) value = 0
        else if (operation === 'sum') value = values.reduce((a: number, b: number) => a + b, 0)
        else if (operation === 'mean')
          value = values.reduce((a: number, b: number) => a + b, 0) / values.length
        else if (operation === 'min') value = Math.min(...values)
        else value = Math.max(...values)
      }
      return {
        ...poly,
        properties: { ...poly.properties, [`${operation}_${field || 'points'}`]: value },
      }
    })
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class KMeansClusterOp extends Operator<KMeansClusterOp> {
  static displayName = 'KMeansCluster'
  static description = 'Cluster points into k groups using k-means algorithm'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      numberOfClusters: new NumberField(5, { min: 2, max: 100, step: 1 }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    numberOfClusters,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const clustered = turf.clustersKmeans(geojson, { numberOfClusters })
    return { featureCollection: clustered }
  }
}

export class DBScanClusterOp extends Operator<DBScanClusterOp> {
  static displayName = 'DBScanCluster'
  static description = 'Cluster points using DBSCAN density-based algorithm'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      maxDistance: new NumberField(1, { min: 0, step: 0.1 }),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
      minPoints: new NumberField(3, { min: 1, step: 1 }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    maxDistance,
    units,
    minPoints,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const clustered = turf.clustersDbscan(geojson, maxDistance, {
      units: units as 'kilometers',
      minPoints,
    })
    return { featureCollection: clustered }
  }
}

export class InterpolateOp extends Operator<InterpolateOp> {
  static displayName = 'Interpolate'
  static description = 'Interpolate scattered point data to a regular grid (IDW)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      cellSize: new NumberField(1, { min: 0.01, step: 0.1 }),
      property: new StringField('value'),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
      weight: new NumberField(2, { min: 0.1, max: 10, step: 0.1, showByDefault: false }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    cellSize,
    property,
    units,
    weight,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const interpolated = turf.interpolate(geojson, cellSize, {
      gridType: 'point',
      property,
      units: units as 'kilometers',
      weight,
    })
    return { featureCollection: interpolated }
  }
}

export class AlongOp extends Operator<AlongOp> {
  static displayName = 'Along'
  static description = 'Find a point at a specified distance along a line'
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      distance: new NumberField(1, { min: 0, step: 0.1 }),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    distance,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const features = geojson.features
      .filter((f: GeoJSON.Feature) => f.geometry.type === 'LineString')
      .map((f: GeoJSON.Feature) =>
        turf.along(f as GeoJSON.Feature<GeoJSON.LineString>, distance, {
          units: units as 'kilometers',
        })
      )
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class LineSliceOp extends Operator<LineSliceOp> {
  static displayName = 'LineSlice'
  static description = 'Extract a segment of a line between two distances along it'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      startDistance: new NumberField(0, { min: 0, step: 0.1 }),
      stopDistance: new NumberField(1, { min: 0, step: 0.1 }),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    startDistance,
    stopDistance,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length)
      return { featureCollection: { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const features = geojson.features
      .filter((f: GeoJSON.Feature) => f.geometry.type === 'LineString')
      .map((f: GeoJSON.Feature) => {
        const start = turf.along(f as GeoJSON.Feature<GeoJSON.LineString>, startDistance, {
          units: units as 'kilometers',
        })
        const stop = turf.along(f as GeoJSON.Feature<GeoJSON.LineString>, stopDistance, {
          units: units as 'kilometers',
        })
        return turf.lineSlice(start, stop, f as GeoJSON.Feature<GeoJSON.LineString>)
      })
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class TransformRotateOp extends Operator<TransformRotateOp> {
  static displayName = 'TransformRotate'
  static description = 'Rotate features by an angle around a pivot point'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      angle: new NumberField(0, { min: -360, max: 360, step: 1 }),
      pivot: new StringLiteralField('centroid', { values: ['centroid', 'center'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    angle,
    pivot,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || angle === 0)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const features = geojson.features.map((f: GeoJSON.Feature) => {
      const pivotPt = pivot === 'centroid' ? turf.centroid(f) : turf.center(f)
      return turf.transformRotate(f, angle, { pivot: pivotPt })
    })
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class TransformScaleOp extends Operator<TransformScaleOp> {
  static displayName = 'TransformScale'
  static description = 'Scale features by a factor around their center'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      factor: new NumberField(1, { min: 0.01, max: 100, step: 0.1 }),
      origin: new StringLiteralField('centroid', {
        values: ['centroid', 'center', 'sw', 'se', 'nw', 'ne'],
      }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    factor,
    origin,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || factor === 1)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const features = geojson.features.map((f: GeoJSON.Feature) =>
      turf.transformScale(f, factor, { origin: origin as 'centroid' })
    )
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class TransformTranslateOp extends Operator<TransformTranslateOp> {
  static displayName = 'TransformTranslate'
  static description = 'Move features by a distance in a direction'
  asDownload = () => this.outputData
  createInputs() {
    return {
      geojson: new GeoJsonField(),
      distance: new NumberField(0, { min: 0, step: 0.1 }),
      direction: new NumberField(0, { min: 0, max: 360, step: 1 }),
      units: new StringLiteralField('kilometers', { values: ['kilometers', 'miles', 'meters'] }),
    }
  }
  createOutputs() {
    return { featureCollection: new GeoJsonField() }
  }
  execute({
    geojson,
    distance,
    direction,
    units,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!geojson?.features?.length || distance === 0)
      return { featureCollection: geojson || { type: 'FeatureCollection', features: [] } }
    const turf = (globalThis as unknown as Record<string, unknown>)
      .turf as typeof import('@turf/turf')
    const features = geojson.features.map((f: GeoJSON.Feature) =>
      turf.transformTranslate(f, distance, direction, { units: units as 'kilometers' })
    )
    return { featureCollection: { type: 'FeatureCollection', features } }
  }
}

export class KmlToGeoJsonOp extends Operator<KmlToGeoJsonOp> {
  static displayName = 'KmlToGeoJson'
  static description = 'Convert KML string to GeoJSON FeatureCollection'
  asDownload = () => this.outputData
  createInputs() {
    return {
      kml: new CodeField('', { language: 'xml' }),
    }
  }
  createOutputs() {
    return {
      geojson: new DataField(),
    }
  }
  async execute({ kml }: ExtractProps<typeof this.inputs>) {
    const geojson = await utils.kmlToGeoJson(kml)
    return { geojson }
  }
}

export class GeoJsonTransformOp extends Operator<GeoJsonTransformOp> {
  static displayName = 'GeoJsonTransform'
  static description = 'Transform a GeoJSON feature with scale, translate, and rotate operations'
  asDownload = () => this.outputData
  createInputs() {
    return {
      feature: new GeoJsonField(),
      scale: new NumberField(1, { min: 0.001, softMax: 100, step: 0.1 }),
      translateX: new NumberField(0, { softMin: -10000, softMax: 10000, step: 0.1 }),
      translateY: new NumberField(0, { softMin: -10000, softMax: 10000, step: 0.1 }),
      rotate: new NumberField(0, { softMin: -360, softMax: 360, step: 1 }),
    }
  }
  createOutputs() {
    return {
      feature: new GeoJsonField(),
    }
  }
  execute({
    feature,
    scale,
    translateX,
    translateY,
    rotate,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    let transformed = feature

    // Get centroid of ORIGINAL feature to use as pivot for all transformations
    const centroid = turf.centroid(feature)
    const origin = centroid.geometry.coordinates as [number, number]

    // Apply rotation first (around original centroid)
    if (rotate !== 0) {
      transformed = turf.transformRotate(transformed, rotate, { pivot: origin })
    }

    // Apply scale second (around original centroid)
    if (scale !== 1) {
      transformed = turf.transformScale(transformed, scale, { origin })
    }

    // Apply translation last (after rotation and scale)
    if (translateX !== 0 || translateY !== 0) {
      const distance = Math.sqrt(translateX * translateX + translateY * translateY)
      const direction = (Math.atan2(translateX, translateY) * 180) / Math.PI
      transformed = turf.transformTranslate(transformed, distance, direction)
    }

    return { feature: transformed }
  }
}

export class SimplifyOp extends Operator<SimplifyOp> {
  static displayName = 'Simplify'
  static description = 'Simplify GeoJSON geometries using Ramer-Douglas-Peucker algorithm'
  asDownload = () => this.outputData

  createInputs() {
    return {
      feature: new GeoJsonField(),
      tolerance: new NumberField(0.01, { min: 0, softMax: 1, step: 0.01 }),
      highQuality: new BooleanField(false),
    }
  }

  createOutputs() {
    return {
      feature: new GeoJsonField(),
    }
  }

  execute({
    feature,
    tolerance,
    highQuality,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Apply Ramer-Douglas-Peucker simplification
    const simplified = turf.simplify(feature, {
      tolerance,
      highQuality,
      mutate: false, // Never mutate input to avoid side effects
    })

    return { feature: simplified }
  }
}

export class LineInterpolationOp extends Operator<LineInterpolationOp> {
  static displayName = 'Line Interpolation'
  static description =
    'Interpolate GeoJSON lines with D3 curves or round corners with a physical turn radius'
  asDownload = () => this.outputData

  createInputs() {
    return {
      feature: new GeoJsonField(),
      method: new StringLiteralField('catmull-rom', {
        values: [
          { value: 'linear', label: 'Linear' },
          { value: 'catmull-rom', label: 'Catmull–Rom' },
          { value: 'cardinal', label: 'Cardinal' },
          { value: 'basis', label: 'Basis' },
          { value: 'natural', label: 'Natural' },
          { value: 'monotone-x', label: 'Monotone X' },
          { value: 'monotone-y', label: 'Monotone Y' },
          { value: 'turn-radius', label: 'Turn radius' },
        ],
      }),
      samplesPerSegment: new NumberField(12, { min: 1, max: 64, step: 1 }),
      alpha: new NumberField(0.5, { min: 0, max: 1, step: 0.05, showByDefault: false }),
      tension: new NumberField(0, { min: 0, max: 1, step: 0.05, showByDefault: false }),
      turnRadiusMeters: new NumberField(250, {
        min: 0,
        softMax: 10_000,
        step: 10,
      }),
    }
  }

  createOutputs() {
    return { feature: new GeoJsonField() }
  }

  execute({
    feature,
    method,
    samplesPerSegment,
    alpha,
    tension,
    turnRadiusMeters,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return {
      feature: utils.interpolateGeoJsonLines(feature, {
        method: method as utils.LineInterpolationMethod,
        samplesPerSegment,
        alpha,
        tension,
        turnRadiusMeters,
      }),
    }
  }
}

export class SmoothOp extends Operator<SmoothOp> {
  static displayName = 'Smooth'
  static description = 'Apply smoothing to LineString coordinates using Gaussian or boxcar kernel'
  asDownload = () => this.outputData

  createInputs() {
    return {
      feature: new GeoJsonField(),
      windowSize: new NumberField(5, { min: 1, max: 100, step: 2 }),
      method: new StringLiteralField('gaussian', ['gaussian', 'boxcar']),
    }
  }

  createOutputs() {
    return {
      feature: new GeoJsonField(),
    }
  }

  execute({
    feature,
    windowSize,
    method,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Handle LineString
    if (feature.geometry.type === 'LineString') {
      if (feature.geometry.coordinates.length <= 1) {
        return { feature }
      }

      const smoothedCoords = this.smoothCoordinates(
        feature.geometry.coordinates,
        windowSize,
        method
      )
      return { feature: turf.lineString(smoothedCoords, feature.properties) }
    }

    // Handle MultiLineString
    if (feature.geometry.type === 'MultiLineString') {
      const smoothedLines = feature.geometry.coordinates.map(line =>
        this.smoothCoordinates(line, windowSize, method)
      )
      return { feature: turf.multiLineString(smoothedLines, feature.properties) }
    }

    // Pass through other geometry types unchanged
    return { feature }
  }

  private smoothCoordinates(
    coords: number[][],
    windowSize: number,
    method: 'boxcar' | 'gaussian'
  ): number[][] {
    const radius = Math.floor(windowSize / 2)
    const sigma = method === 'gaussian' ? windowSize / 6 : 0

    return coords.map((pt, i) => {
      let lonSum = 0
      let latSum = 0
      let weightSum = 0

      // Iterate over window centered on current point
      for (let j = i - radius; j <= i + radius; j++) {
        if (j < 0 || j >= coords.length) continue

        // Calculate weight based on smoothing method
        let weight: number
        if (method === 'gaussian') {
          const distance = Math.abs(j - i)
          weight = Math.exp(-0.5 * Math.pow(distance / sigma, 2))
        } else {
          weight = 1 // Boxcar: uniform weights
        }

        lonSum += coords[j][0] * weight
        latSum += coords[j][1] * weight
        weightSum += weight
      }

      // Return smoothed lon/lat plus preserved extra channels
      return [
        lonSum / weightSum,
        latSum / weightSum,
        ...pt.slice(2), // Preserve altitude, timestamps, etc.
      ]
    })
  }
}

// ==================== Core Layers (@deck.gl/layers) ====================

export class BitmapLayerOp extends Operator<BitmapLayerOp> {
  static displayName = 'BitmapLayer'
  static description = 'Render a raster image at specified boundaries'

  createInputs() {
    return {
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      image: new FileUrlField('', {
        accept: '.png,.jpg,.jpeg,.gif,.webp,.svg',
      }),
      bounds: new BboxField(
        { southwest: { lng: -122.5, lat: 37.7 }, northeast: { lng: -122.3, lat: 37.9 } },
        { returnType: 'tuple' }
      ),
      desaturate: new NumberField(0, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      transparentColor: new ColorField(null, {
        optional: true,
        transform: hexToColor,
        showByDefault: false,
      }),
      tintColor: new ColorField(null, {
        optional: true,
        transform: hexToColor,
        showByDefault: false,
      }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<BitmapLayerProps>(),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const { bounds, image, transparentColor, tintColor, ...restProps } = props
    let deckBounds: BitmapBoundingBox
    if (
      Array.isArray(bounds) &&
      bounds.length === 4 &&
      bounds.every((coordinate: unknown) => typeof coordinate === 'number')
    ) {
      // Preserve the flat format accepted by Deck.gl and older direct callers.
      deckBounds = [...bounds] as BitmapBoundingBox
    } else if (
      Array.isArray(bounds) &&
      bounds.length === 2 &&
      Array.isArray(bounds[0]) &&
      Array.isArray(bounds[1]) &&
      typeof bounds[0][0] === 'number' &&
      typeof bounds[0][1] === 'number' &&
      typeof bounds[1][0] === 'number' &&
      typeof bounds[1][1] === 'number'
    ) {
      // BboxField returns [southwest, northeast], while Deck.gl requires a flat bbox.
      deckBounds = [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]]
    } else {
      throw new Error(
        `[BitmapLayerOp] Invalid bounds format. Expected [minLng, minLat, maxLng, maxLat] or [[minLng, minLat], [maxLng, maxLat]], got: ${JSON.stringify(bounds)}`
      )
    }

    const layer = {
      ...parseLayerProps<BitmapLayerProps>({
        ...restProps,
        image,
        // Let Deck.gl apply its array-valued defaults. Passing null overrides those defaults
        // and crashes BitmapLayer.draw when it calls .map()/.slice() on the colors.
        ...(transparentColor ? { transparentColor } : {}),
        ...(tintColor ? { tintColor } : {}),
      }),
      bounds: deckBounds,
      type: 'BitmapLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class ColumnLayerOp extends Operator<ColumnLayerOp> {
  static displayName = 'ColumnLayer'
  static description = 'Render extruded cylinders (columns) at given positions'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      diskResolution: new NumberField(20, { min: 3, softMax: 100, showByDefault: false }),
      vertices: new UnknownField(null, { optional: true, showByDefault: false }),
      offset: new Vec3Field([0, 0, 0], { returnType: 'tuple', showByDefault: false }),
      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false, { showByDefault: false }),
      extruded: new BooleanField(true),
      wireframe: new BooleanField(false, { showByDefault: false }),
      flatShading: new BooleanField(false, { showByDefault: false }),
      radiusUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      lineWidthUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', {
        accessor: true,
        transform: hexToColor,
        showByDefault: false,
      }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true, showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ColumnLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ColumnLayerProps>(props),
      type: 'ColumnLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class GridCellLayerOp extends Operator<GridCellLayerOp> {
  static displayName = 'GridCellLayer'
  static description = 'Render a grid of cells at specified coordinates'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSize: new NumberField(1000, { min: 1, softMax: 100000 }),
      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      extruded: new BooleanField(true),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      wireframe: new BooleanField(false, { showByDefault: false }),
      flatShading: new BooleanField(false, { showByDefault: false }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<GridCellLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<GridCellLayerProps>(props),
      type: 'GridCellLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class LineLayerOp extends Operator<LineLayerOp> {
  static displayName = 'LineLayer'
  static description = 'Render straight lines between source and target coordinates'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      widthUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      widthScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      widthMinPixels: new NumberField(0, { min: 0, softMax: 100, showByDefault: false }),
      widthMaxPixels: new NumberField(100, { min: 0, softMax: 1000, showByDefault: false }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      getSourcePosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getTargetPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(1, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<LineLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<LineLayerProps>(props),
      type: 'LineLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class PointCloudLayerOp extends Operator<PointCloudLayerOp> {
  static displayName = 'PointCloudLayer'
  static description = 'Render a point cloud with millions of 3D points'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      sizeUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      pointSize: new NumberField(10, { min: 0, max: 100 }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getNormal: new Vec3Field([0, 0, 1], {
        returnType: 'tuple',
        accessor: true,
        showByDefault: false,
      }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<PointCloudLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<PointCloudLayerProps>(props),
      type: 'PointCloudLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class PolygonLayerOp extends Operator<PolygonLayerOp> {
  static displayName = 'PolygonLayer'
  static description = 'Render filled and/or stroked polygons'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(true),
      extruded: new BooleanField(false),
      wireframe: new BooleanField(false, { showByDefault: false }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      lineWidthUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      lineWidthScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      lineWidthMinPixels: new NumberField(0, { min: 0, softMax: 100, showByDefault: false }),
      lineWidthMaxPixels: new NumberField(100, { min: 0, softMax: 1000, showByDefault: false }),
      lineJointRounded: new BooleanField(false, { showByDefault: false }),
      lineMiterLimit: new NumberField(4, { min: 0, softMax: 10, showByDefault: false }),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      getPolygon: new UnknownField((d: unknown) => d?.polygon || [], { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<PolygonLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<PolygonLayerProps>(props),
      type: 'PolygonLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

// ==================== Aggregation Layers ====================

export class ContourLayerOp extends Operator<ContourLayerOp> {
  static displayName = 'ContourLayer'
  static description = 'Aggregate data and render contour lines or filled contour bands'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSize: new NumberField(1000, { min: 1, softMax: 100000 }),
      gpuAggregation: new BooleanField(true, { showByDefault: false }),
      aggregation: new StringLiteralField('SUM', { values: ['SUM', 'MEAN', 'MIN', 'MAX'] }),
      contours: new UnknownField([
        { threshold: 1, color: [255, 0, 0] },
        { threshold: 5, color: [0, 255, 0] },
        { threshold: 10, color: [0, 0, 255] },
      ]),
      zOffset: new NumberField(0.005, { min: 0, max: 1, step: 0.001, showByDefault: false }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getWeight: new NumberField(1, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ContourLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ContourLayerProps>(props),
      type: 'ContourLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class ScreenGridLayerOp extends Operator<ScreenGridLayerOp> {
  static displayName = 'ScreenGridLayer'
  static description = 'Aggregate data into a grid in screen space and visualize as a heatmap'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSizePixels: new NumberField(50, { min: 1, softMax: 1000 }),
      cellMarginPixels: new NumberField(2, { min: 0, softMax: 100, showByDefault: false }),
      colorRange: new UnknownField(DEFAULT_COLOR_RANGE, { optional: true }),
      colorDomain: new UnknownField(null, { optional: true, showByDefault: false }),
      aggregation: new StringLiteralField('SUM', { values: ['SUM', 'MEAN', 'MIN', 'MAX'] }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getWeight: new NumberField(1, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ScreenGridLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ScreenGridLayerProps>(props),
      type: 'ScreenGridLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

// ==================== Geo Layers ====================

export class GreatCircleLayerOp extends Operator<GreatCircleLayerOp> {
  static displayName = 'GreatCircleLayer'
  static description = 'Render great circle arcs between pairs of source and target coordinates'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      numSegments: new NumberField(20, { min: 1, softMax: 100, showByDefault: false }),
      widthUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      widthScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      widthMinPixels: new NumberField(0, { min: 0, softMax: 100, showByDefault: false }),
      widthMaxPixels: new NumberField(100, { min: 0, softMax: 1000, showByDefault: false }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      getSourcePosition: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
      getTargetPosition: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
      getSourceColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getTargetColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(1, { min: 0, accessor: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<GreatCircleLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<GreatCircleLayerProps>(props),
      type: 'GreatCircleLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class H3ClusterLayerOp extends Operator<H3ClusterLayerOp> {
  static displayName = 'H3ClusterLayer'
  static description = 'Render hexagons from H3 hexagon indices and cluster them by density'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getHexagons: new UnknownField((d: unknown) => d?.hexagons || [], { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<H3ClusterLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<H3ClusterLayerProps>(props),
      type: 'H3ClusterLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class GeohashLayerOp extends Operator<GeohashLayerOp> {
  static displayName = 'GeohashLayer'
  static description = 'Render filled and/or stroked polygons based on geohash strings'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getGeohash: new StringField('', { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<GeohashLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<GeohashLayerProps>(props),
      type: 'GeohashLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class S2LayerOp extends Operator<S2LayerOp> {
  static displayName = 'S2Layer'
  static description = 'Render filled and/or stroked polygons based on S2 tokens'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getS2Token: new StringField('', { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<S2LayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<S2LayerProps>(props),
      type: 'S2Layer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class QuadkeyLayerOp extends Operator<QuadkeyLayerOp> {
  static displayName = 'QuadkeyLayer'
  static description = 'Render filled and/or stroked polygons based on quadkey strings'
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getQuadkey: new StringField('', { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<QuadkeyLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<QuadkeyLayerProps>(props),
      type: 'QuadkeyLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class MVTLayerOp extends Operator<MVTLayerOp> {
  static displayName = 'MVTLayer'
  static description = 'Render Mapbox Vector Tiles (MVT)'
  createInputs() {
    return {
      data: new StringField('https://example.com/tiles/{z}/{x}/{y}.mvt'),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      minZoom: new NumberField(0, { min: 0, max: 24 }),
      maxZoom: new NumberField(24, { min: 0, max: 24 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      lineWidthMinPixels: new NumberField(1, { min: 0, showByDefault: false }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getPointRadius: new NumberField(1, { accessor: true }),
      pointRadiusUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      autoLabels: new BooleanField(false, { optional: true }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<MVTLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<MVTLayerProps>(props),
      type: 'MVTLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

=======
export class TerrainLayerOp extends Operator<TerrainLayerOp> {
  static displayName = 'TerrainLayer'
  static description = 'Render a terrain mesh from heightmap tiles'
  createInputs() {
    return {
      elevationData: new StringField('https://example.com/elevation/{z}/{x}/{y}.png'),
      texture: new StringField('', { optional: true }),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      meshMaxError: new NumberField(4, { min: 0, softMax: 100, showByDefault: false }),
      elevationDecoder: new CompoundPropsField({
        rScaler: new NumberField(1),
        gScaler: new NumberField(0),
        bScaler: new NumberField(0),
        offset: new NumberField(0),
      }),
      bounds: new BboxField(null, { optional: true, returnType: 'tuple' }),
      color: new ColorField('#ffffff', { transform: hexToColor }),
      wireframe: new BooleanField(false, { showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<TerrainLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<TerrainLayerProps>(props),
      type: 'TerrainLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class TileLayerOp extends Operator<TileLayerOp> {
  static displayName = 'TileLayer'
  static description = 'Render data organized in a tiled format (generic tile layer)'
  createInputs() {
    return {
      data: new StringField('https://example.com/tiles/{z}/{x}/{y}'),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      minZoom: new NumberField(0, { min: 0, max: 24 }),
      maxZoom: new NumberField(24, { min: 0, max: 24 }),
      tileSize: new NumberField(256, { min: 1, softMax: 1024, showByDefault: false }),
      maxCacheSize: new NumberField(Infinity, { optional: true, showByDefault: false }),
      maxCacheByteSize: new NumberField(Infinity, { optional: true, showByDefault: false }),
      refinementStrategy: new StringLiteralField('best-available', {
        values: ['best-available', 'no-overlap', 'never'],
        showByDefault: false,
      }),
      zRange: new UnknownField([0, 24], { optional: true, showByDefault: false }),
      extent: new UnknownField([-Infinity, -Infinity, Infinity, Infinity], {
        optional: true,
        showByDefault: false,
      }),
      renderSubLayers: new FunctionField(null, { optional: true, showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<TileLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<TileLayerProps>(props),
      type: 'TileLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

// ==================== Extensions ====================
// TODO: Refactor extensions to return POJOs instead of class instances.
// This would allow for cleaner serialization and avoid passing extension constructor
// props through the layer props system. See PR #71 discussion.

export class ClipExtensionOp extends Operator<ClipExtensionOp> {
  static displayName = 'ClipExtension'
  static description = 'Clip layers by a rectangular bounds'
  createInputs() {
    return {
      clipByInstance: new BooleanField(false),
      clipBounds: new UnknownField([0, 0, 1, 1]), // [minX, minY, maxX, maxY]
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute({
    clipByInstance,
    clipBounds,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'ClipExtension', clipByInstance },
      props: { clipBounds },
    }
    return { extension }
  }
}

export class FillStyleExtensionOp extends Operator<FillStyleExtensionOp> {
  static displayName = 'FillStyleExtension'
  static description = 'Add patterns and styles to polygon fills'
  createInputs() {
    return {
      fillPatternEnabled: new BooleanField(true),
      proceduralPattern: new BooleanField(false, { showByDefault: false }),
      fillPatternMask: new BooleanField(true),
      fillPatternSizeUnits: new StringLiteralField('meters', ['pixels', 'meters', 'common']),
      fillPatternAtlas: new StringField('', { optional: true }),
      fillPatternMapping: new UnknownField(null, { optional: true }),
      getFillPattern: new UnknownField(null, { accessor: true }),
      getFillPatternScale: new NumberField(1, { accessor: true }),
      getFillPatternOffset: new Vec2Field([0, 0], { returnType: 'tuple', accessor: true }),
      getFillPatternBackgroundColor: new ColorField('#00000000', {
        accessor: true,
        transform: hexToColor,
        showByDefault: false,
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute({
    fillPatternEnabled,
    proceduralPattern,
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: {
        type: 'FillStyleExtension',
        pattern: fillPatternEnabled,
        proceduralPattern,
      },
      props,
    }
    return { extension }
  }
}

type TimeSeriesDataPoint = {
  time: number
  [key: string]: number
}

// Interpolate time series data at a given time using linear interpolation
function interpolateTimeSeries(
  timeSeries: TimeSeriesDataPoint[],
  currentTime: number
): Record<string, number> {
  if (!timeSeries || timeSeries.length === 0) {
    return { time: currentTime }
  }

  // If only one data point, return it
  if (timeSeries.length === 1) {
    return { ...timeSeries[0] }
  }

  // If currentTime is before first point, return first point
  if (currentTime <= timeSeries[0].time) {
    return { ...timeSeries[0] }
  }

  // If currentTime is after last point, return last point
  if (currentTime >= timeSeries[timeSeries.length - 1].time) {
    return { ...timeSeries[timeSeries.length - 1] }
  }

  // Binary search to find the two points to interpolate between
  let left = 0
  let right = timeSeries.length - 1

  while (left < right - 1) {
    const mid = Math.floor((left + right) / 2)
    if (timeSeries[mid].time <= currentTime) {
      left = mid
    } else {
      right = mid
    }
  }

  const before = timeSeries[left]
  const after = timeSeries[right]

  // Calculate interpolation factor (0 to 1)
  const timeDelta = after.time - before.time
  const factor = timeDelta === 0 ? 0 : (currentTime - before.time) / timeDelta

  // Interpolate all numeric fields. before and after always share the same
  // keys within a timeSeries, so iterating before's keys is sufficient.
  const result: Record<string, number> = {}
  for (const key of Object.keys(before)) {
    const beforeVal = before[key] ?? 0
    const afterVal = after[key] ?? 0
    result[key] = beforeVal + (afterVal - beforeVal) * factor
  }

  return result
}

export const opTypes = {
  BezierCurveOp,
  BoundingBoxOp,
  BrushingExtensionOp,
  ChartOp,
  ChoroplethJoinOp,
  ChoroplethLayerOp,
  ClipExtensionOp,
  CodeOp,
  CustomMapLibreLayerOp,
  DirectionsOp,
  FileOp,
  FillStyleExtensionOp,
  GeocoderOp,
  LayerPropsOp,
  MapStyleConfiguratorOp,
  MergeOp,
  MouseOp,
  PathStyleExtensionOp,
  TerrainLayerOp,
  TileLayerOp,
} as const // as Record<OpType, typeof Operator>

// Execution state for visual debugging
export type ExecutionState =
  | {
      status: 'idle'
    }
  | {
      status: 'executing'
    }
  | {
      status: 'success'
      lastExecuted: number
      executionTime: number
    }
  | {
      status: 'error'
      lastExecuted?: number
      executionTime?: number
      error?: string
    }

export type OpType = keyof typeof opTypes

export type SpecialNodeType = 'group'

// Allow `op('num).par.foo` to be used in code blocks
function proxyFields(op: Operator<IOperator>, fields: 'inputs' | 'outputs') {
  return new Proxy(op, {
    get(target, prop: string | symbol) {
      // Proxy is used for convenient field access (e.g. `op('/x').par.foo`).
      // Missing or symbol keys should behave like normal JS property access
      // and return undefined rather than throwing on `.value`.
      if (typeof prop !== 'string') {
        return undefined
      }

      const field = target[fields][prop]
      return field?.value
    },
    set(_target, _prop: string | symbol, _value) {
      throw new Error('Cannot set value on par or out')
    },
  }) as unknown as (typeof op)[typeof fields]
}

// For convenience in code / expression blocks
export const freeExports = {
  utils,
  d3,
  turf,
  deck,
  Plot,
  Temporal,
  // studio,
  ...opTypes,
}
