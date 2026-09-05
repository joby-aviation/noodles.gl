import { type LayerProps, View } from '@deck.gl/core'
import { interpolateLab, scaleOrdinal, schemeAccent } from 'd3'
import { BehaviorSubject, combineLatest, type Subscription } from 'rxjs'
import { Temporal } from 'temporal-polyfill'
import { isHexColor } from 'validator'
import z from 'zod/v4'
import { colorToHex } from '../utils/color'
import { debugSetValue } from '../utils/debug'
import type { BetterDeckProps, BetterMapProps } from '../visualizations'
import type { inputComponents } from './components/field-components'
import type { IOperator, Operator } from './operators'
import { deepEqual } from './utils/deep-equal'
import type { ExtractProps } from './utils/extract-props'
import { resolvePath } from './utils/path-utils'

export interface IField<
  S extends z.ZodType = z.ZodType,
  O extends BaseFieldOptions = BaseFieldOptions,
> extends BehaviorSubject<z.output<S>> {
  createSchema(options: Partial<O>): S
  schema: S
  value: z.output<S>
  defaultValue?: z.output<S>
  accessor?: boolean
  op?: Operator<IOperator>
  setValue(value: z.input<S>): void
  addConnection<F extends Field>(id: string, field: F): void
  removeConnection(id: string, connectionType: 'reference' | 'value'): void
  serialize(): z.infer<S>
}

type BaseFieldOptions = {
  optional?: boolean
  transform?: (val: unknown, ...args: unknown[]) => unknown
  accessor?: boolean
  showByDefault?: boolean // Defaults to true. Set to false to hide field by default in UI.
  useDeepEquality?: boolean // Use deep equality when comparing values to prevent unnecessary updates
  maxDepth?: number // Maximum depth for deep equality checks (Infinity = unlimited)
}

type PointFieldOptions = BaseFieldOptions & {
  returnType?: 'object' | 'tuple'
}

type Vec2FieldOptions = BaseFieldOptions & {
  returnType?: 'object' | 'tuple'
}

type SubSchemaOptions<S extends z.ZodType = z.ZodType> = BaseFieldOptions & {
  subschema?: z.Schema<S>
}

type NumberFieldOptions = BaseFieldOptions & {
  min: number
  max: number
  softMin: number
  softMax: number
  step: number
}

type CompoundPropsFieldOptions = BaseFieldOptions &
  Partial<{
    passthrough: boolean
    subschema: z.ZodRawShape
  }>

type StringLiteralFieldOptions = BaseFieldOptions & {
  values: string[] | Record<string, unknown> | { value: unknown; label: string }[]
  freeform?: boolean
  displayAs?: 'select' | 'typeahead' | 'color-scheme'
}

type CodeFieldOptions = BaseFieldOptions & {
  language?: 'javascript' | 'json' | 'sql' | 'overpass-ql'
}

// Serialized form of a field driven by an expression, e.g. { $expr: "op('/time').out.seconds * 2" }
export type SerializedExpression = { $expr: string }

export function isSerializedExpression(value: unknown): value is SerializedExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$expr' in value &&
    typeof (value as SerializedExpression).$expr === 'string'
  )
}

// The expression engine (utils/field-expressions.ts) registers itself here so Field
// doesn't import the evaluator directly — that would create an import cycle through
// operators.ts (which needs fnWithSource, freeExports, and the op store).
type FieldExpressionEvaluator = (field: Field) => void
let fieldExpressionEvaluator: FieldExpressionEvaluator | null = null

export function registerFieldExpressionEvaluator(evaluator: FieldExpressionEvaluator | null) {
  fieldExpressionEvaluator = evaluator
}

// Field has a lot going on. It's both a type and a value. It's meant to be connected to
// or own its own data, and it's meant to be able to interpolate over time. It's also meant
// to be able to be serialized and deserialized. It's also meant to serve as a template for
// the UI, say to hint to the Node to render a Number input, a Geocoder or a ColorPicker.
export abstract class Field<
    S extends z.ZodType = z.ZodType,
    O extends BaseFieldOptions = BaseFieldOptions,
  >
  extends BehaviorSubject<z.output<S>>
  implements IField<S>
{
  static type: keyof typeof inputComponents
  static defaultValue: unknown // z.output<ReturnType<T['createSchema']>>

  // Fields like Array and Compound need to be able to use a subschema
  abstract createSchema(options: Partial<O>): S

  // The default value is both an instance on the Field and a static property
  defaultValue?: z.output<S>

  // A Zod schema for the field
  schema!: S

  // Can the field be used as an accessor? This is used to determine if the field can be used
  // as a callback function. For example, `getPosition`, `getLineColor`, `getFillColor` etc.
  accessor = false

  // Should this field be shown by default in the UI? Defaults to true.
  showByDefault = true

  // Use deep equality when comparing values to prevent unnecessary updates
  // Only enable for fields with stable, value-typed data (plain objects, arrays, primitives)
  // Do not enable for fields containing class instances, Date, Map, Set with identity semantics
  useDeepEquality = false

  // Maximum depth for deep equality checks (only relevant if useDeepEquality=true)
  // Infinity = unlimited depth, 0 = reference equality only, 1 = shallow, 2+ = limited depth
  maxDepth = Infinity

  // Hold a reference to the operator that owns this field. Only used for debugging at the moment.
  op!: Operator<IOperator>

  subscriptions = new Map<string, Subscription>()

  // Allows this field to be used with Theatre, and debugging with zod
  pathToProps: string[] = []

  // Expression mode ("drivers"): when set, the field's value is computed by evaluating
  // a JavaScript expression instead of holding a literal. Null means literal mode.
  expression$ = new BehaviorSubject<string | null>(null)

  // Last evaluation error (null when the expression evaluated cleanly or in literal mode)
  expressionError$ = new BehaviorSubject<string | null>(null)

  // Teardown for engine-managed subscriptions (e.g. timeline reactivity); owned by the engine
  expressionCleanup: (() => void) | null = null

  get expression(): string | null {
    return this.expression$.value
  }

  constructor(initialValue?: z.input<S> | undefined | Partial<O>, options?: Partial<O>) {
    // This is fine since we set the value immediately after
    super(undefined as unknown as z.output<S>)

    let actualOptions = options || {}
    let actualValue = initialValue

    if (
      options === undefined &&
      typeof initialValue === 'object' &&
      (this instanceof CompoundPropsField ||
        this instanceof DataField ||
        this instanceof ArrayField ||
        this instanceof ListField)
    ) {
      actualOptions = initialValue || ({} as O)
      actualValue = undefined
    }

    this.schema = this.createSchema(actualOptions)
    const { optional } = actualOptions as BaseFieldOptions

    this.schema = this.enhanceSchema(actualOptions)

    const ctor = this.constructor as typeof Field
    this.defaultValue = actualValue !== undefined || optional ? actualValue : ctor.defaultValue
    // When field is required, only set default value if its explicitly defined (e.g. don't set ExtensionField's default if it wasn't defined)
    // If the field is optional, always set the default value
    if (this.defaultValue !== undefined || optional) {
      this.setValue(this.defaultValue as z.input<S>)
    }
  }

  // Wrap schema in additional functionality like optional, transform, accessor etc.
  enhanceSchema({
    accessor,
    optional,
    transform,
    showByDefault,
    useDeepEquality,
    maxDepth,
  }: Partial<O>) {
    let schema = this.schema

    // Set showByDefault (defaults to true if not specified)
    if (showByDefault !== undefined) {
      this.showByDefault = showByDefault
    }

    // Set useDeepEquality if specified
    if (useDeepEquality !== undefined) {
      this.useDeepEquality = useDeepEquality
    }

    // Set maxDepth if specified
    if (maxDepth !== undefined) {
      this.maxDepth = maxDepth
    }

    if (accessor) {
      this.accessor = true
      schema = schema.or(
        z
          .function()
          .input(
            z.union([
              z.tuple([]),
              z.tuple([z.unknown()]),
              z.tuple([z.unknown(), z.unknown()]),
              z.tuple([z.unknown(), z.unknown(), z.unknown()]),
            ])
          )
          .output(z.unknown())
      )

      if (transform) {
        schema = schema.transform((val: unknown) => {
          return typeof val === 'function'
            ? (...args: unknown[]) => transform(val(...args))
            : transform(val)
        }) as unknown as S
      }
    } else if (transform) {
      schema = schema.transform(transform) as unknown as S
    }

    if (optional) {
      schema = schema.optional() as unknown as S
    }

    return schema
  }

  setValue(value: z.input<S>): void {
    const oldValue = this.value
    const path = this.pathToProps.join('.')
    const parsed = this.schema.safeParse(value, {
      reportInput: true,
      error: _iss => path,
    })
    if (parsed.success) {
      debugSetValue('%s: %O -> %O', path, oldValue, parsed.data)
      this.next(parsed.data)

      // Mark the owning operator as dirty
      this.op?.markDirty()
    } else {
      debugSetValue('%s: %O -> %O [PARSE FAILED]', path, oldValue, value)
      debugSetValue('Parse error', parsed.error.issues)
    }
  }

  // Enter expression mode. The value becomes the result of evaluating `expr`;
  // re-evaluation is triggered by reference connections (see addConnection) and,
  // for timeline-dependent expressions, by the engine's timeline subscription.
  setExpression(expr: string): void {
    this.expressionCleanup?.()
    this.expressionCleanup = null
    this.expression$.next(expr)
    if (fieldExpressionEvaluator) {
      fieldExpressionEvaluator(this)
    } else {
      debugSetValue('%s: no expression evaluator registered', this.pathToProps.join('.'))
    }
  }

  // Exit expression mode, keeping the last evaluated value as the new literal value
  clearExpression(): void {
    if (this.expression === null) return
    this.expressionCleanup?.()
    this.expressionCleanup = null
    this.expression$.next(null)
    this.expressionError$.next(null)
  }

  // Re-run the expression (no-op in literal mode)
  evaluateExpression(): void {
    if (this.expression !== null) {
      fieldExpressionEvaluator?.(this)
    }
  }

  addConnection<F extends Field>(
    id: string,
    field: F,
    connectionType: 'reference' | 'value' = 'value'
  ) {
    if (this.subscriptions.has(id)) {
      return
    }

    const subscription = field.subscribe(value => {
      if (connectionType === 'value') {
        this.setValue(value)
      } else if (this.expression !== null) {
        // Reference feeding an expression-driven field: recompute the value
        this.evaluateExpression()
      } else {
        this.next(this.value)
        // For reference connections, also mark dirty
        this.op?.markDirty()
      }
    })
    this.subscriptions.set(id, subscription)
    return subscription
  }

  removeConnection(id: string, connectionType: 'reference' | 'value' = 'value') {
    if (
      connectionType === 'value' &&
      (this instanceof DataField ||
        this instanceof ExpressionField ||
        this instanceof CodeField ||
        this instanceof UnknownField)
    ) {
      this.setValue(this.defaultValue)
    }
    const subscription = this.subscriptions.get(id)
    subscription?.unsubscribe()
    this.subscriptions.delete(id)
  }

  // This is used to serialize the field for project files.
  // Override when the field's value is not the same as the serialized value.
  // e.g. CodeField should serialize the template string with handlebar references, not the resolved value.
  serialize() {
    if (this.expression !== null) {
      return { $expr: this.expression }
    }
    return this.value
  }

  // This is used to deserialize the field from project files.
  // Override when the field's value is not the same as the serialized value.
  // e.g. CodeField stores the string as an array of lines, but we want to deserialize it as a single string.
  static deserialize(value: unknown) {
    return value
  }
}

export class StringField extends Field<z.ZodString> {
  static type = 'string'
  static defaultValue = ''
  createSchema() {
    return z.string()
  }
}

type FileUrlFieldOptions = BaseFieldOptions & {
  accept?: string // e.g. '.glb,.gltf' — controls file picker filter and shows upload button
  suggestions?: { value: string; label: string }[] // typeahead suggestions shown in input
}

export class FileUrlField extends Field<z.ZodString, FileUrlFieldOptions> {
  static type = 'file-url'
  static defaultValue = ''
  accept?: string
  suggestions: { value: string; label: string }[]

  constructor(initialValue?: string, options?: Partial<FileUrlFieldOptions>) {
    super(initialValue, options)
    this.accept = options?.accept
    this.suggestions = options?.suggestions ?? []
  }

  createSchema(_options?: Partial<FileUrlFieldOptions>) {
    return z.string()
  }
}

export interface MapStyleFieldOptions extends BaseFieldOptions {
  accept?: string
  suggestions?: { value: string | Record<string, unknown>; label: string }[]
}

export class MapStyleField extends Field<
  z.ZodUnion<[z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>]>,
  MapStyleFieldOptions
> {
  static type = 'map-style'
  static defaultValue = ''
  accept?: string
  suggestions: { value: string; label: string }[]

  constructor(defaultValue = '', options?: Partial<MapStyleFieldOptions>) {
    super(defaultValue, options)
    this.accept = options?.accept
    this.suggestions = options?.suggestions ?? []
  }

  createSchema(_options?: Partial<MapStyleFieldOptions>) {
    return z.union([z.string(), z.record(z.string(), z.unknown())])
  }

  // Skip update if object content is identical to avoid unnecessary downstream re-execution
  setValue(value: z.input<typeof this.schema>): void {
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof this.value === 'object' &&
      this.value !== null &&
      deepEqual(this.value, value)
    ) {
      return
    }
    super.setValue(value)
  }
}

export const IN_NS = 'par'
export const OUT_NS = 'out'
export type InOut = typeof IN_NS | typeof OUT_NS
export type FieldReference = {
  opId: string
  inOut: InOut
  fieldPath: string
  fieldName: string
  handleId: string
}

// Support referencing operators with braces: `{{/path/to/operator.out.val}}` or `op('/path/to/operator').out.val`
// Also supports property access with dot syntax - `/geocoder1.out.location.lng`
// Supports relative paths: `./sibling.out.val`, `../parent.out.val`, `../../grandparent/sibling.out.val`
// Also supports simple relative paths: `code1.out.val` (equivalent to `./code1.out.val`)
const OPERATOR_ID_PATTERN = `(?:${[
  // Absolute paths: /path/to/operator
  /\/[\w-]+(?:\/[\w-]+)*/.source,
  // Relative paths: ../parent, ../../grandparent
  /(?:\.\.\/)+[\w-]+(?:\/[\w-]+)*/.source,
  // Relative paths: ./sibling
  /\.\/[\w-]+(?:\/[\w-]+)*/.source,
  // Simple relative paths: code1 (equivalent to ./code1)
  /[\w-]+/.source,
].join('|')})`

// Mustache-style references: {{/path/to/operator.out.val}}
export const mustacheRe = new RegExp(
  `{{(?<opId>${OPERATOR_ID_PATTERN})\\.(?<inOut>par|out)\\.(?<fieldPath>[\\w-.]+)}}`,
  'g'
)
// Function-style references: op('/path/to/operator').out.val or op("/path/to/operator").out.val
export const fnRe = new RegExp(
  `op\\((?<q>['"])(?<opId>${OPERATOR_ID_PATTERN})\\k<q>\\)\\.(?<inOut>par|out)\\.(?<fieldPath>[\\w-.]+)`,
  'g'
)

// Self-reference shorthand: {{par.fieldPath}} (references current operator's own parameter)
export const selfParMustacheRe = /{{(?<inOut>par)\.(?<fieldPath>[\w-.]+)}}/g

export function getFieldReferences(text: string, thisOpId?: string) {
  const fieldReferences = new Map<string, FieldReference>()

  // Match standard references (with operator ID)
  for (const { groups } of [...text.matchAll(mustacheRe), ...text.matchAll(fnRe)]) {
    const fieldPath = groups?.fieldPath.split('.')[0]
    const opId = thisOpId ? resolvePath(groups?.opId || '', thisOpId) : groups?.opId
    const inOut = groups?.inOut as InOut

    if (!groups || !opId || !fieldPath) {
      debugSetValue(`Invalid operator ID or field path: ${opId}`)
      continue
    }

    // Prevent duplicate references from being added to edges
    const handleId = `${inOut}.${fieldPath}`
    const fullPath = `${opId}.${handleId}`
    if (fieldReferences.has(fullPath)) {
      continue
    }
    const ref = { fieldPath, opId, inOut: groups?.inOut as InOut, handleId } as FieldReference
    fieldReferences.set(fullPath, ref)
  }

  // Match self-parameter shorthand ({{par.fieldPath}})
  if (thisOpId) {
    for (const { groups } of text.matchAll(selfParMustacheRe)) {
      const fieldPath = groups?.fieldPath.split('.')[0]
      const inOut = groups?.inOut as InOut // Always 'par'

      if (!groups || !fieldPath) continue

      const handleId = `${inOut}.${fieldPath}`
      const fullPath = `${thisOpId}.${handleId}`
      if (fieldReferences.has(fullPath)) continue

      const ref = { fieldPath, opId: thisOpId, inOut, handleId } as FieldReference
      fieldReferences.set(fullPath, ref)
    }
  }

  return Array.from(fieldReferences.values())
}

export class CodeField extends Field<
  z.ZodUnion<
    [
      z.ZodEffects<z.ZodString, string, string>,
      z.ZodEffects<z.ZodArray<z.ZodUnknown, 'many'>, string, unknown[]>,
    ]
  >,
  CodeFieldOptions
> {
  static type = 'code'
  static defaultValue = ''
  language: 'javascript' | 'sql' | 'json' | 'overpass-ql' = 'javascript'

  subscribedFields = new Map()

  createSchema() {
    return z.string()
  }

  // Make it easier to diff code fields in project files
  serialize(): string[] {
    return this.value.split('\n')
  }

  static deserialize(value: string | string[]) {
    return Array.isArray(value) ? value.join('\n') : value
  }

  constructor(override?: string, options?: Partial<CodeFieldOptions>) {
    super(override, options)
    this.language = options?.language || this.language
  }
}

export class ExpressionField extends Field<z.ZodString> {
  static type = 'expression'
  static defaultValue = ''
  createSchema() {
    return z.string()
  }
}

export class FunctionField extends Field<
  z.ZodFunction<z.ZodTuple<[], z.ZodUnknown>, z.ZodUnknown>
> {
  static type = 'function'
  static defaultValue = (d: unknown) => d
  createSchema() {
    return z
      .function()
      .input(
        z.union([
          z.tuple([]),
          z.tuple([z.unknown()]),
          z.tuple([z.unknown(), z.unknown()]),
          z.tuple([z.unknown(), z.unknown(), z.unknown()]),
        ])
      )
  }
}

type StringLiteralOption = { value: string; label: string }
export const parseChoices = (
  opts?: Partial<StringLiteralFieldOptions> | StringLiteralOption[] | string[]
) => {
  const values = Array.isArray(opts) ? opts : opts?.values
  const choices: StringLiteralOption[] = []
  if (Array.isArray(values)) {
    for (const value of values) {
      if (typeof value === 'string') {
        choices.push({ value, label: value })
      } else if (
        typeof value === 'object' &&
        value !== null &&
        'value' in value &&
        'label' in value
      ) {
        choices.push({ value: value.value as string, label: value.label as string })
      }
    }
  } else if (typeof values === 'object' && values !== null) {
    for (const [label, value] of Object.entries(values)) {
      choices.push({ value: value as string, label })
    }
  }
  return choices
}

export class StringLiteralField extends Field<
  z.ZodUnion<[z.ZodLiteral<string>, ...z.ZodLiteral<string>[]]> | z.ZodString,
  StringLiteralFieldOptions
> {
  static type = 'string-literal'
  static defaultValue = ''
  choices: StringLiteralOption[] = []
  freeform = false
  displayAs?: 'select' | 'typeahead' | 'color-scheme'
  createSchema(options: Partial<StringLiteralFieldOptions>) {
    const values = (options.values || []) as StringLiteralOption[]
    const freeform = options.freeform ?? false
    // TODO: use zod enum? transform StringLiteralOption input type to string?
    return freeform || values.length === 0
      ? z.string()
      : z.union(values.map(({ value }: StringLiteralOption) => z.literal(value)))
  }

  constructor(
    override?: string,
    opts?: Partial<StringLiteralFieldOptions> | StringLiteralOption[] | string[]
  ) {
    const choices = parseChoices(opts)
    super(override, { ...(Array.isArray(opts) ? {} : opts), values: choices })
    this.choices = choices
    this.freeform = !Array.isArray(opts) && (opts?.freeform ?? false)
    this.displayAs = !Array.isArray(opts) ? opts?.displayAs : undefined
  }

  updateChoices(opts: Partial<StringLiteralFieldOptions> | StringLiteralOption[] | string[]) {
    const choices = parseChoices(opts)
    this.choices = choices
    this.freeform = !Array.isArray(opts) && (opts.freeform ?? false)
    const mergedOpts = { ...(Array.isArray(opts) ? {} : opts), values: choices }
    this.schema = this.createSchema(mergedOpts)
    this.schema = this.enhanceSchema(mergedOpts)
  }
}

export class NumberField extends Field<z.ZodNumber, NumberFieldOptions> {
  static type = 'number'
  static defaultValue = 0

  min: number
  max: number
  softMin: number
  softMax: number
  step: number

  createSchema(options: NumberFieldOptions) {
    const schema = z.number().min(options.min).max(options.max)
    // .step(opts.step) // Requires that the value is a multiple of the step

    return schema
  }

  constructor(override?: number, options?: Partial<NumberFieldOptions>) {
    const opts = {
      min: -Infinity,
      max: Infinity,
      softMin: -Infinity,
      softMax: Infinity,
      step: 0.1,
      ...options,
    }
    super(override, opts)
    this.min = opts.min
    this.max = opts.max
    this.softMin = opts.softMin
    this.softMax = opts.softMax
    this.step = opts.step
  }
}

export interface ChannelFieldOwner {
  channelFields: Record<string, NumberField>
  returnType: 'object' | 'tuple'
}

function initializeChannelFields(
  // biome-ignore lint/suspicious/noExplicitAny: vector fields use different Zod tuple/object unions
  field: Field<any, any> & ChannelFieldOwner,
  channelKeys: readonly string[]
): void {
  const getChannelValue = (value: unknown, key: string, index: number): unknown => {
    if (Array.isArray(value)) return value[index]
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key]
    return undefined
  }

  const initialValue = field.value
  field.channelFields = Object.fromEntries(
    channelKeys.map((key, index) => [
      key,
      new NumberField(
        typeof getChannelValue(initialValue, key, index) === 'number'
          ? (getChannelValue(initialValue, key, index) as number)
          : 0,
        { accessor: field.accessor }
      ),
    ])
  )

  let syncingFromParent = false
  const parentToChannels = field.subscribe(value => {
    if (typeof value === 'function') return
    syncingFromParent = true
    for (const [index, key] of channelKeys.entries()) {
      const channelValue = getChannelValue(value, key, index)
      const channelField = field.channelFields[key]
      if (typeof channelValue === 'number' && channelField.value !== channelValue) {
        // This is an internal mirror of an already-applied parent value. Using
        // setValue() here would mark the owning operator dirty. That is fatal
        // for output vectors: publishing an output would immediately dirty the
        // operator that just produced it, causing it to execute again forever.
        // User edits and channel connections still go through setValue().
        channelField.next(channelValue)
      }
    }
    syncingFromParent = false
  })
  field.subscriptions.set('__parentToChannels', parentToChannels)

  const channelsToParent = combineLatest(
    channelKeys.map(key => field.channelFields[key])
  ).subscribe(channelValues => {
    if (syncingFromParent) return

    const createValue = (values: unknown[]) =>
      field.returnType === 'tuple'
        ? values
        : Object.fromEntries(channelKeys.map((key, index) => [key, values[index]]))

    const hasAccessor = channelValues.some(value => typeof value === 'function')
    const nextValue = hasAccessor
      ? (...args: unknown[]) =>
          createValue(
            channelValues.map(value =>
              typeof value === 'function'
                ? (value as (...args: unknown[]) => unknown)(...args)
                : value
            )
          )
      : createValue(channelValues)

    // Vector schemas accept this value shape (or an accessor when enabled), but the
    // concrete tuple/object union varies by vector class.
    field.setValue(nextValue as never)
  })
  field.subscriptions.set('__channelsToParent', channelsToParent)
}

export function hasChannelFields(
  // biome-ignore lint/suspicious/noExplicitAny: type guard applies across all concrete Field schemas
  field: Field<any, any>
  // biome-ignore lint/suspicious/noExplicitAny: preserve the concrete field schema after narrowing
): field is Field<any, any> & ChannelFieldOwner {
  return 'channelFields' in field && field.channelFields !== undefined
}

// TODO: decide on storage and serialization format
// How to convert to and from hex, rgb, hsl, deck [r,g,b,a] etc.
export class ColorField extends Field<z.ZodString> {
  static type = 'color'
  static defaultValue = '#0000ffff' // Include alpha channel
  createSchema() {
    return z
      .string()
      .refine(val => isHexColor(val))
      .transform(val => {
        // Normalize 6-char hex to 8-char hex (add alpha channel)
        return val.length === 7 ? `${val}ff` : val
      })
  }
  serialize(): string {
    return Array.isArray(this.value) ? colorToHex(this.value) : this.value
  }
  static deserialize(value: string | [number, number, number, number]) {
    return Array.isArray(value) ? colorToHex(value) : value
  }
}

export class ColorRampField extends Field<
  z.ZodFunction<z.ZodTuple<[z.ZodNumber], z.ZodUnknown>, z.ZodString>
> {
  static type = 'color-ramp'
  static defaultValue = interpolateLab('#0000ff', '#ff0000')
  createSchema() {
    return z.function(z.tuple([z.number()]), z.string())
  }
}

export class CategoricalColorRampField extends Field<
  z.ZodFunction<z.ZodTuple<[z.ZodString], z.ZodUnknown>, z.ZodString>
> {
  static type = 'category-color-ramp'
  static defaultValue = scaleOrdinal(schemeAccent)
  count = 7 // number of categories. Set by the Operator on change
  createSchema() {
    return z.function(z.tuple([z.string()]), z.string())
  }
}

export class BooleanField extends Field<z.ZodBoolean> {
  static type = 'boolean'
  static defaultValue = false
  createSchema() {
    return z.boolean()
  }
}

export class DateField extends Field<
  z.ZodUnion<
    readonly [
      z.ZodCustom<Temporal.PlainDateTime, Temporal.PlainDateTime>,
      z.ZodPipe<z.ZodDate, z.ZodTransform<Temporal.PlainDateTime, Date>>,
      z.ZodPipe<z.ZodISODateTime, z.ZodTransform<Temporal.PlainDateTime, string>>,
    ]
  >
> {
  static type = 'date'
  static defaultValue = Temporal.Now.plainDateTimeISO()
  createSchema() {
    return z.union([
      // Accept Temporal.PlainDateTime directly
      z.custom<Temporal.PlainDateTime>(
        val => val instanceof Temporal.PlainDateTime,
        'Expected Temporal.PlainDateTime'
      ),
      // Convert Date to Temporal.PlainDateTime in UTC
      z.date().transform(date => {
        return Temporal.Instant.fromEpochMilliseconds(date.getTime())
          .toZonedDateTimeISO('UTC')
          .toPlainDateTime()
      }),
      // Parse ISO datetime string from project files to Temporal
      z.iso.datetime({ offset: true, local: true }).transform(str => {
        return Temporal.PlainDateTime.from(str)
      }),
    ])
  }
  static deserialize(value: string) {
    // Deserialize ISO string to Temporal.PlainDateTime
    return Temporal.PlainDateTime.from(value)
  }
  serialize(): string {
    // Serialize Temporal.PlainDateTime to ISO string
    return this.value.toString()
  }
}

// DataField represents an array of data items with optional subfield for schema validation
// The TElement type parameter allows type inference in ExtractProps
// Usage: new DataField() for untyped data, new DataField(new SomeField()) for schema validation
export class DataField<D extends Field = Field, TElement = unknown> extends Field<
  z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>> | z.ZodUnknown,
  SubSchemaOptions<D['schema']>
> {
  static type = 'data'
  static defaultValue = []

  // Phantom type for ExtractProps inference
  declare readonly _elementType: TElement

  createSchema({ subschema }: { subschema: z.Schema<D['schema']> }) {
    return subschema.readonly()
  }

  constructor(public field?: D) {
    const subschema = field?.schema || z.unknown()
    const defaultValue = typeof field?.defaultValue !== 'undefined' ? field.defaultValue : []
    super(defaultValue, { subschema } as SubSchemaOptions<D['schema']>)
  }
}

// GeoJSON field type with lime color to distinguish from regular data fields
// The TElement type parameter allows type inference in ExtractProps
export class GeoJsonField<D extends Field = Field, TElement = unknown> extends Field<
  z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>> | z.ZodUnknown,
  SubSchemaOptions<D['schema']>
> {
  static type = 'geojson'
  static defaultValue = { type: 'FeatureCollection', features: [] }

  // Phantom type for ExtractProps inference
  declare readonly _elementType: TElement

  createSchema({ subschema }: { subschema: z.Schema<D['schema']> }) {
    return subschema.readonly()
  }

  constructor(public field?: D) {
    const subschema = field?.schema || z.unknown()
    const defaultValue =
      typeof field?.defaultValue !== 'undefined'
        ? field.defaultValue
        : { type: 'FeatureCollection', features: [] }
    super(defaultValue, { subschema } as SubSchemaOptions<D['schema']>)
  }
}

// Helper to extract coordinates from GeoJSON Point geometries or Features
// Used by Point2DField and Point3DField to accept PointOp outputs and geometry columns
function extractGeoJsonPointCoordinates(
  val: unknown,
  dimensions: 2 | 3 = 3
): { lng: number; lat: number; alt: number } | { lng: number; lat: number } | null {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return null
  }

  const obj = val as Record<string, unknown>

  // Check if it's a bare GeoJSON Point geometry
  if (obj.type === 'Point' && Array.isArray(obj.coordinates) && obj.coordinates.length >= 2) {
    const coords = obj.coordinates as number[]
    if (dimensions === 3) {
      return {
        lng: coords[0],
        lat: coords[1],
        alt: coords.length >= 3 ? coords[2] : 0,
      }
    }
    return {
      lng: coords[0],
      lat: coords[1],
    }
  }

  // Check if it's a GeoJSON Point Feature
  if (obj.type === 'Feature' && typeof obj.geometry === 'object' && obj.geometry !== null) {
    const geom = obj.geometry as Record<string, unknown>
    if (geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
      const coords = geom.coordinates as number[]
      if (dimensions === 3) {
        return {
          lng: coords[0],
          lat: coords[1],
          alt: coords.length >= 3 ? coords[2] : 0,
        }
      }
      return {
        lng: coords[0],
        lat: coords[1],
      }
    }
  }

  return null
}

// Extract point coordinates from a row object's "geometry" column.
// Handles: [lng, lat], [lng, lat, alt], {type: "Point", coordinates: [...]}, and GeoJSON Features.
function extractGeometryColumn(
  obj: Record<string, unknown>,
  dimensions: 2 | 3 = 3
): { lng: number; lat: number; alt: number } | { lng: number; lat: number } | null {
  const geom = obj.geometry
  if (geom === undefined || geom === null) {
    return null
  }

  // geometry is a [lng, lat] or [lng, lat, alt] tuple
  if (
    Array.isArray(geom) &&
    geom.length >= 2 &&
    typeof geom[0] === 'number' &&
    typeof geom[1] === 'number'
  ) {
    if (dimensions === 3) {
      const alt = geom.length >= 3 && typeof geom[2] === 'number' ? geom[2] : 0
      return { lng: geom[0], lat: geom[1], alt }
    }
    return { lng: geom[0], lat: geom[1] }
  }

  // geometry is a GeoJSON Point geometry or Feature
  const geoJsonCoords = extractGeoJsonPointCoordinates(geom, dimensions)
  if (geoJsonCoords) {
    return geoJsonCoords
  }

  return null
}

type Point3DFieldValue =
  | { lng: number; lat: number; alt: number; [key: string]: unknown }
  | [number, number, number]

// Should this just be a Vec2? Should it be a GeoJSON Point Or does it need to be a special case
export class Point3DField extends Field<
  z.ZodUnion<
    [
      z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber]>,
      z.ZodTuple<[z.ZodNumber, z.ZodNumber]>,
      z.ZodObject<{ lng: z.ZodNumber; lat: z.ZodNumber; alt: z.ZodNumber }>,
      z.ZodObject<{ lng: z.ZodNumber; lat: z.ZodNumber }>,
    ]
  >,
  PointFieldOptions
> {
  static type = 'geopoint-3d'
  static defaultValue = { lng: 0, lat: 0, alt: 0 }
  static channelKeys = ['lng', 'lat', 'alt'] as const

  returnType: 'object' | 'tuple' = 'object'
  channelFields: Record<string, NumberField> = {}

  constructor(override?: Point3DFieldValue, options?: PointFieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
    initializeChannelFields(this, Point3DField.channelKeys)
  }

  createSchema({ returnType = 'object' }: PointFieldOptions = {}) {
    const noop = (val: unknown) => val
    return z.union([
      z
        .unknown()
        .transform(val => {
          // Try to extract GeoJSON Point geometry or Feature coordinates (3D)
          const geoJsonCoords = extractGeoJsonPointCoordinates(val, 3)
          if (geoJsonCoords) {
            return geoJsonCoords
          }

          // Normalize column names: support Longitude/Latitude, longitude/latitude, lon/lat
          if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            const obj = val as Record<string, unknown>

            // Check for a "geometry" column containing point data
            const geomCoords = extractGeometryColumn(obj, 3)
            if (geomCoords) {
              return geomCoords
            }

            const normalized: Record<string, unknown> = {}
            let hasLng = false
            let hasLat = false
            let _hasAlt = false

            for (const [key, value] of Object.entries(obj)) {
              const lowerKey = key.toLowerCase()
              // Map longitude variants to lng
              if (lowerKey === 'longitude' || lowerKey === 'lon') {
                normalized.lng = value
                hasLng = true
              }
              // Map latitude variants to lat
              else if (lowerKey === 'latitude') {
                normalized.lat = value
                hasLat = true
              }
              // Map altitude variants to alt
              else if (lowerKey === 'altitude') {
                normalized.alt = value
                _hasAlt = true
              }
              // Keep existing lng/lat/alt as-is (for backward compatibility)
              else if (lowerKey === 'lng') {
                normalized.lng = value
                hasLng = true
              } else if (lowerKey === 'lat') {
                normalized.lat = value
                hasLat = true
              } else if (lowerKey === 'alt') {
                normalized.alt = value
                _hasAlt = true
              }
              // Pass through all other properties
              else {
                normalized[key] = value
              }
            }

            // Only return normalized object if we have required coordinate fields (lng and lat)
            if (hasLng && hasLat) {
              return normalized
            }
          }
          return val
        })
        .pipe(
          z.looseObject({
            lng: z.number(),
            lat: z.number(),
            alt: z.number(),
          })
        )
        .transform(returnType === 'tuple' ? val => [val.lng, val.lat, val.alt] : noop),
      z
        .unknown()
        .transform(val => {
          // Normalize column names for 2D variant (no altitude)
          // Note: GeoJSON Point geometries/Features and geometry columns are handled by the first union arm
          if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            const obj = val as Record<string, unknown>
            const normalized: Record<string, unknown> = {}
            let hasLng = false
            let hasLat = false

            for (const [key, value] of Object.entries(obj)) {
              const lowerKey = key.toLowerCase()
              if (lowerKey === 'longitude' || lowerKey === 'lon') {
                normalized.lng = value
                hasLng = true
              } else if (lowerKey === 'latitude') {
                normalized.lat = value
                hasLat = true
              } else if (lowerKey === 'lng') {
                normalized.lng = value
                hasLng = true
              } else if (lowerKey === 'lat') {
                normalized.lat = value
                hasLat = true
              } else {
                normalized[key] = value
              }
            }

            if (hasLng && hasLat) {
              return normalized
            }
          }
          return val
        })
        .pipe(
          z.looseObject({
            lng: z.number(),
            lat: z.number(),
          })
        )
        .transform(
          returnType === 'tuple' ? val => [val.lng, val.lat, 0] : val => ({ ...val, alt: 0 })
        ),
      z
        .tuple([z.number(), z.number(), z.number()])
        .transform(
          returnType === 'object' ? val => ({ lng: val[0], lat: val[1], alt: val[2] }) : noop
        ),
      z
        .tuple([z.number(), z.number()])
        .transform(returnType === 'object' ? val => ({ lng: val[0], lat: val[1], alt: 0 }) : noop),
    ])
  }
}

type Point2DFieldValue = { lng: number; lat: number; [key: string]: unknown } | [number, number]
type BboxFieldValue =
  | { southwest: Point2DFieldValue; northeast: Point2DFieldValue }
  | [Point2DFieldValue, Point2DFieldValue]

// Should this just be a Vec2? Should it be a GeoJSON Point Or does it need to be a special case
export class Point2DField extends Field<
  z.ZodUnion<
    [
      z.ZodObject<
        { lng: z.ZodNumber; lat: z.ZodNumber },
        'passthrough',
        z.ZodTypeAny,
        Point2DFieldValue
      >,
      z.ZodEffects<
        z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber]>,
        Point2DFieldValue,
        [number, number, number]
      >,
      z.ZodEffects<z.ZodTuple<[z.ZodNumber, z.ZodNumber]>, Point2DFieldValue, [number, number]>,
    ]
  >,
  PointFieldOptions
> {
  static type = 'geopoint-2d'
  static defaultValue = { lng: 0, lat: 0 }
  static channelKeys = ['lng', 'lat'] as const

  returnType: 'object' | 'tuple' = 'object'
  channelFields: Record<string, NumberField> = {}

  constructor(override?: Point2DFieldValue, options?: PointFieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
    initializeChannelFields(this, Point2DField.channelKeys)
  }

  createSchema({ returnType = 'object' }: PointFieldOptions = {}) {
    const noop = (val: unknown) => val
    return z.union([
      z
        .unknown()
        .transform(val => {
          // Try to extract GeoJSON Point geometry or Feature coordinates (2D)
          const geoJsonCoords = extractGeoJsonPointCoordinates(val, 2)
          if (geoJsonCoords) {
            return geoJsonCoords
          }

          // Normalize column names: support Longitude/Latitude, longitude/latitude, lon/lat
          if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            const obj = val as Record<string, unknown>

            // Check for a "geometry" column containing point data
            const geomCoords = extractGeometryColumn(obj, 2)
            if (geomCoords) {
              return geomCoords
            }

            const normalized: Record<string, unknown> = {}
            let hasLng = false
            let hasLat = false

            for (const [key, value] of Object.entries(obj)) {
              const lowerKey = key.toLowerCase()
              // Map longitude variants to lng
              if (lowerKey === 'longitude' || lowerKey === 'lon') {
                normalized.lng = value
                hasLng = true
              }
              // Map latitude variants to lat
              else if (lowerKey === 'latitude') {
                normalized.lat = value
                hasLat = true
              }
              // Keep existing lng/lat as-is (for backward compatibility)
              else if (lowerKey === 'lng') {
                normalized.lng = value
                hasLng = true
              } else if (lowerKey === 'lat') {
                normalized.lat = value
                hasLat = true
              }
              // Pass through all other properties
              else {
                normalized[key] = value
              }
            }

            // Only return normalized object if we found required coordinate fields (lng and lat)
            if (hasLng && hasLat) {
              return normalized
            }
          }
          return val
        })
        .pipe(
          z.looseObject({
            lng: z.number(),
            lat: z.number(),
          })
        )
        .transform(returnType === 'tuple' ? val => [val.lng, val.lat] : noop),
      z
        .tuple([z.number(), z.number(), z.number()])
        .transform(returnType === 'object' ? val => ({ lng: val[0], lat: val[1] }) : noop),
      z
        .tuple([z.number(), z.number()])
        .transform(returnType === 'object' ? val => ({ lng: val[0], lat: val[1] }) : noop),
    ])
  }
}

export class BboxField extends Field<
  z.ZodUnion<
    [
      z.ZodObject<{
        southwest: z.ZodType<Point2DFieldValue>
        northeast: z.ZodType<Point2DFieldValue>
      }>,
      z.ZodTuple<[z.ZodType<Point2DFieldValue>, z.ZodType<Point2DFieldValue>]>,
    ]
  >,
  PointFieldOptions
> {
  static type = 'bbox'
  static defaultValue = {
    southwest: { lng: -74.05, lat: 40.68 },
    northeast: { lng: -73.9, lat: 40.82 },
  }
  static channelKeys = ['southwest', 'northeast'] as const

  returnType: 'object' | 'tuple' = 'object'

  constructor(override?: BboxFieldValue, options?: PointFieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
  }

  createSchema({ returnType = 'object' }: PointFieldOptions = {}) {
    const point2dSchema = z.union([
      z.object({ lng: z.number(), lat: z.number() }).passthrough(),
      z.tuple([z.number(), z.number()]),
    ])

    return z.union([
      z
        .object({
          southwest: point2dSchema,
          northeast: point2dSchema,
        })
        .transform(val => {
          if (returnType === 'tuple') {
            const sw = Array.isArray(val.southwest)
              ? val.southwest
              : [val.southwest.lng, val.southwest.lat]
            const ne = Array.isArray(val.northeast)
              ? val.northeast
              : [val.northeast.lng, val.northeast.lat]
            return [sw, ne]
          }
          // Normalize points to {lng, lat} format
          const sw = Array.isArray(val.southwest)
            ? { lng: val.southwest[0], lat: val.southwest[1] }
            : val.southwest
          const ne = Array.isArray(val.northeast)
            ? { lng: val.northeast[0], lat: val.northeast[1] }
            : val.northeast
          return { southwest: sw, northeast: ne }
        }),
      z.tuple([point2dSchema, point2dSchema]).transform(val => {
        if (returnType === 'object') {
          const sw = Array.isArray(val[0]) ? { lng: val[0][0], lat: val[0][1] } : val[0]
          const ne = Array.isArray(val[1]) ? { lng: val[1][0], lat: val[1][1] } : val[1]
          return { southwest: sw, northeast: ne }
        }
        return val
      }),
    ])
  }
}

type Vec2FieldOverride = { x: number; y: number } | [number, number]

export class Vec2Field extends Field<
  z.ZodObject<
    { x: z.ZodNumber; y: z.ZodNumber },
    'strip',
    z.ZodTypeAny,
    { x: number; y: number },
    { x: number; y: number }
  >,
  Vec2FieldOptions
> {
  static type = 'vec2'
  static defaultValue = { x: 0, y: 0 }
  static channelKeys = ['x', 'y'] as const
  returnType: 'object' | 'tuple' = 'object'
  channelFields: Record<string, NumberField> = {}
  constructor(override?: Vec2FieldOverride, options?: Vec2FieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
    initializeChannelFields(this, Vec2Field.channelKeys)
  }
  createSchema({ returnType = 'object' }: Vec2FieldOptions = {}) {
    const noop = (val: unknown) => val
    return z.union([
      z
        .looseObject({
          x: z.number(),
          y: z.number(),
        })
        .transform(returnType === 'tuple' ? val => [val.x, val.y] : noop),
      z
        .tuple([z.number(), z.number()])
        .transform(returnType === 'object' ? val => ({ x: val[0], y: val[1] }) : noop),
    ])
  }
}

type Vec3FieldOverride = { x: number; y: number; z: number } | [number, number, number]

export class Vec3Field extends Field<
  z.ZodObject<
    { x: z.ZodNumber; y: z.ZodNumber; z: z.ZodNumber },
    'strip',
    z.ZodTypeAny,
    { x: number; y: number; z: number },
    { x: number; y: number; z: number }
  >,
  Vec2FieldOptions
> {
  static type = 'vec3'
  static defaultValue = { x: 0, y: 0, z: 0 }
  static channelKeys = ['x', 'y', 'z'] as const
  returnType: 'object' | 'tuple' = 'object'
  channelFields: Record<string, NumberField> = {}
  constructor(override?: Vec3FieldOverride, options?: Vec2FieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
    initializeChannelFields(this, Vec3Field.channelKeys)
  }
  createSchema({ returnType = 'object' }: Vec2FieldOptions = {}) {
    const noop = (val: unknown) => val
    return z.union([
      z
        .looseObject({
          x: z.number(),
          y: z.number(),
          z: z.number(),
        })
        .transform(returnType === 'tuple' ? val => [val.x, val.y, val.z] : noop),
      z
        .tuple([z.number(), z.number(), z.number()])
        .transform(returnType === 'object' ? val => ({ x: val[0], y: val[1], z: val[2] }) : noop),
    ])
  }
}

export class Vec4Field extends Field<
  z.ZodObject<
    { x: z.ZodNumber; y: z.ZodNumber; z: z.ZodNumber; w: z.ZodNumber },
    'strip',
    z.ZodTypeAny,
    { x: number; y: number; z: number; w: number },
    { x: number; y: number; z: number; w: number }
  >
> {
  static type = 'vec4'
  static defaultValue = { x: 0, y: 0, z: 0, w: 0 }
  createSchema() {
    return z.looseObject({
      x: z.number(),
      y: z.number(),
      z: z.number(),
      w: z.number(),
    })
  }
}

export class CompoundPropsField extends Field<
  z.ZodObject<
    z.ZodRawShape,
    'strip',
    z.ZodUnknown,
    { [x: string]: unknown },
    { [x: string]: unknown }
  >,
  CompoundPropsFieldOptions
> {
  static type = 'compound'
  static defaultValue = {}
  fields: Record<string, Field<z.ZodTypeAny>> = {}

  createSchema({ subschema = {} }: CompoundPropsFieldOptions) {
    return z.looseObject(subschema).readonly()
  }

  get value() {
    const data = { ...this._value }
    for (const [key, field] of Object.entries(this.fields || {})) {
      data[key] = field.value
    }
    return data
  }

  constructor(fields: Record<string, Field<z.ZodTypeAny>>, options?: CompoundPropsFieldOptions) {
    const defaults = {} as Record<string, z.ZodType>
    for (const [key, field] of Object.entries(fields)) {
      defaults[key] = field.defaultValue
    }

    const subschema = {} as z.ZodRawShape
    for (const [key, field] of Object.entries(fields)) {
      subschema[key] = field.schema
    }

    const passthrough = options?.passthrough ?? true
    super(defaults, { subschema, ...options, passthrough })
    this.fields = fields

    const parentToChild = this.subscribe(value => {
      for (const [key, field] of Object.entries(fields)) {
        if (Object.hasOwn(value || {}, key)) {
          field.next(value[key])
        }
      }
    })
    this.subscriptions.set('__parentToChild', parentToChild)

    let updating = false
    const childToParent = combineLatest(fields).subscribe(values => {
      if (updating) return
      updating = true
      this.next(values)
      updating = false
    })
    this.subscriptions.set('__childToParent', childToParent)
  }

  next(parsed: ExtractProps<typeof this.fields>) {
    // if (!parsed) return
    super.next({ ...this.value, ...parsed })
    for (const [key, field] of Object.entries(this.fields || {})) {
      if (Object.hasOwn(parsed || {}, key)) {
        field.next(parsed[key])
      }
    }
  }

  addConnection<F extends IField<z.ZodType<unknown, z.ZodTypeDef, unknown>>>(
    id: string,
    field: F,
    connectionType: 'reference' | 'value' = 'value'
  ): Subscription | undefined {
    if (this.subscriptions.has(id)) {
      return
    }

    const subscription = field.subscribe(_value => {
      if (connectionType === 'value') {
        this.next(field.value)
      } else {
        this.next(this.value)
      }
    })
    this.subscriptions.set(id, subscription)
    return subscription
  }
}

// TODO: Should this be flag like `multiple`? Or should it be a separate class?
export class ListField<F extends Field> extends Field<
  z.ZodArray<F['schema']>,
  SubSchemaOptions<F['schema']>
> {
  static type = 'list'
  static defaultValue = []

  fields = new Map<string, F>()

  createSchema({ subschema }: { subschema: z.Schema<F['schema']> }) {
    return z.array(subschema)
  }

  constructor(
    public field?: F,
    options?: Partial<SubSchemaOptions<F['schema']> & BaseFieldOptions>
  ) {
    const subschema = field?.schema || z.unknown()
    super([], { subschema, ...options })
  }

  // Overrides the default setValue to handle a list of fields
  // TODO: Do we need to handle reference connections?
  addConnection(id: string, field: F, _connectionType: 'reference' | 'value' = 'value') {
    if (this.subscriptions.has(id)) {
      return
    }

    this.fields.set(id, field)

    const subscription = field.subscribe(_value => {
      this.setValue(Array.from(this.fields.values()).map(f => f.value) as F[])
    })
    this.subscriptions.set(id, subscription)
    return subscription
  }

  removeConnection(id: string, connectionType: 'reference' | 'value' = 'value'): void {
    super.removeConnection(id, connectionType)
    this.fields.delete(id)
    this.setValue(Array.from(this.fields.values()).map(f => f.value) as F[])
  }

  // Idempotently reorder connections to match orderedIds (typically the edge array order).
  // Unknown ids are ignored; connections not listed keep their relative order at the end.
  setConnectionOrder(orderedIds: string[]): void {
    const currentIds = Array.from(this.fields.keys())
    const listed = orderedIds.filter(id => this.fields.has(id))
    const unlisted = currentIds.filter(id => !orderedIds.includes(id))
    const nextIds = [...listed, ...unlisted]

    if (nextIds.every((id, i) => id === currentIds[i])) {
      return
    }

    this.fields = new Map(nextIds.map(id => [id, this.fields.get(id) as F]))
    this.setValue(Array.from(this.fields.values()).map(f => f.value) as F[])
  }
}

export class ArrayField<F extends Field> extends Field<
  z.ZodArray<F['schema']>,
  SubSchemaOptions<F['schema']>
> {
  static type = 'array'
  static defaultValue = []

  createSchema({ subschema }: { subschema: z.Schema<F['schema']> }) {
    return z.array(subschema)
  }

  constructor(
    public field: F,
    options?: BaseFieldOptions
  ) {
    super([], { ...options, subschema: field.schema })
  }
}

export class UnknownField extends Field<z.ZodUnknown> {
  static type = 'unknown'
  static defaultValue = null
  createSchema() {
    return z.unknown()
  }
}

// Should this be generic? Base class? Special case?
// Most objects in the system are POJOs, but some return class instances
export class LayerField<P extends LayerProps> extends Field<z.ZodType<P & { type: string }>> {
  static type = 'layer'
  static defaultValue = undefined

  createSchema() {
    return z.looseObject({ type: z.string().refine(value => value.includes('Layer')) })
  }
}

export class EffectField extends Field<z.ZodTypeAny> {
  static type = 'effect'
  static defaultValue = undefined
  createSchema() {
    return z.custom(() => true)
  }
}

export class WidgetField extends Field<z.ZodTypeAny> {
  static type = 'widget'
  static defaultValue = undefined
  createSchema() {
    return z.custom(() => true)
  }
}

export class ExtensionField extends Field<z.ZodTypeAny> {
  static type = 'extension'
  static defaultValue = undefined
  createSchema() {
    return z.strictObject({
      extension: z.looseObject({ type: z.string() }),
      props: z.looseObject({}),
    })
  }
}

export class ViewField extends Field<
  z.ZodType<InstanceType<View>, z.ZodTypeDef, InstanceType<View>>
> {
  static type = 'view'
  static defaultValue = undefined
  createSchema() {
    return z.instanceof(View)
  }
}

export class MapLibreLayerField extends Field<
  z.ZodType<{
    id: string
    type: 'custom'
    code: string
    renderingMode?: '2d' | '3d'
    beforeId?: string
    params?: Record<string, unknown>
  }>
> {
  static type = 'maplibre-layer'
  static defaultValue = undefined

  createSchema() {
    return z.strictObject({
      id: z.string(),
      type: z.literal('custom'),
      code: z.string(),
      renderingMode: z.enum(['2d', '3d']).optional(),
      beforeId: z.string().optional(),
      params: z.record(z.unknown()).optional(),
    })
  }
}

export class VisualizationField extends Field<
  z.ZodType<{
    deckProps: { layers: (LayerProps & { type: string })[] } & BetterDeckProps
    mapProps?: BetterMapProps
    maplibreLayers?: Array<{
      id: string
      type: 'custom'
      code: string
      renderingMode?: '2d' | '3d'
      beforeId?: string
      params?: Record<string, unknown>
    }>
  }>
> {
  static type = 'visualization'
  static defaultValue = { deckProps: {}, mapProps: undefined, maplibreLayers: [] }
  createSchema() {
    return z.looseObject({
      deckProps: z.looseObject({
        layers: z
          .array(
            z.looseObject({
              type: z.string(),
            })
          )
          .optional(),
      }),
      mapProps: z
        .looseObject({
          longitude: z.number(),
          latitude: z.number(),
          zoom: z.number(),
        })
        .optional(),
      maplibreLayers: z
        .array(
          z.strictObject({
            id: z.string(),
            type: z.literal('custom'),
            code: z.string(),
            renderingMode: z.enum(['2d', '3d']).optional(),
            beforeId: z.string().optional(),
            params: z.record(z.unknown()).optional(),
          })
        )
        .optional(),
    })
  }
}

// Handle types matching Blender's curve editor
type HandleType = 'auto' | 'vector' | 'auto-clamped' | 'free'

// Bezier curve point with control handles
type BezierPoint = {
  x: number
  y: number
  handleLeftX?: number
  handleLeftY?: number
  handleRightX?: number
  handleRightY?: number
  handleLeftType?: HandleType
  handleRightType?: HandleType
}

// Bezier curve data structure
type BezierCurveData = {
  points: BezierPoint[]
  segments: Array<{
    p0: BezierPoint
    p1: BezierPoint
  }>
}

export class BezierCurveField extends Field<z.ZodType<BezierCurveData>> {
  static type = 'bezier-curve'
  static defaultValue: BezierCurveData = {
    points: [
      { x: 0, y: 0, handleRightX: 0.3, handleRightY: 0, handleRightType: 'auto' },
      { x: 1, y: 1, handleLeftX: 0.7, handleLeftY: 1, handleLeftType: 'auto' },
    ],
    segments: [],
  }

  // Track the currently selected point for UI controls
  selectedPointIndex: number | null = null

  // Shared schema for a Bezier point
  static BezierPointSchema = z.object({
    x: z.number(),
    y: z.number(),
    handleLeftX: z.number().optional(),
    handleLeftY: z.number().optional(),
    handleRightX: z.number().optional(),
    handleRightY: z.number().optional(),
    handleLeftType: z.enum(['auto', 'vector', 'auto-clamped', 'free']).optional(),
    handleRightType: z.enum(['auto', 'vector', 'auto-clamped', 'free']).optional(),
  })

  createSchema() {
    return z.object({
      points: z.array(BezierCurveField.BezierPointSchema),
      segments: z.array(
        z.object({
          p0: BezierCurveField.BezierPointSchema,
          p1: BezierCurveField.BezierPointSchema,
        })
      ),
    })
  }

  constructor(defaultValue?: BezierCurveData, options?: BaseFieldOptions) {
    super(defaultValue || BezierCurveField.defaultValue, options)
  }

  // Evaluate the curve at a given x position (0-1)
  evaluate(x: number): number {
    const { points } = this.value
    if (points.length === 0) return 0
    if (points.length === 1) return points[0].y

    // Clamp x to [0, 1]
    const clampedX = Math.max(0, Math.min(1, x))

    // Find the segment containing this x
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i]
      const p1 = points[i + 1]

      if (clampedX >= p0.x && clampedX <= p1.x) {
        // Cubic bezier interpolation
        const t = (clampedX - p0.x) / (p1.x - p0.x)

        const _cp0x = p0.x
        const cp0y = p0.y
        const _cp1x = p0.handleRightX ?? p0.x + (p1.x - p0.x) * 0.33
        const cp1y = p0.handleRightY ?? p0.y
        const _cp2x = p1.handleLeftX ?? p1.x - (p1.x - p0.x) * 0.33
        const cp2y = p1.handleLeftY ?? p1.y
        const _cp3x = p1.x
        const cp3y = p1.y

        // Cubic bezier formula
        const y =
          Math.pow(1 - t, 3) * cp0y +
          3 * Math.pow(1 - t, 2) * t * cp1y +
          3 * (1 - t) * Math.pow(t, 2) * cp2y +
          Math.pow(t, 3) * cp3y

        return y
      }
    }

    // If x is outside the curve range, return the nearest endpoint
    return clampedX <= points[0].x ? points[0].y : points[points.length - 1].y
  }

  // Add a new point to the curve
  addPoint(x: number, y: number): void {
    const { points } = this.value
    const newPoint: BezierPoint = {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    }

    // Find the correct position to insert the point (maintain x-order)
    let insertIndex = points.length
    for (let i = 0; i < points.length; i++) {
      if (points[i].x > newPoint.x) {
        insertIndex = i
        break
      }
    }

    const newPoints = [...points]
    newPoints.splice(insertIndex, 0, newPoint)

    this.setValue({
      ...this.value,
      points: newPoints,
      segments: this.generateSegments(newPoints),
    })
  }

  // Remove a point from the curve
  removePoint(index: number): void {
    const { points } = this.value
    if (points.length <= 2 || index < 0 || index >= points.length) return

    const newPoints = points.filter((_, i) => i !== index)

    this.setValue({
      ...this.value,
      points: newPoints,
      segments: this.generateSegments(newPoints),
    })
  }

  // Update a specific point
  updatePoint(index: number, updates: Partial<BezierPoint>): void {
    const { points } = this.value
    if (index < 0 || index >= points.length) return

    const newPoints = [...points]
    newPoints[index] = { ...newPoints[index], ...updates }

    // Maintain x-order constraint
    if (updates.x !== undefined) {
      const minX = index > 0 ? points[index - 1].x : 0
      const maxX = index < points.length - 1 ? points[index + 1].x : 1
      newPoints[index].x = Math.max(minX, Math.min(maxX, newPoints[index].x))
    }

    // Clamp y values
    if (updates.y !== undefined) {
      newPoints[index].y = Math.max(0, Math.min(1, newPoints[index].y))
    }

    // Update automatic handles if position changed
    if (updates.x !== undefined || updates.y !== undefined) {
      this.updateAutomaticHandles(newPoints, index)
    }

    this.setValue({
      ...this.value,
      points: newPoints,
      segments: this.generateSegments(newPoints),
    })
  }

  // Set the selected point for UI controls
  setSelectedPoint(index: number | null): void {
    this.selectedPointIndex = index
  }

  // Get the selected point
  getSelectedPoint(): BezierPoint | null {
    if (this.selectedPointIndex === null) return null
    return this.value.points[this.selectedPointIndex] || null
  }

  // Update handle type for a specific point
  updateHandleType(index: number, side: 'left' | 'right', type: HandleType): void {
    const { points } = this.value
    if (index < 0 || index >= points.length) return

    const newPoints = [...points]
    const point = { ...newPoints[index] }

    if (side === 'left') {
      point.handleLeftType = type
    } else {
      point.handleRightType = type
    }

    newPoints[index] = point
    this.updateAutomaticHandles(newPoints, index)

    this.setValue({
      ...this.value,
      points: newPoints,
      segments: this.generateSegments(newPoints),
    })
  }

  // Update automatic handle positions based on handle types
  private updateAutomaticHandles(points: BezierPoint[], pointIndex: number): void {
    const point = points[pointIndex]
    const prevPoint = pointIndex > 0 ? points[pointIndex - 1] : null
    const nextPoint = pointIndex < points.length - 1 ? points[pointIndex + 1] : null

    // Calculate automatic handle positions
    if (point.handleLeftType === 'auto' || point.handleLeftType === 'auto-clamped') {
      if (prevPoint && nextPoint) {
        // Smooth handle based on adjacent points
        const dx = nextPoint.x - prevPoint.x
        const dy = nextPoint.y - prevPoint.y
        const length = Math.sqrt(dx * dx + dy * dy)
        const scale = (point.x - prevPoint.x) / 3 / length

        point.handleLeftX = point.x - dx * scale
        point.handleLeftY = point.y - dy * scale

        if (point.handleLeftType === 'auto-clamped') {
          // Clamp to horizontal
          point.handleLeftY = point.y
        }
      } else if (prevPoint) {
        // Simple smooth handle
        const dx = point.x - prevPoint.x
        point.handleLeftX = point.x - dx * 0.33
        point.handleLeftY = point.y
      }
    } else if (point.handleLeftType === 'vector') {
      if (prevPoint) {
        // Vector handle points directly to previous point
        const dx = prevPoint.x - point.x
        const dy = prevPoint.y - point.y
        const length = Math.sqrt(dx * dx + dy * dy)
        const scale = 0.33

        point.handleLeftX = point.x + (dx * scale) / length
        point.handleLeftY = point.y + (dy * scale) / length
      }
    }

    if (point.handleRightType === 'auto' || point.handleRightType === 'auto-clamped') {
      if (prevPoint && nextPoint) {
        // Smooth handle based on adjacent points
        const dx = nextPoint.x - prevPoint.x
        const dy = nextPoint.y - prevPoint.y
        const length = Math.sqrt(dx * dx + dy * dy)
        const scale = (nextPoint.x - point.x) / 3 / length

        point.handleRightX = point.x + dx * scale
        point.handleRightY = point.y + dy * scale

        if (point.handleRightType === 'auto-clamped') {
          // Clamp to horizontal
          point.handleRightY = point.y
        }
      } else if (nextPoint) {
        // Simple smooth handle
        const dx = nextPoint.x - point.x
        point.handleRightX = point.x + dx * 0.33
        point.handleRightY = point.y
      }
    } else if (point.handleRightType === 'vector') {
      if (nextPoint) {
        // Vector handle points directly to next point
        const dx = nextPoint.x - point.x
        const dy = nextPoint.y - point.y
        const length = Math.sqrt(dx * dx + dy * dy)
        const scale = 0.33

        point.handleRightX = point.x + (dx * scale) / length
        point.handleRightY = point.y + (dy * scale) / length
      }
    }
  }

  private generateSegments(points: BezierPoint[]): Array<{ p0: BezierPoint; p1: BezierPoint }> {
    const segments = []
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({ p0: points[i], p1: points[i + 1] })
    }
    return segments
  }
}

// Mapping of field type strings to Field class constructors
// Used for creating custom fields dynamically
// Apply a serialized value to a field, routing expression payloads ({ $expr }) to
// setExpression and everything else through the field's normal deserialize + setValue path.
// Used by project loading and undo/redo restore. Feature-detects the expression methods
// since some callers pass minimal IField implementations (e.g. test mocks).
export function applySerializedFieldValue(field: Field, value: unknown): void {
  if (isSerializedExpression(value) && typeof field.setExpression === 'function') {
    field.setExpression(value.$expr)
    return
  }
  if (typeof field.clearExpression === 'function' && field.expression != null) {
    field.clearExpression()
  }
  const ctor = field.constructor as typeof Field & { deserialize?: (value: unknown) => unknown }
  field.setValue(typeof ctor.deserialize === 'function' ? ctor.deserialize(value) : value)
}

export const fieldTypeToClass = {
  number: NumberField,
  string: StringField,
  boolean: BooleanField,
  color: ColorField,
  vec2: Vec2Field,
  vec3: Vec3Field,
  vec4: Vec4Field,
  'geopoint-2d': Point2DField,
  'geopoint-3d': Point3DField,
  bbox: BboxField,
  date: DateField,
  expression: ExpressionField,
  code: CodeField,
  'bezier-curve': BezierCurveField,
  'string-literal': StringLiteralField,
  data: DataField,
  unknown: UnknownField,
} as const satisfies Record<string, typeof Field>
