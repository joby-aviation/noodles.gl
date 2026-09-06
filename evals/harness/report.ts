// Scorecard + longitudinal comparison (07 D5/D6): median and range per task
// (per session model) across each milestone's sessions; the range is the live
// noise band — any cross-tier delta inside overlapping ranges is reported as
// "no change", explicitly. Uses the latest grading per run (current rubric)
// unless --rubric pins one.
//
//   npm run report -- [--series 2026-07-06.t0.abc123] [--rubric 1]

import * as fs from 'node:fs'
import * as path from 'node:path'
import { readIndex } from './grade'
import { RESULTS_ROOT } from './lib/config'
import { median } from './lib/scoring'

interface Cell {
  scores: number[]
  mechanical: number[]
  judge: number[]
  turns: number[]
  costUsd: number[]
  lookups: number[]
}

export interface GroupStats {
  task: string
  taskVersion: number
  sessionModel: string
  tier: string
  n: number
  median: number
  range: [number, number]
  mechanicalMedian: number
  judgeMedian: number
  /** Efficiency medians — the headroom that stays measurable when a cell
   * saturates the 0-4 scale: a tier landing that keeps the score at 4.00 but
   * halves turns/cost/lookups is a real, reportable improvement. */
  turnsMedian: number | null
  costMedianUsd: number | null
  lookupsMedian: number | null
}

export function computeStats(filter: { series?: string; rubricVersion?: number }): GroupStats[] {
  const index = readIndex()
  let rows = index.rows.filter(r => (filter.series ? r.series === filter.series : true))
  if (filter.rubricVersion !== undefined) {
    rows = rows.filter(r => r.rubricVersion === filter.rubricVersion)
  }
  // latest grading per run wins (regrade-not-fork, 07 D5)
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const key = `${row.series}/${row.runId}`
    const prior = latest.get(key)
    if (!prior || row.gradedAt > prior.gradedAt) latest.set(key, row)
  }

  // Task changes break the series (07 D7): a version is its own comparison
  // line, so taskVersion is part of the grouping key.
  const groups = new Map<string, Cell & { task: string; taskVersion: number; sessionModel: string; tier: string }>()
  for (const row of latest.values()) {
    if (row.lane !== 'milestone') continue
    const key = `${row.tier}|${row.taskId}@${row.taskVersion}|${row.sessionModel}`
    if (!groups.has(key)) {
      groups.set(key, {
        task: row.taskId,
        taskVersion: row.taskVersion,
        sessionModel: row.sessionModel,
        tier: row.tier,
        scores: [],
        mechanical: [],
        judge: [],
        turns: [],
        costUsd: [],
        lookups: [],
      })
    }
    const g = groups.get(key)!
    g.scores.push(row.scores.total)
    g.mechanical.push(row.scores.mechanical)
    g.judge.push(row.scores.judge)
    if (typeof row.cost.sessionUsd === 'number') g.costUsd.push(row.cost.sessionUsd)
    const lookups = (row.scores.process as { lookups?: number }).lookups
    if (typeof lookups === 'number') g.lookups.push(lookups)
    // turns live in the run's stored session-meta, joined via artifactsRef
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(RESULTS_ROOT, row.artifactsRef, 'session-meta.json'), 'utf-8')
      )
      if (typeof meta.numTurns === 'number') g.turns.push(meta.numTurns)
    } catch {
      /* artifacts unavailable; turns column stays sparse */
    }
  }

  return [...groups.values()]
    .map(g => ({
      task: g.task,
      taskVersion: g.taskVersion,
      sessionModel: g.sessionModel,
      tier: g.tier,
      n: g.scores.length,
      median: round(median(g.scores)),
      range: [round(Math.min(...g.scores)), round(Math.max(...g.scores))] as [number, number],
      mechanicalMedian: round(median(g.mechanical)),
      judgeMedian: round(median(g.judge)),
      turnsMedian: g.turns.length ? round(median(g.turns)) : null,
      costMedianUsd: g.costUsd.length ? round(median(g.costUsd)) : null,
      lookupsMedian: g.lookups.length ? round(median(g.lookups)) : null,
    }))
    .sort(
      (a, b) =>
        a.task.localeCompare(b.task) || a.taskVersion - b.taskVersion || a.sessionModel.localeCompare(b.sessionModel)
    )
}

/** Noise discipline (07 D6): a delta inside overlapping ranges is no change. */
export function classifyDelta(a: GroupStats, b: GroupStats): 'no change' | 'improved' | 'regressed' {
  const overlap = a.range[0] <= b.range[1] && b.range[0] <= a.range[1]
  if (overlap) return 'no change'
  return b.median > a.median ? 'improved' : 'regressed'
}

export function renderScorecard(stats: GroupStats[]): string {
  const lines = [
    '| task | session model | tier | n | total (median [range]) | mechanical | judge | turns | lookups | cost |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const s of stats) {
    const taskLabel = s.taskVersion > 1 ? `${s.task}@${s.taskVersion}` : s.task
    lines.push(
      `| ${taskLabel} | ${s.sessionModel} | ${s.tier} | ${s.n} | **${s.median.toFixed(2)}** [${s.range[0].toFixed(2)}–${s.range[1].toFixed(2)}] | ${s.mechanicalMedian.toFixed(2)} | ${s.judgeMedian.toFixed(2)} | ${s.turnsMedian ?? '—'} | ${s.lookupsMedian ?? '—'} | ${s.costMedianUsd !== null ? `$${s.costMedianUsd.toFixed(2)}` : '—'} |`
    )
  }
  lines.push('')
  lines.push(
    '_Scale 0–4. The [range] across sessions is the per-task noise band; cross-tier deltas inside overlapping bands are reported as "no change". Turns/lookups/cost are per-session medians — the efficiency axis that stays measurable when a cell saturates the score scale: "same 4.00, half the lookups" is a real tier gain._'
  )
  return lines.join('\n')
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const rubric = get('rubric')
  const stats = computeStats({ series: get('series'), rubricVersion: rubric ? Number.parseInt(rubric, 10) : undefined })
  console.log(renderScorecard(stats))
}
