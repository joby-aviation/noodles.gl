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
import * as duckdb from '@duckdb/duckdb-wasm'
import { getRenderSurfaceSize, subscribeToRenderSurfaceSize } from '../render/render-surface-size'
import { getTransformScaleFactor } from '../render/transform-scale'
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
import { getAllOps, getOp } from './store'
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
import './utils/field-expressions'
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

// Pull-based execution status
export enum PullExecutionStatus {
  CLEAN = 'clean', // Valid cached output
  DIRTY = 'dirty', // Needs re-execution
  COMPUTING = 'computing', // Currently executing
  ERROR = 'error', // Execution failed
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

  // Dirty flag for GraphExecutor
  dirty = true

  // === Field visibility ===
  // Per-instance visible fields (null = use defaults from field.showByDefault)
  visibleFields = new BehaviorSubject<Set<string> | null>(null)

  // === Pull-based execution additions ===
  // Global dirty epoch for markDirty wave pruning. Incremented whenever ANY
  // operator's status transitions away from DIRTY (see
  // _setPullExecutionStatus) and whenever the dependency graph gains an edge
  // (see addDownstreamDependent). See markDirty for the pruning invariant.
  private static _dirtyEpoch = 0

  // Execution status for pull-based model
  private _pullExecutionStatus: PullExecutionStatus = PullExecutionStatus.DIRTY
  // Epoch of the markDirty wave that last marked this operator (see markDirty)
  private _dirtyMarkEpoch = -1
  private _cachedOutput: ExtractProps<(typeof this)['outputs']> | null = null
  private _lastExecutionTime = 0
  private _computingPromise: Promise<ExtractProps<(typeof this)['outputs']>> | null = null
  private _lastLoggedError: string | null = null
  // True once the output fields hold a real result, from an execution or the project cache.
  // A locked operator serves that result instead of executing again.
  private _hasOutput = false

  // Dependency tracking for pull-based model
  private _upstreamDependencies: Set<Operator<IOperator>> = new Set()
  private _downstreamDependents: Set<Operator<IOperator>> = new Set()

  // True from the moment a pull starts. executionState only reports 'executing'
  // after 200ms, so it reads idle while a fetch is just getting going.
  get isComputing(): boolean {
    return this._computingPromise !== null
  }

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

    // Unlocking catches up on any input changes that arrived while locked
    this.subs.push(
      this.locked.pipe(skip(1), distinctUntilChanged()).subscribe(isLocked => {
        if (!isLocked) this.markDirty('unlocked')
      })
    )
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

  get hasOutput(): boolean {
    return this._hasOutput
  }

  // Put known output values back without executing, e.g. when undo relocks an operator.
  // A locked operator then serves them from pull(). Values are trusted, not schema-checked.
  setOutputValues(values: Record<string, unknown>) {
    for (const [key, field] of Object.entries(this.outputs)) {
      if (key in values && field.value !== values[key]) field.next(values[key])
    }
    this._hasOutput = true
  }

  // Restore the outputs a locked operator was saved with, so it can serve them without
  // executing. Returns false and changes nothing if a saved value no longer fits its field.
  restoreOutputs(outputs: Record<string, unknown>): boolean {
    const unknownKey = Object.keys(outputs).find(key => !(key in this.outputs))
    if (unknownKey) {
      debugExecute('%s: saved output %s has no field, will execute', this.id, unknownKey)
      return false
    }
    const restored: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(this.outputs)) {
      const parsed = parseSavedOutput(field, outputs[key])
      if (!parsed.success) {
        debugExecute('%s: saved output %s no longer fits, will execute', this.id, key)
        return false
      }
      restored[key] = parsed.data
    }
    this.setOutputValues(restored)
    return true
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

  // Pull data from this operator, executing if needed (pull-based model)
  async pull(): Promise<ExtractProps<(typeof this)['outputs']>> {
    // A locked operator keeps its last result: no upstream pulls, no execute(). It still
    // executes once if it has never produced output (e.g. its outputs couldn't be cached).
    if (this.locked.value && this._hasOutput && this._computingPromise === null) {
      debugPull('%s: locked -> last output', this.id)
      this._cachedOutput = this.outputData
      this._setPullExecutionStatus(PullExecutionStatus.CLEAN)
      this.dirty = false
      return this._cachedOutput
    }

    // Return cached if clean
    if (this._pullExecutionStatus === PullExecutionStatus.CLEAN && this._cachedOutput !== null) {
      debugPull('%s: %s -> cached', this.id, PullExecutionStatus.CLEAN)
      return this._cachedOutput
    }

    // Wait for ongoing computation. Guard on _computingPromise alone, not on
    // status === COMPUTING: a markDirty arriving mid-execution resets the
    // status to DIRTY while a computation is still in flight, and falling
    // through here would start a second concurrent _pullExecution for the
    // same operator. The DIRTY status survives completion of the in-flight
    // run (see _pullExecution), so the next pull after it settles will
    // re-execute with the fresh inputs.
    if (this._computingPromise !== null) {
      debugPull('%s: %s -> waiting', this.id, this._pullExecutionStatus)
      return this._computingPromise
    }

    // Handle error state
    if (this._pullExecutionStatus === PullExecutionStatus.ERROR) {
      debugPull('%s: %s -> error', this.id, PullExecutionStatus.ERROR)
      throw new Error(`Operator ${this.id} is in error state`)
    }

    debugPull('%s: %s -> executing', this.id, this._pullExecutionStatus)

    // Mark as computing
    this._setPullExecutionStatus(PullExecutionStatus.COMPUTING)

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
    debugExecute('%s: starting %O', this.id, { inputs: this.data })

    let executionTime = 0
    let startTime = 0
    // Show executing indicator only for ops taking longer than 200ms
    const executingTimer = setTimeout(() => {
      this.executionState.next({ status: 'executing' })
    }, 200)

    try {
      // Pull upstream dependencies first
      await this._pullUpstreamDependencies()

      // Get current input values (eager snapshot of all input fields)
      const inputValues = this.data

      // Absorb dirty marks that arrived before the snapshot: value
      // propagation from the upstream pulls above lands via setValue ->
      // markDirty while we are COMPUTING, but those values are captured in
      // the snapshot we just took, so they don't invalidate this execution.
      // Marks arriving from here on (e.g. an async upstream resolving while
      // execute() awaits) are NOT reflected in the snapshot and must keep the
      // operator dirty — see the completion check below.
      this._setPullExecutionStatus(PullExecutionStatus.COMPUTING)

      // Debug breakpoint - pause execution if enabled
      if (this.breakpointEnabled.value) {
        console.log(`[Breakpoint] Pausing execution at operator: ${this.id}`, {
          inputs: inputValues,
          operator: this,
        })
        debugger
      }

      // Execute the operator - measure only own execution time
      startTime = performance.now()
      const result = this.execute(inputValues)
      const finalResult = result instanceof Promise ? await result : result
      executionTime = performance.now() - startTime

      if (finalResult === null) {
        throw new Error(`Operator ${this.id} returned null`)
      }

      clearTimeout(executingTimer)

      // Cache result and mark clean — but only transition COMPUTING -> CLEAN.
      // If a markDirty arrived after the input snapshot (status was reset to
      // DIRTY mid-flight), or an upstream dependency finished this frame
      // DIRTY (its fresh data has not flowed into our inputs yet), the result
      // we just computed is already stale — e.g. a FileOp resolving its CSV
      // during this same frame's pull walk. Setting CLEAN unconditionally
      // here clobbered that mark (lost update): the operator then served the
      // stale cache forever because pull() never re-executes a CLEAN op.
      // Leave it DIRTY so the next frame re-executes with the new inputs.
      const markedAfterSnapshot = this._pullExecutionStatus !== PullExecutionStatus.COMPUTING
      this._cachedOutput = finalResult
      if (markedAfterSnapshot || this._hasDirtyUpstreamDependency()) {
        debugPull('%s: dirtied mid-execution, staying dirty for re-execution', this.id)
        this._setPullExecutionStatus(PullExecutionStatus.DIRTY)
        this.dirty = true
      } else {
        this._setPullExecutionStatus(PullExecutionStatus.CLEAN)
        this.dirty = false // Also clear the dirty flag for GraphExecutor
      }
      this._lastExecutionTime = executionTime
      this._hasOutput = true

      debugExecute('%s: %dms %O', this.id, this._lastExecutionTime.toFixed(2), {
        outputs: finalResult,
      })

      // Update execution state for UI
      this.executionState.next({
        status: 'success',
        lastExecuted: Date.now(),
        executionTime: executionTime,
      })

      // Clear any stale connection errors on successful execution
      // This handles cases where validation errors were added during transient failures
      if (this.connectionErrors.value.size > 0) {
        this.connectionErrors.next(new Map())
      }

      // Update output fields for UI/debugging purposes only
      // In pull mode, this is not for propagation but for inspection
      for (const [key, field] of Object.entries(this.outputs)) {
        const newValue = finalResult[key]
        const currentValue = field.value

        // Use deep equality for fields that opt-in, otherwise use reference equality
        const hasChanged = field.useDeepEquality
          ? typeof newValue === 'object' && newValue !== null
            ? !deepEqual(currentValue, newValue, field.maxDepth)
            : currentValue !== newValue
          : currentValue !== newValue

        if (hasChanged) {
          field.next(newValue)
        }
      }

      return finalResult
    } catch (err) {
      clearTimeout(executingTimer)
      const error = err instanceof Error ? err : new Error(String(err))

      // Calculate actual elapsed time even on error
      executionTime = performance.now() - startTime

      // Only log if this is a new/different error
      if (this._lastLoggedError !== error.message) {
        debugExecute('%s: ERROR - %s', this.id, error.message)
        debugPull(
          `Pull execution failure in [${this.id} (${(this.constructor as typeof Operator).displayName})]:`,
          error.message
        )
        console.error(`[Noodles] Operator ${this.id} error:`, error)
        this._lastLoggedError = error.message
      }

      // Set ERROR unconditionally, even if a markDirty arrived mid-execution.
      // Unlike the success path we deliberately let ERROR win over a
      // mid-flight DIRTY: markDirty clears ERROR back to DIRTY on the next
      // wave anyway (any future input change retries), while preserving DIRTY
      // here would silently retry a failing operator every frame.
      this._setPullExecutionStatus(PullExecutionStatus.ERROR)
      this._cachedOutput = null

      // Update execution state for UI
      this.executionState.next({
        status: 'error',
        lastExecuted: Date.now(),
        executionTime: executionTime,
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

  // True if any upstream dependency is DIRTY. Used at execution completion:
  // an upstream that ended this frame dirty (e.g. its async data arrived
  // mid-pull) has fresh data that our just-taken input snapshot missed, so we
  // must not mark ourselves CLEAN on top of it.
  //
  // NOTE: this check is intentionally approximate. It scans the flat upstream
  // set, so it can fire on UNRELATED upstream dirtiness: an upstream marked
  // dirty by a separate source after we pulled it keeps us DIRTY for one
  // extra frame even though our snapshot already captured everything we
  // needed from it. That direction of error is always SAFE — one redundant
  // re-execution next frame — whereas the opposite direction (declaring CLEAN
  // over an upstream whose new data we missed) recreates the permanent
  // stale-cache dirty island. Do not narrow this check (e.g. by tracking
  // which upstream each snapshot value came from) without revisiting the
  // lost-update soundness argument in _pullExecution's completion path.
  private _hasDirtyUpstreamDependency(): boolean {
    for (const dep of this._upstreamDependencies) {
      if (dep._pullExecutionStatus === PullExecutionStatus.DIRTY) {
        return true
      }
    }
    return false
  }

  // Single write point for _pullExecutionStatus. Bumps the global dirty epoch
  // whenever a status transitions AWAY from DIRTY — that is precisely the
  // event that can invalidate the markDirty prune ("this op and its whole
  // downstream closure are still dirty"): a wave's claim about its closure
  // only breaks when something in it becomes clean. Route every status
  // assignment through this helper so a future write site cannot silently
  // skip the bump.
  private _setPullExecutionStatus(status: PullExecutionStatus): void {
    if (
      this._pullExecutionStatus === PullExecutionStatus.DIRTY &&
      status !== PullExecutionStatus.DIRTY
    ) {
      Operator._dirtyEpoch++
    }
    this._pullExecutionStatus = status
  }

  // Mark this operator as dirty and propagate downstream.
  //
  // WHY the wave must always propagate: an earlier version early-returned when
  // an operator was already DIRTY, assuming the invariant "if I'm dirty,
  // everything downstream of me is already dirty". That invariant breaks when
  // async data arrival interleaves with frame pulls: a frame pull can clean
  // the sink chain while an intermediate operator is re-marked dirty, so when
  // upstream data later arrives (e.g. a FileOp resolving a CSV) the dirty wave
  // stops at the already-dirty intermediate and never reaches the CLEAN sink.
  // The sink then returns its cached output forever and the dirty island is
  // never re-executed. Propagating unconditionally restores soundness.
  //
  // WHY the visited set: container bridge edges (container -> GraphInput ->
  // child -> GraphOutput -> container) create node-level dependency cycles, so
  // unconditional recursion would overflow the stack. Walking iteratively with
  // a visited set marks each operator at most once per wave, terminating on
  // cycles without relying on prior dirty state.
  //
  // WHY the epoch prune is sound: an op that is DIRTY with a stamp from the
  // CURRENT epoch was marked by a wave in this epoch, and that wave walked the
  // op's entire downstream closure (marking or pruning inductively). The epoch
  // only stays current while no operator anywhere transitions away from DIRTY
  // (_setPullExecutionStatus) and no dependency edge is added
  // (addDownstreamDependent) — so the closure is provably still all-DIRTY and
  // re-walking it is redundant. This locally re-establishes the old
  // "dirty implies downstream dirty" invariant: it was CLEANING interleaved
  // with marks that broke it, and cleaning is exactly what bumps the epoch and
  // disables the prune. The global epoch is deliberately coarse (any op
  // leaving DIRTY anywhere disables pruning until the next wave re-stamps);
  // correctness first — the hot path (repeated marks between two frame pulls,
  // e.g. timeline scrubbing keyframed ops) stays O(1) per repeated mark.
  markDirty(cause?: Field | string): void {
    // Stack capture is intentionally gated behind a separate namespace so
    // ordinary `noodles:*` logging cannot add work to this hot path.
    if (debugDirtyTrace.enabled) {
      const source =
        typeof cause === 'string'
          ? cause
          : cause?.pathToProps.length
            ? cause.pathToProps.join('.')
            : 'direct call'
      const stack = new Error().stack?.split('\n').slice(2).join('\n') ?? 'stack unavailable'
      debugDirtyTrace(
        '%s: %s -> dirty; source=%s; downstream=%d\n%s',
        this.id,
        this._pullExecutionStatus,
        source,
        this._downstreamDependents.size,
        stack
      )
    }

    const epoch = Operator._dirtyEpoch
    const visited = new Set<Operator<IOperator>>()
    const stack: Operator<IOperator>[] = [this as Operator<IOperator>]

    while (stack.length > 0) {
      const op = stack.pop()
      if (op === undefined || visited.has(op)) continue
      visited.add(op)

      // Prune: already marked by a wave in the current epoch and still dirty,
      // so its whole downstream closure is still dirty (see comment above)
      if (op._pullExecutionStatus === PullExecutionStatus.DIRTY && op._dirtyMarkEpoch === epoch) {
        debugDirty('%s already marked in epoch %d, pruning wave', op.id, epoch)
        continue
      }

      // Log recovery from error state
      if (op._pullExecutionStatus === PullExecutionStatus.ERROR) {
        debugDirty('%s cleared from error state', op.id)
        op._lastLoggedError = null
      }

      debugDirty(
        '%s marked dirty, propagating to %d downstream',
        op.id,
        op._downstreamDependents.size
      )

      op._setPullExecutionStatus(PullExecutionStatus.DIRTY)
      op._dirtyMarkEpoch = epoch
      op._cachedOutput = null
      op.dirty = true // Also set the dirty flag for GraphExecutor

      // Propagate dirty flag to downstream dependents
      for (const dependent of op._downstreamDependents) {
        if (!visited.has(dependent)) {
          stack.push(dependent)
        }
      }
    }
  }

  // Add upstream dependency (for pull-based model)
  addUpstreamDependency(op: Operator<IOperator>): void {
    this._upstreamDependencies.add(op)
  }

  // Add downstream dependent (for pull-based model)
  addDownstreamDependent(op: Operator<IOperator>): void {
    this._downstreamDependents.add(op)
    // A new edge grows downstream closures, so a wave stamped before this
    // edge existed never walked the new dependent — invalidate the prune.
    // (Removing an edge only shrinks closures and stays sound.)
    Operator._dirtyEpoch++
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

  // Set cached output and mark clean (for use by GraphExecutor ForLoop handling)
  setCachedOutput(output: ExtractProps<(typeof this)['outputs']>): void {
    this._cachedOutput = output
    this._setPullExecutionStatus(PullExecutionStatus.CLEAN)
    this.dirty = false
  }

  // Clear cached output and mark dirty. NOTE: deliberately does not stamp
  // _dirtyMarkEpoch — this sets DIRTY without walking downstream, so future
  // waves must not prune at this operator.
  clearCache(): void {
    this._cachedOutput = null
    this._setPullExecutionStatus(PullExecutionStatus.DIRTY)
    this.dirty = true
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
            // Debug breakpoint - pause execution if enabled
            if (this.breakpointEnabled.value) {
              console.log(`[Breakpoint] Pausing execution at operator: ${this.id}`, {
                inputs: inputValues,
                operator: this,
              })
              debugger
            }

            const result = this.execute(inputValues)
            const finalResult = result instanceof Promise ? await result : result

            // Set success state
            const executionTime = performance.now() - startTime
            this.executionState.next({
              status: 'success',
              lastExecuted: Date.now(),
              executionTime,
            })

            return finalResult
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err))
            debugExecute(
              `Failure in [${this.id} (${(this.constructor as typeof Operator).displayName})]:`,
              error.message,
              error.stack
            )
            this.onError(error)

            // Set error state
            const executionTime = performance.now() - startTime
            this.executionState.next({
              status: 'error',
              lastExecuted: Date.now(),
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
          const oldValue = field.value
          const newValue = outputValues[key]

          // Use deep equality for fields that opt-in, otherwise use reference equality
          const hasChanged = field.useDeepEquality
            ? typeof newValue === 'object' && newValue !== null
              ? !deepEqual(oldValue, newValue, field.maxDepth)
              : oldValue !== newValue
            : oldValue !== newValue

          if (hasChanged) {
            // Skip schema validation on outputs
            field.next(newValue)
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
    // Users named these fields themselves, so show the name as typed rather than humanized
    const field = new FieldClass(def.defaultValue, { label: def.name, ...def.options })
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
    this.markDirty()
  }

  // Remove custom field
  removeCustomInput(id: string): void {
    this.customInputDefinitions = this.customInputDefinitions.filter(d => d.id !== id)
    this.rebuildInputs()
    this.markDirty()
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
      this.markDirty()
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

    // Cleanup expression-mode subscriptions (sibling/timeline reactivity)
    for (const field of Object.values(this.inputs)) {
      field.expressionCleanup?.()
    }

    // Cleanup timeline subscriptions
    unsubscribeOpFromTimeline(this.id)
  }
}

// UnknownOperator is a special system operator that serves as a fallback when loading
// projects with removed or unavailable operator types. It is intentionally NOT included
// in categories.ts because it should never be user-creatable - it's only instantiated
// automatically during project deserialization for backward compatibility.
export class UnknownOperator extends Operator<UnknownOperator> {
  static displayName = 'Unknown Operator'
  static description = 'Placeholder for an operator type that could not be found'

  originalType: string
  // The node's saved data (inputs, locked, customInputs, ...), written back unchanged on save
  // so the project still opens once the operator type is available again
  originalData: Record<string, unknown>

  constructor(id: OpId, data?: Record<string, unknown>) {
    super(id, {}, false)
    const { originalType, ...originalData } = data ?? {}
    this.originalType = (originalType as string) || 'Unknown'
    this.originalData = originalData
  }

  createInputs() {
    return {}
  }

  createOutputs() {
    return {}
  }

  execute() {
    return {}
  }
}

export class NumberOp extends Operator<NumberOp> {
  static displayName = 'Number'
  static description = 'A number'
  public createInputs() {
    return {
      val: new NumberField(0, {
        step: 1,
        deriveStepFromValue: true,
        label: 'Value',
        description: 'The number to output.',
      }),
    }
  }
  public createOutputs() {
    return {
      val: new NumberField(undefined, { label: 'Value', description: 'The number entered above.' }),
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
      val: new NumberField(0, {
        step: 0.01,
        accessor: true,
        label: 'Value',
        description: 'The number to remap. Accepts a per-item accessor.',
      }),
      inMin: new NumberField(0, { step: 0.1, description: 'Input value that maps to Out min.' }),
      inMax: new NumberField(1, { step: 0.1, description: 'Input value that maps to Out max.' }),
      outMin: new NumberField(0, { step: 0.1, description: 'Output value for In min.' }),
      outMax: new NumberField(1, { step: 0.1, description: 'Output value for In max.' }),
    }
  }
  public createOutputs() {
    return {
      scaled: new NumberField(undefined, {
        description:
          'Value mapped linearly to the output range. Values outside the input range are not clamped.',
      }),
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
      data: new DataField(undefined, { description: 'Array of values or rows to scan.' }),
      accessor: new UnknownField((d: unknown) => d, {
        accessor: true,
        optional: true,
        description: 'Picks the number to compare from each item. Defaults to the item itself.',
      }),
    }
  }
  createOutputs() {
    return {
      min: new NumberField(undefined, {
        description: 'The smallest value found, or 0 when there is no data.',
      }),
      max: new NumberField(undefined, {
        description: 'The largest value found, or 0 when there is no data.',
      }),
      extent: new Vec2Field(undefined, {
        description: 'Min and max together, as a 2D vector (x is min, y is max).',
      }),
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
      data: new DataField(undefined, {
        description: 'Array to pick one item from. Outputs nothing if it is empty.',
      }),
      index: new NumberField(0, {
        step: 1,
        description: 'Position of the item, starting at 0. Decimals round down.',
      }),
      wrap: new BooleanField(false, {
        description: 'Wrap out-of-range indexes around the array instead of clamping to the ends.',
      }),
    }
  }
  createOutputs() {
    return {
      value: new UnknownField(undefined, {
        description: 'The item at Index, after clamping or wrapping to the array bounds.',
      }),
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
        label: 'Operation',
        description:
          'Math to apply. Sine, sqrt, round, rad and other one-input operations ignore B.',
      }),
      a: new NumberField(0, {
        step: 1,
        accessor: true,
        description: 'First number. Accepts a per-item accessor.',
      }),
      b: new NumberField(0, {
        step: 1,
        accessor: true,
        description: 'Second number, for two-input operations. Accepts a per-item accessor.',
      }),
    }
  }
  createOutputs() {
    return {
      result: new NumberField(undefined, {
        description: 'The result, or a per-item accessor when A or B is one.',
      }),
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
      val: new StringField('', { label: 'Value', description: 'The text to pass along.' }),
    }
  }
  createOutputs() {
    return {
      val: new StringField(undefined, { label: 'Value', description: 'The same text, unchanged.' }),
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
      val: new BooleanField(false, {
        label: 'Value',
        description: 'A true or false value to pass on to other nodes.',
      }),
    }
  }
  createOutputs() {
    return {
      val: new BooleanField(undefined, {
        label: 'Value',
        description: 'The same true or false value.',
      }),
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
      date: new DateField(undefined, {
        description: 'A date and time with no time zone. Defaults to the time the project loaded.',
      }),
    }
  }
  createOutputs() {
    return {
      date: new DateField(undefined, {
        description: 'The same date and time, for connecting to other date operators.',
      }),
    }
  }
  execute({ date }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { date }
  }
}

const DATE_MATH_OPERATORS = [
  'add',
  'subtract',
  'difference',
  'isBefore',
  'isAfter',
  'equals',
  'interpolate',
] as const
const DATE_MATH_USES_DATE_B = new Set([
  'difference',
  'isBefore',
  'isAfter',
  'equals',
  'interpolate',
])
const DURATION_UNITS = [
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
  'milliseconds',
] as const

// Date arithmetic and comparison. The output type depends on the operator:
// add/subtract/interpolate return a date, difference returns a number in `unit`,
// isBefore/isAfter/equals return a boolean. Accepts accessors for per-item math.
export class DateMathOp extends Operator<DateMathOp> {
  static displayName = 'DateMath'
  static description = 'Add, subtract, compare, or interpolate dates'

  constructor(id: OpId, inputs?: unknown, locked?: boolean) {
    super(id, inputs, locked)

    const sub = this.inputs.operator.subscribe((operator: string) => {
      const visible = new Set<string>(['operator', 'date'])
      if (DATE_MATH_USES_DATE_B.has(operator)) visible.add('dateB')
      if (operator === 'add' || operator === 'subtract') visible.add('amount')
      if (operator === 'add' || operator === 'subtract' || operator === 'difference') {
        visible.add('unit')
      }
      if (operator === 'interpolate') visible.add('t')
      this.visibleFields.next(visible)
    })
    this.subs.push(sub)
  }

  createInputs() {
    return {
      operator: new StringLiteralField('add', {
        values: [...DATE_MATH_OPERATORS],
        label: 'Operation',
        description:
          'What to do: add, subtract, difference, compare (before, after, equals) or interpolate.',
      }),
      date: new DateField(undefined, {
        accessor: true,
        description: 'The date to work on. Accepts a per-item accessor.',
      }),
      dateB: new DateField(undefined, {
        accessor: true,
        showByDefault: false,
        label: 'Second date',
        description: 'Date to compare with, measure to, or blend toward.',
      }),
      amount: new NumberField(1, {
        step: 1,
        accessor: true,
        description: 'How many Units to add or subtract.',
      }),
      unit: new StringLiteralField('days', {
        values: [...DURATION_UNITS],
        description: 'Time unit for add, subtract and difference, from years to milliseconds.',
      }),
      t: new NumberField(0, {
        min: 0,
        max: 1,
        step: 0.01,
        accessor: true,
        showByDefault: false,
        label: 'Blend',
        description: 'How far from Date to Second date, 0 to 1. Only used for interpolate.',
      }),
    }
  }
  createOutputs() {
    return {
      result: new UnknownField(undefined, {
        description:
          'A date (add, subtract, interpolate), a number in Unit (difference), or true/false.',
      }),
    }
  }
  execute({
    operator,
    date,
    dateB,
    amount,
    unit,
    t,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    type Value<T> = T | ((...args: unknown[]) => T)
    const transform = (
      a: Temporal.PlainDateTime,
      b: Temporal.PlainDateTime,
      n: number,
      tVal: number
    ) => {
      switch (operator) {
        case 'add':
          return a.add({ [unit]: n })
        case 'subtract':
          return a.subtract({ [unit]: n })
        case 'difference':
          // total() keeps the fraction: 12 hours in 'days' is 0.5, not 0
          return a.until(b).total({ unit: unit as Temporal.DateTimeUnit, relativeTo: a })
        case 'isBefore':
          return Temporal.PlainDateTime.compare(a, b) < 0
        case 'isAfter':
          return Temporal.PlainDateTime.compare(a, b) > 0
        case 'equals':
          return Temporal.PlainDateTime.compare(a, b) === 0
        case 'interpolate':
          return interpolateTemporal(a, b, Math.max(0, Math.min(1, tVal)))
        default:
          throw new Error(`Unknown operator: ${operator}`)
      }
    }

    // Only inputs the operator reads can turn the result into an accessor
    const inputs: [
      Value<Temporal.PlainDateTime>,
      Value<Temporal.PlainDateTime>,
      Value<number>,
      Value<number>,
    ] = [
      date,
      DATE_MATH_USES_DATE_B.has(operator) ? dateB : date,
      operator === 'add' || operator === 'subtract' ? amount : 0,
      operator === 'interpolate' ? t : 0,
    ]
    if (!inputs.some(isAccessor)) {
      return {
        result: transform(
          ...(inputs as [Temporal.PlainDateTime, Temporal.PlainDateTime, number, number])
        ),
      }
    }
    const result = (...args: unknown[]) => {
      const [a, b, n, tVal] = inputs.map(v => (isAccessor(v) ? v(...args) : v))
      return transform(
        a as Temporal.PlainDateTime,
        b as Temporal.PlainDateTime,
        n as number,
        tVal as number
      )
    }
    return { result }
  }
}

// Split a date into numeric components, one output per part
export class DatePartsOp extends Operator<DatePartsOp> {
  static displayName = 'DateParts'
  static description = 'Split a date into year, month, day, hour, and other components'
  createInputs() {
    return {
      date: new DateField(undefined, {
        accessor: true,
        description: 'The date to split into parts. Accepts a per-item accessor.',
      }),
    }
  }
  createOutputs() {
    return {
      year: new NumberField(undefined, { description: 'The four-digit year.' }),
      month: new NumberField(undefined, { description: 'Month of the year, 1 (January) to 12.' }),
      day: new NumberField(undefined, { description: 'Day of the month, 1 to 31.' }),
      hour: new NumberField(undefined, { description: 'Hour of the day, 0 to 23.' }),
      minute: new NumberField(undefined, { description: 'Minute of the hour, 0 to 59.' }),
      second: new NumberField(undefined, { description: 'Second of the minute, 0 to 59.' }),
      millisecond: new NumberField(undefined, {
        description: 'Millisecond of the second, 0 to 999.',
      }),
      dayOfWeek: new NumberField(undefined, {
        description: 'Day of the week, 1 (Monday) to 7 (Sunday).',
      }),
      dayOfYear: new NumberField(undefined, { description: 'Day of the year, 1 to 366.' }),
      weekOfYear: new NumberField(undefined, { description: 'ISO week number, 1 to 53.' }),
    }
  }
  execute({ date }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const part = (key: keyof ReturnType<DatePartsOp['createOutputs']>) =>
      composeAccessor(date, (d: Temporal.PlainDateTime) => d[key] as number)
    return {
      year: part('year'),
      month: part('month'),
      day: part('day'),
      hour: part('hour'),
      minute: part('minute'),
      second: part('second'),
      millisecond: part('millisecond'),
      dayOfWeek: part('dayOfWeek'),
      dayOfYear: part('dayOfYear'),
      weekOfYear: part('weekOfYear'),
    } as ExtractProps<typeof this.outputs>
  }
}

const DATE_FORMAT_TOKENS = /YYYY|MM|DD|HH|mm|ss|SSS/g

// Format a date with YYYY, MM, DD, HH, mm, ss, and SSS tokens. An empty pattern gives ISO 8601.
export class DateFormatOp extends Operator<DateFormatOp> {
  static displayName = 'DateFormat'
  static description = 'Format a date as a string, e.g. YYYY-MM-DD HH:mm'
  createInputs() {
    return {
      date: new DateField(undefined, {
        accessor: true,
        description: 'Date to format, or a per-row date accessor.',
      }),
      pattern: new StringField('YYYY-MM-DD HH:mm:ss', {
        description: 'Format with tokens YYYY, MM, DD, HH, mm, ss, SSS. Empty gives an ISO string.',
      }),
    }
  }
  createOutputs() {
    return {
      text: new StringField(undefined, {
        description: 'The formatted date text, or a per-row accessor when Date is one.',
      }),
    }
  }
  execute({ date, pattern }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const format = (d: Temporal.PlainDateTime) => {
      if (!pattern) return d.toString()
      const pad = (n: number, width = 2) => n.toString().padStart(width, '0')
      const tokens: Record<string, string> = {
        YYYY: pad(d.year, 4),
        MM: pad(d.month),
        DD: pad(d.day),
        HH: pad(d.hour),
        mm: pad(d.minute),
        ss: pad(d.second),
        SSS: pad(d.millisecond, 3),
      }
      // One pass, so text a token produces is never matched by a later token
      return pattern.replace(DATE_FORMAT_TOKENS, token => tokens[token])
    }
    return { text: composeAccessor(date, format) } as ExtractProps<typeof this.outputs>
  }
}

export class CombineXYOp extends Operator<CombineXYOp> {
  static displayName = 'CombineXY'
  static description = 'Combine x and y into a 2D vector'
  createInputs() {
    return {
      x: new NumberField(0, {
        step: 0.01,
        accessor: true,
        description: 'X component. Accepts a per-item accessor.',
      }),
      y: new NumberField(0, {
        step: 0.01,
        accessor: true,
        description: 'Y component. Accepts a per-item accessor.',
      }),
    }
  }
  createOutputs() {
    return {
      xy: new Vec2Field(undefined, {
        label: 'XY',
        description: '2D vector {x, y}, or a per-item accessor when X or Y is one.',
      }),
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
      vec: new Vec2Field(
        { x: 0, y: 0 },
        {
          accessor: true,
          label: 'Vector',
          description: '2D vector {x, y} to split. Accepts a per-item accessor.',
        }
      ),
    }
  }
  createOutputs() {
    return {
      x: new NumberField(undefined, { description: 'X component of the vector.' }),
      y: new NumberField(undefined, { description: 'Y component of the vector.' }),
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
      vec: new Vec3Field(
        { x: 0, y: 0, z: 0 },
        {
          accessor: true,
          label: 'Vector',
          description: '3D vector {x, y, z} to split. Accepts a per-item accessor.',
        }
      ),
    }
  }
  createOutputs() {
    return {
      x: new NumberField(undefined, { description: 'X component of the vector.' }),
      y: new NumberField(undefined, { description: 'Y component of the vector.' }),
      z: new NumberField(undefined, { description: 'Z component of the vector.' }),
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
      r: new NumberField(0, {
        accessor: true,
        label: 'Red',
        description: 'Red channel, 0 to 255 (whole numbers). Can be a per-item accessor.',
      }),
      g: new NumberField(0, {
        accessor: true,
        label: 'Green',
        description: 'Green channel, 0 to 255 (whole numbers). Can be a per-item accessor.',
      }),
      b: new NumberField(0, {
        accessor: true,
        label: 'Blue',
        description: 'Blue channel, 0 to 255 (whole numbers). Can be a per-item accessor.',
      }),
      a: new NumberField(1, {
        accessor: true,
        label: 'Alpha',
        description:
          'Opacity, 0 (clear) to 255 (opaque), whole numbers. Can be a per-item accessor.',
      }),
    }
  }
  createOutputs() {
    return {
      color: new ColorField(undefined, {
        description: 'Hex color (#rrggbbaa), or a per-item color accessor if any input is one.',
      }),
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
      color: new ColorField(
        { accessor: true },
        { description: 'Hex color to split into channels. Can be a per-item accessor.' }
      ),
    }
  }
  createOutputs() {
    return {
      r: new NumberField(undefined, { label: 'Red', description: 'Red channel, 0 to 255.' }),
      g: new NumberField(undefined, { label: 'Green', description: 'Green channel, 0 to 255.' }),
      b: new NumberField(undefined, { label: 'Blue', description: 'Blue channel, 0 to 255.' }),
      a: new NumberField(undefined, {
        label: 'Alpha',
        description: 'Opacity channel, 0 (clear) to 255 (opaque).',
      }),
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
      color: new ColorField(undefined, {
        description: 'The color to output, as hex with optional alpha (#rrggbbaa).',
      }),
    }
  }
  createOutputs() {
    return {
      color: new ColorField(undefined, {
        description: 'The chosen color, as an 8-digit hex string.',
      }),
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
      h: new NumberField(0, {
        min: 0,
        max: 360,
        step: 1,
        accessor: true,
        label: 'Hue',
        description: 'Hue in degrees around the color wheel, 0 to 360. Can be a per-item accessor.',
      }),
      s: new NumberField(0.5, {
        min: 0,
        max: 1,
        step: 0.01,
        accessor: true,
        label: 'Saturation',
        description: 'Color intensity, 0 (gray) to 1 (full color). Can be a per-item accessor.',
      }),
      l: new NumberField(0.8, {
        min: 0,
        max: 1,
        step: 0.01,
        accessor: true,
        label: 'Lightness',
        description: '0 is black, 0.5 is the pure color, 1 is white. Can be a per-item accessor.',
      }),
    }
  }
  createOutputs() {
    return {
      color: new ColorField(undefined, {
        description: 'Hex color (#rrggbb), or a per-item color accessor if any input is one.',
      }),
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
    const colorScheme = new StringLiteralField('viridis', {
      values: Object.keys(continuousInterpolators),
      displayAs: 'color-scheme',
      description: 'Continuous color scale to pick colors from.',
    })

    const value = new NumberField(0, {
      min: 0,
      max: 1,
      step: 0.01,
      accessor: true,
      description: 'Position along the scale, 0 to 1. Can be a per-item accessor.',
    })

    return {
      colorScheme,
      value,
    }
  }
  createOutputs() {
    return {
      color: new ColorField(undefined, {
        description: 'Hex color at Value, or a per-item color accessor if Value is one.',
      }),
      colorRamp: new ColorRampField(undefined, {
        description: 'Function that maps a number from 0 to 1 to a hex color on the scale.',
      }),
    }
  }
  execute({
    colorScheme,
    value,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Get the interpolator for the selected scheme
    const interpolate = continuousInterpolators[colorScheme as keyof typeof continuousInterpolators]

    // Normalize all color formats to hex for consistency
    // TODO: VIS-813: Make all colors d3 Colors?
    const normalizedRamp = (val: number) => {
      const c = interpolate(val)
      return d3Color(c)?.formatHex() ?? c
    }

    // Use composeAccessor helper to handle both static values and accessor functions
    const color = composeAccessor(value, normalizedRamp)

    return { color, colorRamp: normalizedRamp }
  }
}

export class CategoricalColorRampOp extends Operator<CategoricalColorRampOp> {
  static displayName = 'CategoricalColorRamp'
  static description = 'Map a string category to a color'
  createInputs() {
    const allSchemeNames = [
      ...Object.keys(categoricalSchemesFixed),
      ...Object.keys(categoricalSchemesStepped),
    ]

    const colorScheme = new StringLiteralField('accent', {
      values: allSchemeNames,
      displayAs: 'color-scheme',
      description: 'Set of colors to assign to categories.',
    })
    const steps = new NumberField(8, {
      min: 3,
      max: 11,
      step: 1,
      description:
        'Number of colors used from the scheme, 3 to 11. Categories past this reuse colors.',
    })

    const value = new StringField('', {
      accessor: true,
      description: 'Category name to look up. Can be a per-item accessor.',
    })

    return {
      colorScheme,
      steps,
      value,
    }
  }
  createOutputs() {
    return {
      color: new ColorField(undefined, {
        description: 'Hex color for Value, or a per-item color accessor if Value is one.',
      }),
      colorRamp: new CategoricalColorRampField(undefined, {
        description: 'Function that maps any category name to a color from the scheme.',
      }),
    }
  }
  execute({
    colorScheme,
    steps,
    value,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Derive the color scheme from colorScheme and steps
    const schemeName = colorScheme
    const n = Math.max(Math.round(steps), 3)
    let scheme: readonly string[]
    if (schemeName in categoricalSchemesFixed) {
      const full = categoricalSchemesFixed[schemeName as keyof typeof categoricalSchemesFixed]
      scheme = full.slice(0, Math.min(n, full.length))
    } else {
      const steppedScheme =
        categoricalSchemesStepped[schemeName as keyof typeof categoricalSchemesStepped]
      const clamped = Math.min(n, steppedScheme.length - 1)
      scheme = steppedScheme[clamped] as readonly string[]
    }
    const colorRamp = scaleOrdinal(scheme)

    const scale = (val: string) => {
      const color = colorRamp(val)

      // Some return values are in rgb, some are in hex. Convert them all to be safe
      // TODO: VIS-813: Make all colors d3 Colors?
      return d3Color(color)?.formatHex()
    }

    // Use composeAccessor helper to handle both static values and accessor functions
    const color = composeAccessor(value, scale)

    return { color, colorRamp }
  }
}

export class TimeOp extends Operator<TimeOp> {
  static displayName = 'Time'
  static description = 'Get the current clock, timeline, and session time'

  private timeState$ = new BehaviorSubject({ now: Date.now(), tick: 0, sequenceTime: 0 })
  private rafId?: number
  private positionUnsub?: () => void

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
      now: new NumberField(undefined, {
        description: 'Current clock time, in milliseconds since 1970. Updates every frame.',
      }),
      sequenceTime: new NumberField(undefined, {
        label: 'Timeline time',
        description: 'Playhead position on the timeline, in seconds.',
      }),
      tick: new NumberField(undefined, {
        description: 'Frame counter that goes up by one every animation frame.',
      }),
    }
  }

  private initializeTimeUpdates() {
    // Set up subscription from timeState$ to outputs
    const sub = this.timeState$.subscribe(state => {
      this.outputs.now.next(state.now)
      this.outputs.tick.next(state.tick)
      this.outputs.sequenceTime.next(state.sequenceTime)
      // Drop the cached result so the next pull returns the current time
      this.markDirty()
    })
    this.subs.push(sub)

    this.positionUnsub = subscribeToPosition((pos: number) => {
      const current = this.timeState$.value
      this.timeState$.next({ ...current, sequenceTime: pos })
    })

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

  dispose() {
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId)
    }
    this.positionUnsub?.()
    this.timeState$.complete()
    super.dispose()
  }

  execute(_: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // The BehaviorSubject pushes each update to the outputs; execute() reports the
    // current values so pulls through this operator get a result to cache
    const { now, sequenceTime, tick } = this.timeState$.value
    return { now, sequenceTime, tick }
  }
}

export class BezierCurveOp extends Operator<BezierCurveOp> {
  static displayName = 'BezierCurve'
  static description = 'Bezier curve for mapping input values using an interactive graph editor'
  createInputs() {
    return {
      factor: new NumberField(0.5, {
        min: 0,
        max: 1,
        step: 0.01,
        accessor: true,
        description: 'Input position on the curve, 0 to 1. Accepts a per-item accessor.',
      }),
      curve: new BezierCurveField(undefined, {
        description: 'The curve that maps input to output. Drag the handles to shape it.',
      }),
    }
  }
  createOutputs() {
    return {
      value: new NumberField(undefined, { description: "The curve's value at Factor." }),
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
      format: new StringLiteralField('json', {
        values: ['json', 'csv', 'tsv', 'text', 'binary'],
        description: 'How to read the file: json, csv, tsv, plain text or raw bytes.',
      }),
      url: new FileUrlField(undefined, {
        description: 'Web address or project file to load. Takes priority over Text.',
      }),
      // TODO: make this mutually exclusive with `url`
      text: new StringField('', {
        description: 'File contents to use instead of a URL. Ignored when URL is set.',
      }),
      autoType: new BooleanField(true, {
        showByDefault: false,
        label: 'Detect types',
        description:
          'Turn number, true/false and date columns into values. Off keeps text, e.g. ZIP codes.',
      }),
      pulse: new NumberField(0, {
        min: 0,
        step: 1,
        showByDefault: false,
        label: 'Reload',
        description: 'Change this number to fetch the file again.',
      }),
    }
  }

  createOutputs() {
    return {
      data: new DataField(undefined, { description: 'The parsed file contents.' }),
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
      query: new CodeField('SELECT 1 as val;', {
        language: 'sql',
        label: 'SQL query',
        description:
          "SQL to run. Statements run in order. Insert another field's value with {{/op.out.field}}.",
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, { description: 'Rows returned by the last statement.' }),
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
      const error = e instanceof Error ? e : new Error(String(e))
      const errorMsg = error.message || ''

      debugExecute('Error executing query', e)

      // Log error to console for debugging
      // Note: "Object Not Found" and syntax errors often occur during typing,
      // so we don't capture those to PostHog to avoid noise from incomplete queries
      if (errorMsg.includes('Object Not Found')) {
        console.error(
          '[DuckDbOp] Object not found - table or view may not be registered.',
          'This often happens when typing an incomplete query.',
          error
        )
      } else if (errorMsg.includes('syntax error') || errorMsg.includes('Parser Error')) {
        console.error('[DuckDbOp] SQL syntax error (likely incomplete query):', error)
      } else {
        // Only capture non-typing-related errors to analytics
        console.error('[DuckDbOp] Query execution failed:', error)
        analytics.captureException(error, {
          source: 'duckdb_op',
          errorType: 'execution_error',
        })
      }

      await conn.close()
      await db.reset()
      throw error
    }
  }
}

export class JSONOp extends Operator<JSONOp> {
  static displayName = 'JSON'
  static description = 'Parse a JSON string'
  createInputs() {
    return {
      text: new CodeField('{}', {
        language: 'json',
        description:
          'JSON text to parse. {{/node.out.field}} references are replaced with that value.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'The parsed value (object, array, number, string or boolean).',
      }),
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
      data: new UnknownField(undefined, {
        description: 'Any value to inspect in the node. It can also be downloaded.',
      }),
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
  static description = 'Edit a table with typed columns'
  asDownload = () => this.outputData

  createInputs() {
    return {
      data: new DataField(undefined, {
        description: 'Rows of the table. Edits made in the table editor are saved here.',
      }),
      schema: new UnknownField(null, {
        description: 'Column names, types and defaults. Inferred from the data when not set.',
      }), // TableSchema | null - optional schema override
    }
  }

  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'The rows, checked against the schema, with date-time cells as dates.',
      }),
      schema: new UnknownField(null, {
        description: 'The column schema in use, or null when none is set.',
      }), // Computed schema (inferred or explicit)
    }
  }

  execute({ data, schema }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const validatedData = schema ? validateTableData(data, schema as TableSchema) : data
    // Convert dateTime strings to Temporal.ZonedDateTime for output
    // This happens at the operator boundary: internal storage = strings, output = Temporal
    const outputData = schema
      ? prepareTableDataForOutput(validatedData, schema as TableSchema)
      : validatedData

    return {
      data: outputData,
      schema: schema || null,
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
    const data = new DataField(undefined, {
      description: 'Array of rows to plot. Its keys fill the X field and Y field choices.',
    })
    const chartType = new StringLiteralField('bar', {
      values: ['bar', 'histogram', 'scatter'],
      description: 'Bar, histogram (counts of X field values) or scatter.',
    })
    const xField = new StringLiteralField('', {
      values: [],
      description: 'Column to use for the horizontal axis.',
    })
    const yField = new StringLiteralField('', {
      values: [],
      description: 'Column to use for the vertical axis. Hidden for histograms.',
    })

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
      width: new NumberField(640, {
        min: 100,
        max: 2000,
        step: 10,
        description: 'Chart width in pixels, from 100 to 2000.',
      }),
      height: new NumberField(400, {
        min: 100,
        max: 2000,
        step: 10,
        description: 'Chart height in pixels, from 100 to 2000.',
      }),
      color: new ColorField('#4269d0', {
        description: 'Fill color of the bars or dots, as a hex color.',
      }),
      title: new StringField('', {
        description: 'Title shown above the chart. Leave empty for none.',
      }),
      xLabel: new StringField('', {
        description: 'Horizontal axis title. Defaults to the X field name.',
      }),
      yLabel: new StringField('', {
        description: 'Vertical axis title. Defaults to the Y field name.',
      }),
    }
  }

  createOutputs() {
    return {
      // Plot.plot() returns a <figure> element containing the chart SVG
      chart: new UnknownField(undefined, {
        description: 'The chart as an HTML figure element, or null if data or fields are missing.',
      }),
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

export class BrushableHistogramOp extends Operator<BrushableHistogramOp> {
  static displayName = 'BrushableHistogram'
  static description =
    'Interactive histogram with brushable range selection for data filtering. Drag handles to select a range, keyframe brush positions for animation.'

  createInputs() {
    const data = new DataField(undefined, {
      description: 'Array of rows to bin and filter. Each row needs a numeric column.',
    })
    const field = new StringLiteralField('', {
      values: [],
      description: 'Numeric column to bin. Choices are the numeric keys found in the data.',
    })

    // Dynamically populate field choices from numeric data keys. Sample several rows, since
    // a numeric column can have an empty first cell.
    data.subscribe((newData: unknown[]) => {
      if (Array.isArray(newData) && newData.length > 0) {
        const numericKeys = new Set<string>()
        for (const row of newData.slice(0, 100)) {
          if (typeof row !== 'object' || row === null) continue
          for (const [key, value] of Object.entries(row)) {
            if (typeof value === 'number' && !Number.isNaN(value)) numericKeys.add(key)
          }
        }
        field.updateChoices([...numericKeys])
      }
    })

    return {
      data,
      field,
      binCount: new NumberField(20, {
        min: 5,
        max: 100,
        step: 1,
        description: 'About how many bars to split the value range into, from 5 to 100.',
      }),
      brushMin: new NumberField(0, {
        description: 'Lowest value kept in Filtered data (inclusive). Can be keyframed.',
      }),
      brushMax: new NumberField(100, {
        description: 'Highest value kept in Filtered data (inclusive). Can be keyframed.',
      }),
      brushMode: new StringLiteralField('handles', {
        values: ['handles', 'offset'],
        description:
          'How the histogram editor sets the range: min and max handles, or center and width.',
      }),
    }
  }

  createOutputs() {
    return {
      filteredData: new DataField(undefined, {
        description: 'Rows whose Field value is between Brush min and Brush max.',
      }),
      binData: new DataField(undefined, {
        description: 'One row per bar with x0, x1, count and the rows in that bin.',
      }),
      extent: new UnknownField(undefined, {
        description: 'Lowest and highest Field values in the data, as [min, max].',
      }),
    }
  }

  execute({
    data,
    field,
    binCount,
    brushMin,
    brushMax,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Validate inputs
    if (!Array.isArray(data) || data.length === 0 || !field) {
      return {
        filteredData: [],
        binData: [],
        extent: [0, 0],
      }
    }

    // Extract accessor function
    const accessor = (d: unknown) => {
      if (typeof d === 'object' && d !== null && field in d) {
        return (d as Record<string, unknown>)[field] as number
      }
      return null
    }

    // Calculate extent
    const extent = d3.extent(data, accessor) as [number, number]
    if (extent[0] === undefined || extent[1] === undefined) {
      return {
        filteredData: [],
        binData: [],
        extent: [0, 0],
      }
    }

    // Create histogram bins
    const binner = d3.bin<unknown, number>().domain(extent).thresholds(binCount).value(accessor)

    const bins = binner(data)

    // Format bin data for output
    const binData = bins.map(bin => ({
      x0: bin.x0,
      x1: bin.x1,
      count: bin.length,
      values: bin,
    }))

    // Filter data based on brush range
    const filtered = data.filter(d => {
      const val = accessor(d)
      return val !== null && val >= brushMin && val <= brushMax
    })

    return {
      filteredData: filtered,
      binData,
      extent,
    }
  }
}

export class ScatterOp extends Operator<ScatterOp> {
  static displayName = 'Scatter'
  static description = 'Scatter points randomly within a bounding box'
  createInputs() {
    return {
      bounds: new BboxField(
        { southwest: { lng: -180, lat: -90 }, northeast: { lng: 180, lat: 90 } },
        {
          returnType: 'tuple',
          description: 'Area to fill with points. Defaults to the whole world.',
        }
      ),
      count: new NumberField(100, {
        min: 1,
        step: 1,
        description: 'Number of random points to create inside Bounds.',
      }),
      seed: new NumberField(1, {
        min: 0,
        step: 1,
        description:
          'Starting number for the random generator. The same seed gives the same points.',
      }),
    }
  }
  createOutputs() {
    return {
      points: new ArrayField(new Point2DField(), {
        description: 'Array of random points, each with lng and lat.',
      }),
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
      southwest: new Point2DField(undefined, {
        description: 'One corner of the box, as a longitude and latitude.',
      }),
      northeast: new Point2DField(undefined, {
        description: 'The opposite corner of the box. Corners can be given in either order.',
      }),
    }
  }
  createOutputs() {
    return {
      bounds: new ArrayField(new Point2DField([0, 0], { returnType: 'tuple' }), {
        description: 'The box as [[west, south], [east, north]].',
      }),
    }
  }
  execute({
    southwest,
    northeast,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const west = Math.min(southwest.lng, northeast.lng)
    const east = Math.max(southwest.lng, northeast.lng)
    const south = Math.min(southwest.lat, northeast.lat)
    const north = Math.max(southwest.lat, northeast.lat)

    const bounds = [
      [west, south],
      [east, north],
    ] as [[number, number], [number, number]]

    return { bounds }
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
      data: orSchema(
        new ArrayField(new Point2DField(), {
          description:
            'Points with lat and lng keys, or GeoJSON (FeatureCollection, Feature or geometry).',
        }),
        geoJsonSchema
      ),
      // TODO: could be a union, either a number or object with top, right, bottom, left
      padding: new NumberField(0, {
        softMin: -1_000,
        softMax: 1_000,
        description: 'Space to leave around the bounds when fitting the camera, in pixels.',
      }),
    }
  }
  createOutputs() {
    return {
      bounds: new ArrayField(new Point2DField([0, 0], { returnType: 'tuple' }), {
        description: "Corners of the data's extent, as [[west, south], [east, north]].",
      }),
      longitude: new NumberField(undefined, {
        description: 'Longitude of the camera center that fits all the data in view.',
      }),
      latitude: new NumberField(undefined, {
        description: 'Latitude of the camera center that fits all the data in view.',
      }),
      zoom: new NumberField(undefined, {
        description: 'Zoom level that fits all the data in the output frame.',
      }),
      viewState: new CompoundPropsField(
        {
          longitude: new NumberField(),
          latitude: new NumberField(),
          zoom: new NumberField(),
        },
        { description: 'Longitude, latitude and zoom together, ready to connect to a view state.' }
      ),
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
      query: new StringField(undefined, {
        description:
          'Place name or address to look up with Mapbox. Needs a Mapbox key in Settings.',
      }),
    }
  }
  createOutputs() {
    return {
      location: new Point2DField(undefined, {
        description: 'Longitude and latitude of the chosen or best match.',
      }),
      results: new DataField(undefined, {
        description: 'Up to 5 matches, each with place_name and coordinates.',
      }),
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

    // An unconnected query is driven by GeocoderOpComponent so the user can
    // inspect Mapbox's suggestions and choose a result. Only connected queries
    // should geocode automatically during graph execution.
    if (this.inputs.query.subscriptions.size === 0) {
      return this.outputData
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
      origin: new Point2DField(undefined, {
        description: 'Start of the route, as a longitude and latitude.',
      }),
      destination: new Point2DField(undefined, {
        description: 'End of the route, as a longitude and latitude.',
      }),
      mode: new StringLiteralField('transit', {
        values: [
          { value: 'driving', label: 'Driving (Mapbox / OSRM)' },
          { value: 'driving-traffic', label: 'Driving with traffic (Google)' },
          { value: 'transit', label: 'Transit (Google)' },
        ],
        description:
          'Routing service: driving, traffic-aware driving (Google) or transit (Google).',
      }),
      departureMode: new StringLiteralField('now', {
        values: [
          { value: 'now', label: 'Depart now' },
          { value: 'scheduled', label: 'Schedule departure' },
        ],
        description: 'Leave now or at a set time. Only used for driving with traffic.',
      }),
      departureTime: new DateField(undefined, {
        description:
          'Local time at the origin to leave. Must be in the future. Used with a scheduled departure.',
      }),
      trafficModel: new StringLiteralField('best-guess', {
        values: [
          { value: 'best-guess', label: 'Best guess' },
          { value: 'pessimistic', label: 'Pessimistic' },
          { value: 'optimistic', label: 'Optimistic' },
        ],
        description: 'How to estimate traffic delay: best guess, pessimistic or optimistic.',
      }),
      avoidTolls: new BooleanField(false, {
        description: 'Prefer routes without toll roads. Only used for driving with traffic.',
      }),
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
        {
          passthrough: true,
          description:
            'Distance (meters), duration (seconds), path, timestamps for Trips layer, and toll info.',
        }
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

/**
 * Query OpenStreetMap data using Overpass API
 *
 * Executes Overpass QL queries against the Overpass API and converts
 * the OSM JSON response to GeoJSON format. Supports bbox template
 * replacement for dynamic bounding box queries.
 *
 * Uses overpass.kumi.systems mirror which supports CORS.
 *
 * @example
 * ```overpass-ql
 * [out:json][timeout:25];
 * (
 *   way["leisure"="park"]({{bbox}});
 *   relation["leisure"="park"]({{bbox}});
 * );
 * out geom;
 * ```
 */
export class OverpassOp extends Operator<OverpassOp> {
  static displayName = 'Overpass'
  static description = 'Query OpenStreetMap data using Overpass API'
  asDownload = () => this.outputData
  createInputs() {
    return {
      query: new CodeField(
        '[out:json][timeout:25];\n(\n  way["leisure"="park"]({{bbox}});\n  relation["leisure"="park"]({{bbox}});\n);\nout geom;',
        {
          language: 'overpass-ql',
          description: 'Overpass QL query. {{bbox}} is replaced with the Bbox area.',
        }
      ),
      bbox: new BboxField(
        {
          southwest: { lng: -74.05, lat: 40.68 },
          northeast: { lng: -73.9, lat: 40.82 },
        },
        { optional: false, description: 'Area to search, filled into {{bbox}} in the query.' }
      ),
      pulse: new NumberField(0, {
        min: 0,
        step: 1,
        label: 'Reload',
        description: 'Change this number to run the query again.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'Tagged OpenStreetMap features as a GeoJSON FeatureCollection.',
      }),
    }
  }
  async execute({
    query,
    bbox,
  }: ExtractProps<typeof this.inputs>): Promise<ExtractProps<typeof this.outputs>> {
    try {
      // Get endpoint from settings
      const keysStore = getKeysStore()
      const endpoint = keysStore.getKey('overpass')
      if (!endpoint) {
        throw new Error(
          'Overpass API endpoint not configured. Please set it in Settings > API Keys.'
        )
      }

      // Replace {{bbox}} template with actual coordinates if bbox is provided and valid
      // Overpass format: (south,west,north,east)
      let processedQuery = query
      if (bbox && /\{\{bbox\}\}/.test(query)) {
        const { southwest, northeast } = bbox
        const bboxString = `${southwest.lat},${southwest.lng},${northeast.lat},${northeast.lng}`
        processedQuery = processedQuery.replace(/\{\{bbox\}\}/g, bboxString)
      }

      // Query Overpass API
      const response = await fetch(endpoint, {
        method: 'POST',
        body: processedQuery,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })

      if (!response.ok) {
        throw new Error(`Overpass API error: ${response.status} ${response.statusText}`)
      }

      const osmData = await response.json()

      // Check for timeout or other errors
      if (osmData.remark?.includes('timeout')) {
        throw new Error('Overpass query timeout - try a smaller area or simpler query')
      }

      // Convert OSM JSON to GeoJSON
      const geojson = this.osmToGeoJson(osmData)
      return { data: geojson }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Overpass query failed: ${errorMessage}`)
    }
  }

  private osmToGeoJson(osmData: {
    elements?: Array<{
      type: string
      id: number
      lat?: number
      lon?: number
      tags?: Record<string, string>
      geometry?: Array<{ lat: number; lon: number }>
      nodes?: number[]
    }>
  }): { type: 'FeatureCollection'; features: unknown[] } {
    const features: unknown[] = []

    // Build node map for way processing
    const nodeMap: Record<
      number,
      {
        id: number
        lat: number
        lon: number
        tags?: Record<string, string>
      }
    > = {}
    for (const element of osmData.elements || []) {
      if (element.type === 'node') {
        nodeMap[element.id] = element

        // Only create features for tagged nodes (POIs)
        if (element.tags) {
          features.push({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [element.lon, element.lat],
            },
            properties: { ...element.tags, osm_id: element.id, osm_type: 'node' },
          })
        }
      }
    }

    // Process ways (lines and polygons)
    for (const element of osmData.elements || []) {
      if (element.type === 'way' && element.tags) {
        // If geometry is included (from 'out geom'), use it directly
        if (element.geometry) {
          const coordinates = element.geometry.map(node => [node.lon, node.lat])

          if (coordinates.length < 2) continue

          // Check if way is closed (polygon) using epsilon comparison for floating point coordinates
          const epsilon = 1e-9
          const isClosed =
            coordinates.length > 2 &&
            Math.abs(coordinates[0][0] - coordinates[coordinates.length - 1][0]) < epsilon &&
            Math.abs(coordinates[0][1] - coordinates[coordinates.length - 1][1]) < epsilon

          features.push({
            type: 'Feature',
            geometry: {
              type: isClosed ? 'Polygon' : 'LineString',
              coordinates: isClosed ? [coordinates] : coordinates,
            },
            properties: { ...element.tags, osm_id: element.id, osm_type: 'way' },
          })
        }
        // Otherwise try to build from nodes
        else if (element.nodes) {
          const coordinates = element.nodes
            .map((nodeId: number) => {
              const node = nodeMap[nodeId] || osmData.elements?.find(n => n.id === nodeId)
              return node?.lat !== undefined && node?.lon !== undefined
                ? [node.lon, node.lat]
                : null
            })
            .filter((coord): coord is [number, number] => coord !== null)

          if (coordinates.length < 2) continue

          // Check if way is closed (polygon)
          const isClosed = element.nodes[0] === element.nodes[element.nodes.length - 1]

          features.push({
            type: 'Feature',
            geometry: {
              type: isClosed ? 'Polygon' : 'LineString',
              coordinates: isClosed ? [coordinates] : coordinates,
            },
            properties: { ...element.tags, osm_id: element.id, osm_type: 'way' },
          })
        }
      }
    }

    // Process relations (multipolygons and other complex geometries)
    for (const element of osmData.elements || []) {
      if (element.type === 'relation' && element.tags) {
        // Relations with 'out geom;' include member geometries
        const members = (
          element as unknown as {
            members?: Array<{
              type: string
              ref: number
              role: string
              lat?: number
              lon?: number
              geometry?: Array<{ lat: number; lon: number }>
            }>
          }
        ).members

        if (!members) continue

        // Group members by role (outer/inner for multipolygons)
        const outerWays = members.filter(m => m.role === 'outer' && m.geometry)
        const innerWays = members.filter(m => m.role === 'inner' && m.geometry)

        if (outerWays.length > 0) {
          // Build polygon rings
          const outerRings = outerWays.map(way => way.geometry!.map(node => [node.lon, node.lat]))
          const innerRings = innerWays.map(way => way.geometry!.map(node => [node.lon, node.lat]))

          // If single outer ring, create Polygon; otherwise MultiPolygon
          if (outerRings.length === 1) {
            features.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [outerRings[0], ...innerRings],
              },
              properties: { ...element.tags, osm_id: element.id, osm_type: 'relation' },
            })
          } else {
            // Multiple outer rings - create MultiPolygon
            features.push({
              type: 'Feature',
              geometry: {
                type: 'MultiPolygon',
                coordinates: outerRings.map(outer => [outer, ...innerRings]),
              },
              properties: { ...element.tags, osm_id: element.id, osm_type: 'relation' },
            })
          }
        }
      }
    }

    return {
      type: 'FeatureCollection',
      features,
    }
  }
}

export class ArcOp extends Operator<ArcOp> {
  static displayName = 'Arc'
  static description = 'Generate an arc path between two points at a given altitude'
  asDownload = () => this.outputData
  createInputs() {
    return {
      source: new Point3DField(undefined, {
        description: 'Start point of the arc, with longitude, latitude and altitude in meters.',
      }),
      target: new Point3DField(undefined, {
        description: 'End point of the arc, with longitude, latitude and altitude in meters.',
      }),
      altitudeMultiplier: new NumberField(2, {
        min: 0,
        softMax: 100,
        description:
          'Scales the arc height. Peak height is about Apex altitude times this, halved.',
      }),
      apexAlt: new NumberField(10_000, {
        min: 0,
        softMax: 100_000,
        label: 'Apex altitude',
        description:
          'Base arc height in meters. At the default multiplier of 2, the peak reaches this height.',
      }),
      smoothHeight: new BooleanField(true, {
        description: 'Ease the rise and fall of the arc so it is gentle near the ends.',
      }),
      smoothPosition: new BooleanField(true, {
        description: 'Ease points along the ground track so they bunch near the start and end.',
      }),
      segmentCount: new NumberField(250, {
        min: 1,
        softMax: 1000,
        description: 'Number of points in the output path. More points make a smoother curve.',
      }),
      tilt: new NumberField(0, {
        min: -90,
        max: 90,
        description: 'Lean the arc sideways, in degrees from -90 to 90. 0 keeps it upright.',
      }),
    }
  }
  createOutputs() {
    return {
      path: new ArrayField(new Point3DField(), {
        description:
          'The arc as an array of [lng, lat, alt] points. Empty if either end is at 0, 0.',
      }),
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
      skyports: new DataField(new ArrayField(new Point3DField()), {
        description: 'Array of points to connect, each with lng, lat and alt.',
      }),
      hub: new BooleanField(false, {
        description: 'Connect only the first point to each other point, instead of every pair.',
      }),
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
        ),
        { description: 'Array of routes, each with an origin and destination point.' }
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
      values: new ListField(new DataField(), {
        description:
          'Values to choose from, in connection order. Accepts any number of connections.',
      }),
      index: new NumberField(0, {
        min: 0,
        step: 1,
        accessor: true,
        description: 'Which value to output, starting at 0. Clamped to the list. Can be per item.',
      }),
      blend: new BooleanField(false, {
        description:
          'Blend between neighboring values when Index is a decimal, for smooth animation.',
      }),
    }
  }
  createOutputs() {
    return {
      value: new DataField(undefined, {
        description: 'The chosen value, or a blend of two values when Blend is on.',
      }),
    }
  }
  execute({
    values,
    index,
    blend,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Define helper functions
    const selectValue = (values: unknown[], index: number): unknown => {
      if (values.length === 0) return undefined
      const clampedIndex = Math.max(0, Math.min(index, values.length - 1))
      return values[Math.floor(clampedIndex)]
    }

    const blendValues = (values: unknown[], index: number): unknown => {
      if (values.length === 0) return undefined
      if (values.length === 1) return values[0]

      const clampedIndex = Math.max(0, Math.min(index, values.length - 1))
      const lowerIndex = Math.floor(clampedIndex)
      const upperIndex = Math.ceil(clampedIndex)

      if (lowerIndex === upperIndex) return values[lowerIndex]

      const t = clampedIndex - lowerIndex
      const lowerValue = values[lowerIndex]
      const upperValue = values[upperIndex]

      if (isTemporal(lowerValue) && isTemporal(upperValue)) {
        return interpolateTemporal(lowerValue, upperValue, t)
      }

      return interpolate(lowerValue, upperValue)(t)
    }

    // Choose function based on blend mode
    const selectFn = blend ? blendValues : selectValue

    // Handle accessor input
    if (isAccessor(index)) {
      const value = (...args: unknown[]) => {
        const idx = (index as (...args: unknown[]) => number)(...args)
        return selectFn(values, idx)
      }
      return { value }
    }

    // Handle static input (unchanged behavior)
    const value = selectFn(values, index as number)
    return { value }
  }
}

export class ForLoopBeginOp extends Operator<ForLoopBeginOp> {
  static displayName = 'ForLoopBegin'
  static description =
    'Start a loop that processes each item in an array. The scope body is wrapped in a group node. Outputs are set by the executor during iteration.'

  createInputs() {
    return {
      data: new DataField(new ArrayField(new UnknownField()), {
        description: 'Array to loop over, one item per iteration.',
      }),
    }
  }

  createOutputs() {
    return {
      item: new DataField(new UnknownField(), {
        description: 'The array item for the current iteration.',
      }),
      index: new NumberField(0, { description: 'Position of the current item, starting at 0.' }), // Current iteration index
      total: new NumberField(0, { description: 'Number of items in the array.' }), // Total number of items
    }
  }

  execute({ data }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // GraphExecutor sets these values during iteration
    const arr = Array.isArray(data) ? data : []
    return {
      item: arr.length > 0 ? arr[0] : null,
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

  chain: Operator<IOperator>[] = []
  private _iterating = false // Flag to prevent concurrent iterations

  createInputs() {
    return {
      item: new DataField(new UnknownField(), {
        description: 'Result for the current iteration, collected into the output array.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(new ArrayField(new UnknownField()), {
        description: 'Array of the collected results, one per input item.',
      }),
    }
  }

  // GraphExecutor owns loop scheduling; a normal reactive listener would run
  // the body again when each iteration changes an internal input.
  createListeners() {
    // Intentionally empty.
  }

  // Store the chain used by pull() while leaving scheduling to GraphExecutor.
  createForLoopListeners(chain: Operator<IOperator>[] = []) {
    this.chain = chain
  }

  // Override pull() to iterate through input data and collect results
  // This is used when chain is set up (tests) or when called via GraphExecutor.
  async pull(): Promise<ExtractProps<typeof this.outputs>> {
    // If no chain or no begin op, fall back to default pull
    const beginOp = this.chain.find(op => op instanceof ForLoopBeginOp) as
      | ForLoopBeginOp
      | undefined
    if (!beginOp || this.chain.length === 0) {
      // Return cached if clean and no chain.
      if (this._pullExecutionStatus === PullExecutionStatus.CLEAN && this._cachedOutput !== null) {
        return this._cachedOutput as ExtractProps<typeof this.outputs>
      }
      return super.pull()
    }

    // Check if beginOp is dirty - if so, we need to re-run the iteration
    // Also check if any operator in the chain is dirty
    const anyDirty = this.chain.some(op => op.dirty)
    if (
      !anyDirty &&
      this._pullExecutionStatus === PullExecutionStatus.CLEAN &&
      this._cachedOutput !== null
    ) {
      return this._cachedOutput as ExtractProps<typeof this.outputs>
    }

    // Prevent concurrent iterations (with reactive subscription)
    if (this._iterating) {
      // Another iteration is in progress, return current cache or wait
      if (this._cachedOutput !== null) {
        return this._cachedOutput as ExtractProps<typeof this.outputs>
      }
      return super.pull()
    }
    this._iterating = true

    try {
      // Legacy/test mode: chain is set, do iteration here
      // First pull the beginOp to get the input data
      await beginOp.pull()

      const data = beginOp.inputs.data.value
      if (!Array.isArray(data) || data.length === 0) {
        const result = { data: [] as unknown[] }
        this.setCachedOutput(result)
        this.outputs.data.next(result.data)
        return result
      }

      const total = data.length
      const results: unknown[] = []

      // Chain is in reverse order (EndOp inputs first), get proper execution order
      const executionOrder = [...this.chain].reverse()

      // Find ForLoopMetaOp if present
      const metaOp = this.chain.find(op => op instanceof ForLoopMetaOp) as ForLoopMetaOp | undefined
      let accumulator: unknown = metaOp?.inputs.initialValue.value ?? null

      for (let index = 0; index < total; index++) {
        const item = data[index]
        const isFirst = index === 0
        const isLast = index === total - 1

        // Set iteration values on ForLoopBeginOp outputs
        beginOp.outputs.item.next(item)
        beginOp.outputs.index.next(index)
        beginOp.outputs.total.next(total)

        // CRITICAL: Cache BeginOp so downstream pulls return iteration values
        // Without this, pulling intermediate ops re-executes BeginOp and gets arr[0]
        beginOp.setCachedOutput({ item, index, total })

        // Set iteration metadata on ForLoopMetaOp if present
        if (metaOp) {
          metaOp.outputs.accumulator.next(accumulator)
          metaOp.outputs.index.next(index)
          metaOp.outputs.total.next(total)
          metaOp.outputs.isFirst.next(isFirst)
          metaOp.outputs.isLast.next(isLast)
          metaOp.setCachedOutput({ accumulator, index, total, isFirst, isLast })
        }

        // Clear cache on intermediate operators so pull() re-executes them
        // NOTE: We use clearCache() not markDirty() because pull() checks _pullExecutionStatus, not dirty
        for (const op of executionOrder) {
          if (op !== beginOp && op !== metaOp && op !== this) {
            op.clearCache()
          }
        }

        // Execute chain in topological order by pulling each
        for (const op of executionOrder) {
          if (op !== beginOp && op !== metaOp && op !== this) {
            await op.pull()
          }
        }

        // Collect result - the input field should now have the value from upstream
        results.push(this.inputs.item.value)

        // Update accumulator from meta op for next iteration
        if (metaOp) {
          accumulator = metaOp.inputs.currentValue.value
        }
      }

      const result = { data: results }
      this.setCachedOutput(result)

      // Update output field
      this.outputs.data.next(results)

      return result
    } finally {
      this._iterating = false
    }
  }

  execute({ item }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // This execute() is called by pull() when no chain is set up.
    // When the chain is set up, executeIteration() handles the full iteration.
    return { data: item }
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
      initialValue: new DataField(new UnknownField(), {
        description: 'Starting value of Accumulator on the first iteration.',
      }),
      currentValue: new DataField(new UnknownField(), {
        description: 'Value to carry forward as Accumulator in the next iteration.',
      }),
    }
  }

  createOutputs() {
    return {
      accumulator: new DataField(new UnknownField(), {
        description:
          'Value carried over from the previous iteration, or Initial value on the first.',
      }),
      index: new NumberField(0, { description: 'Position of the current item, starting at 0.' }),
      total: new NumberField(0, { description: 'Number of items in the loop.' }),
      isFirst: new BooleanField(false, { description: 'True on the first iteration.' }),
      isLast: new BooleanField(false, { description: 'True on the last iteration.' }),
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
    const data = new DataField(new ArrayField(new UnknownField()), {
      description: 'Array of rows (objects) to filter.',
    })
    const columnName = new StringLiteralField('', {
      values: [],
      description: "Column to test in each row. Choices come from the first row's keys.",
    })

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
        description:
          "How to compare the column with Value. 'in' and 'not in' take a comma-separated list.",
      }),
      value: new StringField('', {
        description:
          "Text to compare with. Matching is strict, so 'equals' won't match number columns.",
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, { description: 'The rows that meet the condition.' }),
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
      data: new DataField(undefined, { description: 'Array to take a range of items from.' }),
      start: new NumberField(0, {
        min: 0,
        step: 1,
        description: 'Position of the first item to keep, starting at 0.',
      }),
      end: new NumberField(10, {
        min: 0,
        step: 1,
        optional: true,
        description: 'Position to stop before (not included). Leave empty to keep through the end.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'The items from Start up to, but not including, End.',
      }),
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
      data: new DataField(undefined, {
        description: 'Array of rows (objects) to sort by the Key column.',
      }),
      key: new StringField('', {
        description: 'Column to sort by. Works with numeric values only.',
      }),
      order: new StringLiteralField('asc', {
        values: ['asc', 'desc'],
        description: 'asc puts the smallest values first; desc puts the largest first.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'The rows in sorted order, by Key and Order.',
      }),
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
      data: new DataField(undefined, {
        description: 'Array of rows (objects) to add the random attribute to.',
      }),
      key: new StringField('', {
        description: 'Name of the attribute to set. Overwrites it if it exists.',
      }),
      min: new NumberField(0, {
        step: 0.01,
        description: 'Lowest random value. Values are spread evenly between Min and Max.',
      }),
      max: new NumberField(1, {
        step: 0.01,
        description: 'Highest random value. New values are drawn every time the node runs.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'Copies of the rows with Key set to a random number between Min and Max.',
      }),
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
      values: new ListField(new DataField(), {
        description: 'Arrays to join, in connection order. Accepts any number of connections.',
      }),
      depth: new NumberField(1, {
        min: 0,
        max: 2,
        description:
          'Levels to flatten, 0 to 2. 1 joins the arrays; 2 also flattens arrays inside them.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'One array holding the items of every input, in order.',
      }),
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

export class CrossOp extends Operator<CrossOp> {
  static displayName = 'Cross'
  static description =
    'Generate all unique pairs from an array. For example, [1, 2, 3] produces [[1, 2], [1, 3], [2, 3]]'
  createInputs() {
    return {
      data: new DataField(undefined, {
        description: 'Array of items to pair up. Each pair appears once, in input order.',
      }),
    }
  }
  createOutputs() {
    return {
      pairs: new DataField(undefined, {
        description: 'Every unique pair as [a, b]. [1, 2, 3] gives [[1, 2], [1, 3], [2, 3]].',
      }),
    }
  }
  execute({ data }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { pairs: utils.cross(data) }
  }
}

export class MergeOp extends Operator<MergeOp> {
  static displayName = 'Merge'
  static description = 'Merge multiple objects into one (think Object.assign)'
  createInputs() {
    return {
      objects: new ListField(new DataField(), {
        description: 'Objects to combine, in connection order. Later ones overwrite matching keys.',
      }),
    }
  }
  createOutputs() {
    return {
      object: new DataField(undefined, {
        description: 'A new object with the keys of every input.',
      }),
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
      position: new Vec2Field(undefined, {
        description: 'Mouse position in pixels from the top-left of the output area, as {x, y}.',
      }),
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

export class ProjectOp extends Operator<ProjectOp> {
  static displayName = 'Project'
  static description =
    'Project a lat/lng point to a screen position. Requires the ViewState and dimensions of the map.'
  createInputs() {
    return {
      position: new Point2DField(undefined, {
        description: 'Point to convert, as {lng, lat} in degrees.',
      }),
      width: new NumberField(1920, {
        min: 1,
        softMax: 10_000,
        description: 'Width of the map in pixels.',
      }),
      height: new NumberField(1080, {
        min: 1,
        softMax: 10_000,
        description: 'Height of the map in pixels.',
      }),
      viewState: new CompoundPropsField(
        {
          latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.1 }),
          longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.1 }),
          zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
          pitch: new NumberField(0),
          bearing: new NumberField(0),
        },
        { description: 'Map camera: latitude, longitude, zoom, pitch and bearing.' }
      ),
    }
  }
  createOutputs() {
    return {
      screenPosition: new Vec2Field(undefined, {
        description: "Pixel position of the point from the map's top-left corner, as {x, y}.",
      }),
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
      screenPosition: new Vec2Field(undefined, {
        description: "Pixel position from the map's top-left corner, as {x, y}.",
      }),
      width: new NumberField(1920, {
        min: 1,
        softMax: 10_000,
        description: 'Width of the map in pixels.',
      }),
      height: new NumberField(1080, {
        min: 1,
        softMax: 10_000,
        description: 'Height of the map in pixels.',
      }),
      viewState: new CompoundPropsField(
        {
          latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.1 }),
          longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.1 }),
          zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
          pitch: new NumberField(0),
          bearing: new NumberField(0),
        },
        { description: 'Map camera: latitude, longitude, zoom, pitch and bearing.' }
      ),
    }
  }
  createOutputs() {
    return {
      point: new Point2DField(undefined, {
        description: 'Map location under the screen position, as {lng, lat} in degrees.',
      }),
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
      longitude: new NumberField(DEFAULT_LONGITUDE, {
        min: -180,
        max: 180,
        step: 0.001,
        description: 'Camera center longitude, in degrees (-180 to 180).',
      }),
      latitude: new NumberField(DEFAULT_LATITUDE, {
        min: -90,
        max: 90,
        step: 0.001,
        description: 'Camera center latitude, in degrees (-90 to 90).',
      }),
      zoom: new NumberField(12, {
        min: 0,
        max: 24,
        step: 0.1,
        description: 'Map zoom level, from 0 (whole world) to 24.',
      }),
      pitch: new NumberField(0, {
        min: 0,
        max: 85,
        optional: true,
        description: 'Camera tilt in degrees, from 0 (looking straight down) to 85.',
      }),
      bearing: new NumberField(0, {
        optional: true,
        description: 'Map rotation in degrees. 0 is north up.',
      }),
    }
  }
  createOutputs() {
    return {
      viewState: new CompoundPropsField(
        {
          longitude: new NumberField(),
          latitude: new NumberField(),
          zoom: new NumberField(),
          pitch: new NumberField(),
          bearing: new NumberField(),
        },
        { description: 'Camera object with longitude, latitude, zoom, pitch and bearing.' }
      ),
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
      viewState: new CompoundPropsField(
        {
          longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
          latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
          zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
          pitch: new NumberField(0, { min: 0, max: 85, optional: true }),
          bearing: new NumberField(0, { optional: true }),
        },
        {
          description: 'Camera object to split, with longitude, latitude, zoom, pitch and bearing.',
        }
      ),
    }
  }
  createOutputs() {
    return {
      longitude: new NumberField(undefined, {
        description: 'Camera center longitude, in degrees.',
      }),
      latitude: new NumberField(undefined, { description: 'Camera center latitude, in degrees.' }),
      zoom: new NumberField(undefined, { description: 'Map zoom level.' }),
      pitch: new NumberField(undefined, { description: 'Camera tilt, in degrees.' }),
      bearing: new NumberField(undefined, { description: 'Map rotation, in degrees.' }),
    }
  }
  execute({ viewState }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(viewState)
    return { ...viewState }
  }
}

export class MaplibreBasemapOp extends Operator<MaplibreBasemapOp> {
  static displayName = 'MaplibreBasemap'
  static description =
    'A MapLibre basemap with sky and lighting settings. Sky colors apply to mercator projection; light and atmosphere apply to globe projection.'

  createInputs() {
    return {
      mapStyle: new MapStyleField(CARTO_DARK, {
        accept: '.json',
        description:
          'Style URL, uploaded .json style, or style object. Empty turns the basemap off.',
      }),
      projection: new StringLiteralField('mercator', {
        values: ['mercator', 'globe'],
        showByDefault: false,
        description: "Flat 'mercator' map or 3D 'globe'.",
      }),
      viewState: new CompoundPropsField(
        {
          latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
          longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
          zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
          pitch: new NumberField(0, { min: 0, max: 85, optional: true }),
          bearing: new NumberField(0, { optional: true }),
        },
        {
          description:
            'Camera latitude, longitude, zoom, pitch and bearing. Out-of-range values error.',
        }
      ),
      sky: new CompoundPropsField(
        {
          enabled: new BooleanField(false),
          skyColor: new ColorField('#88C6FC'),
          horizonColor: new ColorField('#ffffff'),
          skyHorizonBlend: new NumberField(0.8, { min: 0, max: 1, step: 0.01 }),
          atmosphereBlend: new NumberField(0.5, { min: 0, max: 1, step: 0.01 }),
        },
        {
          showByDefault: false,
          description: 'Sky and horizon colors and blends. Applies to the mercator projection.',
        }
      ),
      light: new CompoundPropsField(
        {
          anchor: new StringLiteralField('viewport', ['map', 'viewport']),
          azimuthal: new NumberField(210, { step: 1 }),
          polar: new NumberField(30, { step: 1 }),
        },
        {
          showByDefault: false,
          description:
            'Light anchor and direction (azimuthal and polar angles). Applies to globe projection.',
        }
      ),
    }
  }

  createOutputs() {
    return {
      maplibre: new CompoundPropsField(
        {
          mapStyle: new MapStyleField(),
          projection: new StringField(),
          longitude: new NumberField(),
          latitude: new NumberField(),
          zoom: new NumberField(),
          pitch: new NumberField(),
          bearing: new NumberField(),
          light: new UnknownField(),
          sky: new UnknownField(),
        },
        {
          useDeepEquality: true,
          maxDepth: 2,
          label: 'Basemap',
          description: 'Basemap settings and camera in one object, for Basemap on a DeckRenderer.',
        }
      ),
    }
  }
  execute({
    mapStyle,
    projection,
    viewState,
    light,
    sky,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(viewState)

    return {
      maplibre: {
        mapStyle,
        projection,
        ...viewState,
        light,
        sky,
      },
    }
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
      id: new StringField('custom-layer', {
        label: 'Layer ID',
        description: 'Unique MapLibre layer ID. A layer with the same ID is replaced.',
      }),
      code: new CodeField('', {
        language: 'javascript',
        description:
          'Function body that gets params and map and returns an object with a render method.',
      }),
      renderingMode: new StringLiteralField('3d', {
        values: ['2d', '3d'],
        description: "'3d' shares the map's depth buffer; '2d' draws flat with no depth.",
      }),
      beforeId: new StringField('', {
        optional: true,
        showByDefault: false,
        label: 'Before layer ID',
        description: 'ID of an existing map layer to draw under. Empty adds it on top.',
      }),
      params: new UnknownField(
        {},
        {
          optional: true,
          showByDefault: false,
          description: 'Values passed to the code as params.',
        }
      ),
    }
  }

  createOutputs() {
    return {
      layer: new MapLibreLayerField(undefined, {
        description: 'Custom layer config, for MapLibre layers on a DeckRenderer.',
      }),
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
      baseStyle: new FileUrlField(CARTO_DARK, {
        accept: '.json',
        description: 'MapLibre style JSON to start from, as a URL or file.',
      }),
      // Stores layer + global overrides as { layers: LayerOverride[], global: StyleGlobalOverrides }
      overrides: new UnknownField(
        { layers: [], global: {} },
        {
          label: 'Style edits',
          description: 'Layer color, font and visibility edits made in the style editor.',
        }
      ),
    }
  }

  createOutputs() {
    return {
      // UnknownField because execute() returns a full style object, not just a URL string
      mapStyle: new UnknownField(undefined, {
        description: 'The edited MapLibre style object. Connect it to a MaplibreBasemap node.',
      }),
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

export class DeckRendererOp extends Operator<DeckRendererOp> {
  static displayName = 'DeckRenderer'
  static description = 'Render a deck.gl visualization with layers and effects.'

  createInputs() {
    return {
      layers: new ListField(new LayerField(), {
        description: 'Layers to draw, in connection order. The last one connected draws on top.',
      }), // TODO: extend LayerField schema to support the beforeId prop.
      effects: new ListField(new EffectField(), {
        showByDefault: false,
        description: 'Effects such as lighting or post-processing applied to the whole scene.',
      }),
      // Additional views on top of the map. A MapView({id: 'mapbox'}) will be inserted at the bottom of the stack.
      views: new ListField(new ViewField(), {
        description: 'Extra views drawn on top of the main map view.',
      }),
      widgets: new ListField(new WidgetField(), {
        showByDefault: false,
        description: 'On-screen controls such as zoom, compass or scale bar.',
      }),
      layerFilter: new FunctionField(() => true, {
        showByDefault: false,
        description:
          'Function that decides whether each layer draws in each view. Draws all by default.',
      }),
      // TODO: We need a nullable field. This should be a nullable (intentionally empty), or a compound object below.
      // TODO: Nullable fields need to be disable-able from the UI so their values can be cleared.
      basemap: new UnknownField(
        {
          mapStyle: CARTO_DARK,
          latitude: DEFAULT_LATITUDE,
          longitude: DEFAULT_LONGITUDE,
          zoom: 12,
        },
        {
          optional: true,
          description:
            'The map under the layers, usually from Maplibre basemap. Shows a dark map by default.',
        }
      ),
      // basemap: new CompoundPropsField({
      //   mapStyle: new FileUrlField(CARTO_DARK),
      //   latitude: new NumberField(DEFAULT_LATITUDE, { min: -90, max: 90, step: 0.001 }),
      //   longitude: new NumberField(DEFAULT_LONGITUDE, { min: -180, max: 180, step: 0.001 }),
      //   zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
      //   pitch: new NumberField(0, { min: 0, max: 60, optional: true }),
      //   bearing: new NumberField(0, { optional: true }),
      // }, { optional: true }),
      viewState: new UnknownField(
        {},
        {
          showByDefault: false,
          description:
            "Camera position. Its longitude, latitude, zoom, pitch and bearing override the basemap's.",
        }
      ),
      maplibreLayers: new ListField(new MapLibreLayerField(), {
        optional: true,
        showByDefault: false,
        label: 'MapLibre layers',
        description: 'Extra MapLibre style layers to add to the basemap.',
      }),
    }
  }
  createOutputs() {
    return {
      vis: new VisualizationField(undefined, {
        useDeepEquality: true,
        maxDepth: 3,
        description:
          'The finished visualization. Connect it to Visualization on the Out operator at /out.',
      }),
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
    maplibreLayers,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Validate the ViewState to ensure lat/lng are within valid bounds
    validateViewState(viewState)

    // Extract geo fields from basemap so standalone DeckGL gets the correct position
    // when basemapEnabled=false (empty mapStyle). MapLibreOverlay ignores viewState, so
    // this doesn't affect the interleaved basemap rendering path.
    const basemapViewState = basemap
      ? pick(basemap, ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'])
      : {}
    if (basemap) validateViewState(basemapViewState)

    const deckProps: VisualizationDeckProps = {
      layers,
      effects,
      ...(views?.length > 0 ? { views } : {}),
      viewState: { ...basemapViewState, ...viewState },
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
        maplibreLayers: maplibreLayers || [],
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
    x: new NumberField(0, {
      showByDefault: false,
      description: 'Left edge of this view on the canvas, in pixels.',
    }),
    y: new NumberField(0, {
      showByDefault: false,
      description: 'Top edge of this view on the canvas, in pixels.',
    }),
    width: new StringField('100%', {
      description: "View width, in pixels or as a percent of the canvas, e.g. '100%' or '50%'.",
    }),
    height: new StringField('100%', {
      description: "View height, in pixels or as a percent of the canvas, e.g. '100%' or '50%'.",
    }),
    padding: new CompoundPropsField(
      {
        top: new NumberField(0, { min: 0 }),
        right: new NumberField(0, { min: 0 }),
        bottom: new NumberField(0, { min: 0 }),
        left: new NumberField(0, { min: 0 }),
      },
      { description: 'Space in pixels on each side of the view, which shifts its center.' }
    ),
    clear: new BooleanField(false, {
      showByDefault: false,
      description: 'Wipe pixels drawn by other overlapping views before drawing this one.',
    }),
    clearColor: new ColorField('#00000000', {
      transform: hexToColor,
      showByDefault: false,
      description: "Color the view's area is wiped to when Clear is on. Transparent by default.",
    }),
    parameters: new CompoundPropsField(
      {},
      {
        showByDefault: false,
        description:
          "GPU parameters, such as blending or depth testing, used to draw this view's layers.",
      }
    ),
  }
}

function createGeoViewFields() {
  return {
    altitude: new NumberField(1.5, {
      softMin: -100_000,
      softMax: 100_000,
      step: 0.1,
      showByDefault: false,
      description: 'Camera distance from the screen, in multiples of the viewport height.',
    }),
    nearZMultiplier: new NumberField(0.1, {
      min: 0,
      softMax: 1_000,
      step: 0.1,
      showByDefault: false,
      label: 'Near Z multiplier',
      description: 'Distance of the near clipping plane, in multiples of the viewport height.',
    }),
    farZMultiplier: new NumberField(1.01, {
      min: 0,
      softMax: 1_000,
      showByDefault: false,
      label: 'Far Z multiplier',
      description:
        "Distance of the far clipping plane, relative to the camera's distance to the screen's top edge.",
    }),
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
      orthographic: new BooleanField(false, {
        showByDefault: false,
        description: 'Use a flat orthographic projection instead of perspective.',
      }),
      fovy: new NumberField(40, {
        min: 0.1,
        max: 179.9,
        showByDefault: false,
        label: 'Field of view',
        description: 'Vertical field of view of the camera, in degrees (0.1 to 179.9).',
      }),
      repeat: new BooleanField(false, {
        showByDefault: false,
        description: 'Draw repeated copies of the world side by side at low zoom levels.',
      }),
      ...createGeoViewFields(),
      viewState: new CompoundPropsField(
        {
          ...createGeoViewStateFields(),
          zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
          bearing: new NumberField(0, { optional: true }),
          pitch: new NumberField(0, { min: 0, max: 90, optional: true }),
          position: new Vec3Field([0, 0, 0], { returnType: 'tuple', optional: true }),
        },
        {
          description:
            'Camera latitude, longitude, zoom, bearing, pitch (0 to 90) and offset in meters.',
        }
      ),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(undefined, {
        description: 'The view, to connect to Views on a DeckRenderer.',
      }),
    }
  }

  execute({
    viewState,
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(viewState)
    return {
      view: { type: 'MapView', id: this.id, ...props, viewState: { ...viewState, maxPitch: 90 } },
    }
  }
}

export class GraphInputOp extends Operator<GraphInputOp> {
  static displayName = 'GraphInput'
  static description = 'Receives input from the parent Container.'
  private _containerSub: Subscription | null = null
  private _containerInputDependencies = new Set<Operator<IOperator>>()

  createInputs() {
    return {
      parentValue: new UnknownField(null, {
        optional: true,
        description: "Value from the parent Container's In input, connected automatically.",
      }),
    }
  }

  createOutputs() {
    return {
      value: new UnknownField(null, {
        optional: true,
        description: "The parent Container's In value, for use by nodes inside it.",
      }),
    }
  }

  execute(inputs: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const result: Record<string, unknown> = { value: inputs.parentValue }
    // Pass through all custom field values from inputs to outputs
    for (const key of Object.keys(this.outputs)) {
      if (key !== 'value' && key in inputs) {
        result[key] = inputs[key]
      }
    }
    return result as ExtractProps<typeof this.outputs>
  }

  /**
   * Mirror the operators feeding the parent container as direct pull
   * dependencies. The value still flows through the container fields, but
   * this relationship guarantees those fields are populated before the child
   * graph reads them on its first pull.
   */
  setContainerInputDependencies(dependencies: Iterable<Operator<IOperator>>) {
    const nextDependencies = new Set(dependencies)
    let changed = false

    for (const dependency of this._containerInputDependencies) {
      if (nextDependencies.has(dependency)) continue
      dependency.removeDownstreamDependent(this)
      this.removeUpstreamDependency(dependency)
      changed = true
    }

    for (const dependency of nextDependencies) {
      if (this._containerInputDependencies.has(dependency)) continue
      dependency.addDownstreamDependent(this)
      this.addUpstreamDependency(dependency)
      changed = true
    }

    this._containerInputDependencies = nextDependencies
    if (changed) this.markDirty()
  }

  /**
   * Set the parent ContainerOp and subscribe to custom field changes.
   * When container custom fields change, rebuild outputs to mirror them.
   */
  setParentContainer(containerOp: ContainerOp | null) {
    // Unsubscribe from previous container
    if (this._containerSub) {
      this._containerSub.unsubscribe()
      this._containerSub = null
    }

    if (containerOp) {
      // Initial sync
      this.rebuildFromContainer(containerOp)

      // Subscribe to future changes
      this._containerSub = containerOp.customFieldsChanged.subscribe(() => {
        this.rebuildFromContainer(containerOp)
      })
    }
  }

  /**
   * Rebuild both inputs and outputs to mirror the parent ContainerOp's custom input fields.
   * Creates an input and output for each custom field on the container.
   * This allows values to flow: container input → GraphInputOp input → execute() → GraphInputOp output
   */
  rebuildFromContainer(containerOp: ContainerOp) {
    // Preserve old values where possible
    const oldInputValues = new Map<string, unknown>()
    for (const [name, field] of Object.entries(this.inputs)) {
      oldInputValues.set(name, field.value)
    }
    const oldOutputValues = new Map<string, unknown>()
    for (const [name, field] of Object.entries(this.outputs)) {
      oldOutputValues.set(name, field.value)
    }

    // Rebuild inputs: parentValue + custom fields. The base parentValue field
    // object is PRESERVED, not recreated: transformGraph wires the parent
    // container's `in` field to it via addConnection, and replacing the object
    // orphans that subscription — data arriving after the rebuild (e.g. an
    // async FileOp upstream of the container) then never reaches the
    // container's children, silently freezing them on the initial value.
    const newInputs: Record<string, Field> = {
      parentValue: this.inputs.parentValue ?? new UnknownField(null, { optional: true }),
    }
    for (const def of containerOp.customInputDefinitions) {
      const field = this.createFieldFromDefinition(def)
      newInputs[def.name] = field
    }
    this.inputs = newInputs as ReturnType<GraphInputOp['createInputs']>

    // Rebuild outputs: value + custom fields (base `value` preserved for the
    // same reason — downstream edges subscribe to the field object).
    const newOutputs: Record<string, Field> = {
      value: this.outputs.value ?? new UnknownField(null, { optional: true }),
    }
    for (const def of containerOp.customInputDefinitions) {
      const field = this.createFieldFromDefinition(def)
      newOutputs[def.name] = field
    }
    this.outputs = newOutputs as ReturnType<GraphInputOp['createOutputs']>

    // Restore input values where field names match
    for (const [name, field] of Object.entries(this.inputs)) {
      if (oldInputValues.has(name)) {
        try {
          field.setValue(oldInputValues.get(name))
        } catch (_err) {
          // Type mismatch, skip
        }
      }
    }

    // Restore output values where field names match
    for (const [name, field] of Object.entries(this.outputs)) {
      if (oldOutputValues.has(name)) {
        try {
          field.setValue(oldOutputValues.get(name))
        } catch (_err) {
          // Type mismatch, skip
        }
      }
    }

    // Re-assign pathToProps for inputs
    for (const [key, field] of Object.entries(this.inputs)) {
      field.pathToProps = [this.id, IN_NS, key]
      field.op = this
    }

    // Re-assign pathToProps for outputs
    for (const [key, field] of Object.entries(this.outputs)) {
      field.pathToProps = [this.id, OUT_NS, key]
      field.op = this
    }

    // Notify that fields changed
    this.markDirty()
  }

  dispose() {
    this.setContainerInputDependencies([])
    if (this._containerSub) {
      this._containerSub.unsubscribe()
    }
    super.dispose()
  }
}

export class GraphOutputOp extends Operator<GraphOutputOp> {
  static displayName = 'GraphOutput'
  static description = 'Provides output to the parent Container.'

  createInputs() {
    return {
      value: new UnknownField(null, {
        optional: true,
        description: "Value to send out through the parent Container's Out output.",
      }),
    }
  }

  createOutputs() {
    return {
      propagatedValue: new UnknownField(null, {
        optional: true,
        label: 'Output value',
        description: 'The same value, read by the parent Container.',
      }),
    }
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
      viewState: new CompoundPropsField(
        {
          ...createGeoViewStateFields(),
          zoom: new NumberField(12, { min: 0, max: 24, step: 0.1 }),
        },
        { description: 'Camera latitude, longitude and zoom (0 to 24).' }
      ),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(undefined, {
        description: 'The view, to connect to Views on a DeckRenderer.',
      }),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(props.viewState)
    return { view: { type: 'GlobeView', id: this.id, ...props } }
  }
}

export class FpsWidgetOp extends Operator<FpsWidgetOp> {
  static displayName = 'FpsWidget'
  static description = 'Display frames per second (FPS) and rendering stats widget'

  createInputs() {
    return {
      placement: new StringLiteralField('top-left', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner of the map where the frame rate stats appear.',
      }),
      viewId: new StringField('', {
        optional: true,
        description:
          'View to attach the stats to, needed with multiple views. Empty uses the default.',
      }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(undefined, {
        description: "Stats widget to connect to a DeckRenderer's Widgets input.",
      }),
    }
  }

  execute({
    placement,
    viewId,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const widget = {
      id: this.id,
      type: '_StatsWidget',
      placement,
      ...(viewId && viewId !== '' ? { viewId } : {}),
    }
    return { widget }
  }
}

export class FullscreenWidgetOp extends Operator<FullscreenWidgetOp> {
  static displayName = 'FullscreenWidget'
  static description = 'Enter/exit fullscreen widget'

  createInputs() {
    return {
      placement: new StringLiteralField('top-right', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner of the map where the fullscreen button appears.',
      }),
      viewId: new StringField('', {
        optional: true,
        description:
          'View to attach the button to, needed with multiple views. Empty uses the default.',
      }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(undefined, {
        description: "Fullscreen widget to connect to a DeckRenderer's Widgets input.",
      }),
    }
  }

  execute({
    placement,
    viewId,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const widget = {
      id: this.id,
      type: 'FullscreenWidget',
      placement,
      ...(viewId && viewId !== '' ? { viewId } : {}),
    }
    return { widget }
  }
}

export class ZoomWidgetOp extends Operator<ZoomWidgetOp> {
  static displayName = 'ZoomWidget'
  static description = 'Zoom in/out buttons widget'

  createInputs() {
    return {
      placement: new StringLiteralField('top-right', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner of the map where the zoom buttons appear.',
      }),
      zoomStep: new NumberField(1, {
        min: 0,
        softMax: 10,
        showByDefault: false,
        description: 'How many zoom levels each button press changes the map by.',
      }),
      viewId: new StringField('', {
        optional: true,
        description:
          'View to attach the buttons to, needed with multiple views. Empty uses the default.',
      }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(undefined, {
        description: "Zoom widget to connect to a DeckRenderer's Widgets input.",
      }),
    }
  }

  execute({
    placement,
    zoomStep,
    viewId,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const widget = {
      id: this.id,
      type: 'ZoomWidget',
      placement,
      zoomStep,
      ...(viewId && viewId !== '' ? { viewId } : {}),
    }
    return { widget }
  }
}

export class CompassWidgetOp extends Operator<CompassWidgetOp> {
  static displayName = 'CompassWidget'
  static description = 'Compass and bearing reset widget'

  createInputs() {
    return {
      placement: new StringLiteralField('top-right', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner of the map where the compass appears.',
      }),
      viewId: new StringField('', {
        optional: true,
        description:
          'View to attach the compass to, needed with multiple views. Empty uses the default.',
      }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(undefined, {
        description: "Compass widget to connect to a DeckRenderer's Widgets input.",
      }),
    }
  }

  execute({
    placement,
    viewId,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const widget = {
      id: this.id,
      type: 'CompassWidget',
      placement,
      ...(viewId && viewId !== '' ? { viewId } : {}),
    }
    return { widget }
  }
}

export class ScaleWidgetOp extends Operator<ScaleWidgetOp> {
  static displayName = 'ScaleWidget'
  static description = 'Display a map distance scale widget'

  createInputs() {
    return {
      placement: new StringLiteralField('bottom-left', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner of the map where the distance scale bar appears.',
      }),
      label: new StringField('Scale', {
        description: 'Name for the scale widget. The bar shows its own distance text.',
      }),
      viewId: new StringField('', {
        optional: true,
        description:
          'View to attach the scale bar to, needed with multiple views. Empty uses the default.',
      }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(undefined, {
        description: "Scale widget to connect to a DeckRenderer's Widgets input.",
      }),
    }
  }

  execute({
    placement,
    label,
    viewId,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const widget = {
      id: this.id,
      type: '_ScaleWidget',
      placement,
      label,
      ...(viewId && viewId !== '' ? { viewId } : {}),
    }
    return { widget }
  }
}

export class ScreenshotWidgetOp extends Operator<ScreenshotWidgetOp> {
  static displayName = 'ScreenshotWidget'
  static description = 'Download current frame as PNG widget'

  createInputs() {
    return {
      placement: new StringLiteralField('top-right', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner of the map where the screenshot button appears.',
      }),
      viewId: new StringField('', {
        optional: true,
        description:
          'View to attach the button to, needed with multiple views. Empty uses the default.',
      }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(undefined, {
        description: 'Button widget that downloads the current frame as a PNG.',
      }),
    }
  }

  execute({
    placement,
    viewId,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const widget = {
      id: this.id,
      type: 'ScreenshotWidget',
      placement,
      ...(viewId && viewId !== '' ? { viewId } : {}),
    }
    return { widget }
  }
}

export class LegendWidgetOp extends Operator<LegendWidgetOp> {
  static displayName = 'LegendWidget'
  static description = 'Display a color scale legend overlay on the visualization'

  createInputs() {
    return {
      colorRamp: new ColorRampField(undefined, {
        description: 'Colors to show in the legend bar, sampled from 0 to 1.',
      }),
      label: new StringField('', {
        description: 'Title shown above the color bar. Hidden when empty.',
      }),
      minValue: new NumberField(0, { description: 'Number shown at the low end of the legend.' }),
      maxValue: new NumberField(1, { description: 'Number shown at the high end of the legend.' }),
      placement: new StringLiteralField('bottom-right', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        description: 'Corner of the map where the legend appears.',
      }),
      steps: new NumberField(12, {
        min: 2,
        max: 32,
        step: 1,
        showByDefault: false,
        description: 'How many colors to sample from the ramp, 2 to 32.',
      }),
      scale: new NumberField(1, {
        min: 0.25,
        max: 4,
        step: 0.25,
        description: 'Size multiplier for the legend, from 0.25 to 4.',
      }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(undefined, {
        description: "Legend widget to connect to a DeckRenderer's Widgets input.",
      }),
    }
  }

  execute({
    colorRamp,
    label,
    minValue,
    maxValue,
    placement,
    steps,
    scale,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const colorStops: string[] = []
    for (let i = 0; i < steps; i++) {
      colorStops.push(colorRamp(i / (steps - 1)))
    }
    const widget = {
      id: this.id,
      type: 'LegendWidget',
      colorStops,
      label,
      minValue,
      maxValue,
      placement,
      scale,
    }
    return { widget }
  }
}

export class BitmapOverlayWidgetOp extends Operator<BitmapOverlayWidgetOp> {
  static displayName = 'Bitmap Overlay'
  static description = 'Display a bitmap image as a screen-space overlay'

  createInputs() {
    return {
      image: new FileUrlField('', {
        accept: '.png,.jpg,.jpeg,.gif,.webp,.svg',
        description:
          'Image file or URL (PNG, JPG, GIF, WebP or SVG). @/ paths load from the project.',
      }),
      placement: new StringLiteralField('top-right', {
        values: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'fill'],
        description: "Corner to pin the image to, or 'fill' to center it over the map.",
      }),
      width: new NumberField(200, {
        min: 1,
        max: 2000,
        step: 1,
        description: 'Image width in pixels, before Scale is applied.',
      }),
      height: new NumberField(200, {
        min: 1,
        max: 2000,
        step: 1,
        description: 'Image height in pixels, before Scale is applied.',
      }),
      opacity: new NumberField(1, {
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Image transparency, from 0 (invisible) to 1 (solid).',
      }),
      scale: new NumberField(1, {
        min: 0.25,
        max: 4,
        step: 0.25,
        description: 'Size multiplier for the image, from 0.25 to 4.',
      }),
      offsetX: new NumberField(0, {
        min: -2000,
        max: 2000,
        step: 1,
        showByDefault: false,
        description: 'Horizontal shift in pixels from the placement position.',
      }),
      offsetY: new NumberField(0, {
        min: -2000,
        max: 2000,
        step: 1,
        showByDefault: false,
        description: 'Vertical shift in pixels from the placement position.',
      }),
      viewId: new StringField('', {
        optional: true,
        description:
          'View to attach the overlay to, needed with multiple views. Empty uses the default.',
      }),
    }
  }

  createOutputs() {
    return {
      widget: new WidgetField(undefined, {
        description: "Overlay widget to connect to a DeckRenderer's Widgets input.",
      }),
    }
  }

  async execute({
    image,
    placement,
    width,
    height,
    opacity,
    scale,
    offsetX,
    offsetY,
    viewId,
  }: ExtractProps<typeof this.inputs>): Promise<ExtractProps<typeof this.outputs>> {
    // Resolve project-relative paths (@/) to blob URLs
    let resolvedImage = image
    if (image?.startsWith(projectScheme)) {
      const { readAssetBinary } = await import('./storage')
      const { useFileSystemStore } = await import('./filesystem-store')

      const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
      if (!currentProjectName) {
        throw new Error('No project loaded. Please save or load a project first.')
      }

      const fileName = image.substring(projectScheme.length)
      const result = await readAssetBinary(activeStorageType, currentProjectName, fileName)
      if (!result.success) {
        throw new Error(result.error.message)
      }

      // Create blob URL from the binary data
      const blob = new Blob([result.data])
      resolvedImage = URL.createObjectURL(blob)
    }

    const widget = {
      id: this.id,
      type: 'BitmapOverlay',
      image: resolvedImage,
      placement,
      width,
      height,
      opacity,
      scale,
      offsetX,
      offsetY,
      ...(viewId && viewId !== '' ? { viewId } : {}),
    }
    return { widget }
  }
}

function createFrustumViewFields() {
  return {
    near: new NumberField(0.1, {
      min: 0,
      softMax: 1_000_000,
      step: 0.1,
      showByDefault: false,
      description: 'Distance from the camera to the near clipping plane, in world units.',
    }),
    far: new NumberField(100000, {
      min: 0,
      softMax: 1_000_000,
      showByDefault: false,
      description: 'Distance from the camera to the far clipping plane, in world units.',
    }),
  }
}

export class FirstPersonViewOp extends Operator<FirstPersonViewOp> {
  static displayName = 'FirstPersonView'
  static description = 'A deck.gl first person view.'

  createInputs() {
    return {
      ...createBaseViewFields(),
      orthographic: new BooleanField(false, {
        showByDefault: false,
        description: 'Use a flat orthographic projection instead of perspective.',
      }),
      ...createFrustumViewFields(),
      fovy: new NumberField(40, {
        min: 0.1,
        max: 179.9,
        showByDefault: false,
        label: 'Field of view',
        description: 'Vertical field of view of the camera, in degrees (0.1 to 179.9).',
      }),
      // focalDistance: new NumberField(1),
      viewState: new CompoundPropsField(
        {
          ...createGeoViewStateFields(),
          position: new Vec3Field([0, 0, 0], { returnType: 'tuple' }),
          bearing: new NumberField(0, { optional: true }),
          pitch: new NumberField(0, { min: -90, max: 90, optional: true }),
        },
        {
          description:
            'Camera latitude, longitude, offset [x, y, z] in meters, bearing and pitch in degrees.',
        }
      ),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(undefined, {
        description: 'The view, to connect to Views on a DeckRenderer.',
      }),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(props.viewState)
    return { view: { type: 'FirstPersonView', id: this.id, ...props } }
  }
}

export class OrbitViewOp extends Operator<OrbitViewOp> {
  static displayName = 'OrbitView'
  static description = 'A deck.gl orbit view.'

  createInputs() {
    return {
      ...createBaseViewFields(),
      orthographic: new BooleanField(false, {
        showByDefault: false,
        description: 'Use a flat orthographic projection instead of perspective.',
      }),
      orbitAxis: new StringLiteralField('Z', {
        values: ['X', 'Y', 'Z'],
        showByDefault: false,
        description: 'Axis the camera can spin all the way around.',
      }),
      ...createFrustumViewFields(),
      fovy: new NumberField(40, {
        min: 0.1,
        max: 179.9,
        showByDefault: false,
        label: 'Field of view',
        description: 'Vertical field of view of the camera, in degrees (0.1 to 179.9).',
      }),
      viewState: new CompoundPropsField(
        {
          target: new Vec3Field([0, 0, 0], { returnType: 'tuple', optional: true }),
          rotationOrbit: new NumberField(0, { optional: true }),
          rotationX: new NumberField(0, { optional: true }),
          zoom: new NumberField(1, {
            softMin: -10,
            softMax: 10,
            step: 0.01,
            optional: true,
          }),
        },
        {
          description:
            'Point the camera orbits [x, y, z], orbit and X rotation in degrees, and zoom.',
        }
      ),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(undefined, {
        description: 'The view, to connect to Views on a DeckRenderer.',
      }),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(props.viewState)
    return { view: { type: 'OrbitView', id: this.id, ...props } }
  }
}

export class OrthographicViewOp extends Operator<OrthographicViewOp> {
  static displayName = 'OrthographicView'
  static description = 'A deck.gl orthographic view.'

  createInputs() {
    return {
      ...createBaseViewFields(),
      ...createFrustumViewFields(),
      flipY: new BooleanField(false, {
        showByDefault: false,
        label: 'Flip Y',
        description:
          'On puts the origin at the top left with Y growing down; off puts it at bottom left.',
      }),
      viewState: new CompoundPropsField(
        {
          target: new Vec3Field([0, 0, 0], { returnType: 'tuple', optional: true }),
          zoom: new NumberField(0, { optional: true }),
        },
        {
          description:
            'World point [x, y, z] at the view center, and zoom (each step doubles the scale).',
        }
      ),
    }
  }

  createOutputs() {
    return {
      view: new ViewField(undefined, {
        description: 'The view, to connect to Views on a DeckRenderer.',
      }),
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    validateViewState(props.viewState)
    return { view: { type: 'OrthographicView', id: this.id, ...props } }
  }
}

export class OutOp extends Operator<OutOp> {
  static displayName = 'Out'
  static description = 'Output a visualization.'
  createInputs() {
    return {
      vis: new VisualizationField(undefined, {
        label: 'Visualization',
        description: 'The visualization to show and export, usually from Deck renderer.',
      }),
      // Render settings (not keyframable since OutOp is excluded from Theatre.js)
      display: new StringLiteralField('fixed', {
        values: ['fixed', 'responsive'],
        description: 'Fixed renders at Width by Height; responsive fills the available panel.',
      }),
      width: new NumberField(1920, {
        min: 1,
        max: 8192,
        step: 1,
        description: 'Output and export width in pixels, from 1 to 8192.',
      }),
      height: new NumberField(1080, {
        min: 1,
        max: 8192,
        step: 1,
        description: 'Output and export height in pixels, from 1 to 8192.',
      }),
      lod: new NumberField(2, {
        min: 0.1,
        max: 4,
        step: 0.1,
        label: 'Level of detail',
        description:
          'Multiplies the drawing size for sharper map tiles. Video still exports at Width by Height.',
      }),
      scaleMode: new StringLiteralField('fit', {
        values: ['fit', 'manual'],
        description: 'Fit shrinks the fixed-size output to the panel; manual uses Preview scale.',
      }),
      waitForData: new BooleanField(true, {
        description:
          'During export, wait for layers to finish loading before capturing each frame.',
      }),
      codec: new StringLiteralField('avc', {
        values: ['avc', 'hevc', 'vp9', 'av1'],
        description: 'Video codec for exports: avc (H.264), hevc (H.265), vp9 or av1.',
      }),
      bitrateMbps: new NumberField(10, {
        min: 1,
        max: 100,
        step: 1,
        label: 'Bitrate (Mbps)',
        description: 'Video export bitrate in megabits per second, from 1 to 100.',
      }),
      bitrateMode: new StringLiteralField('constant', {
        values: ['constant', 'variable'],
        description: 'Constant keeps the bitrate steady; variable lets it change with the content.',
      }),
      // Keep the canvas's transparency in video exports (VP9 only)
      exportAlpha: new BooleanField(false, {
        label: 'Keep transparency',
        description: 'Export a transparent WebM video. Only works with the vp9 codec.',
      }),
      scaleControl: new NumberField(0.3, {
        min: 0.1,
        max: 1,
        step: 0.05,
        label: 'Preview scale',
        description:
          'Zoom of the fixed-size output in the panel, 0.1 to 1. Used when Scale mode is manual.',
      }),
      framerate: new NumberField(30, {
        min: 1,
        max: 120,
        step: 1,
        description: 'Frames per second for playback and export, from 1 to 120.',
      }),
      captureDelay: new NumberField(50, {
        min: 0,
        max: 10000,
        step: 10,
        description: 'Time to wait after each frame renders before capturing it, in milliseconds.',
      }),
      // final waits for each frame to settle; preview captures on the first render and
      // can drop or repeat frames
      captureMode: new StringLiteralField('final', {
        values: ['final', 'preview'],
        description:
          'Final waits for each frame to settle; preview is faster but can drop or repeat frames.',
      }),
      rendersDirectory: new StringField('renders', {
        description: 'Folder in the project where image sequence exports are saved.',
      }),
      sequenceFormat: new StringLiteralField('png', {
        values: ['png', 'exr'],
        description: 'File format for image sequence exports: png or exr.',
      }),
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
      data: new DataField(undefined, {
        description: 'Any value to print to the browser console each time it changes.',
      }),
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

// A note shown in the graph to explain the nodes beside it. It has no handles,
// so nothing connects to it, and running it does nothing.
export class CommentOp extends Operator<CommentOp> {
  static displayName = 'Comment'
  static description =
    'A note that explains the nodes beside it. Double-click to edit its text. Nothing connects to it'
  createInputs() {
    return {
      text: new StringField('', {
        description: "The note's text. Double-click the node to edit it.",
      }),
    }
  }
  createOutputs() {
    return {}
  }
  execute(_: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return {}
  }
}

export class RerouteOp extends Operator<RerouteOp> {
  static displayName = 'Reroute'
  static description = 'Pass-through for organizing graph layout'
  createInputs() {
    return {
      value: new UnknownField(undefined, {
        optional: true,
        description: 'Any value. Passed through unchanged to tidy up long connections.',
      }),
    }
  }
  createOutputs() {
    return {
      value: new UnknownField(undefined, { description: 'The same value, unchanged.' }),
    }
  }
  execute({ value }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return { value }
  }
}

export class LayerPropsOp extends Operator<LayerPropsOp> {
  static displayName = 'LayerProps'
  static description =
    'Add additional props to a layer (e.g., operation: "mask" for mask layers, beforeId for maplibre layer ordering)'
  createInputs() {
    return {
      layer: new LayerField(undefined, { description: 'Layer to add props to.' }),
      operation: new StringField('', {
        optional: true,
        description: "deck.gl layer operation, such as 'mask' or 'terrain'. Skipped when empty.",
      }),
      beforeId: new StringField('', {
        optional: true,
        description: 'MapLibre layer ID to draw this layer beneath. Skipped when empty.',
      }),
      additionalProps: new UnknownField(
        {},
        {
          optional: true,
          description: 'Object of extra layer props, merged last so they override the others.',
        }
      ),
    }
  }
  createOutputs() {
    return {
      layer: new LayerField(undefined, { description: 'The layer with the added props.' }),
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

export class BlendingOp extends Operator<BlendingOp> {
  static displayName = 'Blending'
  static description = 'Configure WebGL blending mode for layers (additive, normal, subtractive)'
  createInputs() {
    return {
      mode: new StringLiteralField('normal', {
        values: ['normal', 'additive', 'subtractive', 'custom'],
        description:
          "How layer colors combine with what is drawn below. 'custom' uses the two factors.",
      }),
      // Custom mode fields (only used when mode='custom')
      blendColorSrcFactor: new StringLiteralField('src-alpha', {
        values: [
          'src-alpha',
          'one',
          'zero',
          'dst-alpha',
          'one-minus-src-alpha',
          'one-minus-dst-alpha',
          'one-minus-dst-color',
        ],
        optional: true,
        showByDefault: false,
        label: 'Source factor',
        description: "Multiplier for the layer's own color. Only used when Mode is 'custom'.",
      }),
      blendColorDstFactor: new StringLiteralField('one-minus-src-alpha', {
        values: [
          'src-alpha',
          'one',
          'zero',
          'dst-alpha',
          'one-minus-src-alpha',
          'one-minus-dst-alpha',
          'one-minus-dst-color',
        ],
        optional: true,
        showByDefault: false,
        label: 'Destination factor',
        description:
          "Multiplier for the color already drawn below. Only used when Mode is 'custom'.",
      }),
    }
  }
  createOutputs() {
    return {
      parameters: new UnknownField(
        {},
        { description: "WebGL blend settings object to pass to a layer's Parameters input." }
      ),
    }
  }
  execute({
    mode,
    blendColorSrcFactor,
    blendColorDstFactor,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Kepler-style presets using luma.gl v9 parameter names
    const presets = {
      normal: {
        blend: true,
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'one-minus-src-alpha',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one-minus-src-alpha',
        blendColorOperation: 'add',
        blendAlphaOperation: 'add',
      },
      additive: {
        blend: true,
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'dst-alpha',
        blendColorOperation: 'add',
      },
      subtractive: {
        blend: true,
        blendColorSrcFactor: 'one',
        blendColorDstFactor: 'one-minus-dst-color',
        blendAlphaSrcFactor: 'src-alpha',
        blendAlphaDstFactor: 'dst-alpha',
        blendColorOperation: 'reverse-subtract',
        blendAlphaOperation: 'add',
      },
    }

    if (mode === 'custom' && blendColorSrcFactor && blendColorDstFactor) {
      return {
        parameters: {
          blend: true,
          blendColorSrcFactor,
          blendColorDstFactor,
          blendColorOperation: 'add',
        },
      }
    }

    return { parameters: presets[mode as keyof typeof presets] || presets.normal }
  }
}

export class PathLayerOp extends Operator<PathLayerOp> {
  static displayName = 'PathLayer'
  static description = 'Render a path on the map'
  createInputs() {
    return {
      data: new DataField(
        // TODO: Support data schema helpers *and* custom data schemas
        // new ArrayField(new ArrayField(new Point3DField([0, 0, 0], { returnType: 'tuple' })))
      ),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      billboard: new BooleanField(true, { showByDefault: false }),
      capRounded: new BooleanField(true, { showByDefault: false }),
      jointRounded: new BooleanField(false, { showByDefault: false }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      getPath: new UnknownField((d: unknown) => d?.path || [], { accessor: true }),
      // getPath: new ArrayField(new Point3DField([0, 0, 0], { returnType: 'tuple' }), { accessor: true }),
      getColor: new ColorField('#006ac6', { accessor: true, transform: hexToColor }),
      getWidth: new NumberField(8, { min: 0, softMax: 100, accessor: true }),
      widthUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      widthScale: new NumberField(20, { min: 0, softMax: 100, showByDefault: false }),
      widthMinPixels: new NumberField(2, { min: 0, softMax: 100, showByDefault: false }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
          depthWriteEnabled: new BooleanField(true),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
      wrapLongitude: new BooleanField(false, { showByDefault: false }),
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      stroked: new BooleanField(true, { showByDefault: false }),
      billboard: new BooleanField(false, { showByDefault: false }),
      antialiasing: new BooleanField(true, { showByDefault: false }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getPixelOffset: new Vec2Field([0, 0], {
        returnType: 'tuple',
        accessor: true,
        showByDefault: false,
      }),
      getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#fff', {
        accessor: true,
        transform: hexToColor,
        showByDefault: false,
      }),
      getRadius: new NumberField(20, { min: 0, softMax: 1_000_000, accessor: true }),
      getLineWidth: new NumberField(0, { min: 0, accessor: true, showByDefault: false }),
      radiusScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      radiusUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters'],
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
      billboard: new BooleanField(false, { showByDefault: false }),
      capRounded: new BooleanField(true, { showByDefault: false }),
      jointRounded: new BooleanField(true, { showByDefault: false }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      currentTime: new NumberField(0, { min: 0 }),
      fadeTrail: new BooleanField(false),
      trailLength: new NumberField(120, { min: 0 }),
      widthUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      widthMinPixels: new NumberField(2, { min: 0, softMax: 100, showByDefault: false }),
      widthScale: new NumberField(20, { min: 0, softMax: 100, showByDefault: false }),
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPolygon: new UnknownField((d: unknown) => d?.polygon || [], { accessor: true }),
      getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getLineColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(0, { min: 0, accessor: true }),
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getText: new StringField('', { accessor: true }),
      billboard: new BooleanField(true),
      fontFamily: new StringField('Inter', {
        description:
          "CSS font family for the labels, e.g. 'Inter' or 'Georgia, serif'. The font must be available.",
      }),
      fontWeight: new NumberField(400, {
        min: 100,
        max: 900,
        step: 100,
        description: 'CSS font weight, from 100 (thin) to 900 (black). 400 is normal, 700 is bold.',
      }),
      sizeUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      sizeScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      sizeMinPixels: new NumberField(0, { min: 0, softMax: 200, showByDefault: false }),
      sizeMaxPixels: new NumberField(Number.MAX_SAFE_INTEGER, {
        min: 0,
        softMax: 2048,
        showByDefault: false,
      }),
      getSize: new NumberField(48, { min: 0, softMax: 200, accessor: true }),
      getColor: new ColorField('#f0f0f0', { accessor: true, transform: hexToColor }),
      background: new BooleanField(false, {
        showByDefault: false,
        description:
          'Draw a box behind each label, using Background color and the border settings.',
      }),
      getBackgroundColor: new ColorField('#ffffffff', {
        accessor: true,
        transform: hexToColor,
        showByDefault: false,
        description: 'Fill color of the box behind each label. Only drawn when Background is on.',
      }),
      getBorderColor: new ColorField('#000000ff', {
        accessor: true,
        transform: hexToColor,
        showByDefault: false,
        description: "Color of the border around each label's background box. Needs Background on.",
      }),
      getBorderWidth: new NumberField(0, {
        min: 0,
        softMax: 20,
        accessor: true,
        showByDefault: false,
        description:
          "Width of the border around each label's background box, in pixels. 0 hides it.",
      }),
      backgroundPadding: new Vec2Field(
        { x: 0, y: 0 },
        {
          returnType: 'tuple',
          showByDefault: false,
          description:
            'Space between the text and the edge of its background box, as [x, y] in pixels.',
        }
      ),
      backgroundBorderRadius: new NumberField(0, {
        min: 0,
        softMax: 100,
        showByDefault: true,
        description:
          "Corner radius of each label's background box, in pixels. 0 gives square corners.",
      }),
      lineHeight: new NumberField(1, {
        min: 0,
        softMax: 4,
        step: 0.05,
        showByDefault: false,
        description: 'Spacing between lines of multi-line labels, as a multiple of the text size.',
      }),
      outlineWidth: new NumberField(0, {
        min: 0,
        softMax: 12,
        step: 0.1,
        showByDefault: false,
        description:
          'Width of the outline around the text, relative to text size. Only works with SDF on in Font settings.',
      }),
      outlineColor: new ColorField('#000000ff', {
        transform: hexToColor,
        showByDefault: false,
        description:
          'Color of the outline around the text. Only visible when Outline width is above 0.',
      }),
      wordBreak: new StringLiteralField('break-word', {
        values: ['break-word', 'break-all'],
        showByDefault: false,
        description:
          "Where long labels wrap: 'break-word' at spaces, 'break-all' at any character. Needs Max width.",
      }),
      maxWidth: new NumberField(-1, {
        min: -1,
        softMax: 100,
        showByDefault: false,
        description:
          'Wrap labels longer than this many times the text size. -1 turns off wrapping.',
      }),
      getAngle: new NumberField(0, {
        softMin: 0,
        softMax: 360,
        accessor: true,
        showByDefault: false,
      }),
      getTextAnchor: new StringLiteralField('middle', {
        values: ['start', 'middle', 'end'],
        accessor: true,
      }),
      getPixelOffset: new Vec2Field(
        { x: 0, y: 0 },
        { returnType: 'tuple', accessor: true, showByDefault: false }
      ),
      getAlignmentBaseline: new StringLiteralField('center', {
        values: ['top', 'center', 'bottom'],
        accessor: true,
        showByDefault: false,
      }),
      fontSettings: new CompoundPropsField(
        {
          sdf: new BooleanField(false),
          fontSize: new NumberField(64, { min: 8, softMax: 256 }),
          buffer: new NumberField(4, { min: 0, softMax: 20 }),
          radius: new NumberField(12, { min: 0, softMax: 50 }),
          cutoff: new NumberField(0.25, { min: 0, max: 1, step: 0.01 }),
          smoothing: new NumberField(0.1, { min: 0, max: 1, step: 0.01 }),
        },
        {
          description:
            'Font atlas options: SDF rendering (needed for outlines), atlas font size, buffer, radius, cutoff, smoothing.',
        }
      ),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
          cullMode: new StringLiteralField('none', {
            values: ['none', 'back', 'front'],
          }),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
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
  private _iconCache = new Map<
    string,
    {
      data: { url: string; width: number; height: number; id: string }
      accessor: () => { url: string; width: number; height: number; id: string }
    }
  >()
  private readonly MAX_CACHE_SIZE = 50
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      iconAtlas: new FileUrlField(
        'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png',
        { showByDefault: false, accept: '.png,.jpg,.jpeg,.gif,.webp,.svg' }
      ),
      // MapStyleField accepts either a URL string or a parsed JSON object and retains file upload UI.
      iconMapping: new MapStyleField(
        'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.json',
        { showByDefault: false, accept: '.json' }
      ),
      billboard: new BooleanField(true),
      getIcon: new FileUrlField('', {
        accessor: true,
        optional: true,
        accept: '.png,.jpg,.jpeg,.gif,.webp,.svg',
      }), // Can be: uploaded file URL, external URL, or accessor function returning {url, width?, height?}
      getSize: new NumberField(1, { min: 0, softMax: 100, accessor: true }),
      sizeUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      sizeScale: new NumberField(1, { min: 0, softMax: 10_000 }),
      sizeMinPixels: new NumberField(0, { min: 0, softMax: 10_000, showByDefault: false }),
      sizeMaxPixels: new NumberField(2048, { min: 0, softMax: 10_000, showByDefault: false }),
      getPixelOffset: new Vec2Field(
        { x: 0, y: 0 },
        { returnType: 'tuple', accessor: true, showByDefault: false }
      ),
      getColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getAngle: new NumberField(0, { accessor: true }),
      sizeBasis: new StringLiteralField('height', {
        values: ['height', 'width'],
        showByDefault: false,
        optional: true,
        description:
          "Whether Size sets each icon's height or its width. The other side keeps the icon's aspect ratio.",
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
      layer: new LayerField<IconLayerProps>(),
    }
  }
  async execute(
    _props: ExtractProps<typeof this.inputs>
  ): Promise<ExtractProps<typeof this.outputs>> {
    const { getIcon, iconMapping, iconAtlas, sizeMaxPixels, ...rest } = _props

    // Helper to resolve @/ URLs to blob URLs with proper MIME type
    const resolveProjectUrl = async (url: string): Promise<string> => {
      if (!url?.startsWith(projectScheme)) {
        return url
      }

      const { readAssetBinary } = await import('./storage')
      const { useFileSystemStore } = await import('./filesystem-store')

      const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
      if (!currentProjectName) {
        throw new Error('No project loaded. Please save or load a project first.')
      }

      const fileName = url.substring(projectScheme.length)
      const result = await readAssetBinary(activeStorageType, currentProjectName, fileName)
      if (!result.success) {
        throw new Error(result.error.message)
      }

      // Infer MIME type from file extension for loaders.gl
      const ext = fileName.toLowerCase().split('.').pop()
      const mimeTypes: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
      }
      const mimeType = mimeTypes[ext || ''] || 'application/octet-stream'

      const blob = new Blob([result.data], { type: mimeType })
      return URL.createObjectURL(blob)
    }

    const resolveIconMapping = async (
      mapping: string | Record<string, unknown>
    ): Promise<string | Record<string, unknown>> => {
      if (typeof mapping !== 'string' || !mapping.startsWith(projectScheme)) {
        return mapping
      }

      const { readAsset } = await import('./storage')
      const { useFileSystemStore } = await import('./filesystem-store')

      const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
      if (!currentProjectName) {
        throw new Error('No project loaded. Please save or load a project first.')
      }

      const fileName = mapping.substring(projectScheme.length)
      const result = await readAsset(activeStorageType, currentProjectName, fileName)
      if (!result.success) {
        throw new Error(result.error.message)
      }

      try {
        const parsed = JSON.parse(result.data)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('icon mapping must be a JSON object')
        }
        return parsed as Record<string, unknown>
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Unable to parse icon mapping "${mapping}": ${message}`)
      }
    }

    // Helper to resolve image URL and extract dimensions
    const resolveImageWithDimensions = async (
      url: string,
      maxDisplaySize: number
    ): Promise<{ url: string; width: number; height: number; id: string }> => {
      const resolvedUrl = await resolveProjectUrl(url)

      // Load image to get natural dimensions
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const naturalWidth = img.naturalWidth
          const naturalHeight = img.naturalHeight

          // Calculate max texture dimension based on display size
          // Use 2x for quality buffer (like Retina), cap at 512 to avoid
          // Deck.gl icon atlas packing issues with large dimensions
          const maxDimension = Math.min(maxDisplaySize * 2, 512)
          const aspectRatio = naturalWidth / naturalHeight
          let width = naturalWidth
          let height = naturalHeight

          // Normalize to max dimension while preserving aspect ratio
          // This prevents deck.gl auto-packing issues with very large images
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              width = maxDimension
              height = Math.round(maxDimension / aspectRatio)
            } else {
              height = maxDimension
              width = Math.round(maxDimension * aspectRatio)
            }
          }

          const iconData = {
            url: resolvedUrl,
            width,
            height,
            id: url, // Use original URL as unique ID for deduplication
          }
          resolve(iconData)
        }
        img.onerror = () => {
          reject(new Error(`Failed to load image from ${url}`))
        }
        img.src = resolvedUrl
      })
    }

    // Determine icon mode and resolve URLs as needed
    let iconProps: Partial<IconLayerProps>

    if (typeof getIcon === 'function') {
      // Accessor function mode - pass through
      iconProps = { getIcon }
    } else if (getIcon && typeof getIcon === 'string') {
      // Single-icon mode - cache resolved icon data AND accessor function
      // to avoid re-resolving and creating new accessor references every frame
      // (new accessor references trigger deck.gl updateTriggers and cause texture re-upload)
      const cacheKey = `${getIcon}:${sizeMaxPixels}`
      let cached = this._iconCache.get(cacheKey)

      if (!cached) {
        const iconData = await resolveImageWithDimensions(getIcon, sizeMaxPixels)
        const accessor = () => iconData
        cached = { data: iconData, accessor }

        // Simple LRU: if cache is full, delete oldest entry (first in Map)
        if (this._iconCache.size >= this.MAX_CACHE_SIZE) {
          const firstKey = this._iconCache.keys().next().value
          this._iconCache.delete(firstKey)
        }

        this._iconCache.set(cacheKey, cached)
      } else {
        // Move to end for LRU (delete + re-add)
        this._iconCache.delete(cacheKey)
        this._iconCache.set(cacheKey, cached)
      }

      iconProps = { getIcon: cached.accessor }
    } else {
      // Atlas mode - resolve uploaded project assets and accept parsed JSON from connected inputs
      const resolvedIconAtlas = await resolveProjectUrl(iconAtlas)
      const resolvedIconMapping = await resolveIconMapping(iconMapping)
      iconProps = {
        iconMapping: resolvedIconMapping as IconLayerProps['iconMapping'],
        iconAtlas: resolvedIconAtlas,
      }
    }

    const props: IconLayerProps = {
      ...rest,
      ...iconProps,
      sizeMaxPixels,
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      scenegraph: new FileUrlField(
        'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/scenegraph-layer/airplane.glb',
        {
          accept: '.glb,.gltf',
          label: 'Model',
          description: 'URL of the glTF or GLB 3D model drawn at each position.',
        }
      ),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getOrientation: new Vec3Field([0, 0, 0], {
        returnType: 'tuple',
        accessor: true,
        description: 'Rotation of each model as [pitch, yaw, roll], in degrees.',
      }),
      getScale: new Vec3Field([1, 1, 1], {
        returnType: 'tuple',
        accessor: true,
        description: "Scale of each model along each axis as [x, y, z]. 1 is the model's own size.",
      }),
      sizeScale: new NumberField(1, { min: 0, softMax: 10_000, showByDefault: false }),
      sizeMinPixels: new NumberField(0, { min: 0, softMax: 100, showByDefault: false }),
      sizeMaxPixels: new NumberField(100, { min: 0, softMax: 100, showByDefault: false }),
      getColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getTranslation: new Vec3Field([0, 0, 0], {
        returnType: 'tuple',
        accessor: true,
        showByDefault: false,
        description:
          'Offset of each model from its position as [x, y, z] (east, north, up), in meters.',
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      mesh: new StringField(
        'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/humanoid_quad.obj',
        {
          description:
            'URL of the OBJ or PLY mesh drawn at each position. Files not ending in .obj load as PLY.',
        }
      ),
      wireframe: new BooleanField(false, { showByDefault: false }),
      texture: new UnknownField(null, { optional: true, showByDefault: false }),
      textureParameters: new DataField(undefined, {
        showByDefault: false,
        description:
          "Sampler settings for the texture, e.g. { minFilter: 'linear', magFilter: 'nearest' }.",
      }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getOrientation: new Vec3Field([0, 0, 0], {
        returnType: 'tuple',
        accessor: true,
        description: 'Rotation of each mesh as [pitch, yaw, roll], in degrees.',
      }),
      getScale: new Vec3Field([1, 1, 1], {
        returnType: 'tuple',
        accessor: true,
        description: "Scale of each mesh along each axis as [x, y, z]. 1 is the mesh's own size.",
      }),
      sizeScale: new NumberField(1, { min: 0, softMax: 1000, showByDefault: false }),
      getTranslation: new Vec3Field([0, 0, 0], {
        returnType: 'tuple',
        accessor: true,
        showByDefault: false,
        description:
          'Offset of each mesh from its position as [x, y, z] (east, north, up), in meters.',
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
      layer: new LayerField<SimpleMeshLayerProps>(),
    }
  }
  async execute(props: ExtractProps<typeof this.inputs>) {
    const ext = extname(props.mesh || '')
    const [{ OBJLoader }, { PLYLoader }] = await Promise.all([
      import('@loaders.gl/obj'),
      import('@loaders.gl/ply'),
    ])
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getHexagon: new StringField('', {
        accessor: true,
        label: 'H3 cell',
        description: 'H3 cell ID (hex string) for each row; that hexagon is drawn on the map.',
      }),
      getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getRadius: new NumberField(1, { min: 0, accessor: true }),
      getLineWidth: new NumberField(1, { min: 0, accessor: true }),
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPentagon: new UnknownField((d: unknown) => d?.pentagon || '', {
        accessor: true,
        label: 'A5 cell',
        description:
          "A5 cell ID for each row (hex string or bigint). Reads the row's pentagon by default.",
      }),
      getFillColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getElevation: new NumberField(1000, { min: 0, softMax: 100000, accessor: true }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      extruded: new BooleanField(false),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),
      pickable: new BooleanField(true, { showByDefault: false }),
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point2DField([0, 0], { returnType: 'tuple', accessor: true }),
      getWeight: new NumberField(1, { min: 0, accessor: true }),
      aggregation: new StringLiteralField('SUM', { values: ['SUM', 'MEAN'] }),
      radiusPixels: new NumberField(30, { min: 0, softMax: 10_000 }),
      intensity: new NumberField(1, { min: 0, max: 1, showByDefault: false }),
      threshold: new NumberField(0.05, { min: 0, max: 1, step: 0.01, showByDefault: false }),
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
  createInputs() {
    return {
      // Core fields (visible by default)
      data: new GeoJsonField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),

      // Point styling (hidden by default)
      pointType: new StringLiteralField('circle', {
        values: ['circle', 'icon', 'text', 'circle+text', 'icon+text', 'circle+icon'],
        showByDefault: false,
        description: 'How point features are drawn: circles, icons, text labels, or a combination.',
      }),
      getPointRadius: new NumberField(1, {
        min: 0,
        softMax: 100000,
        accessor: true,
        showByDefault: false,
      }),
      // pointType: circle
      pointRadiusUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      pointRadiusScale: new NumberField(1, {
        min: 0,
        softMax: 100,
        showByDefault: false,
        description: 'Multiplier applied to every point radius.',
      }),
      pointRadiusMinPixels: new NumberField(0, {
        min: 0,
        softMax: 100,
        showByDefault: false,
        description: 'Smallest a point can draw on screen, in pixels, at any zoom.',
      }),
      pointRadiusMaxPixels: new NumberField(100, {
        min: 0,
        softMax: 1000,
        showByDefault: false,
        description: 'Largest a point can draw on screen, in pixels, at any zoom.',
      }),
      pointRadiusBillboard: new BooleanField(false, {
        showByDefault: false,
        description:
          'When on, point circles always face the camera instead of lying flat on the ground.',
      }),

      // pointType: icon

      // pointType: text (hidden by default)
      getText: new StringField('', { accessor: true, showByDefault: false }),
      getTextSize: new NumberField(32, {
        min: 0,
        softMax: 200,
        accessor: true,
        showByDefault: false,
        description: 'Label size for each point, in Text size units (pixels by default).',
      }),
      getTextColor: new ColorField('#000000', {
        accessor: true,
        transform: hexToColor,
        showByDefault: false,
        description: 'Label color for each point, used when Point type includes text.',
      }),
      getTextAngle: new NumberField(0, {
        softMin: 0,
        softMax: 360,
        accessor: true,
        showByDefault: false,
        description: 'Label rotation for each point, in degrees counterclockwise.',
      }),
      getTextAnchor: new StringLiteralField('middle', {
        values: ['start', 'middle', 'end'],
        accessor: true,
        showByDefault: false,
      }),
      getTextAlignmentBaseline: new StringLiteralField('center', {
        values: ['top', 'center', 'bottom'],
        accessor: true,
        showByDefault: false,
        description:
          'Vertical placement of each label relative to its point: top, center, or bottom.',
      }),
      getTextPixelOffset: new Vec2Field(
        { x: 0, y: 0 },
        {
          returnType: 'tuple',
          accessor: true,
          showByDefault: false,
          description: 'Shifts each label by [x, y] screen pixels; x goes right, y goes down.',
        }
      ),
      textSizeUnits: new StringLiteralField('pixels', {
        values: ['pixels', 'meters'],
        showByDefault: false,
        description: 'Units for Text size: pixels stay fixed on screen, meters scale with zoom.',
      }),
      textSizeScale: new NumberField(1, {
        min: 0,
        softMax: 100,
        showByDefault: false,
        description: 'Multiplier applied to every label size, after Text size units.',
      }),
      textSizeMinPixels: new NumberField(0, {
        min: 0,
        softMax: 100,
        showByDefault: false,
        description: 'Smallest a label can draw on screen, in pixels.',
      }),
      textSizeMaxPixels: new NumberField(100, {
        min: 0,
        showByDefault: false,
        description: 'Largest a label can draw on screen, in pixels.',
      }),
      textBillboard: new BooleanField(true, {
        showByDefault: false,
        description: 'When on, labels always face the camera. When off, they lie flat on the map.',
      }),
      textFontFamily: new StringField('Monaco, monospace', {
        showByDefault: false,
        description: "CSS font family for labels, e.g. 'Monaco, monospace'.",
      }),
      textFontWeight: new NumberField(400, {
        min: 100,
        max: 900,
        step: 100,
        showByDefault: false,
        description: 'Label font weight, 100 (thin) to 900 (heavy). 400 is normal.',
      }),

      // polygon (core fields visible by default)
      filled: new BooleanField(true),
      getFillColor: new ColorField('#006ac6', { accessor: true, transform: hexToColor }),

      // line (core fields visible by default)
      stroked: new BooleanField(true),
      getLineColor: new ColorField('#000000', { accessor: true, transform: hexToColor }),
      getLineWidth: new NumberField(1, { min: 0, softMax: 100, accessor: true }),
      // line (advanced fields hidden by default)
      lineWidthUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters'],
        showByDefault: false,
      }),
      lineWidthScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      lineWidthMinPixels: new NumberField(0, { min: 0, softMax: 100, showByDefault: false }),
      lineWidthMaxPixels: new NumberField(100, { min: 0, softMax: 1000, showByDefault: false }),
      lineCapRounded: new BooleanField(false, {
        showByDefault: false,
        description: 'Draws rounded ends on lines instead of square ones.',
      }),
      lineJointRounded: new BooleanField(false, { showByDefault: false }),
      lineMiterLimit: new NumberField(4, {
        min: 0,
        softMax: 10,
        showByDefault: false,
        description:
          'How far sharp line corners can extend, in multiples of line width. Ignored when Line joint rounded is on.',
      }),
      lineBillboard: new BooleanField(false, {
        showByDefault: false,
        description:
          'When on, line width always faces the camera. When off, lines lie flat on the ground.',
      }),
      lineAntialiasing: new BooleanField(false, { showByDefault: false }),

      // 3d (hidden by default)
      extruded: new BooleanField(false, { showByDefault: false }),
      wireframe: new BooleanField(false, { showByDefault: false }),
      getElevation: new NumberField(1000, {
        min: 0,
        softMax: 100000,
        accessor: true,
        showByDefault: false,
      }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      _full3d: new BooleanField(false, {
        showByDefault: false,
        description:
          'Fills polygons with varying heights (e.g. walls) on their own plane, not flat. Experimental.',
      }),
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
          cullMode: new StringLiteralField('none', {
            values: ['none', 'back', 'front'],
          }),
        },
        { showByDefault: false }
      ),
      extensions: new ListField(new ExtensionField(), { showByDefault: false }),
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getSourcePosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getTargetPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      getSourceColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      getTargetColor: new ColorField('#fff', { accessor: true, transform: hexToColor }),
      widthUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters', 'common'],
        showByDefault: false,
      }),
      antialiasing: new BooleanField(false, { showByDefault: false }),
      getWidth: new NumberField(1, { min: 0, softMax: 100, accessor: true }),
      getHeight: new NumberField(1, { min: 0, softMax: 10, accessor: true, showByDefault: false }),
      getTilt: new NumberField(0, { min: -90, max: 90, accessor: true, showByDefault: false }),
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      cellSize: new NumberField(1000, { min: 1, softMax: 100000 }),

      getColorWeight: new NumberField(1, {
        min: 0,
        accessor: true,
        description: "Value each row adds to its cell's color. Combined using Color aggregation.",
      }),
      colorAggregation: new StringLiteralField('SUM', {
        values: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'],
        description:
          'How row weights in a cell combine into its color value. COUNT ignores the weight.',
      }),
      // TODO: Support the second agg option, getColorValue?
      colorScaleType: new StringLiteralField('quantize', {
        values: ['linear', 'quantize', 'quantile', 'ordinal'],
        showByDefault: false,
        description:
          'How cell values map onto Color range. Quantize splits evenly, quantile by equal counts.',
      }),
      colorRange: new UnknownField(DEFAULT_COLOR_RANGE, { optional: true }),
      // TODO: Support default color range
      // colorRange: new ArrayField(new ColorField('#fff', { transform: hexToColor }), {
      //   optional: true,
      // }),
      colorDomain: new UnknownField(null, { optional: true, showByDefault: false }), // number[2] | null for auto
      upperPercentile: new NumberField(100, { min: 0, max: 100, step: 0.1, showByDefault: false }),
      lowerPercentile: new NumberField(0, { min: 0, max: 100, step: 0.1, showByDefault: false }),

      extruded: new BooleanField(true),
      getElevationWeight: new NumberField(1, {
        min: 0,
        accessor: true,
        description:
          "Value each row adds to its cell's height. Combined using Elevation aggregation.",
      }),
      elevationAggregation: new StringLiteralField('SUM', {
        values: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'],
        description:
          'How row weights in a cell combine into its height value. COUNT ignores the weight.',
      }),
      // TODO: Support the second agg option, getElevationValue?
      elevationScaleType: new StringLiteralField('linear', {
        values: ['linear', 'quantile'],
        showByDefault: false,
        description:
          'How cell values map onto Elevation range: linear, or quantile (equal counts).',
      }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      elevationRange: new Vec2Field([0, 1000], {
        returnType: 'tuple',
        showByDefault: false,
        description: '[min, max] cell height in meters, before Elevation scale is applied.',
      }),
      elevationDomain: new UnknownField(null, {
        optional: true,
        showByDefault: false,
        description:
          '[min, max] cell values mapped to Elevation range. Empty uses 0 to the largest value.',
      }), // number[2] | null for auto
      elevationUpperPercentile: new NumberField(100, {
        min: 0,
        max: 100,
        step: 0.1,
        showByDefault: false,
        description: 'Hides cells whose height value is above this percentile, 0 to 100.',
      }),
      elevationLowerPercentile: new NumberField(0, {
        min: 0,
        max: 100,
        step: 0.1,
        showByDefault: false,
        description: 'Hides cells whose height value is below this percentile, 0 to 100.',
      }),

      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      gpuAggregation: new BooleanField(true, { showByDefault: false }),
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
  createInputs() {
    return {
      data: new DataField(),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      getPosition: new Point3DField([0, 0, 0], { returnType: 'tuple', accessor: true }),
      radius: new NumberField(1000, {
        min: 1,
        softMax: 100000,
        description: 'Radius of each hexagon bin, in meters. Hexagons are pointy-topped.',
      }),

      getColorWeight: new NumberField(1, {
        min: 0,
        accessor: true,
        description:
          "Value each row adds to its hexagon's color. Combined using Color aggregation.",
      }),
      colorAggregation: new StringLiteralField('SUM', {
        values: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'],
        description:
          'How row weights in a hexagon combine into its color value. COUNT ignores the weight.',
      }),
      // TODO: Support the second agg option, getColorValue?
      colorScaleType: new StringLiteralField('quantize', {
        values: ['linear', 'quantize', 'quantile', 'ordinal'],
        showByDefault: false,
        description:
          'How hexagon values map onto Color range. Quantize splits evenly, quantile by equal counts.',
      }),
      colorRange: new UnknownField(DEFAULT_COLOR_RANGE, { optional: true }),
      // TODO: Support default color range
      // colorRange: new ArrayField(new ColorField('#fff', { transform: hexToColor }), {
      //   optional: true,
      // }),
      colorDomain: new UnknownField(null, { optional: true, showByDefault: false }), // number[2] | null for auto
      upperPercentile: new NumberField(100, { min: 0, max: 100, step: 0.1, showByDefault: false }),
      lowerPercentile: new NumberField(0, { min: 0, max: 100, step: 0.1, showByDefault: false }),

      extruded: new BooleanField(false),
      getElevationWeight: new NumberField(1, {
        min: 0,
        accessor: true,
        description:
          "Value each row adds to its hexagon's height. Combined using Elevation aggregation.",
      }),
      elevationAggregation: new StringLiteralField('SUM', {
        values: ['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'],
        description:
          'How row weights in a hexagon combine into its height value. COUNT ignores the weight.',
      }),
      // TODO: Support the second agg option, getElevationValue?
      elevationScaleType: new StringLiteralField('linear', {
        values: ['linear', 'quantile'],
        showByDefault: false,
        description:
          'How hexagon values map onto Elevation range: linear, or quantile (equal counts).',
      }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      elevationRange: new Vec2Field([0, 1000], {
        returnType: 'tuple',
        showByDefault: false,
        description:
          '[min, max] hexagon height in meters, before Elevation scale. Needs Extruded on.',
      }),
      elevationDomain: new UnknownField(null, {
        optional: true,
        showByDefault: false,
        description:
          '[min, max] hexagon values mapped to Elevation range. Empty uses 0 to the largest value.',
      }), // number[2] | null for auto
      elevationUpperPercentile: new NumberField(100, {
        min: 0,
        max: 100,
        step: 0.1,
        showByDefault: false,
        description: 'Hides hexagons whose height value is above this percentile, 0 to 100.',
      }),
      elevationLowerPercentile: new NumberField(0, {
        min: 0,
        max: 100,
        step: 0.1,
        showByDefault: false,
        description: 'Hides hexagons whose height value is below this percentile, 0 to 100.',
      }),

      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      gpuAggregation: new BooleanField(true, { showByDefault: false }),
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
  static description = 'Render 3D tiles on the map (Google, Cesium, or a custom tileset URL)'
  createInputs() {
    return {
      visible: new BooleanField(true),
      provider: new StringLiteralField('Google', {
        values: ['Cesium', 'Generic', 'Google'],
        description:
          'Tile source. Google and Cesium need an API key in Settings. Generic loads any 3D Tiles URL.',
      }),
      tilesetUrl: new StringField('', {
        showByDefault: false,
        description:
          'URL of a tileset.json to load. Required for Generic; Google and Cesium use their own tilesets when empty.',
      }),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      operation: new StringLiteralField('terrain+draw', {
        values: ['terrain+draw', 'draw', 'terrain'],
        description:
          "'draw' shows the tiles, 'terrain' makes them a surface for the Terrain extension, or both.",
      }),
      wireframe: new BooleanField(false),
      flatLighting: new BooleanField(true, {
        showByDefault: false,
        description: 'Draw tile meshes without shading, so photo textures look as captured.',
      }),
      throttleRequests: new BooleanField(false, {
        showByDefault: false,
        description:
          'Limit how many tile requests run at once. Loads more slowly but uses less bandwidth.',
      }),
      pointSize: new NumberField(1, { min: 0, softMax: 100 }), // Only applies when tile format is 'pnts'
      maxLodMetricValue: new NumberField(2, { min: 0, softMax: 10, showByDefault: false }),
      maxScreenSpaceError: new NumberField(50, {
        min: 0,
        softMax: 1_000,
        showByDefault: false,
        description:
          'How blurry tiles may look before finer ones load. Higher values load fewer, coarser tiles.',
      }),
      maxMemoryUsage: new NumberField(2024, {
        min: 0,
        softMax: 10_000,
        showByDefault: false,
        description:
          'Memory budget for loaded tiles, in megabytes. Older tiles are dropped past this limit.',
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
      layer: new LayerField<Tile3DLayerProps>(),
    }
  }
  async execute({
    flatLighting,
    provider,
    tilesetUrl,
    throttleRequests,
    maxMemoryUsage,
    maxScreenSpaceError,
    ...props
  }: ExtractProps<typeof this.inputs>) {
    const GOOGLE_TILESET_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json'
    const NYC_CESIUM_TILESET_URL = 'https://assets.ion.cesium.com/242005/tileset.json'

    const { getKey } = getKeysStore()
    const GOOGLE_MAPS_API_KEY = getKey('googleMaps')
    const CESIUM_ACCESS_TOKEN = getKey('cesium')

    if (provider === 'Google' && !GOOGLE_MAPS_API_KEY) {
      throw new Error('Tile3DLayer: Google Maps API key is not set (add it in Settings > API Keys)')
    }
    if (provider === 'Cesium' && !CESIUM_ACCESS_TOKEN) {
      throw new Error(
        'Tile3DLayer: Cesium Ion access token is not set (add it in Settings > API Keys)'
      )
    }

    // Generic sends no credentials, so falling back to the Google tileset would fail
    if (provider === 'Generic' && !tilesetUrl) {
      throw new Error('Tile3DLayer: set Tileset URL to use the Generic provider')
    }

    const defaultUrl = provider === 'Cesium' ? NYC_CESIUM_TILESET_URL : GOOGLE_TILESET_URL
    const data = tilesetUrl || defaultUrl

    const { CesiumIonLoader, Tiles3DLoader } = await import('@loaders.gl/3d-tiles')
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
      data,
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
  static description =
    'Show only a sphere around a lng/lat/alt (meters) of a Tile3DLayer, fading to white at the edge'
  createInputs() {
    return {
      // Downtown Los Angeles
      targetPosition: new Point3DField([-118.2637, 34.0171, 0], {
        returnType: 'tuple',
        description: 'Center of the visible sphere, as [lng, lat, altitude in meters].',
      }),
      innerRadius: new NumberField(1000, {
        min: 0,
        softMax: 10_000,
        description: 'Radius in meters around Target position that is shown at full color.',
      }),
      fadeRange: new NumberField(7, {
        min: 0,
        softMax: 10_000,
        description:
          'Distance in meters past Inner radius over which tiles fade to white before being cut off.',
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "3D mask extension to add to a Tile3DLayer's Extensions list.",
      }),
    }
  }
  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const [lng, lat, alt = 0] = props.targetPosition as number[]
    const extension = {
      extension: { type: 'Mask3DExtension' },
      props: { ...props, targetPosition: toMaskTargetPosition(lng, lat, alt) },
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
      brushingRadius: new NumberField(100, {
        min: 0,
        softMax: 100_000,
        description: 'Radius around the mouse, in meters, inside which objects are drawn.',
      }),
      brushingEnabled: new BooleanField(true, {
        description: 'When off, all objects are drawn regardless of the mouse position.',
      }),
      brushingTarget: new StringLiteralField('source', {
        values: ['source', 'target', 'source_target', 'custom'],
        description:
          'Which position is tested against the mouse: source, target, either, or Brushing target.',
      }),
      getBrushingTarget: new Point2DField([0, 0], {
        returnType: 'tuple',
        accessor: true,
        description:
          "Per-item [lng, lat] tested against the mouse. Only used when Brushing target is 'custom'.",
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Brushing extension to add to a layer's Extensions list.",
      }),
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
      dash: new BooleanField(true, {
        description: 'Turns on dashed lines, drawn with Dash array.',
      }),
      highPrecisionDash: new BooleanField(false, {
        showByDefault: false,
        description: "When on, forces Dash mode to 'path' for smoother dashes, at some speed cost.",
      }),
      offset: new BooleanField(false, {
        description: 'Turns on shifting lines sideways by Offset.',
      }),
      dashMode: new StringLiteralField('segment', {
        values: ['segment', 'path'],
        description:
          "'segment' restarts dashes at each segment; 'path' keeps them continuous. Needs Dash on.",
      }),
      dashJustified: new BooleanField(false, {
        description: 'When on, adjusts gaps so dashes line up with both ends of each path.',
      }),
      dashUnits: new StringLiteralField('widths', {
        values: ['widths', 'pixels', 'meters', 'common'],
        description:
          "Units for Dash array. 'widths' is relative to half the line width, so dashes scale with it.",
      }),
      getDashArray: new Vec2Field([4, 4], {
        returnType: 'tuple',
        accessor: true,
        description: 'Per-item [dash length, gap length], in Dash units.',
      }),
      getOffset: new NumberField(0, {
        softMin: -10_000,
        softMax: 10_000,
        accessor: true,
        description:
          'Per-item sideways shift in line widths. Negative moves left, positive moves right.',
      }),
      dashGapPickable: new BooleanField(false, {
        description:
          'When on, the gaps between dashes respond to hover and click, not just the dashes.',
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Path style extension to add to a layer's Extensions list.",
      }),
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
        // deck.gl turns dashes on whenever dashMode is set, so only pass it with dash on
        ...(dash ? { dashMode: highPrecisionDash ? 'path' : dashMode } : {}),
        offset,
      },
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
      terrainDrawMode: new StringLiteralField('offset', {
        values: ['offset', 'drape'],
        description:
          "'offset' lifts each object to the terrain height; 'drape' lays it over the terrain surface.",
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Terrain extension to add to a layer's Extensions list.",
      }),
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
      parameters: new CompoundPropsField(
        {
          depthTest: new BooleanField(true),
        },
        { showByDefault: false }
      ),
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
      brightness: new NumberField(0, {
        min: -1,
        max: 1,
        step: 0.01,
        description:
          "Shifts the layer's brightness, -1 (black) to 1 (white). 0 leaves it unchanged.",
      }),
      contrast: new NumberField(0, {
        min: -1,
        max: 1,
        step: 0.01,
        description:
          "Changes the layer's contrast, -1 (flat gray) to 1 (maximum). 0 leaves it unchanged.",
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Brightness and contrast extension to add to a layer's Extensions list.",
      }),
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
      hue: new NumberField(0, {
        min: -1,
        max: 1,
        step: 0.01,
        description:
          "Rotates the layer's colors around the color wheel, -1 to 1 (a half turn each way).",
      }),
      saturation: new NumberField(0, {
        min: -1,
        max: 1,
        step: 0.01,
        description:
          'Changes color intensity, -1 (grayscale) to 1 (most saturated). 0 is unchanged.',
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Hue and saturation extension to add to a layer's Extensions list.",
      }),
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
      amount: new NumberField(0, {
        min: -1,
        max: 1,
        step: 0.01,
        description: 'Boosts (above 0) or mutes (below 0) the duller colors in the layer, -1 to 1.',
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Vibrance extension to add to a layer's Extensions list.",
      }),
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
function safeOpGetter(contextOpId: string): (path: string) => Operator<IOperator> {
  return (path: string) => {
    const op = getOp(path, contextOpId)
    if (!op) {
      throw new Error(`Operator '${path}' not found`)
    }
    return op
  }
}

// An Accessor is an ExpressionOp that returns a function instead of executing it
export class AccessorOp extends Operator<AccessorOp> {
  static displayName = 'Accessor'
  static description =
    'A function called for each row of your data and passed to Deck.gl layer properties. The current row is passed as the `d` variable (e.g., `d.population`, `d.properties.color`). Available variables: `d` (current row), `i` (index), `data` (all rows), `op()` (access operators), `sequenceTime` (timeline position), `frame` (current frame), `totalFrames`, `sequence` (timeline metadata). Includes d3, turf, and other utilities.'
  createInputs() {
    return {
      expression: new ExpressionField(undefined, {
        description: 'Single JavaScript expression run per row, using d (row), i (index) and data.',
      }),
    }
  }
  createOutputs() {
    return {
      accessor: new FunctionField(undefined, {
        description: 'Per-row function to connect to a layer input such as Position or Fill color.',
      }),
    }
  }
  execute({ expression }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const fn = fnWithSource(
      [
        'd',
        'i',
        'data',
        'op',
        'sequenceTime',
        'frame',
        'totalFrames',
        'sequence',
        ...Object.keys(freeExports),
      ],
      `return ${expression}`,
      this.id
    )

    // Subscribe to timeline changes - accessor will get fresh values on each call
    subscribeOpToTimeline(this)

    // https://deck.gl/docs/developer-guide/using-layers#accessors
    const accessor = (d: unknown, dInfo: { index: number; data: unknown; target: number[] }) => {
      const contextualGetOp = safeOpGetter(this.id)
      // Get fresh timeline values for each accessor call
      const timelineContext = getTimelineContext()
      try {
        return fn(
          d,
          dInfo.index,
          dInfo.data,
          contextualGetOp,
          timelineContext.sequenceTime,
          timelineContext.frame,
          timelineContext.totalFrames,
          timelineContext.sequence,
          ...Object.values(freeExports)
        )
      } catch (_e) {
        // Swallow per-row errors — returning undefined lets deck.gl skip the item
        // rather than crashing the GPU process
        return undefined
      }
    }

    return { accessor }
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
      data: new ListField(new DataField(), {
        description:
          'Values from connected nodes, available in code as the data array; d is the first.',
      }),
      code: new CodeField('', {
        language: 'javascript',
        description:
          'JavaScript function body that must return a value. Can use op(), await, d3 and turf.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, { description: 'The value returned by the code.' }),
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

export class ContainerOp extends Operator<ContainerOp> {
  static displayName = 'Container'
  static description = 'Encapsulates a subgraph of operators. Visually groups child nodes.'
  static supportsCustomFields = true

  private graphOutputOp?: GraphOutputOp

  createInputs() {
    return {
      in: new UnknownField(null, {
        optional: true,
        description: 'Value passed to the GraphInput node inside this container.',
      }),
    }
  }

  createOutputs() {
    return {
      out: new UnknownField(null, {
        optional: true,
        description: 'Value from the GraphOutput node inside this container.',
      }),
    }
  }

  setGraphOutputOp(output?: GraphOutputOp) {
    if (this.graphOutputOp === output) return

    if (this.graphOutputOp) {
      this.graphOutputOp.removeDownstreamDependent(this)
      this.removeUpstreamDependency(this.graphOutputOp)
    }

    this.graphOutputOp = output
    if (output) {
      output.addDownstreamDependent(this)
      this.addUpstreamDependency(output)
    }
    this.markDirty()
  }

  // The GraphOutputOp whose value this container's out port carries: the one transformGraph
  // selected, else the first direct child in the store
  get outputOp(): GraphOutputOp | undefined {
    return (
      this.graphOutputOp ??
      getAllOps().find(
        (op): op is GraphOutputOp => op instanceof GraphOutputOp && isDirectChild(op.id, this.id)
      )
    )
  }

  execute(_: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // The 'in' port of ContainerOp drives its execution.
    // The 'out' port should reflect the value from a GraphOutputOp inside it.
    return { out: this.outputOp?.outputs.propagatedValue.value ?? null }
  }

  dispose() {
    this.setGraphOutputOp(undefined)
    super.dispose()
  }
}

export class ExpressionOp extends Operator<ExpressionOp> {
  static displayName = 'Expression'
  static description =
    'Evaluate a JavaScript expression to compute a single value. Available variables: `data` (all input data), `d` (first element), `op()` (access other operators), `sequenceTime` (timeline position), `frame` (current frame), `totalFrames`, `sequence` (timeline metadata). Includes d3, turf, and other utilities.'
  createInputs() {
    return {
      data: new ListField(new DataField(), {
        description: 'Values from connected nodes, available as the data array; d is the first.',
      }),
      expression: new ExpressionField(undefined, {
        description: 'Single JavaScript expression to evaluate, such as d * 2. Can use op().',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'The result. A per-row function when any input is an accessor.',
      }),
    }
  }
  execute({
    data,
    expression,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Get current timeline values
    const timelineContext = getTimelineContext()

    // Subscribe to timeline changes for reactive updates
    subscribeOpToTimeline(this)

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
      `return ${expression}`,
      this.id
    )
    // Create a context-aware getOp function for the expression execution
    const contextualGetOp = safeOpGetter(this.id)

    // Check if any data items are accessor functions
    const hasAccessors = data.some(isAccessor)

    if (hasAccessors) {
      // Return an accessor function that evaluates all data items and applies the expression
      const result = (...args: unknown[]) => {
        const evaluatedData = data.map(item => (isAccessor(item) ? item(...args) : item))
        // Get fresh timeline values for each accessor call
        const freshTimeline = getTimelineContext()
        return fn(
          evaluatedData,
          evaluatedData[0],
          contextualGetOp,
          freshTimeline.sequenceTime,
          freshTimeline.frame,
          freshTimeline.totalFrames,
          freshTimeline.sequence,
          ...Object.values(freeExports)
        )
      }

      return { data: result }
    }

    // Static evaluation
    const result = fn(
      data,
      data[0],
      contextualGetOp,
      timelineContext.sequenceTime,
      timelineContext.frame,
      timelineContext.totalFrames,
      timelineContext.sequence,
      ...Object.values(freeExports)
    )

    return { data: result }
  }
}

export type RampInterpType = 'linear' | 'smooth' | 'hold'

// Tangent slopes matching D3's curveMonotoneX (Fritsch-Carlson algorithm)
// so the smooth computation result matches the visual curve exactly.
// For n=2, D3 draws a straight line, so we return the chord slope at both endpoints.
export function monotoneSlopes(stops: Array<{ pos: number; val: number }>): number[] {
  const n = stops.length
  const m = new Array<number>(n).fill(0)
  if (n < 2) return m
  if (n === 2) {
    const h = stops[1].pos - stops[0].pos
    const s = h !== 0 ? (stops[1].val - stops[0].val) / h : 0
    return [s, s]
  }

  // Interior slopes — D3 slope3 formula
  for (let i = 1; i < n - 1; i++) {
    const h0 = stops[i].pos - stops[i - 1].pos
    const h1 = stops[i + 1].pos - stops[i].pos
    const s0 = h0 !== 0 ? (stops[i].val - stops[i - 1].val) / h0 : 0
    const s1 = h1 !== 0 ? (stops[i + 1].val - stops[i].val) / h1 : 0
    const p = (s0 * h1 + s1 * h0) / (h0 + h1)
    const sign = (v: number) => (v < 0 ? -1 : v > 0 ? 1 : 0)
    m[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  }

  // Endpoint slopes — D3 slope2 formula
  const h0 = stops[1].pos - stops[0].pos
  const hN = stops[n - 1].pos - stops[n - 2].pos
  m[0] = h0 !== 0 ? ((3 * (stops[1].val - stops[0].val)) / h0 - m[1]) / 2 : m[1]
  m[n - 1] = hN !== 0 ? ((3 * (stops[n - 1].val - stops[n - 2].val)) / hN - m[n - 2]) / 2 : m[n - 2]

  return m
}

// Per-segment interpolation: uses each stop's interp type for the segment that follows it
function interpolateRamp(
  position: number,
  sortedStops: Array<{ pos: number; val: number; interp?: RampInterpType }>
): number {
  const n = sortedStops.length
  if (n === 1) return sortedStops[0].val
  if (position <= sortedStops[0].pos) return sortedStops[0].val
  if (position >= sortedStops[n - 1].pos) return sortedStops[n - 1].val

  let i = 0
  while (i < n - 2 && position >= sortedStops[i + 1].pos) i++

  const s0 = sortedStops[i]
  const s1 = sortedStops[i + 1]
  const h = s1.pos - s0.pos
  if (h === 0) return s0.val

  const interp = s0.interp ?? 'smooth'

  if (interp === 'hold') return s0.val

  const t = (position - s0.pos) / h

  if (interp === 'linear') return s0.val + t * (s1.val - s0.val)

  // smooth: cubic Hermite with PCHIP slopes
  const slopes = monotoneSlopes(sortedStops)
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * s0.val +
    (t3 - 2 * t2 + t) * h * slopes[i] +
    (-2 * t3 + 3 * t2) * s1.val +
    (t3 - t2) * h * slopes[i + 1]
  )
}

export class RampOp extends Operator<RampOp> {
  static displayName = 'Ramp'
  static description = 'Map a position (0–1) to a value using a user-defined curve'

  createInputs() {
    return {
      // softMin/softMax suggests 0-1 in the UI without hard-clamping accessor functions
      position: new NumberField(0, {
        softMin: 0,
        softMax: 1,
        step: 0.01,
        accessor: true,
        description: 'Where to read the ramp, usually 0 to 1. Accepts a per-item accessor.',
      }),
      stops: new DataField(undefined, {
        description: 'Curve points as {pos, val, interp} rows. Empty gives a smooth 0 to 1 ramp.',
      }),
    }
  }

  createOutputs() {
    return {
      value: new NumberField(undefined, {
        description: "The ramp's value at Position, held at the end values outside the stops.",
      }),
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
      center: new Point2DField([DEFAULT_LONGITUDE, DEFAULT_LATITUDE], {
        returnType: 'object',
        description: 'Center of the rectangle, as longitude and latitude.',
      }),
      altitude: new NumberField(0, {
        step: 0.1,
        description: "Value stored in the feature's altitude property. Does not raise the shape.",
      }),
      width: new NumberField(10, {
        min: 0.001,
        softMax: 10000,
        step: 0.1,
        description: 'East to west size, in kilometers.',
      }),
      height: new NumberField(10, {
        min: 0.001,
        softMax: 10000,
        step: 0.1,
        description: 'North to south size, in kilometers.',
      }),
      properties: new DataField(
        {},
        { description: 'Object of properties to attach. Overrides Altitude if it has that key.' }
      ),
    }
  }
  createOutputs() {
    return {
      feature: new GeoJsonField(undefined, {
        description: 'The rectangle as a GeoJSON Polygon feature.',
      }),
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
      coordinates: new Point2DField(undefined, {
        description: 'Location of the point, as [lng, lat].',
      }),
      properties: new DataField(
        {},
        { description: 'Object of properties to attach to the point.' }
      ),
    }
  }
  createOutputs() {
    return {
      feature: new GeoJsonField(undefined, { description: 'A GeoJSON Point feature.' }),
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
      features: new ListField(new GeoJsonField(), {
        description: 'GeoJSON features to collect, in order.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'A FeatureCollection holding the input features.',
      }),
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
        description: 'GeoJSON text: a FeatureCollection, a Feature or a bare geometry.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'The shapes as a FeatureCollection. Empty if the text is not valid JSON.',
      }),
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
      url: new FileUrlField(undefined, {
        description: 'URL or project path of the GeoParquet file to load.',
      }),
      geometryColumn: new StringField('geometry', {
        description: "Name of the column holding the geometry. Usually 'geometry'.",
      }),
      limit: new NumberField(0, {
        min: 0,
        step: 1,
        description: 'Maximum number of rows to load. 0 loads them all.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'The file as a GeoJSON FeatureCollection, other columns as properties.',
      }),
      data: new DataField(undefined, {
        description: 'Rows of the file, with the geometry as a GeoJSON string in a geojson column.',
      }),
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
      url: new FileUrlField(undefined, {
        description: 'URL or project path of the .shp file to load.',
      }),
      encoding: new StringField('utf-8', {
        description: 'Text encoding for attribute data, such as utf-8.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'The shapes as a GeoJSON FeatureCollection.',
      }),
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
      url: new FileUrlField(undefined, {
        description: 'URL of the .pmtiles archive. Empty outputs no source.',
      }),
      sourceLayer: new StringField('', {
        description: 'Name of the vector layer inside the archive. Left out when empty.',
      }),
      minZoom: new NumberField(0, {
        min: 0,
        max: 22,
        description: 'Lowest zoom level the archive has tiles for (0 to 22).',
      }),
      maxZoom: new NumberField(14, {
        min: 0,
        max: 22,
        description: 'Highest zoom level with tiles (0 to 22). The map scales up tiles past it.',
      }),
    }
  }
  createOutputs() {
    return {
      sourceConfig: new UnknownField(null, {
        description: 'MapLibre vector source config with a pmtiles:// URL, or null without a URL.',
      }),
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
      url: new StringField('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        label: 'URL template',
        description:
          'Tile URL with {z}, {x} and {y} slots, plus an optional {s} for the subdomain.',
      }),
      subdomains: new StringField('abc', {
        description: 'Letters to put in {s}, one tile URL per letter. Empty uses the URL as is.',
      }),
      tileSize: new NumberField(256, {
        min: 64,
        max: 1024,
        step: 64,
        description: 'Tile width and height, in pixels (64 to 1024).',
      }),
      minZoom: new NumberField(0, {
        min: 0,
        max: 22,
        description: 'Lowest zoom level the service has tiles for (0 to 22).',
      }),
      maxZoom: new NumberField(19, {
        min: 0,
        max: 22,
        description: 'Highest zoom level the service has tiles for (0 to 22).',
      }),
      attribution: new StringField('', {
        description: 'Credit text for the tile provider, added to the source. Left out when empty.',
      }),
    }
  }
  createOutputs() {
    return {
      sourceConfig: new UnknownField(null, {
        description:
          'MapLibre raster source config with one tile URL per subdomain, or null without a URL.',
      }),
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection to draw buffer zones around.',
      }),
      radius: new NumberField(1, { min: 0, step: 0.1, description: 'Buffer distance, in Units.' }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
        description: 'Unit for Radius.',
      }),
      steps: new NumberField(64, {
        min: 4,
        max: 256,
        step: 1,
        showByDefault: false,
        description: 'Segments used to draw rounded edges, 4 to 256. Higher is smoother.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'Buffered polygons, one per input feature.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection of polygons to merge. Other geometry is ignored.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'A single merged polygon feature.',
      }),
    }
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
      a: new GeoJsonField(undefined, {
        description: 'Polygon to cut from. Only its first feature is used.',
      }),
      b: new GeoJsonField(undefined, {
        description: 'Polygon to cut away from A. Only its first feature is used.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'A minus B. Empty if B covers all of A.',
      }),
    }
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
      a: new GeoJsonField(undefined, {
        description: 'First polygon. Only its first feature is used.',
      }),
      b: new GeoJsonField(undefined, {
        description: 'Second polygon. Only its first feature is used.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: "The area where A and B overlap. Empty if they don't overlap.",
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection to find the center of each feature in.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: "One point per feature at its centroid, keeping the feature's properties.",
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection to wrap in a single outline.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'One polygon enclosing all input features, or empty if none can be made.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection of points to build cells around.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: "One polygon per point, clipped to the points' bounding box.",
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection of polygons. MultiPolygons are not supported.',
      }),
      propertyName: new StringField('', {
        description:
          'Property to group by; touching polygons with the same value merge. Blank merges all.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, { description: 'The merged polygons.' }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Features to clip, as a FeatureCollection.',
      }),
      mask: new GeoJsonField(undefined, {
        description: 'Polygon to clip to. Only its first feature is used.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'The parts of each feature inside the mask. Features outside it are dropped.',
      }),
    }
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
      target: new GeoJsonField(undefined, {
        description: 'Features to receive attributes, as a GeoJSON FeatureCollection.',
      }),
      join: new GeoJsonField(undefined, {
        description: 'Features whose properties are copied onto matching target features.',
      }),
      relationship: new StringLiteralField('within', {
        values: ['within', 'intersects', 'contains'],
        description:
          'Match when a target feature is within, intersects or contains a join feature.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description:
          'Target features with properties of the first matching join feature merged in.',
      }),
    }
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
      points: new GeoJsonField(undefined, {
        description: 'Point features to test, as a GeoJSON FeatureCollection.',
      }),
      polygon: new GeoJsonField(undefined, {
        description: 'Boundary to test against. Only the first feature is used.',
      }),
      invert: new BooleanField(false, {
        description: 'Swap the results, so Inside gets the points outside the polygon.',
      }),
    }
  }
  createOutputs() {
    return {
      inside: new GeoJsonField(undefined, { description: 'Points that fall within the polygon.' }),
      outside: new GeoJsonField(undefined, {
        description: 'Points outside the polygon, plus any features that are not points.',
      }),
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
      targetPoint: new Point2DField([0, 0], {
        description: 'Point to search from, as [lng, lat].',
      }),
      points: new GeoJsonField(undefined, {
        description: 'Point features to search, as a GeoJSON FeatureCollection.',
      }),
    }
  }
  createOutputs() {
    return {
      nearest: new GeoJsonField(undefined, {
        description: 'FeatureCollection holding the closest point.',
      }),
      distance: new NumberField(0, {
        description: 'Distance from Target point to the nearest point, in kilometers.',
      }),
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
      geojson: new GeoJsonField(undefined, {
        description: 'Polygon features to measure, as a GeoJSON FeatureCollection.',
      }),
      units: new StringLiteralField('squareKilometers', {
        values: ['squareMeters', 'squareKilometers', 'squareMiles', 'acres', 'hectares'],
        description:
          'Area unit: square meters, square kilometers, square miles, acres or hectares.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: "The input features with an 'area' property added, in Units.",
      }),
      totalArea: new NumberField(0, { description: 'Sum of all feature areas, in Units.' }),
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
      geojson: new GeoJsonField(undefined, {
        description: 'Line features to measure, as a GeoJSON FeatureCollection.',
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'nauticalmiles'],
        description: 'Length unit: kilometers, miles, meters or nautical miles.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: "The input features with a 'length' property added, in Units.",
      }),
      totalLength: new NumberField(0, { description: 'Sum of all feature lengths, in Units.' }),
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection whose coordinates to convert.',
      }),
      from: new StringLiteralField('EPSG:4326', {
        values: ['EPSG:4326', 'EPSG:3857'],
        description:
          'Current projection: EPSG:4326 (lng/lat degrees) or EPSG:3857 (Web Mercator meters).',
      }),
      to: new StringLiteralField('EPSG:3857', {
        values: ['EPSG:4326', 'EPSG:3857'],
        description: 'Projection to convert to. Same as From passes the data through.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'The features with converted coordinates.',
      }),
    }
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
      bbox: new BboxField(
        {
          southwest: { lng: -180, lat: -90 },
          northeast: { lng: 180, lat: 90 },
        },
        {
          label: 'Bounds',
          description: 'Area to fill with points, from southwest to northeast corner.',
        }
      ),
      cellSize: new NumberField(10, {
        min: 0.001,
        step: 1,
        description: 'Distance between neighboring points, in Units.',
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
        description: 'Unit for Cell size.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'Grid points covering the bounds.',
      }),
    }
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
      bbox: new BboxField(
        {
          southwest: { lng: -180, lat: -90 },
          northeast: { lng: 180, lat: 90 },
        },
        {
          label: 'Bounds',
          description: 'Area to fill with hexagons, from southwest to northeast corner.',
        }
      ),
      cellSize: new NumberField(10, {
        min: 0.001,
        step: 1,
        description: 'Length of each hexagon side, in Units.',
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
        description: 'Unit for Cell size.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'Hexagon polygons covering the bounds.',
      }),
    }
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
      bbox: new BboxField(
        {
          southwest: { lng: -180, lat: -90 },
          northeast: { lng: 180, lat: 90 },
        },
        {
          label: 'Bounds',
          description: 'Area to fill with squares, from southwest to northeast corner.',
        }
      ),
      cellSize: new NumberField(10, {
        min: 0.001,
        step: 1,
        description: 'Side length of each square, in Units.',
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters', 'degrees'],
        description: 'Unit for Cell size.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'Square polygons covering the bounds.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Point features to triangulate, as a GeoJSON FeatureCollection.',
      }),
      zProperty: new StringField('', {
        label: 'Value property',
        description:
          "Optional point property whose values are copied onto each triangle's corners.",
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'Triangle polygons connecting the input points.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Grid of points with a numeric value, as a GeoJSON FeatureCollection.',
      }),
      zProperty: new StringField('elevation', {
        label: 'Value property',
        description: 'Point property holding the value to draw contours for.',
      }),
      breaks: new UnknownField([100, 200, 500, 1000, 2000], {
        description: 'Values to draw a contour line at, as an array of numbers.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'Contour lines, one MultiLineString feature per break value.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection with closed lines to turn into polygons.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'Lines become polygons. Other features pass through unchanged.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection with polygons to turn into outlines.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'Polygon boundaries as lines. Other features pass through unchanged.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Features to break apart, as a FeatureCollection.',
      }),
      mode: new StringLiteralField('vertices', {
        values: ['vertices', 'parts'],
        description:
          "'vertices' makes a point for every vertex. 'parts' splits multi-part shapes apart.",
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'The vertex points or single-part features.',
      }),
    }
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
      polygons: new GeoJsonField(undefined, {
        description: 'Zones to aggregate into, as a GeoJSON FeatureCollection of polygons.',
      }),
      points: new GeoJsonField(undefined, {
        description:
          'Point features to count or summarize per zone. Non-point features are ignored.',
      }),
      field: new StringField('', {
        description: "Point property to summarize. Not used when Operation is 'count'.",
      }),
      operation: new StringLiteralField('count', {
        values: ['count', 'sum', 'mean', 'min', 'max'],
        description: 'How to combine the points in each zone: count, sum, mean, min or max.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description:
          "The polygons with a new property named like 'sum_population' holding the result.",
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Point features to cluster, as a GeoJSON FeatureCollection.',
      }),
      numberOfClusters: new NumberField(5, {
        min: 2,
        max: 100,
        step: 1,
        description: 'How many groups to split the points into (2 to 100).',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: "The points with 'cluster' and 'centroid' properties added.",
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Point features to cluster, as a GeoJSON FeatureCollection.',
      }),
      maxDistance: new NumberField(1, {
        min: 0,
        step: 0.1,
        description: 'Largest distance between neighbors in the same cluster, in Units.',
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters'],
        description: 'Unit for Max distance: kilometers, miles or meters.',
      }),
      minPoints: new NumberField(3, {
        min: 1,
        step: 1,
        description: 'Fewest points needed to form a cluster. Points in smaller groups are noise.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description:
          "The points with 'cluster' and 'dbscan' (core, edge or noise) properties added.",
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Sample points with a numeric value, as a GeoJSON FeatureCollection.',
      }),
      cellSize: new NumberField(1, {
        min: 0.01,
        step: 0.1,
        description: 'Spacing between grid points, in Units.',
      }),
      property: new StringField('value', {
        description: 'Point property holding the values to interpolate.',
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters'],
        description: 'Unit for Cell size: kilometers, miles or meters.',
      }),
      weight: new NumberField(2, {
        min: 0.1,
        max: 10,
        step: 0.1,
        showByDefault: false,
        description:
          'Distance weighting power (0.1 to 10). Higher values favor the closest samples.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'A regular grid of points, each with the interpolated value in Property.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Line features to measure along. Only LineString features are used.',
      }),
      distance: new NumberField(1, {
        min: 0,
        step: 0.1,
        description: 'How far along each line to place the point, in Units.',
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters'],
        description: 'Unit for Distance: kilometers, miles or meters.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'One point per input line, at the given distance along it.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'Line features to cut. Only LineString features are used.',
      }),
      startDistance: new NumberField(0, {
        min: 0,
        step: 0.1,
        description: "Where the segment starts, measured from the line's start, in Units.",
      }),
      stopDistance: new NumberField(1, {
        min: 0,
        step: 0.1,
        description: "Where the segment ends, measured from the line's start, in Units.",
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters'],
        description: 'Unit for Start distance and Stop distance: kilometers, miles or meters.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, {
        description: 'One line segment per input line, between the two distances.',
      }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection to rotate. Each feature turns around its own pivot.',
      }),
      angle: new NumberField(0, {
        min: -360,
        max: 360,
        step: 1,
        description: 'Rotation in degrees, -360 to 360. Positive turns clockwise.',
      }),
      pivot: new StringLiteralField('centroid', {
        values: ['centroid', 'center'],
        description: "'centroid' (average of vertices) or 'center' (middle of the bounding box).",
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, { description: 'The rotated features.' }),
    }
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
      geojson: new GeoJsonField(undefined, {
        description: 'FeatureCollection to resize. Each feature scales around its own origin.',
      }),
      factor: new NumberField(1, {
        min: 0.01,
        max: 100,
        step: 0.1,
        description: 'Size multiplier, 0.01 to 100. 1 keeps the original size.',
      }),
      origin: new StringLiteralField('centroid', {
        values: ['centroid', 'center', 'sw', 'se', 'nw', 'ne'],
        description: 'Fixed point: the centroid, bounding box center, or a bounding box corner.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, { description: 'The scaled features.' }),
    }
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
      geojson: new GeoJsonField(undefined, { description: 'FeatureCollection to move.' }),
      distance: new NumberField(0, {
        min: 0,
        step: 0.1,
        description: 'How far to move each feature, in Units.',
      }),
      direction: new NumberField(0, {
        min: 0,
        max: 360,
        step: 1,
        description: 'Compass bearing to move toward, in degrees clockwise from north (0 to 360).',
      }),
      units: new StringLiteralField('kilometers', {
        values: ['kilometers', 'miles', 'meters'],
        description: 'Unit for Distance.',
      }),
    }
  }
  createOutputs() {
    return {
      featureCollection: new GeoJsonField(undefined, { description: 'The moved features.' }),
    }
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
      kml: new CodeField('', { language: 'xml', description: 'KML document as XML text.' }),
    }
  }
  createOutputs() {
    return {
      geojson: new DataField(undefined, {
        description: 'The KML converted to a GeoJSON FeatureCollection.',
      }),
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
      feature: new GeoJsonField(undefined, {
        description: 'GeoJSON feature to move, scale and rotate around its centroid.',
      }),
      scale: new NumberField(1, {
        min: 0.001,
        softMax: 100,
        step: 0.1,
        description: 'Size multiplier around the centroid. 1 keeps the original size.',
      }),
      translateX: new NumberField(0, {
        softMin: -10000,
        softMax: 10000,
        step: 0.1,
        description: 'Distance to move east, in kilometers. Negative moves west.',
      }),
      translateY: new NumberField(0, {
        softMin: -10000,
        softMax: 10000,
        step: 0.1,
        description: 'Distance to move north, in kilometers. Negative moves south.',
      }),
      rotate: new NumberField(0, {
        softMin: -360,
        softMax: 360,
        step: 1,
        description: 'Rotation in degrees, clockwise, around the centroid. Applied before scale.',
      }),
    }
  }
  createOutputs() {
    return {
      feature: new GeoJsonField(undefined, { description: 'The transformed GeoJSON feature.' }),
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
  const data = new DataField(new ArrayField(new UnknownField()), {
    description: 'Table rows to join onto the boundaries, as an array of objects.',
  })
  const geography = new StringLiteralField('us-states', {
    values: GEOGRAPHY_OPTIONS,
    description: "Built-in boundary set to join onto, or 'custom' to use Boundaries.",
  })
  const boundaries = new GeoJsonField(undefined, {
    description: "Your own boundary FeatureCollection. Only used when Geography is 'custom'.",
  })
  const joinKey = new StringLiteralField('', {
    values: [],
    description: 'Column in Data that names each region, such as a state name or code.',
  })
  const geoKey = new StringLiteralField('auto', {
    values: GEO_KEY_OPTIONS,
    label: 'Match by',
    description:
      'How Join key values match regions (name, code, FIPS, ISO). Auto guesses from the first 20 rows.',
  })
  const customSQL = new CodeField('', {
    language: 'sql',
    showByDefault: false,
    description:
      'Optional DuckDB query over the boundaries and data tables. Must keep __idx. Replaces key matching.',
  })

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
      features: new GeoJsonField(undefined, {
        description:
          "Boundary FeatureCollection with each matching row's columns added to its properties.",
      }),
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
    const valueColumn = new StringLiteralField('', {
      values: [],
      description:
        "Numeric column that sets each region's color. Regions without a number are gray.",
    })
    const colorScheme = new StringLiteralField('viridis', {
      values: Object.keys(continuousInterpolators),
      displayAs: 'color-scheme',
      description: 'Color ramp stretched from the lowest to the highest value in Value column.',
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
      layer: new LayerField<GeoJsonLayerProps>(undefined, {
        description: 'GeoJSON layer of the regions, filled by Value column.',
      }),
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
      feature: new GeoJsonField(undefined, {
        description: 'GeoJSON to simplify. Input is not changed.',
      }),
      tolerance: new NumberField(0.01, {
        min: 0,
        softMax: 1,
        step: 0.01,
        description:
          "How far a point can stray before it's kept, in degrees. Higher removes more points.",
      }),
      highQuality: new BooleanField(false, {
        description:
          'Use a slower, more accurate pass that keeps the shape closer to the original.',
      }),
    }
  }

  createOutputs() {
    return {
      feature: new GeoJsonField(undefined, { description: 'The GeoJSON with fewer points.' }),
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
      feature: new GeoJsonField(undefined, {
        description: 'GeoJSON with lines to curve. Non-line geometry passes through unchanged.',
      }),
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
        description: "Curve type, or 'Turn radius' to round each corner with an arc.",
      }),
      samplesPerSegment: new NumberField(12, {
        min: 1,
        max: 64,
        step: 1,
        description: 'Points added per segment, 1 to 64. For Turn radius, points per quarter turn.',
      }),
      alpha: new NumberField(0.5, {
        min: 0,
        max: 1,
        step: 0.05,
        showByDefault: false,
        description:
          'Catmull-Rom curve shape, 0 to 1 (0.5 avoids loops). Only used by Catmull-Rom.',
      }),
      tension: new NumberField(0, {
        min: 0,
        max: 1,
        step: 0.05,
        showByDefault: false,
        description: 'How tight the Cardinal curve is, 0 to 1. Only used by Cardinal.',
      }),
      turnRadiusMeters: new NumberField(250, {
        min: 0,
        softMax: 10_000,
        step: 10,
        label: 'Turn radius',
        description:
          'Corner radius in meters. Only used by Turn radius; shrinks to fit short segments.',
      }),
    }
  }

  createOutputs() {
    return {
      feature: new GeoJsonField(undefined, {
        description: 'The GeoJSON with each line replaced by its interpolated version.',
      }),
    }
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
      feature: new GeoJsonField(undefined, {
        description: 'LineString or MultiLineString feature. Other geometry passes through.',
      }),
      windowSize: new NumberField(5, {
        min: 1,
        max: 100,
        step: 2,
        description: 'Number of nearby points averaged into each point. Larger is smoother.',
      }),
      method: new StringLiteralField('gaussian', {
        values: ['gaussian', 'boxcar'],
        description: "'gaussian' weights closer points more. 'boxcar' weights them all equally.",
      }),
    }
  }

  createOutputs() {
    return {
      feature: new GeoJsonField(undefined, {
        description: 'The smoothed line. Altitude and other extra values are kept.',
      }),
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
      desaturate: new NumberField(0, {
        min: 0,
        max: 1,
        step: 0.01,
        showByDefault: false,
        description: 'Fades the image toward grayscale, 0 (full color) to 1 (gray).',
      }),
      transparentColor: new ColorField(null, {
        optional: true,
        transform: hexToColor,
        showByDefault: false,
        description: 'Color shown where the image is transparent. Unset leaves those pixels clear.',
      }),
      tintColor: new ColorField(null, {
        optional: true,
        transform: hexToColor,
        showByDefault: false,
        description:
          'Color multiplied with every pixel of the image. Unset leaves colors as they are.',
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
      diskResolution: new NumberField(20, {
        min: 3,
        softMax: 100,
        showByDefault: false,
        description: 'Number of sides on each column, at least 3. Higher looks rounder.',
      }),
      vertices: new UnknownField(null, {
        optional: true,
        showByDefault: false,
        description:
          'Custom outline as [x, y] points in the unit circle, scaled by the radius. Replaces the round shape.',
      }),
      offset: new Vec3Field([0, 0, 0], { returnType: 'tuple', showByDefault: false }),
      coverage: new NumberField(1, { min: 0, max: 1, step: 0.01, showByDefault: false }),
      elevationScale: new NumberField(1, { min: 0, softMax: 100, showByDefault: false }),
      filled: new BooleanField(true),
      stroked: new BooleanField(false, { showByDefault: false }),
      extruded: new BooleanField(true),
      wireframe: new BooleanField(false, { showByDefault: false }),
      flatShading: new BooleanField(false, {
        showByDefault: false,
        description:
          'Lights each side of the column as a flat face instead of smoothly. Only when Extruded is on.',
      }),
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
      flatShading: new BooleanField(false, {
        showByDefault: false,
        description:
          'Lights each side of a cell as a flat face instead of smoothly. Only when Extruded is on.',
      }),
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
      lineMiterLimit: new NumberField(4, {
        min: 0,
        softMax: 10,
        showByDefault: false,
        description:
          'How far a sharp outline corner may extend, as a multiple of line width. Ignored when joints are rounded.',
      }),
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
      contours: new UnknownField(
        [
          { threshold: 1, color: [255, 0, 0] },
          { threshold: 5, color: [0, 255, 0] },
          { threshold: 10, color: [0, 0, 255] },
        ],
        {
          description:
            'List of {threshold, color}. A number threshold draws a line; [min, max] fills a band.',
        }
      ),
      zOffset: new NumberField(0.005, {
        min: 0,
        max: 1,
        step: 0.001,
        showByDefault: false,
        description:
          'Tiny height added per contour so overlapping ones draw in order. Default 0.005.',
      }),
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
      cellSizePixels: new NumberField(50, {
        min: 1,
        softMax: 1000,
        label: 'Cell size',
        description:
          'Width and height of each grid cell on screen, in pixels. Cells stay the same size as you zoom.',
      }),
      cellMarginPixels: new NumberField(2, {
        min: 0,
        softMax: 100,
        showByDefault: false,
        label: 'Cell margin',
        description: 'Gap left between neighboring grid cells, in pixels.',
      }),
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
      numSegments: new NumberField(20, {
        min: 1,
        softMax: 100,
        showByDefault: false,
        description: 'Line segments used to draw each arc. Higher gives smoother curves.',
      }),
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
      getHexagons: new UnknownField((d: unknown) => d?.hexagons || [], {
        accessor: true,
        label: 'H3 cells',
        description:
          'Array of H3 cell IDs for each row, drawn as one merged shape. Reads hexagons by default.',
      }),
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
      getGeohash: new StringField('', {
        accessor: true,
        description: 'Geohash string for each row; the cell it names is drawn as a polygon.',
      }),
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
      getS2Token: new StringField('', {
        accessor: true,
        description: 'S2 cell token for each row; the cell it names is drawn as a polygon.',
      }),
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
      getQuadkey: new StringField('', {
        accessor: true,
        description: 'Quadkey string for each row; the map tile it names is drawn as a polygon.',
      }),
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

export class TerrainLayerOp extends Operator<TerrainLayerOp> {
  static displayName = 'TerrainLayer'
  static description = 'Render a terrain mesh from heightmap tiles'
  createInputs() {
    return {
      elevationData: new StringField('https://example.com/elevation/{z}/{x}/{y}.png', {
        description:
          'Heightmap image URL, or a tile URL template with {z}, {x} and {y}. Pixel colors become heights.',
      }),
      texture: new StringField('', { optional: true }),
      visible: new BooleanField(true),
      opacity: new NumberField(1, { min: 0, max: 1, step: 0.01 }),
      meshMaxError: new NumberField(4, {
        min: 0,
        softMax: 100,
        showByDefault: false,
        description:
          'Allowed error when building the terrain mesh, in meters. Lower values give more detail.',
      }),
      elevationDecoder: new CompoundPropsField(
        {
          rScaler: new NumberField(1),
          gScaler: new NumberField(0),
          bScaler: new NumberField(0),
          offset: new NumberField(0),
        },
        {
          description:
            'Turns heightmap colors into meters: R * R scaler + G * G scaler + B * B scaler + Offset.',
        }
      ),
      bounds: new BboxField(null, { optional: true, returnType: 'tuple' }),
      color: new ColorField('#ffffff', {
        transform: hexToColor,
        description: 'Color of the terrain surface, used when no Texture is loaded.',
      }),
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
      maxCacheSize: new NumberField(Infinity, {
        optional: true,
        showByDefault: false,
        description:
          'Most tiles kept in memory after they leave the view. Infinity keeps them all.',
      }),
      maxCacheByteSize: new NumberField(Infinity, {
        optional: true,
        showByDefault: false,
        description: 'Most memory, in bytes, used to keep loaded tiles. Infinity sets no limit.',
      }),
      refinementStrategy: new StringLiteralField('best-available', {
        values: ['best-available', 'no-overlap', 'never'],
        showByDefault: false,
        description:
          "What shows while tiles load: 'best-available' uses other zooms, 'no-overlap' avoids overlap, 'never' waits.",
      }),
      zRange: new UnknownField([0, 24], {
        optional: true,
        showByDefault: false,
        label: 'Height range',
        description:
          'Lowest and highest heights in the tiles as [min, max], in meters. Helps pick visible tiles in 3D.',
      }),
      extent: new UnknownField([-Infinity, -Infinity, Infinity, Infinity], {
        optional: true,
        showByDefault: false,
        description:
          'Area that has tiles, as [minX, minY, maxX, maxY] (longitude and latitude). Tiles outside are not loaded.',
      }),
      renderSubLayers: new FunctionField(null, {
        optional: true,
        showByDefault: false,
        description:
          "Function that takes each tile's props, including its data, and returns the layer that draws it.",
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
      layer: new LayerField<TileLayerProps>(),
    }
  }
  execute({
    renderSubLayers,
    ...props
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    const layer = {
      ...parseLayerProps<TileLayerProps>(props),
      // Passing null leaves deck.gl's TileLayer without its default GeoJsonLayer renderer
      ...(renderSubLayers ? { renderSubLayers } : {}),
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
      clipByInstance: new BooleanField(false, {
        description:
          'When on, hides whole objects whose anchor is outside the bounds instead of cutting them.',
      }),
      clipBounds: new UnknownField([0, 0, 1, 1], {
        description:
          'Rectangle to keep, as [minX, minY, maxX, maxY] in layer coordinates (e.g. lng, lat).',
      }), // [minX, minY, maxX, maxY]
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Clip extension to add to a layer's Extensions list.",
      }),
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
      collisionEnabled: new BooleanField(true, {
        description: 'When off, overlapping objects are all drawn.',
      }),
      collisionGroup: new StringField('default', {
        description: 'Name of the group; objects only hide each other within the same group.',
      }),
      getCollisionPriority: new NumberField(0, {
        accessor: true,
        description: 'Per-item priority; when objects overlap, the higher value is kept visible.',
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Collision filter extension to add to a layer's Extensions list.",
      }),
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
      filterSize: new NumberField(2, {
        min: 1,
        max: 4,
        step: 1,
        description: 'How many numbers each item is filtered on, 1 to 4.',
      }),
      filterEnabled: new BooleanField(true, {
        description: 'When off, all items are drawn and the filter is ignored.',
      }),
      filterRange: new UnknownField(
        [
          [0, 1],
          [0, 1],
        ],
        {
          description:
            'Ranges to keep, one [min, max] pair per filter value. Items outside are hidden.',
        }
      ), // Array of [min, max] pairs
      filterSoftRange: new UnknownField(null, {
        optional: true,
        description: 'Optional inner [min, max] pairs; items between it and Filter range fade out.',
      }),
      filterTransformSize: new BooleanField(true, {
        description: 'When on, items in the fade zone of Filter soft range shrink as they fade.',
      }),
      filterTransformColor: new BooleanField(true, {
        description: 'When on, items in the fade zone of Filter soft range become transparent.',
      }),
      getFilterValue: new UnknownField((_d: unknown) => [0, 0], {
        accessor: true,
        description: 'Per-item value to filter on: a number, or an array of Filter size numbers.',
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Data filter extension to add to a layer's Extensions list.",
      }),
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
      fillPatternEnabled: new BooleanField(true, {
        label: 'Pattern fill',
        description: 'Turns on pattern fills, so fills tile a pattern instead of a solid color.',
      }),
      proceduralPattern: new BooleanField(false, {
        showByDefault: false,
        description:
          'Draws hatch, cross-hatch or dot patterns from Fill pattern mapping, with no image atlas.',
      }),
      fillPatternMask: new BooleanField(true, {
        description:
          'When on, patterns act as masks tinted by the fill color instead of showing their own colors.',
      }),
      fillPatternSizeUnits: new StringLiteralField('meters', {
        values: ['pixels', 'meters', 'common'],
        description:
          "Units for the pattern size. 'meters' zooms with the map; 'pixels' keeps a fixed screen size.",
      }),
      fillPatternAtlas: new StringField('', {
        optional: true,
        description:
          'URL of a sprite image holding all patterns. Ignored when Procedural pattern is on.',
      }),
      fillPatternMapping: new UnknownField(null, {
        optional: true,
        description:
          'Pattern names mapped to atlas frames {x, y, width, height} or procedural pattern settings.',
      }),
      getFillPattern: new UnknownField(null, {
        accessor: true,
        description: 'Per-item pattern name, a key in Fill pattern mapping.',
      }),
      getFillPatternScale: new NumberField(1, {
        accessor: true,
        description:
          'Per-item pattern size multiplier, relative to Fill pattern size units. 1 is original size.',
      }),
      getFillPatternOffset: new Vec2Field([0, 0], {
        returnType: 'tuple',
        accessor: true,
        description:
          'Per-item pattern shift as a fraction of its size, [x, y]. [0.5, 0.5] shifts by half.',
      }),
      getFillPatternBackgroundColor: new ColorField('#00000000', {
        accessor: true,
        transform: hexToColor,
        showByDefault: false,
        description:
          'Per-item color drawn behind the pattern where it is transparent. Clear by default.',
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Fill style extension to add to a layer's Extensions list.",
      }),
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

export class MaskExtensionOp extends Operator<MaskExtensionOp> {
  static displayName = 'MaskExtension'
  static description = 'Show/hide layer objects by a geofence'
  createInputs() {
    return {
      maskId: new StringField('', {
        description: 'ID of the layer used as the mask; only parts inside its shapes are drawn.',
      }),
      maskByInstance: new BooleanField(false, {
        description:
          'When on, shows or hides whole objects by their anchor point instead of cutting them.',
      }),
    }
  }
  createOutputs() {
    return {
      extension: new ExtensionField(undefined, {
        description: "Mask extension to add to a layer's Extensions list.",
      }),
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

export class TimeSeriesOp extends Operator<TimeSeriesOp> {
  static displayName = 'TimeSeries'
  static description =
    'Interpolate time-varying data at a given time. Aligns with TripsLayer API for easy reuse of accessors.'
  asDownload = () => this.outputData

  // Precomputed per-item data keyed by data/accessor references. Rebuilt only
  // when those inputs change, not on every currentTime change during scrubbing.
  private _precomputedTimeSeries: TimeSeriesDataPoint[][] | null = null
  private _precomputedProperties: Record<string, unknown>[] | null = null
  private _precomputeCacheKey: {
    data: unknown
    getTimestamps: unknown
    getValues: unknown
    getProperties: unknown
  } | null = null

  createInputs() {
    return {
      data: new DataField(undefined, {
        description: 'Array of items, each with its own series of timed values.',
      }),
      currentTime: new NumberField(0, {
        description: 'Time to read values at, in the same units as the timestamps.',
      }),
      getTimestamps: new UnknownField(
        (d: unknown) => (d as { timestamps?: unknown[] })?.timestamps || [],
        {
          accessor: true,
          description: "Each item's array of times. Defaults to its timestamps key.",
        }
      ),
      getValues: new UnknownField((d: unknown) => (d as { values?: unknown[] })?.values || [], {
        accessor: true,
        description:
          "Each item's array of value objects, one per timestamp. Defaults to its values key.",
      }),
      getProperties: new UnknownField((d: unknown) => d, {
        accessor: true,
        optional: true,
        description: 'Extra fields to copy onto each output row. Defaults to the whole item.',
      }),
    }
  }
  createOutputs() {
    return {
      data: new DataField(undefined, {
        description: 'One row per item with its values blended linearly at Current time.',
      }),
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

    // Rebuild the expensive per-item structure only when data or accessors change.
    // During timeline scrubbing only currentTime changes, so this cache stays hot.
    const cacheKey = this._precomputeCacheKey
    if (
      !this._precomputedTimeSeries ||
      !this._precomputedProperties ||
      cacheKey?.data !== data ||
      cacheKey?.getTimestamps !== getTimestamps ||
      cacheKey?.getValues !== getValues ||
      cacheKey?.getProperties !== getProperties
    ) {
      this._precomputedTimeSeries = data.map((d, i) => {
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
        return timestamps.map((time: number, idx: number) => ({
          time,
          ...(values[idx] || {}),
        }))
      })
      this._precomputedProperties = data.map((d, i) =>
        getProperties
          ? (getProperties as DeckAccessor<Record<string, unknown>>)(d, {
              index: i,
              data,
              target: [],
            })
          : {}
      )
      this._precomputeCacheKey = { data, getTimestamps, getValues, getProperties }
    }

    return {
      data: this._precomputedTimeSeries.map((timeSeries, i) => ({
        ...this._precomputedProperties![i],
        ...interpolateTimeSeries(timeSeries, currentTime),
        time: currentTime,
      })),
    }
  }
}

export const opTypes = {
  AccessorOp,
  A5LayerOp,
  AggregateOp,
  AlongOp,
  ArcOp,
  ArcLayerOp,
  AreaOp,
  BezierCurveOp,
  BitmapLayerOp,
  BitmapOverlayWidgetOp,
  BlendingOp,
  BooleanOp,
  BoundingBoxOp,
  BufferOp,
  BoundsOp,
  BrightnessContrastExtensionOp,
  BrushableHistogramOp,
  BrushingExtensionOp,
  CategoricalColorRampOp,
  CentroidOp,
  ChartOp,
  ChoroplethJoinOp,
  ChoroplethLayerOp,
  ClipExtensionOp,
  ClipOp,
  CodeOp,
  CollisionFilterExtensionOp,
  CompassWidgetOp,
  ColorOp,
  ColorRampOp,
  ColumnLayerOp,
  CombineRGBAOp,
  CombineXYOp,
  CommentOp,
  ConcatOp,
  CustomMapLibreLayerOp,
  ConsoleOp,
  ContainerOp,
  ContourLayerOp,
  ConvexHullOp,
  CrossOp,
  DataFilterExtensionOp,
  DateFormatOp,
  DateMathOp,
  DatePartsOp,
  DateTimeOp,
  DBScanClusterOp,
  DeckRendererOp,
  DifferenceOp,
  DirectionsOp,
  DissolveOp,
  DuckDbOp,
  ExplodeOp,
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
  FullscreenWidgetOp,
  GeocoderOp,
  GeohashLayerOp,
  GeoEditorOp,
  GeoJsonOp,
  GeoJsonLayerOp,
  GeoJsonTransformOp,
  GeoParquetOp,
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
  HexGridOp,
  HSLOp,
  HueSaturationExtensionOp,
  IconLayerOp,
  InterpolateOp,
  IntersectOp,
  IsolineOp,
  JSONOp,
  KMeansClusterOp,
  KmlToGeoJsonOp,
  LayerPropsOp,
  LegendWidgetOp,
  LengthOp,
  LineInterpolationOp,
  LineLayerOp,
  LineSliceOp,
  LineToPolygonOp,
  MaplibreBasemapOp,
  MapRangeOp,
  MapStyleConfiguratorOp,
  MapViewOp,
  MapViewStateOp,
  Mask3DExtensionOp,
  MaskExtensionOp,
  MathOp,
  MergeOp,
  MouseOp,
  MVTLayerOp,
  NearestPointOp,
  NetworkOp,
  NumberOp,
  OrbitViewOp,
  OrthographicViewOp,
  OutOp,
  OverpassOp,
  PathLayerOp,
  PathStyleExtensionOp,
  PMTilesOp,
  PointCloudLayerOp,
  PointGridOp,
  PointInPolygonOp,
  PointOp,
  PolygonLayerOp,
  PolygonToLineOp,
  ProjectOp,
  QuadkeyLayerOp,
  RampOp,
  RandomizeAttributeOp,
  RasterTileLayerOp,
  RectangleOp,
  ReprojectOp,
  RerouteOp,
  S2LayerOp,
  ScaleWidgetOp,
  ScatterOp,
  ScatterplotLayerOp,
  ScenegraphLayerOp,
  ScreenGridLayerOp,
  ScreenshotWidgetOp,
  ShapefileOp,
  SimpleMeshLayerOp,
  SimplifyOp,
  SmoothOp,
  SelectOp,
  SliceOp,
  SolidPolygonLayerOp,
  SortOp,
  SpatialJoinOp,
  SplitRGBAOp,
  SplitMapViewStateOp,
  SplitXYOp,
  SplitXYZOp,
  SquareGridOp,
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
  TinOp,
  TransformRotateOp,
  TransformScaleOp,
  TransformTranslateOp,
  TripsLayerOp,
  UnionOp,
  UnknownOperator,
  UnprojectOp,
  VibranceExtensionOp,
  ViewerOp,
  VoronoiOp,
  XYZTileOp,
  ZoomWidgetOp,
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
