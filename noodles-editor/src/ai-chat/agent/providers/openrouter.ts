// The OpenRouter provider: one OpenAI-compatible endpoint standing in front of
// most hosted models, which is what makes the model picker worth having.
//
// Two things here are easy to get wrong and expensive to debug:
//
// - Tool-call arguments arrive as string fragments spread across many deltas,
//   keyed by index and with the name only on the first one. Parsing a fragment
//   yields a syntax error; parsing the concatenation of fragments belonging to
//   two different calls yields plausible nonsense. Accumulate per index, parse
//   once at the end. mapOpenRouterEvents is exported so this is testable against
//   a captured stream rather than only in a browser.
//
// - Web search bills on top of tokens, per request, even on free models. It is
//   opt-in per call and must never be switched on by default.

import type {
  AgentEvent,
  AgentMessage,
  AgentProvider,
  AgentRequest,
  AgentTool,
  AgentUsage,
  StopReason,
} from '../types'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash'

// Windows OpenRouter reports for the shortlist. Only a hint for the disclosure
// and result budgets — a wrong entry costs some wasted budget, not a failure —
// so it is a static table rather than a startup fetch of /api/v1/models.
const CONTEXT_WINDOWS: Record<string, number> = {
  'google/gemini-2.5-flash': 1_000_000,
  'google/gemini-2.5-pro': 1_000_000,
  'anthropic/claude-sonnet-4.5': 200_000,
  'openai/gpt-5': 400_000,
}

const FALLBACK_CONTEXT_WINDOW = 128_000

// Offered by the model picker. Any OpenRouter slug works; these are the ones
// worth naming for this chat's mix of graph edits and data inspection.
export const OPENROUTER_MODELS = [
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'openai/gpt-5', label: 'GPT-5' },
] as const

interface OpenRouterProviderOptions {
  apiKey: string
  model?: string
  contextWindow?: number
  // Adds the `web` plugin to every request. Costs roughly a cent per call, so
  // the loop turns it on for a web_search tool call rather than for the chat.
  webSearch?: { maxResults?: number }
}

export class OpenRouterProvider implements AgentProvider {
  readonly id = 'openrouter' as const
  readonly model: string
  readonly supportsNativeTools = true
  readonly supportsImages = true
  readonly contextWindow: number

  private apiKey: string
  private webSearch?: { maxResults?: number }

  constructor(options: OpenRouterProviderOptions) {
    this.model = options.model ?? DEFAULT_OPENROUTER_MODEL
    this.apiKey = options.apiKey
    this.webSearch = options.webSearch
    this.contextWindow =
      options.contextWindow ?? CONTEXT_WINDOWS[this.model] ?? FALLBACK_CONTEXT_WINDOW
  }

  async *stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (signal?.aborted) {
      yield { type: 'stop', reason: 'aborted' }
      return
    }

    let response: Response
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // Attribution headers OpenRouter uses for its app rankings
          'HTTP-Referer': location.origin,
          'X-Title': 'Noodles.gl',
        },
        body: JSON.stringify(this.buildBody(request)),
      })
    } catch (error) {
      if (isAbort(error, signal)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      throw error
    }

    if (!response.ok || !response.body) {
      throw new Error(await describeFailure(response))
    }

    try {
      yield* mapOpenRouterEvents(decodeChunks(response.body, signal))
    } catch (error) {
      if (isAbort(error, signal)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      throw error
    }
  }

  private buildBody(request: AgentRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toWireMessages(request),
      max_tokens: request.maxTokens,
      stream: true,
      // Without this the final chunk carries no usage, and the cost readout has
      // nothing to show
      usage: { include: true },
    }

    if (request.tools.length > 0) body.tools = request.tools.map(toWireTool)
    if (this.webSearch) {
      body.plugins = [{ id: 'web', max_results: this.webSearch.maxResults ?? 3 }]
    }

    return body
  }
}

// --- wire format ---

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | WireContentPart[]
  tool_calls?: WireToolCall[]
  tool_call_id?: string
  reasoning_details?: unknown
}

type WireContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function toWireTool(tool: AgentTool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}

// OpenAI's format has no system field and no multi-part assistant turn: the
// system prompt is a message, and tool results are their own `tool` role rather
// than blocks inside a user turn. So one AgentMessage can fan out to several.
function toWireMessages(request: AgentRequest): WireMessage[] {
  const messages: WireMessage[] = [{ role: 'system', content: request.system }]
  for (const message of request.messages) {
    messages.push(...toWireMessage(message))
  }
  return messages
}

function toWireMessage(message: AgentMessage): WireMessage[] {
  // Tool results are separate messages and must come before the turn's own
  // content, since they answer the previous assistant turn
  const results: WireMessage[] = []
  const parts: WireContentPart[] = []
  const toolCalls: WireToolCall[] = []
  let reasoning: unknown

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        parts.push({ type: 'text', text: part.text })
        break
      case 'image':
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${part.mediaType};base64,${part.data}` },
        })
        break
      case 'tool_use':
        toolCalls.push({
          id: part.id,
          type: 'function',
          function: { name: part.name, arguments: JSON.stringify(part.input) },
        })
        break
      case 'tool_result':
        results.push({ role: 'tool', tool_call_id: part.toolUseId, content: part.content })
        break
      case 'provider_block':
        // Some models behind OpenRouter reject a tool call whose reasoning was
        // dropped, the same way Anthropic does with thinking blocks
        if (part.provider === 'openrouter') reasoning = part.block
        break
    }
  }

  const own: WireMessage[] = []
  if (parts.length > 0 || toolCalls.length > 0) {
    const wire: WireMessage = { role: message.role }
    // A text-only turn goes as a plain string: some providers behind OpenRouter
    // reject the parts array on assistant turns
    if (parts.length === 1 && parts[0].type === 'text') {
      wire.content = parts[0].text
    } else if (parts.length > 0) {
      wire.content = parts
    }
    if (toolCalls.length > 0) wire.tool_calls = toolCalls
    if (reasoning !== undefined) wire.reasoning_details = reasoning
    own.push(wire)
  }

  return [...results, ...own]
}

// --- streaming ---

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_details?: unknown
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  error?: { message?: string; code?: number }
}

// One tool call under construction. `name` and `id` arrive on the first delta
// for an index; `arguments` accrue across all of them.
interface PartialToolCall {
  id: string
  name: string
  arguments: string
}

export async function* mapOpenRouterEvents(
  chunks: AsyncIterable<string>
): AsyncIterable<AgentEvent> {
  const toolCalls = new Map<number, PartialToolCall>()
  const reasoningDetails: unknown[] = []
  let usage: AgentUsage | null = null
  let stopReason: StopReason = 'end_turn'

  for await (const raw of parseSseData(chunks)) {
    const chunk = parseChunk(raw)
    if (!chunk) continue

    if (chunk.error) {
      throw new Error(chunk.error.message ?? 'OpenRouter returned an error mid-stream')
    }

    if (chunk.usage) usage = toUsage(chunk.usage)

    const choice = chunk.choices?.[0]
    if (!choice) continue

    const delta = choice.delta
    if (delta?.content) yield { type: 'text_delta', text: delta.content }
    if (delta?.reasoning_details) reasoningDetails.push(delta.reasoning_details)

    for (const partial of delta?.tool_calls ?? []) {
      const index = partial.index ?? 0
      const existing = toolCalls.get(index) ?? { id: '', name: '', arguments: '' }
      toolCalls.set(index, {
        id: partial.id ?? existing.id,
        name: partial.function?.name ?? existing.name,
        arguments: existing.arguments + (partial.function?.arguments ?? ''),
      })
    }

    if (choice.finish_reason) stopReason = mapFinishReason(choice.finish_reason)
  }

  if (reasoningDetails.length > 0) {
    yield { type: 'provider_block', provider: 'openrouter', block: reasoningDetails.flat() }
  }

  // Emitted in index order, which is the order the model asked for them
  for (const index of [...toolCalls.keys()].sort((a, b) => a - b)) {
    const call = toolCalls.get(index)
    if (!call?.name) continue
    yield {
      type: 'tool_call',
      id: call.id || `call_${index}`,
      name: call.name,
      input: parseArguments(call.arguments),
    }
  }

  if (usage) yield { type: 'usage', usage }
  yield { type: 'stop', reason: stopReason }
}

// Yields the payload of each `data:` frame. Frames split at arbitrary byte
// boundaries, so this buffers rather than assuming a chunk is a whole line, and
// skips the `: OPENROUTER PROCESSING` keep-alive comments.
export async function* parseSseData(chunks: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = ''

  for await (const chunk of chunks) {
    buffer += chunk

    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')

      if (!line || line.startsWith(':')) continue
      if (!line.startsWith('data:')) continue

      const data = line.slice('data:'.length).trim()
      if (data === '[DONE]') return
      yield data
    }
  }

  const last = buffer.trim()
  if (last.startsWith('data:')) {
    const data = last.slice('data:'.length).trim()
    if (data && data !== '[DONE]') yield data
  }
}

async function* decodeChunks(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      yield decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}

function parseChunk(raw: string): StreamChunk | null {
  try {
    return JSON.parse(raw) as StreamChunk
  } catch {
    // A malformed frame is not worth failing the turn over
    return null
  }
}

// A model can emit `arguments` that never parse. Returning {} lets the tool
// report its own validation error, which the model can act on, instead of the
// whole run dying on a syntax error.
function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { value: parsed }
  } catch {
    return {}
  }
}

function toUsage(usage: NonNullable<StreamChunk['usage']>): AgentUsage {
  const result: AgentUsage = {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
  }
  if (usage.prompt_tokens_details?.cached_tokens !== undefined) {
    result.cachedInputTokens = usage.prompt_tokens_details.cached_tokens
  }
  if (usage.cost !== undefined) result.costUsd = usage.cost
  return result
}

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
    case 'error':
      return 'error'
    default:
      return 'end_turn'
  }
}

async function describeFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    if (parsed.error?.message) return `OpenRouter ${response.status}: ${parsed.error.message}`
  } catch {
    // Not JSON; the status line is all we have
  }
  return `OpenRouter ${response.status} ${response.statusText}`
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}
