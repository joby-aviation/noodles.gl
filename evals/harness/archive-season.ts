// Season close (storage policy 2026-07-10): run evidence lives in R2 from
// the moment it's graded (harness/sync-results.ts), so closing a season no
// longer moves bytes — it writes the closed-instrument marker. A season
// closes when its curve is complete (T1-T5 milestones + ablations graded,
// calibration settled, rubric-bump regrades applied) or on a forced re-pin.
// Once ARCHIVED.md exists, grade.ts refuses regrades: the season's
// (rubricVersion, judgeModel) pair is retired.
//
// Closing verifies the manifest actually covers the local evidence first —
// a season must never be sealed while some of its bytes exist only on one
// ephemeral disk.
//
//   npm run archive-season -- --series <series> [--force]

import * as fs from 'node:fs'
import * as path from 'node:path'
import { CURRENT_SERIES, RESULTS_ROOT } from './lib/config'
import { collectLocalObjects, pullHint, readManifest } from './lib/run-store'

export function archiveSeason(series: string, force: boolean): string {
  if (series === CURRENT_SERIES && !force) {
    throw new Error(
      `${series} is the CURRENT season (harness/lib/config.ts) — an open season's regrades require it to stay open. ` +
        'Close only after the curve is complete, or pass --force if the season is being closed early (forced re-pin).'
    )
  }
  const seriesDir = path.join(RESULTS_ROOT, series)
  const marker = path.join(seriesDir, 'ARCHIVED.md')
  if (fs.existsSync(marker)) throw new Error(`${series} is already archived`)

  const manifest = readManifest(series)
  if (!manifest) {
    throw new Error(`series ${series} has no manifest.json — push its evidence first: npm run sync-results -- --push --series ${series}`)
  }
  // Every local run file must be in the manifest with a matching hash; local
  // evidence the manifest doesn't cover would be lost the moment this disk
  // goes away. (Remote integrity is sync-results --verify's job.)
  const manifestByKey = new Map(manifest.objects.map(o => [o.key, o]))
  const uncovered = collectLocalObjects(series).filter(o => manifestByKey.get(o.key)?.sha256 !== o.sha256)
  if (uncovered.length > 0) {
    throw new Error(
      `${uncovered.length} local run file(s) are missing from or stale in the manifest ` +
        `(first: ${uncovered[0].key}) — re-push before closing: npm run sync-results -- --push --series ${series}`
    )
  }

  fs.writeFileSync(
    marker,
    `# Season archived

This season is a **closed instrument** — its (rubricVersion, judgeModel) pair
is retired and no further regrades happen (storage policy: evals/README.md
"Storage & retention").

- objects: ${manifest.objects.length} (results/${series}/manifest.json)
- store: \`${manifest.bucket}\`
- closed: ${new Date().toISOString()}

To inspect or reproduce, restore the evidence locally:

\`\`\`bash
${pullHint(series)}
\`\`\`
`
  )
  console.log(`closed season ${series}: ARCHIVED.md written (${manifest.objects.length} objects in ${manifest.bucket})`)
  return marker
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const series = get('series')
  if (!series) throw new Error('missing --series')
  archiveSeason(series, argv.includes('--force'))
}
