// Utilities for parsing and formatting operator field references
// Reuses existing regex patterns from fields.ts to avoid duplication

import { fnRe, mustacheRe } from '../fields'

export type ParsedReference = {
  opPath: string
  namespace: 'par' | 'out'
  fieldName: string
}

export type ReferenceFormat = 'code' | 'mustache'

// Parse a reference from clipboard text
// Supports both code format: op('path').par.field
// and mustache format: {{path.par.field}}
export function parseReference(text: string): ParsedReference | null {
  // Reset regex state
  fnRe.lastIndex = 0
  mustacheRe.lastIndex = 0

  // Try function-style first: op('path').par.field
  const fnMatch = fnRe.exec(text)
  if (fnMatch?.groups) {
    const fieldPath = fnMatch.groups.fieldPath?.split('.')[0]
    return {
      opPath: fnMatch.groups.opId,
      namespace: fnMatch.groups.inOut as 'par' | 'out',
      fieldName: fieldPath || '',
    }
  }

  // Try mustache-style: {{path.par.field}}
  const mustacheMatch = mustacheRe.exec(text)
  if (mustacheMatch?.groups) {
    const fieldPath = mustacheMatch.groups.fieldPath?.split('.')[0]
    return {
      opPath: mustacheMatch.groups.opId,
      namespace: mustacheMatch.groups.inOut as 'par' | 'out',
      fieldName: fieldPath || '',
    }
  }

  return null
}

// Format a parsed reference in the specified format
export function formatReference(ref: ParsedReference, format: ReferenceFormat): string {
  const { opPath, namespace, fieldName } = ref
  if (format === 'mustache') {
    return `{{${opPath}.${namespace}.${fieldName}}}`
  }
  return `op('${opPath}').${namespace}.${fieldName}`
}

// Convert a reference string from one format to another
export function convertReferenceFormat(text: string, targetFormat: ReferenceFormat): string | null {
  const parsed = parseReference(text)
  if (!parsed) return null
  return formatReference(parsed, targetFormat)
}
