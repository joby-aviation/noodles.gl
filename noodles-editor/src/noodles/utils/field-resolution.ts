import type { Field } from '../fields'
import { hasChannelFields } from '../fields'
import type { IOperator, Operator } from '../operators'

export type FieldNamespace = 'par' | 'out'

export interface ResolvedOperatorField {
  field: Field
  rootField: Field
  rootFieldName: string
  channelName?: string
  resolvedPath: string
}

// Resolve a graph handle path to a concrete field. Vector input channels are
// represented by child NumberFields, while aliases keep renamed inputs reactive.
export function resolveOperatorField(
  op: Operator<IOperator>,
  namespace: FieldNamespace,
  fieldPath: string
): ResolvedOperatorField | undefined {
  const aliasedPath = namespace === 'par' ? (op.inputAliases[fieldPath] ?? fieldPath) : fieldPath
  const [rootFieldName, ...subPath] = aliasedPath.split('.')
  const fields = namespace === 'par' ? op.inputs : op.outputs
  const rootField = fields[rootFieldName] as Field | undefined
  if (!rootField) return undefined

  if (subPath.length === 0) {
    return {
      field: rootField,
      rootField,
      rootFieldName,
      resolvedPath: aliasedPath,
    }
  }

  if (subPath.length === 1 && hasChannelFields(rootField)) {
    const channelName = subPath[0]
    const channelField = rootField.channelFields[channelName]
    if (!channelField) return undefined
    return {
      field: channelField,
      rootField,
      rootFieldName,
      channelName,
      resolvedPath: aliasedPath,
    }
  }

  return undefined
}

export function relatedInputHandle(fieldName: string, handleFieldPath: string): boolean {
  return handleFieldPath === fieldName || handleFieldPath.startsWith(`${fieldName}.`)
}
