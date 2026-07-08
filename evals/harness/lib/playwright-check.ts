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
        detail: `vite dev server did not start: ${serverLog.slice(-500)}`,
      }
    }

    const { chromium } = await import('playwright')
    const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }))
    try {
      // Full-HD window so the app lays out at a realistic size (small windows
      // shrink node labels/toasts before they're ever captured), plus
      // deviceScaleFactor 2 so the text stays legible when zoomed.
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
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
      await page.screenshot({ path: opts.screenshotPath })

      const { nonBlank, stddev } = analyzeScreenshot(opts.screenshotPath)
      return {
        loaded: canvas !== null,
        consoleErrors,
        screenshotPath: opts.screenshotPath,
        screenshotNonBlank: nonBlank,
        pixelStddev: stddev,
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
