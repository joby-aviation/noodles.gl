// Scorecard + longitudinal comparison (07 D5/D6): median and range per task
// (per session model) across each milestone's sessions; the range is the live
// noise band — any cross-tier delta inside overlapping ranges is reported as
// "no change", explicitly. Uses the latest grading per run (current rubric)
// unless --rubric pins one.
//
//   npm run report -- [--series 2026-07-06.t0.abc123] [--rubric 1]

import { readIndex } from './grade'
import { median } from './lib/scoring'

interface Cell {
  scores: number[]
  mechanical: number[]
  judge: number[]
}

export interface GroupStats {
  task: string
  sessionModel: string
  tier: string
  n: number
  median: number
  range: [number, number]
  mechanicalMedian: number
  judgeMedian: number
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

  const groups = new Map<string, Cell & { task: string; sessionModel: string; tier: string }>()
  for (const row of latest.values()) {
    if (row.lane !== 'milestone') continue
    const key = `${row.tier}|${row.taskId}|${row.sessionModel}`
    if (!groups.has(key)) {
      groups.set(key, { task: row.taskId, sessionModel: row.sessionModel, tier: row.tier, scores: [], mechanical: [], judge: [] })
    }
    const g = groups.get(key)!
    g.scores.push(row.scores.total)
    g.mechanical.push(row.scores.mechanical)
    g.judge.push(row.scores.judge)
  }

  return [...groups.values()]
    .map(g => ({
      task: g.task,
      sessionModel: g.sessionModel,
      tier: g.tier,
      n: g.scores.length,
      median: round(median(g.scores)),
      range: [round(Math.min(...g.scores)), round(Math.max(...g.scores))] as [number, number],
      mechanicalMedian: round(median(g.mechanical)),
      judgeMedian: round(median(g.judge)),
    }))
    .sort((a, b) => a.task.localeCompare(b.task) || a.sessionModel.localeCompare(b.sessionModel))
}

/** Noise discipline (07 D6): a delta inside overlapping ranges is no change. */
export function classifyDelta(a: GroupStats, b: GroupStats): 'no change' | 'improved' | 'regressed' {
  const overlap = a.range[0] <= b.range[1] && b.range[0] <= a.range[1]
  if (overlap) return 'no change'
  return b.median > a.median ? 'improved' : 'regressed'
}

export function renderScorecard(stats: GroupStats[]): string {
  const lines = [
    '| task | session model | tier | n | total (median [range]) | mechanical | judge |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const s of stats) {
    lines.push(
      `| ${s.task} | ${s.sessionModel} | ${s.tier} | ${s.n} | **${s.median.toFixed(2)}** [${s.range[0].toFixed(2)}–${s.range[1].toFixed(2)}] | ${s.mechanicalMedian.toFixed(2)} | ${s.judgeMedian.toFixed(2)} |`
    )
  }
  lines.push('')
  lines.push(
    '_Scale 0–4. The [range] across sessions is the per-task noise band; cross-tier deltas inside overlapping bands are reported as "no change"._'
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
