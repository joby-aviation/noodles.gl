// Theatre.js binding utilities for operator fields
// Handles two-way synchronization between operator inputs and Theatre timeline

import type { ISheet, IShorthandProp } from '@theatre/core'
import { onChange, types } from '@theatre/core'
import type { Pointer } from '@theatre/dataverse'
import studio from '@theatre/studio'
import { Temporal } from 'temporal-polyfill'
import { isHexColor } from 'validator'

import { colorToRgba, hexToRgba, type Rgba, rgbaToHex } from '../utils/color'
import {
  BooleanField,
  ColorField,
  CompoundPropsField,
  DateField,
  type Field,
  type IField,
  ListField,
  NumberField,
  Point2DField,
  Point3DField,
  StringField,
  StringLiteralField,
  Vec2Field,
  Vec3Field,
} from './fields'
import type { IOperator, Operator } from './operators'
import { getOpStore } from './store'

// Adapter for bidirectional conversion between Field values and Theatre values.
// F = field value type, T = Theatre.js value type
export interface TheatreAdapter<F, T> {
  toTheatre(fieldValue: F): T
  fromTheatre(theatreValue: T): F
  theatreType: (defaultValue: T, field?: Field<IField>) => IShorthandProp<T>
}

// Color Adapter: hex string <-> RGBA object
const colorAdapter: TheatreAdapter<string, Rgba> = {
  toTheatre(fieldValue: string): Rgba {
    if (typeof fieldValue === 'string' && isHexColor(fieldValue)) {
      return hexToRgba(fieldValue)
    }
    if (Array.isArray(fieldValue)) {
      return colorToRgba(fieldValue as number[])
    }
    return fieldValue as unknown as Rgba
  },

  fromTheatre(theatreValue: Rgba): string {
    return rgbaToHex(theatreValue)
  },

  theatreType(defaultValue: Rgba) {
    return types.rgba(defaultValue)
  },
}

// Date Adapter: Temporal.PlainDateTime <-> epoch milliseconds
const dateAdapter: TheatreAdapter<Temporal.PlainDateTime, number> = {
  toTheatre(fieldValue: Temporal.PlainDateTime): number {
    const instant = fieldValue.toZonedDateTime('UTC').toInstant()
    return instant.epochMilliseconds
  },

  fromTheatre(theatreValue: number): Temporal.PlainDateTime {
    const epochMs = Math.round(theatreValue)
    return Temporal.Instant.fromEpochMilliseconds(epochMs)
      .toZonedDateTimeISO('UTC')
      .toPlainDateTime()
  },

  theatreType(defaultValue: number) {
    return types.number(defaultValue, { nudgeMultiplier: 1 })
  },
}

// Vec2 Adapter: object/tuple <-> compound { x, y }
type Vec2Object = { x: number; y: number }
type Vec2Input = Vec2Object | [number, number]

const vec2Adapter: TheatreAdapter<Vec2Input, Vec2Object> = {
  toTheatre(fieldValue: Vec2Input): Vec2Object {
    if ('x' in fieldValue) {
      return { x: fieldValue.x, y: fieldValue.y }
    }
    return { x: fieldValue[0], y: fieldValue[1] }
  },

  fromTheatre(theatreValue: Vec2Object): Vec2Object {
    return theatreValue
  },

  theatreType(defaultValue: Vec2Object) {
    return types.compound({
      x: types.number(defaultValue.x),
      y: types.number(defaultValue.y),
    })
  },
}

// Vec3 Adapter: object/tuple <-> compound { x, y, z }
type Vec3Object = { x: number; y: number; z: number }
type Vec3Input = Vec3Object | [number, number, number]

const vec3Adapter: TheatreAdapter<Vec3Input, Vec3Object> = {
  toTheatre(fieldValue: Vec3Input): Vec3Object {
    if ('x' in fieldValue) {
      return { x: fieldValue.x, y: fieldValue.y, z: fieldValue.z }
    }
    return { x: fieldValue[0], y: fieldValue[1], z: fieldValue[2] }
  },

  fromTheatre(theatreValue: Vec3Object): Vec3Object {
    return theatreValue
  },

  theatreType(defaultValue: Vec3Object) {
    return types.compound({
      x: types.number(defaultValue.x),
      y: types.number(defaultValue.y),
      z: types.number(defaultValue.z),
    })
  },
}

// Point2D Adapter: object/tuple <-> compound { lng, lat }
type Point2DObject = { lng: number; lat: number }
type Point2DInput = Point2DObject | [number, number]

const point2DAdapter: TheatreAdapter<Point2DInput, Point2DObject> = {
  toTheatre(fieldValue: Point2DInput): Point2DObject {
    if ('lng' in fieldValue) {
      return { lng: fieldValue.lng, lat: fieldValue.lat }
    }
    return { lng: fieldValue[0], lat: fieldValue[1] }
  },

  fromTheatre(theatreValue: Point2DObject): Point2DObject {
    return theatreValue
  },

  theatreType(defaultValue: Point2DObject) {
    return types.compound({
      lng: types.number(defaultValue.lng),
      lat: types.number(defaultValue.lat),
    })
  },
}

// Point3D Adapter: object/tuple <-> compound { lng, lat, alt }
type Point3DObject = { lng: number; lat: number; alt: number }
type Point3DInput = Point3DObject | [number, number, number]

const point3DAdapter: TheatreAdapter<Point3DInput, Point3DObject> = {
  toTheatre(fieldValue: Point3DInput): Point3DObject {
    if ('lng' in fieldValue) {
      return { lng: fieldValue.lng, lat: fieldValue.lat, alt: fieldValue.alt }
    }
    return { lng: fieldValue[0], lat: fieldValue[1], alt: fieldValue[2] }
  },

  fromTheatre(theatreValue: Point3DObject): Point3DObject {
    return theatreValue
  },

  theatreType(defaultValue: Point3DObject) {
    return types.compound({
      lng: types.number(defaultValue.lng),
      lat: types.number(defaultValue.lat),
      alt: types.number(defaultValue.alt),
    })
  },
}

// Passthrough adapters for fields that don't need type conversion
function createPassthroughAdapter<T>(
  typeFactory: (defaultValue: T, field?: Field<IField>) => IShorthandProp<T>
): TheatreAdapter<T, T> {
  return {
    toTheatre(fieldValue: T): T {
      return fieldValue
    },
    fromTheatre(theatreValue: T): T {
      return theatreValue
    },
    theatreType: typeFactory,
  }
}

const numberAdapter = createPassthroughAdapter<number>((defaultValue, field) => {
  const numField = field as NumberField | undefined
  return types.number(defaultValue, {
    range: numField ? [numField.min, numField.max] : undefined,
    nudgeMultiplier: numField?.step,
  })
})

const booleanAdapter = createPassthroughAdapter<boolean>(defaultValue =>
  types.boolean(defaultValue)
)

const stringAdapter = createPassthroughAdapter<string>(defaultValue => types.string(defaultValue))

type AdapterResult =
  | { adapter: TheatreAdapter<unknown, unknown>; theatreDefault: unknown }
  | undefined

function getAdapterForField(field: Field<IField>): AdapterResult {
  if (field instanceof ColorField) {
    return {
      adapter: colorAdapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: colorAdapter.toTheatre(field.value),
    }
  }
  if (field instanceof DateField) {
    return {
      adapter: dateAdapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: dateAdapter.toTheatre(field.value as Temporal.PlainDateTime),
    }
  }
  if (field instanceof Vec2Field) {
    return {
      adapter: vec2Adapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: vec2Adapter.toTheatre(field.value),
    }
  }
  if (field instanceof Vec3Field) {
    return {
      adapter: vec3Adapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: vec3Adapter.toTheatre(field.value),
    }
  }
  if (field instanceof Point2DField) {
    return {
      adapter: point2DAdapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: point2DAdapter.toTheatre(field.value),
    }
  }
  if (field instanceof Point3DField) {
    return {
      adapter: point3DAdapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: point3DAdapter.toTheatre(field.value),
    }
  }
  if (field instanceof NumberField) {
    return {
      adapter: numberAdapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: field.value,
    }
  }
  if (field instanceof BooleanField) {
    return {
      adapter: booleanAdapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: field.value,
    }
  }
  if (field instanceof StringField) {
    return {
      adapter: stringAdapter as TheatreAdapter<unknown, unknown>,
      theatreDefault: field.value,
    }
  }
  return undefined
}

// Recursively convert fields to Theatre props
function fieldsToTheatreProps(
  // biome-ignore lint/suspicious/noExplicitAny: Field type requires generic parameter
  fields: Record<string, Field<any>>
): Record<string, types.PropTypeConfig> {
  const props: Record<string, types.PropTypeConfig> = {}
  for (const [key, field] of Object.entries(fields)) {
    const prop = fieldToTheatreProp(field)
    if (prop) {
      props[key] = prop
    }
  }
  return props
}

function fieldToTheatreProp(field: Field<IField>): types.PropTypeConfig | undefined {
  try {
    // Handle StringLiteralField specially (needs choices)
    if (field instanceof StringLiteralField) {
      return types.stringLiteral(
        field.value,
        Object.fromEntries(field.choices.map(({ label, value }) => [label, value]))
      )
    }

    // Handle CompoundPropsField specially (recursive)
    if (field instanceof CompoundPropsField) {
      return types.compound(fieldsToTheatreProps(field.fields))
    }

    // Use adapter pattern for other field types
    const adapterResult = getAdapterForField(field)
    if (adapterResult) {
      const { adapter, theatreDefault } = adapterResult
      return adapter.theatreType(theatreDefault, field) as types.PropTypeConfig
    }
  } catch (e) {
    console.error('Error creating Theatre prop for field:', e)
  }
  return undefined
}

function opIdToTheatreObjectName(opId: string): string {
  return opId.slice(1).split('/').join(' / ')
}

type FieldBindingInfo = {
  key: string
  field: Field<IField>
  adapter: TheatreAdapter<unknown, unknown> | null
}

export function bindOperatorToTheatre(
  op: Operator<IOperator>,
  sheet: ISheet
): (() => void) | undefined {
  const store = getOpStore()

  // Skip special operators
  if (op.id === '/out') return undefined

  // Skip if already bound
  if (store.hasSheetObject(op.id)) return undefined

  const untapFns: Array<() => void> = []
  const fieldBindings: FieldBindingInfo[] = []
  const propConfig: Record<string, types.PropTypeConfig> = {}

  // Convert operator inputs to Theatre props
  for (const [key, field] of Object.entries(op.inputs)) {
    // Skip accessor functions
    if (typeof field.value === 'function') continue

    // Only bind Theatre-compatible field types
    const isCompatibleField =
      field instanceof NumberField ||
      field instanceof ColorField ||
      field instanceof DateField ||
      field instanceof BooleanField ||
      field instanceof StringField ||
      field instanceof StringLiteralField ||
      field instanceof CompoundPropsField ||
      field instanceof Vec2Field ||
      field instanceof Vec3Field ||
      field instanceof Point2DField ||
      field instanceof Point3DField ||
      field instanceof ListField

    if (!isCompatibleField) continue

    const actualField = field instanceof ListField ? field.field : field
    const theatreProp = fieldToTheatreProp(actualField)

    if (theatreProp) {
      propConfig[key] = theatreProp
      // Get the adapter for this field (null for StringLiteralField and CompoundPropsField)
      const adapterResult = getAdapterForField(actualField)
      fieldBindings.push({
        key,
        field: actualField,
        adapter: adapterResult?.adapter || null,
      })
    }
  }

  // If no theatre-compatible fields, skip
  if (Object.keys(propConfig).length === 0) return undefined

  // Create Theatre sheet object using full path to avoid naming collisions, and use theatre hierarchy
  const theatreObjectName = opIdToTheatreObjectName(op.id)
  const sheetObj = sheet.object(theatreObjectName, propConfig)
  store.setSheetObject(op.id, sheetObj)

  // Set up two-way bindings
  for (const { key, field, adapter } of fieldBindings) {
    const pathToProps = field.pathToProps?.slice(2) || [key] // Skip object id and par/out keys
    let updating = false
    // Theatre.js props are dynamically traversed via arbitrary keys,
    // so we use Pointer<unknown> and cast at usage sites
    let pointer: Pointer<unknown> = sheetObj.props as Pointer<unknown>
    for (const p of pathToProps) {
      pointer = (pointer as Record<string, Pointer<unknown>>)[p]
    }

    // Cache for the current Theatre pointer value, updated by the subscription below.
    // This keeps the prism "hot" and avoids cold prism warnings from val() calls.
    let lastPointerValue: unknown

    // Theatre -> Field binding (set up first to cache pointer value and keep prism hot)
    // biome-ignore lint/suspicious/noExplicitAny: Theatre.js values can be any type
    const theatreSub = onChange(pointer, (theatreValue: any) => {
      lastPointerValue = theatreValue
      if (op.locked.value || updating) return
      updating = true
      try {
        // Use adapter to convert Theatre value to Field value
        const fieldValue = adapter ? adapter.fromTheatre(theatreValue) : theatreValue

        if (field.value !== fieldValue && fieldValue !== undefined) {
          field.setValue(fieldValue)
        }
      } catch (e) {
        console.warn(`Error syncing Theatre to field for ${op.id}.${key}:`, e)
      }
      updating = false
    })
    untapFns.push(theatreSub)

    // Field -> Theatre binding
    // biome-ignore lint/suspicious/noExplicitAny: Field values can be any type
    const fieldSub = field.subscribe((fieldValue: any) => {
      if (op.locked.value || updating) return
      updating = true
      studio.transaction(({ set }) => {
        try {
          // Prevent infinite loop for compound props
          if (field instanceof CompoundPropsField) {
            updating = false
            return
          }

          // Use adapter to convert Field value to Theatre value
          const theatreValue = adapter ? adapter.toTheatre(fieldValue) : fieldValue

          if (lastPointerValue !== theatreValue) {
            set(pointer, theatreValue)
          }
        } catch (e) {
          console.warn(`Error syncing field to Theatre for ${op.id}.${key}:`, e)
        }
        updating = false
      })
    })
    untapFns.push(() => fieldSub.unsubscribe())
  }

  // Return cleanup function
  return () => {
    for (const untap of untapFns) {
      untap()
    }
    sheet.detachObject(theatreObjectName)
    store.deleteSheetObject(op.id)
  }
}

export function unbindOperatorFromTheatre(opId: string, sheet: ISheet): void {
  const store = getOpStore()
  const sheetObj = store.getSheetObject(opId)
  if (sheetObj) {
    const theatreObjectName = opIdToTheatreObjectName(opId)
    sheet.detachObject(theatreObjectName)
    store.deleteSheetObject(opId)
  }
}

export function bindAllOperatorsToTheatre(
  operators: Operator<IOperator>[],
  sheet: ISheet
): Map<string, () => void> {
  const cleanupFns = new Map<string, () => void>()

  for (const op of operators) {
    const cleanup = bindOperatorToTheatre(op, sheet)
    if (cleanup) {
      cleanupFns.set(op.id, cleanup)
    }
  }

  return cleanupFns
}

export function cleanupRemovedOperators(currentOperatorIds: Set<string>, sheet: ISheet): void {
  const store = getOpStore()

  // Find operators that have sheet objects
  for (const op of store.getAllOps()) {
    if (store.hasSheetObject(op.id) && !currentOperatorIds.has(op.id)) {
      unbindOperatorFromTheatre(op.id, sheet)
    }
  }
}
