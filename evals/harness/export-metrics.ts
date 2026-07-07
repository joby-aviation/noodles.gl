// Flat CSV export of a series for analysis/presentations. Reads only stored
// results (index rows + per-run files); writes runs.csv (one row per run),
// dimensions.csv (one row per run x judge dimension), and a self-documenting
// README. Blank cells for anything not recorded — no inference.
//
//   npm run export-metrics -- --series <series> [--out /tmp/eval-metrics]

import * as fs from 'node:fs'
import * as path from 'node:path'
import { readIndex } from './grade'
import { RESULTS_ROOT } from './lib/config'
import { loadRubric, type Rubric } from './lib/rubric'
import { loadTask } from './lib/task'

function csv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return `${rows
    .map(row =>
      row
        .map(v => {
          if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return ''
          const s = String(v)
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(',')
    )
    .join('\n')}\n`
}

/** Turn-cap exhaustion is only visible in the transcript's final result event:
 * successful runs can report num_turns > --max-turns (CLI counting nuance). */
function lastResultSubtype(runDir: string): string | undefined {
  const file = path.join(runDir, 'transcript.jsonl')
  if (!fs.existsSync(file)) return undefined
  let subtype: string | undefined
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'result') subtype = event.subtype
    } catch {
      /* partial line */
    }
  }
  return subtype
}

export function exportMetrics(series: string, outDir: string): { runs: number; dimensions: number } {
  const index = readIndex()
  const latest = new Map<string, (typeof index.rows)[number]>()
  for (const row of index.rows) {
    if (row.series !== series) continue
    const prior = latest.get(row.runId)
    if (!prior || row.gradedAt > prior.gradedAt) latest.set(row.runId, row)
  }
  if (latest.size === 0) throw new Error(`no graded rows for series ${series}`)

  const taskCache = new Map<string, ReturnType<typeof loadTask>>()
  const rubricCache = new Map<string, Rubric>()
  const task = (taskId: string) => {
    if (!taskCache.has(taskId)) taskCache.set(taskId, loadTask(taskId))
    return taskCache.get(taskId)!
  }
  const rubric = (file: string) => {
    if (!rubricCache.has(file)) rubricCache.set(file, loadRubric(file))
    return rubricCache.get(file)!
  }

  const runsHeader = [
    'runId', 'taskId', 'taskFamily', 'sessionModel', 'sessionNum', 'tier',
    'rubricVersion', 'validatorVersion', 'judgeModel', 'isolationAudit',
    'score_mechanical', 'score_judge', 'score_total',
    'proc_toolCalls', 'proc_lookups', 'proc_hallucinatedHandles',
    'proc_lookupPrecededEdgeRatio', 'proc_identicalLookupRepetitions',
    'proc_toolErrorCount', 'cost_sessionUsd', 'turns', 'wallClockSeconds',
    'budgetExhausted', 'artifactWritten',
    'mech_validateProject', 'mech_loads', 'mech_screenshotNonBlank', 'mech_requiredNodeTypes',
  ]
  const runsRows: Array<Array<string | number | boolean | null | undefined>> = [runsHeader]
  const dimsRows: Array<Array<string | number | boolean | null | undefined>> = [
    ['runId', 'taskId', 'sessionModel', 'dimension', 'style', 'medianScore', 'sampleSpread'],
  ]

  const runIds = [...latest.keys()].sort()
  for (const runId of runIds) {
    const row = latest.get(runId)!
    const runDir = path.join(RESULTS_ROOT, series, 'runs', runId)
    const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'session-meta.json'), 'utf-8'))
    const mechanical = JSON.parse(fs.readFileSync(path.join(runDir, 'mechanical.json'), 'utf-8')) as {
      checks: Record<string, { pass: boolean }>
    }
    const t = task(row.taskId)
    const process3 = row.scores.process as Record<string, unknown>

    const subtype = lastResultSubtype(runDir)
    const budgetExhausted = meta.timedOut === true || subtype === 'error_max_turns'
    const artifactWritten = fs.existsSync(path.join(runDir, 'artifacts', path.basename(t.grader.artifact)))
    const check = (key: string) => (key in mechanical.checks ? (mechanical.checks[key].pass ? 'pass' : 'fail') : 'n/a')

    runsRows.push([
      runId, row.taskId, t.family, row.sessionModel,
      Number.parseInt(runId.match(/--s(\d+)$/)?.[1] ?? '', 10) || null,
      row.tier, row.rubricVersion, row.validatorVersion, row.judgeModel, row.isolationAudit,
      row.scores.mechanical, row.scores.judge, row.scores.total,
      process3.toolCalls as number, process3.lookups as number, process3.hallucinatedHandles as number,
      (process3.lookupPrecededEdgeRatio as number | null) ?? null,
      process3.identicalLookupRepetitions as number, process3.toolErrorCount as number,
      row.cost.sessionUsd ?? null,
      meta.numTurns ?? null,
      typeof meta.durationMs === 'number' ? Math.round(meta.durationMs / 1000) : null,
      budgetExhausted, artifactWritten,
      check('validateProject'), check('loadsWithoutConsoleErrors'),
      check('screenshotNonBlank'), check('requiredNodeTypes'),
    ])

    const scores = JSON.parse(fs.readFileSync(path.join(runDir, 'scores.json'), 'utf-8')) as {
      judge: { perDimension: Record<string, { samples: number[]; median: number }> }
    }
    const r = rubric(t.grader.rubric)
    for (const [dimension, d] of Object.entries(scores.judge.perDimension)) {
      const style = r.dimensions.find(x => x.name === dimension)?.style ?? null
      const spread = d.samples.length > 0 ? Math.max(...d.samples) - Math.min(...d.samples) : null
      dimsRows.push([
        runId, row.taskId, row.sessionModel, dimension, style,
        Number.isFinite(d.median) ? Math.round(d.median * 100) / 100 : null,
        spread !== null ? Math.round(spread * 100) / 100 : null,
      ])
    }
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'runs.csv'), csv(runsRows))
  fs.writeFileSync(path.join(outDir, 'dimensions.csv'), csv(dimsRows))
  fs.writeFileSync(
    path.join(outDir, 'README.md'),
    `# Metrics export — series ${series}

Generated by \`npm run export-metrics -- --series ${series} --out ${outDir}\`
(evals/harness/export-metrics.ts). Sources: evals/results/index.json (latest
grading row per run) joined with each run directory's mechanical.json,
session-meta.json, scores.json, and transcript.jsonl under
evals/results/${series}/runs/.

- Blank cells = not recorded (e.g. turns for wall-clock-killed sessions,
  lookupPrecededEdgeRatio for runs without a project artifact). No inference.
- budgetExhausted = session-meta timedOut, OR the transcript's final result
  event has subtype "error_max_turns" (numTurns vs maxTurns is NOT reliable:
  successful runs can report numTurns > the --max-turns limit).
- mech_* = pass|fail from the frozen mechanical.json; n/a when the task's
  Layer 1 doesn't include that check (knowledge tasks use an answer key;
  sql-h3-pipeline ships no load check by design).
- dimensions.csv: medianScore is the median across the 3 judge samples
  (checklist dimensions reduced to 4×passed/applicable per sample);
  sampleSpread = max−min across samples. Judge components are uncalibrated
  until step-5 calibration passes.
`
  )
  return { runs: runsRows.length - 1, dimensions: dimsRows.length - 1 }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const series = get('series')
  if (!series) throw new Error('missing --series')
  const out = get('out', '/tmp/eval-metrics') as string
  const counts = exportMetrics(series, out)
  console.log(`runs.csv: ${counts.runs} rows | dimensions.csv: ${counts.dimensions} rows → ${out}`)
}
