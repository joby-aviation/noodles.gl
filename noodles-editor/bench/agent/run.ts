#!/usr/bin/env tsx

// Runs the in-app assistant against the benchmark tasks in a real browser.
//
//   npm run bench:agent -- --provider webllm --model Qwen3-4B-q4f16_1-MLC --knobs ctx=16384 --tasks T2
//
// Flags (all optional except --provider):
//   --provider   webllm | chrome | anthropic | openrouter
//   --model      one or more model ids, comma-separated
//   --knobs      ablation settings, e.g. ctx=16384. Repeat the flag for a matrix.
//   --tasks      tiers (T1) and/or task ids, comma-separated. Default: all.
//   --repeats    runs per task and config. Default 3.
//   --machine    a label for this machine in the report. Default: hostname.
//   --url        an already-running dev server. Default: starts one.
//   --browser    chrome (default, system Chrome) | chromium (bundled, no Gemini Nano)
//   --headless   no window. Fine for cloud providers; WebGPU may fall back or vanish.
//   --judge      run the Claude judge (judge-run.ts) on T3/T4 afterwards. Needs AWS
//                credentials for Bedrock.
//
// System Chrome runs headed with a persistent profile (bench/agent/.profile) so
// WebLLM weights and Gemini Nano survive between runs, and so WebGPU is the real
// GPU rather than a software fallback. The first run of a model downloads it.
//
// API keys for the cloud references come from ANTHROPIC_API_KEY and
// OPENROUTER_API_KEY. They are passed to the page and never written to results.

import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { type BrowserContext, chromium, type Page } from 'playwright'
import type { ProviderId } from '../../src/ai-chat/agent/types'
import type {
  BenchKnobs,
  BenchProviderConfig,
  BenchResult,
  BenchTask,
} from '../../src/ai-chat/bench/bench-hook'
import { grade } from './grade'
import { configKey, type Environment, type RunRow, renderMarkdown, type Summary } from './summary'
import { parseTask, type Task } from './tasks'

const here = dirname(fileURLToPath(import.meta.url))
const editorRoot = resolve(here, '../..')
// A first run downloads the weights; an 8B model is ~5 GB
const LOAD_TIMEOUT_MS = 30 * 60 * 1000
const READY_TIMEOUT_MS = 90 * 1000

const { values: args } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string' },
    knobs: { type: 'string', multiple: true },
    tasks: { type: 'string' },
    repeats: { type: 'string', default: '3' },
    machine: { type: 'string' },
    url: { type: 'string' },
    browser: { type: 'string', default: 'chrome' },
    headless: { type: 'boolean', default: false },
    judge: { type: 'boolean', default: false },
  },
})

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function loadTasks(filter: string | undefined): Task[] {
  const dir = join(here, 'tasks')
  const all = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => parseTask(readFileSync(join(dir, f), 'utf8'), `tasks/${f}`))
  if (!filter) return all
  const wanted = filter.split(',').map(s => s.trim())
  const picked = all.filter(t => wanted.includes(t.tier) || wanted.includes(t.id))
  if (picked.length === 0) fail(`No tasks match --tasks ${filter}`)
  return picked
}

// 'ctx=16384,prompt=slim' -> { ctx: 16384, prompt: 'slim' }
function parseKnobs(spec: string | undefined): BenchKnobs {
  const knobs: Record<string, string | number> = {}
  for (const pair of (spec ?? '').split(',').filter(Boolean)) {
    const [key, value] = pair.split('=')
    if (!key || value === undefined) fail(`Bad knob "${pair}", expected key=value`)
    knobs[key] = /^\d+$/.test(value) ? Number(value) : value
  }
  return knobs as BenchKnobs
}

function apiKeyFor(provider: ProviderId): string | undefined {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY
  return undefined
}

async function reachable(url: string) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

// Always our own server, on a fixed port when it is free. Cache Storage is per
// origin, so every new port is a fresh cache: WebLLM downloads the model again
// and the profile keeps one copy per port until the disk fills. 5173 is often
// another checkout's, hence a port of our own.
const BENCH_PORT = 5188

async function portFree(port: number): Promise<boolean> {
  return new Promise(resolveFree => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => resolveFree(false))
    probe.listen(port, () => probe.close(() => resolveFree(true)))
  })
}

async function freePort(): Promise<number> {
  if (await portFree(BENCH_PORT)) return BENCH_PORT
  console.log(`Port ${BENCH_PORT} is taken; on-device models will download again on this port`)
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, () => {
      const address = probe.address()
      probe.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function ensureServer(
  url: string | undefined
): Promise<{ url: string; server?: ChildProcess }> {
  if (url) {
    if (!(await reachable(url))) fail(`Nothing is serving ${url}`)
    return { url }
  }
  const port = await freePort()
  const local = `http://localhost:${port}`
  console.log(`Starting the dev server on ${port}…`)
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--no-open'], {
    cwd: editorRoot,
    stdio: 'ignore',
  })
  for (let i = 0; i < 240; i++) {
    if (await reachable(local)) return { url: local, server }
    await new Promise(r => setTimeout(r, 500))
  }
  server.kill()
  fail('The dev server did not start within 120s')
}

function startUrl(base: string, start: string) {
  const path = start === 'blank' ? 'projects/new' : `examples/${start}`
  return `${base}/${path}?agentBench=1`
}

// A page that never reports ready is usually a one-off — a dev-server reload, a
// worker that lost a race — so it gets a second attempt before the run is written
// off. The caller records the failure as a row rather than ending the matrix.
async function openTask(page: Page, base: string, task: Task) {
  const url = startUrl(base, task.start)
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url)
      await page.waitForFunction(() => window.__noodlesAgentBench?.ready() === true, null, {
        timeout: READY_TIMEOUT_MS,
      })
      return
    } catch (error) {
      if (attempt > 1) throw error
      console.log(`  ${task.id}: page never became ready, reloading once`)
    }
  }
}

async function environment(page: Page, machine: string): Promise<Environment> {
  const browser = await page.evaluate(async () => {
    const nav = navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> }
      deviceMemory?: number
    }
    const adapter = await nav.gpu?.requestAdapter().catch(() => null)
    const info = adapter?.info
    return {
      userAgent: navigator.userAgent,
      gpu: info
        ? {
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description,
          }
        : null,
      deviceMemoryGb: nav.deviceMemory ?? null,
      cpuCores: navigator.hardwareConcurrency ?? null,
    }
  })
  const git = (cmd: string) => execSync(cmd, { cwd: editorRoot, encoding: 'utf8' }).trim()
  return {
    ...browser,
    gitSha: git('git rev-parse --short HEAD'),
    dirty: git('git status --porcelain').length > 0,
    machine,
  }
}

function toBenchTask(task: Task): BenchTask {
  return {
    id: task.id,
    turns: task.turns,
    setupModifications: task.setup.modifications,
    maxWallClockSeconds: task.budget.maxWallClockSeconds,
  }
}

function row(
  task: Task,
  result: BenchResult,
  knobs: string,
  repeat: number,
  g: ReturnType<typeof grade>
): RunRow {
  const diagnostics: RunRow['diagnostics'] = {}
  for (const turn of result.turns) {
    for (const d of turn.diagnostics) diagnostics[d.kind] = (diagnostics[d.kind] ?? 0) + 1
  }
  const sum = (pick: (t: BenchResult['turns'][number]) => number) =>
    result.turns.reduce((n, t) => n + pick(t), 0)
  return {
    taskId: task.id,
    tier: task.tier,
    provider: result.provider.id,
    model: result.provider.model,
    contextWindow: result.provider.contextWindow,
    knobs,
    repeat,
    score: g.score,
    pass: g.pass,
    mechanicalFailure: g.mechanicalFailure,
    steps: sum(t => t.steps),
    toolCalls: sum(t => t.toolCalls.length),
    inputTokens: sum(t => t.usage.inputTokens),
    outputTokens: sum(t => t.usage.outputTokens),
    diagnostics,
    ms: sum(t => t.ms),
    loadMs: result.loadMs,
    timedOut: result.timedOut,
    error: result.error,
  }
}

// A result for a run the page never returned from, so it still counts as a fail
function crashed(
  task: Task,
  config: BenchProviderConfig,
  knobs: BenchKnobs,
  error: string
): BenchResult {
  return {
    taskId: task.id,
    provider: { id: config.providerId, model: config.model ?? '', contextWindow: knobs.ctx ?? 0 },
    knobs,
    setupApply: null,
    turns: [],
    finalProject: null,
    finalOps: {},
    initialOperatorErrors: [],
    operatorErrors: [],
    registry: {},
    loadMs: 0,
    error,
    timedOut: false,
  }
}

async function runOne(
  page: Page,
  base: string,
  task: Task,
  config: BenchProviderConfig,
  knobs: BenchKnobs
): Promise<{ result: BenchResult; consoleErrors: string[]; providerLog: string[] }> {
  const consoleErrors: string[] = []
  // The provider's own debug lines: for WebLLM, prefill and decode timings per step
  const providerLog: string[] = []
  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500))
    const text = msg.text()
    if (/\[(webllm|chrome)\] (prefill|over context)/.test(text)) {
      providerLog.push(text.replace(/%c/g, '').trim().slice(0, 300))
    }
  }
  const onPageError = (error: Error) => consoleErrors.push(error.message.slice(0, 500))
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    // Inside the try: a project that will not open is one bad row, not the end of
    // a matrix that may have hours of model time behind it
    await openTask(page, base, task)
    const run = page.evaluate(
      ({ task, config, knobs }) => window.__noodlesAgentBench?.run(task, config, knobs),
      { task: toBenchTask(task), config, knobs }
    ) as Promise<BenchResult>
    // The hook enforces the task's own wall clock once the model is loaded; this
    // only catches a page that hangs outright
    const limit = LOAD_TIMEOUT_MS + task.budget.maxWallClockSeconds * 1000
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('page did not return')), limit)
    })
    return { result: await Promise.race([run, timeout]), consoleErrors, providerLog }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { result: crashed(task, config, knobs, message), consoleErrors, providerLog }
  } finally {
    // A pending timer would keep Node alive for the rest of the limit
    clearTimeout(timer)
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
  }
}

async function launch(browserName: string, headless: boolean): Promise<BrowserContext> {
  const profile = join(here, '.profile', browserName)
  mkdirSync(profile, { recursive: true })
  const context = await chromium.launchPersistentContext(profile, {
    channel: browserName === 'chrome' ? 'chrome' : undefined,
    headless,
    viewport: { width: 1440, height: 900 },
  })
  // Turns on the providers' debug lines, which is where step timings come from
  await context.addInitScript(() => localStorage.setItem('debug', 'noodles:ai-chat'))
  return context
}

// "· prefill 3.2s/412 tok avg": the per-step cost the KV cache is meant to cut
function prefillNote(providerLog: string[]): string {
  const steps = providerLog
    .map(line => line.match(/prefill (\d+) tokens in ([\d.]+)s/))
    .filter((match): match is RegExpMatchArray => match !== null)
  if (steps.length === 0) return ''
  const seconds = steps.reduce((sum, match) => sum + Number(match[2]), 0) / steps.length
  const tokens = steps.reduce((sum, match) => sum + Number(match[1]), 0) / steps.length
  return ` · prefill ${seconds.toFixed(1)}s/${Math.round(tokens)} tok avg`
}

async function main() {
  const providerId = args.provider as ProviderId | undefined
  if (!providerId) fail('--provider is required')

  const tasks = loadTasks(args.tasks)
  const models = args.model ? args.model.split(',') : [undefined]
  const knobSets = args.knobs?.length ? args.knobs : ['']
  const repeats = Number(args.repeats)
  const machine = args.machine ?? hostname()

  const runId = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${machine}`
  const rawDir = join(here, 'results', 'raw', runId)
  mkdirSync(rawDir, { recursive: true })

  const { url, server } = await ensureServer(args.url)
  // Inside the try, so a browser that will not start (Chrome missing, the
  // profile already open) still stops the dev server
  let context: BrowserContext | undefined

  try {
    context = await launch(args.browser ?? 'chrome', args.headless ?? false)
    const page = context.pages()[0] ?? (await context.newPage())
    await openTask(page, url, tasks[0])
    const summary: Summary = {
      runId,
      startedAt: new Date().toISOString(),
      environment: await environment(page, machine),
      rows: [],
    }
    const total = models.length * knobSets.length * tasks.length * repeats
    let done = 0

    for (const model of models) {
      for (const knobSpec of knobSets) {
        const knobs = parseKnobs(knobSpec)
        const config: BenchProviderConfig = { providerId, model, apiKey: apiKeyFor(providerId) }
        for (const task of tasks) {
          for (let repeat = 0; repeat < repeats; repeat++) {
            const { result, consoleErrors, providerLog } = await runOne(
              page,
              url,
              task,
              config,
              knobs
            )
            const graded = grade(task.grader.checks, { result, consoleErrors })
            const r = row(task, result, knobSpec, repeat, graded)
            summary.rows.push(r)
            done++

            const file = `${task.id}__${(model ?? providerId).replace(/[^\w.-]/g, '_')}__${
              knobSpec.replace(/[^\w=.-]/g, '_') || 'default'
            }__r${repeat}.json`
            writeFileSync(
              join(rawDir, file),
              JSON.stringify(
                { task, knobs, result, consoleErrors, providerLog, grade: graded, row: r },
                null,
                2
              )
            )
            console.log(
              `[${done}/${total}] ${configKey(r)} ${task.id} r${repeat}: ${r.pass ? 'PASS' : 'fail'} ${
                r.score
              }/4 · ${r.steps} steps · ${(r.ms / 1000).toFixed(1)}s${prefillNote(providerLog)}${
                r.error ? ` · ${r.error}` : ''
              }`
            )
            // Written after every run so an interrupted matrix keeps what it did
            writeFileSync(
              join(here, 'results', `${runId}.summary.json`),
              JSON.stringify(summary, null, 2)
            )
          }
        }
      }
    }
  } finally {
    await context?.close()
    server?.kill()
  }

  const summaryPath = join(here, 'results', `${runId}.summary.json`)
  if (args.judge) {
    const { DEFAULT_JUDGE_MODEL, judgeDirectory, parseTiers } = await import('./judge-run')
    await judgeDirectory(rawDir, {
      tiers: parseTiers('T3,T4'),
      samples: 3,
      model: DEFAULT_JUDGE_MODEL,
      force: false,
    })
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Summary
  console.log(`\n${renderMarkdown(summary)}\n`)
  console.log(`Summary: bench/agent/results/${runId}.summary.json`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
