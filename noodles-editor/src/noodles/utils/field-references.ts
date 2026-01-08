import type { Edge as ReactFlowEdge } from '@xyflow/react'
import { CodeField, ExpressionField } from '../fields'
import type { IOperator, Operator } from '../operators'
import { getAllOps } from '../store'

export interface FieldReference {
  opId: string
  location: 'code' | 'expression' | 'connection'
}

/**
 * Find all references to a specific field in an operator
 * This includes:
 * - Code fields that reference op('/path').par.fieldName
 * - Expression fields that reference op('/path').par.fieldName
 * - Edge connections where the field is a source or target
 */
export function findFieldReferences(
  operatorId: string,
  fieldName: string,
  edges?: ReactFlowEdge[]
): FieldReference[] {
  const references: FieldReference[] = []

  // Check all CodeField and ExpressionField values for references
  for (const op of getAllOps()) {
    for (const [_name, field] of Object.entries(op.inputs)) {
      if (field instanceof CodeField || field instanceof ExpressionField) {
        const code = field.value
        if (typeof code === 'string') {
          // Look for patterns like: op('/operatorId').par.fieldName or op('/operatorId').par.fieldName
          // This is a simple regex check - it may have false positives but better safe than sorry
          const patterns = [
            // op('/operatorId').par.fieldName
            new RegExp(`op\\s*\\(\\s*['"\`]${escapeRegex(operatorId)}['"\`]\\s*\\)\\.par\\.${escapeRegex(fieldName)}\\b`),
            // op('/operatorId').inputs.fieldName (less common but possible)
            new RegExp(`op\\s*\\(\\s*['"\`]${escapeRegex(operatorId)}['"\`]\\s*\\)\\.inputs\\.${escapeRegex(fieldName)}\\b`),
          ]

          if (patterns.some(pattern => pattern.test(code))) {
            references.push({
              opId: op.id,
              location: field instanceof CodeField ? 'code' : 'expression',
            })
            break // Only add once per operator
          }
        }
      }
    }
  }

  // Check edges for connections to this field
  if (edges) {
    for (const edge of edges) {
      // Check if this field is the source
      if (edge.source === operatorId && edge.sourceHandle?.includes(fieldName)) {
        references.push({
          opId: edge.target,
          location: 'connection',
        })
      }
      // Check if this field is the target
      if (edge.target === operatorId && edge.targetHandle?.includes(fieldName)) {
        references.push({
          opId: edge.source,
          location: 'connection',
        })
      }
    }
  }

  return references
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
