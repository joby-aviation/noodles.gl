// Theatre.js binding utilities for operator fields
// Handles two-way synchronization between operator inputs and Theatre timeline

import type { ISheet } from '@theatre/core'
import { onChange, type types } from '@theatre/core'
import type { Pointer } from '@theatre/dataverse'
import studio from '@theatre/studio'

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

function opIdToTheatreObjectName(opId: string): string {
  return opId.slice(1).split('/').join(' / ')
}

// Check if a field is Theatre-compatible (has a toTheatreProp implementation)
function isTheatreCompatible(field: Field<IField>): boolean {
  return (
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
  )
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
  const propConfig: Record<string, types.PropTypeConfig> = {}
  const fieldsToSync: Array<{ key: string; field: Field<IField> }> = []

  // Convert operator inputs to Theatre props
  for (const [key, field] of Object.entries(op.inputs)) {
    // Skip accessor functions
    if (typeof field.value === 'function') continue

    // Only bind Theatre-compatible field types
    if (!isTheatreCompatible(field)) continue

    const actualField = field instanceof ListField ? field.field : field
    if (!actualField) continue

    const theatreProp = actualField.toTheatreProp()
    if (theatreProp) {
      propConfig[key] = theatreProp
      fieldsToSync.push({ key, field: actualField })
    }
  }

  // If no theatre-compatible fields, skip
  if (Object.keys(propConfig).length === 0) return undefined

  // Create Theatre sheet object using full path to avoid naming collisions
  const theatreObjectName = opIdToTheatreObjectName(op.id)
  const sheetObj = sheet.object(theatreObjectName, propConfig)
  store.setSheetObject(op.id, sheetObj)

  // Set up two-way bindings
  for (const { key, field } of fieldsToSync) {
    const pathToProps = field.pathToProps?.slice(2) || [key] // Skip object id and par/out keys
    let updating = false

    // Theatre.js props are dynamically traversed via arbitrary keys
    let pointer: Pointer<unknown> = sheetObj.props as Pointer<unknown>
    for (const p of pathToProps) {
      pointer = (pointer as Record<string, Pointer<unknown>>)[p]
    }

    // Cache for the current Theatre pointer value, updated by the subscription below.
    // This keeps the prism "hot" and avoids cold prism warnings from val() calls.
    let lastPointerValue: unknown

    // Theatre -> Field binding (set up first to cache pointer value and keep prism hot)
    const theatreSub = onChange(pointer, (theatreValue: unknown) => {
      lastPointerValue = theatreValue
      if (op.locked.value || updating) return
      updating = true
      try {
        // Use field's fromTheatreValue method for conversion
        const fieldValue = field.fromTheatreValue(theatreValue)

        // Skip sync if fromTheatreValue returns null (e.g., CompoundPropsField)
        if (fieldValue !== null && field.value !== fieldValue && fieldValue !== undefined) {
          field.setValue(fieldValue)
        }
      } catch (e) {
        console.warn(`Error syncing Theatre to field for ${op.id}.${key}:`, e)
      }
      updating = false
    })
    untapFns.push(theatreSub)

    // Field -> Theatre binding
    const fieldSub = field.subscribe((_fieldValue: unknown) => {
      if (op.locked.value || updating) return
      updating = true
      studio.transaction(({ set }) => {
        try {
          // Skip sync for CompoundPropsField (handled by child field subscriptions)
          if (field instanceof CompoundPropsField) {
            updating = false
            return
          }

          // Use field's toTheatreValue method for conversion
          const theatreValue = field.toTheatreValue()

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

// Test helper: convert Theatre value to Field value using the field's fromTheatreValue method
export function convertTheatreToField(field: Field<IField>, theatreValue: unknown): unknown {
  return field.fromTheatreValue(theatreValue)
}
