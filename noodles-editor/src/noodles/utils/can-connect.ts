import { type Field, ListField, UnknownField } from '../fields'

export type ConnectionValidationResult = {
  valid: boolean
  error?: string
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
    reportInput: true,
    error: _iss => from.pathToProps.join('.'),
  })
  if (!result.success) {
    const fromType = (from.constructor as typeof Field).type
    const toType = (to.constructor as typeof Field).type
    const issueMessages = result.error.issues.map(issue => issue.message).join(', ')
    return {
      valid: false,
      error: `Type mismatch: ${fromType} cannot connect to ${toType}. ${issueMessages}`,
    }
  }
  return { valid: true }
}

// Legacy function for backward compatibility - returns boolean only
export function canConnect(from: Field, to: Field): boolean {
  return validateConnection(from, to).valid
}
