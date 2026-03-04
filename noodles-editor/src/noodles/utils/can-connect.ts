import type z from 'zod/v4'
import { type Field, ListField, UnknownField } from '../fields'

export type ConnectionValidationResult = {
  valid: boolean
  severity?: 'error' | 'warning'
  error?: string
}

// Format a Zod issue into a human-readable message
// The error callback in safeParse overrides issue.message, so we construct messages from properties
function formatZodIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return `Expected ${issue.expected}, received ${issue.received}`
    case 'too_big':
      return `Number must be ${issue.inclusive ? '<=' : '<'} ${issue.maximum}`
    case 'too_small':
      return `Number must be ${issue.inclusive ? '>=' : '>'} ${issue.minimum}`
    case 'invalid_string':
      return `Invalid string: ${issue.validation}`
    case 'custom':
      return issue.message || 'Custom validation failed'
    default:
      return issue.message || `Validation failed (${issue.code})`
  }
}

type ZodDef = {
  type: string
  innerType?: z.ZodType
  schema?: z.ZodType
  element?: z.ZodType
  shape?: Record<string, z.ZodType>
  options?: z.ZodType[]
  items?: z.ZodType[]
}

const WRAPPER_TYPES = new Set([
  'optional',
  'nullable',
  'readonly',
  'default',
  'transform',
  'catch',
  'pipe',
])

// Unwrap wrapper types to get the underlying schema
function unwrapSchema(schema: z.ZodType): z.ZodType {
  let current = schema
  // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
  let def = (current as any)._zod.def as ZodDef
  while (WRAPPER_TYPES.has(def.type)) {
    const inner = def.innerType ?? def.schema
    if (!inner) break
    current = inner
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
    def = (current as any)._zod.def as ZodDef
  }
  return current
}

// Check if source schema is structurally compatible with target schema
export function schemasAreCompatible(from: z.ZodType, to: z.ZodType): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
  const fromDef = (unwrapSchema(from) as any)._zod.def as ZodDef
  // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
  const toDef = (unwrapSchema(to) as any)._zod.def as ZodDef

  // z.unknown() accepts anything
  if (toDef.type === 'unknown') return true
  // z.unknown() can produce anything — optimistically allow
  if (fromDef.type === 'unknown') return true

  // If target is a union and source is NOT a union, check if source is compatible with any option
  if (toDef.type === 'union' && fromDef.type !== 'union' && toDef.options) {
    return toDef.options.some(toOpt => schemasAreCompatible(from, toOpt))
  }

  // Handle literal types — string is compatible with literal<string>, etc.
  // In Zod v4, literal value is stored in `values` (array)
  if (toDef.type === 'literal') {
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
    const literalValues = (toDef as any).values as unknown[]
    if (!literalValues || literalValues.length === 0) return false
    const expectedType = typeof literalValues[0]
    return fromDef.type === expectedType
  }

  // Different base types are incompatible
  if (fromDef.type !== toDef.type) return false

  switch (fromDef.type) {
    case 'array':
      if (!fromDef.element || !toDef.element) return true
      return schemasAreCompatible(fromDef.element, toDef.element)

    case 'object':
    case 'looseObject':
    case 'strictObject':
      // All required properties in target must exist in source with compatible types
      if (!toDef.shape) return true
      for (const [key, toSchema] of Object.entries(toDef.shape)) {
        const fromSchema = fromDef.shape?.[key]
        if (!fromSchema) return false
        if (!schemasAreCompatible(fromSchema, toSchema)) return false
      }
      return true

    case 'union':
      if (!fromDef.options || !toDef.options) return true
      // Every option in source must be compatible with at least one option in target
      return fromDef.options.every(fromOpt =>
        toDef.options!.some(toOpt => schemasAreCompatible(fromOpt, toOpt))
      )

    case 'tuple':
      if (!fromDef.items || !toDef.items) return true
      if (fromDef.items.length !== toDef.items.length) return false
      return fromDef.items.every((fromItem, i) =>
        schemasAreCompatible(fromItem, toDef.items![i])
      )

    default:
      // Primitives with same type are compatible
      return true
  }
}

// Validates if two fields can be connected using structural schema comparison
export function validateConnection(from: Field, to: Field): ConnectionValidationResult {
  // UnknownField can connect to anything
  if (from instanceof UnknownField) {
    return { valid: true }
  }

  const fromSchema = from.schema
  const toSchema = to instanceof ListField ? to.schema.unwrap() : to.schema

  // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
  const fromType = (unwrapSchema(fromSchema) as any)._zod.def.type

  // Structural type check
  if (!schemasAreCompatible(fromSchema, toSchema)) {
    const fromFieldType = (from.constructor as typeof Field).type
    const toFieldType = (to.constructor as typeof Field).type
    return {
      valid: false,
      severity: 'error',
      error: `Type mismatch: ${fromFieldType} cannot connect to ${toFieldType}`,
    }
  }

  // Skip constraint validation for unknown schemas — they're optimistically compatible
  // with anything, so value-level checking doesn't make sense
  if (fromType === 'unknown') {
    return { valid: true }
  }

  // Types are compatible — check value constraints if value is available
  if (from.value !== undefined) {
    const result = toSchema.safeParse(from.value, {
      error: _iss => from.pathToProps.join('.'),
    })
    if (!result.success) {
      const issueMessages = result.error.issues.map(formatZodIssue).join(', ')
      // Types match but value fails constraints (min/max/etc) — this is a warning
      return {
        valid: false,
        severity: 'warning',
        error: `Constraint violation: ${issueMessages}`,
      }
    }
  }

  return { valid: true }
}

// Legacy function for backward compatibility - returns boolean only
export function canConnect(from: Field, to: Field): boolean {
  return validateConnection(from, to).valid
}
