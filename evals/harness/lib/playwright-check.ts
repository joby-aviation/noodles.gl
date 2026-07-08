// Layer-1 load check: start the workspace's Vite dev server, open the task's
// route under Playwright chromium, collect console/page errors, screenshot,
// and test the screenshot for non-blankness (pixel variance). Runs at run
// time only — grade.ts never re-executes the app (07 D5).

import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { PNG } from 'pngjs'

export interface LoadCheckResult {
  loaded: boolean
  consoleErrors: string[]
  screenshotPath: string | null
  screenshotNonBlank: boolean | null
  pixelStddev: number | null
  bodyText: string | null
  detail: string
}

// Console noise that says nothing about the authored project: the eval
// container's egress policy blocks some external hosts (basemap tiles, duckdb
// WASM extensions) on any project, including known-good ones — layer
// rendering still exercises the pixel-variance check. An error is treated as
// environment noise iff the resource it's about is external (non-localhost):
// a failing localhost fetch (missing data.csv, 404) stays a real error.
// Stack-trace frames are stripped first — an external fetch failing inside
// bundled code always carries localhost frame URLs.
export function isEnvironmentNoise(text: string, locationUrl?: string): boolean {
  // ResizeObserver loop warnings are a benign browser artifact (ReactFlow at
  // large viewports), unrelated to any project defect.
  if (/WebGL warning|AbortError|ResizeObserver loop/i.test(text)) return true
  // Monaco (the in-app code editor) fails to initialize its workers in this
  // headless container on any project with visible CodeOps — committed-good
  // examples (world-flights) trigger it identically, so it says nothing about
  // the artifact. The accompanying opaque `Event` rejections are the same
  // init failure surfacing through the app's error handler; only the
  // bare-Event forms are filtered (a real project rejection carries a message).
  if (/Monaco initialization: error/i.test(text)) return true
  if (/^(\[Noodles\] unhandled rejection: |pageerror: )?Event$/.test(text.trim())) return true
  const isLocal = (u: string) => /localhost|127\.0\.0\.1/.test(u)
  if (locationUrl && !isLocal(locationUrl)) return true
  const withoutFrames = text
    .split('\n')
    .filter(line => !/^\s*at /.test(line))
    .join('\n')
  const urls = withoutFrames.match(/https?:\/\/[^\s'")]+/g) ?? []
  if (urls.length > 0) return urls.every(u => !isLocal(u))
  // No URL anywhere: proxy/tunnel failures are environment; anything else counts.
  return /net::ERR_TUNNEL_CONNECTION_FAILED|net::ERR_NAME_NOT_RESOLVED|net::ERR_PROXY/.test(text)
}

export async function loadAndScreenshot(opts: {
  workspace: string
  route: string
  screenshotPath: string
  port: number
  settleMs?: number
  /** Capture document.body.innerText after settle — lets callers read on-screen op output (e.g. a ViewerOp's rendered value). */
  grabBodyText?: boolean
  /** Expand the collapsed timeline panel before the screenshot — animation
   * tasks are graded on keyframes, which are invisible with the panel shut. */
  openTimeline?: boolean
}): Promise<LoadCheckResult> {
  const editorDir = path.join(opts.workspace, 'noodles-editor')
  const server = spawn('npx', ['vite', '--port', String(opts.port), '--strictPort'], {
    cwd: editorDir,
    env: { ...process.env, BROWSER: 'none', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group so killTree can take vite's children with it
  })
  let serverLog = ''
  server.stdout.on('data', d => {
    serverLog += String(d)
  })
  server.stderr.on('data', d => {
    serverLog += String(d)
  })

  try {
    const ready = await waitFor(() => serverLog.includes('Local:'), 90_000)
    if (!ready) {
      return {
        loaded: false,
        consoleErrors: [],
        screenshotPath: null,
        screenshotNonBlank: null,
        pixelStddev: null,
        bodyText: null,
        detail: `vite dev server did not start: ${serverLog.slice(-500)}`,
      }
    }

    const { chromium } = await import('playwright')
    const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }))
    try {
      // Native 2K capture (2560x1440 @ 1x): a large layout area keeps canvas
      // ops readable without retina doubling — half the pixels of the previous
      // 1080p@2x setting, so smaller committed screenshots.
      const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 })

      // External fetches (remote CSVs, basemap styles/tiles) are fulfilled via
      // Node's proxy-aware fetch: Chromium doesn't read HTTPS_PROXY, and
      // browser-level proxying breaks the localhost vite connection. Hosts the
      // egress policy denies still fail (403 at the proxy) — that is policy,
      // not something to route around. NODE_USE_ENV_PROXY makes Node's global
      // fetch honor HTTPS_PROXY (Node >= 22.21).
      if (process.env.HTTPS_PROXY || process.env.https_proxy) {
        process.env.NODE_USE_ENV_PROXY ??= '1'
        await page.route(
          url => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname),
          async route => {
            const request = route.request()
            try {
              const resp = await fetch(request.url(), {
                method: request.method(),
                headers: { ...request.headers(), 'accept-encoding': 'identity' },
                body: request.postDataBuffer() ?? undefined,
              })
              const headers: Record<string, string> = {}
              resp.headers.forEach((v, k) => {
                if (!/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) headers[k] = v
              })
              let body = Buffer.from(await resp.arrayBuffer())
              // Cap huge textual datasets (cut at a line boundary): the
              // headless software rasterizer cannot draw ~100k additive arcs
              // at 2K — the compositor starves and screenshots time out even
              // at 180s. A few thousand rows render a representative frame;
              // the non-blank gate doesn't measure completeness.
              const MAX_TEXT_BYTES = 2_000_000
              const contentType = resp.headers.get('content-type') ?? ''
              const textual =
                /text|csv|json/i.test(contentType) || /\.(csv|tsv|txt|json|geojson)(\?|$)/i.test(request.url())
              if (textual && body.length > MAX_TEXT_BYTES) {
                const cut = body.lastIndexOf(0x0a, MAX_TEXT_BYTES)
                body = body.subarray(0, cut > 0 ? cut : MAX_TEXT_BYTES)
              }
              await route.fulfill({ status: resp.status, headers, body })
            } catch {
              await route.abort()
            }
          }
        )
      }
      const consoleErrors: string[] = []
      page.on('console', msg => {
        if (msg.type() === 'error' && !isEnvironmentNoise(msg.text(), msg.location()?.url)) {
          consoleErrors.push(msg.text().slice(0, 500))
        }
      })
      page.on('pageerror', err => {
        if (!isEnvironmentNoise(String(err))) {
          consoleErrors.push(`pageerror: ${String(err).slice(0, 500)}`)
        }
      })

      const url = `http://localhost:${opts.port}${opts.route}`
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      const canvas = await page.waitForSelector('canvas', { timeout: 60_000 }).catch(() => null)
      // Give data loading + first render time to settle.
      await page.waitForTimeout(opts.settleMs ?? 15_000)
      if (opts.openTimeline) {
        await page
          .click('button[title="Expand Timeline (click to open)"]', { timeout: 5_000 })
          .then(() => page.waitForTimeout(2_000))
          .catch(() => {
            /* already expanded or tab missing — screenshot proceeds either way */
          })
      }
      // Generous timeout: pages rendering large datasets under the headless
      // software rasterizer can starve the compositor past the default 30s.
      await page.screenshot({ path: opts.screenshotPath, timeout: 180_000 })
      // Evaluated in the browser, where document exists; the harness tsconfig
      // has no DOM lib, so reference it dynamically. textContent, not
      // innerText: ReactFlow's transformed canvas nodes are dropped from
      // innerText but their rendered values are what callers read.
      const bodyText = opts.grabBodyText
        ? await page
            .evaluate(
              () =>
                (globalThis as { document?: { body: { textContent: string | null } } }).document?.body.textContent ??
                null
            )
            .catch(() => null)
        : null

      const { nonBlank, stddev } = analyzeScreenshot(opts.screenshotPath)
      return {
        loaded: canvas !== null,
        consoleErrors,
        screenshotPath: opts.screenshotPath,
        screenshotNonBlank: nonBlank,
        pixelStddev: stddev,
        bodyText,
        detail: canvas ? 'ok' : 'no canvas element appeared',
      }
    } finally {
      await browser.close()
    }
  } finally {
    killTree(server)
  }
}

/** Non-blank = meaningful pixel variance AND no single color covering ~everything. */
export function analyzeScreenshot(file: string): { nonBlank: boolean; stddev: number } {
  const png = PNG.sync.read(fs.readFileSync(file))
  const { width, height, data } = png
  const samples: number[] = []
  const counts = new Map<number, number>()
  const step = Math.max(1, Math.floor((width * height) / 20_000))
  let total = 0
  for (let i = 0; i < width * height; i += step) {
    const o = i * 4
    const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]
    samples.push(lum)
    const q = (Math.round(data[o] / 16) << 8) | (Math.round(data[o + 1] / 16) << 4) | Math.round(data[o + 2] / 16)
    counts.set(q, (counts.get(q) ?? 0) + 1)
    total++
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const stddev = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length)
  const dominant = Math.max(...counts.values()) / total
  return { nonBlank: stddev > 4 && dominant < 0.98, stddev }
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return check()
}

function killTree(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* gone */
    }
  }, 5000).unref()
}
