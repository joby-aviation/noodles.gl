// Object storage behind a minimal interface (storage policy 2026-07-10,
// PR #509 review): run evidence lives in an R2 bucket, not the repo. The
// interface exists so selftest exercises push/pull/verify offline against a
// filesystem store — the R2 client is only constructed when real credentials
// are present.
//
// R2 is S3-compatible; we sign requests with aws4fetch over global fetch
// rather than @aws-sdk/client-s3 because the SDK's node-http-handler ignores
// NODE_USE_ENV_PROXY/HTTPS_PROXY, while fetch (undici) honors the egress
// proxy exactly like the Bedrock SDK the harness already uses.

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface ObjectStore {
  /** Human-readable location, for logs and ARCHIVED.md. */
  describe(): string
  put(key: string, body: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  /** null when the object does not exist. */
  head(key: string): Promise<{ bytes: number } | null>
}

/** Filesystem-backed store for selftest — same contract, no network. */
export class FsObjectStore implements ObjectStore {
  constructor(private root: string) {}
  describe(): string {
    return `fs:${this.root}`
  }
  private p(key: string): string {
    const abs = path.resolve(this.root, key)
    if (!abs.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`key escapes store root: ${key}`)
    return abs
  }
  async put(key: string, body: Buffer): Promise<void> {
    const file = this.p(key)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
  }
  async get(key: string): Promise<Buffer> {
    return fs.readFileSync(this.p(key))
  }
  async head(key: string): Promise<{ bytes: number } | null> {
    try {
      return { bytes: fs.statSync(this.p(key)).size }
    } catch {
      return null
    }
  }
}

const R2_ENV = ['EVALS_R2_ACCOUNT_ID', 'EVALS_R2_ACCESS_KEY_ID', 'EVALS_R2_SECRET_ACCESS_KEY', 'EVALS_R2_BUCKET'] as const

export function assertR2Env(): void {
  const missing = R2_ENV.filter(name => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `R2 sync requires environment variables that are not set: ${missing.join(', ')}. ` +
        'They are the Cloudflare R2 account id, an access key pair, and the bucket name — ' +
        'never commit them; see evals/README.md "Storage & retention".'
    )
  }
}

/** SigV4-signed S3-compatible store over fetch. Lazy import keeps aws4fetch
 * out of every other harness entry point. */
export async function createR2Store(): Promise<ObjectStore> {
  assertR2Env()
  const { AwsClient } = await import('aws4fetch')
  const account = process.env.EVALS_R2_ACCOUNT_ID as string
  const bucket = process.env.EVALS_R2_BUCKET as string
  const client = new AwsClient({
    accessKeyId: process.env.EVALS_R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.EVALS_R2_SECRET_ACCESS_KEY as string,
    service: 's3',
    region: 'auto',
  })
  const base = `https://${account}.r2.cloudflarestorage.com/${bucket}`
  const url = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
  const fail = (op: string, key: string, res: Response) => {
    // Response bodies can carry XML error detail but never credentials.
    throw new Error(`R2 ${op} ${key} failed: HTTP ${res.status} ${res.statusText}`)
  }
  return {
    describe: () => `r2:${bucket}`,
    async put(key, body) {
      const res = await client.fetch(url(key), { method: 'PUT', body: new Uint8Array(body) })
      if (!res.ok) fail('PUT', key, res)
      await res.arrayBuffer() // drain
    },
    async get(key) {
      const res = await client.fetch(url(key), { method: 'GET' })
      if (!res.ok) fail('GET', key, res)
      return Buffer.from(await res.arrayBuffer())
    },
    async head(key) {
      const res = await client.fetch(url(key), { method: 'HEAD' })
      if (res.status === 404) return null
      if (!res.ok) fail('HEAD', key, res)
      await res.arrayBuffer()
      const len = res.headers.get('content-length')
      return { bytes: len === null ? -1 : Number(len) }
    },
  }
}
