#!/usr/bin/env tsx

// Runs the Claude judge over a finished benchmark run.
//
//   npm run bench:agent:judge -- bench/agent/results/raw/<runId>
//   npm run bench:agent:judge -- bench/agent/results/raw/<runId> --tiers T1,T2,T3,T4 --samples 1
//
// Flags:
//   --tiers    which tiers to judge. Default T3,T4: T1/T2 deterministic checks
//              already say most of what matters, and judging costs money.
//   --samples  judge samples per run, reduced to a median. Default 3, as in #509.
//   --model    Bedrock model id. Default BENCH_JUDGE_MODEL or Opus 5.5.
//   --force    re-judge runs that already have a judgment.
//
// Credentials come from the default AWS chain (AWS_PROFILE, SSO, env keys) and
// the region from AWS_REGION. The judgment is written back into each raw file,
// and the judge score into the run's summary so the report shows it.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import type { BenchResult } from '../../src/ai-chat/bench/bench-hook'
import type { Grade } from './grade'
import {
  artifacts,
  buildJudgePrompt,
  checkCitations,
  type JudgeSample,
  type JudgeScore,
  parseJudgeReply,
  parseRubric,
  type Rubric,
  reduceSamples,
  renderTranscript,
  resolveApplicability,
  totalScore,
} from './judge'
import type { RunRow, Summary } from './summary'
import type { Task, Tier } from './tasks'

const here = dirname(fileURLToPath(import.meta.url))
const rubricsDir = join(here, 'rubrics')
const DEFAULT_RUBRIC = 'in-app.yaml'
export const DEFAULT_JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL ?? 'us.anthropic.claude-opus-5-5'

export interface RawRun {
  task: Task
  knobs: unknown
  result: BenchResult
  consoleErrors: string[]
  grade: Grade
  // Written by run.ts so the judge can find the summary row; absent in older files
  row?: RunRow
  judge?: {
    model: string
    rubricVersion: number
    samples: JudgeSample[]
    score: JudgeScore
    total: number
  }
}

export interface JudgeOptions {
  tiers: Tier[]
  samples: number
  model: string
  force: boolean
}

type Client = {
  messages: {
    create(params: {
      model: string
      max_tokens: number
      messages: { role: 'user'; content: string }[]
    }): Promise<{ content: { type: string; text?: string }[] }>
  }
}

// Loaded on first use so a run without --judge never needs the AWS SDK
let client: Client | null = null
async function bedrock(): Promise<Client> {
  if (!client) {
    const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
    client = new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    }) as unknown as Client
  }
  return client
}

async function judgeOnce(
  prompt: string,
  rubric: Rubric,
  model: string,
  lineCounts: { transcript: number; artifacts: Record<string, number> }
): Promise<JudgeSample> {
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const content =
      attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous reply was invalid (${lastError}). Return ONLY the JSON object in the required format.`
    const message = await (await bedrock()).messages.create({
      model,
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
    })
    const text = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n')
    try {
      const parsed = parseJudgeReply(text, rubric)
      const citations = checkCitations(
        parsed.dimensions,
        lineCounts.transcript,
        lineCounts.artifacts
      )
      return { ...parsed, citations }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`judge reply invalid after a retry: ${lastError}`)
}

async function judgeRun(raw: RawRun, template: string, options: JudgeOptions) {
  const file = raw.task.grader.rubric ?? DEFAULT_RUBRIC
  const rubric = resolveApplicability(
    parseRubric(readFileSync(join(rubricsDir, file), 'utf8'), file),
    raw.task.tags
  )
  const prompt = buildJudgePrompt(template, {
    task: raw.task,
    rubric,
    result: raw.result,
    grade: raw.grade,
  })
  const lineCounts = {
    transcript: renderTranscript(raw.result).length,
    artifacts: Object.fromEntries(artifacts(raw.result).map(a => [a.name, a.lines.length])),
  }
  const samples = await Promise.all(
    Array.from({ length: options.samples }, () =>
      judgeOnce(prompt, rubric, options.model, lineCounts)
    )
  )
  const score = reduceSamples(samples, rubric)
  return {
    model: options.model,
    rubricVersion: rubric.rubricVersion,
    samples,
    score,
    total: totalScore(raw.grade, score.weighted),
  }
}

// `<task>__<model>__<knobs|default>__r<n>.json`, for raw files written before
// run.ts stored the row
function rowKeyFromFilename(name: string) {
  const parts = name.replace(/\.json$/, '').split('__')
  const knobs = parts.at(-2) ?? ''
  return { knobs: knobs === 'default' ? '' : knobs, repeat: Number(parts.at(-1)?.slice(1) ?? 0) }
}

function sameRun(row: RunRow, raw: RawRun, fileName: string) {
  const key = raw.row ?? { ...rowKeyFromFilename(fileName), taskId: raw.task.id }
  return (
    row.taskId === raw.task.id &&
    row.model === raw.result.provider.model &&
    row.contextWindow === raw.result.provider.contextWindow &&
    row.knobs === key.knobs &&
    row.repeat === key.repeat
  )
}

export async function judgeDirectory(rawDir: string, options: JudgeOptions) {
  const template = readFileSync(join(rubricsDir, 'judge-prompt.md'), 'utf8')
  const runId = basename(rawDir)
  const summaryPath = join(rawDir, '..', '..', `${runId}.summary.json`)
  let summary: Summary | null = null
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Summary
  } catch {
    console.warn(`No summary at ${summaryPath}; judgments go into the raw files only`)
  }

  const files = readdirSync(rawDir)
    .filter(f => f.endsWith('.json'))
    .sort()
  let judged = 0
  for (const name of files) {
    const path = join(rawDir, name)
    const raw = JSON.parse(readFileSync(path, 'utf8')) as RawRun
    if (!options.tiers.includes(raw.task.tier)) continue
    if (raw.judge && !options.force) continue
    if (raw.result.turns.length === 0) {
      console.log(`${name}: skipped, the run never completed a turn`)
      continue
    }

    try {
      raw.judge = await judgeRun(raw, template, options)
    } catch (error) {
      console.error(`${name}: ${error instanceof Error ? error.message : error}`)
      continue
    }
    writeFileSync(path, JSON.stringify(raw, null, 2))
    judged++

    const unresolved = raw.judge.samples.flatMap(s => s.citations.unresolved)
    console.log(
      `${name}: judge ${raw.judge.score.weighted.toFixed(2)}/4 · total ${raw.judge.total.toFixed(
        2
      )}/4${unresolved.length ? ` · ${unresolved.length} unresolved citation(s)` : ''}`
    )

    const row = summary?.rows.find(r => sameRun(r, raw, name))
    if (summary && row) {
      row.judge = raw.judge.score.weighted
      row.total = raw.judge.total
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
    } else if (summary) {
      console.warn(`${name}: no matching row in the summary`)
    }
  }
  console.log(`Judged ${judged} run(s)`)
}

const TIERS: Tier[] = ['T1', 'T2', 'T3', 'T4']

export function parseTiers(spec: string): Tier[] {
  const tiers = spec.split(',').map(s => s.trim()) as Tier[]
  const bad = tiers.filter(t => !TIERS.includes(t))
  if (bad.length) throw new Error(`Unknown tier(s): ${bad.join(', ')}`)
  return tiers
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      tiers: { type: 'string', default: 'T3,T4' },
      samples: { type: 'string', default: '3' },
      model: { type: 'string', default: DEFAULT_JUDGE_MODEL },
      force: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  if (positionals.length !== 1) {
    console.error('Pass one raw results directory: bench/agent/results/raw/<runId>')
    process.exit(1)
  }
  await judgeDirectory(resolve(positionals[0]), {
    tiers: parseTiers(values.tiers ?? 'T3,T4'),
    samples: Number(values.samples),
    model: values.model ?? DEFAULT_JUDGE_MODEL,
    force: values.force ?? false,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
