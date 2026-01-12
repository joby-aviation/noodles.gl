import { extname } from 'node:path'
import type {
  ContourLayerProps,
  GridLayerProps,
  HeatmapLayerProps,
  HexagonLayerProps,
  ScreenGridLayerProps,
} from '@deck.gl/aggregation-layers'
import {
  type DeckProps,
  FirstPersonView,
  _GlobeView as GlobeView,
  type LayerExtension,
  type LayerProps,
  MapView,
  OrbitView,
  OrthographicView,
  WebMercatorViewport,
} from '@deck.gl/core'
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
import { CesiumIonLoader, Tiles3DLoader } from '@loaders.gl/3d-tiles'
import { OBJLoader } from '@loaders.gl/obj'
import { PLYLoader } from '@loaders.gl/ply'
import type { Tileset3D } from '@loaders.gl/tiles'
import { brightnessContrast, hueSaturation, vibrance } from '@luma.gl/effects'
import { fitBounds } from '@math.gl/web-mercator'
import * as Plot from '@observablehq/plot'
import { onChange } from '@theatre/core'
import * as turf from '@turf/turf'
import * as d3 from 'd3'
import {
  csv,
  csvParse,
  type DSVRowArray,
  color as d3Color,
  hsl,
  interpolate,
  interpolateBlues,
  interpolateBuGn,
  interpolateBuPu,
  interpolateCividis,
  interpolateCool,
  interpolateCubehelixDefault,
  interpolateGnBu,
  interpolateGreens,
  interpolateGreys,
  interpolateInferno,
  interpolateMagma,
  interpolateOranges,
  interpolateOrRd,
  interpolatePiYG,
  interpolatePlasma,
  interpolatePuOr,
  interpolatePurples,
  interpolateRainbow,
  interpolateRdBu,
  interpolateRdGy,
  interpolateRdYlBu,
  interpolateReds,
  interpolateSinebow,
  interpolateSpectral,
  interpolateTurbo,
  interpolateViridis,
  interpolateWarm,
  scaleLinear,
  scaleOrdinal,
  schemeAccent,
  schemeBrBG,
  schemeCategory10,
  schemeDark2,
  schemePaired,
  schemePiYG,
  schemePRGn,
  schemePuBu,
  schemeRdBu,
  schemeRdGy,
  schemeRdYlBu,
  schemeRdYlGn,
  schemeSet1,
  schemeSet2,
  schemeSet3,
  schemeSpectral,
  schemeTableau10,
  schemeYlGn,
} from 'd3'
import * as deck from 'deck.gl'
import { BehaviorSubject, combineLatest, type Subscription } from 'rxjs'
import { debounceTime, filter, mergeMap } from 'rxjs/operators'
import { Temporal } from 'temporal-polyfill'
import vega from 'vega-embed'
import type z from 'zod/v4'

import './utils/bigint-fix' // BigInt JSON polyfill for DuckDB
import * as duckdb from '@duckdb/duckdb-wasm'
import { getTransformScaleFactor } from '../render/transform-scale'
import * as utils from '../utils'
import { getArc } from '../utils/arc-geometry'
import { colorToHex, hexToColor } from '../utils/color'
import { getDirections } from '../utils/directions'
import { CARTO_DARK, MAP_STYLES } from '../utils/map-styles'
import { mulberry32 } from '../utils/random'
import { FilterColorExtension } from './extensions/filter-color-extension'
import { Mask3DExtension } from './extensions/mask-3d-extension'
import {
  ArrayField,
  BezierCurveField,
  BooleanField,
  CategoricalColorRampField,
  CodeField,
  ColorField,
  ColorRampField,
  CompoundPropsField,
  DataField,
  DateField,
  EffectField,
  ExpressionField,
  ExtensionField,
  type Field,
  type FieldReference,
  FileField,
  FunctionField,
  GeoJsonField,
  IN_NS,
  type InOut,
  JSONUrlField,
  LayerField,
  ListField,
  mustacheRe,
  NumberField,
  OUT_NS,
  Point2DField,
  Point3DField,
  StringField,
  StringLiteralField,
  UnknownField,
  Vec2Field,
  Vec3Field,
  ViewField,
  VisualizationField,
  WidgetField,
} from './fields'
import { DEFAULT_LATITUDE, DEFAULT_LONGITUDE, safeMode } from './globals'
import { getAllOps, getOp, hasOp } from './store'
import type { ExtensionConstructorArgs, LayerPropsValue } from './types'
import { composeAccessor, isAccessor } from './utils/accessor-helpers'
import type { ExtractProps } from './utils/extract-props'
import { projectScheme } from './utils/filesystem'
import type { OpId } from './utils/id-utils'
import { isDirectChild } from './utils/path-utils'
import { pick } from './utils/pick'
import { validateViewState } from './utils/viewstate-helpers'

// https://stackoverflow.com/questions/66044717/typescript-infer-type-of-abstract-methods-implementation
export interface IOperator {
  createInputs(): Record<string, Field<z.ZodType>>
  createOutputs(): Record<string, Field<z.ZodType>>
}

// Pull-based execution status
export enum PullExecutionStatus {
  CLEAN = 'clean', // Valid cached output
  DIRTY = 'dirty', // Needs re-execution
  COMPUTING = 'computing', // Currently executing
  ERROR = 'error', // Execution failed
}

// An Operator is a collection of Fields, and a transform function responsible
// for taking in a set of input fields and mapping them to the output.
export abstract class Operator<OP extends IOperator> {
  static displayName = 'Operator'
  static description = ''

  inputs: ReturnType<OP['createInputs']>
  outputs: ReturnType<OP['createOutputs']>

  par = proxyFields(this, 'inputs')

  out = proxyFields(this, 'outputs')

  // If the operator allows its data to be downloaded, override this method
  asDownload?: () => Blob | string | ArrayBuffer

  // Should the execute function be memoized? Ops that store state elsewhere might not want to be cached.
  static cacheable = true
  public containerId?: string

  abstract createInputs(): ReturnType<OP['createInputs']>
  abstract createOutputs(): ReturnType<OP['createOutputs']>
  abstract execute(
    props: ExtractProps<(typeof this)['inputs']>
  ): ExtractProps<(typeof this)['outputs']> | Promise<ExtractProps<(typeof this)['outputs']>> | null

  subs: Subscription[] = []

  locked = new BehaviorSubject<boolean>(false)

  // Execution state for visual debugging
  executionState = new BehaviorSubject<ExecutionState>({ status: 'idle' })

  // Connection errors - tracks errors from incompatible connections
  // Map of edgeId -> error message
  connectionErrors = new BehaviorSubject<Map<string, string>>(new Map())

  // Dirty flag for GraphExecutor
  dirty = true

  // === Pull-based execution additions ===
  // Execution status for pull-based model
  private _pullExecutionStatus: PullExecutionStatus = PullExecutionStatus.DIRTY
  private _cachedOutput: ExtractProps<(typeof this)['outputs']> | null = null
  private _lastExecutionTime = 0
  private _computingPromise: Promise<ExtractProps<(typeof this)['outputs']>> | null = null

  // Dependency tracking for pull-based model
  private _upstreamDependencies: Set<Operator<IOperator>> = new Set()
  private _downstreamDependents: Set<Operator<IOperator>> = new Set()

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
          const field = this.inputs[key]
          const parsed = field.constructor.deserialize(value)
          field.setValue(parsed)
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

  // === Pull-based execution methods ===

  // Pull data from this operator, executing if needed (pull-based model)
  async pull(): Promise<ExtractProps<(typeof this)['outputs']>> {
    // Return cached if clean
    if (this._pullExecutionStatus === PullExecutionStatus.CLEAN && this._cachedOutput !== null) {
      return this._cachedOutput
    }

    // Wait for ongoing computation
    if (
      this._pullExecutionStatus === PullExecutionStatus.COMPUTING &&
      this._computingPromise !== null
    ) {
      return this._computingPromise
    }

    // Handle error state
    if (this._pullExecutionStatus === PullExecutionStatus.ERROR) {
      throw new Error(`Operator ${this.id} is in error state`)
    }

    // Mark as computing
    this._pullExecutionStatus = PullExecutionStatus.COMPUTING

    // Create computation promise
    this._computingPromise = this._pullExecution()

    try {
      const result = await this._computingPromise
      return result
    } finally {
      this._computingPromise = null
    }
  }

  // Internal pull execution logic
  private async _pullExecution(): Promise<ExtractProps<(typeof this)['outputs']>> {
    const startTime = performance.now()

    try {
      // Pull upstream dependencies first
      await this._pullUpstreamDependencies()

      // Get current input values
      const inputValues = this.data

      // Set executing state for UI
      this.executionState.next({ status: 'executing' })

      // Execute the operator
      const result = this.execute(inputValues)
      const finalResult = result instanceof Promise ? await result : result

      if (finalResult === null) {
        throw new Error(`Operator ${this.id} returned null`)
      }

      // Cache result and mark clean
      this._cachedOutput = finalResult
      this._pullExecutionStatus = PullExecutionStatus.CLEAN
      this.dirty = false // Also clear the dirty flag for GraphExecutor
      this._lastExecutionTime = performance.now() - startTime

      // Update execution state for UI
      this.executionState.next({
        status: 'success',
        lastExecuted: new Date(),
        executionTime: this._lastExecutionTime,
      })

      // Update output fields for UI/debugging purposes only
      // In pull mode, this is not for propagation but for inspection
      for (const [key, field] of Object.entries(this.outputs)) {
        if (field.value !== finalResult[key]) {
          field.next(finalResult[key])
        }
      }

      return finalResult
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn(
        `Pull execution failure in [${this.id} (${(this.constructor as typeof Operator).displayName})]:`,
        error.message
      )

      this._pullExecutionStatus = PullExecutionStatus.ERROR
      this._cachedOutput = null

      // Update execution state for UI
      this.executionState.next({
        status: 'error',
        lastExecuted: new Date(),
        executionTime: performance.now() - startTime,
        error: error.message,
      })

      this.onError(error)
      throw error
    }
  }

  // Pull all upstream dependencies
  private async _pullUpstreamDependencies(): Promise<void> {
    const promises: Promise<unknown>[] = []

    for (const dep of this._upstreamDependencies) {
      promises.push(dep.pull())
    }

    await Promise.all(promises)
    // Field connections will have updated the values already via subscriptions
  }

  // Mark this operator as dirty and propagate downstream
  markDirty(): void {
    if (this._pullExecutionStatus === PullExecutionStatus.DIRTY) {
      return // Already dirty
    }

    this._pullExecutionStatus = PullExecutionStatus.DIRTY
    this._cachedOutput = null
    this.dirty = true // Also set the dirty flag for GraphExecutor

    // Propagate dirty flag to downstream dependents
    for (const dependent of this._downstreamDependents) {
      dependent.markDirty()
    }
  }

  // Add upstream dependency (for pull-based model)
  addUpstreamDependency(op: Operator<IOperator>): void {
    this._upstreamDependencies.add(op)
  }

  // Add downstream dependent (for pull-based model)
  addDownstreamDependent(op: Operator<IOperator>): void {
    this._downstreamDependents.add(op)
  }

  // Remove upstream dependency (for pull-based model)
  removeUpstreamDependency(op: Operator<IOperator>): void {
    this._upstreamDependencies.delete(op)
  }

  // Remove downstream dependent (for pull-based model)
  removeDownstreamDependent(op: Operator<IOperator>): void {
    this._downstreamDependents.delete(op)
  }

  // Get pull execution status
  get pullExecutionStatus(): PullExecutionStatus {
    return this._pullExecutionStatus
  }

  // Get cached output (for debugging)
  get cachedOutput(): ExtractProps<(typeof this)['outputs']> | null {
    return this._cachedOutput
  }

  // Needs to be called after sub-classes have created their inputs and outputs
  createListeners() {
    const sub = combineLatest(this.inputs)
      .pipe(
        // Don't set if node is locked
        filter(() => !safeMode && !this.locked.value),
        mergeMap(async (inputValues: ExtractProps<(typeof this)['inputs']>) => {
          const startTime = performance.now()

          // Set executing state
          this.executionState.next({ status: 'executing' })

          try {
            const result = this.execute(inputValues)
            const finalResult = result instanceof Promise ? await result : result

            // Set success state
            const executionTime = performance.now() - startTime
            this.executionState.next({
              status: 'success',
              lastExecuted: new Date(),
              executionTime,
            })

            return finalResult
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err))
            console.warn(
              `Failure in [${this.id} (${(this.constructor as typeof Operator).displayName})]:`,
              error.message,
              error.stack
            )
            this.onError(error)

            // Set error state
            const executionTime = performance.now() - startTime
            this.executionState.next({
              status: 'error',
              lastExecuted: new Date(),
              executionTime,
              error: error.message,
            })

            return null
          }
        }),
        filter(result => result !== null)
      )
      .subscribe(outputValues => {
        for (const [key, field] of Object.entries(this.outputs)) {
          if (field.value !== outputValues[key]) {
            // Skip schema validation on outputs
            field.next(outputValues[key])
          }
        }
      })

    this.subs.push(sub)
  }

  unsubscribeListeners() {
    for (const sub of this.subs) {
      sub.unsubscribe()
    }
  }

  dispose() {
    this.unsubscribeListeners()
    this.executionState.complete()
  }
}

export class NumberOp extends Operator<NumberOp> {
  static displayName = 'Number'
  static description = 'A number'
  public createInputs() {
    return {
      val: new NumberField(0, { step: 1 }),
    }
  }
  public createOutputs() {
    return {
      val: new NumberField(),
    }
  }
  execute({ val }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { val }
  }
}

export class MapRangeOp extends Operator<MapRangeOp> {
  static displayName = 'MapRange'
  static description =
    'Remap a number from one range to another (e.g., map 0-100 to 0-1, or temperature to color intensity)'
  public createInputs() {
    return {
      val: new NumberField(0, { step: 0.01, accessor: true }),
      inMin: new NumberField(0, { step: 0.1 }),
      inMax: new NumberField(1, { step: 0.1 }),
      outMin: new NumberField(0, { step: 0.1 }),
      outMax: new NumberField(1, { step: 0.1 }),
    }
  }
  public createOutputs() {
    return {
      scaled: new NumberField(),
    }
  }
  execute({
    val,
    inMin,
    inMax,
    outMin,
    outMax,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const scale = scaleLinear().domain([inMin, inMax]).range([outMin, outMax])
    // Use composeAccessor helper to handle both static values and accessor functions
    const scaled = composeAccessor(val, (v: number) => scale(v))
    return { scaled }
  }
}

export class ExtentOp extends Operator<ExtentOp> {
  static displayName = 'Extent'
  static description =
    'Find the minimum and maximum values in your data (e.g., to set color scale ranges or determine data bounds)'
  createInputs() {
    return {
      data: new DataField(),
      accessor: new UnknownField((d: unknown) => d, { accessor: true, optional: true }),
    }
  }
  createOutputs() {
    return {
      min: new NumberField(),
      max: new NumberField(),
      extent: new Vec2Field(),
    }
  }
  execute({ data, accessor }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Use d3.extent with the accessor function if provided
    const accessorFn = typeof accessor === 'function' ? accessor : undefined
    const extent = d3.extent(data, accessorFn as (d: unknown) => number | undefined)

    const min = extent[0] ?? 0
    const max = extent[1] ?? 0

    return {
      min,
      max,
      extent: { x: min, y: max },
    }
  }
}

export class SelectOp extends Operator<SelectOp> {
  static displayName = 'Select'
  static description =
    'Select an element from an array using an index (clamped to array bounds by default, or wrapped around array bounds)'
  createInputs() {
    return {
      data: new DataField(),
      index: new NumberField(0, { step: 1 }),
      wrap: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      value: new UnknownField(undefined),
    }
  }
  execute({
    data,
    index,
    wrap,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!Array.isArray(data) || data.length === 0) {
      return { value: undefined }
    }

    let finalIndex: number
    if (wrap) {
      // Use modulo to wrap index around array bounds
      finalIndex = ((Math.floor(index) % data.length) + data.length) % data.length
    } else {
      // Clamp index to array bounds
      finalIndex = Math.max(0, Math.min(Math.floor(index), data.length - 1))
    }

    return {
      value: data[finalIndex],
    }
  }
}

// Allow adding a "virtual" operator from the Add Node menu that wraps the Math operator with a specific operation
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

export class MathOp extends Operator<MathOp> {
  static displayName = 'Math'
  static description = 'Perform a mathematical operation'
  public createInputs() {
    return {
      operator: new StringLiteralField('add', {
        values: [
          'add',
          'subtract',
          'multiply',
          'divide',
          'sine',
          'cosine',
          'tan',
          'min',
          'max',
          'modulo',
          'power',
          'log',
          'sqrt',
          'round',
          'floor',
          'ceil',
          'abs',
          'rad',
          'deg',
        ],
      }),
      a: new NumberField(0, { step: 1, accessor: true }),
      b: new NumberField(0, { step: 1, accessor: true }),
    }
  }
  createOutputs() {
    return {
      result: new NumberField(),
    }
  }
  execute({ operator, a, b }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Determine if operation is unary or binary
    const unaryOperators = new Set([
      'sine',
      'cosine',
      'tan',
      'log',
      'sqrt',
      'round',
      'floor',
      'ceil',
      'abs',
      'rad',
      'deg',
    ])
    const isUnary = unaryOperators.has(operator)

    // Define the transformation function
    const transform = (aVal: number, bVal: number) => {
      switch (operator) {
        case 'add':
          return aVal + bVal
        case 'subtract':
          return aVal - bVal
        case 'multiply':
          return aVal * bVal
        case 'divide':
          return aVal / bVal
        case 'sine':
          return Math.sin(aVal)
        case 'cosine':
          return Math.cos(aVal)
        case 'tan':
          return Math.tan(aVal)
        case 'min':
          return Math.min(aVal, bVal)
        case 'max':
          return Math.max(aVal, bVal)
        case 'modulo':
          return aVal % bVal
        case 'power':
          return Math.pow(aVal, bVal)
        case 'log':
          return Math.log(aVal)
        case 'sqrt':
          return Math.sqrt(aVal)
        case 'round':
          return Math.round(aVal)
        case 'floor':
          return Math.floor(aVal)
        case 'ceil':
          return Math.ceil(aVal)
        case 'abs':
          return Math.abs(aVal)
        case 'rad':
          return aVal * (Math.PI / 180)
        case 'deg':
          return aVal * (180 / Math.PI)
        default:
          throw new Error(`Unknown operator: ${operator}`)
      }
    }

    // Handle accessor composition
    const aIsAccessor = isAccessor(a)
    const bIsAccessor = isAccessor(b)

    if (isUnary) {
      // Unary operation - only use 'a'
      const result = composeAccessor(a, (aVal: number) => transform(aVal, 0))
      return { result }
    }

    // Binary operation - handle both a and b
    if (!aIsAccessor && !bIsAccessor) {
      // Both static values
      return { result: transform(a as number, b as number) }
    }

    if (aIsAccessor && bIsAccessor) {
      // Both are accessors
      const result = (...args: unknown[]) => {
        const aVal = (a as (...args: unknown[]) => number)(...args)
        const bVal = (b as (...args: unknown[]) => number)(...args)
        return transform(aVal, bVal)
      }
      return { result }
    }

    // One is accessor, one is static
    const result = (...args: unknown[]) => {
      const aVal = aIsAccessor ? (a as (...args: unknown[]) => number)(...args) : (a as number)
      const bVal = bIsAccessor ? (b as (...args: unknown[]) => number)(...args) : (b as number)
      return transform(aVal, bVal)
    }
    return { result }
  }
}

export class StringOp extends Operator<StringOp> {
  static displayName = 'String'
  static description = 'A string'
  createInputs() {
    return {
      val: new StringField(''),
    }
  }
  createOutputs() {
    return {
      val: new StringField(),
    }
  }
  execute({ val }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { val }
  }
}

export class BooleanOp extends Operator<BooleanOp> {
  static displayName = 'Boolean'
  static description = 'A boolean'
  createInputs() {
    return {
      val: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      val: new BooleanField(),
    }
  }
  execute({ val }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { val } as ExtractProps<typeof this.outputs>
  }
}

export class DateTimeOp extends Operator<DateTimeOp> {
  static displayName = 'DateTime'
  static description = 'A date and time'
  createInputs() {
    return {
      date: new DateField(),
    }
  }
  createOutputs() {
    return {
      date: new DateField(),
    }
  }
  execute({ date }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { date }
  }
}

export class CombineXYOp extends Operator<CombineXYOp> {
  static displayName = 'CombineXY'
  static description = 'Combine x and y into a 2D vector'
  createInputs() {
    return {
      x: new NumberField(0, { step: 0.01, accessor: true }),
      y: new NumberField(0, { step: 0.01, accessor: true }),
    }
  }
  createOutputs() {
    return {
      xy: new Vec2Field(),
    }
  }
  execute({ x, y }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Check if any inputs are accessor functions
    const xIsAccessor = isAccessor(x)
    const yIsAccessor = isAccessor(y)

    if (!xIsAccessor && !yIsAccessor) {
      // Both static values
      return { xy: { x: x as number, y: y as number } }
    }

    // At least one is an accessor - return accessor function
    const xy = (...args: unknown[]) => {
      const xVal = xIsAccessor ? (x as (...args: unknown[]) => unknown)(...args) : (x as number)
      const yVal = yIsAccessor ? (y as (...args: unknown[]) => unknown)(...args) : (y as number)
      return { x: xVal, y: yVal }
    }
    return { xy }
  }
}

export class CombineXYZOp extends Operator<CombineXYZOp> {
  static displayName = 'CombineXYZ'
  static description = 'Combine x, y, and z into a 3D vector'
  createInputs() {
    return {
      x: new NumberField(0, { step: 0.01, accessor: true }),
      y: new NumberField(0, { step: 0.01, accessor: true }),
      z: new NumberField(0, { step: 0.01, accessor: true }),
    }
  }
  createOutputs() {
    return {
      xyz: new Vec3Field(),
    }
  }
  execute({ x, y, z }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Check if any inputs are accessor functions
    const xIsAccessor = isAccessor(x)
    const yIsAccessor = isAccessor(y)
    const zIsAccessor = isAccessor(z)

    if (!xIsAccessor && !yIsAccessor && !zIsAccessor) {
      // All static values
      return { xyz: { x: x as number, y: y as number, z: z as number } }
    }

    // At least one is an accessor - return accessor function
    const xyz = (...args: unknown[]) => {
      const xVal = xIsAccessor ? (x as (...args: unknown[]) => unknown)(...args) : (x as number)
      const yVal = yIsAccessor ? (y as (...args: unknown[]) => unknown)(...args) : (y as number)
      const zVal = zIsAccessor ? (z as (...args: unknown[]) => unknown)(...args) : (z as number)
      return { x: xVal, y: yVal, z: zVal }
    }
    return { xyz }
  }
}

export class SplitXYOp extends Operator<SplitXYOp> {
  static displayName = 'SplitXY'
  static description = 'Split a 2D vector into its x and y components'
  createInputs() {
    return {
      vec: new Vec2Field({ x: 0, y: 0 }, { accessor: true }),
    }
  }
  createOutputs() {
    return {
      x: new NumberField(),
      y: new NumberField(),
    }
  }
  execute({ vec }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (isAccessor(vec)) {
      // Return accessor functions for each component
      const x = composeAccessor(vec, (v: { x: number; y: number }) => v.x)
      const y = composeAccessor(vec, (v: { x: number; y: number }) => v.y)
      return { x, y } as ExtractProps<typeof this.outputs>
    }

    // Static value
    const { x, y } = vec as { x: number; y: number }
    return { x, y }
  }
}

export class SplitXYZOp extends Operator<SplitXYZOp> {
  static displayName = 'SplitXYZ'
  static description = 'Split a 3D vector into its x, y, and z components'
  createInputs() {
    return {
      vec: new Vec3Field({ x: 0, y: 0, z: 0 }, { accessor: true }),
    }
  }
  createOutputs() {
    return {
      x: new NumberField(),
      y: new NumberField(),
      z: new NumberField(),
    }
  }
  execute({ vec }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (isAccessor(vec)) {
      // Return accessor functions for each component
      const x = composeAccessor(vec, (v: { x: number; y: number; z: number }) => v.x)
      const y = composeAccessor(vec, (v: { x: number; y: number; z: number }) => v.y)
      const z = composeAccessor(vec, (v: { x: number; y: number; z: number }) => v.z)
      return { x, y, z } as ExtractProps<typeof this.outputs>
    }

    // Static value
    const { x, y, z } = vec as { x: number; y: number; z: number }
    return { x, y, z }
  }
}

export class CombineRGBAOp extends Operator<CombineRGBAOp> {
  static displayName = 'CombineRGBA'
  static description = 'Combine r, g, b, and a into a color (range 0-255)'
  createInputs() {
    return {
      r: new NumberField(0, { accessor: true }),
      g: new NumberField(0, { accessor: true }),
      b: new NumberField(0, { accessor: true }),
      a: new NumberField(1, { accessor: true }),
    }
  }
  createOutputs() {
    return {
      color: new ColorField(),
    }
  }
  execute({ r, g, b, a }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Check if any inputs are accessor functions
    const rIsAccessor = isAccessor(r)
    const gIsAccessor = isAccessor(g)
    const bIsAccessor = isAccessor(b)
    const aIsAccessor = isAccessor(a)

    if (!rIsAccessor && !gIsAccessor && !bIsAccessor && !aIsAccessor) {
      // All static values
      return { color: colorToHex([r as number, g as number, b as number, a as number]) }
    }

    // At least one is an accessor - return accessor function
    const color = (...args: unknown[]) => {
      const rVal = rIsAccessor ? (r as (...args: unknown[]) => unknown)(...args) : (r as number)
      const gVal = gIsAccessor ? (g as (...args: unknown[]) => unknown)(...args) : (g as number)
      const bVal = bIsAccessor ? (b as (...args: unknown[]) => unknown)(...args) : (b as number)
      const aVal = aIsAccessor ? (a as (...args: unknown[]) => unknown)(...args) : (a as number)
      return colorToHex([rVal as number, gVal as number, bVal as number, aVal as number])
    }
    return { color } as ExtractProps<typeof this.outputs>
  }
}

export class SplitRGBAOp extends Operator<SplitRGBAOp> {
  static displayName = 'SplitRGBA'
  static description = 'Split a color into its red, green, blue, and alpha components (range 0-255)'
  createInputs() {
    return {
      color: new ColorField({ accessor: true }),
    }
  }
  createOutputs() {
    return {
      r: new NumberField(),
      g: new NumberField(),
      b: new NumberField(),
      a: new NumberField(),
    }
  }
  execute({ color }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const parseColor = (c: string) => {
      const [r, g, b, a] = hexToColor(c)
        .split(',')
        .map((v: string) => parseInt(v, 10))
      return { r, g, b, a }
    }

    if (isAccessor(color)) {
      // Return accessor functions for each component
      const r = composeAccessor(color, (c: string) => parseColor(c).r)
      const g = composeAccessor(color, (c: string) => parseColor(c).g)
      const b = composeAccessor(color, (c: string) => parseColor(c).b)
      const a = composeAccessor(color, (c: string) => parseColor(c).a)
      return { r, g, b, a } as ExtractProps<typeof this.outputs>
    }

    // Static value
    return parseColor(color as string)
  }
}

export class ColorOp extends Operator<ColorOp> {
  static displayName = 'Color'
  static description = 'A color'
  createInputs() {
    return {
      color: new ColorField(),
    }
  }
  createOutputs() {
    return {
      color: new ColorField(),
    }
  }
  execute({ color }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { color }
  }
}

export class HSLOp extends Operator<HSLOp> {
  static displayName = 'HSL'
  static description = 'A color in HSL (hue, saturation, lightness) format'
  createInputs() {
    return {
      h: new NumberField(0, { min: 0, max: 360, step: 1, accessor: true }),
      s: new NumberField(0.5, { min: 0, max: 1, step: 0.01, accessor: true }),
      l: new NumberField(0.8, { min: 0, max: 1, step: 0.01, accessor: true }),
    }
  }
  createOutputs() {
    return {
      color: new ColorField(),
    }
  }
  execute({ h, s, l }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Check if any inputs are accessor functions
    const hIsAccessor = isAccessor(h)
    const sIsAccessor = isAccessor(s)
    const lIsAccessor = isAccessor(l)

    if (!hIsAccessor && !sIsAccessor && !lIsAccessor) {
      // All static values
      return { color: hsl(h as number, s as number, l as number).formatHex() }
    }

    // At least one is an accessor - return accessor function
    const color = (...args: unknown[]) => {
      const hVal = hIsAccessor ? (h as (...args: unknown[]) => unknown)(...args) : (h as number)
      const sVal = sIsAccessor ? (s as (...args: unknown[]) => unknown)(...args) : (s as number)
      const lVal = lIsAccessor ? (l as (...args: unknown[]) => unknown)(...args) : (l as number)
      return hsl(hVal as number, sVal as number, lVal as number).formatHex()
    }
    return { color } as ExtractProps<typeof this.outputs>
  }
}

export class ColorRampOp extends Operator<ColorRampOp> {
  static displayName = 'ColorRamp'
  static description = 'Interpolate a color from a color ramp, value range 0-1'
  createInputs() {
    const colorRamp = new ColorRampField()

    const interpolators = {
      viridis: interpolateViridis,
      inferno: interpolateInferno,
      plasma: interpolatePlasma,
      magma: interpolateMagma,
      turbo: interpolateTurbo,
      cividis: interpolateCividis,

      warm: interpolateWarm,
      cool: interpolateCool,
      cubehelix: interpolateCubehelixDefault,
      spectral: interpolateSpectral,

      rainbow: interpolateRainbow,
      sinebow: interpolateSinebow,

      blues: interpolateBlues,
      greens: interpolateGreens,
      greys: interpolateGreys,
      reds: interpolateReds,
      oranges: interpolateOranges,
      purples: interpolatePurples,

      PinkYellowGreen: interpolatePiYG,
      PurpleOrange: interpolatePuOr,
      RedBlue: interpolateRdBu,
      RedGrey: interpolateRdGy,
      RedYellowBlue: interpolateRdYlBu,
      BlueGreen: interpolateBuGn,
      BluePurple: interpolateBuPu,
      GreenBlue: interpolateGnBu,
      OrangeRed: interpolateOrRd,
    }

    const colorScheme = new StringLiteralField('viridis', Object.keys(interpolators))

    colorScheme.subscribe(val => {
      const interpolate = interpolators[val as keyof typeof interpolators]
      colorRamp.setValue(interpolate)
    })

    const value = new NumberField(0, { min: 0, max: 1, step: 0.01, accessor: true })

    return {
      colorRamp,
      colorScheme,
      value,
    }
  }
  createOutputs() {
    return {
      color: new ColorField(),
    }
  }
  execute({
    colorRamp,
    colorScheme: _,
    value,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const scale = (val: number) => {
      const color = colorRamp(val)

      // Some return values are in rgb, some are in hex. Convert them all to be safe
      // TODO: VIS-813: Make all colors d3 Colors?
      return d3Color(color)?.formatHex()
    }

    // Use composeAccessor helper to handle both static values and accessor functions
    const color = composeAccessor(value, scale)

    return { color }
  }
}

export class CategoricalColorRampOp extends Operator<CategoricalColorRampOp> {
  static displayName = 'CategoricalColorRamp'
  static description = 'Map a string category to a color'
  createInputs() {
    const colorRamp = new CategoricalColorRampField()

    const schemes = {
      accent: schemeAccent,
      category10: schemeCategory10,
      dark: schemeDark2,
      paired: schemePaired,
      set1: schemeSet1,
      set2: schemeSet2,
      set3: schemeSet3,
      tableau10: schemeTableau10,

      // These schemes are arrays of arrays, ordered by number of stops. In the future we should
      // allow the user to select the number of stops
      BrownGreen: schemeBrBG[11],
      PurpleGreen: schemePRGn[11],
      PurpleBlue: schemePuBu[9],
      PinkYellowGreen: schemePiYG[11],
      RedBlue: schemeRdBu[11],
      RedGrey: schemeRdGy[11],
      RedYellowBlue: schemeRdYlBu[11],
      RedYellowGreen: schemeRdYlGn[11],
      YellowGreen: schemeYlGn[9],
      spectral: schemeSpectral[11],
    }

    const colorScheme = new StringLiteralField('accent', Object.keys(schemes))

    // TODO: Should this move to the execute function and component?
    colorScheme.subscribe(val => {
      const scheme = schemes[val as keyof typeof schemes]
      const interpolate = scaleOrdinal(scheme)
      colorRamp.count = scheme.length
      colorRamp.setValue(interpolate)
    })

    const value = new StringField('', { accessor: true })

    return {
      colorRamp,
      colorScheme,
      value,
    }
  }
  createOutputs() {
    return {
      color: new ColorField(),
    }
  }
  execute({
    colorRamp,
    value,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const scale = (val: string) => {
      const color = colorRamp(val)

      // Some return values are in rgb, some are in hex. Convert them all to be safe
      // TODO: VIS-813: Make all colors d3 Colors?
      return d3Color(color)?.formatHex()
    }

    // Use composeAccessor helper to handle both static values and accessor functions
    const color = composeAccessor(value, scale)

    return { color }
  }
}

export class TimeOp extends Operator<TimeOp> {
  static displayName = 'Time'
  static description = 'Get the current clock, timeline, and session time'

  private timeState$ = new BehaviorSubject({ now: Date.now(), tick: 0, sequenceTime: 0 })
  private rafId?: number
  private theatreUnsub?: () => void

  constructor(id: OpId, inputs?: unknown, locked?: boolean) {
    super(id, inputs, locked)
    // Initialize time updates after outputs are created
    this.initializeTimeUpdates()
  }

  createInputs() {
    return {}
  }

  createOutputs() {
    return {
      now: new NumberField(),
      sequenceTime: new NumberField(),
      tick: new NumberField(),
    }
  }

  private initializeTimeUpdates() {
    // Set up subscription from timeState$ to outputs
    const sub = this.timeState$.subscribe(state => {
      this.outputs.now.next(state.now)
      this.outputs.tick.next(state.tick)
      this.outputs.sequenceTime.next(state.sequenceTime)
    })
    this.subs.push(sub)

    // Start RAF loop after outputs are fully initialized
    this.startRAF()
  }

  private startRAF() {
    const update = () => {
      const current = this.timeState$.value
      this.timeState$.next({
        ...current,
        now: Date.now(),
        tick: current.tick + 1,
      })
      this.rafId = requestAnimationFrame(update)
    }
    update()
  }

  // Called by the component to inject Theatre sheet
  setTheatreSheet(sheet: { sequence: { pointer: { position: unknown } } }) {
    this.theatreUnsub?.()
    this.theatreUnsub = onChange(sheet.sequence.pointer.position, (pos: number) => {
      const current = this.timeState$.value
      this.timeState$.next({ ...current, sequenceTime: pos })
    })
  }

  dispose() {
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId)
    }
    this.theatreUnsub?.()
    this.timeState$.complete()
    super.dispose()
  }

  execute(_: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Outputs are driven by the BehaviorSubject, not by execute()
    return null
  }
}

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
    'Fetch a file from a URL or text. Supports csv, json, text, and binary formats'
  asDownload = () => this.outputData

  createInputs() {
    return {
      format: new StringLiteralField('json', { values: ['json', 'csv', 'text', 'binary'] }),
      url: new FileField(),
      text: new StringField(),
      autoType: new BooleanField(true), // TODO: Make this only available for csv
      pulse: new NumberField(0, { min: 0, step: 1 }),
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
    format: 'json' | 'csv' | 'text' | 'binary'
  ): Promise<unknown> {
    if (format === 'csv') {
      const parseFn = this.inputs.autoType.value ? d3.autoType : null
      return await csv(url, parseFn)
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
        const data = await this.fetchFromUrl(url, format as 'json' | 'csv' | 'text' | 'binary')
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

const duckDbInstance = (async () => {
  // Use CDN bundles for Cloudflare Pages (which has a 25 MiB file size limit)
  // Use local bundles for development and GitHub Actions (which can access local files)
  let bundles: duckdb.DuckDBBundles

  // Use import.meta.env directly in the condition for proper tree-shaking
  if (import.meta.env.VITE_USE_CDN_DUCKDB === 'true') {
    // jsdelivr CDN hosts the large WASM files externally
    bundles = duckdb.getJsDelivrBundles()
  } else {
    // Dynamically import the WASM files only when not using CDN
    // Vite will tree-shake this entire branch when VITE_USE_CDN_DUCKDB is 'true'
    const [
      duckdb_wasm,
      mvp_worker,
      duckdb_wasm_eh,
      eh_worker,
      duckdb_wasm_coi,
      coi_worker,
      duckdb_pthread_worker,
    ] = await Promise.all([
      import('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-coi.wasm?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-coi.worker.js?url').then(m => m.default),
      import('@duckdb/duckdb-wasm/dist/duckdb-browser-coi.pthread.worker.js?url').then(
        m => m.default
      ),
    ])

    // Bundle the WASM files locally for environments that support it
    bundles = {
      mvp: {
        mainModule: duckdb_wasm,
        mainWorker: mvp_worker,
      },
      eh: {
        mainModule: duckdb_wasm_eh,
        mainWorker: eh_worker,
      },
      coi: {
        mainModule: duckdb_wasm_coi,
        mainWorker: coi_worker,
        pthreadWorker: duckdb_pthread_worker,
      },
    }
  }

  // Select a bundle based on browser checks
  const bundle = await duckdb.selectBundle(bundles)
  const workerUrl = bundle.mainWorker!

  // Handle cross-origin URLs by fetching and creating blob URL
  const isCrossOrigin =
    workerUrl.startsWith('http') && !workerUrl.startsWith(window.location.origin)
  const resolvedWorkerUrl = isCrossOrigin
    ? await fetch(workerUrl).then(async res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch DuckDB worker: ${res.status} ${res.statusText}`)
        }
        const blob = new Blob([await res.text()], { type: 'application/javascript' })
        return URL.createObjectURL(blob)
      })
    : workerUrl

  const worker = new Worker(resolvedWorkerUrl)
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker)

  const conn = await db.connect()
  await conn.query(`
    SET autoinstall_known_extensions = 1;
    INSTALL spatial;
    LOAD spatial;
    INSTALL httpfs;
    -- Not sure why but this isn't loading. For some reason it still works in the code though
    -- LOAD httpfs;
  `)
  await conn.close()

  return db
})()

export class DuckDbOp extends Operator<DuckDbOp> {
  static displayName = 'DuckDB'
  static description = 'Query a DuckDB database using sql'
  asDownload = () => this.outputData
  createInputs() {
    return {
      query: new CodeField('SELECT 1 as val;', { language: 'sql' }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }

  async execute({
    query: queryString = '',
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> | null {
    const queries = queryString
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => `${s};`)
    if (!queries?.length) {
      return { data: [] }
    }

    const db = await duckDbInstance
    const conn = await db.connect()

    try {
      let data = []
      for (const query of queries) {
        if (!mustacheRe.test(query)) {
          const result = await conn.query(query)
          data = result.toArray()
          continue
        }

        // Parse the query and extract references
        const references: FieldReference[] = []
        const parameterizedQuery = query.replace(mustacheRe, (raw, opId, inOut, fieldPath) => {
          // If the opId is a relative path (doesn't start with /), make it relative to current context
          const resolvedOpId = opId.startsWith('/') ? opId : `./${opId}`
          references.push({ opId: resolvedOpId, inOut, fieldPath, raw })
          return `$${references.length}` // $1, $2, etc.
        })

        // Resolve reference values
        const positionalParams = references.map(({ opId, inOut, fieldPath }) => {
          const op = getOp(opId, this.id)
          const [firstKey, ...rest] = fieldPath.split('.')

          const field = op?.[inOut === 'par' ? 'inputs' : 'outputs']?.[firstKey]
          if (!field) {
            throw new Error(`Field ${firstKey} not found on ${opId}`)
          }

          return rest.reduce((d, prop) => d[prop], field.value)
        })

        // Prepare the query with the current connection
        const prepared = await conn.prepare(parameterizedQuery)

        const result = await prepared.query(...positionalParams)
        data = result.toArray()
      }
      await conn.close()
      return { data }
    } catch (e) {
      console.error('Error executing query', e)
      await conn.close()
      await db.reset()
      if (e instanceof Error) {
        throw e
      }
      return null
    }
  }
}

export class JSONOp extends Operator<JSONOp> {
  static displayName = 'JSON'
  static description = 'Parse a JSON string'
  createInputs() {
    return {
      text: new CodeField('{}', { language: 'json' }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  execute({ text }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const json = text.replace(mustacheRe, (_, opId: string, inOut: InOut, fieldPath: string) => {
      // If the opId is a relative path (doesn't start with /), make it relative to current context
      const resolvedOpId = opId.startsWith('/') ? opId : `./${opId}`
      const op = getOp(resolvedOpId, this.id)
      const [fieldName, ...propKeys] = fieldPath.split('.')

      const field = op?.[inOut === 'par' ? 'inputs' : 'outputs']?.[fieldName]
      if (!field) {
        throw new Error(`Field ${fieldName} not found on ${resolvedOpId}`)
      }

      const val = propKeys.reduce((d, prop) => d[prop], field.value)
      return JSON.stringify(val)
    })

    const data = JSON.parse(json)
    return { data }
  }
}

export class ViewerOp extends Operator<ViewerOp> {
  static displayName = 'Viewer'
  static description = 'Inspect data in the viewer'
  asDownload = () => this.inputs.data.value
  createInputs() {
    return {
      data: new UnknownField(),
    }
  }

  createOutputs() {
    return {}
  }

  execute({ data }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // This is a special-case because it's essentially a pass-through. The Viewer component will handle the data
    return { data }
  }
}

export class TableEditorOp extends Operator<TableEditorOp> {
  static displayName = 'TableEditor'
  static description = 'Edit a table in the viewer'
  asDownload = () => this.outputData
  createInputs() {
    return {
      data: new DataField(),
    }
  }

  createOutputs() {
    return {
      data: new DataField(),
    }
  }

  execute({ data }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // This is a special-case because it's essentially a pass-through. The TableEditor component will handle the data
    return { data }
  }
}

export class ScatterOp extends Operator<ScatterOp> {
  static displayName = 'Scatter'
  static description = 'Scatter points randomly within a bounding box'
  createInputs() {
    return {
      bounds: new ArrayField(new Point2DField([0, 0], { returnType: 'tuple' })),
      count: new NumberField(100, { min: 1, step: 1 }),
      seed: new NumberField(1, { min: 0, step: 1 }),
    }
  }
  createOutputs() {
    return {
      points: new ArrayField(new Point2DField()),
    }
  }
  execute({
    bounds,
    count,
    seed,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (bounds.length !== 2) {
      bounds = [
        [-180, -90],
        [180, 90],
      ]
    }

    // Ensure bounds are in [west, south], [east, north] order
    const west = Math.min(bounds[0][0], bounds[1][0])
    const east = Math.max(bounds[0][0], bounds[1][0])
    const south = Math.min(bounds[0][1], bounds[1][1])
    const north = Math.max(bounds[0][1], bounds[1][1])

    const rng = mulberry32(seed)
    const points = Array.from({ length: count }, () => ({
      lng: west + rng() * (east - west),
      lat: south + rng() * (north - south),
    }))

    return { points }
  }
}

export class BoundsOp extends Operator<BoundsOp> {
  static displayName = 'Bounds'
  static description = 'Create a bounding box from two points'
  createInputs() {
    return {
      point1: new Point2DField(),
      point2: new Point2DField(),
    }
  }
  createOutputs() {
    return {
      bounds: new ArrayField(new Point2DField([0, 0], { returnType: 'tuple' })),
    }
  }
  execute({ point1, point2 }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const west = Math.min(point1.lng, point2.lng)
    const east = Math.max(point1.lng, point2.lng)
    const south = Math.min(point1.lat, point2.lat)
    const north = Math.max(point1.lat, point2.lat)

    const bounds = [
      [west, south],
      [east, north],
    ] as [[number, number], [number, number]]

    return { bounds }
  }
}

export class BoundingBoxOp extends Operator<BoundingBoxOp> {
  static displayName = 'BoundingBox'
  static description =
    'Calculate the geographic bounds of your points (with lat/lng keys) and get a camera position (center, zoom) that fits them all in view.'
  asDownload = () => this.outputData
  createInputs() {
    return {
      data: new ArrayField(new Point2DField()),
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
    for (const d of data) {
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

    // const { resolution: { width, height } } = useSlice(store => store.renderer)
    // TODO: get the state values. Currently broken due to tests
    // Different containers for interleaved and pure deck.gl mode
    const container =
      document.querySelector('.deckgl-container') || document.querySelector('.maplibregl-map')
    const width = container?.clientWidth || window.innerWidth
    const height = container?.clientHeight || window.innerHeight

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
    }
  }
  async execute(_: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // This is a special-case because it's essentially a pass-through. The Geocoder component will handle the API call
    return null

    /*
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_ACCESS_TOKEN}`
    )
    const data = await response.json()
    const location = data.features[0].center
    return { location }
    */
  }
}

export class DirectionsOp extends Operator<DirectionsOp> {
  static displayName = 'Directions'
  static description = 'Get driving or transit directions between two points'
  asDownload = () => this.outputData
  createInputs() {
    return {
      origin: new Point2DField(),
      destination: new Point2DField(),
      mode: new StringLiteralField('transit', { values: ['driving', 'transit'] }),
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
        },
        { passthrough: true }
      ),
    }
  }
  async execute({
    origin,
    destination,
    mode,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Guard on default values
    if (
      (origin.lng === 0 && origin.lat === 0) ||
      (destination.lng === 0 && destination.lat === 0) ||
      !(mode === 'driving' || mode === 'transit')
    ) {
      console.debug('Invalid origin, destination or mode', origin, destination, mode)
      return { route: { timestamps: [], path: [] } }
    }

    const route = await getDirections({
      origin,
      destination,
      mode,
    })

    return { route }
  }
}

export class ArcOp extends Operator<ArcOp> {
  static displayName = 'Arc'
  static description = 'Generate an arc path between two points at a given altitude'
  asDownload = () => this.outputData
  createInputs() {
    return {
      source: new Point3DField(),
      target: new Point3DField(),
      altitudeMultiplier: new NumberField(2, { min: 0, softMax: 100 }),
      apexAlt: new NumberField(10_000, { min: 0, softMax: 100_000 }),
      smoothHeight: new BooleanField(true),
      smoothPosition: new BooleanField(true),
      segmentCount: new NumberField(250, { min: 1, softMax: 1000 }),
      tilt: new NumberField(0, { min: -90, max: 90 }),
    }
  }
  createOutputs() {
    return {
      path: new ArrayField(new Point3DField()),
    }
  }
  execute({
    source,
    target,
    altitudeMultiplier,
    apexAlt,
    smoothHeight,
    smoothPosition,
    segmentCount,
    tilt,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if ((source.lat === 0 && source.lng === 0) || (target.lat === 0 && target.lng === 0)) {
      return { path: [] }
    }

    const path = getArc({
      source: {
        ...source,
        alt: source.alt || 0,
      },
      target: {
        ...target,
        alt: target.alt || 0,
      },
      arcHeight: apexAlt * altitudeMultiplier,
      smoothHeight,
      smoothPosition,
      segmentCount,
      tilt,
    })

    return { path }
  }
}

export class NetworkOp extends Operator<NetworkOp> {
  static displayName = 'Network'
  static description = 'Generate a network of routes between a set of points (usually skyports)'
  asDownload = () => this.outputData
  createInputs() {
    return {
      skyports: new DataField(new ArrayField(new Point3DField())),
      hub: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      routes: new DataField(
        new ArrayField(
          new CompoundPropsField({
            origin: new Point3DField(),
            destination: new Point3DField(),
          })
        )
      ),
    }
  }
  execute({ skyports, hub }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!skyports.length) {
      return { routes: [] }
    }
    if (hub) {
      const hub = skyports[0]
      const routes = skyports.slice(1).map(s => ({
        origin: hub,
        destination: s,
      }))
      return {
        routes,
      }
    }

    // All possible combinations of pairs in an array
    // cross([1,2,3]) => [[1, 2], [1, 3], [2, 3]]
    const cross = <T>(arr: T[]): [T, T][] =>
      arr.flatMap((a, i) => arr.slice(i + 1).map(b => [a, b] as [T, T]))

    const routes = cross<{ lng: number; lat: number }>(skyports).map(([origin, destination]) => ({
      origin,
      destination,
    }))
    return {
      routes,
    }
  }
}

// Helper function to detect Temporal objects
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

export class SwitchOp extends Operator<SwitchOp> {
  static displayName = 'Switch'
  static description =
    'Select one value from a list using an index (0, 1, 2...). With blend enabled, smoothly interpolate between values for animation effects.'
  createInputs() {
    return {
      values: new ListField(new DataField()),
      index: new NumberField(0, { min: 0, step: 1 }),
      blend: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      value: new DataField(),
    }
  }
  execute({
    values,
    index,
    blend,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!blend) {
      const value = values[Math.floor(Math.min(index, values.length - 1))]
      return { value }
    }

    if (values.length === 0) {
      return { value: undefined }
    }

    if (values.length === 1) {
      return { value: values[0] }
    }

    // For multiple values, we need to find which two values to interpolate between
    // and calculate the interpolation factor
    const clampedIndex = Math.min(index, values.length - 1)
    const lowerIndex = Math.floor(clampedIndex)
    const upperIndex = Math.ceil(clampedIndex)

    // If we're exactly on an index, return that value
    if (lowerIndex === upperIndex) {
      return { value: values[lowerIndex] }
    }

    // Calculate the interpolation factor between the two values
    const t = clampedIndex - lowerIndex

    // Check if we're dealing with Temporal objects
    const lowerValue = values[lowerIndex]
    const upperValue = values[upperIndex]

    if (isTemporal(lowerValue) && isTemporal(upperValue)) {
      const value = interpolateTemporal(lowerValue, upperValue, t)
      return { value }
    }

    // Fall back to d3's interpolate for other types
    const value = interpolate(lowerValue, upperValue)(t)
    return { value }
  }
}

export class ForLoopBeginOp extends Operator<ForLoopBeginOp> {
  static displayName = 'ForLoopBegin'
  static description =
    'Start a loop that processes each item in an array. The scope body is wrapped in a group node. Outputs are set by the executor during iteration.'

  createInputs() {
    return {
      data: new DataField(new ArrayField(new UnknownField())),
    }
  }

  createOutputs() {
    return {
      d: new DataField(new UnknownField()),
      index: new NumberField(0), // Current iteration index
      total: new NumberField(0), // Total number of items
    }
  }

  execute({ data }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // GraphExecutor sets these values during iteration
    const arr = Array.isArray(data) ? data : []
    return {
      d: arr.length > 0 ? arr[0] : null,
      index: 0,
      total: arr.length,
    }
  }
}

export class ForLoopEndOp extends Operator<ForLoopEndOp> {
  static displayName = 'ForLoopEnd'
  static description =
    'End a loop started by ForLoopBegin. Collects all the processed items into an array and passes them to downstream operators.'
  static defaultValue = []

  // This is a special case where we need to keep track of the loop
  _subs: Subscription[] = []
  chain: Operator<IOperator>[] = []

  createInputs() {
    return {
      d: new DataField(new UnknownField()),
    }
  }
  createOutputs() {
    return {
      data: new DataField(new ArrayField(new UnknownField())),
    }
  }

  // This is a complicated operator that needs to keep track of the loop.
  // We need to know when the loop is done, and when to start the next iteration
  // It hijacks event-oriented nature of Operators, firing an event on the beginLoopOp
  // and then listening for the endLoopOp to know when to stop, using the number of
  // elements in the data array to know when to stop and pass along the results to
  // the downstream operators
  createForLoopListeners(chain: Operator<IOperator>[] = []) {
    this.chain = chain

    const beginOp = chain.find(op => op instanceof ForLoopBeginOp)! as ForLoopBeginOp
    // biome-ignore lint/complexity/noUselessThisAlias: Provides clarity
    const endOp = this
    let running = false

    // Debounce the loop to prevent it from running too frequently when the data changes
    const runForLoop = () => {
      if (running) return
      running = true
      const data = beginOp.inputs.data.getValue()
      const collection: unknown[] = []
      let i = 0

      // For the first run, when data is empty just pass along the empty array
      if (data.length === 0) {
        endOp.outputs['data'].next(collection)
        running = false
        return
      }

      let firstRun = true
      const sub = endOp.inputs['d'].subscribe(values => {
        if (data.length === 0 || i === data.length) {
          endOp.outputs['data'].next(collection)
          running = false
          if (i === data.length) {
            sub.unsubscribe()
          }
        } else if (i < data.length && !firstRun) {
          collection.push(values)
          i++
        }
      })

      firstRun = false
      for (const d of data) {
        beginOp.outputs['d'].next(d)
      }
    }

    for (const sub of this._subs) {
      sub.unsubscribe()
    }

    for (const chainOp of chain) {
      const sub = combineLatest(chainOp.inputs)
        .pipe(debounceTime(200))
        .subscribe(() => {
          // Only run if the operator is still mounted
          if (hasOp(beginOp.id)) {
            runForLoop()
          }
        })
      this._subs.push(sub)
    }
  }
  execute({ d }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { data: d }
  }
}

// ForLoopMetaOp provides accumulator for reduce-like operations within a ForLoop scope.
// GraphExecutor is responsible for:
// - Iterating over the data array
// - Setting d/index/total on ForLoopBeginOp for each iteration
// - Setting accumulator/index/total/isFirst/isLast on ForLoopMetaOp
// - Collecting results from ForLoopEndOp across iterations

export class ForLoopMetaOp extends Operator<ForLoopMetaOp> {
  static displayName = 'ForLoopMeta'
  static description =
    'Access iteration metadata and accumulator within a ForLoop scope. Like Houdini iteration metadata.'

  createInputs() {
    return {
      initialValue: new DataField(new UnknownField(), { description: 'Initial accumulator value' }),
      currentValue: new DataField(new UnknownField(), {
        description: 'Value to pass to next iteration',
      }),
    }
  }

  createOutputs() {
    return {
      accumulator: new DataField(new UnknownField()),
      index: new NumberField(0),
      total: new NumberField(0),
      isFirst: new BooleanField(false),
      isLast: new BooleanField(false),
    }
  }

  execute({
    initialValue,
    currentValue,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // GraphExecutor manages accumulator state across iterations
    return {
      accumulator: currentValue ?? initialValue,
      index: 0,
      total: 0,
      isFirst: true,
      isLast: true,
    }
  }
}

export class FilterOp extends Operator<FilterOp> {
  static displayName = 'FilterOp'
  static description = 'Filter an array of data based on a condition'
  createInputs() {
    const data = new DataField(new ArrayField(new UnknownField()))
    const columnName = new StringLiteralField('', [])

    data.subscribe((data: unknown[]) => {
      if (data.length > 0) {
        const keys = Object.keys(data[0])
        columnName.updateChoices(keys)
      }
    })

    return {
      data,
      columnName,
      condition: new StringLiteralField('equals', {
        values: [
          'equals',
          'not equals',
          'greater than',
          'less than',
          'greater than or equal to',
          'less than or equal to',
          'contains',
          'not contains',
          'in',
          'not in',
        ],
      }),
      value: new StringField(''),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  execute({
    data,
    columnName,
    condition,
    value,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    let fn = (_d: unknown) => true
    switch (condition) {
      case 'equals':
        fn = (d: unknown) => d[columnName] === value
        break
      case 'not equals':
        fn = (d: unknown) => d[columnName] !== value
        break
      case 'greater than':
        fn = (d: unknown) => d[columnName] > value
        break
      case 'less than':
        fn = (d: unknown) => d[columnName] < value
        break
      case 'greater than or equal to':
        fn = (d: unknown) => d[columnName] >= value
        break
      case 'less than or equal to':
        fn = (d: unknown) => d[columnName] <= value
        break
      case 'contains':
        fn = (d: unknown) => d[columnName].includes(value)
        break
      case 'not contains':
        fn = (d: unknown) => !d[columnName].includes(value)
        break
      case 'in':
        fn = (d: unknown) => value.split(',').includes(d[columnName])
        break
      case 'not in':
        fn = (d: unknown) => !value.split(',').includes(d[columnName])
        break
    }

    const result = data.filter(fn)
    return { data: result }
  }
}

// Should this be a special case of FilterOp?
export class SliceOp extends Operator<SliceOp> {
  static displayName = 'Slice'
  static description = 'Slice an array of data'
  createInputs() {
    return {
      data: new DataField(),
      start: new NumberField(0, { min: 0, step: 1 }),
      end: new NumberField(10, { min: 0, step: 1, optional: true }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  execute({
    data,
    start,
    end,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { data: data.slice(start, end) }
  }
}

export class SortOp extends Operator<SortOp> {
  static displayName = 'Sort'
  static description = 'Sort an array of data based on a key'
  createInputs() {
    return {
      data: new DataField(),
      key: new StringField(''),
      order: new StringLiteralField('asc', { values: ['asc', 'desc'] }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  execute({
    data,
    key,
    order,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const sorted = data.sort((a, b) => {
      if (order === 'asc') {
        return a[key] - b[key]
      }
      return b[key] - a[key]
    })
    return { data: sorted }
  }
}

export class RandomizeAttributeOp extends Operator<RandomizeAttributeOp> {
  static displayName = 'RandomizeAttribute'
  static description = 'Randomize a numeric attribute on data elements within a given range'
  createInputs() {
    return {
      data: new DataField(),
      key: new StringField(''),
      min: new NumberField(0, { step: 0.01 }),
      max: new NumberField(1, { step: 0.01 }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  execute({
    data,
    key,
    min,
    max,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const randomized = data.map(item => ({
      ...item,
      [key]: Math.random() * (max - min) + min,
    }))
    return { data: randomized }
  }
}

export class ConcatOp extends Operator<ConcatOp> {
  static displayName = 'Concat'
  static description =
    'Concatenate multiple arrays into a single array. Use depth to flatten nested arrays (depth=1 flattens one level, depth=2 flattens two levels).'
  createInputs() {
    return {
      values: new ListField(new DataField()),
      depth: new NumberField(1, { min: 0, max: 2 }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  execute({ values, depth }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Check if any values are accessor functions
    const hasAccessors = values.some(isAccessor)

    if (hasAccessors) {
      // Return an accessor function that evaluates all values and merges them
      const result = (...args: unknown[]) => {
        const evaluatedValues = values.map(item => (isAccessor(item) ? item(...args) : item))
        return evaluatedValues.flat(depth)
      }
      return { data: result }
    }

    // Static evaluation
    return { data: values.flat(depth) }
  }
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

class MapStyleOp extends Operator<MapStyleOp> {
  static displayName = 'MapStyle'
  static description = 'Map style for MapLibre'
  createInputs() {
    return {
      mapStyle: new StringLiteralField(CARTO_DARK, {
        values: Object.entries(MAP_STYLES).map(([url, name]) => ({
          label: name,
          value: url as string,
        })),
      }),
    }
  }
  createOutputs() {
    return {
      mapStyle: new StringField(),
    }
  }
  execute({ mapStyle }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { mapStyle }
  }
}

export class ProjectOp extends Operator<ProjectOp> {
  static displayName = 'Project'
  static description =
    'Project a lat/lng point to a screen position. Requires the ViewState and dimensions of the map.'
  createInputs() {
    return {
      position: new Point2DField(),
      width: new NumberField(1920, { min: 1, softMax: 10_000 }),
      height: new NumberField(1080, { min: 1, softMax: 10_000 }),
      viewState: new CompoundPropsField({
        latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.1 }),
        longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.1 }),
        zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
        pitch: new NumberField(0),
        bearing: new NumberField(0),
      }),
    }
  }
  createOutputs() {
    return {
      screenPosition: new Vec2Field(),
    }
  }
  execute({
    position,
    viewState,
    height,
    width,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(viewState)
    const viewport = new WebMercatorViewport({
      ...viewState,
      height,
      width,
    })
    const [x, y] = viewport.project([position.lng, position.lat])
    return { screenPosition: { x, y } }
  }
}

export class UnprojectOp extends Operator<UnprojectOp> {
  static displayName = 'Unproject'
  static description =
    'Unproject a screen position to a lat/lng point. Requires the ViewState and dimensions'
  createInputs() {
    return {
      screenPosition: new Vec2Field(),
      width: new NumberField(1920, { min: 1, softMax: 10_000 }),
      height: new NumberField(1080, { min: 1, softMax: 10_000 }),
      viewState: new CompoundPropsField({
        latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.1 }),
        longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.1 }),
        zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
        pitch: new NumberField(0),
        bearing: new NumberField(0),
      }),
    }
  }
  createOutputs() {
    return {
      point: new Point2DField(),
    }
  }
  execute({
    screenPosition,
    viewState,
    height,
    width,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(viewState)
    const viewport = new WebMercatorViewport({
      ...viewState,
      height,
      width,
    })
    const [lng, lat] = viewport.unproject([screenPosition.x, screenPosition.y])
    return { point: { lng, lat } }
  }
}

export class MapViewStateOp extends Operator<MapViewStateOp> {
  static displayName = 'MapViewState'
  static description = 'Create a react-map-gl MapViewState for controlling the camera.'
  createInputs() {
    return {
      longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
      latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
      zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
      pitch: new NumberField(0, { min: 0, max: 60, optional: true }),
      bearing: new NumberField(0, { optional: true }),
    }
  }
  createOutputs() {
    return {
      viewState: new CompoundPropsField({
        longitude: new NumberField(),
        latitude: new NumberField(),
        zoom: new NumberField(),
        pitch: new NumberField(),
        bearing: new NumberField(),
      }),
    }
  }
  execute({
    longitude,
    latitude,
    zoom,
    pitch,
    bearing,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const viewState = { longitude, latitude, zoom, pitch, bearing }
    validateViewState(viewState)
    return { viewState }
  }
}

export class SplitMapViewStateOp extends Operator<SplitMapViewStateOp> {
  static displayName = 'SplitMapViewState'
  static description = 'Split a viewState object into its individual components.'
  createInputs() {
    return {
      viewState: new CompoundPropsField({
        longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
        latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
        zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
        pitch: new NumberField(0, { min: 0, max: 60, optional: true }),
        bearing: new NumberField(0, { optional: true }),
      }),
    }
  }
  createOutputs() {
    return {
      longitude: new NumberField(),
      latitude: new NumberField(),
      zoom: new NumberField(),
      pitch: new NumberField(),
      bearing: new NumberField(),
    }
  }
  execute({ viewState }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(viewState)
    return { ...viewState }
  }
}

export class MaplibreBasemapOp extends Operator<MaplibreBasemapOp> {
  static displayName = 'MaplibreBasemap'
  static description = 'A Maplibre basemap.'

  createInputs() {
    return {
      mapStyle: new JSONUrlField(CARTO_DARK),
      projection: new StringLiteralField('mercator', ['mercator', 'globe']),
      viewState: new CompoundPropsField({
        latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
        longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
        zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
        pitch: new NumberField(0, { min: 0, max: 60, optional: true }),
        bearing: new NumberField(0, { optional: true }),
      }),
    }
  }

  createOutputs() {
    return {
      maplibre: new CompoundPropsField({
        mapStyle: new JSONUrlField(),
        projection: new StringField(),
        longitude: new NumberField(),
        latitude: new NumberField(),
        zoom: new NumberField(),
        pitch: new NumberField(),
        bearing: new NumberField(),
      }),
    }
  }
  execute({
    mapStyle,
    projection,
    viewState,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(viewState)

    return {
      maplibre: {
        mapStyle,
        projection,
        ...viewState,
      },
    }
  }
}

export class DeckRendererOp extends Operator<DeckRendererOp> {
  static displayName = 'DeckRenderer'
  static description = 'Render a deck.gl visualization with layers and effects.'

  createInputs() {
    return {
      layers: new ListField(new LayerField()), // TODO: extend LayerField schema to support the beforeId prop.
      effects: new ListField(new EffectField()),
      // Additional views on top of the map. A MapView({id: 'mapbox'}) will be inserted at the bottom of the stack.
      views: new ListField(new ViewField()),
      widgets: new ListField(new WidgetField()),
      layerFilter: new FunctionField(() => true),
      // TODO: We need a nullable field. This should be a nullable (intentionally empty), or a compound object below.
      // TODO: Nullable fields need to be disable-able from the UI so their values can be cleared.
      basemap: new UnknownField(
        {
          mapStyle: CARTO_DARK,
          latitude: DEFAULT_LATITUDE,
          longitude: DEFAULT_LONGITUDE,
          zoom: 12,
        },
        { optional: true }
      ),
      // basemap: new CompoundPropsField({
      //   mapStyle: new JSONUrlField(CARTO_DARK),
      //   latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
      //   longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
      //   zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
      //   pitch: new NumberField(0, { min: 0, max: 60, optional: true }),
      //   bearing: new NumberField(0, { optional: true }),
      // }, { optional: true }),
      viewState: new UnknownField({}),
    }
  }
  createOutputs() {
    return {
      vis: new VisualizationField(),
    }
  }
  execute({
    layers,
    effects,
    widgets,
    viewState,
    basemap,
    views,
    layerFilter,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Validate the ViewState to ensure lat/lng are within valid bounds
    validateViewState(viewState)

    const deckProps: DeckProps & { layers: (LayerProps & { type: string })[] } = {
      layers,
      effects,
      ...(views?.length > 0 ? { views } : {}),
      viewState,
      layerFilter,
      widgets,
    }

    // Prefer viewState values when using a basemap
    // Ignore nested deck viewStates
    const mapProps =
      basemap !== null
        ? {
            ...basemap,
            ...pick(viewState, ['longitude', 'latitude', 'zoom', 'pitch', 'bearing']),
          }
        : undefined

    return {
      vis: {
        deckProps,
        mapProps,
      },
    }
  }
}

// ViewOp input order controls the order they show up in the UI. Order them by:
// - common view props
// - unique view props ordered by most to least often used.
// - viewState props ordered by most to least often used.
// - override props go last (e.g. projectionMatrix)
// Base view fields that apply to all view types
function createBaseViewFields() {
  return {
    x: new NumberField(0),
    y: new NumberField(0),
    width: new StringField('100%'),
    height: new StringField('100%'),
    padding: new CompoundPropsField({
      top: new NumberField(0, { min: 0 }),
      right: new NumberField(0, { min: 0 }),
      bottom: new NumberField(0, { min: 0 }),
      left: new NumberField(0, { min: 0 }),
    }),
    clear: new BooleanField(false),
    clearColor: new ColorField('#00000000', { transform: hexToColor }),
  }
}

function createGeoViewFields() {
  return {
    altitude: new NumberField(1.5, { softMin: -100_000, softMax: 100_000, step: 0.1 }),
    nearZMultiplier: new NumberField(0.1, { min: 0, softMax: 1_000, step: 0.1 }),
    farZMultiplier: new NumberField(1.01, { min: 0, softMax: 1_000 }),
  }
}

function createGeoViewStateFields() {
  return {
    latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
    longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
  }
}

export class MapViewOp extends Operator<MapViewOp> {
  static displayName = 'MapView'
  static description = 'A deck.gl map view.'

  createInputs() {
    return {
      ...createBaseViewFields(),
      orthographic: new BooleanField(false),
      fovy: new NumberField(40, { min: 0.1, max: 179.9 }),
      repeat: new BooleanField(false),
      ...createGeoViewFields(),
      viewState: new CompoundPropsField({
        ...createGeoViewStateFields(),
        zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
        bearing: new NumberField(0, { optional: true }),
        pitch: new NumberField(0, { min: 0, max: 90, optional: true }),
        position: new Vec3Field([0, 0, 0], { returnType: 'tuple', optional: true }),
      }),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(),
    }
  }

  execute({
    viewState,
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(viewState)
    return {
      view: new MapView({ id: this.id, ...props, viewState: { ...viewState, maxPitch: 90 } }),
    }
  }
}

export class GraphInputOp extends Operator<GraphInputOp> {
  static displayName = 'GraphInput'
  static description = 'Receives input from the parent Container.'

  createInputs() {
    return { parentValue: new UnknownField(null, { optional: true }) }
  }

  createOutputs() {
    return { value: new UnknownField(null, { optional: true }) }
  }

  execute({ parentValue }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { value: parentValue }
  }
}

export class GraphOutputOp extends Operator<GraphOutputOp> {
  static displayName = 'GraphOutput'
  static description = 'Provides output to the parent Container.'

  createInputs() {
    return { value: new UnknownField(null, { optional: true }) }
  }

  createOutputs() {
    return { propagatedValue: new UnknownField(null, { optional: true }) }
  }

  execute({ value }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { propagatedValue: value }
  }
}

export class GlobeViewOp extends Operator<GlobeViewOp> {
  static displayName = 'GlobeView'
  static description = 'A deck.gl globe view.'

  createInputs() {
    return {
      ...createBaseViewFields(),
      ...createGeoViewFields(),
      viewState: new CompoundPropsField({
        ...createGeoViewStateFields(),
        zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
      }),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(props.viewState)
    return { view: new GlobeView({ id: this.id, ...props }) }
  }
}

export class FpsWidgetOp extends Operator<FpsWidgetOp> {
  static displayName = 'FpsWidget'
  static description = 'Display frames per second (FPS) widget'

  createInputs() {
    return {
      placement: new StringLiteralField('top-left', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      }),
      viewId: new StringField('', { optional: true }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(),
    }
  }

  execute({
    placement,
    viewId,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const widget = {
      id: this.id,
      type: '_FpsWidget',
      placement,
      ...(viewId && viewId !== '' ? { viewId } : {}),
    }
    return { widget }
  }
}

function createFrustumViewFields() {
  return {
    near: new NumberField(0.1, { min: 0, softMax: 1_000_000, step: 0.1 }),
    far: new NumberField(100000, { min: 0, softMax: 1_000_000 }),
  }
}

export class FirstPersonViewOp extends Operator<FirstPersonViewOp> {
  static displayName = 'FirstPersonView'
  static description = 'A deck.gl first person view.'

  createInputs() {
    return {
      ...createBaseViewFields(),
      orthographic: new BooleanField(false),
      ...createFrustumViewFields(),
      fovy: new NumberField(40, { min: 0.1, max: 179.9 }),
      // focalDistance: new NumberField(1),
      viewState: new CompoundPropsField({
        ...createGeoViewStateFields(),
        position: new Vec3Field([0, 0, 0], { returnType: 'tuple' }),
        bearing: new NumberField(0, { optional: true }),
        pitch: new NumberField(0, { min: -90, max: 90, optional: true }),
      }),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(props.viewState)
    return { view: new FirstPersonView({ id: this.id, ...props }) }
  }
}

export class OrbitViewOp extends Operator<OrbitViewOp> {
  static displayName = 'OrbitView'
  static description = 'A deck.gl orbit view.'

  createInputs() {
    return {
      ...createBaseViewFields(),
      orthographic: new BooleanField(false),
      orbitAxis: new StringLiteralField('Z', {
        values: ['X', 'Y', 'Z'],
      }),
      ...createFrustumViewFields(),
      fovy: new NumberField(40, { min: 0.1, max: 179.9 }),
      viewState: new CompoundPropsField({
        target: new Vec3Field([0, 0, 0], { returnType: 'tuple', optional: true }),
        rotationOrbit: new NumberField(0, { optional: true }),
        rotationX: new NumberField(0, { optional: true }),
        zoom: new NumberField(1, { min: 0, max: 1, step: 0.01, optional: true }),
      }),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(props.viewState)
    return { view: new OrbitView({ id: this.id, ...props }) }
  }
}

export class OrthographicViewOp extends Operator<OrthographicViewOp> {
  static displayName = 'OrthographicView'
  static description = 'A deck.gl orthographic view.'

  createInputs() {
    return {
      ...createBaseViewFields(),
      ...createFrustumViewFields(),
      flipY: new BooleanField(false),
      viewState: new CompoundPropsField({
        target: new Vec3Field([0, 0, 0], { returnType: 'tuple', optional: true }),
        zoom: new NumberField(0, { optional: true }),
      }),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(props.viewState)
    return { view: new OrthographicView({ id: this.id, ...props }) }
  }
}

export class OutOp extends Operator<OutOp> {
  static displayName = 'Out'
  static description = 'Output a visualization.'
  createInputs() {
    return {
      vis: new VisualizationField(),
    }
  }
  createOutputs() {
    return {}
  }
  execute(_: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return {}
  }
}

export class ConsoleOp extends Operator<ConsoleOp> {
  static displayName = 'Console'
  static description = 'Log data to the console'
  createInputs() {
    return {
      data: new DataField(),
    }
  }
  createOutputs() {
    return {}
  }
  execute({ data }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    console.log(data)
    return {}
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

export class PathLayerOp extends Operator<PathLayerOp> {
  static displayName = 'PathLayer'
  static description = 'Render a path on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(
        // TODO: Support data schema helpers *and* custom data schemas
        // new ArrayField(new ArrayField(new Point3DField([0, 0, 0], { returnType: 'tuple' })))
      ),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      billboard: new BooleanField(true),
      capRounded: new BooleanField(true),
      getPath: new UnknownField((d: unknown) => d?.path || [], { accessor: true }),
      // getPath: new ArrayField(new Point3DField([0, 0, 0], { returnType: 'tuple' }), { accessor: true }),
      getColor: new ColorField('#006ac6', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(8, { min: 0, softMax: 100, accessor: true }),
      widthUnits: new StringLiteralField('meters', ['pixels', 'meters']),
      widthScale: new NumberField(20, { min: 0, softMax: 100 }),
      widthMinPixels: new NumberField(2, { min: 0, softMax: 100 }),
      parameters: new CompoundPropsField({
        depthWriteEnabled: new BooleanField(true),
      }),
      extensions: new ListField(new ExtensionField()),
      wrapLongitude: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<PathLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<PathLayerProps>(props),
      type: 'PathLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class ScatterplotLayerOp extends Operator<ScatterplotLayerOp> {
  static displayName = 'ScatterplotLayer'
  static description = 'Render a scatterplot of points as circles on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      stroked: new BooleanField(true),
      billboard: new BooleanField(false),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getRadius: new NumberField(20, { min: 0, softMax: 1_000_000, accessor: true }),
      getLineWidth: new NumberField(0, { min: 0, accessor: true }),
      radiusScale: new NumberField(1, { min: 0, softMax: 100 }),
      radiusUnits: new StringLiteralField('pixels', ['pixels', 'meters']),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ScatterplotLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ScatterplotLayerProps>(props),
      type: 'ScatterplotLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class TripsLayerOp extends Operator<TripsLayerOp> {
  static displayName = 'TripsLayer'
  static description = 'Render a set of trips with timestamps for animation on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(
        // TODO: Support data schema helpers *and* custom data schemas
        // new CompoundPropsField({
        //   path: new ArrayField(new Point3DField([0, 0, 0], { returnType: 'tuple' })),
        //   timestamps: new ArrayField(new NumberField(0)),
        // })
      ),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPath: new UnknownField((d: unknown) => d?.path || [], { accessor: true }),
      getTimestamps: new UnknownField((d: unknown) => d?.timestamps || [], { accessor: true }),
      // getPath: new ArrayField(new Point3DField([0, 0, 0], { returnType: 'tuple' }), { accessor: true }),
      // getTimestamps: new ArrayField(new NumberField(0, { min: 0, max: Number.MAX_SAFE_INTEGER }), { accessor: true }),
      getColor: new ColorField('#bfcae3', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(8, { min: 0, softMax: 100, accessor: true }),
      billboard: new BooleanField(false),
      capRounded: new BooleanField(true),
      jointRounded: new BooleanField(true),
      currentTime: new NumberField(0, { min: 0 }),
      fadeTrail: new BooleanField(false),
      trailLength: new NumberField(120, { min: 0 }),
      widthUnits: new StringLiteralField('meters', ['pixels', 'meters']),
      widthMinPixels: new NumberField(2, { min: 0, softMax: 100 }),
      widthScale: new NumberField(20, { min: 0, softMax: 100 }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<TripsLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<TripsLayerProps>(props),
      type: 'TripsLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class SolidPolygonLayerOp extends Operator<SolidPolygonLayerOp> {
  static displayName = 'SolidPolygonLayer'
  static description = 'Render a set of solid polygons on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPolygon: new UnknownField((d: unknown) => d?.polygon || [], { accessor: true }),
      getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(0, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<SolidPolygonLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<SolidPolygonLayerProps>(props),
      type: 'SolidPolygonLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class TextLayerOp extends Operator<TextLayerOp> {
  static displayName = 'TextLayer'
  static description = 'Render a set of text labels on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getText: new StringField('', { accessor: true }),
      billboard: new BooleanField(true),
      fontFamily: new StringField('Inter'),
      fontWeight: new NumberField(400, { min: 100, max: 900, step: 100 }),
      sizeUnits: new StringLiteralField('pixels', ['pixels', 'meters']),
      getSize: new NumberField(48, { min: 0, softMax: 200, accessor: true }),
      getColor: new ColorField('#f0f0f0', { accessor: true, transform: hexToColor }),
      getAngle: new NumberField(0, { softMin: 0, softMax: 360, accessor: true }),
      getTextAnchor: new StringLiteralField('middle', {
        values: ['start', 'middle', 'end'],
        accessor: true,
      }),
      getPixelOffset: new Vec2Field({ x: 0, y: 0 }, { returnType: 'tuple', accessor: true }),
      getAlignmentBaseline: new StringLiteralField('center', {
        values: ['top', 'center', 'bottom'],
        accessor: true,
      }),
      fontSettings: new CompoundPropsField({
        sdf: new BooleanField(false),
        fontSize: new NumberField(64, { min: 8, softMax: 256 }),
        buffer: new NumberField(4, { min: 0, softMax: 20 }),
        radius: new NumberField(12, { min: 0, softMax: 50 }),
        cutoff: new NumberField(0.25, { min: 0, max: 1, step: 0.01 }),
        smoothing: new NumberField(0.1, { min: 0, max: 1, step: 0.01 }),
      }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<TextLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<TextLayerProps>(props),
      type: 'TextLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class IconLayerOp extends Operator<IconLayerOp> {
  static displayName = 'IconLayer'
  static description = 'Render a set of icons on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      iconAtlas: new StringField(
        'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png'
      ),
      iconMapping: new JSONUrlField(
        'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.json'
      ),
      billboard: new BooleanField(true),
      getIcon: new UnknownField(null, { accessor: true }), // Union of { url: string, width: number, height: number } or url: string, plus accessors
      getSize: new NumberField(1, { min: 0, softMax: 100, accessor: true }),
      sizeUnits: new StringLiteralField('pixels', ['pixels', 'meters']),
      sizeScale: new NumberField(1, { min: 0, softMax: 10_000 }),
      sizeMinPixels: new NumberField(0, { min: 0, softMax: 10_000 }),
      sizeMaxPixels: new NumberField(100, { min: 0, softMax: 10_000 }),
      getPixelOffset: new Vec2Field({ x: 0, y: 0 }, { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getAngle: new NumberField(0, { accessor: true }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<IconLayerProps>(),
    }
  }
  execute(_props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const { getIcon, iconMapping, iconAtlas, ...rest } = _props

    const props: IconLayerProps = {
      ...rest,
      ...(typeof getIcon === 'function' ? { getIcon } : { iconMapping, iconAtlas }),
    }

    const layer = {
      ...parseLayerProps<IconLayerProps>(props),
      type: 'IconLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class ScenegraphLayerOp extends Operator<ScenegraphLayerOp> {
  static displayName = 'ScenegraphLayer'
  static description = 'Render a 3D model on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      scenegraph: new JSONUrlField(
        'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/scenegraph-layer/airplane.glb'
      ),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getOrientation: new Vec3Field([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getScale: new Vec3Field([1, 1, 1], { returnType: 'tuple', accessor: true }),
      sizeScale: new NumberField(1, { min: 0, softMax: 10_000 }),
      sizeMinPixels: new NumberField(0, { min: 0, softMax: 100 }),
      sizeMaxPixels: new NumberField(100, { min: 0, softMax: 100 }),
      getColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getTranslation: new Vec3Field([0, 0, 0], { returnType: 'tuple', accessor: true }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ScenegraphLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ScenegraphLayerProps>(props),
      type: 'ScenegraphLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class SimpleMeshLayerOp extends Operator<SimpleMeshLayerOp> {
  static displayName = 'SimpleMeshLayer'
  static description = 'Render simple 3D meshes/models at specified positions'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      mesh: new StringField(
        'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/humanoid_quad.obj'
      ),
      wireframe: new BooleanField(false),
      texture: new UnknownField(null, { optional: true }),
      textureParameters: new DataField(),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getOrientation: new Vec3Field([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getScale: new Vec3Field([1, 1, 1], { returnType: 'tuple', accessor: true }),
      sizeScale: new NumberField(1, { min: 0, softMax: 1000 }),
      getTranslation: new Vec3Field([0, 0, 0], { returnType: 'tuple', accessor: true }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<SimpleMeshLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const ext = extname(props.mesh || '')
    const layer = {
      ...parseLayerProps<SimpleMeshLayerProps>(props),
      loaders: [ext === '.obj' ? OBJLoader : PLYLoader],
      type: 'SimpleMeshLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class H3HexagonLayerOp extends Operator<H3HexagonLayerOp> {
  static displayName = 'H3HexagonLayer'
  static description = 'Render a hexagon grid on the map using the H3 grid system'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getHexagon: new StringField('', { accessor: true }),
      getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getRadius: new NumberField(1, { min: 0, accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<H3HexagonLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<H3HexagonLayerProps>(props),
      type: 'H3HexagonLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class A5LayerOp extends Operator<A5LayerOp> {
  static displayName = 'A5Layer'
  static description =
    'Render filled and/or stroked polygons using the A5 geospatial indexing system'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPentagon: new UnknownField((d: unknown) => d?.pentagon || '', { accessor: true }),
      getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { min: 0, softMax: 100000, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      extruded: new BooleanField(false),
      pickable: new BooleanField(true),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<A5LayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<A5LayerProps>(props),
      type: 'A5Layer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class HeatmapLayerOp extends Operator<HeatmapLayerOp> {
  static displayName = 'HeatmapLayer'
  static description = 'Render a heatmap from points on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
      getWeight: new NumberField(1, { min: 0, accessor: true }),
      aggregation: new StringLiteralField('SUM', { values: ['SUM', 'MEAN'] }),
      radiusPixels: new NumberField(30, { min: 0, softMax: 10_000 }),
      intensity: new NumberField(1, { min: 0, max: 1 }),
      threshold: new NumberField(0.05, { min: 0, max: 1, step: 0.01 }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<HeatmapLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<HeatmapLayerProps>(props),
      type: 'HeatmapLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class GeoJsonLayerOp extends Operator<GeoJsonLayerOp> {
  static displayName = 'GeoJsonLayer'
  static description = 'Render GeoJSON data with points, lines, and polygons'
  static cacheable = false
  createInputs() {
    return {
      data: new GeoJsonField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),

      pointType: new StringLiteralField('circle', {
        values: ['circle', 'icon', 'text', 'circle+text', 'icon+text', 'circle+icon'],
      }),
      getPointRadius: new NumberField(1, { min: 0, softMax: 100000, accessor: true }),
      // pointType: circle
      pointRadiusUnits: new StringLiteralField('meters', ['pixels', 'meters']),
      pointRadiusScale: new NumberField(1, { min: 0, softMax: 100 }),
      pointRadiusMinPixels: new NumberField(0, { min: 0, softMax: 100 }),
      pointRadiusMaxPixels: new NumberField(100, { min: 0, softMax: 1000 }),
      pointRadiusBillboard: new BooleanField(false),

      // pointType: icon

      // pointType: text
      getText: new StringField('', { accessor: true }),
      getTextSize: new NumberField(32, { min: 0, softMax: 200, accessor: true }),
      getTextColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getTextAngle: new NumberField(0, { softMin: 0, softMax: 360, accessor: true }),
      getTextAnchor: new StringLiteralField('middle', {
        values: ['start', 'middle', 'end'],
        accessor: true,
      }),
      getTextAlignmentBaseline: new StringLiteralField('center', {
        values: ['top', 'center', 'bottom'],
        accessor: true,
      }),
      getTextPixelOffset: new Vec2Field({ x: 0, y: 0 }, { returnType: 'tuple', accessor: true }),
      textSizeUnits: new StringLiteralField('pixels', ['pixels', 'meters']),
      textSizeScale: new NumberField(1, { min: 0, softMax: 100 }),
      textSizeMinPixels: new NumberField(0, { min: 0, softMax: 100 }),
      textSizeMaxPixels: new NumberField(100, { min: 0 }),
      textBillboard: new BooleanField(true),
      textFontFamily: new StringField('Monaco, monospace'),
      textFontWeight: new NumberField(400, { min: 100, max: 900, step: 100 }),

      // polygon
      filled: new BooleanField(true),
      getFillColor: new ColorField('#006ac6', { accessor: true, transform: hexToColor }),

      // line
      stroked: new BooleanField(true),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(1, { min: 0, softMax: 100, accessor: true }),
      lineWidthUnits: new StringLiteralField('meters', ['pixels', 'meters']),
      lineWidthScale: new NumberField(1, { min: 0, softMax: 100 }),
      lineWidthMinPixels: new NumberField(0, { min: 0, softMax: 100 }),
      lineWidthMaxPixels: new NumberField(100, { min: 0, softMax: 1000 }),
      lineCapRounded: new BooleanField(false),
      lineJointRounded: new BooleanField(false),
      lineMiterLimit: new NumberField(4, { min: 0, softMax: 10 }),
      lineBillboard: new BooleanField(false),

      // 3d
      extruded: new BooleanField(false),
      wireframe: new BooleanField(false),
      getElevation: new NumberField(1000, { min: 0, softMax: 100000, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      _full3d: new BooleanField(false),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<GeoJsonLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<GeoJsonLayerProps>(props),
      type: 'GeoJsonLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class ArcLayerOp extends Operator<ArcLayerOp> {
  static displayName = 'ArcLayer'
  static description = 'Render a set of arcs on the map'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getSourcePosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getTargetPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getSourceColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getTargetColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      widthUnits: new StringLiteralField('meters', ['pixels', 'meters']),
      getWidth: new NumberField(1, { min: 0, softMax: 100, accessor: true }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<ArcLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<ArcLayerProps>(props),
      type: 'ArcLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

const DEFAULT_COLOR_RANGE = [
  [255, 255, 178],
  [254, 217, 118],
  [254, 178, 76],
  [253, 141, 60],
  [240, 59, 32],
  [189, 0, 38],
]

export class GridLayerOp extends Operator<GridLayerOp> {
  static displayName = 'GridLayer'
  static description = 'Aggregate data into a grid and render as columns'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      cellSize: new NumberField(1000, { min: 1, softMax: 100000 }),

      getColorWeight: new NumberField(1, { min: 0, accessor: true }),
      colorAggregation: new StringLiteralField('SUM', {
        values: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'],
      }),
      // TODO: Support the second agg option, getColorValue?
      colorScaleType: new StringLiteralField('quantize', {
        values: ['linear', 'quantize', 'quantile', 'ordinal'],
      }),
      colorRange: new UnknownField(DEFAULT_COLOR_RANGE, { optional: true }),
      // TODO: Support default color range
      // colorRange: new ArrayField(new ColorField('#fff', { transform: hexToColor }), {
      //   optional: true,
      // }),
      colorDomain: new UnknownField(null, { optional: true }), // number[2] | null for auto
      upperPercentile: new NumberField(100, { min: 0, max: 100, step: 0.1 }),
      lowerPercentile: new NumberField(0, { min: 0, max: 100, step: 0.1 }),

      extruded: new BooleanField(true),
      getElevationWeight: new NumberField(1, { min: 0, accessor: true }),
      elevationAggregation: new StringLiteralField('SUM', {
        values: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'],
      }),
      // TODO: Support the second agg option, getElevationValue?
      elevationScaleType: new StringLiteralField('linear', {
        values: ['linear', 'quantile'],
      }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      elevationRange: new Vec2Field([0, 1000], { returnType: 'tuple' }),
      elevationDomain: new UnknownField(null, { optional: true }), // number[2] | null for auto
      elevationUpperPercentile: new NumberField(100, { min: 0, max: 100, step: 0.1 }),
      elevationLowerPercentile: new NumberField(0, { min: 0, max: 100, step: 0.1 }),

      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      gpuAggregation: new BooleanField(true),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<GridLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // debugger
    const layer = {
      ...parseLayerProps<GridLayerProps>(props),
      type: 'GridLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class HexagonLayerOp extends Operator<HexagonLayerOp> {
  static displayName = 'HexagonLayer'
  static description = 'Aggregate data into hexagonal bins and render as hexagonal columns'
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      radius: new NumberField(1000, { min: 1, softMax: 100000 }),

      getColorWeight: new NumberField(1, { min: 0, accessor: true }),
      colorAggregation: new StringLiteralField('SUM', {
        values: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'],
      }),
      // TODO: Support the second agg option, getColorValue?
      colorScaleType: new StringLiteralField('quantize', {
        values: ['linear', 'quantize', 'quantile', 'ordinal'],
      }),
      colorRange: new UnknownField(DEFAULT_COLOR_RANGE, { optional: true }),
      // TODO: Support default color range
      // colorRange: new ArrayField(new ColorField('#fff', { transform: hexToColor }), {
      //   optional: true,
      // }),
      colorDomain: new UnknownField(null, { optional: true }), // number[2] | null for auto
      upperPercentile: new NumberField(100, { min: 0, max: 100, step: 0.1 }),
      lowerPercentile: new NumberField(0, { min: 0, max: 100, step: 0.1 }),

      extruded: new BooleanField(false),
      getElevationWeight: new NumberField(1, { min: 0, accessor: true }),
      elevationAggregation: new StringLiteralField('SUM', {
        values: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'],
      }),
      // TODO: Support the second agg option, getElevationValue?
      elevationScaleType: new StringLiteralField('linear', {
        values: ['linear', 'quantile'],
      }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      elevationRange: new Vec2Field([0, 1000], { returnType: 'tuple' }),
      elevationDomain: new UnknownField(null, { optional: true }), // number[2] | null for auto
      elevationUpperPercentile: new NumberField(100, { min: 0, max: 100, step: 0.1 }),
      elevationLowerPercentile: new NumberField(0, { min: 0, max: 100, step: 0.1 }),

      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      gpuAggregation: new BooleanField(true),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<HexagonLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<HexagonLayerProps>(props),
      type: 'HexagonLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class Tile3DLayerOp extends Operator<Tile3DLayerOp> {
  static displayName = 'Tile3DLayer'
  static description = 'Render Cesium or Google 3D tiles on the map'
  static cacheable = false
  createInputs() {
    return {
      visible: new BooleanField(true),
      provider: new StringLiteralField('Google', ['Cesium', 'Google']),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      operation: new StringLiteralField('terrain+draw', {
        values: ['terrain+draw', 'draw', 'terrain'],
      }),
      wireframe: new BooleanField(false),
      flatLighting: new BooleanField(true),
      throttleRequests: new BooleanField(false),
      pointSize: new NumberField(1, { min: 0, softMax: 100 }), // Only applies when tile format is 'pnts'
      maxLodMetricValue: new NumberField(2, { min: 0, softMax: 10 }),
      maxScreenSpaceError: new NumberField(50, { min: 0, softMax: 1_000 }),
      maxMemoryUsage: new NumberField(2024, { min: 0, softMax: 10_000 }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<Tile3DLayerProps>(),
    }
  }
  execute({
    flatLighting,
    provider,
    throttleRequests,
    maxMemoryUsage,
    maxScreenSpaceError,
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // TODO: Add a typeahead field with pre-populated values, or the option to add a custom value
    const GOOGLE_TILESET_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json'
    const NYC_CESIUM_TILESET_URL = 'https://assets.ion.cesium.com/242005/tileset.json'

    const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY!
    const CESIUM_ACCESS_TOKEN = import.meta.env.VITE_CESIUM_ACCESS_TOKEN!

    const tilesetUrl = provider === 'Cesium' ? NYC_CESIUM_TILESET_URL : GOOGLE_TILESET_URL

    const loader = provider === 'Cesium' ? CesiumIonLoader : Tiles3DLoader

    const _subLayerProps = flatLighting ? { scenegraph: { _lighting: 'flat' } } : undefined

    const loadOptions =
      provider === 'Google'
        ? { fetch: { headers: { 'X-GOOG-API-KEY': GOOGLE_MAPS_API_KEY } } }
        : provider === 'Cesium'
          ? {
              tileset: {
                throttleRequests,
              },
              'cesium-ion': { accessToken: CESIUM_ACCESS_TOKEN },
            }
          : null

    const onTilesetLoad = (tileset3d: Tileset3D) => {
      tileset3d.maximumMemoryUsage = maxMemoryUsage
      tileset3d.setProps({
        throttleRequests,
        // cullRequestsWhileMoving: false,
        maximumScreenSpaceError: maxScreenSpaceError,
        maximumMemoryUsage: maxMemoryUsage,
      })

      tileset3d.options.onTraversalComplete = selectedTiles => {
        // Signal to renderer that we've finished loading
        // e.g. onDataLoad()

        return selectedTiles
      }
    }

    const layer = {
      ...parseLayerProps<Tile3DLayerProps>(props),
      type: 'Tile3DLayer' as const,
      data: tilesetUrl,
      loader,
      loadOptions,
      onTilesetLoad,
      _subLayerProps,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
    }
    return { layer }
  }
}

export class Mask3DExtensionOp extends Operator<Mask3DExtensionOp> {
  static displayName = 'Mask3DExtension'
  static description = 'Mask a sphere (used with Tile3DLayer)'
  createInputs() {
    return {
      targetPosition: new Vec3Field([0, 0, 0], { returnType: 'tuple' }),
      innerRadius: new NumberField(0, { min: 0, softMax: 10_000 }),
      fadeRange: new NumberField(0, { min: 0, softMax: 10_000 }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'Mask3DExtension' },
      props,
    }
    return { extension }
  }
}

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
      highPrecisionDash: new BooleanField(false),
      offset: new BooleanField(false),
      dashJustified: new BooleanField(false),
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
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'PathStyleExtension', dash, highPrecisionDash, offset },
      props,
    }
    return { extension }
  }
}

class TerrainExtensionOp extends Operator<TerrainExtensionOp> {
  static displayName = 'TerrainExtension'
  static description = 'Render a terrain layer on the map'
  createInputs() {
    return {
      terrainDrawMode: new StringLiteralField('offset', ['offset', 'drape']),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'TerrainExtension' },
      props,
    }
    return { extension }
  }
}

class RasterTileLayerOp extends Operator<RasterTileLayerOp> {
  static displayName = 'RasterTileLayer'
  static description = 'Render a raster tile layer on the map'
  static cacheable = false
  createInputs() {
    return {
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      data: new StringField(
        'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'
      ),
      minZoom: new NumberField(0, { min: 0, max: 24 }),
      maxZoom: new NumberField(24, { min: 0, max: 24 }),
      tileSize: new NumberField(256, { min: 1, softMax: 1024 }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<RasterTileLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<RasterTileLayerProps>(props),
      type: 'TileLayer' as const,
      id: this.id,
      updateTriggers: gatherTriggers(this.inputs, props),
      renderSubLayers: props => {
        const [[west, south], [east, north]] = props.tile.boundingBox
        const { data, ...otherProps } = props

        return [
          new deck.BitmapLayer(otherProps, {
            image: data,
            bounds: [west, south, east, north],
          }),
        ]
      },
    }
    return { layer }
  }
}

class BrightnessContrastExtensionOp extends Operator<BrightnessContrastExtensionOp> {
  static displayName = 'BrightnessContrastExtension'
  static description = 'Adjust brightness and contrast of a layer'
  createInputs() {
    return {
      brightness: new NumberField(0, { min: -1, max: 1, step: 0.01 }),
      contrast: new NumberField(0, { min: -1, max: 1, step: 0.01 }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'BrightnessContrastExtension' },
      props: {
        brightnessContrast: props,
      },
    }
    return { extension }
  }
}

class HueSaturationExtensionOp extends Operator<HueSaturationExtensionOp> {
  static displayName = 'HueSaturationExtension'
  static description = 'Adjust hue and saturation of a layer'
  createInputs() {
    return {
      hue: new NumberField(0, { min: -1, max: 1, step: 0.01 }),
      saturation: new NumberField(0, { min: -1, max: 1, step: 0.01 }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'HueSaturationExtension' },
      props: {
        hueSaturation: props,
      },
    }
    return { extension }
  }
}

class VibranceExtensionOp extends Operator<VibranceExtensionOp> {
  static displayName = 'VibranceExtension'
  static description = 'Adjust vibrance of a layer'
  createInputs() {
    return {
      amount: new NumberField(0, { min: -1, max: 1, step: 0.01 }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'VibranceExtension' },
      props: {
        vibrance: props,
      },
    }
    return { extension }
  }
}

// TODO: Do we want to include the args as a property as well? Source is currently just the function body
type FunctionWithSource = ((...args: unknown[]) => unknown | Promise<unknown>) & { source: string }
// biome-ignore lint/complexity/useArrowFunction: This is a function declaration
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// Count occurrences of a character in a string (for bracket matching)
function countChar(str: string, char: string): number {
  return (str.match(new RegExp(`\\${char}`, 'g')) || []).length
}

// Convert cryptic JS errors to actionable messages based on code analysis
function getFriendlyErrorMessage(jsError: string, userCode: string): string {
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
function fnWithSource(args: string[], body: string, id: string): FunctionWithSource {
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
    // Use console.warn since syntax errors during editing are expected
    console.warn(formatSyntaxError(error, id, body))

    // Strip "return " prefix for user code analysis
    const userCode = body.startsWith('return ') ? body.slice(7) : body

    // Throw error with friendly message for UI display
    const friendlyMessage = getFriendlyErrorMessage(error.message, userCode)
    const FriendlyError = error.constructor as ErrorConstructor
    throw new FriendlyError(friendlyMessage)
  }
}

// An Accessor is an ExpressionOp that returns a function instead of executing it
export class AccessorOp extends Operator<AccessorOp> {
  static displayName = 'Accessor'
  static description =
    'A function called for each row of your data and passed to Deck.gl layer properties. The current row is passed as the `d` variable (e.g., `d.population`, `d.properties.color`). Returns a value that controls visual properties like position, color, or size.'
  createInputs() {
    return {
      expression: new ExpressionField(),
    }
  }
  createOutputs() {
    return {
      accessor: new FunctionField(),
    }
  }
  execute({ expression }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const fn = fnWithSource(
      ['d', 'i', 'data', 'op', ...Object.keys(freeExports)],
      `return ${expression}`,
      this.id
    )
    // https://deck.gl/docs/developer-guide/using-layers#accessors
    const accessor = (d: unknown, dInfo: { index: number; data: unknown; target: number[] }) => {
      // Create a context-aware getOp function for the accessor execution
      const contextualGetOp = (path: string) => getOp(path, this.id)
      return fn(d, dInfo.index, dInfo.data, contextualGetOp, ...Object.values(freeExports))
    }
    return { accessor }
  }
}

export class CodeOp extends Operator<CodeOp> {
  static displayName = 'Code'
  static description =
    'Run custom JavaScript code to transform your data. Available variables: `data` (all input data), `d` (first element), `op()` (access other operators). Includes d3, turf, and other utilities. Use `this` to store state between executions.'
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
    // Replace mustache references with op() calls, handling relative paths
    const processedCode = codeString
      .trim()
      .replace(mustacheRe, (_match, opId, inOut, fieldPath) => {
        return `op('${opId}').${inOut}.${fieldPath}`
      })
    // Create a context-aware getOp function for the code execution
    const contextualGetOp = (path: string) => getOp(path, this.id)
    const fn = fnWithSource(
      ['data', 'd', 'op', ...Object.keys(freeExports)],
      processedCode,
      this.id
    )
    const result = fn.call(this, data, data[0], contextualGetOp, ...Object.values(freeExports))
    const output = result instanceof Promise ? await result : result
    return { data: output }
  }
}

export class ContainerOp extends Operator<ContainerOp> {
  static displayName = 'Container'
  static description = 'Encapsulates a subgraph of operators. Visually groups child nodes.'

  createInputs() {
    return { in: new UnknownField(null, { optional: true }) }
  }

  createOutputs() {
    return { out: new UnknownField(null, { optional: true }) }
  }

  execute(_: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    let outputValue = null
    // The 'in' port of ContainerOp drives its execution.
    // The 'out' port should reflect the value from a GraphOutputOp inside it.
    for (const op of getAllOps()) {
      if (op instanceof GraphOutputOp && isDirectChild(op.id, this.id)) {
        outputValue = op.outputs.propagatedValue.value
        break // Take the first one found
      }
    }
    return { out: outputValue }
  }
}

export class ExpressionOp extends Operator<ExpressionOp> {
  static displayName = 'Expression'
  static description =
    'Evaluate a JavaScript expression to compute a single value. Available variables: `data` (all input data), `d` (first element), `op()` (access other operators). Includes d3, turf, and other utilities.'
  createInputs() {
    return {
      data: new ListField(new DataField()),
      expression: new ExpressionField(),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }
  execute({
    data,
    expression,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const fn = fnWithSource(
      ['data', 'd', 'op', ...Object.keys(freeExports)],
      `return ${expression}`,
      this.id
    )
    // Create a context-aware getOp function for the expression execution
    const contextualGetOp = (path: string) => getOp(path, this.id)

    // Check if any data items are accessor functions
    const hasAccessors = data.some(isAccessor)

    if (hasAccessors) {
      // Return an accessor function that evaluates all data items and applies the expression
      const result = (...args: unknown[]) => {
        const evaluatedData = data.map(item => (isAccessor(item) ? item(...args) : item))
        return fn(evaluatedData, evaluatedData[0], contextualGetOp, ...Object.values(freeExports))
      }
      return { data: result }
    }

    // Static evaluation
    const result = fn(data, data[0], contextualGetOp, ...Object.values(freeExports))
    return { data: result }
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
  execute({ kml }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const geojson = utils.kmlToGeoJson(kml)
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

// ==================== Core Layers (@deck.gl/layers) ====================

export class BitmapLayerOp extends Operator<BitmapLayerOp> {
  static displayName = 'BitmapLayer'
  static description = 'Render a raster image at specified boundaries'
  static cacheable = false
  createInputs() {
    return {
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      image: new StringField(''),
      bounds: new UnknownField([
        [-122.5, 37.7],
        [-122.3, 37.9],
      ]), // [[minLng, minLat], [maxLng, maxLat]] - defaults to SF area
      desaturate: new NumberField(0, { min: 0, max: 1, step: 0.01 }),
      transparentColor: new ColorField(null, { optional: true, transform: hexToColor }),
      tintColor: new ColorField(null, { optional: true, transform: hexToColor }),
      extensions: new ListField(new ExtensionField()),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField<BitmapLayerProps>(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<BitmapLayerProps>(props),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      diskResolution: new NumberField(20, { min: 3, softMax: 100 }),
      vertices: new UnknownField(null, { optional: true }),
      offset: new Vec3Field([0, 0, 0], { returnType: 'tuple' }),
      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(true),
      wireframe: new BooleanField(false),
      flatShading: new BooleanField(false),
      radiusUnits: new StringLiteralField('meters', ['pixels', 'meters']),
      lineWidthUnits: new StringLiteralField('meters', ['pixels', 'meters']),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSize: new NumberField(1000, { min: 1, softMax: 100000 }),
      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      extruded: new BooleanField(true),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      wireframe: new BooleanField(false),
      flatShading: new BooleanField(false),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      widthUnits: new StringLiteralField('pixels', ['pixels', 'meters']),
      widthScale: new NumberField(1, { min: 0, softMax: 100 }),
      widthMinPixels: new NumberField(0, { min: 0, softMax: 100 }),
      widthMaxPixels: new NumberField(100, { min: 0, softMax: 1000 }),
      getSourcePosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getTargetPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(1, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      sizeUnits: new StringLiteralField('pixels', ['pixels', 'meters', 'common']),
      pointSize: new NumberField(10, { min: 0, max: 100 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getNormal: new Vec3Field([0, 0, 1], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(true),
      extruded: new BooleanField(false),
      wireframe: new BooleanField(false),
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      lineWidthUnits: new StringLiteralField('meters', ['pixels', 'meters']),
      lineWidthScale: new NumberField(1, { min: 0, softMax: 100 }),
      lineWidthMinPixels: new NumberField(0, { min: 0, softMax: 100 }),
      lineWidthMaxPixels: new NumberField(100, { min: 0, softMax: 1000 }),
      lineJointRounded: new BooleanField(false),
      lineMiterLimit: new NumberField(4, { min: 0, softMax: 10 }),
      getPolygon: new UnknownField((d: unknown) => d?.polygon || [], { accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getElevation: new NumberField(1000, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSize: new NumberField(1000, { min: 1, softMax: 100000 }),
      gpuAggregation: new BooleanField(true),
      aggregation: new StringLiteralField('SUM', { values: ['SUM', 'MEAN', 'MIN', 'MAX'] }),
      contours: new UnknownField([
        { threshold: 1, color: [255, 0, 0] },
        { threshold: 5, color: [0, 255, 0] },
        { threshold: 10, color: [0, 0, 255] },
      ]),
      zOffset: new NumberField(0.005, { min: 0, max: 1, step: 0.001 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getWeight: new NumberField(1, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      cellSizePixels: new NumberField(50, { min: 1, softMax: 1000 }),
      cellMarginPixels: new NumberField(2, { min: 0, softMax: 100 }),
      colorRange: new UnknownField(DEFAULT_COLOR_RANGE, { optional: true }),
      colorDomain: new UnknownField(null, { optional: true }),
      aggregation: new StringLiteralField('SUM', { values: ['SUM', 'MEAN', 'MIN', 'MAX'] }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getWeight: new NumberField(1, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      numSegments: new NumberField(20, { min: 1, softMax: 100 }),
      widthUnits: new StringLiteralField('pixels', ['pixels', 'meters']),
      widthScale: new NumberField(1, { min: 0, softMax: 100 }),
      widthMinPixels: new NumberField(0, { min: 0, softMax: 100 }),
      widthMaxPixels: new NumberField(100, { min: 0, softMax: 1000 }),
      getSourcePosition: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
      getTargetPosition: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
      getSourceColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getTargetColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(1, { min: 0, accessor: true }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getHexagons: new UnknownField((d: unknown) => d?.hexagons || [], { accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { accessor: true }),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
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
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
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
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
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
      elevationScale: new NumberField(1, { min: 0, softMax: 100 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      extruded: new BooleanField(false),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new StringField('https://example.com/tiles/{z}/{x}/{y}.mvt'),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      minZoom: new NumberField(0, { min: 0, max: 24 }),
      maxZoom: new NumberField(24, { min: 0, max: 24 }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false),
      lineWidthMinPixels: new NumberField(1, { min: 0 }),
      getFillColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
      getPointRadius: new NumberField(1, { accessor: true }),
      pointRadiusUnits: new StringLiteralField('pixels', ['pixels', 'meters']),
      extensions: new ListField(new ExtensionField()),
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

export class TerrainLayerOp extends Operator<TerrainLayerOp> {
  static displayName = 'TerrainLayer'
  static description = 'Render a terrain mesh from heightmap tiles'
  static cacheable = false
  createInputs() {
    return {
      elevationData: new StringField('https://example.com/elevation/{z}/{x}/{y}.png'),
      texture: new StringField('', { optional: true }),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      meshMaxError: new NumberField(4, { min: 0, softMax: 100 }),
      elevationDecoder: new CompoundPropsField({
        rScaler: new NumberField(1),
        gScaler: new NumberField(0),
        bScaler: new NumberField(0),
        offset: new NumberField(0),
      }),
      bounds: new UnknownField(null, { optional: true }),
      color: new ColorField('#ffffff', { transform: hexToColor }),
      wireframe: new BooleanField(false),
      extensions: new ListField(new ExtensionField()),
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
  static cacheable = false
  createInputs() {
    return {
      data: new StringField('https://example.com/tiles/{z}/{x}/{y}'),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      minZoom: new NumberField(0, { min: 0, max: 24 }),
      maxZoom: new NumberField(24, { min: 0, max: 24 }),
      tileSize: new NumberField(256, { min: 1, softMax: 1024 }),
      maxCacheSize: new NumberField(Infinity, { optional: true }),
      maxCacheByteSize: new NumberField(Infinity, { optional: true }),
      refinementStrategy: new StringLiteralField('best-available', {
        values: ['best-available', 'no-overlap', 'never'],
      }),
      zRange: new UnknownField([0, 24], { optional: true }),
      extent: new UnknownField([-Infinity, -Infinity, Infinity, Infinity], { optional: true }),
      renderSubLayers: new FunctionField(null, { optional: true }),
      extensions: new ListField(new ExtensionField()),
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

export class CollisionFilterExtensionOp extends Operator<CollisionFilterExtensionOp> {
  static displayName = 'CollisionFilterExtension'
  static description = 'Hide overlapping objects (e.g., labels)'
  createInputs() {
    return {
      collisionEnabled: new BooleanField(true),
      collisionGroup: new StringField('default'),
      getCollisionPriority: new NumberField(0, { accessor: true }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'CollisionFilterExtension' },
      props,
    }
    return { extension }
  }
}

export class DataFilterExtensionOp extends Operator<DataFilterExtensionOp> {
  static displayName = 'DataFilterExtension'
  static description = 'Filter data by one or more numeric ranges'
  createInputs() {
    return {
      filterSize: new NumberField(2, { min: 1, max: 4, step: 1 }),
      filterEnabled: new BooleanField(true),
      filterRange: new UnknownField([
        [0, 1],
        [0, 1],
      ]), // Array of [min, max] pairs
      filterSoftRange: new UnknownField(null, { optional: true }),
      filterTransformSize: new BooleanField(true),
      filterTransformColor: new BooleanField(true),
      getFilterValue: new UnknownField((_d: unknown) => [0, 0], { accessor: true }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute({
    filterSize,
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'DataFilterExtension', filterSize },
      props,
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
      fillPatternMask: new BooleanField(true),
      fillPatternAtlas: new StringField('', { optional: true }),
      fillPatternMapping: new UnknownField(null, { optional: true }),
      getFillPattern: new UnknownField(null, { accessor: true }),
      getFillPatternScale: new NumberField(1, { accessor: true }),
      getFillPatternOffset: new Vec2Field([0, 0], { returnType: 'tuple', accessor: true }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute({
    fillPatternEnabled,
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'FillStyleExtension', pattern: fillPatternEnabled },
      props,
    }
    return { extension }
  }
}

export class MaskExtensionOp extends Operator<MaskExtensionOp> {
  static displayName = 'MaskExtension'
  static description = 'Show/hide layer objects by a geofence'
  createInputs() {
    return {
      maskId: new StringField(''),
      maskByInstance: new BooleanField(false),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const extension = {
      extension: { type: 'MaskExtension' },
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

  // Interpolate all numeric fields
  const result: Record<string, number> = {}
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

  for (const key of allKeys) {
    const beforeVal = before[key] ?? 0
    const afterVal = after[key] ?? 0
    result[key] = beforeVal + (afterVal - beforeVal) * factor
  }

  return result
}

export class TimeSeriesOp extends Operator<TimeSeriesOp> {
  static displayName = 'TimeSeries'
  static description =
    'Interpolate time-varying data at a given time. Aligns with TripsLayer API for easy reuse of accessors.'
  asDownload = () => this.outputData
  createInputs() {
    return {
      data: new DataField(),
      currentTime: new NumberField(0),
      getTimestamps: new UnknownField(
        (d: unknown) => (d as { timestamps?: unknown[] })?.timestamps || [],
        { accessor: true }
      ),
      getValues: new UnknownField((d: unknown) => (d as { values?: unknown[] })?.values || [], {
        accessor: true,
      }),
      getProperties: new UnknownField((d: unknown) => d, { accessor: true, optional: true }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(),
    }
  }

  execute({
    data,
    currentTime,
    getTimestamps,
    getValues,
    getProperties,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    if (!Array.isArray(data) || !data.length) {
      return { data: [] }
    }

    type DeckAccessor<T> = (
      d: unknown,
      info: { index: number; data: unknown; target: unknown[] }
    ) => T

    return {
      data: data.map((d, i) => {
        // Call accessors with proper deck.gl accessor signature
        const timestamps = (getTimestamps as DeckAccessor<number[]>)(d, {
          index: i,
          data,
          target: [],
        })
        const values = (getValues as DeckAccessor<unknown[]>)(d, {
          index: i,
          data,
          target: [],
        })
        const properties = getProperties
          ? (getProperties as DeckAccessor<Record<string, unknown>>)(d, {
              index: i,
              data,
              target: [],
            })
          : {}

        // Convert values array to timeSeries format for interpolation
        const timeSeries = timestamps.map((time: number, idx: number) => ({
          time,
          ...(values[idx] || {}),
        }))

        const interpolated = interpolateTimeSeries(timeSeries, currentTime)

        return {
          ...properties,
          ...interpolated,
          time: currentTime,
        }
      }),
    }
  }
}

export const opTypes = {
  AccessorOp,
  A5LayerOp,
  ArcOp,
  ArcLayerOp,
  BezierCurveOp,
  BitmapLayerOp,
  BooleanOp,
  BoundingBoxOp,
  BoundsOp,
  BrightnessContrastExtensionOp,
  BrushingExtensionOp,
  CategoricalColorRampOp,
  ClipExtensionOp,
  CodeOp,
  CollisionFilterExtensionOp,
  ColorOp,
  ColorRampOp,
  ColumnLayerOp,
  CombineRGBAOp,
  CombineXYOp,
  CombineXYZOp,
  ConcatOp,
  ConsoleOp,
  ContainerOp,
  ContourLayerOp,
  DataFilterExtensionOp,
  DateTimeOp,
  DeckRendererOp,
  DirectionsOp,
  DuckDbOp,
  ExpressionOp,
  ExtentOp,
  FileOp,
  FillStyleExtensionOp,
  FilterOp,
  FirstPersonViewOp,
  ForLoopBeginOp,
  ForLoopEndOp,
  ForLoopMetaOp,
  FpsWidgetOp,
  GeocoderOp,
  GeohashLayerOp,
  GeoJsonOp,
  GeoJsonLayerOp,
  GeoJsonTransformOp,
  GlobeViewOp,
  GraphInputOp,
  GraphOutputOp,
  GreatCircleLayerOp,
  GridCellLayerOp,
  GridLayerOp,
  H3ClusterLayerOp,
  H3HexagonLayerOp,
  HeatmapLayerOp,
  HexagonLayerOp,
  HSLOp,
  HueSaturationExtensionOp,
  IconLayerOp,
  JSONOp,
  KmlToGeoJsonOp,
  LayerPropsOp,
  LineLayerOp,
  MaplibreBasemapOp,
  MapRangeOp,
  MapStyleOp,
  MapViewOp,
  MapViewStateOp,
  Mask3DExtensionOp,
  MaskExtensionOp,
  MathOp,
  MergeOp,
  MouseOp,
  MVTLayerOp,
  NetworkOp,
  NumberOp,
  OrbitViewOp,
  OrthographicViewOp,
  OutOp,
  PathLayerOp,
  PathStyleExtensionOp,
  PointCloudLayerOp,
  PointOp,
  PolygonLayerOp,
  ProjectOp,
  QuadkeyLayerOp,
  RandomizeAttributeOp,
  RasterTileLayerOp,
  RectangleOp,
  S2LayerOp,
  ScatterOp,
  ScatterplotLayerOp,
  ScenegraphLayerOp,
  ScreenGridLayerOp,
  SimpleMeshLayerOp,
  SelectOp,
  SliceOp,
  SolidPolygonLayerOp,
  SortOp,
  SplitRGBAOp,
  SplitMapViewStateOp,
  SplitXYOp,
  SplitXYZOp,
  StringOp,
  SwitchOp,
  TableEditorOp,
  TerrainExtensionOp,
  TerrainLayerOp,
  TextLayerOp,
  Tile3DLayerOp,
  TileLayerOp,
  TimeOp,
  TimeSeriesOp,
  TripsLayerOp,
  UnprojectOp,
  VibranceExtensionOp,
  ViewerOp,
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
      lastExecuted: Date
      executionTime: number
    }
  | {
      status: 'error'
      lastExecuted?: Date
      executionTime?: number
      error?: string
    }

export type OpType = keyof typeof opTypes

export type SpecialNodeType = 'group'

// Allow `op('num).par.foo` to be used in code blocks
function proxyFields(op: Operator<IOperator>, fields: 'inputs' | 'outputs') {
  return new Proxy(op, {
    get(target, prop: string | symbol) {
      return target[fields][prop as string].value
    },
    set(_target, _prop: string | symbol, _value) {
      throw new Error('Cannot set value on par or out')
    },
  }) as unknown as (typeof op)[typeof fields]
}

// For convenience in code / expression blocks
const freeExports = {
  utils,
  d3,
  turf,
  deck,
  Plot,
  vega,
  Temporal,
  // studio,
  ...opTypes,
}
