// Operator types, input names and edge handles, checked against the registry.
//
// The editor takes an unknown type or handle without complaint: the node loads
// as an UnknownOperator, the edge connects nothing, and nothing says why the map
// is blank. Every message here names what should have been written instead, so
// the next attempt is a pick from a list rather than another guess.
//
// The wording matches the apply_modifications checks in the editor's
// src/ai-chat/modification-fields.ts, so an agent sees the same error whether it
// edits the file or the running app.

import type { Registry } from './types.ts'

// How many names a "has no input" error lists
const FIELD_SUGGESTIONS = 15

export type Side = 'inputs' | 'outputs'

// "File", "file", "FileOp" and "fileop" all name FileOp. Resolves a name that
// matches exactly one operator by type or display name; returned unchanged
// otherwise.
export function resolveOperatorType(type: string, registry: Registry): string {
  const operators = registry.operators
  if (operators[type]) return type
  if (operators[`${type}Op`]) return `${type}Op`
  const wanted = type.trim().toLowerCase()
  const matches = Object.values(operators).filter(
    op =>
      op.type.toLowerCase() === wanted ||
      op.type.toLowerCase() === `${wanted}op` ||
      op.name.toLowerCase() === wanted
  )
  return matches.length === 1 ? matches[0].type : type
}

export function unknownType(type: string, registry: Registry): string {
  const resolved = resolveOperatorType(type, registry)
  if (resolved !== type) {
    return `Unknown operator type ${type}. Did you mean: ${resolved}? Types end in "Op", e.g. FileOp, ScatterplotLayerOp.`
  }
  const wanted = type.toLowerCase().replace(/op$/, '')
  const similar = Object.values(registry.operators)
    .filter(
      op =>
        op.type.toLowerCase().includes(wanted) ||
        wanted.includes(op.name.toLowerCase()) ||
        isTypo(wanted, op.name.toLowerCase())
    )
    .map(op => op.type)
    .slice(0, FIELD_SUGGESTIONS)
  const hint =
    similar.length > 0
      ? ` Did you mean: ${similar.join(', ')}?`
      : ' registry.json in noodles-validate lists every type.'
  return `Unknown operator type ${type}.${hint} Types end in "Op", e.g. FileOp, ScatterplotLayerOp.`
}

export function fieldNames(registry: Registry, type: string, side: Side): string[] {
  return Object.keys(registry.operators[type]?.[side] ?? {})
}

export function unknownInput(id: string, type: string, name: string, known: string[]): string {
  return `${id} (${type}) has no input ${name}. ${suggest(name, known, 'Inputs')}`
}

// Null when the handle names a real field on the right side of the edge
export function handleProblem(
  nodeId: string,
  type: string,
  handle: string,
  side: Side,
  known: string[]
): string | null {
  const prefix = side === 'outputs' ? 'out' : 'par'
  const role = side === 'outputs' ? 'sourceHandle' : 'targetHandle'
  const label = side === 'outputs' ? 'Outputs' : 'Inputs'
  const match = /^(par|out)\.(.+)$/.exec(handle)
  if (!match) {
    return `${role} ${handle} is malformed: ${side} are "${prefix}.<name>". ${suggest(handle, known, label, nodeId, prefix)}`
  }
  if (match[1] !== prefix) {
    return `${role} ${handle} is on the wrong side: the ${side === 'outputs' ? 'source' : 'target'} of an edge is an ${side === 'outputs' ? 'output' : 'input'}, "${prefix}.<name>". ${suggest(match[2], known, label, nodeId, prefix)}`
  }
  // The graph looks up everything after the prefix, so 'par.viewState.zoom' is a
  // field named 'viewState.zoom', not the viewState field
  if (known.includes(match[2])) return null
  return `${nodeId} (${type}) has no ${side === 'outputs' ? 'output' : 'input'} ${match[2]}. ${suggest(match[2], known, label, nodeId, prefix)}`
}

// Names containing the wrong one, or one typo away from it, first ("color" ->
// getFillColor, getLineColor); otherwise the full list
export function suggest(
  name: string,
  known: string[],
  label: string,
  nodeId?: string,
  prefix?: string
): string {
  if (known.length === 0) return `It has no ${label.toLowerCase()}.`
  const wanted = name.toLowerCase()
  const similar = wanted
    ? known.filter(k => {
        const candidate = k.toLowerCase()
        return candidate.includes(wanted) || wanted.includes(candidate) || isTypo(wanted, candidate)
      })
    : []
  const pool = similar.length > 0 ? similar : known
  const list = pool.slice(0, FIELD_SUGGESTIONS)
  const more = pool.length - list.length
  const shown = prefix ? list.map(k => `${prefix}.${k}`) : list
  const where = nodeId ? ` on ${nodeId}` : ''
  return `${similar.length > 0 ? 'Did you mean' : `${label}${where}`}: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}.`
}

// Within two edits, for names long enough that two edits isn't most of the word
export function isTypo(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 2) return false
  return editDistance(a, b) <= 2
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[b.length]
}
