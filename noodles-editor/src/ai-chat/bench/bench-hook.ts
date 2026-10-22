// The page side of the agent benchmark (noodles-editor/bench/agent/). The Node
// runner opens a project with ?agentBench=1 and calls
// window.__noodlesAgentBench.run(); this drives the same AgentSession, provider
// factory and modification applier the chat panel uses, so a benchmark run is a
// user's session minus the UI. Dev builds only — app.tsx never imports it in prod.

import type {
  ModificationResult,
  ProjectModification as ReactFlowModification,
} from '../../noodles/hooks/use-project-modifications'
import { getKeysStore } from '../../noodles/keys-store'
import { getAllOps } from '../../noodles/store'
import { getCurrentProject, getModificationApplier, onProjectChange } from '../../webmcp/bridge'
import { createProvider } from '../agent/provider-factory'
import { AgentSession } from '../agent/session'
import type {
  AgentEvent,
  AgentProvider,
  AgentUsage,
  DiagnosticKind,
  ProviderId,
} from '../agent/types'
import { globalContextManager } from '../global-context-manager'
import { MCPTools } from '../mcp-tools'
import { getOperatorRegistry } from '../runtime-operator-registry'
import type { Message, NoodlesProject, ProjectModification } from '../types'

export interface BenchTask {
  id: string
  // First entry is the task prompt; the rest are scripted follow-ups
  turns: string[]
  // Applied before the first turn, e.g. to break a project for a debug task
  setupModifications?: ProjectModification[]
  maxWallClockSeconds?: number
}

// A cloud reference run needs a key the Node runner may not have. The editor this
// page is already running has one — from .env.local or the keys dialog — so fall
// back to it rather than making the benchmark a second place to configure keys.
function configuredKey(providerId: ProviderId): string | undefined {
  if (providerId !== 'anthropic' && providerId !== 'openrouter') return undefined
  // getKey never reads AI keys from the project file
  return getKeysStore().getKey(providerId)
}

export interface BenchProviderConfig {
  providerId: ProviderId
  model?: string
  apiKey?: string
}

// Ablation switches. Unset means today's behaviour.
export interface BenchKnobs {
  // WebLLM KV-cache size in tokens
  ctx?: number
  // Agent step limit; unset, the loop picks one from the window
  steps?: number
}

export interface BenchToolCall {
  name: string
  params: Record<string, unknown>
  success: boolean
  error?: string
  // Clipped so a large list_nodes does not dominate the raw result file
  preview: string
}

export interface BenchTurn {
  prompt: string
  reply: string
  steps: number
  toolCalls: BenchToolCall[]
  usage: AgentUsage
  diagnostics: { kind: DiagnosticKind; detail?: string }[]
  stopReasons: string[]
  modificationsCount: number
  apply: ModificationResult | null
  ms: number
  // Time to the first streamed token or tool call, the latency a user notices
  firstEventMs: number | null
}

export interface BenchResult {
  taskId: string
  provider: { id: ProviderId; model: string; contextWindow: number }
  knobs: BenchKnobs
  setupApply: ModificationResult | null
  turns: BenchTurn[]
  // The graph after setup, before the first turn, so a judge can tell what the
  // agent kept from what it removed or overwrote. Absent in older raw results.
  initialProject?: NoodlesProject | null
  finalProject: NoodlesProject | null
  // Every operator's serialized input values as the graph holds them, which is
  // what the grader compares against: node data can lag the operator. Output
  // names come from the live instance so fields a CodeOp added are included.
  finalOps: Record<string, { inputs: Record<string, unknown>; outputs: string[] }>
  // Errors present before the first turn (after setup), so a check can tell what
  // the agent broke from what was already broken — or what it fixed
  initialOperatorErrors: { id: string; error: string }[]
  operatorErrors: { id: string; error: string }[]
  // type -> input and output handle names, for grading edges without the app
  registry: Record<string, { inputs: string[]; outputs: string[] }>
  loadMs: number
  error?: string
  timedOut: boolean
}

const PREVIEW_CHARS = 400
const SETTLE_TIMEOUT_MS = 5000
// Consecutive idle frames before the graph counts as settled
const SETTLED_FRAMES = 3

declare global {
  interface Window {
    __noodlesAgentBench?: {
      run: (
        task: BenchTask,
        provider: BenchProviderConfig,
        knobs?: BenchKnobs
      ) => Promise<BenchResult>
      ready: () => boolean
    }
  }
}

export function installBenchHook() {
  window.__noodlesAgentBench = {
    run: runBenchTask,
    // The runner polls this before calling run(): the editor has to have loaded
    // the project and registered its applier
    ready: () => getModificationApplier() !== null && (getCurrentProject()?.nodes?.length ?? 0) > 0,
  }
}

async function runBenchTask(
  task: BenchTask,
  config: BenchProviderConfig,
  knobs: BenchKnobs = {}
): Promise<BenchResult> {
  const loadStart = performance.now()
  const loader = await globalContextManager.waitForReady()

  const setupApply = task.setupModifications?.length
    ? await applyAndSettle(task.setupModifications)
    : null
  await settleGraph()
  const initialOperatorErrors = operatorErrors()
  const initialProject = getCurrentProject()

  let provider: AgentProvider
  try {
    provider = await createProvider({
      providerId: config.providerId,
      apiKey: config.apiKey ?? configuredKey(config.providerId),
      model: config.model,
      customEndpoint: undefined,
      onDownloadProgress: () => {},
      contextWindow: knobs.ctx,
    })
  } catch (e) {
    // A model that will not load is a result, not a crash: on a low-end laptop
    // "the 8B model does not fit" is exactly what the benchmark should record
    return {
      taskId: task.id,
      provider: { id: config.providerId, model: config.model ?? '', contextWindow: knobs.ctx ?? 0 },
      knobs,
      setupApply,
      initialProject,
      turns: [],
      finalProject: getCurrentProject(),
      finalOps: opSnapshot(),
      initialOperatorErrors,
      operatorErrors: initialOperatorErrors,
      registry: registrySnapshot(),
      loadMs: performance.now() - loadStart,
      error: `provider failed to load: ${e instanceof Error ? e.message : String(e)}`,
      timedOut: false,
    }
  }
  const loadMs = performance.now() - loadStart

  const tools = new MCPTools(loader)
  const project = getCurrentProject()
  if (project) tools.setProject(project)
  const unsubscribe = onProjectChange(p => tools.setProject(p))
  // No web search: it would make runs depend on the network and on a second key
  const session = new AgentSession(provider, tools, { maxSteps: knobs.steps })

  const controller = new AbortController()
  let timedOut = false
  const timer = task.maxWallClockSeconds
    ? setTimeout(() => {
        timedOut = true
        controller.abort()
      }, task.maxWallClockSeconds * 1000)
    : null

  const turns: BenchTurn[] = []
  const history: Message[] = []
  let error: string | undefined

  try {
    for (const prompt of task.turns) {
      if (controller.signal.aborted) break
      const turn = await runTurn(session, prompt, history, controller.signal)
      turns.push(turn)
      history.push({ role: 'user', content: prompt }, { role: 'assistant', content: turn.reply })
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    if (timer) clearTimeout(timer)
    unsubscribe()
    session.dispose()
  }

  return {
    taskId: task.id,
    provider: { id: provider.id, model: provider.model, contextWindow: provider.contextWindow },
    knobs,
    setupApply,
    initialProject,
    turns,
    finalProject: getCurrentProject(),
    finalOps: opSnapshot(),
    initialOperatorErrors,
    operatorErrors: operatorErrors(),
    registry: registrySnapshot(),
    loadMs,
    error,
    timedOut,
  }
}

async function runTurn(
  session: AgentSession,
  prompt: string,
  history: Message[],
  signal: AbortSignal
): Promise<BenchTurn> {
  const start = performance.now()
  let firstEventMs: number | null = null
  const diagnostics: BenchTurn['diagnostics'] = []
  const stopReasons: string[] = []

  const onEvent = (event: AgentEvent) => {
    if (firstEventMs === null && (event.type === 'text_delta' || event.type === 'tool_call')) {
      firstEventMs = performance.now() - start
    }
    if (event.type === 'diagnostic') diagnostics.push({ kind: event.kind, detail: event.detail })
    if (event.type === 'stop') stopReasons.push(event.reason)
  }

  const response = await session.send({
    message: prompt,
    conversationHistory: history,
    signal,
    onEvent,
  })

  // Applied after the run, as the chat panel does
  const modifications = response.projectModifications ?? []
  const apply = modifications.length ? await applyAndSettle(modifications) : null

  return {
    prompt,
    reply: response.message,
    steps: stopReasons.length,
    toolCalls: (response.toolCalls ?? []).map(call => ({
      name: call.name,
      params: call.params,
      success: call.result.success,
      error: call.result.error,
      preview: clip(JSON.stringify(call.result.data ?? null) ?? ''),
    })),
    usage: response.usage ?? { inputTokens: 0, outputTokens: 0 },
    diagnostics,
    stopReasons,
    modificationsCount: modifications.length,
    apply,
    ms: performance.now() - start,
    firstEventMs,
  }
}

// The applier closes over the editor's current nodes, so the next apply has to
// wait for React to re-render and register a fresh one
async function applyAndSettle(modifications: ProjectModification[]): Promise<ModificationResult> {
  const applier = getModificationApplier()
  if (!applier) return { success: false, error: 'Editor not mounted' }

  const changed = new Promise<void>(resolve => {
    const off = onProjectChange(() => {
      off()
      resolve()
    })
  })
  // Same cast chat-panel.tsx makes: the validated modifications carry React Flow shapes
  const result = applier(modifications as unknown as ReactFlowModification[])
  if (result.success) await Promise.race([changed, sleep(SETTLE_TIMEOUT_MS)])
  await settleGraph()
  return result
}

// Waits until no operator is mid-execution, so errors from the new graph show up
// isComputing rather than executionState, which only says 'executing' after
// 200ms. Idle has to hold for a few frames, because the executor starts a
// downstream pull on a later frame than the upstream one that fed it.
async function settleGraph() {
  const deadline = performance.now() + SETTLE_TIMEOUT_MS
  let idleFrames = 0
  while (idleFrames < SETTLED_FRAMES && performance.now() < deadline) {
    await nextFrame()
    const busy = getAllOps().some(op => op.isComputing)
    idleFrames = busy ? 0 : idleFrames + 1
  }
}

function operatorErrors() {
  const errors: BenchResult['operatorErrors'] = []
  for (const op of getAllOps()) {
    const state = op.executionState.value
    if (state.status === 'error') errors.push({ id: op.id, error: state.error ?? 'unknown' })
  }
  return errors
}

// Large values (inline data, long code) are elided; no check needs them
const MAX_VALUE_CHARS = 2000

function opSnapshot(): BenchResult['finalOps'] {
  const snapshot: BenchResult['finalOps'] = {}
  for (const op of getAllOps()) {
    const inputs: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(op.inputs)) {
      try {
        const value = field.serialize()
        const json = JSON.stringify(value)
        inputs[name] = json && json.length > MAX_VALUE_CHARS ? '[elided]' : value
      } catch {
        inputs[name] = '[unserializable]'
      }
    }
    snapshot[op.id] = { inputs, outputs: Object.keys(op.outputs) }
  }
  return snapshot
}

function registrySnapshot(): BenchResult['registry'] {
  const snapshot: BenchResult['registry'] = {}
  for (const [type, schema] of Object.entries(getOperatorRegistry().operators)) {
    snapshot[type] = { inputs: Object.keys(schema.inputs), outputs: Object.keys(schema.outputs) }
  }
  return snapshot
}

function clip(text: string) {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)))
