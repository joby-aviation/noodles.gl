// Greenfield workspace construction (07 D7 first bullet, 04's eval-isolation
// note). Workspaces are git-archive extractions of origin/main — no .git, so
// a session cannot reach any other branch — with the dogfooding artifacts
// stripped defensively, living outside the harness checkout entirely.

import { execFileSync, execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { REPO_ROOT, WORK_ROOT } from './config'

// Stripped from every eval checkout (none exist on origin/main today; the
// list is defensive so a future landing can't silently leak into T0-T3).
const STRIP_PATHS = ['evals', 'dev-docs/specs/agent-ready-docs', 'skills', '.claude/skills']
const AGENTS_MD_POINTER_RE = /\bskills\//

export function mainCommit(): string {
  return execFileSync('git', ['rev-parse', 'origin/main'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim()
}

export function templateDir(): string {
  return path.join(WORK_ROOT, `template-${mainCommit().slice(0, 12)}`)
}

/** Build (or reuse) the installed template workspace for origin/main. */
export function ensureTemplate(log: (msg: string) => void = console.log): string {
  const dir = templateDir()
  const stamp = path.join(dir, '.evals-template-ready')
  if (fs.existsSync(stamp)) return dir

  log(`building template workspace at ${dir} ...`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  execSync(`git archive ${mainCommit()} | tar -x -C ${JSON.stringify(dir)}`, { cwd: REPO_ROOT })

  stripAgentVisibleArtifacts(dir)

  log('installing dependencies in template (npm install) ...')
  execSync('npm install --no-audit --no-fund', { cwd: dir, stdio: 'pipe', timeout: 15 * 60_000 })

  fs.writeFileSync(stamp, `${mainCommit()}\n`)
  return dir
}

function stripAgentVisibleArtifacts(dir: string): void {
  for (const p of STRIP_PATHS) {
    fs.rmSync(path.join(dir, p), { recursive: true, force: true })
  }
  const agentsMd = path.join(dir, 'AGENTS.md')
  if (fs.existsSync(agentsMd)) {
    const lines = fs.readFileSync(agentsMd, 'utf-8').split('\n')
    const kept = lines.filter(line => !AGENTS_MD_POINTER_RE.test(line))
    if (kept.length !== lines.length) fs.writeFileSync(agentsMd, kept.join('\n'))
  }
}

export interface WorkspaceOptions {
  runId: string
  fixtures?: Array<{ from: string; to: string }>
  fixturesRoot: string
}

/** Create a per-session workspace from the template. Source files are real
 * copies; node_modules is hardlinked (npm replaces files by unlink+rename, so
 * links are safe, and in-place edits to sources can't reach the template). */
export function createWorkspace(opts: WorkspaceOptions): string {
  const template = ensureTemplate()
  const ws = path.join(WORK_ROOT, 'workspaces', opts.runId)
  fs.rmSync(ws, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(ws), { recursive: true })

  execSync(
    `rsync -a --exclude node_modules ${JSON.stringify(`${template}/`)} ${JSON.stringify(`${ws}/`)}`
  )
  for (const nm of ['node_modules', 'noodles-editor/node_modules', 'website/node_modules']) {
    const src = path.join(template, nm)
    if (fs.existsSync(src)) {
      execSync(`cp -al ${JSON.stringify(src)} ${JSON.stringify(path.join(ws, nm))}`)
    }
  }

  for (const fixture of opts.fixtures ?? []) {
    const from = path.join(opts.fixturesRoot, fixture.from)
    const to = path.join(ws, fixture.to)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }

  // A fresh, single-commit history so git works innocuously inside.
  execSync(
    'git init -q && git add -A -f --ignore-errors . >/dev/null 2>&1 || true; ' +
      'git -c user.email=evals@noodles.gl -c user.name=evals commit -qm "workspace" --no-verify >/dev/null 2>&1 || true',
    { cwd: ws, shell: '/bin/bash' }
  )

  return ws
}

export function destroyWorkspace(ws: string): void {
  if (ws.startsWith(path.join(WORK_ROOT, 'workspaces'))) {
    fs.rmSync(ws, { recursive: true, force: true })
  }
}

/** Post-run isolation audit: no tool call may reference the harness checkout,
 * the spec directory, or evals/ (07 D7). Scans raw tool_use inputs. */
export function isolationAudit(transcriptJsonl: string): { pass: boolean; violations: string[] } {
  const forbidden = [REPO_ROOT, 'dev-docs/specs/agent-ready-docs', /\bevals\//]
  const violations: string[] = []
  for (const line of transcriptJsonl.split('\n')) {
    if (!line.trim()) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const content = (event as { message?: { content?: unknown } })?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if ((block as { type?: string }).type !== 'tool_use') continue
      const input = JSON.stringify((block as { input?: unknown }).input ?? {})
      for (const f of forbidden) {
        if (typeof f === 'string' ? input.includes(f) : f.test(input)) {
          violations.push(`${(block as { name?: string }).name}: ${input.slice(0, 200)}`)
        }
      }
    }
  }
  return { pass: violations.length === 0, violations }
}
