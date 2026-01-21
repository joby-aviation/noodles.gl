import type z from 'zod/v4'
import { type Field, ListField, UnknownField } from '../fields'

export type ConnectionValidationResult = {
  valid: boolean
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
      // Fall back to issue.message for other codes
      return issue.message || `Validation failed (${issue.code})`
  }
}

// Validates if two fields can be connected. Returns both validity and error message.
// Called on input fields only
export function validateConnection(from: Field, to: Field): ConnectionValidationResult {
  // Unknown fields can connect to anything. The reverse is also true but the schema handles it for us
  if (from instanceof UnknownField) {
    return { valid: true }
  }
  // TODO: for correctness this should validate the other schema
  // rather than just the value
  const schema = to instanceof ListField ? to.schema.unwrap() : to.schema
  const result = schema.safeParse(from.value, {
    error: _iss => from.pathToProps.join('.'),
  })
  if (!result.success) {
    const fromType = (from.constructor as typeof Field).type
    const toType = (to.constructor as typeof Field).type
    const issueMessages = result.error.issues.map(formatZodIssue).join(', ')

    // Check if this is a type mismatch (different field types OR zod reports invalid_type)
    const hasTypeMismatch =
      fromType !== toType || result.error.issues.some(issue => issue.code === 'invalid_type')

    if (hasTypeMismatch) {
      return {
        valid: false,
        error: `Type mismatch: ${fromType} cannot connect to ${toType}. ${issueMessages}`,
      }
    }

    // Constraint violation - types match but value fails validation (e.g., min/max)
    return {
      valid: false,
      error: `Constraint violation: ${issueMessages}`,
    }
  }
  return { valid: true }
}

// Legacy function for backward compatibility - returns boolean only
export function canConnect(from: Field, to: Field): boolean {
  return validateConnection(from, to).valid
}
