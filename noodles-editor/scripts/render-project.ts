// Renders a project to video with no editor open (#883): a headless Chromium loads the
// editor, opens the project from its folder in memory, and runs the same export as the
// Export button and export_video.
//
//   npm run render -- path/to/project --out title.mp4
//   npm run render -- path/to/project/noodles.json --out a.mp4 --start 0 --end 7.5 --fps 30
//   npm run render -- path/to/project --out a.mp4 --url http://localhost:5173  # a running editor
//
// Without --url it starts the editor's dev server and stops it after. Progress goes to stderr
// as `frame N/M` lines (`--json` writes one JSON status per line instead), and the command
// exits 1 with the reason when the export fails. Relative paths resolve against the
// directory npm was run from.

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { HeadlessApi } from '../src/render/headless-api'

// window in the page, for the callbacks page.evaluate runs there. Each is sent on its own,
// so they can't call a helper from this file: each casts window itself.
type Page = { __noodles?: HeadlessApi; __noodlesRenderProgress: (status: unknown) => void }

const EDITOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CODECS = ['avc', 'hevc', 'vp9', 'av1'] as const
type Codec = (typeof CODECS)[number]

export interface RenderOptions {
  project: string
  out: string
  url?: string
  startTime?: number
  endTime?: number
  fps?: number
  width?: number
  height?: number
  codec?: Codec
  timeoutSeconds: number
  json: boolean
  headed: boolean
}

export const USAGE = `Usage: npm run render -- <project folder or noodles.json> --out <file.mp4> [options]

  --out <file>        Where to write the video (required)
  --start <seconds>   First second of the timeline to render
  --end <seconds>     Last second
  --fps <n>           Frames per second
  --width <px>        Frame width
  --height <px>       Frame height
  --codec <codec>     avc, hevc, vp9 or av1
  --url <url>         A running editor to use, such as http://localhost:5173
  --timeout <s>       Give up after this many seconds (default 1800)
  --json              Progress as one JSON status per line
  --headed            Show the browser window

Settings left out come from the project's render settings on its Deck node.`

/** The command line as options, or the reason it can't be. */
export function parseRenderArgs(
  argv: string[],
  cwd = process.cwd()
): { ok: true; options: RenderOptions } | { ok: false; error: string } {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        start: { type: 'string' },
        end: { type: 'string' },
        fps: { type: 'string' },
        width: { type: 'string' },
        height: { type: 'string' },
        codec: { type: 'string' },
        url: { type: 'string' },
        timeout: { type: 'string' },
        json: { type: 'boolean' },
        headed: { type: 'boolean' },
      },
    })
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
  const { values, positionals } = parsed
  if (positionals.length !== 1)
    return { ok: false, error: 'Give one project folder or noodles.json' }
  if (typeof values.out !== 'string') return { ok: false, error: '--out is required' }
  const number = (name: string): number | undefined | string => {
    const raw = values[name]
    if (raw === undefined) return undefined
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : `--${name} must be a number, got ${raw}`
  }
  const numbers: Record<string, number | undefined> = {}
  for (const name of ['start', 'end', 'fps', 'width', 'height', 'timeout']) {
    const n = number(name)
    if (typeof n === 'string') return { ok: false, error: n }
    numbers[name] = n
  }
  const codec = values.codec
  if (codec !== undefined && !CODECS.includes(codec as Codec)) {
    return { ok: false, error: `--codec must be one of ${CODECS.join(', ')}, got ${codec}` }
  }
  return {
    ok: true,
    options: {
      project: resolve(cwd, positionals[0]),
      out: resolve(cwd, values.out),
      ...(typeof values.url === 'string' ? { url: values.url.replace(/\/+$/, '') } : {}),
      startTime: numbers.start,
      endTime: numbers.end,
      fps: numbers.fps,
      width: numbers.width,
      height: numbers.height,
      codec: codec as Codec | undefined,
      timeoutSeconds: numbers.timeout ?? 1800,
      json: values.json === true,
      headed: values.headed === true,
    },
  }
}

/**
 * A project's noodles.json and data files, as the editor names them: `@/data.csv` is
 * `data/data.csv` in a saved project, or `data.csv` beside noodles.json in an example.
 */
export async function readProjectFiles(
  path: string
): Promise<{ id: string; project: unknown; files: Record<string, string> }> {
  const file = (await stat(path)).isDirectory() ? join(path, 'noodles.json') : path
  const folder = dirname(file)
  const project = JSON.parse(await readFile(file, 'utf8'))
  const dataDir = join(folder, 'data')
  const root = existsSync(dataDir) && (await stat(dataDir)).isDirectory() ? dataDir : folder
  const files: Record<string, string> = {}
  for (const entry of await walk(root)) {
    const name = relative(root, entry).split(sep).join('/')
    // The project itself, its README, and hidden files aren't data. `.agent/` is: the
    // assistant writes the files it makes there, and the project reads them as `@/.agent/...`
    if (root === folder && (name === basename(file) || /^readme\.md$/i.test(name))) continue
    const hidden = (part: string) => part.startsWith('.') && part !== '.agent'
    if (name.split('/').some(part => hidden(part) || part === 'node_modules')) continue
    files[name] = (await readFile(entry)).toString('base64')
  }
  return { id: projectIdOf(folder), project, files }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(path)))
    else if (entry.isFile()) out.push(path)
  }
  return out
}

/** An in-memory project id from a folder name: `render-` and letters, digits, . _ - */
export function projectIdOf(folder: string): string {
  const stem = basename(folder)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `render-${stem || 'project'}`
}

/**
 * Chromium flags for a hardware GPU where one is likely, so WebGL doesn't fall back to the
 * much slower SwiftShader: Metal on macOS. Elsewhere Chromium picks its own.
 */
export function browserArgs(platform = process.platform): string[] {
  return platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : ['--enable-gpu']
}

const MAX_TRIES = 3

/** Whether a Playwright error means the page navigated away, as a dev-server reload does. */
export function isReload(error: unknown): boolean {
  return /Execution context was destroyed|navigat|Target page, context or browser has been closed/i.test(
    error instanceof Error ? error.message : String(error)
  )
}

export function describeStatus(status: { state: string; frame: number; totalFrames: number }) {
  return `${status.state} frame ${status.frame}/${status.totalFrames}`
}

async function startDevServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const { createServer } = await import('vite')
  const server = await createServer({
    root: EDITOR_ROOT,
    configFile: join(EDITOR_ROOT, 'vite.config.js'),
    logLevel: 'error',
    // No browser window: the config opens one for `npm start`
    server: { port: 0, strictPort: false, open: false },
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]?.replace(/\/+$/, '')
  if (!url) throw new Error('The dev server started without a URL')
  return { url, close: () => server.close() }
}

export async function render(
  options: RenderOptions,
  log = (line: string) => console.error(line),
  signal?: AbortSignal
) {
  const { id, project, files } = await readProjectFiles(options.project)
  const server = options.url ? null : await startDevServer()
  const url = options.url ?? server?.url
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: !options.headed, args: browserArgs() })
  const deadline = setTimeout(() => {
    log(`Gave up after ${options.timeoutSeconds}s`)
    void browser.close()
  }, options.timeoutSeconds * 1000)
  let cancelled = false
  const cancel = () => {
    cancelled = true
    log('cancelled')
    void browser.close()
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    // One page, start to finish. A dev server on a cold cache reloads the page once it has
    // bundled the dependencies it found, which ends whatever the page was doing: start again.
    const attempt = async () => {
      const tab = await browser.newPage()
      try {
        return await run(tab)
      } finally {
        // A reloaded attempt's page would keep its editor, worker and canvas alive
        await tab.close().catch(() => {})
      }
    }
    const run = async (tab: Awaited<ReturnType<typeof browser.newPage>>) => {
      tab.on('pageerror', error => log(`page error: ${error.message}`))
      await tab.exposeFunction('__noodlesRenderProgress', (status: never) =>
        log(options.json ? JSON.stringify(status) : describeStatus(status))
      )
      await tab.goto(`${url}/projects/new?headless=true`)
      await tab.waitForFunction(
        () => typeof (window as unknown as Page).__noodles?.openProject === 'function'
      )
      await tab.evaluate(() => {
        window.addEventListener('noodles:export', e =>
          (window as unknown as Page).__noodlesRenderProgress((e as CustomEvent).detail)
        )
      })
      log(`opening ${id} (${Object.keys(files).length} data files)`)
      await tab.evaluate(
        ({ id, project, files }) =>
          (window as unknown as Page).__noodles?.openProject?.(id, { project, files }),
        { id, project, files }
      )
      await tab.waitForFunction(
        () => (window as unknown as Page).__noodles?.canExport?.() === true,
        null,
        {
          timeout: 120_000,
        }
      )
      const request = {
        startTime: options.startTime,
        endTime: options.endTime,
        fps: options.fps,
        width: options.width,
        height: options.height,
        codec: options.codec,
      }
      const result = await tab.evaluate(
        r => (window as unknown as Page).__noodles?.renderVideo?.(r),
        request
      )
      if (result?.status !== 'done') {
        throw new Error(result?.error ?? 'The editor returned no result')
      }
      return result
    }
    let result: Awaited<ReturnType<typeof attempt>> | undefined
    for (let tries = 1; !result; tries++) {
      try {
        result = await attempt()
      } catch (error) {
        if (cancelled || tries >= MAX_TRIES || !isReload(error)) throw error
        log('the page reloaded (the dev server bundled new dependencies); starting again')
      }
    }
    if (cancelled) throw new Error('The render was cancelled')
    await mkdir(dirname(options.out), { recursive: true })
    const bytes = Buffer.from(result.base64, 'base64')
    await writeFile(options.out, bytes)
    log(
      `wrote ${options.out} (${result.frameCount} frames at ${result.fps} fps, ${bytes.length} bytes)`
    )
    return {
      file: options.out,
      frameCount: result.frameCount,
      fps: result.fps,
      bytes: bytes.length,
    }
  } catch (error) {
    throw cancelled ? new Error('The render was cancelled') : error
  } finally {
    signal?.removeEventListener('abort', cancel)
    clearTimeout(deadline)
    await browser.close().catch(() => {})
    await server?.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseRenderArgs(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd())
  if (!args.ok) {
    console.error(`${args.error}\n\n${USAGE}`)
    process.exit(2)
  }
  // A caller that stops the render (the MCP tool, Ctrl-C) gets the browser closed with it
  const controller = new AbortController()
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => controller.abort())
  }
  render(args.options, undefined, controller.signal).then(
    () => process.exit(0),
    error => {
      console.error(`Render failed: ${(error as Error).message}`)
      process.exit(1)
    }
  )
}
