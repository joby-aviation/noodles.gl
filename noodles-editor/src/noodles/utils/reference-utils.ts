// Utilities for parsing and formatting operator field references

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
  // Parse op('path').par.field format
  const fnMatch = text.match(/op\(['"]([^'"]+)['"]\)\.(par|out)\.(\w+)/)
  if (fnMatch) {
    return { opPath: fnMatch[1], namespace: fnMatch[2] as 'par' | 'out', fieldName: fnMatch[3] }
  }

  // Parse {{path.par.field}} format
  const mustacheMatch = text.match(/\{\{([^}]+)\.(par|out)\.(\w+)\}\}/)
  if (mustacheMatch) {
    return {
      opPath: mustacheMatch[1],
      namespace: mustacheMatch[2] as 'par' | 'out',
      fieldName: mustacheMatch[3],
    }
  }

  return null
}

// Format a parsed reference in the specified format
export function formatReference(
  ref: ParsedReference,
  format: ReferenceFormat
): string {
  const { opPath, namespace, fieldName } = ref
  if (format === 'mustache') {
    return `{{${opPath}.${namespace}.${fieldName}}}`
  }
  return `op('${opPath}').${namespace}.${fieldName}`
}

// Convert a reference string from one format to another
export function convertReferenceFormat(
  text: string,
  targetFormat: ReferenceFormat
): string | null {
  const parsed = parseReference(text)
  if (!parsed) return null
  return formatReference(parsed, targetFormat)
}
