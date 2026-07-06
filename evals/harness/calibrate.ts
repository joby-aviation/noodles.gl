// Judge calibration tooling (07 D4). Two modes:
//
//   npm run calibrate -- --generate --series 2026-07-06.t0.<commit>
//     Emits one blank worksheet per graded run into
//     evals/calibration/worksheets/. Worksheets are ANONYMIZED (c01, c02, ...)
//     so graders aren't primed by the session model in the runId; the mapping
//     lives in evals/calibration/mapping.json — don't peek until scoring.
//
//   npm run calibrate -- --agreement --series ... --graders alice,bob
//     Reads evals/calibration/<grader>/*.md (filled copies of the worksheets),
//     computes per-dimension human↔human and human-consensus↔judge agreement
//     (exact+adjacent = within ±1 on the 0-4 scale; bar is ≥ 80%, pre-committed
//     in 07 D4), and prints the calibration record.
//
// Humans grade the SAME package the judge saw: task, rubric, mechanical
// results, artifacts, transcript — and never scores.json until done.

import * as fs from 'node:fs'
import * as path from 'node:path'
import YAML from 'yaml'
import { EVALS_ROOT, JUDGE_MODEL, RESULTS_ROOT } from './lib/config'
import { loadRubric, resolveApplicability, type Rubric } from './lib/rubric'
import { loadTask } from './lib/task'

const CALIBRATION_ROOT = path.join(EVALS_ROOT, 'calibration')

interface RunRef {
  runId: string
  series: string
  taskId: string
}

function gradedRuns(series: string): RunRef[] {
  const runsDir = path.join(RESULTS_ROOT, series, 'runs')
  return fs
    .readdirSync(runsDir)
    .filter(runId => fs.existsSync(path.join(runsDir, runId, 'scores.json')))
    .map(runId => ({
      runId,
      series,
      taskId: JSON.parse(fs.readFileSync(path.join(runsDir, runId, 'session-meta.json'), 'utf-8')).taskId,
    }))
}

function answerTemplate(rubric: Rubric): string {
  const lines: string[] = ['scores:']
  for (const dim of rubric.dimensions) {
    if (dim.style === 'anchors') {
      lines.push(`  ${dim.name}:`)
      lines.push('    level: # integer 0-4')
      lines.push('    evidence: "" # quote + location, e.g. "…" (L123) or noodles.json:14')
    } else {
      lines.push(`  ${dim.name}:`)
      lines.push('    criteria:')
      for (const c of dim.criteria ?? []) {
        lines.push(`      ${c.id}:`)
        lines.push('        verdict: # pass | fail | na')
        lines.push('        evidence: ""')
      }
    }
  }
  return lines.join('\n')
}

function generate(series: string): void {
  const runs = gradedRuns(series)
  const worksheetsDir = path.join(CALIBRATION_ROOT, 'worksheets')
  fs.mkdirSync(worksheetsDir, { recursive: true })

  // Anonymization mapping is append-only: existing codes never change (filled
  // worksheets must stay valid), new runs get the next codes.
  const mappingPath = path.join(CALIBRATION_ROOT, 'mapping.json')
  const mapping: Record<string, string> = fs.existsSync(mappingPath)
    ? (JSON.parse(fs.readFileSync(mappingPath, 'utf-8')) as { mapping: Record<string, string> }).mapping
    : {}
  const known = new Set(Object.values(mapping))
  let next = Object.keys(mapping).length + 1
  for (const run of runs.sort((a, b) => a.runId.localeCompare(b.runId))) {
    if (!known.has(run.runId)) {
      mapping[`c${String(next++).padStart(2, '0')}`] = run.runId
    }
  }
  fs.writeFileSync(mappingPath, JSON.stringify({ series, mapping }, null, 1))

  for (const [code, runId] of Object.entries(mapping)) {
    if (!runs.some(r => r.runId === runId)) continue
    const run = runs.find(r => r.runId === runId)!
    const task = loadTask(run.taskId)
    const rubric = resolveApplicability(loadRubric(task.grader.rubric), task.tags)
    const runDir = path.join(RESULTS_ROOT, series, 'runs', runId)
    const mechanical = fs.readFileSync(path.join(runDir, 'mechanical.json'), 'utf-8')
    const artifacts = fs.existsSync(path.join(runDir, 'artifacts'))
      ? fs.readdirSync(path.join(runDir, 'artifacts'))
      : []

    const rubricRendered = rubric.dimensions
      .map(dim => {
        const head = `### ${dim.name} (${dim.style}${dim.informational ? ', informational — score it anyway' : ''})`
        if (dim.style === 'anchors' && dim.levels) {
          return [head, ...[0, 1, 2, 3, 4].map(l => `- **${l}**: ${dim.levels?.[l]}`)].join('\n')
        }
        return [head, ...(dim.criteria ?? []).map(c => `- **[${c.id}]** ${c.text}`)].join('\n')
      })
      .join('\n\n')

    const sheet = `# Calibration worksheet ${code}

> Task family: **${task.family}** · rubricVersion ${rubric.rubricVersion} · judge under calibration: \`${JUDGE_MODEL}\`
> (Run identity is anonymized on purpose — don't open \`calibration/mapping.json\`,
> the run's \`scores.json\`, or anyone else's sheet until you're done.)

## How to grade this run

1. **Fetch the materials** (run from \`evals/\`):
   \`\`\`bash
   npx tsx harness/calibrate.ts --open ${code} --series ${series}
   \`\`\`
   This copies the run's files into \`calibration/materials/${code}/\` without
   exposing the run id: transcript.txt · artifacts/ (${artifacts.join(', ') || 'none'}) ·
   mechanical.json · screenshot.png (if present). scores.json — the judge's
   answers — is deliberately NOT copied.
2. Read the task prompt below, then \`mechanical.json\` (facts — don't re-litigate them).
3. Read the artifacts, then the transcript (\`transcript.txt\` — the numbered
   rendering your \`L123\` citations resolve against).
4. Score every dimension. Anchors: pick the ONE level whose description fits best.
   Checklist: pass/fail per criterion; \`na\` ONLY if the session had no opportunity
   to exhibit it. Every score needs a quote + location (L-number or file:line).
5. Fill the YAML block at the bottom IN PLACE — it's parsed mechanically.

## Task prompt (what the session was asked)

${task.prompt
  .split('\n')
  .map(l => `> ${l}`)
  .join('\n')}

## Mechanical results (recorded at run time — facts)

\`\`\`json
${mechanical.trim()}
\`\`\`

## Rubric

${rubricRendered}

## Your scores (fill in; keep valid YAML)

\`\`\`yaml
${answerTemplate(rubric)}
\`\`\`
`
    fs.writeFileSync(path.join(worksheetsDir, `${code}.md`), sheet)
  }
  console.log(`${Object.keys(mapping).length} worksheets → ${worksheetsDir}`)
  console.log(`mapping (do not peek while grading) → ${path.join(CALIBRATION_ROOT, 'mapping.json')}`)
  console.log('Each grader: cp -r calibration/worksheets calibration/<your-name>, then fill your copies.')
}

// ---- agreement ----

interface SheetScores {
  [dimension: string]: number // 0-4, checklist reduced to proportion
}

function parseSheet(file: string, rubric: Rubric): SheetScores | null {
  const raw = fs.readFileSync(file, 'utf-8')
  const block = raw.match(/```yaml\n([\s\S]*?)```/)
  if (!block) return null
  const parsed = YAML.parse(block[1]) as { scores?: Record<string, { level?: number; criteria?: Record<string, { verdict?: string }> }> }
  if (!parsed?.scores) return null
  const out: SheetScores = {}
  for (const dim of rubric.dimensions) {
    const entry = parsed.scores[dim.name]
    if (!entry) continue
    if (dim.style === 'anchors') {
      if (typeof entry.level === 'number') out[dim.name] = entry.level
    } else {
      const verdicts = Object.values(entry.criteria ?? {}).map(c => c?.verdict)
      const applicable = verdicts.filter(v => v === 'pass' || v === 'fail')
      if (applicable.length > 0) out[dim.name] = (4 * applicable.filter(v => v === 'pass').length) / applicable.length
    }
  }
  return out
}

function agreement(series: string, graders: string[]): void {
  const { mapping } = JSON.parse(fs.readFileSync(path.join(CALIBRATION_ROOT, 'mapping.json'), 'utf-8')) as {
    mapping: Record<string, string>
  }
  const rows: Array<{ dim: string; humanA: number; humanB: number; judge: number | null }> = []
  for (const [code, runId] of Object.entries(mapping)) {
    const runDir = path.join(RESULTS_ROOT, series, 'runs', runId)
    const taskId = JSON.parse(fs.readFileSync(path.join(runDir, 'session-meta.json'), 'utf-8')).taskId
    const task = loadTask(taskId)
    const rubric = resolveApplicability(loadRubric(task.grader.rubric), task.tags)
    const sheets = graders.map(g => {
      const file = path.join(CALIBRATION_ROOT, g, `${code}.md`)
      return fs.existsSync(file) ? parseSheet(file, rubric) : null
    })
    if (sheets.some(s => s === null)) continue // ungraded by someone: skip run
    const judge = JSON.parse(fs.readFileSync(path.join(runDir, 'scores.json'), 'utf-8')).judge.perDimension as Record<
      string,
      { median: number }
    >
    for (const dim of rubric.dimensions) {
      const a = sheets[0]?.[dim.name]
      const b = sheets[1]?.[dim.name]
      if (a === undefined || b === undefined) continue
      const j = judge[dim.name]?.median
      rows.push({ dim: dim.name, humanA: a, humanB: b, judge: Number.isFinite(j) ? j : null })
    }
  }
  if (rows.length === 0) {
    console.log('No fully-graded runs found. Fill worksheets under calibration/<grader>/ first.')
    return
  }
  const dims = [...new Set(rows.map(r => r.dim))]
  console.log('| dimension | n | human↔human (±1) | consensus↔judge (±1) | verdict |')
  console.log('|---|---|---|---|---|')
  for (const dim of dims) {
    const d = rows.filter(r => r.dim === dim)
    const hh = d.filter(r => Math.abs(r.humanA - r.humanB) <= 1).length / d.length
    const withJudge = d.filter(r => r.judge !== null)
    const cj =
      withJudge.length > 0
        ? withJudge.filter(r => Math.abs((r.humanA + r.humanB) / 2 - (r.judge as number)) <= 1).length / withJudge.length
        : Number.NaN
    const pass = hh >= 0.8 && cj >= 0.8
    console.log(
      `| ${dim} | ${d.length} | ${(hh * 100).toFixed(0)}% | ${Number.isNaN(cj) ? '—' : `${(cj * 100).toFixed(0)}%`} | ${pass ? '✅' : '❌ needs anchoring/decomposition (07 D4)'} |`
    )
  }
  console.log(
    '\nBar: ≥80% exact+adjacent per dimension (pre-committed in 07 D4). human↔human failures are rubric bugs, not judge bugs. Cross-tier claims may only cite passing dimensions.'
  )
}

/** Copy a run's grading materials to an anonymized folder (everything the
 * judge saw, minus scores.json and minus the run id). */
function openMaterials(series: string, code: string): void {
  const { mapping } = JSON.parse(fs.readFileSync(path.join(CALIBRATION_ROOT, 'mapping.json'), 'utf-8')) as {
    mapping: Record<string, string>
  }
  const runId = mapping[code]
  if (!runId) throw new Error(`unknown worksheet code ${code}`)
  const runDir = path.join(RESULTS_ROOT, series, 'runs', runId)
  const dest = path.join(CALIBRATION_ROOT, 'materials', code)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  for (const f of ['transcript.txt', 'mechanical.json', 'screenshot.png', 'matcher-outcomes.json']) {
    if (fs.existsSync(path.join(runDir, f))) fs.copyFileSync(path.join(runDir, f), path.join(dest, f))
  }
  const artifactsDir = path.join(runDir, 'artifacts')
  if (fs.existsSync(artifactsDir)) {
    fs.mkdirSync(path.join(dest, 'artifacts'), { recursive: true })
    for (const f of fs.readdirSync(artifactsDir)) {
      fs.copyFileSync(path.join(artifactsDir, f), path.join(dest, 'artifacts', f))
    }
  }
  console.log(`materials for ${code} → ${dest}`)
}

const argv = process.argv.slice(2)
const get = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const series = get('series')
if (!series) throw new Error('missing --series')
if (argv.includes('--generate')) {
  generate(series)
} else if (argv.includes('--open')) {
  openMaterials(series, get('open') as string)
} else if (argv.includes('--agreement')) {
  const graders = (get('graders') ?? '').split(',').filter(Boolean)
  if (graders.length !== 2) throw new Error('--graders needs exactly two comma-separated names')
  agreement(series, graders)
} else {
  throw new Error('pass --generate or --agreement')
}
