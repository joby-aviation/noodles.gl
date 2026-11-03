// Rolls graded runs up into the table the benchmark reports, and compares two
// summaries. Pure, so the report and its tests need neither a browser nor disk.

import type { DiagnosticKind } from '../../src/ai-chat/agent/types'
import type { Tier } from './tasks'

// One graded (task × config × repeat) run, as stored in the summary file
export interface RunRow {
  taskId: string
  tier: Tier
  provider: string
  model: string
  contextWindow: number
  knobs: string
  repeat: number
  score: number
  pass: boolean
  mechanicalFailure: boolean
  steps: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  diagnostics: Partial<Record<DiagnosticKind, number>>
  ms: number
  loadMs: number
  timedOut: boolean
  error?: string
  // Set by judge-run.ts: the judge's weighted 0–4 and #509's blended total
  judge?: number
  total?: number
}

export interface Environment {
  gitSha: string
  dirty: boolean
  userAgent: string
  gpu: { vendor?: string; architecture?: string; device?: string; description?: string } | null
  deviceMemoryGb: number | null
  cpuCores: number | null
  // A label for the machine, since UA and GPU strings do not say "Adam's M3"
  machine: string
}

export interface Summary {
  runId: string
  startedAt: string
  environment: Environment
  rows: RunRow[]
}

export interface ConfigTierStats {
  config: string
  tier: Tier | 'all'
  runs: number
  passRate: number
  // Mean score as a percentage of the 0–4 scale
  meanScorePct: number
  // Over judged runs only; null when none were judged
  meanJudgePct: number | null
  meanSteps: number
  meanInputTokens: number
  trimmed: number
  jsonFallbacks: number
  jsonRepairs: number
  repeats: number
  // Replies that claimed an edit no tool call backs up
  fakeEdits: number
  unknownTools: number
  timeouts: number
  errors: number
  p50Seconds: number
  outputTokensPerSecond: number
}

// The configuration that was asked for, not the window measured after load: a
// run whose model never loaded records no window, and keyed on the measured one
// it would drop out of --compare, hiding exactly the regression that matters
export const configKey = (row: RunRow) => {
  const knobs = (row.knobs ?? '').split(',').filter(Boolean)
  const ctx = knobs.find(knob => knob.startsWith('ctx='))?.slice(4) ?? 'default'
  const rest = knobs.filter(knob => !knob.startsWith('ctx=')).join(',')
  return `${row.provider}/${row.model} ctx=${ctx}${rest ? ` ${rest}` : ''}`
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function stats(config: string, tier: ConfigTierStats['tier'], rows: RunRow[]): ConfigTierStats {
  const count = (kind: DiagnosticKind) => rows.reduce((n, r) => n + (r.diagnostics[kind] ?? 0), 0)
  const totalMs = rows.reduce((n, r) => n + r.ms, 0)
  const judged = rows.filter(r => r.judge !== undefined)
  return {
    config,
    tier,
    runs: rows.length,
    passRate: rows.filter(r => r.pass).length / (rows.length || 1),
    meanScorePct: (mean(rows.map(r => r.score)) / 4) * 100,
    meanJudgePct: judged.length ? (mean(judged.map(r => r.judge ?? 0)) / 4) * 100 : null,
    meanSteps: mean(rows.map(r => r.steps)),
    meanInputTokens: mean(rows.map(r => r.inputTokens)),
    trimmed: count('context_trimmed'),
    jsonFallbacks: count('json_parse_fallback'),
    jsonRepairs: count('json_repaired'),
    repeats: count('repeated_tool_call'),
    fakeEdits: count('unverified_edit_claim'),
    unknownTools: count('unknown_tool'),
    timeouts: rows.filter(r => r.timedOut).length,
    errors: rows.filter(r => r.error).length,
    p50Seconds: median(rows.map(r => r.ms)) / 1000,
    outputTokensPerSecond: totalMs
      ? rows.reduce((n, r) => n + r.outputTokens, 0) / (totalMs / 1000)
      : 0,
  }
}

export function aggregate(rows: RunRow[]): ConfigTierStats[] {
  const byConfig = Map.groupBy(rows, configKey)
  const out: ConfigTierStats[] = []
  for (const [config, configRows] of byConfig) {
    out.push(stats(config, 'all', configRows))
    for (const [tier, tierRows] of Map.groupBy(configRows, r => r.tier)) {
      out.push(stats(config, tier, tierRows))
    }
  }
  const tierOrder = ['all', 'T1', 'T2', 'T3', 'T4']
  return out.sort(
    (a, b) =>
      a.config.localeCompare(b.config) || tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier)
  )
}

const pct = (n: number) => `${Math.round(n)}%`
const fixed = (n: number, digits = 1) => n.toFixed(digits)

export function renderMarkdown(summary: Summary): string {
  const env = summary.environment
  const lines = [
    `# Agent benchmark ${summary.runId}`,
    '',
    `${env.machine} · ${env.gpu?.description || env.gpu?.vendor || 'no WebGPU adapter'} · ${
      env.deviceMemoryGb ?? '?'
    } GB · ${env.gitSha}${env.dirty ? ' (dirty)' : ''}`,
    '',
    '| Config | Tier | Runs | Pass | Score | Judge | Steps | In tok | Trimmed | JSON fallbacks | JSON repairs | Repeats | Fake edits | Unknown tools | Timeouts | Errors | p50 s | Out tok/s |',
    '| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |',
  ]
  for (const s of aggregate(summary.rows)) {
    lines.push(
      `| ${s.tier === 'all' ? `**${s.config}**` : ''} | ${s.tier} | ${s.runs} | ${pct(
        s.passRate * 100
      )} | ${pct(s.meanScorePct)} | ${
        s.meanJudgePct === null ? '–' : pct(s.meanJudgePct)
      } | ${fixed(s.meanSteps)} | ${Math.round(s.meanInputTokens)} | ${
        s.trimmed
      } | ${s.jsonFallbacks} | ${s.jsonRepairs} | ${s.repeats} | ${s.fakeEdits} | ${s.unknownTools} | ${s.timeouts} | ${s.errors} | ${fixed(
        s.p50Seconds
      )} | ${fixed(s.outputTokensPerSecond)} |`
    )
  }
  return lines.join('\n')
}

export interface TaskDelta {
  config: string
  taskId: string
  beforePct: number
  afterPct: number
  deltaPct: number
  regression: boolean
}

// Points on the percentage scale a task can drop before it is flagged. Three
// repeats of a 0–4 score move in steps of ~8 points, so one bad repeat is noise.
export const REGRESSION_THRESHOLD_PCT = 10

// Per (config, task) mean score, before vs after. Only pairs present in both.
export function compare(before: Summary, after: Summary): TaskDelta[] {
  const means = (summary: Summary) => {
    const grouped = Map.groupBy(summary.rows, r => `${configKey(r)}\u0000${r.taskId}`)
    return new Map(
      [...grouped].map(([key, rows]) => [key, (mean(rows.map(r => r.score)) / 4) * 100])
    )
  }
  const a = means(before)
  const b = means(after)
  const deltas: TaskDelta[] = []
  for (const [key, afterPct] of b) {
    const beforePct = a.get(key)
    if (beforePct === undefined) continue
    const [config, taskId] = key.split('\u0000')
    const deltaPct = afterPct - beforePct
    deltas.push({
      config,
      taskId,
      beforePct,
      afterPct,
      deltaPct,
      regression: deltaPct <= -REGRESSION_THRESHOLD_PCT,
    })
  }
  return deltas.sort((x, y) => x.deltaPct - y.deltaPct)
}

export function renderComparison(before: Summary, after: Summary): string {
  const deltas = compare(before, after)
  const regressions = deltas.filter(d => d.regression)
  const lines = [
    `# ${before.runId} → ${after.runId}`,
    '',
    regressions.length
      ? `**${regressions.length} regression(s)** of ${REGRESSION_THRESHOLD_PCT}+ points`
      : 'No regressions',
    '',
    '| Config | Task | Before | After | Δ |',
    '| --- | --- | --: | --: | --: |',
  ]
  for (const d of deltas) {
    const flag = d.regression ? ' ⚠️' : ''
    lines.push(
      `| ${d.config} | ${d.taskId} | ${pct(d.beforePct)} | ${pct(d.afterPct)} | ${
        d.deltaPct > 0 ? '+' : ''
      }${Math.round(d.deltaPct)}${flag} |`
    )
  }
  return lines.join('\n')
}
