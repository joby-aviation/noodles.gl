// Season archival (storage policy, journal 2026-07-06): when a season closes
// — curve complete: T1-T5 milestones + ablations graded, calibration settled,
// rubric-bump regrades applied; or a forced re-pin — its heavy per-run
// evidence (transcripts + screenshots, ~95% of the bytes) moves to a GitHub
// Release asset and leaves the tree. What stays in-tree is the inspectable
// curve: index.json rows, scores.json, mechanical.json, session-meta.json,
// final artifacts/, registry.json, scorecard.md. An archived season is a
// closed instrument: grade.ts refuses regrades until the tarball is restored.
//
//   npm run archive-season -- --series <series> [--out <dir>] [--force]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { CURRENT_SERIES, RESULTS_ROOT } from './lib/config'

const HEAVY = ['transcript.jsonl', 'transcript.txt', 'screenshot.png']

export function archiveSeason(series: string, outDir: string, force: boolean): string {
  if (series === CURRENT_SERIES && !force) {
    throw new Error(
      `${series} is the CURRENT season (harness/lib/config.ts) — an open season's regrades require its artifacts. ` +
        'Archive only after the curve is complete, or pass --force if the season is being closed early (forced re-pin).'
    )
  }
  const seriesDir = path.join(RESULTS_ROOT, series)
  const runsDir = path.join(seriesDir, 'runs')
  if (!fs.existsSync(runsDir)) throw new Error(`no runs directory for series ${series}`)
  if (fs.existsSync(path.join(seriesDir, 'ARCHIVED.md'))) throw new Error(`${series} is already archived`)

  const files: string[] = []
  for (const run of fs.readdirSync(runsDir)) {
    for (const f of HEAVY) {
      const rel = path.join('runs', run, f)
      if (fs.existsSync(path.join(seriesDir, rel))) files.push(rel)
    }
  }
  if (files.length === 0) throw new Error(`no heavy artifacts found under ${runsDir}`)

  fs.mkdirSync(outDir, { recursive: true })
  const tarball = path.join(outDir, `${series}-artifacts.tar.gz`)
  execFileSync('tar', ['-czf', tarball, '-C', seriesDir, ...files])

  const sha256 = createHash('sha256').update(fs.readFileSync(tarball)).digest('hex')
  const manifest = files.map(f => ` - ${f}`).join('\n')
  const tag = `evals-${series}`
  fs.writeFileSync(
    path.join(seriesDir, 'ARCHIVED.md'),
    `# Season archived

Heavy per-run evidence for this series was moved out of the tree at season
close (storage policy: evals/README.md "Storage & retention").

- tarball: \`${path.basename(tarball)}\`
- sha256: \`${sha256}\`
- files: ${files.length}
- intended GitHub Release tag: \`${tag}\`

**An archived season is a closed instrument** — its (rubricVersion, judgeModel)
pair is retired and no further regrades happen. To inspect or reproduce, download
the Release asset and extract it into this directory:

\`\`\`bash
gh release download ${tag} --pattern '${path.basename(tarball)}'
tar -xzf ${path.basename(tarball)} -C evals/results/${series}
\`\`\`

## Archived files
${manifest}
`
  )
  for (const f of files) fs.rmSync(path.join(seriesDir, f))

  console.log(`archived ${files.length} files → ${tarball}`)
  console.log(`sha256 ${sha256}`)
  console.log('\nUpload it (manual, once):')
  console.log(`  gh release create ${tag} ${tarball} --title "Eval artifacts: ${series}" --notes "sha256 ${sha256}"`)
  console.log(`\nThen commit the slimmed evals/results/${series} (ARCHIVED.md + removals).`)
  return tarball
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
  archiveSeason(series, get('out', '/tmp/noodles-evals-archives') as string, argv.includes('--force'))
}
