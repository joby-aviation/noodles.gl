import { type Field, ListField, UnknownField } from '../fields'

// Called on input fields only
export function canConnect(from: Field, to: Field): boolean {
  // Unknown fields can connect to anything. The reverse is also true but the schema handles it for us
  if (from instanceof UnknownField) {
    return true
  }
  // TODO: for correctness this should validate the other schema
  // rather than just the value
  const schema = to instanceof ListField ? to.schema.unwrap() : to.schema
  const result = schema.safeParse(from.value, {
    reportInput: true,
    error: _iss => from.pathToProps.join('.'),
  })
  if (!result.success) {
    console.warn('Incompatible schema', result.error.issues)
  }
  return result.success
}
