// The page side of the agent benchmark (noodles-editor/bench/agent/). The Node
// runner opens a project with ?agentBench=1 and calls
// window.__noodlesAgentBench.run(); this drives the same AgentSession, provider
// factory and modification applier the chat panel uses, so a benchmark run is a
// user's session minus the UI. Dev builds only — app.tsx never imports it in prod.

import type { EditorDoc } from '@noodles.gl/planner'
import { currentEngine, engineState, nodeErrors } from '../../editor/doc-engine'
import { docStore } from '../../editor/doc-store'
import { getKeysStore } from '../../noodles/keys-store'
import { createProvider } from '../agent/provider-factory'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_WEBLLM_MODEL } from '../agent/providers/webllm'
import { AgentSession } from '../agent/session'
import type {
  AgentEvent,
  AgentProvider,
  AgentUsage,
  DiagnosticKind,
  ProviderId,
} from '../agent/types'
import { applyModifications, type DocModification } from '../doc-tools'
import { globalContextManager } from '../global-context-manager'
import { editorDocContext, MCPTools } from '../mcp-tools'
import type { Message } from '../types'
import { paramsOf, registryOf } from './snapshot'

export interface BenchTask {
  id: string
  // First entry is the task prompt; the rest are scripted follow-ups
  turns: string[]
  // Applied before the first turn, e.g. to break a project for a debug task
  setupModifications?: DocModification[]
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

// What applying a batch of edits came to
export interface ApplyResult {
  success: boolean
  error?: string
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
  // Edits the model wrote out as JSON rather than calling a tool: the panel applies these after
  // the run. Tool calls apply as they run and are in toolCalls.
  apply: ApplyResult | null
  ms: number
  // Time to the first streamed token or tool call, the latency a user notices
  firstEventMs: number | null
}

export interface BenchResult {
  taskId: string
  provider: { id: ProviderId; model: string; contextWindow: number }
  knobs: BenchKnobs
  setupApply: ApplyResult | null
  turns: BenchTurn[]
  // The document after setup, before the first turn, so a judge can tell what the agent kept
  // from what it removed or overwrote
  initialDoc: EditorDoc | null
  finalDoc: EditorDoc | null
  // Every node's parameters with its operator's defaults filled in, which is what the grader
  // compares against: the document stores only what was set
  finalParams: Record<string, Record<string, unknown>>
  // Errors present before the first turn (after setup), so a check can tell what the agent
  // broke from what was already broken, or what it fixed
  initialErrors: { id: string; error: string }[]
  errors: { id: string; error: string }[]
  // Operator type -> its ports and parameters, for grading edges without the app. Inputs
  // include a parameter's `par:` port.
  registry: Record<string, { inputs: string[]; outputs: string[]; params: string[] }>
  loadMs: number
  error?: string
  timedOut: boolean
}

const PREVIEW_CHARS = 400
const SETTLE_TIMEOUT_MS = 15_000

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
    // The runner polls this before calling run(): the editor has to have loaded the document
    // and the engine to have drawn it once
    ready: () => docStore().get().loadId > 0 && engineState().ready,
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
  const initialErrors = errorsNow()
  const initialDoc = docStore().get().doc

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
      provider: {
        id: config.providerId,
        model: config.model ?? (config.providerId === 'webllm' ? DEFAULT_WEBLLM_MODEL : ''),
        contextWindow: knobs.ctx ?? (config.providerId === 'webllm' ? DEFAULT_CONTEXT_WINDOW : 0),
      },
      knobs,
      setupApply,
      turns: [],
      initialDoc,
      finalDoc: docStore().get().doc,
      finalParams: paramsOf(docStore().get().doc),
      initialErrors,
      errors: initialErrors,
      registry: registryOf(),
      loadMs: performance.now() - loadStart,
      error: `provider failed to load: ${e instanceof Error ? e.message : String(e)}`,
      timedOut: false,
    }
  }
  const loadMs = performance.now() - loadStart

  const tools = new MCPTools(loader)
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
      history.push({ role: 'user', content: prompt }, ...historyFor(turn))
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    if (timer) clearTimeout(timer)
    session.dispose()
  }

  // The final snapshot is what gets graded, so a graph still computing (a slow
  // fetch) would be graded on stale values and no error yet
  if (!(await settleGraph()) && !error) {
    error = `the graph was still computing ${SETTLE_TIMEOUT_MS / 1000}s after the last turn`
  }

  return {
    taskId: task.id,
    provider: { id: provider.id, model: provider.model, contextWindow: provider.contextWindow },
    knobs,
    setupApply,
    turns,
    initialDoc,
    finalDoc: docStore().get().doc,
    finalParams: paramsOf(docStore().get().doc),
    initialErrors,
    errors: errorsNow(),
    registry: registryOf(),
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

  // Edits written out as JSON are applied after the run, as the chat panel does when the user
  // accepts the proposal
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

async function applyAndSettle(modifications: unknown[]): Promise<ApplyResult> {
  const result = applyModifications(editorDocContext(), { modifications })
  await settleGraph()
  return { success: result.success, error: result.error }
}

// Waits for the engine to finish what the last edit set in motion: the edit reaches the engine
// on a later microtask, so yield first. Timers, not frames: a hidden tab runs no frames.
// False when the deadline passed first.
async function settleGraph(): Promise<boolean> {
  await sleep(0)
  const engine = currentEngine()
  if (!engine) return false
  const settled = await Promise.race([
    engine.settle().then(() => true),
    sleep(SETTLE_TIMEOUT_MS).then(() => false),
  ])
  await sleep(0)
  return settled
}

// What the chat panel keeps of a turn, so a scripted follow-up sees the same
// conversation a user's would: the reply with its tool uses, and a note when
// the editor rejected the turn's edits
export function historyFor(turn: Pick<BenchTurn, 'reply' | 'toolCalls' | 'apply'>): Message[] {
  const messages: Message[] = [
    {
      role: 'assistant',
      content: turn.reply || '(stopped)',
      toolUses: turn.toolCalls.map(call => ({
        name: call.name,
        params: call.params,
        ok: call.success,
      })),
    },
  ]
  if (turn.apply && !turn.apply.success) {
    messages.push({
      role: 'assistant',
      content: `Failed to apply modifications: ${turn.apply.error}`,
    })
  }
  return messages
}

function errorsNow(): BenchResult['errors'] {
  const engine = currentEngine()
  return engine ? nodeErrors(engine) : []
}

function clip(text: string) {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
