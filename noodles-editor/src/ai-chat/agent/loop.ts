// The agent loop: stream a turn, execute whatever tools the model asked for,
// feed the results back, repeat until it stops asking.
//
// Everything provider-specific sits behind AgentProvider, and everything
// context-cost-specific behind ToolRouter and result-budget. What is left here
// is the control flow: step limits, parallel vs serial tool execution, and the
// screenshot handoff.

import { debugAiChat } from '../../utils/debug'
import type { MCPTools } from '../mcp-tools'
import { getToolDefinition } from '../tool-definitions'
import {
  type ProjectModification,
  parseModifications,
  type ToolCall,
  type ToolResult,
} from '../types'
import { capToolResult, resultBudgetChars } from './result-budget'
import { FIND_TOOLS_NAME, type ToolRouter } from './tool-router'
import type {
  AgentContent,
  AgentEvent,
  AgentMessage,
  AgentProvider,
  AgentUsage,
  StopReason,
} from './types'

// A step is one model turn plus its tool batch. Enough for a real
// inspect-then-act-then-verify sequence, few enough that a model stuck in a
// retry loop cannot spend the whole context window.
const DEFAULT_MAX_STEPS = 12
const SMALL_MODEL_MAX_STEPS = 6
const SMALL_CONTEXT_TOKENS = 32_000

const DEFAULT_MAX_TOKENS = 8192

interface ScreenshotData {
  screenshot: string
  format?: 'png' | 'jpeg'
}

interface ModificationsData {
  modifications: ProjectModification[]
}

function isScreenshotData(data: unknown): data is ScreenshotData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'screenshot' in data &&
    typeof (data as ScreenshotData).screenshot === 'string'
  )
}

function isModificationsData(data: unknown): data is ModificationsData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'modifications' in data &&
    Array.isArray((data as ModificationsData).modifications)
  )
}

export function maxStepsFor(provider: AgentProvider): number {
  return provider.contextWindow < SMALL_CONTEXT_TOKENS ? SMALL_MODEL_MAX_STEPS : DEFAULT_MAX_STEPS
}

export interface RunAgentParams {
  provider: AgentProvider
  tools: MCPTools
  router: ToolRouter
  systemPrompt: string
  // Full transcript including the user turn that starts this run
  messages: AgentMessage[]
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
  maxSteps?: number
  maxTokens?: number
  // Sub-agents run at depth 1 and may not spawn their own
  depth?: number
}

export interface AgentRunResult {
  text: string
  toolCalls: ToolCall[]
  modifications: ProjectModification[]
  // Transcript with every assistant turn and tool result appended
  messages: AgentMessage[]
  usage: AgentUsage
  stopReason: StopReason
  steps: number
}

export async function runAgent(params: RunAgentParams): Promise<AgentRunResult> {
  const {
    provider,
    tools,
    router,
    systemPrompt,
    signal,
    onEvent,
    maxTokens = DEFAULT_MAX_TOKENS,
    depth = 0,
  } = params

  const maxSteps = params.maxSteps ?? maxStepsFor(provider)
  const resultBudget = resultBudgetChars(provider.contextWindow)

  const messages: AgentMessage[] = [...params.messages]
  const toolCalls: ToolCall[] = []
  const modifications: ProjectModification[] = []
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0 }

  let text = ''
  let stopReason: StopReason = 'end_turn'
  let steps = 0

  while (steps < maxSteps) {
    if (signal?.aborted)
      return { text, toolCalls, modifications, messages, usage, stopReason: 'aborted', steps }

    steps++

    const turn = await streamTurn({
      provider,
      request: {
        system: systemPrompt,
        messages,
        tools: router.getTools(),
        maxTokens,
      },
      signal,
      onEvent,
    })

    text += turn.text
    accumulateUsage(usage, turn.usage)
    stopReason = turn.stopReason

    if (turn.stopReason === 'aborted') break

    // Record the assistant turn verbatim, tool_use blocks included: the next
    // request has to carry them or the tool results have nothing to attach to.
    // Provider blocks lead, because Anthropic requires thinking before text.
    const assistantContent: AgentContent[] = [...turn.providerBlocks]
    if (turn.text) assistantContent.push({ type: 'text', text: turn.text })
    for (const call of turn.toolCalls) {
      assistantContent.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    }
    if (assistantContent.length > 0) messages.push({ role: 'assistant', content: assistantContent })

    if (turn.toolCalls.length === 0) break

    const executed = await executeToolBatch({
      calls: turn.toolCalls,
      tools,
      router,
      resultBudget,
      depth,
      signal,
    })

    const resultContent: AgentContent[] = []
    let pendingScreenshot: { data: string; mediaType: string } | null = null

    for (const outcome of executed) {
      toolCalls.push({ name: outcome.name, params: outcome.input, result: outcome.result })

      if (outcome.result.success && isModificationsData(outcome.result.data)) {
        modifications.push(...outcome.result.data.modifications)
      }

      // A base64 screenshot in a tool result would be re-sent on every
      // subsequent request. Hand it to the model as an image block on this one
      // message instead, where the transport can drop it from history later.
      if (
        provider.supportsImages &&
        outcome.result.success &&
        isScreenshotData(outcome.result.data)
      ) {
        pendingScreenshot = {
          data: outcome.result.data.screenshot,
          mediaType: `image/${outcome.result.data.format ?? 'jpeg'}`,
        }
      }

      resultContent.push({
        type: 'tool_result',
        toolUseId: outcome.id,
        content: JSON.stringify(outcome.capped),
        isError: !outcome.result.success,
      })
    }

    if (pendingScreenshot) {
      resultContent.push({
        type: 'image',
        mediaType: pendingScreenshot.mediaType,
        data: pendingScreenshot.data,
      })
    }

    messages.push({ role: 'user', content: resultContent })
  }

  if (steps >= maxSteps && stopReason === 'tool_use') {
    debugAiChat('[agent] hit the %d step limit with tools still pending', maxSteps)
  }

  // Models sometimes write a modifications array into a fenced JSON block instead
  // of calling apply_modifications. Honouring that is the difference between the
  // edit landing and the user seeing a wall of JSON.
  modifications.push(...extractProsedModifications(text))

  return { text, toolCalls, modifications, messages, usage, stopReason, steps }
}

const JSON_BLOCK = /```json\s*([\s\S]*?)\s*```/g

function extractProsedModifications(text: string): ProjectModification[] {
  for (const match of text.matchAll(JSON_BLOCK)) {
    try {
      const modifications = parseModifications(JSON.parse(match[1]))
      if (modifications && modifications.length > 0) return modifications
    } catch {
      // Not a modifications block; the next fence may be
    }
  }
  return []
}

interface StreamedTurn {
  text: string
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
  providerBlocks: Array<Extract<AgentContent, { type: 'provider_block' }>>
  usage: AgentUsage | null
  stopReason: StopReason
}

async function streamTurn(params: {
  provider: AgentProvider
  request: Parameters<AgentProvider['stream']>[0]
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}): Promise<StreamedTurn> {
  const { provider, request, signal, onEvent } = params

  const turn: StreamedTurn = {
    text: '',
    toolCalls: [],
    providerBlocks: [],
    usage: null,
    stopReason: 'end_turn',
  }

  for await (const event of provider.stream(request, signal)) {
    onEvent?.(event)

    switch (event.type) {
      case 'text_delta':
        turn.text += event.text
        break
      case 'tool_call':
        turn.toolCalls.push({ id: event.id, name: event.name, input: event.input })
        break
      case 'provider_block':
        turn.providerBlocks.push({
          type: 'provider_block',
          provider: event.provider,
          block: event.block,
        })
        break
      case 'usage':
        turn.usage = event.usage
        break
      case 'stop':
        turn.stopReason = event.reason
        break
    }
  }

  return turn
}

// What a single tool call needs: the executors, plus the depth and signal that
// harness tools like delegate pass down to their own nested run
interface ToolCallParams {
  tools: MCPTools
  router: ToolRouter
  depth: number
  signal?: AbortSignal
}

interface ToolOutcome {
  id: string
  name: string
  input: Record<string, unknown>
  result: ToolResult
  capped: ToolResult
}

// Read-only calls in one batch run concurrently; the first mutating call forces
// the rest of the batch to run in order after it. Two apply_modifications calls
// racing on the same graph would interleave unpredictably, and a read scheduled
// alongside a write could observe either side of it.
async function executeToolBatch(
  params: ToolCallParams & {
    calls: Array<{ id: string; name: string; input: Record<string, unknown> }>
    resultBudget: number
  }
): Promise<ToolOutcome[]> {
  const { calls, resultBudget } = params

  const allReadOnly = calls.every(call => isReadOnly(call.name, params.router))

  if (allReadOnly && calls.length > 1) {
    return Promise.all(calls.map(call => runOne(call, params, resultBudget)))
  }

  const outcomes: ToolOutcome[] = []
  for (const call of calls) {
    outcomes.push(await runOne(call, params, resultBudget))
  }
  return outcomes
}

export function isReadOnly(toolName: string, router?: ToolRouter): boolean {
  // find_tools only mutates the router's own disclosure state, never the graph
  if (toolName === FIND_TOOLS_NAME) return true
  const harness = router?.getHarnessTool(toolName)
  if (harness) return harness.readOnly
  return getToolDefinition(toolName)?.annotations.readOnlyHint === true
}

async function runOne(
  call: { id: string; name: string; input: Record<string, unknown> },
  params: ToolCallParams,
  resultBudget: number
): Promise<ToolOutcome> {
  let result: ToolResult
  try {
    result = await executeTool(call.name, call.input, params)
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error executing tool',
    }
  }

  // Screenshots travel as an image block, so the base64 never belongs in the
  // text result, capped or not
  const forModel: ToolResult =
    result.success && isScreenshotData(result.data)
      ? {
          success: true,
          data: {
            ...omitScreenshot(result.data),
            message: 'Screenshot captured and attached to this message for your analysis',
          },
        }
      : result

  const capped = capToolResult(call.name, forModel, resultBudget)
  if (capped.truncated) {
    debugAiChat(
      '[agent] truncated %s result to %d chars (budget %d)',
      call.name,
      capped.chars,
      resultBudget
    )
  }

  return { id: call.id, name: call.name, input: call.input, result, capped: capped.result }
}

function omitScreenshot(data: ScreenshotData): Record<string, unknown> {
  const { screenshot: _screenshot, ...rest } = data
  return rest as Record<string, unknown>
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  params: ToolCallParams
): Promise<ToolResult> {
  const { tools, router, depth, signal } = params

  if (name === FIND_TOOLS_NAME) return router.findTools(input)

  // A narrowed router (a sub-agent's) has to refuse here as well as omit from the
  // tool list, because a model can name a tool it was never offered
  if (!router.isAllowed(name)) {
    return { success: false, error: `${name} is not available to this agent` }
  }

  const harness = router.getHarnessTool(name)
  if (harness) {
    if (!router.isCallable(name)) router.findTools({ query: name, limit: 1 })
    return harness.execute(input, { depth, signal })
  }

  const definition = getToolDefinition(name)
  if (!definition) return { success: false, error: `Unknown tool: ${name}` }

  // A model can name a tool it was never offered. Run it anyway — the definition
  // is real and the call is well-formed — but unlock it so the schema is present
  // next request instead of it guessing at the arguments again.
  if (!router.isCallable(name)) router.findTools({ query: name, limit: 1 })

  return definition.execute(tools, input, () => tools.getProject())
}

function accumulateUsage(total: AgentUsage, turn: AgentUsage | null) {
  if (!turn) return
  total.inputTokens += turn.inputTokens
  total.outputTokens += turn.outputTokens
  if (turn.cachedInputTokens !== undefined) {
    total.cachedInputTokens = (total.cachedInputTokens ?? 0) + turn.cachedInputTokens
  }
  if (turn.costUsd !== undefined) {
    total.costUsd = (total.costUsd ?? 0) + turn.costUsd
  }
}
