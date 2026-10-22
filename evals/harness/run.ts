// Task runner (07 D5): spawn greenfield sessions, capture every artifact,
// run Layer-1 mechanical checks at run time and freeze them. Grading is
// decoupled — grade.ts consumes what this stores and never spawns sessions.
//
//   npm run run -- --task author-scatterplot --model anthropic.claude-sonnet-5 \
//     --sessions 3 --series 2026-07-06.t0.abc123 [--keep-workspace]

import * as fs from 'node:fs'
import * as path from 'node:path'
import { RESULTS_ROOT, TASKS_ROOT, TIER, VALIDATOR_VERSION, WORK_ROOT, assertProviderEnv, providerFor } from './lib/config'
import { analyzeImageFile, loadAndScreenshot } from './lib/playwright-check'
import { CUSTOM_CHECKS } from './lib/task-checks'
import { findAgentScreenshot } from './lib/task-checks/quick-start-screenshot'
import { type KeyEntry, scoreAnswers } from './lib/matchers'
import { loadRegistry, noodlesVersion } from './lib/registry'
import { renderTranscript, runSession } from './lib/session'
import { type MechanicalResults } from './lib/scoring'
import { loadTask } from './lib/task'
import { validateProject } from './lib/validate-project'
import {
  createEmptyWorkspace,
  createWorkspace,
  destroyWorkspace,
  ensureTemplate,
  isolationAudit,
  killWorkspaceProcesses,
  mainCommit,
} from './lib/workspace'

interface Args {
  task: string
  model: string
  sessions: number
  series: string
  startIndex: number
  keepWorkspace: boolean
  portBase: number
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`)
    if (i >= 0) return argv[i + 1]
    if (fallback !== undefined) return fallback
    throw new Error(`missing --${name}`)
  }
  return {
    task: get('task'),
    model: get('model'),
    sessions: Number.parseInt(get('sessions', '1'), 10),
    series: get('series'),
    startIndex: Number.parseInt(get('start-index', '1'), 10),
    keepWorkspace: argv.includes('--keep-workspace'),
    portBase: Number.parseInt(get('port-base', '5300'), 10),
  }
}

export async function runOne(args: {
  task: string
  model: string
  series: string
  sessionIndex: number
  keepWorkspace?: boolean
  port: number
}): Promise<string> {
  assertProviderEnv(args.model)
  const task = loadTask(args.task)
  // runIds are directory names: strip the profile prefix, flatten local/ slashes.
  const modelSlug = args.model.replace(/^(us\.)?anthropic\./, '').replace(/\//g, '-')
  const runId = `${task.id}--${modelSlug}--s${args.sessionIndex}`
  const runDir = path.join(RESULTS_ROOT, args.series, 'runs', runId)
  fs.rmSync(runDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true })

  const commit = mainCommit()
  console.log(`[${runId}] creating workspace (commit ${commit.slice(0, 12)})`)
  const emptyWorkspace = task.workspace?.mode === 'empty'
  const ws = emptyWorkspace
    ? createEmptyWorkspace(runId)
    : createWorkspace({ runId, fixtures: task.workspace?.fixtures, fixturesRoot: TASKS_ROOT })
  // Every claude CLI session gets a fresh, per-run config dir. Without one the
  // CLI loads the operator's ~/.claude (CLAUDE.md, hooks, skills, memory,
  // settings env), which is not greenfield and, on a desktop machine, can
  // point the session at an endpoint it cannot reach. MCP servers a prompt
  // adds (claude mcp add) also stay inside the run.
  const configDir = providerFor(args.model) === 'bedrock' ? path.join(WORK_ROOT, 'config', runId) : null
  if (configDir) {
    fs.rmSync(configDir, { recursive: true, force: true })
    fs.mkdirSync(configDir, { recursive: true })
  }

  // Base-project snapshot for modify tasks — read BEFORE the session runs.
  let baseRaw: string | null = null
  if (task.workspace?.project) {
    const basePath = path.join(ws, task.workspace.project)
    if (fs.existsSync(basePath)) baseRaw = fs.readFileSync(basePath, 'utf-8')
  }

  // Registry snapshot for this series (grading input; one copy per series).
  // An empty workspace has no source to parse; the template has the same commit.
  const registry = loadRegistry(emptyWorkspace ? ensureTemplate() : ws)
  const registryPath = path.join(RESULTS_ROOT, args.series, 'registry.json')
  if (!fs.existsSync(registryPath)) {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true })
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        {
          commit,
          types: [...registry.types],
          schemas: Object.fromEntries(
            [...registry.schemas].map(([k, v]) => [
              k,
              { inputs: [...v.inputs], outputs: [...v.outputs], inputsOpen: v.inputsOpen, outputsOpen: v.outputsOpen },
            ])
          ),
        },
        null,
        1
      )
    )
  }

  try {
    console.log(`[${runId}] spawning session (${args.model}, ≤${task.budget.maxTurns} turns, ≤${task.budget.maxWallClockSeconds}s)`)
    const transcriptPath = path.join(runDir, 'transcript.jsonl')
    const session = await runSession({
      workspace: ws,
      prompt: task.prompt,
      model: args.model,
      maxTurns: task.budget.maxTurns,
      maxWallClockSeconds: task.budget.maxWallClockSeconds,
      transcriptPath,
      env: configDir ? { CLAUDE_CONFIG_DIR: configDir } : undefined,
    })
    // Background processes the session started (dev servers) die with it.
    killWorkspaceProcesses(ws)
    fs.writeFileSync(path.join(runDir, 'transcript.txt'), renderTranscript(session.transcriptJsonl))

    // Collect final artifacts.
    const artifactRel = task.grader.artifact
    const artifactAbs = path.join(ws, artifactRel)
    let artifactRaw: string | null = null
    if (fs.existsSync(artifactAbs)) {
      artifactRaw = fs.readFileSync(artifactAbs, 'utf-8')
      fs.writeFileSync(path.join(runDir, 'artifacts', path.basename(artifactRel)), artifactRaw)
    }
    if (baseRaw !== null) {
      // stored so graders/judges can diff the modification against the base
      fs.writeFileSync(path.join(runDir, 'artifacts', 'base.noodles.json'), baseRaw)
    }

    // ---- Layer 1 (frozen at run time) ----
    const checks: MechanicalResults['checks'] = {}
    let nodeOutputs: Record<string, unknown> | null = null
    let answersDeterministic: MechanicalResults['answersDeterministic']

    if (task.grader.mechanical.validateProject) {
      if (artifactRaw === null) {
        checks.validateProject = { pass: false, detail: `${artifactRel} was not created` }
      } else {
        const result = validateProject(artifactRaw, registry, noodlesVersion(ws))
        checks.validateProject = {
          pass: result.valid,
          detail: result.errors.slice(0, 20).join('; ') || 'ok',
        }
      }
    }

    if (task.grader.mechanical.requiredNodeTypes && artifactRaw !== null) {
      try {
        const project = JSON.parse(artifactRaw)
        const present = new Set((project.nodes ?? []).map((n: { type?: string }) => n.type))
        const missing = task.grader.mechanical.requiredNodeTypes.filter(t => !present.has(t))
        checks.requiredNodeTypes = { pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'ok' }
      } catch {
        checks.requiredNodeTypes = { pass: false, detail: 'artifact is not valid JSON' }
      }
    } else if (task.grader.mechanical.requiredNodeTypes) {
      checks.requiredNodeTypes = { pass: false, detail: 'no artifact' }
    }

    if (task.grader.mechanical.load) {
      console.log(`[${runId}] load check (vite + playwright) ...`)
      let probeNodeIds: string[] | undefined
      if (task.grader.mechanical.load.probeLayers) {
        try {
          const project = JSON.parse(artifactRaw ?? '{}') as { nodes?: Array<{ id?: string; type?: string }> }
          probeNodeIds = (project.nodes ?? [])
            .filter(n => typeof n.type === 'string' && /LayerOp$/.test(n.type) && n.id)
            .map(n => n.id as string)
        } catch {
          probeNodeIds = []
        }
      }
      const load = await loadAndScreenshot({
        workspace: ws,
        route: task.grader.mechanical.load.route,
        screenshotPath: path.join(runDir, 'screenshot.png'),
        port: args.port,
        openTimeline: task.grader.mechanical.load.openTimeline,
        probeNodeIds,
      })
      nodeOutputs = load.nodeOutputs
      if (nodeOutputs) fs.writeFileSync(path.join(runDir, 'node-outputs.json'), JSON.stringify(nodeOutputs, null, 1))
      checks.loadsWithoutConsoleErrors = {
        pass: load.loaded && load.consoleErrors.length === 0,
        detail: load.consoleErrors.slice(0, 5).join(' | ') || load.detail,
      }
      checks.screenshotNonBlank = {
        pass: load.screenshotNonBlank === true,
        detail: `pixel stddev ${load.pixelStddev?.toFixed(2) ?? 'n/a'}`,
      }
    }

    if (task.grader.mechanical.custom) {
      const custom = CUSTOM_CHECKS[task.grader.mechanical.custom]
      if (!custom) throw new Error(`unknown custom check set "${task.grader.mechanical.custom}"`)
      const parse = (raw: string | null) => {
        if (raw === null) return null
        try {
          return JSON.parse(raw)
        } catch {
          return null
        }
      }
      const results = custom({
        after: parse(artifactRaw),
        before: parse(baseRaw),
        resultText: session.resultText,
        nodeOutputs,
        workspace: ws,
        sessionDurationMs: session.durationMs,
      })
      for (const [name, result] of Object.entries(results)) {
        checks[`custom:${name}`] = result
      }
    }

    if (task.grader.mechanical.agentScreenshot) {
      const shot = findAgentScreenshot(ws)
      if (shot === null) {
        checks.agentScreenshotNonBlank = { pass: false, detail: 'the session wrote no screenshot' }
      } else {
        // stored beside screenshot.png, not in artifacts/ (graders read artifacts as text)
        fs.copyFileSync(shot, path.join(runDir, `agent-screenshot${path.extname(shot).toLowerCase()}`))
        const stats = await analyzeImageFile(shot).catch(() => null)
        checks.agentScreenshotNonBlank = {
          pass: stats?.nonBlank === true,
          detail: stats ? `pixel stddev ${stats.stddev.toFixed(2)}` : 'image could not be decoded',
        }
      }
    }

    if (task.grader.mechanical.answers) {
      const key = (
        JSON.parse(fs.readFileSync(path.join(TASKS_ROOT, task.grader.mechanical.answers.key), 'utf-8')) as {
          answers: KeyEntry[]
        }
      ).answers
      let parsedAnswers: Record<string, unknown> | null = null
      if (artifactRaw !== null) {
        try {
          const p = JSON.parse(artifactRaw)
          if (p && typeof p === 'object' && !Array.isArray(p)) parsedAnswers = p
        } catch {
          /* unparseable */
        }
      }
      checks.answersFileParses = {
        pass: parsedAnswers !== null,
        detail: parsedAnswers ? 'ok' : `${artifactRel} missing or not a JSON object`,
      }
      if (parsedAnswers) {
        const scored = scoreAnswers(parsedAnswers, key)
        answersDeterministic = { correct: scored.deterministicCorrect, total: scored.deterministicTotal }
        fs.writeFileSync(path.join(runDir, 'matcher-outcomes.json'), JSON.stringify(scored.outcomes, null, 1))
      }
    }

    const checkList = Object.values(checks)
    const pass = checkList.every(c => c.pass)
    const score0to4 = task.grader.mechanical.answers
      ? answersDeterministic
        ? (4 * answersDeterministic.correct) / Math.max(1, answersDeterministic.total)
        : 0
      : (4 * checkList.filter(c => c.pass).length) / Math.max(1, checkList.length)

    const mechanical: MechanicalResults = { validatorVersion: VALIDATOR_VERSION, pass, checks, answersDeterministic, score0to4 }
    fs.writeFileSync(path.join(runDir, 'mechanical.json'), JSON.stringify(mechanical, null, 1))

    const audit = isolationAudit(session.transcriptJsonl, ws)
    const meta = {
      runId,
      series: args.series,
      taskId: task.id,
      taskVersion: task.taskVersion,
      tier: TIER,
      commit,
      sessionModel: args.model, // provider model id, verbatim
      provider: providerFor(args.model),
      region: providerFor(args.model) === 'bedrock' ? process.env.AWS_REGION : null,
      budget: task.budget,
      numTurns: session.numTurns,
      durationMs: session.durationMs,
      timedOut: session.timedOut,
      exitCode: session.exitCode,
      isError: session.isError,
      costUsd: session.costUsd,
      usage: session.usage,
      isolationAudit: audit,
      startedAt: new Date(Date.now() - session.durationMs).toISOString(),
    }
    fs.writeFileSync(path.join(runDir, 'session-meta.json'), JSON.stringify(meta, null, 1))
    console.log(
      `[${runId}] done: mechanical ${pass ? 'PASS' : 'FAIL'} (${score0to4.toFixed(2)}/4), turns=${session.numTurns}, ${(session.durationMs / 1000).toFixed(0)}s, isolation=${audit.pass ? 'pass' : 'FAIL'}`
    )
    return runId
  } finally {
    killWorkspaceProcesses(ws)
    if (!args.keepWorkspace) destroyWorkspace(ws)
    if (configDir) fs.rmSync(configDir, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2))
  for (let i = 0; i < args.sessions; i++) {
    const index = args.startIndex + i
    await runOne({
      task: args.task,
      model: args.model,
      series: args.series,
      sessionIndex: index,
      keepWorkspace: args.keepWorkspace,
      port: args.portBase + index,
    })
  }
}
