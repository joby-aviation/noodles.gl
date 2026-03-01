// Deletes sourcemaps from R2 that are older than MAX_AGE_DAYS and are not
// referenced by any active staging environment marker (env-refs/*).
//
// Required env vars:
//   R2_ACCOUNT_ID         – Cloudflare account ID
//   R2_BUCKET_NAME        – R2 bucket name
//   AWS_ACCESS_KEY_ID     – R2 API token key ID
//   AWS_SECRET_ACCESS_KEY – R2 API token secret
//   AWS_DEFAULT_REGION    – should be 'auto' for R2
//
// Optional:
//   MAX_AGE_DAYS          – default 60

import { execSync } from 'node:child_process'

const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS ?? 60)
const CUTOFF_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

const accountId = requireEnv('R2_ACCOUNT_ID')
const bucketName = requireEnv('R2_BUCKET_NAME')
const r2Endpoint = `https://${accountId}.r2.cloudflarestorage.com`

interface S3Object {
  Key: string
  LastModified: string
  Size: number
}

interface ListObjectsOutput {
  Contents?: S3Object[]
  NextContinuationToken?: string
  IsTruncated?: boolean
}

// List all objects in the bucket, handling pagination
function listAllObjects(): S3Object[] {
  const all: S3Object[] = []
  let continuationToken: string | undefined

  do {
    const tokenArg = continuationToken
      ? `--starting-token "${continuationToken}"`
      : ''
    const raw = execSync(
      `aws s3api list-objects-v2 --bucket "${bucketName}"` +
        ` --endpoint-url "${r2Endpoint}"` +
        ` --output json` +
        (tokenArg ? ` ${tokenArg}` : ''),
      { encoding: 'utf8', env: { ...process.env } },
    )
    const parsed: ListObjectsOutput = JSON.parse(raw)
    if (parsed.Contents) all.push(...parsed.Contents)
    continuationToken = parsed.IsTruncated ? parsed.NextContinuationToken : undefined
  } while (continuationToken)

  return all
}

// Read the content of a single R2 object as a string
function readObject(key: string): string {
  return execSync(
    `aws s3 cp "s3://${bucketName}/${key}" -` +
      ` --endpoint-url "${r2Endpoint}"`,
    { encoding: 'utf8', env: { ...process.env } },
  ).trim()
}

const objects = listAllObjects()
console.log(`Found ${objects.length} object(s) in bucket`)

// Collect active SHAs from env-refs/* markers
const envRefObjects = objects.filter(o => o.Key.startsWith('env-refs/'))
const activeSHAs = new Set<string>()
for (const ref of envRefObjects) {
  try {
    const sha = readObject(ref.Key)
    if (sha) activeSHAs.add(sha)
  } catch {
    console.warn(`Could not read ${ref.Key}, skipping`)
  }
}
console.log(`Active SHAs referenced by staging environments: ${[...activeSHAs].join(', ') || '(none)'}`)

// Group sourcemap objects by their SHA prefix (first path segment)
// Skip env-refs/ objects — they are never deleted here
const shaGroups = new Map<string, S3Object[]>()
for (const obj of objects) {
  if (obj.Key.startsWith('env-refs/')) continue
  const sha = obj.Key.split('/')[0]
  if (!shaGroups.has(sha)) shaGroups.set(sha, [])
  shaGroups.get(sha)!.push(obj)
}

const now = Date.now()
let deletedSHAs = 0

for (const [sha, group] of shaGroups) {
  if (activeSHAs.has(sha)) {
    console.log(`Keeping ${sha} — referenced by an active environment`)
    continue
  }

  // Use the earliest LastModified in the group to determine age
  const oldestMs = Math.min(...group.map(o => new Date(o.LastModified).getTime()))
  const ageMs = now - oldestMs
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000))

  if (ageMs < CUTOFF_MS) {
    console.log(`Keeping ${sha} — only ${ageDays} day(s) old (limit is ${MAX_AGE_DAYS})`)
    continue
  }

  console.log(`Deleting ${sha} — ${ageDays} day(s) old, no active env refs`)
  execSync(
    `aws s3 rm "s3://${bucketName}/${sha}/" --recursive` +
      ` --endpoint-url "${r2Endpoint}"`,
    { stdio: 'inherit', env: { ...process.env } },
  )
  deletedSHAs++
}

console.log(`Done. Deleted sourcemaps for ${deletedSHAs} SHA(s).`)
