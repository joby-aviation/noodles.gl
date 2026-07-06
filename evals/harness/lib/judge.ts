// Judge orchestration (07 D4): 3 independent samples per run, median per
// dimension, evidence citation required per score and verified to resolve.
// The judge is blind to tier, session model, and hypothesis. Calls go through
// the classic AnthropicBedrock client (bedrock-runtime InvokeModel): the
// intended AnthropicBedrockMantle endpoint does not serve the pinned models
// in this account/region (persistent 404s for every naming form; see the
// journal entry for 2026-07-06) — same messages.create surface either way.

import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { JUDGE_MODEL, RUBRICS_ROOT } from './config'
import { type Rubric, renderRubric } from './rubric'

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
  citationCheck: { checked: number; resolved: number; unresolved: string[] }
  raw: string
}

let client: AnthropicBedrock | null = null
function bedrock(): AnthropicBedrock {
  if (!client) client = new AnthropicBedrock({ awsRegion: process.env.AWS_REGION })
  return client
}

export function buildJudgePrompt(slots: {
  task: string
  rubric: Rubric
  mechanical: string
  artifacts: string
  transcript: string
}): string {
  const template = fs.readFileSync(path.join(RUBRICS_ROOT, 'judge-prompt.md'), 'utf-8')
  return template
    .replace('{{TASK}}', slots.task)
    .replace('{{RUBRIC}}', renderRubric(slots.rubric))
    .replace('{{MECHANICAL}}', slots.mechanical)
    .replace('{{ARTIFACTS}}', truncateMiddle(slots.artifacts, 60_000))
    .replace('{{TRANSCRIPT}}', truncateMiddle(slots.transcript, 400_000))
}

export async function judgeOnce(
  prompt: string,
  rubric: Rubric,
  transcriptLineCount: number,
  artifactLineCounts: Map<string, number>
): Promise<JudgeSample> {
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await bedrock().messages.create({
      model: JUDGE_MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was invalid (${lastError}). Return ONLY the JSON object in the required format.` }],
    })
    const text = message.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
    try {
      const parsed = parseJudgeJson(text, rubric)
      const citationCheck = checkCitations(parsed, transcriptLineCount, artifactLineCounts)
      return { ...parsed, citationCheck, raw: text }
    } catch (e) {
      lastError = (e as Error).message
    }
  }
  throw new Error(`judge sample invalid after retry: ${lastError}`)
}

function parseJudgeJson(
  text: string,
  rubric: Rubric
): { dimensions: Record<string, DimensionJudgment>; notes?: string } {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('no JSON object in reply')
  const raw = JSON.parse(jsonMatch[0]) as { dimensions?: Record<string, DimensionJudgment>; notes?: string }
  if (!raw.dimensions) throw new Error('missing dimensions')
  const parsed = { dimensions: raw.dimensions, notes: raw.notes }

  for (const dim of rubric.dimensions) {
    const judged = parsed.dimensions[dim.name]
    if (!judged) throw new Error(`dimension ${dim.name} not scored`)
    if (dim.style === 'anchors') {
      if (typeof judged.level !== 'number' || judged.level < 0 || judged.level > 4 || !Number.isInteger(judged.level)) {
        throw new Error(`dimension ${dim.name}: level must be an integer 0-4`)
      }
      if (!judged.evidence || judged.evidence.trim().length === 0) {
        throw new Error(`dimension ${dim.name}: evidence citation required for every score`)
      }
    } else {
      for (const c of dim.criteria ?? []) {
        const verdict = judged.criteria?.[c.id]
        if (!verdict || !['pass', 'fail', 'na'].includes(verdict.verdict)) {
          throw new Error(`criterion ${dim.name}.${c.id}: verdict pass|fail|na required`)
        }
        if (!verdict.evidence || verdict.evidence.trim().length === 0) {
          throw new Error(`criterion ${dim.name}.${c.id}: evidence citation required`)
        }
      }
    }
  }
  return parsed
}

/** Verify that cited locations resolve: L<n> within the transcript, file:line
 * within a provided artifact (Verification item 4's automated half). */
export function checkCitations(
  parsed: { dimensions: Record<string, DimensionJudgment> },
  transcriptLineCount: number,
  artifactLineCounts: Map<string, number>
): { checked: number; resolved: number; unresolved: string[] } {
  let checked = 0
  let resolved = 0
  const unresolved: string[] = []
  const evidences: string[] = []
  for (const judged of Object.values(parsed.dimensions)) {
    if (judged.evidence) evidences.push(judged.evidence)
    for (const c of Object.values(judged.criteria ?? {})) evidences.push(c.evidence)
  }
  for (const evidence of evidences) {
    for (const m of evidence.matchAll(/\bL(\d+)\b/g)) {
      checked++
      if (Number.parseInt(m[1], 10) <= transcriptLineCount) resolved++
      else unresolved.push(`L${m[1]} > transcript length ${transcriptLineCount}`)
    }
    for (const m of evidence.matchAll(/([\w./-]+\.(?:json|ts|tsx|csv|md)):(\d+)/g)) {
      checked++
      const base = path.basename(m[1])
      const lineCount = artifactLineCounts.get(base)
      if (lineCount !== undefined && Number.parseInt(m[2], 10) <= lineCount) resolved++
      else unresolved.push(`${m[1]}:${m[2]} does not resolve`)
    }
  }
  return { checked, resolved, unresolved }
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s
  const half = Math.floor(max / 2)
  return `${s.slice(0, half)}\n...[middle truncated: ${s.length - max} chars]...\n${s.slice(-half)}`
}
