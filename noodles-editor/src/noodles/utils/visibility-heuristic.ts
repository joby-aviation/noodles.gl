import type { IOperator, Operator } from '../operators'

export type VisibilityHeuristicResult = {
  // Fields that should be visible according to the heuristic
  visibleFields: Set<string>
  // True if the heuristic result differs from just using showByDefault
  // (i.e., a field with showByDefault:false is visible due to value/connection)
  differsFromDefaults: boolean
}

// Computes which fields should be visible based on the heuristic:
// field.showByDefault === true OR has non-default value OR has data connection
// (ReferenceEdges don't count as data connections since they're operator references
// used in code expressions, not data flow)
export function computeVisibilityHeuristic(
  op: Operator<IOperator>,
  customValues: Record<string, unknown>,
  connectedFields: Set<string | undefined>
): VisibilityHeuristicResult {
  const visibleFields = new Set<string>()
  let differsFromDefaults = false

  for (const [name, field] of Object.entries(op.inputs)) {
    const hasCustomValue = name in customValues
    const hasConnection = connectedFields.has(name)
    const shouldShow = field.showByDefault || hasCustomValue || hasConnection

    if (shouldShow) {
      visibleFields.add(name)
      // Track if visibility differs from showByDefault alone
      if (!field.showByDefault && (hasCustomValue || hasConnection)) {
        differsFromDefaults = true
      }
    }
  }

  return { visibleFields, differsFromDefaults }
}
