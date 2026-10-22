// quick-start-screenshot: the published quick-start prompt, pasted into a
// session that starts in an EMPTY directory. Done when the session has set
// Noodles up and shown a screenshot. The screenshot's pixels are checked in
// run.ts (agentScreenshot: decoding a JPEG needs the browser, so it is async);
// these checks cover what the workspace and the final answer show.

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CheckContext, CheckResult } from './types'

// The time target users are promised. The session's hard budget is longer so
// a slow-but-working setup still registers as a (failed) data point.
export const TARGET_SECONDS = 300

const IMAGE_RE = /\.(png|jpe?g|webp)$/i
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite', '.cache'])

/** The newest image the session wrote anywhere in its workspace, ignoring
 * images that ship with the repo (anything under a checked-out noodles-editor/,
 * docs/ or website/ tree, which the clone brings with it). */
export function findAgentScreenshot(workspace: string): string | null {
  let best: { file: string; mtime: number } | null = null
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        if (['noodles-editor', 'docs', 'website', 'dev-docs'].includes(e.name)) continue
        walk(full, depth + 1)
      } else if (IMAGE_RE.test(e.name)) {
        const mtime = fs.statSync(full).mtimeMs
        if (!best || mtime > best.mtime) best = { file: full, mtime }
      }
    }
  }
  walk(workspace, 0)
  return (best as { file: string } | null)?.file ?? null
}

/** A checkout of the repo with dependencies installed (depth <= 2). */
function findInstalledRepo(workspace: string): string | null {
  const candidates = [workspace]
  for (const e of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) candidates.push(path.join(workspace, e.name))
  }
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, 'noodles-editor')) &&
      fs.existsSync(path.join(dir, 'node_modules'))
    )
      return dir
  }
  return null
}

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { workspace, resultText, sessionDurationMs } = ctx
  if (!workspace) return { workspacePresent: { pass: false, detail: 'no workspace to inspect' } }

  const repo = findInstalledRepo(workspace)
  checks['repo-cloned-and-installed'] = {
    pass: repo !== null,
    detail: repo
      ? path.relative(workspace, repo) || '.'
      : 'no noodles-editor/ checkout with node_modules/',
  }

  const shot = findAgentScreenshot(workspace)
  checks['screenshot-saved'] = {
    pass: shot !== null,
    detail: shot ? path.relative(workspace, shot) : 'no image file written outside the repo trees',
  }

  const text = resultText ?? ''
  const named = shot !== null && text.includes(path.basename(shot))
  checks['answer-gives-screenshot-path'] = {
    pass: named,
    detail: shot
      ? `final answer ${named ? 'names' : 'does not name'} ${path.basename(shot)}`
      : 'no screenshot',
  }

  const seconds = (sessionDurationMs ?? Number.POSITIVE_INFINITY) / 1000
  checks['done-within-5-minutes'] = {
    pass: seconds <= TARGET_SECONDS,
    detail: `${Number.isFinite(seconds) ? seconds.toFixed(0) : '?'}s (target ${TARGET_SECONDS}s)`,
  }
  return checks
}
