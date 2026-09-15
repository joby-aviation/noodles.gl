// Runtime operator registry - extracts metadata from loaded operator classes

import { categories } from '../noodles/components/categories'
import type { Field } from '../noodles/fields'
import { opTypes } from '../noodles/operators'
import type { OperatorRegistry, OperatorSchema } from './types'

// Build reverse lookup: operator display name -> category
function buildCategoryMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const [category, ops] of Object.entries(categories)) {
    for (const op of ops) {
      map.set(op, category)
    }
  }
  return map
}

// Extract field schema from a field instance
// biome-ignore lint/suspicious/noExplicitAny: Field has complex generic types, using any for runtime reflection
function extractFieldSchema(name: string, field: Field<any, any>) {
  // Get the field's constructor name as the type
  const type = field.constructor.name

  return {
    name,
    type,
    required: false, // All fields are optional at runtime
    defaultValue: field.defaultValue,
  }
}

// Build the operator registry from loaded classes
export function buildOperatorRegistry(): OperatorRegistry {
  const categoryMap = buildCategoryMap()
  const operators: Record<string, OperatorSchema> = {}

  for (const [typeName, OpClass] of Object.entries(opTypes)) {
    // Create a temporary instance to extract metadata
    // Use a unique ID that won't collide with real operators
    const tempId = `/__temp_${typeName}__`
    const instance = new OpClass(tempId)

    // Get display name from the class (falls back to type name without "Op" suffix)
    const displayName = OpClass.displayName || typeName.replace(/Op$/, '')

    // Find category (without "Op" suffix for lookup)
    const category = categoryMap.get(displayName) || 'utility'

    // Extract input schemas
    const inputs = Object.fromEntries(
      Object.entries(instance.inputs).map(([name, field]) => [
        name,
        // biome-ignore lint/suspicious/noExplicitAny: Runtime reflection on field metadata
        extractFieldSchema(name, field as Field<any, any>),
      ])
    )

    // Extract output schemas
    const outputs = Object.fromEntries(
      Object.entries(instance.outputs).map(([name, field]) => [
        name,
        // biome-ignore lint/suspicious/noExplicitAny: Runtime reflection on field metadata
        extractFieldSchema(name, field as Field<any, any>),
      ])
    )

    operators[typeName] = {
      name: displayName,
      type: typeName,
      category: category as OperatorSchema['category'],
      description: OpClass.description || '',
      inputs,
      outputs,
      sourceFile: 'src/noodles/operators.ts',
      sourceLine: 0, // Not available at runtime
    }
  }

  return {
    version: '1.0.0',
    operators,
    categories: Object.fromEntries(Object.entries(categories).map(([cat, ops]) => [cat, [...ops]])),
  }
}

// Singleton instance - built once on first access
let registryCache: OperatorRegistry | null = null

export function getOperatorRegistry(): OperatorRegistry {
  if (!registryCache) {
    registryCache = buildOperatorRegistry()
  }
  return registryCache
}
