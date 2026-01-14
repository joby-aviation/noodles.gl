// Theatre.js binding utilities for operator fields
// Handles two-way synchronization between operator inputs and Theatre timeline

import type { ISheet } from '@theatre/core'
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

// Helper to recursively convert fields to Theatre props
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

// Convert a field to a Theatre prop config
function fieldToTheatreProp(field: Field<IField>): types.PropTypeConfig | undefined {
  try {
    if (field instanceof NumberField) {
      return types.number(field.value, {
        range: [field.min, field.max],
        nudgeMultiplier: field.step,
      })
    }
    if (field instanceof BooleanField) {
      return types.boolean(field.value)
    }
    if (field instanceof StringField) {
      return types.string(field.value)
    }
    if (field instanceof StringLiteralField) {
      return types.stringLiteral(
        field.value,
        Object.fromEntries(field.choices.map(({ label, value }) => [label, value]))
      )
    }
    if (field instanceof ColorField) {
      const colorValue =
        typeof field.value === 'string' && isHexColor(field.value)
          ? hexToRgba(field.value)
          : Array.isArray(field.value)
            ? colorToRgba(field.value)
            : field.value
      return types.rgba(colorValue as Rgba)
    }
    if (field instanceof DateField) {
      const instant = (field.value as unknown as Temporal.PlainDateTime)
        .toZonedDateTime('UTC')
        .toInstant()
      return types.number(instant.epochMilliseconds, {
        nudgeMultiplier: 1,
      })
    }
    if (field instanceof Vec2Field) {
      const v = field.value
      return types.compound({
        x: types.number('x' in v ? v.x : v[0]),
        y: types.number('y' in v ? v.y : v[1]),
      })
    }
    if (field instanceof Vec3Field) {
      const v = field.value
      return types.compound({
        x: types.number('x' in v ? v.x : (v as [number, number, number])[0]),
        y: types.number('y' in v ? v.y : (v as [number, number, number])[1]),
        z: types.number('z' in v ? v.z : (v as [number, number, number])[2]),
      })
    }
    if (field instanceof Point2DField) {
      const v = field.value
      return types.compound({
        lng: types.number('lng' in v ? v.lng : v[0]),
        lat: types.number('lat' in v ? v.lat : v[1]),
      })
    }
    if (field instanceof Point3DField) {
      const v = field.value
      return types.compound({
        lng: types.number('lng' in v ? v.lng : (v as [number, number, number])[0]),
        lat: types.number('lat' in v ? v.lat : (v as [number, number, number])[1]),
        alt: types.number('alt' in v ? v.alt : (v as [number, number, number])[2]),
      })
    }
    if (field instanceof CompoundPropsField) {
      // Recursively handle nested fields using helper
      return types.compound(fieldsToTheatreProps(field.fields))
    }
  } catch (e) {
    console.error('Error creating Theatre prop for field:', e)
  }
  return undefined
}

function opIdToTheatreObjectName(opId: string): string {
  return opId.slice(1).split('/').join(' / ')
}

// Create Theatre bindings for an operator
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
  const fields: Array<[string, Field<IField>]> = []
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
      fields.push([key, actualField])
    }
  }

  // If no theatre-compatible fields, skip
  if (Object.keys(propConfig).length === 0) return undefined

  // Create Theatre sheet object using full path to avoid naming collisions, and use theatre hierarchy
  const theatreObjectName = opIdToTheatreObjectName(op.id)
  const sheetObj = sheet.object(theatreObjectName, propConfig)
  store.setSheetObject(op.id, sheetObj)

  // Set up two-way bindings
  for (const [key, field] of fields) {
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
    const theatreSub = onChange(pointer, (value_: any) => {
      lastPointerValue = value_
      if (op.locked.value || updating) return
      updating = true
      try {
        let value = value_
        if (field instanceof ColorField) {
          value = rgbaToHex(value_)
        } else if (field instanceof DateField) {
          const epochMs = Math.round(value_ as unknown as number)
          value = Temporal.Instant.fromEpochMilliseconds(epochMs)
            .toZonedDateTimeISO('UTC')
            .toPlainDateTime()
        }

        if (field.value !== value && value !== undefined) {
          field.setValue(value)
        }
      } catch (e) {
        console.warn(`Error syncing Theatre to field for ${op.id}.${key}:`, e)
      }
      updating = false
    })
    untapFns.push(theatreSub)

    // Field -> Theatre binding
    // biome-ignore lint/suspicious/noExplicitAny: Field values can be any type
    const fieldSub = field.subscribe((value_: any) => {
      if (op.locked.value || updating) return
      updating = true
      studio.transaction(({ set }) => {
        try {
          let value = value_
          if (field instanceof ColorField) {
            value =
              typeof value_ === 'string' && isHexColor(value_)
                ? hexToRgba(value_)
                : Array.isArray(value_)
                  ? colorToRgba(value_)
                  : value_
          } else if (field instanceof DateField) {
            const instant = (value_ as unknown as Temporal.PlainDateTime)
              .toZonedDateTime('UTC')
              .toInstant()
            value = instant.epochMilliseconds
          }

          // Prevent infinite loop for compound props
          if (field instanceof CompoundPropsField) {
            updating = false
            return
          }

          if (lastPointerValue !== value) {
            set(pointer, value)
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

// Unbind an operator from Theatre
export function unbindOperatorFromTheatre(opId: string, sheet: ISheet): void {
  const store = getOpStore()
  const sheetObj = store.getSheetObject(opId)
  if (sheetObj) {
    const theatreObjectName = opIdToTheatreObjectName(opId)
    sheet.detachObject(theatreObjectName)
    store.deleteSheetObject(opId)
  }
}

// Bind all operators in opMap to Theatre
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

// Cleanup removed operators from Theatre
export function cleanupRemovedOperators(currentOperatorIds: Set<string>, sheet: ISheet): void {
  const store = getOpStore()

  // Find operators that have sheet objects
  for (const op of store.getAllOps()) {
    if (store.hasSheetObject(op.id) && !currentOperatorIds.has(op.id)) {
      unbindOperatorFromTheatre(op.id, sheet)
    }
  }
}
