// Bounds the size of tool results before they enter the model's context.
//
// Tool results were previously JSON.stringify'd with no size cap, so a single
// list_nodes call on a large project could contribute tens of thousands of
// tokens. Truncation happens element-wise on arrays and with an explicit
// marker on long strings, so the payload always stays valid JSON and the model
// can tell that it is looking at a partial view.

import type { ToolResult } from '../types'

// Rough average across JSON payloads; only used to turn a token-denominated
// context window into a char budget, so precision does not matter much
const CHARS_PER_TOKEN = 3.6

// Share of the context window a single tool result may occupy
const BUDGET_FRACTION = 0.1

const MIN_BUDGET_CHARS = 600
const MAX_BUDGET_CHARS = 24_000

// Successively tighter (array items, string chars) limits. capToolResult walks
// this ladder until the serialized result fits, so the first rung that fits
// wins and small results are never touched at all.
const LADDER: ReadonlyArray<{ arrayItems: number; stringChars: number }> = [
  { arrayItems: 50, stringChars: 2000 },
  { arrayItems: 25, stringChars: 800 },
  { arrayItems: 10, stringChars: 400 },
  { arrayItems: 5, stringChars: 200 },
  { arrayItems: 3, stringChars: 120 },
  { arrayItems: 1, stringChars: 80 },
]

// Per-tool guidance telling the model how to get the omitted detail. Without
// this a truncated result reads as missing data and the model tends to guess.
const HINTS: Record<string, string> = {
  list_nodes: 'call get_node_info with a specific nodeId for full detail',
  get_current_project: 'call list_nodes, then get_node_info per node',
  get_node_output: 'lower maxRows, or narrow the data upstream with DuckDbOp',
  search_code: 'narrow the pattern, pass path, or lower maxResults',
  get_source_code: 'request a smaller startLine/endLine range',
  get_documentation: 'use a more specific query',
  get_example: 'inspect the example a few nodes at a time',
  list_examples: 'filter by category or tag',
  get_console_errors: 'lower maxResults or filter by level',
}

const DEFAULT_HINT = 'narrow your query and call the tool again'

export interface CappedToolResult {
  result: ToolResult
  truncated: boolean
  // Serialized length actually sent, for logging and tests
  chars: number
}

// Char budget for one tool result, derived from the provider's context window
// so a 6k-token on-device model and a 200k-token hosted model both behave.
export function resultBudgetChars(contextWindowTokens: number): number {
  const raw = contextWindowTokens * CHARS_PER_TOKEN * BUDGET_FRACTION
  return Math.round(Math.min(MAX_BUDGET_CHARS, Math.max(MIN_BUDGET_CHARS, raw)))
}

// Serializes a tool result, shrinking it to fit budgetChars if needed.
export function capToolResult(
  toolName: string,
  result: ToolResult,
  budgetChars: number
): CappedToolResult {
  const direct = serialize(result)
  if (direct.length <= budgetChars) {
    return { result, truncated: false, chars: direct.length }
  }

  const hint = HINTS[toolName] ?? DEFAULT_HINT

  for (const limits of LADDER) {
    const shrunk: ToolResult = {
      ...result,
      data: shrink(result.data, limits, hint),
    }
    const text = serialize(shrunk)
    if (text.length <= budgetChars) {
      return { result: shrunk, truncated: true, chars: text.length }
    }
  }

  // Even the tightest rung overflows (e.g. one enormous string field). Fall
  // back to a hard char clip on the serialized form rather than sending it.
  const tightest = LADDER[LADDER.length - 1]
  const shrunk = shrink(result.data, tightest, hint)
  return {
    result: {
      success: result.success,
      error: result.error,
      data: {
        _truncated: {
          hint,
          reason: 'result exceeded the context budget even after truncation',
        },
        preview: serialize(shrunk).slice(0, Math.max(0, budgetChars - 200)),
      },
    },
    truncated: true,
    chars: budgetChars,
  }
}

// Compact JSON, matching what the chat transport actually sends, so measured
// lengths are the real cost. Deliberately not safeStringify: that indents at
// two spaces (inflating the payload ~30%) and its sanitizer drops every
// repeated object reference, not just cyclic ones, which would silently delete
// legitimately shared data from tool results.
export function serialize(value: unknown): string {
  const ancestors: unknown[] = []
  try {
    return (
      JSON.stringify(value, function sanitize(_key, val) {
        if (typeof val === 'function') return undefined
        if (typeof val === 'bigint') return val.toString()
        if (typeof val === 'object' && val !== null) {
          // `this` is the container being serialized; unwind to it so only
          // true ancestor cycles are cut, not sibling repeats
          while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
            ancestors.pop()
          }
          if (ancestors.includes(val)) return '[circular]'
          ancestors.push(val)
        }
        return val
      }) ?? 'null'
    )
  } catch {
    return String(value)
  }
}

interface Limits {
  arrayItems: number
  stringChars: number
}

// Deep copy with arrays capped and long strings clipped. Both truncations
// leave a self-describing marker so the model knows detail was dropped.
function shrink(value: unknown, limits: Limits, hint: string, depth = 0): unknown {
  // Guard against pathological nesting; the indices are shallow in practice
  if (depth > 12) return '[max depth]'

  if (typeof value === 'string') {
    if (value.length <= limits.stringChars) return value
    return `${value.slice(0, limits.stringChars)}…[clipped, ${value.length} chars total]`
  }

  if (Array.isArray(value)) {
    const kept = value
      .slice(0, limits.arrayItems)
      .map(item => shrink(item, limits, hint, depth + 1))
    if (value.length <= limits.arrayItems) return kept
    return [
      ...kept,
      {
        _truncated: {
          shown: kept.length,
          total: value.length,
          omitted: value.length - kept.length,
          hint,
        },
      },
    ]
  }

  if (value instanceof Date) return value.toISOString()

  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = shrink(item, limits, hint, depth + 1)
    }
    return out
  }

  return value
}
