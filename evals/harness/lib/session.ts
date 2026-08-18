// Greenfield session spawning, dispatched by provider (config.providerFor):
// us.anthropic.* runs the claude CLI in headless print mode with Bedrock env
// (config.sessionEnv); gpt-* runs the OpenAI Codex CLI (codex exec --json)
// with config.codexSessionEnv. Both capture a JSONL transcript verbatim as
// frozen evidence — renderTranscript understands both formats. Budgets:
// claude enforces turns via --max-turns plus a wall-clock kill; codex exec
// has no turn cap, so its budget is wall-clock only (turns are still counted
// and recorded from turn.completed events).

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { EVALS_ROOT, OPENAI_PRICING_PER_MTOK, codexSessionEnv, providerFor, sessionEnv } from './config'

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
  return providerFor(opts.model) === 'openai' ? runCodexSession(opts) : runClaudeSession(opts)
}

async function runClaudeSession(opts: SessionOptions): Promise<SessionResult> {
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

// --- Codex CLI (OpenAI) backend ------------------------------------------

/** codex exec binary: prefer the version pinned in evals/package.json. */
function codexBin(): string {
  const pinned = path.join(EVALS_ROOT, 'node_modules', '.bin', 'codex')
  return fs.existsSync(pinned) ? pinned : 'codex'
}

async function runCodexSession(opts: SessionOptions): Promise<SessionResult> {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check', // workspaces are .git-less by design; keep them identical across providers
    // The eval container is the sandbox — mirrors claude's
    // --dangerously-skip-permissions (flag help: "intended solely for
    // running in environments that are externally sandboxed").
    '--dangerously-bypass-approvals-and-sandbox',
    '--ephemeral', // no rollout files outside the workspace
    '--ignore-user-config',
    '--model',
    opts.model,
    opts.prompt,
  ]

  const started = Date.now()
  const out = fs.createWriteStream(opts.transcriptPath)
  const child = spawn(codexBin(), args, {
    cwd: opts.workspace,
    env: codexSessionEnv(),
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
  const parsed = parseCodexTranscript(transcriptJsonl, opts.model)
  if (exitCode !== 0 && parsed.turns === 0 && !timedOut) {
    fs.appendFileSync(opts.transcriptPath, `\n${JSON.stringify({ type: 'harness-error', stderr: stderr.slice(0, 2000) })}\n`)
  }

  return {
    transcriptJsonl,
    numTurns: parsed.turns > 0 ? parsed.turns : null,
    durationMs: Date.now() - started,
    timedOut,
    exitCode,
    costUsd: parsed.costUsd,
    usage: parsed.usage,
    resultText: parsed.lastAgentMessage,
    isError: parsed.failed || exitCode !== 0,
  }
}

interface CodexUsage {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
}

export function parseCodexTranscript(
  jsonl: string,
  model: string
): {
  turns: number
  usage: CodexUsage | null
  costUsd: number | null
  lastAgentMessage: string | null
  failed: boolean
} {
  let turns = 0
  let failed = false
  let lastAgentMessage: string | null = null
  const usage: CodexUsage = {}
  let sawUsage = false

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const type = String(event.type ?? '')
    if (type === 'turn.completed') {
      turns++
      const u = event.usage as CodexUsage | undefined
      if (u) {
        sawUsage = true
        for (const k of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens'] as const) {
          usage[k] = (usage[k] ?? 0) + (u[k] ?? 0)
        }
      }
      // TurnCompleteEvent carries the final message directly.
      if (typeof event.last_agent_message === 'string') lastAgentMessage = event.last_agent_message
    } else if (type === 'turn.failed' || type === 'error') {
      failed = true
    } else if (type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined
      const itemType = String(item?.type ?? item?.item_type ?? '')
      if (/agent.?message/i.test(itemType)) {
        const text = item?.text ?? item?.content ?? item?.message
        if (typeof text === 'string') lastAgentMessage = text
      }
    }
  }

  // codex exec reports tokens, not dollars — price from the pinned table.
  // Cached input is billed at the full input rate here (conservative; the
  // published cache discount is not pinned in config).
  const pricing = OPENAI_PRICING_PER_MTOK[model]
  const costUsd =
    sawUsage && pricing
      ? (((usage.input_tokens ?? 0) + (usage.cached_input_tokens ?? 0)) * pricing.input +
          ((usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0)) * pricing.output) /
        1_000_000
      : null

  return { turns, usage: sawUsage ? usage : null, costUsd, lastAgentMessage, failed }
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
 * citations must resolve against exactly this rendering). Handles both the
 * claude CLI stream-json format and the codex exec --json event format. */
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
    if (typeof type === 'string' && /^(thread|turn|item)\./.test(type)) {
      renderCodexEvent(lines, type, event)
      continue
    }
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

function renderCodexEvent(lines: string[], type: string, event: Record<string, unknown>): void {
  if (type === 'thread.started') {
    lines.push('[system] session started (codex exec, workspace initialized)')
    return
  }
  if (type === 'turn.failed') {
    pushBlock(lines, 'result(error)', JSON.stringify(event.error ?? event))
    return
  }
  // Only completed items carry final content; started/updated would duplicate.
  if (type !== 'item.completed') return
  const item = (event.item ?? {}) as Record<string, unknown>
  const itemType = String(item.type ?? item.item_type ?? '')
  const text = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v))
  if (/agent.?message/i.test(itemType)) {
    pushBlock(lines, 'assistant', text(item.text ?? item.content ?? item.message))
  } else if (/reasoning/i.test(itemType)) {
    // Reasoning summaries are model-internal; keep them but labeled, so judge
    // citations can point at stated intent without confusing it with output.
    pushBlock(lines, 'reasoning', truncate(text(item.text ?? item.summary ?? item.content), 2000))
  } else if (/command/i.test(itemType)) {
    pushBlock(lines, 'tool_use command', text(item.command ?? item.cmd))
    const output = item.aggregated_output ?? item.output ?? item.stdout
    if (output !== undefined) {
      const failed = item.exit_code !== undefined && item.exit_code !== 0
      pushBlock(lines, failed ? 'tool_result(error)' : 'tool_result', truncate(text(output), 4000))
    }
  } else if (/file.?change|patch/i.test(itemType)) {
    pushBlock(lines, 'tool_use file_change', truncate(text(item.changes ?? item.diff ?? item.path ?? item), 4000))
  } else if (/mcp|tool/i.test(itemType)) {
    pushBlock(lines, `tool_use ${text(item.server ?? '')}${text(item.tool ?? item.name ?? '')}`, truncate(text(item.arguments ?? item.input ?? ''), 2000))
    if (item.result !== undefined || item.output !== undefined) {
      pushBlock(lines, 'tool_result', truncate(text(item.result ?? item.output), 4000))
    }
  } else if (/web.?search/i.test(itemType)) {
    pushBlock(lines, 'tool_use web_search', text(item.query ?? ''))
  } else if (itemType) {
    pushBlock(lines, itemType, truncate(JSON.stringify(item), 1000))
  }
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
