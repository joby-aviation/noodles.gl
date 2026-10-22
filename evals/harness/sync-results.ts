// Continuous R2 sync for run evidence (storage policy 2026-07-10, PR #509
// review): the repo keeps series summaries (index.json, scorecard.md,
// registry.json, manifest.json); the bytes under results/<series>/runs/ live
// in an R2 bucket, keyed exactly like the local tree. Push after grading,
// pull before regrading/inspecting, verify before trusting either.
//
//   npm run sync-results -- --push   [--series <series>]
//   npm run sync-results -- --verify --series <series> [--all]
//   npm run sync-results -- --pull   --series <series> [--run <runId>]
//
// Push is idempotent: objects whose sha256 already matches the manifest are
// skipped unless the remote is missing them. Verify HEADs every manifest key
// and spot-downloads a deterministic sample (--all downloads everything) to
// compare hashes. Pull writes only files that are absent or hash-mismatched
// locally, and verifies every downloaded byte against the manifest.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { CURRENT_SERIES, RESULTS_ROOT } from './lib/config'
import { createR2Store, type ObjectStore } from './lib/object-store'
import {
  collectLocalObjects,
  type ManifestObject,
  readManifest,
  type SeriesManifest,
  sha256Of,
  writeManifest,
} from './lib/run-store'

const VERIFY_SAMPLE = 20

export async function pushSeries(series: string, store: ObjectStore): Promise<{ uploaded: number; skipped: number }> {
  const local = collectLocalObjects(series)
  if (local.length === 0) throw new Error(`no run files under results/${series}/runs — nothing to push`)
  const prior = readManifest(series)
  const priorByKey = new Map((prior?.objects ?? []).map(o => [o.key, o]))
  let uploaded = 0
  let skipped = 0
  for (const obj of local) {
    const known = priorByKey.get(obj.key)
    if (known && known.sha256 === obj.sha256 && (await store.head(obj.key)) !== null) {
      skipped++
      continue
    }
    const abs = path.join(RESULTS_ROOT, obj.key)
    await store.put(obj.key, fs.readFileSync(abs))
    uploaded++
  }
  // The manifest reflects local truth after the push; stale keys from
  // deleted/renamed runs are dropped rather than carried forever.
  const manifest: SeriesManifest = {
    series,
    bucket: store.describe(),
    generatedAt: new Date().toISOString(),
    objects: local,
  }
  writeManifest(manifest)
  return { uploaded, skipped }
}

export async function verifySeries(
  series: string,
  store: ObjectStore,
  opts: { all?: boolean } = {}
): Promise<{ checked: number; hashed: number; problems: string[] }> {
  const manifest = readManifest(series)
  if (!manifest) throw new Error(`series ${series} has no manifest.json — push first`)
  const problems: string[] = []
  for (const obj of manifest.objects) {
    const head = await store.head(obj.key)
    if (head === null) problems.push(`missing remote object: ${obj.key}`)
    else if (head.bytes >= 0 && head.bytes !== obj.bytes)
      problems.push(`size mismatch ${obj.key}: manifest ${obj.bytes}, remote ${head.bytes}`)
  }
  // Deterministic sample for hash verification: every Nth key of the sorted
  // manifest, so repeated runs check the same objects and --all checks all.
  const sample = opts.all
    ? manifest.objects
    : manifest.objects.filter((_, i) => i % Math.max(1, Math.ceil(manifest.objects.length / VERIFY_SAMPLE)) === 0)
  for (const obj of sample) {
    let body: Buffer
    try {
      body = await store.get(obj.key)
    } catch (err) {
      problems.push(`download failed ${obj.key}: ${(err as Error).message}`)
      continue
    }
    const hash = sha256Of(body)
    if (hash !== obj.sha256) problems.push(`sha256 mismatch ${obj.key}: manifest ${obj.sha256}, remote ${hash}`)
  }
  return { checked: manifest.objects.length, hashed: sample.length, problems }
}

export async function pullSeries(
  series: string,
  store: ObjectStore,
  runId?: string
): Promise<{ downloaded: number; skipped: number }> {
  const manifest = readManifest(series)
  if (!manifest) throw new Error(`series ${series} has no manifest.json — nothing to pull`)
  const wanted = runId ? manifest.objects.filter(o => o.key.startsWith(`${series}/runs/${runId}/`)) : manifest.objects
  if (wanted.length === 0) throw new Error(`no manifest objects match${runId ? ` run ${runId}` : ''} in series ${series}`)
  let downloaded = 0
  let skipped = 0
  for (const obj of wanted) {
    const abs = path.join(RESULTS_ROOT, obj.key)
    if (fs.existsSync(abs) && sha256Of(fs.readFileSync(abs)) === obj.sha256) {
      skipped++
      continue
    }
    const body = await store.get(obj.key)
    const hash = sha256Of(body)
    if (hash !== obj.sha256) {
      throw new Error(`sha256 mismatch pulling ${obj.key}: manifest ${obj.sha256}, downloaded ${hash} — aborting`)
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
    downloaded++
  }
  return { downloaded, skipped }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  const argv = process.argv.slice(2)
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const mode = (['push', 'pull', 'verify'] as const).filter(m => argv.includes(`--${m}`))
  if (mode.length !== 1) throw new Error('pass exactly one of --push, --pull, --verify')
  const series = get('series', mode[0] === 'push' ? CURRENT_SERIES : undefined)
  if (!series) throw new Error('missing --series')

  const main = async () => {
    const store = await createR2Store()
    if (mode[0] === 'push') {
      const { uploaded, skipped } = await pushSeries(series, store)
      console.log(`pushed ${series} → ${store.describe()}: ${uploaded} uploaded, ${skipped} already current`)
      console.log(`manifest written: results/${series}/manifest.json — commit it, then verify before any git rm:`)
      console.log(`  npm run sync-results -- --verify --series ${series} --all`)
    } else if (mode[0] === 'verify') {
      const { checked, hashed, problems } = await verifySeries(series, store, { all: argv.includes('--all') })
      console.log(`verified ${series} against ${store.describe()}: ${checked} objects HEADed, ${hashed} hash-checked`)
      if (problems.length > 0) {
        for (const p of problems) console.error(`  PROBLEM: ${p}`)
        process.exit(1)
      }
      console.log('all clean')
    } else {
      const { downloaded, skipped } = await pullSeries(series, store, get('run'))
      console.log(`pulled ${series} from ${store.describe()}: ${downloaded} downloaded, ${skipped} already current`)
    }
  }
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
