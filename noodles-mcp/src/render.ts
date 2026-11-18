// render_project: a project to video with no editor open (#883). Runs the editor's render
// CLI (noodles-editor/scripts/render-project.ts), which starts the dev server and a headless
// Chromium, and reports its progress as the export goes.

import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

export interface RenderParams {
  project: string
  out: string
  startTime?: number
  endTime?: number
  fps?: number
  width?: number
  height?: number
  codec?: 'avc' | 'hevc' | 'vp9' | 'av1'
  url?: string
  timeoutSeconds?: number
}

export interface RenderProgress {
  state: string
  frame: number
  totalFrames: number
  error?: string
}

/** The command that renders, from the checkout at repoRoot, with paths resolved against cwd. */
export function renderCommand(
  repoRoot: string,
  cwd: string,
  params: RenderParams
): { command: string; args: string[]; cwd: string; out: string } {
  const out = resolve(cwd, params.out)
  const flag = (name: string, value: number | string | undefined) =>
    value === undefined ? [] : [`--${name}`, String(value)]
  return {
    command: join(repoRoot, 'node_modules/.bin/tsx'),
    cwd: join(repoRoot, 'noodles-editor'),
    out,
    args: [
      join(repoRoot, 'noodles-editor/scripts/render-project.ts'),
      resolve(cwd, params.project),
      '--out',
      out,
      '--json',
      ...flag('start', params.startTime),
      ...flag('end', params.endTime),
      ...flag('fps', params.fps),
      ...flag('width', params.width),
      ...flag('height', params.height),
      ...flag('codec', params.codec),
      ...flag('url', params.url),
      ...flag('timeout', params.timeoutSeconds),
    ],
  }
}

/** A status line the CLI writes with --json, or undefined for any other line. */
export function parseProgress(line: string): RenderProgress | undefined {
  if (!line.startsWith('{')) return undefined
  try {
    const value = JSON.parse(line) as Partial<RenderProgress>
    return typeof value.state === 'string' && typeof value.frame === 'number'
      ? (value as RenderProgress)
      : undefined
  } catch {
    return undefined
  }
}

export type RenderOutcome =
  | { ok: true; file: string; log: string[] }
  | { ok: false; error: string; log: string[] }

/** Runs the render, calling onProgress with each status, and resolves when it exits. */
export function runRender(
  repoRoot: string,
  cwd: string,
  params: RenderParams,
  onProgress: (progress: RenderProgress) => void = () => {}
): Promise<RenderOutcome> {
  const { command, args, cwd: dir, out } = renderCommand(repoRoot, cwd, params)
  return new Promise(done => {
    const log: string[] = []
    const child = spawn(command, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    let pending = ''
    const read = (chunk: Buffer) => {
      pending += chunk.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const progress = parseProgress(line)
        if (progress) onProgress(progress)
        else if (line.trim()) log.push(line)
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', error => done({ ok: false, error: error.message, log }))
    child.on('close', code => {
      if (pending.trim()) log.push(pending)
      if (code === 0) done({ ok: true, file: out, log })
      else {
        const reason = log.findLast(l => l.startsWith('Render failed:')) ?? log.at(-1)
        done({ ok: false, error: reason ?? `The render exited with code ${code}`, log })
      }
    })
  })
}
