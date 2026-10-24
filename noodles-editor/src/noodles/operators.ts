import { extname } from 'node:path'
import type {
  ContourLayerProps,
  GridLayerProps,
  HeatmapLayerProps,
  HexagonLayerProps,
  ScreenGridLayerProps,
} from '@deck.gl/aggregation-layers'
import { type LayerExtension, type LayerProps, WebMercatorViewport } from '@deck.gl/core'
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
import { BehaviorSubject, combineLatest, Subject, type Subscription } from 'rxjs'
import { distinctUntilChanged, filter, mergeMap, skip } from 'rxjs/operators'
import { Temporal } from 'temporal-polyfill'
import z from 'zod/v4'

import './utils/bigint-fix' // BigInt JSON polyfill for DuckDB
import { getRenderSurfaceSize } from '../render/render-surface-size'
import { getTransformScaleFactor } from '../render/transform-scale'
import { duckDbInstance } from '../runtime/duckdb'
import { subscribeToPosition } from '../timeline/timeline-store'
import * as utils from '../utils'
import { analytics } from '../utils/analytics'
import { getArc } from '../utils/arc-geometry'
import { colorToHex, hexToColor } from '../utils/color'
// Side-effect import: registers the field expression evaluator so { $expr } payloads
// applied in the Operator constructor evaluate immediately
import { interpolateRamp, type RampInterpType } from '../utils/curves'
import { debugDirty, debugDirtyTrace, debugExecute, debugParams, debugPull } from '../utils/debug'
import { getDirections } from '../utils/directions'
import { geocodeWithMapbox } from '../utils/geocoding'
import {
  applyStyleOverrides,
  type MaplibreStyle,
  type StyleConfiguratorData,
} from '../utils/map-style-utils'
import { CARTO_DARK } from '../utils/map-styles'
import { osmToGeoJson } from '../utils/osm-to-geojson'
import { mulberry32 } from '../utils/random'
import { sqlIdentifier, sqlLiteral } from '../utils/sql'
import {
  categoricalSchemesFixed,
  categoricalSchemesStepped,
  continuousInterpolators,
} from './color-schemes'
import { FilterColorExtension } from './extensions/filter-color-extension'
import { Mask3DExtension } from './extensions/mask-3d-extension'
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
import { deepEqual } from './utils/deep-equal'
import type { ExtractProps } from './utils/extract-props'
import { projectScheme } from './utils/filesystem'
import type { OpId } from './utils/id-utils'
import { isDirectChild } from './utils/path-utils'
import { pick } from './utils/pick'
import { getTimelineContext } from './utils/timeline-context'
import { subscribeOpToTimeline, unsubscribeOpFromTimeline } from './utils/timeline-dependencies'
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

const GEOJSON_COORDINATE_GEOMETRIES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
])

const isPlainObject = (val: unknown): val is Record<string, unknown> =>
  typeof val === 'object' && val !== null && !Array.isArray(val)

// Checks the members each type requires, but not every position, so large inputs stay cheap
function isGeoJsonGeometry(val: unknown): val is GeoJSON.Geometry {
  if (!isPlainObject(val)) return false
  if (val.type === 'GeometryCollection') {
    return Array.isArray(val.geometries) && val.geometries.every(isGeoJsonGeometry)
  }
  return GEOJSON_COORDINATE_GEOMETRIES.has(val.type as string) && Array.isArray(val.coordinates)
}

function isGeoJsonFeature(val: unknown): val is GeoJSON.Feature {
  return (
    isPlainObject(val) &&
    val.type === 'Feature' &&
    (val.geometry === null || isGeoJsonGeometry(val.geometry))
  )
}

function isGeoJson(val: unknown): val is GeoJSON.GeoJSON {
  if (isPlainObject(val) && val.type === 'FeatureCollection') {
    return Array.isArray(val.features) && val.features.every(isGeoJsonFeature)
  }
  return isGeoJsonFeature(val) || isGeoJsonGeometry(val)
}

const geoJsonSchema = z.custom<GeoJSON.GeoJSON>(isGeoJson)

// Widen a field's schema to also accept `other`, keeping the union in the field's type.
// The field keeps its class, so its handle and editor UI are unchanged.
function orSchema<F extends { schema: z.ZodType }, O extends z.ZodType>(
  field: F,
  other: O
): Field<z.ZodUnion<[F['schema'], O]>> {
  const widened = field as unknown as Field<z.ZodUnion<[F['schema'], O]>>
  widened.schema = z.union([field.schema, other])
  return widened
}

// The southwest and northeast corners of a GeoJSON object's bounds. Empty when it has
// no coordinates (turf returns Infinity bounds for an empty FeatureCollection).
function geoJsonBoundsCorners(geojson: GeoJSON.GeoJSON): { lng: number; lat: number }[] {
  const [west, south, east, north] = turf.bbox(geojson)
  if (![west, south, east, north].every(Number.isFinite)) return []
  return [
    { lng: west, lat: south },
    { lng: east, lat: north },
  ]
}

export class BoundingBoxOp extends Operator<BoundingBoxOp> {
  static displayName = 'BoundingBox'
  static description =
    'Calculate the geographic bounds of your points (with lat/lng keys) or GeoJSON and get a camera position (center, zoom) that fits them all in view.'
  asDownload = () => this.outputData

  // The fit depends on the render surface, not just inputs: the host runner reruns it when
  // the surface resizes
  static readsRenderSurface = true

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

type LayerExtensionFieldReturnValue = null | {
  extension: LayerExtension
  props: Record<string, LayerPropsValue>
}

// Deck layers can have extensions that are passed in as props, but the props to the extensions are not
// passed to the extension constructor, but rather to the root props on the layer.
// Extensions are kept as POJOs here and will be instantiated later in the pipeline (in noodles.tsx).
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
