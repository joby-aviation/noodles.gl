import type z from 'zod/v4'
import { type Field, ListField, UnknownField } from '../fields'
import { debugConnect } from '../../utils/debug'

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
  in?: z.ZodType // ZodPipe input schema (Zod v4 uses def.in, not def.innerType)
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
    const inner = def.innerType ?? def.schema ?? def.in
    if (!inner) break
    current = inner
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
    def = (current as any)._zod.def as ZodDef
  }
  return current
}

// Check if source schema is structurally compatible with target schema
export function schemasAreCompatible(
  from: z.ZodType,
  to: z.ZodType,
  depth = 0
): boolean {
  const indent = '  '.repeat(depth)

  // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
  const fromDef = (unwrapSchema(from) as any)._zod.def as ZodDef
  // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
  const toDef = (unwrapSchema(to) as any)._zod.def as ZodDef

  debugConnect(`${indent}Comparing: from.type=${fromDef.type}, to.type=${toDef.type}`)

  // z.unknown() accepts anything
  if (toDef.type === 'unknown') {
    debugConnect(`${indent}✓ Target is unknown (accepts anything)`)
    return true
  }
  // z.unknown() can produce anything — optimistically allow
  if (fromDef.type === 'unknown') {
    debugConnect(`${indent}✓ Source is unknown (optimistically allow)`)
    return true
  }

  // If target is a union and source is NOT a union, check if source is compatible with any option
  if (toDef.type === 'union' && fromDef.type !== 'union' && toDef.options) {
    debugConnect(`${indent}Checking union compatibility`)
    return toDef.options.some(toOpt => schemasAreCompatible(from, toOpt, depth + 1))
  }

  // Handle literal types — string is compatible with literal<string>, etc.
  // In Zod v4, literal value is stored in `values` (array)
  if (toDef.type === 'literal') {
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
    const literalValues = (toDef as any).values as unknown[]
    if (!literalValues || literalValues.length === 0) {
      debugConnect(`${indent}✗ Literal has no values`)
      return false
    }

    // If source is also a literal, both must have the same value
    if (fromDef.type === 'literal') {
      // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
      const fromLiteralValues = (fromDef as any).values as unknown[]
      const compatible = JSON.stringify(fromLiteralValues) === JSON.stringify(literalValues)
      debugConnect(
        `${indent}${compatible ? '✓' : '✗'} Literal to literal: from=${JSON.stringify(fromLiteralValues)}, to=${JSON.stringify(literalValues)}`
      )
      return compatible
    }

    // Otherwise, source must be a primitive type matching the literal's type
    const expectedType = typeof literalValues[0]
    const compatible = fromDef.type === expectedType
    debugConnect(
      `${indent}${compatible ? '✓' : '✗'} Literal check: expected=${expectedType}, got=${fromDef.type}`
    )
    return compatible
  }

  // Different base types are incompatible
  if (fromDef.type !== toDef.type) {
    debugConnect(`${indent}✗ Type mismatch: ${fromDef.type} !== ${toDef.type}`)
    return false
  }

  switch (fromDef.type) {
    case 'array':
      debugConnect(`${indent}Checking array element compatibility`)
      if (!fromDef.element || !toDef.element) {
        debugConnect(`${indent}✓ Array has no element schema`)
        return true
      }
      return schemasAreCompatible(fromDef.element, toDef.element, depth + 1)

    case 'object':
    case 'looseObject':
    case 'strictObject':
      debugConnect(`${indent}Checking object shape compatibility`)
      // All required properties in target must exist in source with compatible types
      if (!toDef.shape) {
        debugConnect(`${indent}✓ Target has no shape`)
        return true
      }
      debugConnect(
        `${indent}Target shape keys: ${Object.keys(toDef.shape).join(', ')}`
      )
      debugConnect(
        `${indent}Source shape keys: ${fromDef.shape ? Object.keys(fromDef.shape).join(', ') : 'none'}`
      )
      for (const [key, toSchema] of Object.entries(toDef.shape)) {
        const fromSchema = fromDef.shape?.[key]
        if (!fromSchema) {
          debugConnect(`${indent}✗ Missing property '${key}' in source`)
          return false
        }
        debugConnect(`${indent}Checking property '${key}'`)
        // IMPORTANT: Don't unwrap here - let the recursive call handle it
        // The recursive schemasAreCompatible will unwrap both schemas at the start
        if (!schemasAreCompatible(fromSchema, toSchema, depth + 1)) {
          debugConnect(`${indent}✗ Property '${key}' incompatible`)
          return false
        }
      }
      debugConnect(`${indent}✓ All properties compatible`)
      return true

    case 'union':
      debugConnect(`${indent}Checking union compatibility`)
      if (!fromDef.options || !toDef.options) {
        debugConnect(`${indent}✓ Union has no options`)
        return true
      }
      // Every option in source must be compatible with at least one option in target
      return fromDef.options.every(fromOpt =>
        toDef.options!.some(toOpt => schemasAreCompatible(fromOpt, toOpt, depth + 1))
      )

    case 'tuple':
      debugConnect(`${indent}Checking tuple compatibility`)
      if (!fromDef.items || !toDef.items) {
        debugConnect(`${indent}✓ Tuple has no items`)
        return true
      }
      if (fromDef.items.length !== toDef.items.length) {
        debugConnect(
          `${indent}✗ Tuple length mismatch: ${fromDef.items.length} !== ${toDef.items.length}`
        )
        return false
      }
      return fromDef.items.every((fromItem, i) =>
        schemasAreCompatible(fromItem, toDef.items![i], depth + 1)
      )

    default:
      // Primitives with same type are compatible
      debugConnect(`${indent}✓ Primitive type ${fromDef.type}`)
      return true
  }
}

// Validates if two fields can be connected using structural schema comparison
export function validateConnection(from: Field, to: Field): ConnectionValidationResult {
  const fromFieldType = (from.constructor as typeof Field).type
  const toFieldType = (to.constructor as typeof Field).type

  debugConnect(`\n=== validateConnection ===`)
  debugConnect(`From: ${from.constructor.name} (type=${fromFieldType})`)
  debugConnect(`To: ${to.constructor.name} (type=${toFieldType})`)

  // UnknownField can connect to anything
  if (from instanceof UnknownField) {
    debugConnect('✓ Source is UnknownField')
    return { valid: true }
  }

  const fromSchema = from.schema
  const toSchema = to instanceof ListField ? to.schema.unwrap() : to.schema

  // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
  const fromType = (unwrapSchema(fromSchema) as any)._zod.def.type

  debugConnect(`Schema comparison starting...`)
  // Structural type check
  if (!schemasAreCompatible(fromSchema, toSchema)) {
    debugConnect(`✗ Schema compatibility failed`)
    return {
      valid: false,
      severity: 'error',
      error: `Type mismatch: ${fromFieldType} cannot connect to ${toFieldType}`,
    }
  }
  debugConnect(`✓ Schema compatible`)

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

// Module-level cache keyed by field class pair — valid since schemasAreCompatible is structural
const canConnectCache = new Map<string, boolean>()

export function canConnectCached(from: Field, to: Field): boolean {
  const key = `${from.constructor.name}:${to.constructor.name}`
  const cached = canConnectCache.get(key)
  if (cached !== undefined) return cached
  const result = canConnect(from, to)
  canConnectCache.set(key, result)
  return result
}
