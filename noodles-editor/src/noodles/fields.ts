import { assert, type LayerProps, View } from '@deck.gl/core'
import { interpolateLab, scaleOrdinal, schemeAccent } from 'd3'
import { BehaviorSubject, combineLatest, type Subscription } from 'rxjs'
import { isHexColor } from 'validator'
import z from 'zod/v4'
import { colorToHex } from '../utils/color'
import type { BetterDeckProps, BetterMapProps } from '../visualizations'
import type { inputComponents } from './components/field-components'
import type { IOperator, Operator } from './operators'
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
  step: number
}

type CompoundPropsFieldOptions = BaseFieldOptions &
  Partial<{
    passthrough: boolean
    subschema: z.ZodRawShape
  }>

type StringLiteralFieldOptions = BaseFieldOptions & {
  values: string[] | Record<string, unknown> | { value: unknown; label: string }[]
}

type CodeFieldOptions = BaseFieldOptions & {
  language?: 'javascript' | 'json' | 'sql'
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

  // Hold a reference to the operator that owns this field. Only used for debugging at the moment.
  op!: Operator<IOperator>

  subscriptions = new Map<string, Subscription>()

  // Allows this field to be used with Theatre, and debugging with zod
  pathToProps: string[] = []

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
  enhanceSchema({ accessor, optional, transform }: Partial<O>) {
    let schema = this.schema

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
    const parsed = this.schema.safeParse(value, {
      reportInput: true,
      error: _iss => this.pathToProps.join('.'),
    })
    if (parsed.success) {
      this.next(parsed.data)
    } else {
      console.warn('Parse error', parsed.error.issues)
      // console.trace()
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
      } else {
        this.next(this.value)
      }
    })
    this.subscriptions.set(id, subscription)
    return subscription
  }

  removeConnection(id: string, connectionType: 'reference' | 'value' = 'value') {
    if (
      connectionType === 'value' &&
      (this instanceof DataField || this instanceof ExpressionField || this instanceof CodeField)
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

export class FileField extends Field<
  z.ZodUnion<
    readonly [
      z.ZodString,
      z.ZodPipe<
        z.ZodObject<{ id: z.ZodString; type: z.ZodLiteral<'file'> }, z.core.$strict>,
        z.ZodTransform<string, { id: string; type: 'file' }>
      >,
    ]
  >
> {
  static type = 'file'
  static defaultValue = ''
  createSchema() {
    return z.union([
      z.string(),
      z
        .object({
          id: z.string(),
          type: z.literal('file'),
        })
        .transform(val => val.id),
    ])
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
// Function-style references: op('/path/to/operator').out.val
export const fnRe = new RegExp(
  `op\\('(?<opId>${OPERATOR_ID_PATTERN})'\\)\\.(?<inOut>par|out)\\.(?<fieldPath>[\\w-.]+)`,
  'g'
)

export function getFieldReferences(text: string, thisOpId?: string) {
  const fieldReferences = new Map<string, FieldReference>()
  for (const { groups } of [...text.matchAll(mustacheRe), ...text.matchAll(fnRe)]) {
    const fieldPath = groups?.fieldPath.split('.')[0]
    const opId = thisOpId ? resolvePath(groups?.opId || '', thisOpId) : groups?.opId
    const inOut = groups?.inOut as InOut

    if (!groups || !opId || !fieldPath) {
      console.warn(`Invalid operator ID or field path: ${opId}`)
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
  language: 'javascript' | 'sql' | 'json' = 'javascript'

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
  createSchema(options: Partial<StringLiteralFieldOptions>) {
    const values = (options.values || []) as StringLiteralOption[]
    // TODO: use zod enum? transform StringLiteralOption input type to string?
    return values.length > 0
      ? z.union(values.map(({ value }: StringLiteralOption) => z.literal(value)))
      : z.string()
  }

  constructor(
    override?: string,
    opts?: Partial<StringLiteralFieldOptions> | StringLiteralOption[] | string[]
  ) {
    const choices = parseChoices(opts)
    super(override, { ...(Array.isArray(opts) ? {} : opts), values: choices })
    this.choices = choices
  }

  updateChoices(opts: Partial<StringLiteralFieldOptions> | StringLiteralOption[] | string[]) {
    const choices = parseChoices(opts)
    this.choices = choices
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
  step: number

  createSchema(options: NumberFieldOptions) {
    const schema = z.number().min(options.min).max(options.max)
    // .step(opts.step) // Requires that the value is a multiple of the step

    return schema
  }

  constructor(override?: number, options?: Partial<NumberFieldOptions>) {
    const opts = { min: -Infinity, max: Infinity, step: 0.1, ...options }
    super(override, opts)
    this.min = opts.min
    this.max = opts.max
    this.step = opts.step
  }
}

// TODO: decide on storage and serialization format
// How to convert to and from hex, rgb, hsl, deck [r,g,b,a] etc.
export class ColorField extends Field<z.ZodString> {
  static type = 'color'
  static defaultValue = '#0000ff'
  createSchema() {
    return z.string().refine(val => isHexColor(val))
  }
  serialize(): string {
    if (Array.isArray(this.value)) {
      // Convert to hex
      return colorToHex(this.value)
    }
    // Assume string
    return this.value
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

export class DateField extends Field<z.ZodUnion<[z.ZodDate, z.ZodISODateTime]>> {
  static type = 'date'
  static defaultValue = new Date()
  createSchema() {
    return z.union([
      z.date(),
      // Parse string date from project files
      z.iso.datetime({ offset: true, local: true }),
    ])
  }
  static deserialize(value: string) {
    return new Date(value)
  }
}

// Mostly serves as a hint to the UI to render the correct colors, but could be used to validate schemas in the future
export class DataField<D extends Field> extends Field<
  z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>> | z.ZodUnknown,
  SubSchemaOptions<D['schema']>
> {
  static type = 'data'
  static defaultValue = []
  createSchema({ subschema }: { subschema: z.Schema<D['schema']> }) {
    return subschema.readonly()
  }
  constructor(public field?: D) {
    const subschema = field?.schema || z.unknown()
    const defaultValue = typeof field?.defaultValue !== 'undefined' ? field.defaultValue : []
    super(defaultValue, { subschema })
  }
}

export class JSONUrlField extends Field<z.ZodUnion<readonly [z.ZodURL, z.ZodJSONSchema]>> {
  static type = 'json-url'
  static defaultValue = ''
  createSchema(_options?: Partial<BaseFieldOptions>) {
    return z.union([z.url(), z.json()])
  }
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

  returnType: 'object' | 'tuple' = 'object'

  constructor(override?: Point3DFieldValue, options?: PointFieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
  }

  createSchema({ returnType }: PointFieldOptions = { returnType: 'object' }) {
    const noop = (val: unknown) => val
    return z.union([
      z
        .looseObject({
          lng: z.number(),
          lat: z.number(),
          alt: z.number(),
        })
        .transform(returnType === 'tuple' ? val => [val.lng, val.lat, val.alt] : noop),
      z
        .looseObject({
          lng: z.number(),
          lat: z.number(),
        })
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

  returnType: 'object' | 'tuple' = 'object'

  constructor(override?: Point2DFieldValue, options?: PointFieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
  }

  createSchema({ returnType }: PointFieldOptions = { returnType: 'object' }) {
    const noop = (val: unknown) => val
    return z.union([
      z
        .looseObject({
          lng: z.number(),
          lat: z.number(),
        })
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
  returnType: 'object' | 'tuple' = 'object'
  constructor(override?: Vec2FieldOverride, options?: Vec2FieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
  }
  createSchema({ returnType }: Vec2FieldOptions = { returnType: 'object' }) {
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
  returnType: 'object' | 'tuple' = 'object'
  constructor(override?: Vec3FieldOverride, options?: Vec2FieldOptions) {
    super(override, options)
    this.returnType = options?.returnType || 'object'
  }
  createSchema({ returnType }: Vec2FieldOptions = { returnType: 'object' }) {
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

  createSchema({ subschema = {}, passthrough = false }: CompoundPropsFieldOptions) {
    let schema = z.object(subschema)
    if (passthrough) {
      schema = schema.passthrough()
    }
    return schema
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

    super(defaults, { subschema, ...options })
    this.fields = fields

    let updating = false

    this.subscribe(value => {
      if (updating) return
      updating = true
      for (const [key, field] of Object.entries(fields)) {
        if (Object.hasOwn(value || {}, key)) {
          field.next(value[key])
        }
      }
      updating = false
    })

    combineLatest(fields).subscribe(values => {
      if (updating) return
      updating = true
      this.next(values)
      updating = false
    })
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

  constructor(public field?: F) {
    const subschema = field?.schema || z.unknown()
    super([], { subschema })
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

  reorderInputs(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) {
      return
    }
    const fields = Array.from(this.fields.entries())

    assert(fromIndex >= 0 && fromIndex < fields.length, 'fromIndex is out of bounds')
    assert(toIndex >= 0 && toIndex < fields.length, 'toIndex is out of bounds')

    const [movedField] = fields.splice(fromIndex, 1)
    fields.splice(toIndex, 0, movedField)
    this.fields = new Map(fields)
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

export class VisualizationField extends Field<
  z.ZodType<{
    deckProps: { layers: (LayerProps & { type: string })[] } & BetterDeckProps
    mapProps?: BetterMapProps
  }>
> {
  static type = 'visualization'
  static defaultValue = { deckProps: {}, mapProps: undefined }
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
    x = Math.max(0, Math.min(1, x))

    // Find the segment containing this x
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i]
      const p1 = points[i + 1]

      if (x >= p0.x && x <= p1.x) {
        // Cubic bezier interpolation
        const t = (x - p0.x) / (p1.x - p0.x)

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
    return x <= points[0].x ? points[0].y : points[points.length - 1].y
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
