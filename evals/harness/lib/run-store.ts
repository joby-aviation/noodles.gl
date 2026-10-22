// Where run evidence lives (storage policy 2026-07-10, PR #509 review):
// git keeps only the series summaries — index.json rows, scorecard.md,
// registry.json, and manifest.json. Everything under results/<series>/runs/
// (transcripts, screenshots, artifacts, per-run JSONs) is gitignored and
// synced to R2 by harness/sync-results.ts; the manifest records every
// object's key, sha256, and size so pulls are verifiable.
//
// Consumers that read run files call requireRunFiles first so a missing
// local copy produces the pull command instead of a bare ENOENT.

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { RESULTS_ROOT } from './config'

export interface ManifestObject {
  /** Object key, `<series>/runs/<runId>/<file>` — mirrors the local tree. */
  key: string
  sha256: string
  bytes: number
}

export interface SeriesManifest {
  series: string
  bucket: string
  generatedAt: string
  objects: ManifestObject[]
}

export function manifestPath(series: string): string {
  return path.join(RESULTS_ROOT, series, 'manifest.json')
}

export function readManifest(series: string): SeriesManifest | null {
  const file = manifestPath(series)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as SeriesManifest
}

export function writeManifest(manifest: SeriesManifest): void {
  const sorted = { ...manifest, objects: [...manifest.objects].sort((a, b) => a.key.localeCompare(b.key)) }
  fs.writeFileSync(manifestPath(manifest.series), `${JSON.stringify(sorted, null, 1)}\n`)
}

export function sha256Of(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Walk results/<series>/runs/ and hash every file into manifest objects. */
export function collectLocalObjects(series: string): ManifestObject[] {
  const runsDir = path.join(RESULTS_ROOT, series, 'runs')
  if (!fs.existsSync(runsDir)) return []
  const objects: ManifestObject[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) {
        const buf = fs.readFileSync(abs)
        const rel = path.relative(path.join(RESULTS_ROOT, series), abs).split(path.sep).join('/')
        objects.push({ key: `${series}/${rel}`, sha256: sha256Of(buf), bytes: buf.length })
      }
    }
  }
  walk(runsDir)
  return objects.sort((a, b) => a.key.localeCompare(b.key))
}

export function pullHint(series: string, runId?: string): string {
  const runFlag = runId ? ` --run ${runId}` : ''
  return `cd evals && npm run sync-results -- --pull --series ${series}${runFlag}`
}

/** Throw an actionable error if any of the run's evidence files is absent
 * locally. Names the sync-results pull command; distinguishes a run that was
 * never recorded (no manifest entry either) from one that lives in R2. */
export function requireRunFiles(series: string, runId: string, files: string[]): void {
  const runDir = path.join(RESULTS_ROOT, series, 'runs', runId)
  const missing = files.filter(f => !fs.existsSync(path.join(runDir, f)))
  if (missing.length === 0) return
  const manifest = readManifest(series)
  const inManifest = manifest?.objects.some(o => o.key.startsWith(`${series}/runs/${runId}/`)) ?? false
  if (inManifest) {
    throw new Error(
      `run evidence for ${runId} is not on disk (missing: ${missing.join(', ')}) — it lives in the ` +
        `object store (results/${series}/manifest.json). Restore it first:\n  ${pullHint(series, runId)}`
    )
  }
  throw new Error(
    `run evidence for ${runId} is not on disk (missing: ${missing.join(', ')}) and ${
      manifest ? 'is not in the series manifest' : `series ${series} has no manifest.json`
    } — was the run recorded? (see evals/README.md "Storage & retention")`
  )
}
