// The run_code tool: evaluate JavaScript against the live graph.
//
// This is CodeOp's sandbox without a node — same `op()`, same timeline values, same
// d3/turf/deck/utils/operator classes — so what the model already knows about
// writing CodeOp code transfers unchanged. What it adds over CodeOp is that nothing
// is persisted: the model can compute an answer, check a shape, or try a transform
// without first building a node to hold it.
//
// Two things are deliberate rather than incidental:
//
// - Results are summarized here, not by result-budget.ts alone. The budget caps what
//   reaches the model, but it serializes the whole value first, and serializing a
//   million-row array to then throw it away costs hundreds of megabytes of string.
// - Field-value changes are wrapped in one undo entry. Nothing stops code from
//   reaching further than that (the store is in scope), which is why the tool
//   description points structural edits at apply_modifications instead.

import { safeMode } from '../noodles/globals'
import { fnWithSource, freeExports, type IOperator, type Operator } from '../noodles/operators'
import { getOp } from '../noodles/store'
import { captureOperatorInputs, firePropertyMutation } from '../noodles/utils/property-history'
import { getTimelineContext } from '../noodles/utils/timeline-context'
import type { ToolResult } from './types'

export interface RunCodeParams {
  code: string
  // How long to wait on a returned promise. Sync code cannot be interrupted at all;
  // see the note on TIMEOUT_MS.
  timeoutMs?: number
}

// Previews are shaped for a model reading them, not for completeness — the
// budget's own ladder is a fallback, not the first line of defence.
const MAX_ITEMS = 20
const MAX_KEYS = 40
const MAX_STRING = 2000
const MAX_DEPTH = 6

const MAX_LOGS = 40
const MAX_LOG_CHARS = 500

// Bounds the await, not the code. A synchronous infinite loop hangs the tab and no
// amount of racing changes that — the only real fix is a worker, and a worker cannot
// see the graph, which is the entire point of this tool. What this does catch is the
// realistic hang: an await on a fetch that never resolves, which would otherwise
// wedge the agent loop with no step limit to save it.
const TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'
const LOG_LEVELS: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug']

export async function runCode(params: RunCodeParams): Promise<ToolResult> {
  // Safe mode exists to stop the app executing arbitrary code. A tool whose whole
  // job is that has to refuse, and tool-definitions.ts also stops it being offered.
  if (safeMode) {
    return { success: false, error: 'run_code is disabled in safe mode' }
  }

  const code = typeof params.code === 'string' ? params.code.trim() : ''
  if (!code) return { success: false, error: 'run_code requires a non-empty code string' }

  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(1, Math.floor(params.timeoutMs ?? TIMEOUT_MS))
  )

  let fn: ReturnType<typeof fnWithSource>
  try {
    fn = fnWithSource(
      ['op', 'sequenceTime', 'frame', 'totalFrames', 'sequence', ...Object.keys(freeExports)],
      code,
      'run_code'
    )
  } catch (error) {
    // fnWithSource already turns the raw SyntaxError into something actionable
    return { success: false, error: message(error) }
  }

  const timeline = getTimelineContext()
  const before = captureOperatorInputs()
  const logs: string[] = []
  const restore = captureConsole(logs)
  const started = performance.now()

  let raw: unknown
  try {
    raw = fn(
      requireOp,
      timeline.sequenceTime,
      timeline.frame,
      timeline.totalFrames,
      timeline.sequence,
      ...Object.values(freeExports)
    )
  } catch (error) {
    restore()
    return failure(error, logs, started, before)
  }

  if (!(raw instanceof Promise)) {
    restore()
    return success(raw, logs, started, before)
  }

  let timedOut = false
  try {
    raw = await withTimeout(raw, timeoutMs, () => {
      timedOut = true
    })
  } catch (error) {
    restore()
    return failure(error, logs, started, before)
  } finally {
    restore()
  }

  if (timedOut) {
    return {
      success: false,
      error: `run_code timed out after ${timeoutMs}ms. The code may still be running; it was awaited, not cancelled.`,
      data: { logs: logs.length > 0 ? logs : undefined },
    }
  }

  return success(raw, logs, started, before)
}

function success(
  value: unknown,
  logs: string[],
  started: number,
  before: string | null
): ToolResult {
  return {
    success: true,
    data: {
      result: describe(value, 0, []),
      logs: logs.length > 0 ? logs : undefined,
      ms: Math.round(performance.now() - started),
      ...commitMutations(before),
    },
  }
}

function failure(
  error: unknown,
  logs: string[],
  started: number,
  before: string | null
): ToolResult {
  return {
    success: false,
    error: message(error),
    // Logs from before the throw are usually where the reason is
    data: {
      logs: logs.length > 0 ? logs : undefined,
      ms: Math.round(performance.now() - started),
      ...commitMutations(before),
    },
  }
}

// One undo entry per call that actually changed a field value, and none at all for
// pure computation. Only covers field values: adding or deleting operators goes
// through apply_modifications, which the UI applies with its own history.
function commitMutations(before: string | null): { changedFieldValues?: true } {
  if (before === null) return {}
  const after = captureOperatorInputs()
  if (after === null || after === before) return {}
  firePropertyMutation('Run code', before)
  return { changedFieldValues: true }
}

function requireOp(path: string): Operator<IOperator> {
  const op = getOp(path)
  if (!op) throw new Error(`Operator '${path}' not found`)
  return op
}

function message(error: unknown): string {
  if (error instanceof Error) {
    return error.stack?.split('\n')[0] ?? `${error.name}: ${error.message}`
  }
  return String(error)
}

// Collects what the code logs so a model can debug the way a person would. The
// window is narrow but not exclusive — anything else in the app that logs while an
// awaited promise is in flight lands here too.
function captureConsole(logs: string[]): () => void {
  const original = new Map<LogLevel, (...args: unknown[]) => void>()

  for (const level of LOG_LEVELS) {
    original.set(level, console[level])
    console[level] = (...args: unknown[]) => {
      if (logs.length < MAX_LOGS) {
        const text = args.map(formatLogArg).join(' ')
        logs.push(
          level === 'log' ? clip(text, MAX_LOG_CHARS) : `[${level}] ${clip(text, MAX_LOG_CHARS)}`
        )
        if (logs.length === MAX_LOGS) logs.push(`[${MAX_LOGS} log limit reached, rest dropped]`)
      }
      original.get(level)?.(...args)
    }
  }

  return () => {
    for (const [level, fn] of original) console[level] = fn
  }
}

function formatLogArg(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(describe(value, MAX_DEPTH - 2, [])) ?? String(value)
  } catch {
    return String(value)
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[clipped, ${text.length} chars]`
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<undefined>(resolve => {
    timer = setTimeout(() => {
      onTimeout()
      resolve(undefined)
    }, ms)
  })
  try {
    return await Promise.race([promise, expiry])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// Turns an arbitrary runtime value into something small, JSON-safe and honest about
// what it left out. Markers are bracketed strings, matching result-budget's
// '[circular]', so a model reading a preview can tell it is reading a preview.
export function describe(value: unknown, depth: number, ancestors: unknown[]): unknown {
  if (value === undefined) return '[undefined]'
  if (value === null) return null

  if (typeof value === 'number') {
    // JSON.stringify turns these into null, which reads as "no value" when what
    // the model needs to see is that the arithmetic went wrong
    return Number.isFinite(value) ? value : `[${String(value)}]`
  }
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return `[${String(value)}]`
  if (typeof value === 'string') return clip(value, MAX_STRING)
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`

  if (value instanceof Error) return { error: value.name, message: value.message }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof RegExp) return String(value)

  if (depth >= MAX_DEPTH) return '[nested too deep to show]'
  // Cheaper and more precise than a Set: only true ancestors are cycles, so
  // sibling repeats still render
  if (ancestors.includes(value)) return '[circular]'
  const path = [...ancestors, value]

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const typed = value as unknown as {
      length: number
      slice(a: number, b: number): ArrayLike<number>
    }
    return {
      type: value.constructor.name,
      length: typed.length,
      sample: Array.from(typed.slice(0, MAX_ITEMS)),
    }
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map(item => describe(item, depth + 1, path))
    if (value.length <= MAX_ITEMS) return items
    return { length: value.length, sample: items, note: `first ${MAX_ITEMS} of ${value.length}` }
  }

  if (value instanceof Map) {
    return {
      type: 'Map',
      size: value.size,
      entries: [...value.entries()]
        .slice(0, MAX_ITEMS)
        .map(([k, v]) => [describe(k, depth + 1, path), describe(v, depth + 1, path)]),
    }
  }

  if (value instanceof Set) {
    return {
      type: 'Set',
      size: value.size,
      values: [...value].slice(0, MAX_ITEMS).map(item => describe(item, depth + 1, path)),
    }
  }

  // Operators serialize enormously and are identified by path anyway
  if (isOperator(value)) return `[Operator ${value.id}]`

  const entries = Object.entries(value as Record<string, unknown>)
  const out: Record<string, unknown> = {}
  for (const [key, item] of entries.slice(0, MAX_KEYS)) {
    out[key] = describe(item, depth + 1, path)
  }
  if (entries.length > MAX_KEYS) {
    out._omittedKeys = entries.length - MAX_KEYS
  }
  return out
}

function isOperator(value: object): value is { id: string } {
  return 'id' in value && 'inputs' in value && 'outputs' in value && typeof value.id === 'string'
}
