// Greenfield session spawning via the claude CLI in headless print mode with
// Bedrock env (see config.sessionEnv). Captures the stream-json transcript,
// enforces the task budget (turns via --max-turns, wall-clock via kill), and
// extracts usage/cost from the result event.

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import { sessionEnv } from './config'

export interface SessionResult {
  transcriptJsonl: string
  numTurns: number | null
  durationMs: number
  timedOut: boolean
  exitCode: number | null
  costUsd: number | null
  usage: unknown
  resultText: string | null
  isError: boolean
}

export interface SessionOptions {
  workspace: string
  prompt: string
  model: string
  maxTurns: number
  maxWallClockSeconds: number
  transcriptPath: string
}

export async function runSession(opts: SessionOptions): Promise<SessionResult> {
  const args = [
    '-p',
    opts.prompt,
    '--model',
    opts.model,
    '--max-turns',
    String(opts.maxTurns),
    '--output-format',
    'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ]

  const started = Date.now()
  const out = fs.createWriteStream(opts.transcriptPath)
  const child = spawn('claude', args, {
    cwd: opts.workspace,
    env: sessionEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(out)
  let stderr = ''
  child.stderr.on('data', d => {
    stderr += String(d)
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 10_000).unref()
  }, opts.maxWallClockSeconds * 1000)

  const exitCode: number | null = await new Promise(resolve => {
    child.on('close', code => resolve(code))
  })
  clearTimeout(timer)
  await new Promise(resolve => out.end(resolve))

  const transcriptJsonl = fs.readFileSync(opts.transcriptPath, 'utf-8')
  const result = lastResultEvent(transcriptJsonl)
  if (exitCode !== 0 && !result && !timedOut) {
    // Session died before producing anything gradeable — surface stderr.
    fs.appendFileSync(opts.transcriptPath, `\n${JSON.stringify({ type: 'harness-error', stderr: stderr.slice(0, 2000) })}\n`)
  }

  return {
    transcriptJsonl,
    numTurns: result?.num_turns ?? null,
    durationMs: Date.now() - started,
    timedOut,
    exitCode,
    costUsd: result?.total_cost_usd ?? null,
    usage: result?.usage ?? null,
    resultText: typeof result?.result === 'string' ? result.result : null,
    isError: result?.is_error ?? exitCode !== 0,
  }
}

interface ResultEvent {
  type: 'result'
  num_turns?: number
  total_cost_usd?: number
  usage?: unknown
  result?: string
  is_error?: boolean
}

function lastResultEvent(jsonl: string): ResultEvent | null {
  let found: ResultEvent | null = null
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'result') found = event
    } catch {
      // ignore partial lines
    }
  }
  return found
}

/** Render the JSONL transcript as numbered plain text for the judge (L123
 * citations must resolve against exactly this rendering). */
export function renderTranscript(jsonl: string): string {
  const lines: string[] = []
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(raw)
    } catch {
      continue
    }
    const type = event.type
    if (type === 'system') {
      lines.push(`[system] session started (tools + workspace initialized)`)
    } else if (type === 'assistant' || type === 'user') {
      const content = (event.message as { content?: unknown })?.content
      if (typeof content === 'string') {
        pushBlock(lines, type === 'assistant' ? 'assistant' : 'tool_result', content)
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>
          if (b.type === 'text') {
            pushBlock(lines, 'assistant', String(b.text))
          } else if (b.type === 'tool_use') {
            pushBlock(lines, `tool_use ${b.name}`, JSON.stringify(b.input))
          } else if (b.type === 'tool_result') {
            const body =
              typeof b.content === 'string'
                ? b.content
                : Array.isArray(b.content)
                  ? b.content
                      .map(c => (typeof (c as { text?: string }).text === 'string' ? (c as { text: string }).text : ''))
                      .join('\n')
                  : JSON.stringify(b.content)
            pushBlock(lines, b.is_error ? 'tool_result(error)' : 'tool_result', truncate(body, 4000))
          }
        }
      }
    } else if (type === 'result') {
      pushBlock(lines, 'result', String((event as { result?: unknown }).result ?? ''))
    }
  }
  return lines.map((line, i) => `L${i + 1}: ${line}`).join('\n')
}

function pushBlock(lines: string[], label: string, body: string): void {
  const text = truncate(body ?? '', 8000)
  const parts = text.split('\n')
  lines.push(`[${label}] ${parts[0] ?? ''}`)
  for (const part of parts.slice(1)) lines.push(part)
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n...[truncated ${s.length - n} chars]` : s
}
