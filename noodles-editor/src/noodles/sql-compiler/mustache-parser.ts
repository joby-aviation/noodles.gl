// Parses mustache-style {{path}} references in DuckDbOp SQL strings.
// Distinguishes between:
// - Upstream data refs (operator paths that are data sources) → CTE alias references
// - Value refs (field paths like /op.par.value) → prepared statement parameters

export interface MustacheRef {
  // Original match text including braces
  raw: string
  // The path inside the braces
  path: string
  // Start index in original string
  start: number
  // End index in original string
  end: number
}

export interface ParsedDuckDbSQL {
  // SQL with mustache refs replaced by $N params or CTE aliases
  sql: string
  // Parameter bindings from value refs
  params: Array<{ index: number; path: string }>
  // Operator IDs referenced as data sources (upstream dependencies)
  upstreamRefs: string[]
}

const MUSTACHE_RE = /\{\{([^}]+)\}\}/g

export function parseMustacheRefs(sql: string): MustacheRef[] {
  const refs: MustacheRef[] = []
  let match: RegExpExecArray | null = MUSTACHE_RE.exec(sql)
  while (match !== null) {
    refs.push({
      raw: match[0],
      path: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    })
    match = MUSTACHE_RE.exec(sql)
  }
  return refs
}

// Determine if a path references an operator's data output or a parameter value.
// Supports explicit prefixes for clarity:
//   {{cte:/op}} or {{data:/op}}    → CTE alias (upstream data)
//   {{param:/op.par.value}}         → parameter value
//   {{ident:column_name}}           → identifier (backward compat, treated as param)
//
// Legacy convention (no prefix):
//   Paths ending in .out.* or with no field suffix → data (CTE alias)
//   Paths containing .par. or .inputs. → param
export function classifyRef(path: string): 'data' | 'param' | 'identifier' {
  // Check for explicit prefixes
  if (path.startsWith('cte:') || path.startsWith('data:')) {
    return 'data'
  }
  if (path.startsWith('param:')) {
    return 'param'
  }
  if (path.startsWith('ident:')) {
    return 'identifier'
  }

  // Legacy heuristic-based classification
  if (path.includes('.par.') || path.includes('.inputs.')) return 'param'
  if (path.includes('.out.')) return 'data'
  // Strip leading ./ or / prefix before checking for dots
  const stripped = path.replace(/^\.?\//, '')
  if (!stripped.includes('.')) return 'data'
  return 'param'
}

// Extract the operator ID from a path reference
export function extractOperatorId(path: string): string {
  // Strip explicit prefix if present
  let actualPath = path
  if (path.includes(':')) {
    const colonIdx = path.indexOf(':')
    actualPath = path.substring(colonIdx + 1)
  }

  // /some-op.par.value → /some-op
  // /some-op.out.data → /some-op
  // /some-op → /some-op
  // ./relative.par.x → ./relative
  let searchStart = 0
  if (actualPath.startsWith('./')) searchStart = 2
  else if (actualPath.startsWith('/')) searchStart = 1
  const dotIndex = actualPath.indexOf('.', searchStart)
  if (dotIndex === -1) return actualPath
  return actualPath.substring(0, dotIndex)
}

export function parseDuckDbSQL(
  sql: string,
  startParamIndex: number,
  resolveOperatorAlias: (opId: string) => string | undefined
): ParsedDuckDbSQL {
  const refs = parseMustacheRefs(sql)
  const params: ParsedDuckDbSQL['params'] = []
  const upstreamRefs: string[] = []
  let paramIndex = startParamIndex

  // Process refs from end to start so indices stay valid
  let result = sql
  const sortedRefs = [...refs].sort((a, b) => b.start - a.start)

  for (const ref of sortedRefs) {
    const classification = classifyRef(ref.path)
    const opId = extractOperatorId(ref.path)

    if (classification === 'data') {
      const alias = resolveOperatorAlias(opId)
      if (alias) {
        result = result.substring(0, ref.start) + alias + result.substring(ref.end)
        if (!upstreamRefs.includes(opId)) upstreamRefs.push(opId)
      }
    } else if (classification === 'param') {
      const idx = paramIndex++
      params.push({ index: idx, path: ref.path })
      result = `${result.substring(0, ref.start)}$${idx}${result.substring(ref.end)}`
    } else if (classification === 'identifier') {
      // Identifiers are handled separately (not replaced here)
      // This is for backward compatibility with {{ident:column}} syntax
      // which is typically processed by the template system, not mustache parser
    }
  }

  return { sql: result, params, upstreamRefs }
}
