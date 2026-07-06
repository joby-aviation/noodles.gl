// Grading orchestration (07 D4/D5): consumes ONLY stored run artifacts —
// re-runnable at any time without spawning sessions; judge calls are the only
// cost of a regrade; the app is never re-executed. Appends a series row per
// run to evals/results/index.json (kind: fresh | regrade).
//
//   npm run grade -- --series 2026-07-06.t0.abc123 [--run <runId>] [--samples 3]
//   npm run grade -- --series ... --regrade   # after a rubricVersion bump

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { JUDGE_MODEL, JUDGE_SAMPLES, PROVIDER, REPO_ROOT, RESULTS_ROOT, TASKS_ROOT, assertProviderEnv } from './lib/config'
import { buildJudgePrompt, judgeOnce, type JudgeSample } from './lib/judge'
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import { type KeyEntry } from './lib/matchers'
import { computeProcessMetrics } from './lib/process-metrics'
import type { Registry } from './lib/registry'
import { loadRubric, resolveApplicability } from './lib/rubric'
import { type MechanicalResults, type SeriesRow, reduceJudgeSamples, totalScore } from './lib/scoring'
import { loadTask } from './lib/task'

interface RunStore {
  runId: string
  runDir: string
  meta: Record<string, unknown>
  mechanical: MechanicalResults
  transcriptJsonl: string
  transcriptTxt: string
  artifacts: Map<string, string>
}

function loadRun(series: string, runId: string): RunStore {
  const runDir = path.join(RESULTS_ROOT, series, 'runs', runId)
  const artifacts = new Map<string, string>()
  const artifactsDir = path.join(runDir, 'artifacts')
  if (fs.existsSync(artifactsDir)) {
    for (const f of fs.readdirSync(artifactsDir)) {
      artifacts.set(f, fs.readFileSync(path.join(artifactsDir, f), 'utf-8'))
    }
  }
  return {
    runId,
    runDir,
    meta: JSON.parse(fs.readFileSync(path.join(runDir, 'session-meta.json'), 'utf-8')),
    mechanical: JSON.parse(fs.readFileSync(path.join(runDir, 'mechanical.json'), 'utf-8')),
    transcriptJsonl: fs.readFileSync(path.join(runDir, 'transcript.jsonl'), 'utf-8'),
    transcriptTxt: fs.readFileSync(path.join(runDir, 'transcript.txt'), 'utf-8'),
    artifacts,
  }
}

function loadSeriesRegistry(series: string): Registry {
  const raw = JSON.parse(fs.readFileSync(path.join(RESULTS_ROOT, series, 'registry.json'), 'utf-8'))
  return {
    types: new Set(raw.types),
    schemas: new Map(
      Object.entries(raw.schemas).map(([k, v]) => {
        const s = v as { inputs: string[]; outputs: string[]; inputsOpen?: boolean; outputsOpen?: boolean }
        return [
          k,
          {
            inputs: new Set(s.inputs),
            outputs: new Set(s.outputs),
            inputsOpen: s.inputsOpen ?? false,
            outputsOpen: s.outputsOpen ?? false,
          },
        ]
      })
    ),
  }
}

/** Judge-matched answer-key questions, resolved in one call (flagged in results). */
async function judgeAnswers(
  run: RunStore,
  key: KeyEntry[]
): Promise<{ correct: number; total: number; verdicts: Record<string, boolean> } | null> {
  const judgeEntries = key.filter(k => k.match === 'judge')
  if (judgeEntries.length === 0) return { correct: 0, total: 0, verdicts: {} }
  const answersRaw = run.artifacts.get('answers.json')
  if (!answersRaw) return null
  let answers: Record<string, unknown>
  try {
    answers = JSON.parse(answersRaw)
  } catch {
    return null
  }
  const questions = JSON.parse(
    fs.readFileSync(path.join(TASKS_ROOT, 'fixtures', 'contextualize-questions.json'), 'utf-8')
  ).questions as Array<{ id: string; question: string }>
  const items = judgeEntries.map(e => ({
    id: e.id,
    question: questions.find(q => q.id === e.id)?.question ?? '',
    expected: e.expected,
    answer: answers[e.id] ?? null,
  }))
  const prompt = `You are grading factual answers against an answer key. For each item decide whether the answer states the facts the key requires (the "Credit:" clause is the bar). Phrasing differences are fine; missing or contradicting the required facts is not. Return ONLY JSON: {"verdicts": {"<id>": true|false, ...}}\n\n${JSON.stringify(items, null, 1)}`
  const client = new AnthropicBedrock({ awsRegion: process.env.AWS_REGION })
  const message = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('\n')
  const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as { verdicts?: Record<string, boolean> }
  const verdicts = parsed.verdicts ?? {}
  const correct = judgeEntries.filter(e => verdicts[e.id] === true).length
  return { correct, total: judgeEntries.length, verdicts }
}

export async function gradeRun(series: string, runId: string, samples: number, regrade: boolean): Promise<SeriesRow> {
  const run = loadRun(series, runId)
  const task = loadTask(String(run.meta.taskId))
  const rubric = resolveApplicability(loadRubric(task.grader.rubric), task.tags)
  const registry = loadSeriesRegistry(series)

  // Layer 3 — parser-computed, deterministic from stored inputs.
  let finalProject: Parameters<typeof computeProcessMetrics>[1] = null
  const projectRaw = run.artifacts.get('noodles.json')
  if (projectRaw) {
    try {
      finalProject = JSON.parse(projectRaw)
    } catch {
      finalProject = null
    }
  }
  const process3 = computeProcessMetrics(run.transcriptJsonl, finalProject, registry)

  // Knowledge tasks: resolve judge-matched answer-key questions.
  let mechanicalScore = run.mechanical.score0to4
  let answersJudged: { correct: number; total: number; verdicts: Record<string, boolean> } | null = null
  if (task.grader.mechanical.answers) {
    const key = (
      JSON.parse(fs.readFileSync(path.join(TASKS_ROOT, task.grader.mechanical.answers.key), 'utf-8')) as {
        answers: KeyEntry[]
      }
    ).answers
    answersJudged = await judgeAnswers(run, key)
    const det = run.mechanical.answersDeterministic ?? { correct: 0, total: 0 }
    const total = det.total + (answersJudged?.total ?? 0)
    const correct = det.correct + (answersJudged?.correct ?? 0)
    mechanicalScore = total > 0 ? (4 * correct) / total : 0
  }

  // Layer 2 — rubric judge, 3 samples, median, evidence-checked.
  const artifactsRendered = [...run.artifacts]
    .map(([name, content]) => {
      const numbered = content
        .split('\n')
        .map((line, i) => `${name}:${i + 1}: ${line}`)
        .join('\n')
      return `--- ${name} ---\n${numbered}`
    })
    .join('\n\n')
  const artifactLineCounts = new Map([...run.artifacts].map(([name, c]) => [name, c.split('\n').length]))
  const transcriptLineCount = run.transcriptTxt.split('\n').length
  // Citation resolver: stored artifacts first, then repo files at the run's
  // commit (judges legitimately cite workspace sources like operators.ts).
  const repoFileCache = new Map<string, number | undefined>()
  const resolveFileLines = (cited: string): number | undefined => {
    const base = path.basename(cited)
    if (artifactLineCounts.has(base)) return artifactLineCounts.get(base)
    if (repoFileCache.has(cited)) return repoFileCache.get(cited)
    let lines: number | undefined
    const candidates = [cited.replace(/^\.\//, ''), `noodles-editor/${cited}`, `noodles-editor/src/${cited}`]
    try {
      // Judges often cite by basename (operators.ts:4964) — resolve it against
      // the commit's file tree.
      const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', String(run.meta.commit)], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
      }).split('\n')
      const suffix = `/${base}`
      const byBasename = tree.find(p => p.endsWith(suffix) || p === base)
      if (byBasename) candidates.push(byBasename)
    } catch {
      /* tree unavailable; positional candidates only */
    }
    for (const candidate of candidates) {
      try {
        const content = execFileSync('git', ['show', `${run.meta.commit}:${candidate}`], {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          maxBuffer: 64 * 1024 * 1024,
        })
        lines = content.split('\n').length
        break
      } catch {
        /* try next candidate */
      }
    }
    repoFileCache.set(cited, lines)
    return lines
  }
  const prompt = buildJudgePrompt({
    task: `${task.prompt}\n\n(budget: ${task.budget.maxTurns} turns / ${task.budget.maxWallClockSeconds}s; session ${run.meta.timedOut ? 'HIT the wall-clock budget' : 'finished within budget'})`,
    rubric,
    mechanical: JSON.stringify({ ...run.mechanical, processMetrics: process3 }, null, 1),
    artifacts: artifactsRendered || '(no artifacts produced)',
    transcript: run.transcriptTxt,
  })

  const judgeSamples: JudgeSample[] = []
  for (let i = 0; i < samples; i++) {
    console.log(`[${runId}] judge sample ${i + 1}/${samples}`)
    judgeSamples.push(await judgeOnce(prompt, rubric, transcriptLineCount, resolveFileLines))
  }
  const judgeScore = reduceJudgeSamples(judgeSamples, rubric)
  const mechanicalForTotal = { ...run.mechanical, score0to4: mechanicalScore }
  const total = totalScore(mechanicalForTotal, judgeScore.weighted0to4)

  // Series row (D6 + phase-0 amendments).
  const index = readIndex()
  const prior = index.rows.filter(r => r.runId === runId && r.series === series)
  const row: SeriesRow & { series: string; rowId: string } = {
    rowId: `${runId}@r${rubric.rubricVersion}.${new Date().toISOString()}`,
    series,
    runId,
    artifactsRef: `${series}/runs/${runId}`,
    commit: String(run.meta.commit),
    tier: String(run.meta.tier),
    taskId: task.id,
    taskVersion: task.taskVersion,
    validatorVersion: run.mechanical.validatorVersion, // frozen; never changes on regrade
    kind: regrade && prior.length > 0 ? 'regrade' : 'fresh',
    ...(regrade && prior.length > 0 ? { regradeOf: (prior.at(-1) as { rowId: string }).rowId } : {}),
    gradedAt: new Date().toISOString(),
    rubricVersion: rubric.rubricVersion,
    judgeModel: JUDGE_MODEL,
    sessionModel: String(run.meta.sessionModel),
    provider: PROVIDER,
    region: String(run.meta.region),
    isolationAudit: (run.meta.isolationAudit as { pass: boolean })?.pass ? 'pass' : 'fail',
    scores: {
      mechanical: round(mechanicalScore),
      judge: round(judgeScore.weighted0to4),
      total: round(total),
      process: { ...process3, hallucinatedHandles: process3.hallucinatedHandles.length },
    },
    cost: { sessionUsd: (run.meta.costUsd as number | null) ?? null, judgeUsd: null },
    lane: 'milestone',
  }
  index.rows.push(row)
  writeIndex(index)

  fs.writeFileSync(
    path.join(run.runDir, 'scores.json'),
    JSON.stringify(
      {
        row,
        judge: { perDimension: judgeScore.perDimension, samples: judgeSamples.map(s => ({ dimensions: s.dimensions, citationCheck: s.citationCheck })) },
        answersJudged,
        processMetrics: process3,
      },
      null,
      1
    )
  )
  console.log(
    `[${runId}] graded: mechanical=${row.scores.mechanical} judge=${row.scores.judge} total=${row.scores.total} (${row.kind})`
  )
  return row
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

interface SeriesIndex {
  rows: Array<SeriesRow & { series: string; rowId: string }>
}

function indexPath(): string {
  return path.join(RESULTS_ROOT, 'index.json')
}

export function readIndex(): SeriesIndex {
  if (!fs.existsSync(indexPath())) return { rows: [] }
  return JSON.parse(fs.readFileSync(indexPath(), 'utf-8'))
}

function writeIndex(index: SeriesIndex): void {
  fs.writeFileSync(indexPath(), JSON.stringify(index, null, 1))
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  assertProviderEnv()
  const argv = process.argv.slice(2)
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const series = get('series')
  if (!series) throw new Error('missing --series')
  const samples = Number.parseInt(get('samples', String(JUDGE_SAMPLES)) as string, 10)
  const regrade = argv.includes('--regrade')
  const only = get('run')
  const runsDir = path.join(RESULTS_ROOT, series, 'runs')
  const runIds = only ? [only] : fs.readdirSync(runsDir).sort()
  for (const runId of runIds) {
    await gradeRun(series, runId, samples, regrade)
  }
}
