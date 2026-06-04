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
  let match: RegExpExecArray | null
  while ((match = MUSTACHE_RE.exec(sql)) !== null) {
    refs.push({
      raw: match[0],
      path: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return refs
}

// Determine if a path references an operator's data output or a parameter value.
// Convention: paths ending in .out.* or with no field suffix reference data (→ CTE alias)
// Paths containing .par. or .inputs. reference parameter values (→ $N)
export function classifyRef(path: string): 'data' | 'param' {
  if (path.includes('.par.') || path.includes('.inputs.')) return 'param'
  if (path.includes('.out.')) return 'data'
  // Strip leading ./ or / prefix before checking for dots
  const stripped = path.replace(/^\.?\//, '')
  if (!stripped.includes('.')) return 'data'
  return 'param'
}

// Extract the operator ID from a path reference
export function extractOperatorId(path: string): string {
  // /some-op.par.value → /some-op
  // /some-op.out.data → /some-op
  // /some-op → /some-op
  // ./relative.par.x → ./relative
  let searchStart = 0
  if (path.startsWith('./')) searchStart = 2
  else if (path.startsWith('/')) searchStart = 1
  const dotIndex = path.indexOf('.', searchStart)
  if (dotIndex === -1) return path
  return path.substring(0, dotIndex)
}

export function parseDuckDbSQL(
  sql: string,
  startParamIndex: number,
  resolveOperatorAlias: (opId: string) => string | undefined,
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
    } else {
      const idx = paramIndex++
      params.push({ index: idx, path: ref.path })
      result = result.substring(0, ref.start) + `$${idx}` + result.substring(ref.end)
    }
  }

  return { sql: result, params, upstreamRefs }
}
