// The optional Claude judge, ported from PR #509 (evals/harness/lib/judge.ts,
// rubric.ts, scoring.ts). A rubric of anchors and checklist dimensions, a judge
// that must cite a transcript line or artifact line for every score, several
// samples reduced to a median per dimension, and a total that blends the
// deterministic score with the judge's and keeps the 40% mechanical cap.
//
// Pure: prompt building, reply parsing and scoring only. judge-run.ts makes the
// Bedrock calls, so these run in the browser test runner like grade.ts does.

import yaml from 'js-yaml'
import type { BenchResult } from '../../src/ai-chat/bench/bench-hook'
import { type Grade, MECHANICAL_FAILURE_CAP } from './grade'
import type { Task } from './tasks'

export interface ChecklistCriterion {
  id: string
  text: string
  // 'tag:<name>', matched against the task's tags before the judge is called
  applicable_when?: string
}

export interface RubricDimension {
  name: string
  style: 'anchors' | 'checklist'
  weight: number
  informational?: boolean
  criteria?: ChecklistCriterion[]
  levels?: Record<number, string>
}

export interface Rubric {
  rubricVersion: number
  family: string
  dimensions: RubricDimension[]
}

export interface CriterionVerdict {
  verdict: 'pass' | 'fail' | 'na'
  evidence: string
}

export interface DimensionJudgment {
  style: 'anchors' | 'checklist'
  level?: number
  evidence?: string
  criteria?: Record<string, CriterionVerdict>
}

export interface JudgeSample {
  dimensions: Record<string, DimensionJudgment>
  notes?: string
  citations: { checked: number; resolved: number; unresolved: string[] }
}

export interface JudgeScore {
  perDimension: Record<string, { samples: number[]; median: number }>
  // Weighted over non-informational dimensions, 0–4
  weighted: number
}

// Rejects a rubric with a bare scale: every dimension needs anchors for all five
// levels or a list of criteria, and a weight
export function parseRubric(text: string, source: string): Rubric {
  const raw = (yaml.load(text) ?? {}) as Record<string, unknown>
  const fail = (message: string) => new Error(`${source}: ${message}`)
  if (typeof raw.rubricVersion !== 'number') throw fail('missing rubricVersion')

  const dimensions: RubricDimension[] = []
  const entries = Object.entries((raw.dimensions ?? {}) as Record<string, Record<string, unknown>>)
  for (const [name, dim] of entries) {
    if (dim.style !== 'anchors' && dim.style !== 'checklist') {
      throw fail(`dimension "${name}" needs style anchors or checklist — no bare scales`)
    }
    if (dim.style === 'anchors') {
      const keys = Object.keys((dim.levels ?? {}) as object).map(Number)
      if (keys.length !== 5 || ![0, 1, 2, 3, 4].every(k => keys.includes(k))) {
        throw fail(`anchors dimension "${name}" must describe every level 0-4`)
      }
    } else {
      const criteria = dim.criteria as ChecklistCriterion[] | undefined
      if (
        !Array.isArray(criteria) ||
        criteria.length === 0 ||
        criteria.some(c => !c.id || !c.text)
      ) {
        throw fail(`checklist dimension "${name}" needs criteria with id and text`)
      }
    }
    if (typeof dim.weight !== 'number') throw fail(`dimension "${name}" has no weight`)
    dimensions.push({ name, ...dim } as RubricDimension)
  }
  if (dimensions.length === 0) throw fail('no dimensions')
  return { rubricVersion: raw.rubricVersion, family: String(raw.family ?? ''), dimensions }
}

// Drops tagged criteria the task does not carry, so the judge never decides
// what applies
export function resolveApplicability(rubric: Rubric, tags: string[]): Rubric {
  const dimensions = rubric.dimensions.map(dim => {
    if (!dim.criteria) return dim
    const criteria = dim.criteria.filter(c => {
      if (!c.applicable_when) return true
      const match = /^tag:([\w-]+)$/.exec(c.applicable_when)
      if (!match) throw new Error(`applicable_when "${c.applicable_when}" is not tag:<name>`)
      return tags.includes(match[1])
    })
    return { ...dim, criteria }
  })
  return { ...rubric, dimensions }
}

export function renderRubric(rubric: Rubric): string {
  const parts: string[] = []
  for (const dim of rubric.dimensions) {
    parts.push(`### ${dim.name} (style: ${dim.style}${dim.informational ? ', informational' : ''})`)
    if (dim.levels) {
      for (const level of [0, 1, 2, 3, 4]) parts.push(`- level ${level}: ${dim.levels[level]}`)
    }
    for (const c of dim.criteria ?? []) parts.push(`- [${c.id}] ${c.text}`)
    parts.push('')
  }
  return parts.join('\n')
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}… [${text.length - max} more chars]` : text

// One event per line so the judge can cite L<n>. Newlines inside a reply are
// flattened for the same reason.
export function renderTranscript(result: BenchResult): string[] {
  const lines: string[] = []
  const flat = (text: string) => text.replace(/\s*\n\s*/g, ' ⏎ ')
  if (result.setupApply) lines.push('[setup] the project was modified before the session began')
  result.turns.forEach((turn, i) => {
    lines.push(`[turn ${i + 1}] [user] ${flat(turn.prompt)}`)
    for (const call of turn.toolCalls) {
      const outcome = call.success ? 'ok' : `error: ${call.error ?? 'failed'}`
      lines.push(
        `[tool] ${call.name}(${clip(JSON.stringify(call.params), 600)}) → ${outcome} ${flat(call.preview)}`
      )
    }
    for (const d of turn.diagnostics) {
      lines.push(`[harness] ${d.kind}${d.detail ? `: ${flat(d.detail)}` : ''}`)
    }
    lines.push(`[assistant] ${flat(turn.reply) || '(no reply text)'}`)
    if (turn.apply) {
      lines.push(
        `[editor] applied ${turn.modificationsCount} modification(s): ${
          turn.apply.success ? 'success' : `failed: ${turn.apply.error ?? 'unknown error'}`
        }`
      )
    }
    // The loop stops on tool_use either at its step limit or on the third
    // identical call (REPEAT_LIMIT in agent/loop.ts), which it reports as
    // repeated_tool_call "<name> ×3"
    if (turn.stopReasons.at(-1) === 'tool_use') {
      const repeated = turn.diagnostics.some(
        d => d.kind === 'repeated_tool_call' && Number(d.detail?.match(/×(\d+)$/)?.[1]) >= 3
      )
      lines.push(
        repeated
          ? '[harness] stopped: the same tool call was repeated 3 times'
          : '[harness] budget-exhausted: step limit'
      )
    }
  })
  if (result.timedOut) lines.push('[harness] budget-exhausted: wall clock')
  if (result.error) lines.push(`[harness] error: ${flat(result.error)}`)
  return lines
}

export interface Artifact {
  name: string
  lines: string[]
}

export function artifacts(result: BenchResult): Artifact[] {
  const json = (value: unknown) => JSON.stringify(value, null, 2).split('\n')
  return [
    ...(result.initialDoc ? [{ name: 'start-doc.json', lines: json(result.initialDoc) }] : []),
    { name: 'doc.json', lines: json(result.finalDoc) },
    { name: 'params.json', lines: json(result.finalParams) },
  ]
}

const numbered = (lines: string[], prefix: string) =>
  lines.map((line, i) => `${prefix}${i + 1}: ${line}`).join('\n')

// Keeps the head and tail of an oversized slot; the middle of a big project is
// the least likely place for the edit
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const half = Math.floor(max / 2)
  return `${text.slice(0, half)}\n…[middle truncated: ${text.length - max} chars]…\n${text.slice(-half)}`
}

export function buildJudgePrompt(
  template: string,
  slots: { task: Task; rubric: Rubric; result: BenchResult; grade: Grade }
): string {
  const { task, rubric, result, grade } = slots
  const taskText = [
    `Tier ${task.tier} (${task.family}). Starting project: ${task.start}.`,
    '',
    ...task.turns.map((t, i) => (i === 0 ? t : `Follow-up ${i}: ${t}`)),
  ].join('\n')
  const mechanical = grade.checks
    .map(c => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.check.type}: ${c.detail}`)
    .join('\n')
  const artifactText = artifacts(result)
    .map(a => `### ${a.name}\n\n${truncateMiddle(numbered(a.lines, `${a.name}:`), 60_000)}`)
    .join('\n\n')
  // Function replacers, so a $ in the content is not read as a replacement pattern
  return template
    .replace('{{TASK}}', () => taskText)
    .replace('{{RUBRIC}}', () => renderRubric(rubric))
    .replace('{{MECHANICAL}}', () => mechanical)
    .replace('{{ARTIFACTS}}', () => artifactText)
    .replace('{{TRANSCRIPT}}', () =>
      truncateMiddle(numbered(renderTranscript(result), 'L'), 200_000)
    )
}

// Throws on anything the harness cannot score, so the caller can ask once more
export function parseJudgeReply(
  text: string,
  rubric: Rubric
): Pick<JudgeSample, 'dimensions' | 'notes'> {
  const json = /\{[\s\S]*\}/.exec(text)
  if (!json) throw new Error('no JSON object in reply')
  const raw = JSON.parse(json[0]) as {
    dimensions?: Record<string, DimensionJudgment>
    notes?: string
  }
  if (!raw.dimensions) throw new Error('missing dimensions')

  for (const dim of rubric.dimensions) {
    const judged = raw.dimensions[dim.name]
    if (!judged) throw new Error(`dimension ${dim.name} not scored`)
    if (dim.style === 'anchors') {
      if (
        !Number.isInteger(judged.level) ||
        (judged.level as number) < 0 ||
        (judged.level as number) > 4
      ) {
        throw new Error(`dimension ${dim.name}: level must be an integer 0-4`)
      }
      if (!judged.evidence?.trim()) throw new Error(`dimension ${dim.name}: evidence required`)
    } else {
      for (const c of dim.criteria ?? []) {
        const verdict = judged.criteria?.[c.id]
        if (!verdict || !['pass', 'fail', 'na'].includes(verdict.verdict)) {
          throw new Error(`criterion ${dim.name}.${c.id}: verdict pass|fail|na required`)
        }
        if (!verdict.evidence?.trim()) {
          throw new Error(`criterion ${dim.name}.${c.id}: evidence required`)
        }
      }
    }
  }
  return { dimensions: raw.dimensions, notes: raw.notes }
}

// Every L<n> and file:line the judge cited has to exist. Unresolved citations
// are recorded, not fatal: they flag a judge sample worth reading by hand.
export function checkCitations(
  dimensions: Record<string, DimensionJudgment>,
  transcriptLines: number,
  artifactLines: Record<string, number>
): JudgeSample['citations'] {
  const evidence = Object.values(dimensions).flatMap(d => [
    d.evidence ?? '',
    ...Object.values(d.criteria ?? {}).map(c => c.evidence),
  ])
  let checked = 0
  let resolved = 0
  const unresolved: string[] = []
  for (const text of evidence) {
    for (const m of text.matchAll(/\bL(\d+)\b/g)) {
      checked++
      if (Number(m[1]) >= 1 && Number(m[1]) <= transcriptLines) resolved++
      else unresolved.push(`L${m[1]} (transcript has ${transcriptLines} lines)`)
    }
    for (const m of text.matchAll(/([\w.-]+\.json):(\d+)/g)) {
      checked++
      const count = artifactLines[m[1]]
      if (count !== undefined && Number(m[2]) >= 1 && Number(m[2]) <= count) resolved++
      else unresolved.push(`${m[1]}:${m[2]} does not resolve`)
    }
  }
  return { checked, resolved, unresolved }
}

// Zero samples would save a judgment of 0 without asking the judge anything, and
// later runs skip a judged file unless --force
export function assertSampleCount(samples: number) {
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`samples must be a positive integer, got ${samples}`)
  }
}

// NaN when every criterion is na, which drops the dimension from the weighting
export function dimensionScore(sample: JudgeSample, dim: RubricDimension): number {
  const judged = sample.dimensions[dim.name]
  if (dim.style === 'anchors') return judged?.level ?? 0
  // Only the rubric's own criteria count: the reply may carry invented ones, or
  // ones resolveApplicability removed for this task
  const applicable = (dim.criteria ?? [])
    .map(c => judged?.criteria?.[c.id])
    .filter((v): v is NonNullable<typeof v> => v !== undefined && v.verdict !== 'na')
  if (applicable.length === 0) return Number.NaN
  return (4 * applicable.filter(v => v.verdict === 'pass').length) / applicable.length
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function reduceSamples(samples: JudgeSample[], rubric: Rubric): JudgeScore {
  const perDimension: JudgeScore['perDimension'] = {}
  let sum = 0
  let weights = 0
  for (const dim of rubric.dimensions) {
    const scores = samples.map(s => dimensionScore(s, dim)).filter(v => !Number.isNaN(v))
    const med = scores.length ? median(scores) : Number.NaN
    perDimension[dim.name] = { samples: scores, median: med }
    if (!dim.informational && dim.weight > 0 && !Number.isNaN(med)) {
      sum += dim.weight * med
      weights += dim.weight
    }
  }
  return { perDimension, weighted: weights ? sum / weights : 0 }
}

// #509's blend: half deterministic, half judge, and a broken graph stays capped
// however good the transcript reads
export function totalScore(grade: Grade, judge: number): number {
  const blended = 0.5 * grade.score + 0.5 * judge
  return grade.mechanicalFailure ? Math.min(blended, MECHANICAL_FAILURE_CAP) : blended
}
