// The agent filesystem: list_files, read_file, write_file, grep_files over the
// project's own data directory.
//
// This is a thin layer over noodles/storage.ts — the same readAsset/writeAsset the
// FileOp uses — so a file the assistant writes is loadable by a FileOp at
// `@/.agent/name.csv` with no import step. That round trip is the point: write a
// joined CSV, point a FileOp at it, and the graph renders it.
//
// The asymmetry is deliberate and load-bearing. Reads reach anywhere under `data/`,
// because that is what the project already shows the assistant through its nodes.
// Writes are confined to `data/.agent/`, so a mistaken path cannot clobber the
// dataset the project is built on. Paths are resolved before they are checked, so a
// `../` cannot climb out of the sandbox by construction rather than by blocklist.

import { useFileSystemStore } from '../noodles/filesystem-store'
import { listDataFiles, readAsset, writeAsset } from '../noodles/storage'
import { projectScheme, type StorageType } from '../noodles/utils/filesystem'
import type { ToolResult } from './types'

// The only directory the assistant may write to, relative to the data directory
export const AGENT_DIRECTORY = '.agent'

// Where a write parks the previous contents of a file it replaced. Not undo — the
// undo stack snapshots project JSON, not files — but enough that a clobbered scratch
// file is recoverable, and it stays inside the write sandbox.
const PREVIOUS_DIRECTORY = `${AGENT_DIRECTORY}/.previous`

// A NUL byte means two different things here: in a path it is an attempt to confuse
// a name-based check, and in file contents it means the file is not text
const NUL = '\u0000'

// A file this small comes back whole; anything larger is summarized, because
// read_file feeds a transcript and run_code is the tool for bulk contents
const INLINE_MAX_LINES = 200
const INLINE_MAX_CHARS = 20_000
const HEAD_LINES = 30
const TAIL_LINES = 10
const RANGE_MAX_LINES = 400

const MAX_LINE_CHARS = 400
const MAX_LISTED_FILES = 200

const MAX_GREP_MATCHES = 40
// Generous on purpose: nyc-taxis' single data file is 12M chars, and a cap that skips
// the only file in the project makes the tool useless. This bounds scan time, not
// memory — readAsset has already materialized the whole string either way.
const MAX_GREP_FILE_CHARS = 50_000_000
// Total across all files, so a grep over a directory of large CSVs terminates
const MAX_GREP_TOTAL_CHARS = 100_000_000

export interface ListFilesParams {
  path?: string
  maxResults?: number
}

export interface ReadFileParams {
  path: string
  startLine?: number
  endLine?: number
}

export interface WriteFileParams {
  path: string
  content: string
}

export interface GrepFilesParams {
  pattern: string
  path?: string
  contextLines?: number
  maxResults?: number
  ignoreCase?: boolean
}

export async function listFiles(params: ListFilesParams): Promise<ToolResult> {
  const store = storageContext()
  if (!store.ok) return { success: false, error: store.error }

  const scope = params.path ? resolvePath(params.path) : { ok: true as const, relative: '' }
  if (!scope.ok) return { success: false, error: scope.error }

  const all = await visibleFiles(store, scope.relative)
  if (!all.ok) return { success: false, error: all.error }

  const requested = clamp(params.maxResults ?? MAX_LISTED_FILES, 1, MAX_LISTED_FILES)
  const files = all.files.slice(0, requested)

  return {
    success: true,
    data: {
      directory: `${projectScheme}${scope.relative}`,
      count: all.files.length,
      files,
      // Named on every listing so the model does not have to guess where it may write
      scratchDirectory: `${projectScheme}${AGENT_DIRECTORY}/`,
      ...(all.files.length > files.length
        ? { truncated: `showing ${files.length} of ${all.files.length}; pass path to narrow` }
        : {}),
    },
  }
}

export async function readFile(params: ReadFileParams): Promise<ToolResult> {
  const store = storageContext()
  if (!store.ok) return { success: false, error: store.error }

  const target = resolvePath(params.path)
  if (!target.ok) return { success: false, error: target.error }
  if (!target.relative) return { success: false, error: 'read_file needs a file path' }

  const read = await readAsset(store.type, store.project, target.relative)
  if (!read.success) {
    return { success: false, error: `${read.error.message} (${target.relative})` }
  }

  const text = read.data
  if (text.includes(NUL)) {
    return {
      success: false,
      error: `'${target.relative}' is not a text file. Load it with a FileOp, or read it in run_code.`,
    }
  }

  const lines = text.split('\n')
  const base = {
    path: `${projectScheme}${target.relative}`,
    lines: lines.length,
    chars: text.length,
  }

  if (params.startLine !== undefined || params.endLine !== undefined) {
    const start = clamp(params.startLine ?? 1, 1, lines.length)
    const requestedEnd = clamp(params.endLine ?? lines.length, start, lines.length)
    const end = Math.min(requestedEnd, start + RANGE_MAX_LINES - 1)
    return {
      success: true,
      data: {
        ...base,
        range: `${start}-${end}`,
        content: lines.slice(start - 1, end).join('\n'),
      },
    }
  }

  if (lines.length <= INLINE_MAX_LINES && text.length <= INLINE_MAX_CHARS) {
    return { success: true, data: { ...base, content: text } }
  }

  return {
    success: true,
    data: {
      ...base,
      head: lines.slice(0, HEAD_LINES).map(clipLine),
      tail: lines.slice(-TAIL_LINES).map(clipLine),
      note: 'Too large to send whole. Pass startLine/endLine to page through it, or use run_code to work on the full contents.',
    },
  }
}

export async function writeFile(params: WriteFileParams): Promise<ToolResult> {
  const store = storageContext()
  if (!store.ok) return { success: false, error: store.error }

  const target = resolvePath(params.path, { forWrite: true })
  if (!target.ok) return { success: false, error: target.error }

  if (typeof params.content !== 'string') {
    return { success: false, error: 'write_file needs content as a string' }
  }

  // Read first: a replaced file's previous contents are the one thing this operation
  // destroys, and the write sandbox is the only place they can be parked
  const existing = await readAsset(store.type, store.project, target.relative)
  let previousContentsAt: string | undefined
  if (existing.success) {
    const backup = `${PREVIOUS_DIRECTORY}/${target.relative.slice(AGENT_DIRECTORY.length + 1)}`
    const saved = await writeAsset(store.type, store.project, backup, existing.data)
    if (saved.success) previousContentsAt = `${projectScheme}${backup}`
  }

  const written = await writeAsset(store.type, store.project, target.relative, params.content)
  if (!written.success) {
    return { success: false, error: `${written.error.message} (${target.relative})` }
  }

  const path = `${projectScheme}${target.relative}`
  return {
    success: true,
    data: {
      path,
      bytes: new TextEncoder().encode(params.content).length,
      lines: params.content === '' ? 0 : params.content.split('\n').length,
      ...(existing.success ? { replaced: true, previousContentsAt } : {}),
      note: `Load it by setting a FileOp's url to ${path}`,
    },
  }
}

export async function grepFiles(params: GrepFilesParams): Promise<ToolResult> {
  const store = storageContext()
  if (!store.ok) return { success: false, error: store.error }

  if (typeof params.pattern !== 'string' || params.pattern === '') {
    return { success: false, error: 'grep_files needs a non-empty pattern' }
  }

  let regex: RegExp
  try {
    regex = new RegExp(params.pattern, params.ignoreCase ? 'i' : '')
  } catch (error) {
    return { success: false, error: `Invalid pattern: ${(error as Error).message}` }
  }

  const scope = params.path ? resolvePath(params.path) : { ok: true as const, relative: '' }
  if (!scope.ok) return { success: false, error: scope.error }

  const candidates = await visibleFiles(store, scope.relative)
  if (!candidates.ok) return { success: false, error: candidates.error }

  const context = clamp(params.contextLines ?? 0, 0, 5)
  const limit = clamp(params.maxResults ?? 20, 1, MAX_GREP_MATCHES)

  const matches: object[] = []
  const skipped: string[] = []
  let scanned = 0
  let budget = MAX_GREP_TOTAL_CHARS
  let truncated = false

  for (const file of candidates.files) {
    if (matches.length >= limit) {
      truncated = true
      break
    }

    const read = budget > 0 ? await readAsset(store.type, store.project, file) : undefined
    // Unreadable, binary, or past the scan budget — all reported rather than
    // silently dropped, because a grep that misses a file is worse than a slow one
    if (!read?.success || read.data.includes(NUL) || read.data.length > MAX_GREP_FILE_CHARS) {
      skipped.push(file)
      continue
    }

    budget -= read.data.length
    scanned++

    const lines = read.data.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i])) continue
      if (matches.length >= limit) {
        truncated = true
        break
      }
      matches.push({
        file: `${projectScheme}${file}`,
        line: i + 1,
        text: clipLine(lines[i]),
        ...(context > 0
          ? {
              before: lines.slice(Math.max(0, i - context), i).map(clipLine),
              after: lines.slice(i + 1, i + 1 + context).map(clipLine),
            }
          : {}),
      })
    }
  }

  return {
    success: true,
    data: {
      pattern: params.pattern,
      filesScanned: scanned,
      count: matches.length,
      matches,
      ...(skipped.length > 0 ? { skipped: skipped.map(file => `${projectScheme}${file}`) } : {}),
      ...(truncated ? { truncated: `stopped at ${limit} matches; narrow the pattern` } : {}),
    },
  }
}

type Resolved = { ok: true; relative: string } | { ok: false; error: string }

// The path guard. Every caller-supplied path goes through here first, and the check
// happens on the *resolved* segments rather than on the raw string — a blocklist of
// '..' spellings would be a game of whack-a-mole, whereas a stack that refuses to pop
// past the root cannot be talked out of it.
export function resolvePath(input: string, options: { forWrite?: boolean } = {}): Resolved {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'A file path is required' }
  }

  let path = input.trim()
  if (path.includes(NUL)) {
    return { ok: false, error: 'Path contains a null byte' }
  }
  // A backslash is a legal character in a POSIX file name, so treating it as a
  // separator would be wrong — but a path written for Windows is a mistake worth
  // naming rather than silently creating a file called `..\secrets`
  if (path.includes('\\')) {
    return { ok: false, error: 'Use / to separate path segments' }
  }

  if (path.startsWith(projectScheme)) path = path.slice(projectScheme.length)
  if (path.startsWith('/')) {
    return {
      ok: false,
      error: `Paths are relative to the project data directory (e.g. ${AGENT_DIRECTORY}/notes.md), not absolute`,
    }
  }
  // Both spellings reach the same place, and the model sees `data/…` in project JSON
  path = path.replace(/^data\//, '')

  const stack: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) {
        return { ok: false, error: `'${input}' points outside the project data directory` }
      }
      stack.pop()
      continue
    }
    stack.push(segment)
  }

  const relative = stack.join('/')

  if (options.forWrite) {
    if (stack.length < 2 || stack[0] !== AGENT_DIRECTORY) {
      return {
        ok: false,
        error: `Writes are only allowed inside ${projectScheme}${AGENT_DIRECTORY}/ — got '${input}'. The rest of the data directory is the project's own input data and is read-only.`,
      }
    }
    if (relative.startsWith(`${PREVIOUS_DIRECTORY}/`)) {
      return {
        ok: false,
        error: `${projectScheme}${PREVIOUS_DIRECTORY}/ holds contents replaced by earlier writes and is not writable`,
      }
    }
  }

  return { ok: true, relative }
}

type StorageContext =
  | { ok: true; type: StorageType; project: string }
  | { ok: false; error: string }

// The project a path is relative to. Examples load into memory storage, so this
// works on a bundled example as well as a saved project.
function storageContext(): StorageContext {
  const { currentProjectName, activeStorageType } = useFileSystemStore.getState()
  if (!currentProjectName) {
    return { ok: false, error: 'No project is loaded, so there is no data directory to read' }
  }
  return { ok: true, type: activeStorageType, project: currentProjectName }
}

// Files under a directory, with the backup directory hidden — it exists to recover
// from a mistake, not to be re-read or grepped
async function visibleFiles(
  store: { type: StorageType; project: string },
  relative: string
): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> {
  const listed = await listDataFiles(store.type, store.project)
  if (!listed.success) return { ok: false, error: listed.error.message }

  const prefix = relative ? `${relative}/` : ''
  const files = listed.data
    .filter(file => file.startsWith(prefix) && !file.startsWith(`${PREVIOUS_DIRECTORY}/`))
    .sort()
  return { ok: true, files }
}

function clipLine(line: string): string {
  return line.length <= MAX_LINE_CHARS
    ? line
    : `${line.slice(0, MAX_LINE_CHARS)}…[clipped, ${line.length} chars]`
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}
