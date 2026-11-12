// Deterministic grading for one benchmark run. Every check reads only the
// BenchResult the page hook returned (plus console errors the runner saw), so a
// raw result file can be re-graded after a check changes without re-running it.
//
// Scoring follows PR #509's scale: 0–4, the fraction of checks passed, capped at
// 40% (1.6) when a mechanical check fails — a run that left the graph broken is
// not rescued by a good answer.

import { type DocEdge, nodePath } from '@noodles.gl/planner'
import type { BenchResult } from '../../src/ai-chat/bench/bench-hook'

// A node is selected by id or path (`/pickup-layer`), or by operator type when the agent was
// free to name it. With a type, the check passes if any node of that type satisfies it.
interface NodeSelector {
  node?: string
  op?: string
}

export type Check =
  // Regexes (case-insensitive) against every reply of the run joined together
  | { type: 'answerMatches'; patterns: string[]; any?: boolean }
  | { type: 'answerExcludes'; patterns: string[] }
  | { type: 'opsPresent'; ops: string[] }
  // Every edge joins nodes that exist, at ports their operators have
  | { type: 'edgesValid' }
  // Ends named by node (id or path) or by operator type; a port left out matches any
  | {
      type: 'edgeExists'
      source?: string
      sourceOp?: string
      sourcePort?: string
      target?: string
      targetOp?: string
      targetPort?: string
    }
  // tolerance is per channel for colors, absolute for numbers
  | ({ type: 'paramEquals'; param: string; value: unknown; tolerance?: number } & NodeSelector)
  // Regex (case-insensitive) against a string parameter, e.g. an attribute's expression
  | ({ type: 'paramMatches'; param: string; pattern: string } & NodeSelector)
  | { type: 'nodeCount'; min?: number; max?: number }
  // The agent changed the document, and nothing it changed was rejected at the end
  | { type: 'applySucceeded' }
  // No node is in error that was not already before the first turn
  | { type: 'noNewErrors' }
  // Every node that was in error before the first turn is no longer
  | { type: 'errorsFixed' }
  | { type: 'noConsoleErrors' }
  | { type: 'anyOf'; checks: Check[] }
  | { type: 'allOf'; checks: Check[] }

// Checks that describe whether the graph still works rather than whether the
// task was done. Failing one caps the score.
const MECHANICAL = new Set<Check['type']>([
  'edgesValid',
  'applySucceeded',
  'noNewErrors',
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
  // A run that never completed a turn has nothing to grade, and one that timed out
  // or failed partway is unfinished whatever its partial answer says
  const unfinished =
    input.result.turns.length === 0
      ? (input.result.error ?? 'no turn completed')
      : input.result.timedOut
        ? 'timed out before the last turn finished'
        : input.result.error
  if (unfinished) {
    return {
      score: 0,
      pass: false,
      mechanicalFailure: true,
      checks: checks.map(check => ({
        check,
        pass: false,
        mechanical: MECHANICAL.has(check.type),
        detail: unfinished,
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
  const nodes = result.finalDoc?.nodes ?? []
  const edges = result.finalDoc?.edges ?? []

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

    case 'opsPresent': {
      const types = new Set(nodes.map(n => n.op))
      const missing = check.ops.filter(t => !types.has(t))
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
      const ends = (id: string, node?: string, op?: string) =>
        (!node || selectNodes({ node }, result).includes(id)) &&
        (!op || nodes.find(n => n.id === id)?.op === op)
      const found = edges.some(
        edge =>
          ends(edge.source, check.source, check.sourceOp) &&
          (!check.sourcePort || edge.sourcePort === check.sourcePort) &&
          ends(edge.target, check.target, check.targetOp) &&
          (!check.targetPort || edge.targetPort === check.targetPort)
      )
      return [found, found ? 'found' : 'no matching edge']
    }

    case 'paramEquals': {
      const candidates = selectNodes(check, result)
      if (candidates.length === 0) return [false, 'no matching node']
      const values = candidates.map(id => result.finalParams[id]?.[check.param])
      const pass = values.some(value => valuesMatch(value, check.value, check.tolerance ?? 0))
      return [pass, pass ? 'matched' : `got ${values.map(v => JSON.stringify(v)).join(', ')}`]
    }

    case 'paramMatches': {
      const candidates = selectNodes(check, result)
      if (candidates.length === 0) return [false, 'no matching node']
      const values = candidates.map(id => result.finalParams[id]?.[check.param])
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
      // Edit tools apply as they run, so a call the editor rejected and the model then fixed
      // is not a failure; JSON the model wrote out instead is applied after the turn
      const edits = result.turns.flatMap(t => t.toolCalls).filter(c => EDIT_TOOLS.has(c.name))
      const applied = edits.filter(c => c.success).length
      const late = result.turns.map(t => t.apply).filter(a => a !== null)
      const failed = late.filter(a => !a.success)
      const total = applied + late.length - failed.length
      if (total === 0 && failed.length === 0) return [false, 'nothing was applied']
      return [failed.length === 0, failed.map(a => a.error).join('; ') || `${total} applied`]
    }

    case 'noNewErrors': {
      const before = new Set(result.initialErrors.map(e => e.id))
      const added = result.errors.filter(e => !before.has(e.id))
      return [added.length === 0, added.map(e => `${e.id}: ${e.error}`).join('; ') || 'none']
    }

    case 'errorsFixed': {
      const after = new Set(result.errors.map(e => e.id))
      const remaining = result.initialErrors.filter(e => after.has(e.id))
      return [remaining.length === 0, remaining.map(e => e.id).join(', ') || 'all fixed']
    }

    case 'noConsoleErrors':
      return [consoleErrors.length === 0, consoleErrors.slice(0, 3).join('; ') || 'none']

    case 'anyOf': {
      const outcomes = check.checks.map(c => evaluate(c, { result, consoleErrors }))
      const pass = outcomes.some(([ok]) => ok)
      return [pass, outcomes.map(([, detail]) => detail).join(' | ')]
    }

    case 'allOf': {
      const outcomes = check.checks.map(c => evaluate(c, { result, consoleErrors }))
      const pass = outcomes.every(([ok]) => ok)
      return [pass, outcomes.map(([, detail]) => detail).join(' & ')]
    }
  }
}

function replies(result: BenchResult) {
  return result.turns.map(t => t.reply).join('\n')
}

// The tools that change the document
const EDIT_TOOLS = new Set(['apply_modifications', 'set_keyframe', 'delete_keyframe'])

function selectNodes(selector: NodeSelector, result: BenchResult): string[] {
  const doc = result.finalDoc
  if (!doc) return []
  if (selector.node) {
    const hit = doc.nodes.find(n => n.id === selector.node || nodePath(doc, n) === selector.node)
    return hit ? [hit.id] : []
  }
  return doc.nodes.filter(n => n.op === selector.op).map(n => n.id)
}

// Subnets' ports are their input and output nodes, which the registry cannot list
const OPEN_PORTS = new Set(['subnet', 'subnet-input', 'subnet-output'])

function edgeProblems(edge: DocEdge, result: BenchResult): string[] {
  const nodes = result.finalDoc?.nodes ?? []
  const problems: string[] = []
  const end = (id: string, port: string, side: 'inputs' | 'outputs') => {
    const node = nodes.find(n => n.id === id)
    if (!node) return problems.push(`${edge.id}: no node ${id}`)
    if (OPEN_PORTS.has(node.op)) return
    const known = result.registry[node.op]?.[side] ?? []
    if (!known.includes(port))
      problems.push(`${edge.id}: ${node.op} has no ${side.slice(0, -1)} ${port}`)
  }
  end(edge.source, edge.sourcePort, 'outputs')
  end(edge.target, edge.targetPort, 'inputs')
  return problems
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
