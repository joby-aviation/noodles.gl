// Field bindings for the native timeline system
// Handles two-way synchronization between operator fields and timeline tracks

import { Temporal } from 'temporal-polyfill'
import { isHexColor } from 'validator'

import {
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
} from '../noodles/fields'
import type { IOperator, Operator } from '../noodles/operators'
import { type RGBA as ColorRGBA, colorToRgba, hexToRgba, rgbaToHex } from '../utils/color'
import type { TimelineStore } from './timeline-store'
import { useTimelineStore } from './timeline-store'
import type { KeyframeValue, Point2D, Point3D, RGBA, Vec2, Vec3 } from './types'

// Use a type alias to simplify field typing
// biome-ignore lint/suspicious/noExplicitAny: Field type requires generic parameter
type AnyField = Field<any>

// ============================================================================
// Type Guards
// ============================================================================

// Check if a field type can be animated
export function isAnimatableField(field: AnyField): boolean {
  return (
    field instanceof NumberField ||
    field instanceof BooleanField ||
    field instanceof StringField ||
    field instanceof StringLiteralField ||
    field instanceof ColorField ||
    field instanceof DateField ||
    field instanceof Vec2Field ||
    field instanceof Vec3Field ||
    field instanceof Point2DField ||
    field instanceof Point3DField ||
    field instanceof CompoundPropsField ||
    field instanceof ListField
  )
}

// ============================================================================
// Type Conversions
// ============================================================================

// Convert a field value to a keyframe value
export function fieldValueToKeyframeValue(
  field: AnyField,
  // biome-ignore lint/suspicious/noExplicitAny: Field values can be any type
  value: any
): KeyframeValue {
  // Number field - direct passthrough
  if (field instanceof NumberField) {
    return value as number
  }

  // Boolean field - direct passthrough
  if (field instanceof BooleanField) {
    return value as boolean
  }

  // String fields - direct passthrough
  if (field instanceof StringField || field instanceof StringLiteralField) {
    return value as string
  }

  // Color field - hex to RGBA (0-1 range)
  if (field instanceof ColorField) {
    if (typeof value === 'string' && isHexColor(value)) {
      return hexToRgba(value) as RGBA
    }
    if (Array.isArray(value)) {
      return colorToRgba(value) as RGBA
    }
    return value as RGBA
  }

  // Date field - Temporal to epoch milliseconds
  if (field instanceof DateField) {
    if (
      value instanceof Temporal.PlainDateTime ||
      (value && typeof value.toZonedDateTime === 'function')
    ) {
      const instant = (value as Temporal.PlainDateTime).toZonedDateTime('UTC').toInstant()
      return instant.epochMilliseconds
    }
    return value as number
  }

  // Vec2 field - normalize to object format
  if (field instanceof Vec2Field) {
    if (Array.isArray(value)) {
      return { x: value[0], y: value[1] } as Vec2
    }
    return { x: value.x, y: value.y } as Vec2
  }

  // Vec3 field - normalize to object format
  if (field instanceof Vec3Field) {
    if (Array.isArray(value)) {
      return { x: value[0], y: value[1], z: value[2] } as Vec3
    }
    return { x: value.x, y: value.y, z: value.z } as Vec3
  }

  // Point2D field - normalize to object format
  if (field instanceof Point2DField) {
    if (Array.isArray(value)) {
      return { lng: value[0], lat: value[1] } as Point2D
    }
    return { lng: value.lng, lat: value.lat } as Point2D
  }

  // Point3D field - normalize to object format
  if (field instanceof Point3DField) {
    if (Array.isArray(value)) {
      return { lng: value[0], lat: value[1], alt: value[2] } as Point3D
    }
    return { lng: value.lng, lat: value.lat, alt: value.alt } as Point3D
  }

  // Compound field - recursive conversion
  if (field instanceof CompoundPropsField) {
    const result: Record<string, KeyframeValue> = {}
    for (const [key, subField] of Object.entries(field.fields)) {
      if (value && key in value) {
        result[key] = fieldValueToKeyframeValue(subField as AnyField, value[key])
      }
    }
    return result
  }

  // Default: return as-is
  return value
}

// Convert a keyframe value back to a field value
export function keyframeValueToFieldValue(
  field: AnyField,
  kfValue: KeyframeValue
  // biome-ignore lint/suspicious/noExplicitAny: Field values can be any type
): any {
  // Number field - direct passthrough
  if (field instanceof NumberField) {
    return kfValue as number
  }

  // Boolean field - direct passthrough
  if (field instanceof BooleanField) {
    return kfValue as boolean
  }

  // String fields - direct passthrough
  if (field instanceof StringField || field instanceof StringLiteralField) {
    return kfValue as string
  }

  // Color field - RGBA to hex
  if (field instanceof ColorField) {
    const rgba = kfValue as RGBA
    return rgbaToHex(rgba as ColorRGBA)
  }

  // Date field - epoch milliseconds to Temporal
  if (field instanceof DateField) {
    const epochMs = Math.round(kfValue as number)
    return Temporal.Instant.fromEpochMilliseconds(epochMs)
      .toZonedDateTimeISO('UTC')
      .toPlainDateTime()
  }

  // Vec2/Vec3/Point fields - return as object (fields accept both)
  if (
    field instanceof Vec2Field ||
    field instanceof Vec3Field ||
    field instanceof Point2DField ||
    field instanceof Point3DField
  ) {
    return kfValue
  }

  // Compound field - recursive conversion
  if (field instanceof CompoundPropsField) {
    const kfObj = kfValue as Record<string, KeyframeValue>
    const result: Record<string, unknown> = {}
    for (const [key, subField] of Object.entries(field.fields)) {
      if (key in kfObj) {
        result[key] = keyframeValueToFieldValue(subField as AnyField, kfObj[key])
      }
    }
    return result
  }

  // Default: return as-is
  return kfValue
}

// Get the default keyframe value for a field
export function getFieldDefaultKeyframeValue(field: AnyField): KeyframeValue {
  return fieldValueToKeyframeValue(field, field.value)
}

// ============================================================================
// Path Utilities
// ============================================================================

// Convert operator ID to Theatre.js object name format
// "/my-operator" -> "my-operator", "/container/nested" -> "container / nested"
export function opIdToObjectName(opId: string): string {
  return opId.slice(1).split('/').join(' / ')
}

// Build the field path for timeline track
// Uses Theatre.js format: "objectName / fieldName / subField"
export function getFieldPath(opId: string, fieldName: string, subPath?: string[]): string {
  const objectName = opIdToObjectName(opId)
  const parts = [objectName, fieldName, ...(subPath || [])]
  return parts.join(' / ')
}

// ============================================================================
// Binding Management
// ============================================================================

// Track active bindings for cleanup
const activeBindings = new Map<string, () => void>()

// Bind a single field to the timeline
// Sets up two-way synchronization between field and timeline track, returns cleanup function
export function bindFieldToTimeline(
  op: Operator<IOperator>,
  fieldName: string,
  field: AnyField,
  store?: TimelineStore
): () => void {
  const timelineStore = store || useTimelineStore.getState()
  const fieldPath = getFieldPath(op.id, fieldName)

  // Track binding state to prevent infinite loops
  let updating = false

  // Cache for last known keyframe value
  let lastKeyframeValue: KeyframeValue | undefined

  // Get or create track for this field
  const defaultValue = getFieldDefaultKeyframeValue(field)
  timelineStore.getOrCreateTrack(fieldPath, defaultValue)

  // Subscribe to timeline position changes -> update field
  const unsubscribePosition = useTimelineStore.subscribe(
    state => state.position,
    () => {
      if (op.locked?.value || updating) return

      const value = timelineStore.evaluateTrack(fieldPath)
      if (value === undefined) return

      // Skip if value hasn't changed
      if (
        lastKeyframeValue !== undefined &&
        JSON.stringify(value) === JSON.stringify(lastKeyframeValue)
      ) {
        return
      }
      lastKeyframeValue = value

      updating = true
      try {
        const fieldValue = keyframeValueToFieldValue(field, value)
        if (field.value !== fieldValue && fieldValue !== undefined) {
          field.setValue(fieldValue)
        }
      } catch (e) {
        console.warn(`Error syncing timeline to field for ${op.id}.${fieldName}:`, e)
      }
      updating = false
    }
  )

  // Subscribe to field value changes -> update or create keyframe
  const fieldSub = field.subscribe((value_: unknown) => {
    if (op.locked?.value || updating) return

    // Skip compound field updates to avoid infinite loops
    if (field instanceof CompoundPropsField) {
      return
    }

    updating = true
    try {
      const kfValue = fieldValueToKeyframeValue(field, value_)

      // Check if there's a keyframe at the current position
      const track = timelineStore.getTrack(fieldPath)
      const position = timelineStore.position
      const epsilon = 0.001

      const existingKf = track?.keyframes.find(kf => Math.abs(kf.position - position) < epsilon)

      if (existingKf) {
        // Update existing keyframe
        if (JSON.stringify(existingKf.value) !== JSON.stringify(kfValue)) {
          timelineStore.updateKeyframe(fieldPath, existingKf.id, { value: kfValue })
        }
      } else if (track && track.keyframes.length > 0) {
        // If track already has keyframes, create a new keyframe at current position
        // This enables animation editing workflow - once a field is animated,
        // changing values automatically creates keyframes
        timelineStore.addKeyframe(fieldPath, {
          position,
          value: kfValue,
          interpolation: 'bezier',
        })
      }
      // Note: If track has no keyframes, we don't auto-create
      // User should explicitly click the keyframe indicator to start animating

      lastKeyframeValue = kfValue
    } catch (e) {
      console.warn(`Error syncing field to timeline for ${op.id}.${fieldName}:`, e)
    }
    updating = false
  })

  // Return cleanup function
  return () => {
    unsubscribePosition()
    fieldSub.unsubscribe()
  }
}

// Bind all animatable fields for an operator to the timeline, returns cleanup function
export function bindOperatorToTimeline(op: Operator<IOperator>, store?: TimelineStore): () => void {
  const cleanupFns: Array<() => void> = []

  for (const [fieldName, field] of Object.entries(op.inputs)) {
    // Skip non-animatable fields
    if (typeof field.value === 'function') continue
    if (!isAnimatableField(field as AnyField)) continue

    // For ListField, bind the inner field
    const actualField = field instanceof ListField ? field.field : field

    const cleanup = bindFieldToTimeline(op, fieldName, actualField as AnyField, store)
    cleanupFns.push(cleanup)

    // Track binding for later cleanup
    const bindingKey = `${op.id}.${fieldName}`
    activeBindings.set(bindingKey, cleanup)
  }

  return () => {
    for (const cleanup of cleanupFns) {
      cleanup()
    }
  }
}

// Unbind an operator from the timeline
export function unbindOperatorFromTimeline(opId: string): void {
  // Find and remove all bindings for this operator
  const keysToRemove: string[] = []
  for (const [key, cleanup] of activeBindings) {
    if (key.startsWith(`${opId}.`)) {
      cleanup()
      keysToRemove.push(key)
    }
  }
  for (const key of keysToRemove) {
    activeBindings.delete(key)
  }
}

// Bind all operators to the timeline, returns map of cleanup functions by operator ID
export function bindAllOperatorsToTimeline(
  operators: Operator<IOperator>[],
  store?: TimelineStore
): Map<string, () => void> {
  const cleanupFns = new Map<string, () => void>()

  for (const op of operators) {
    // Skip special operators
    if (op.id === '/out') continue

    const cleanup = bindOperatorToTimeline(op, store)
    cleanupFns.set(op.id, cleanup)
  }

  return cleanupFns
}

// Cleanup bindings for removed operators
export function cleanupRemovedOperators(
  currentOperatorIds: Set<string>,
  _store?: TimelineStore
): void {
  const keysToRemove: string[] = []

  for (const [key, cleanup] of activeBindings) {
    const opId = key.split('.')[0]
    if (!currentOperatorIds.has(`/${opId}`)) {
      cleanup()
      keysToRemove.push(key)
    }
  }

  for (const key of keysToRemove) {
    activeBindings.delete(key)
  }
}

// Clear all bindings (for cleanup on unmount)
export function clearAllBindings(): void {
  for (const cleanup of activeBindings.values()) {
    cleanup()
  }
  activeBindings.clear()
}
