// Deterministic grading for one benchmark run. Every check reads only the
// BenchResult the page hook returned (plus console errors the runner saw), so a
// raw result file can be re-graded after a check changes without re-running it.
//
// Scoring follows PR #509's scale: 0–4, the fraction of checks passed, capped at
// 40% (1.6) when a mechanical check fails — a run that left the graph broken is
// not rescued by a good answer.

import type { BenchResult } from '../../src/ai-chat/bench/bench-hook'

// A node is selected by id, or by type when the agent was free to name it.
// With a type, the check passes if any node of that type satisfies it.
interface NodeSelector {
  node?: string
  nodeType?: string
}

export type Check =
  // Regexes (case-insensitive) against every reply of the run joined together
  | { type: 'answerMatches'; patterns: string[]; any?: boolean }
  | { type: 'answerExcludes'; patterns: string[] }
  | { type: 'nodeTypesPresent'; types: string[] }
  // Every edge points at a node that exists and a handle that node has
  | { type: 'edgesValid' }
  | {
      type: 'edgeExists'
      source?: string
      sourceType?: string
      sourceHandle?: string
      target?: string
      targetType?: string
      targetHandle: string
    }
  // tolerance is per channel for colors, absolute for numbers
  | ({ type: 'inputEquals'; input: string; value: unknown; tolerance?: number } & NodeSelector)
  // Regex (case-insensitive) against a string input, e.g. an accessor expression
  | ({ type: 'inputMatches'; input: string; pattern: string } & NodeSelector)
  | { type: 'nodeCount'; min?: number; max?: number }
  | { type: 'applySucceeded' }
  // No operator is in error that was not already before the first turn
  | { type: 'noNewOperatorErrors' }
  // Every operator that was in error before the first turn is no longer
  | { type: 'operatorErrorsFixed' }
  | { type: 'noConsoleErrors' }
  | { type: 'anyOf'; checks: Check[] }

// Checks that describe whether the graph still works rather than whether the
// task was done. Failing one caps the score.
const MECHANICAL = new Set<Check['type']>([
  'edgesValid',
  'applySucceeded',
  'noNewOperatorErrors',
  'noConsoleErrors',
])

export interface CheckResult {
  check: Check
  pass: boolean
  mechanical: boolean
  detail: string
}

export interface Grade {
  score: number
  pass: boolean
  mechanicalFailure: boolean
  checks: CheckResult[]
}

export interface GradeInput {
  result: BenchResult
  consoleErrors?: string[]
}

const MAX_SCORE = 4
const MECHANICAL_CAP = 0.4
export const MECHANICAL_FAILURE_CAP = MAX_SCORE * MECHANICAL_CAP

export function grade(checks: Check[], input: GradeInput): Grade {
  // A run that never completed a turn has nothing to grade
  if (input.result.turns.length === 0) {
    return {
      score: 0,
      pass: false,
      mechanicalFailure: true,
      checks: checks.map(check => ({
        check,
        pass: false,
        mechanical: MECHANICAL.has(check.type),
        detail: input.result.error ?? 'no turn completed',
      })),
    }
  }

  const results = checks.map(check => runCheck(check, input))
  const passed = results.filter(r => r.pass).length
  const mechanicalFailure = results.some(r => r.mechanical && !r.pass)
  const fraction = results.length ? passed / results.length : 0
  const score = MAX_SCORE * (mechanicalFailure ? Math.min(fraction, MECHANICAL_CAP) : fraction)

  return {
    score: Math.round(score * 100) / 100,
    pass: passed === results.length,
    mechanicalFailure,
    checks: results,
  }
}

function runCheck(check: Check, input: GradeInput): CheckResult {
  const [pass, detail] = evaluate(check, input)
  return { check, pass, mechanical: MECHANICAL.has(check.type), detail }
}

type Outcome = [pass: boolean, detail: string]

function evaluate(check: Check, { result, consoleErrors = [] }: GradeInput): Outcome {
  const nodes = result.finalProject?.nodes ?? []
  const edges = result.finalProject?.edges ?? []

  switch (check.type) {
    case 'answerMatches': {
      const answer = replies(result)
      const missing = check.patterns.filter(p => !new RegExp(p, 'i').test(answer))
      const pass = check.any ? missing.length < check.patterns.length : missing.length === 0
      return [pass, pass ? 'matched' : `no match for ${missing.join(', ')}`]
    }

    case 'answerExcludes': {
      const answer = replies(result)
      const found = check.patterns.filter(p => new RegExp(p, 'i').test(answer))
      return [found.length === 0, found.length ? `found ${found.join(', ')}` : 'none found']
    }

    case 'nodeTypesPresent': {
      const types = new Set(nodes.map(n => n.type))
      const missing = check.types.filter(t => !types.has(t))
      return [
        missing.length === 0,
        missing.length ? `missing ${missing.join(', ')}` : 'all present',
      ]
    }

    case 'edgesValid': {
      const problems = edges.flatMap(edge => edgeProblems(edge, result))
      return [
        problems.length === 0,
        problems.length ? problems.join('; ') : `${edges.length} valid`,
      ]
    }

    case 'edgeExists': {
      const typeOf = (id: string) => nodes.find(n => n.id === id)?.type
      const found = edges.some(
        edge =>
          (!check.source || edge.source === check.source) &&
          (!check.sourceType || typeOf(edge.source) === check.sourceType) &&
          (!check.sourceHandle || edge.sourceHandle === check.sourceHandle) &&
          (!check.target || edge.target === check.target) &&
          (!check.targetType || typeOf(edge.target) === check.targetType) &&
          edge.targetHandle === check.targetHandle
      )
      return [found, found ? 'found' : 'no matching edge']
    }

    case 'inputEquals': {
      const candidates = selectNodes(check, result)
      if (candidates.length === 0) return [false, 'no matching node']
      const values = candidates.map(id => result.finalOps[id]?.inputs[check.input])
      const pass = values.some(value => valuesMatch(value, check.value, check.tolerance ?? 0))
      return [pass, pass ? 'matched' : `got ${values.map(v => JSON.stringify(v)).join(', ')}`]
    }

    case 'inputMatches': {
      const candidates = selectNodes(check, result)
      if (candidates.length === 0) return [false, 'no matching node']
      const values = candidates.map(id => result.finalOps[id]?.inputs[check.input])
      const pattern = new RegExp(check.pattern, 'i')
      const pass = values.some(value => typeof value === 'string' && pattern.test(value))
      return [pass, pass ? 'matched' : `got ${values.map(v => JSON.stringify(v)).join(', ')}`]
    }

    case 'nodeCount': {
      const count = nodes.length
      const pass = count >= (check.min ?? 0) && count <= (check.max ?? Number.POSITIVE_INFINITY)
      return [pass, `${count} nodes`]
    }

    case 'applySucceeded': {
      const applies = result.turns.map(t => t.apply).filter(a => a !== null)
      const failed = applies.filter(a => !a.success)
      if (applies.length === 0) return [false, 'nothing was applied']
      return [
        failed.length === 0,
        failed.map(a => a.error).join('; ') || `${applies.length} applied`,
      ]
    }

    case 'noNewOperatorErrors': {
      const before = new Set(result.initialOperatorErrors.map(e => e.id))
      const added = result.operatorErrors.filter(e => !before.has(e.id))
      return [added.length === 0, added.map(e => `${e.id}: ${e.error}`).join('; ') || 'none']
    }

    case 'operatorErrorsFixed': {
      const after = new Set(result.operatorErrors.map(e => e.id))
      const remaining = result.initialOperatorErrors.filter(e => after.has(e.id))
      return [remaining.length === 0, remaining.map(e => e.id).join(', ') || 'all fixed']
    }

    case 'noConsoleErrors':
      return [consoleErrors.length === 0, consoleErrors.slice(0, 3).join('; ') || 'none']

    case 'anyOf': {
      const outcomes = check.checks.map(c => evaluate(c, { result, consoleErrors }))
      const pass = outcomes.some(([ok]) => ok)
      return [pass, outcomes.map(([, detail]) => detail).join(' | ')]
    }
  }
}

function replies(result: BenchResult) {
  return result.turns.map(t => t.reply).join('\n')
}

function selectNodes(selector: NodeSelector, result: BenchResult): string[] {
  const nodes = result.finalProject?.nodes ?? []
  if (selector.node) return nodes.some(n => n.id === selector.node) ? [selector.node] : []
  return nodes.filter(n => n.type === selector.nodeType).map(n => n.id)
}

type Edge = NonNullable<NonNullable<BenchResult['finalProject']>['edges']>[number]

function edgeProblems(edge: Edge, result: BenchResult): string[] {
  const nodes = result.finalProject?.nodes ?? []
  const problems: string[] = []
  const end = (id: string, handle: string | null | undefined, side: 'inputs' | 'outputs') => {
    const node = nodes.find(n => n.id === id)
    if (!node) return problems.push(`${edge.id}: no node ${id}`)
    const field = fieldName(handle)
    if (!field) return problems.push(`${edge.id}: malformed handle ${handle}`)
    const live = result.finalOps[id]
    const names = side === 'inputs' ? Object.keys(live?.inputs ?? {}) : (live?.outputs ?? [])
    const known = [...names, ...(result.registry[node.type]?.[side] ?? [])]
    if (!known.includes(field))
      problems.push(`${edge.id}: ${node.type} has no ${side.slice(0, -1)} ${field}`)
  }
  end(edge.source, edge.sourceHandle, 'outputs')
  end(edge.target, edge.targetHandle, 'inputs')
  return problems
}

// 'par.getFillColor' -> 'getFillColor'. Compound fields ('par.viewState.zoom')
// connect to the top-level field.
function fieldName(handle: string | null | undefined): string | null {
  const match = /^(par|out)\.([^.]+)/.exec(handle ?? '')
  return match ? match[2] : null
}

function valuesMatch(actual: unknown, expected: unknown, tolerance: number): boolean {
  const a = toColor(actual)
  const b = toColor(expected)
  if (a && b) return a.every((channel, i) => Math.abs(channel - b[i]) <= tolerance)

  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected) <= tolerance
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase()
  }
  return JSON.stringify(actual) === JSON.stringify(expected)
}

// '#f00', '#ff0000', '#ff0000ff' and [255, 0, 0(, 255)] all compare as RGBA
export function toColor(value: unknown): [number, number, number, number] | null {
  if (Array.isArray(value) && (value.length === 3 || value.length === 4)) {
    if (!value.every(v => typeof v === 'number')) return null
    return [value[0], value[1], value[2], value[3] ?? 255]
  }
  if (typeof value !== 'string') return null
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim())?.[1]
  if (!hex) return null
  const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex
  if (full.length !== 6 && full.length !== 8) return null
  const channels = full.match(/../g)?.map(pair => Number.parseInt(pair, 16)) ?? []
  return [channels[0], channels[1], channels[2], channels[3] ?? 255]
}
