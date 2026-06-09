import type { AttributeEnhancedData, AttributeValue } from '../fields'

// Resolved attribute: the result of resolving a field value against data.
// Used by processing operators to determine whether to operate on a scalar or a column.
export type ResolvedValue =
  | { mode: 'uniform'; value: number }
  | { mode: 'attribute'; values: Float32Array | Uint8Array; size: number; name: string }

// Check if a field value is an attribute reference (string naming an attribute in the data stream)
export function isAttributeReference(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// Resolve a field value against attribute-enhanced data.
// If the field's value is a string, treat it as an attribute name and look up in data.attributes.
// If the field's value is a number, treat it as a uniform scalar.
// Legacy accessor functions are not supported — they should be migrated to attributes.
export function resolveNumericField(
  fieldValue: unknown,
  data: AttributeEnhancedData | undefined
): ResolvedValue {
  if (typeof fieldValue === 'number') {
    return { mode: 'uniform', value: fieldValue }
  }

  if (isAttributeReference(fieldValue) && data?.attributes) {
    const attr = data.attributes[fieldValue]
    if (attr) {
      return {
        mode: 'attribute',
        values: attr.values as Float32Array,
        size: attr.size,
        name: fieldValue,
      }
    }
  }

  // Fallback: coerce to number
  return { mode: 'uniform', value: Number(fieldValue) || 0 }
}

// Transform an attribute column element-wise with a scalar function.
// Returns a new Float32Array with the transformation applied.
export function transformAttribute(
  input: Float32Array | Uint8Array,
  fn: (value: number) => number
): Float32Array {
  const output = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) {
    output[i] = fn(input[i])
  }
  return output
}

// Transform an attribute column element-wise producing a multi-component output.
// E.g., a scalar value → [r, g, b, a] color.
export function transformAttributeMulti(
  input: Float32Array | Uint8Array,
  outputSize: number,
  fn: (value: number) => number[]
): Uint8Array | Float32Array {
  const isColor = outputSize === 4
  const output = isColor
    ? new Uint8Array(input.length * outputSize)
    : new Float32Array(input.length * outputSize)
  for (let i = 0; i < input.length; i++) {
    const result = fn(input[i])
    for (let j = 0; j < outputSize; j++) {
      output[i * outputSize + j] = result[j] ?? 0
    }
  }
  return output
}

// Produce an AttributeEnhancedData with a new or replaced attribute.
export function withAttribute(
  data: AttributeEnhancedData,
  name: string,
  values: Float32Array | Uint8Array,
  size: number
): AttributeEnhancedData {
  return {
    data: data.data,
    attributes: {
      ...data.attributes,
      [name]: { values, size } as AttributeValue,
    },
  }
}

// Extract attribute-enhanced data from an unknown input (handles plain arrays, wrappers, etc.)
export function extractAttributes(data: unknown): AttributeEnhancedData {
  if (!data || typeof data !== 'object') {
    return { data: Array.isArray(data) ? data : [], attributes: {} }
  }

  const obj = data as { data?: unknown; attributes?: Record<string, AttributeValue> }
  if (obj.data && obj.attributes) {
    const rows = Array.isArray(obj.data) ? obj.data : []
    return { data: rows, attributes: obj.attributes }
  }

  return { data: Array.isArray(data) ? data : [], attributes: {} }
}
