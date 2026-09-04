// The OpenAI chat-completions wire format, shared by every provider that speaks
// it: OpenRouter, and any custom endpoint the user points at (Groq, OpenAI,
// vLLM, llama.cpp, LM Studio…). Only the URL, the auth header and a couple of
// body fields differ between them, so the format lives here and the providers
// stay thin.
//
// Two things here are easy to get wrong and expensive to debug:
//
// - Tool-call arguments arrive as string fragments spread across many deltas,
//   keyed by index and with the name only on the first one. Parsing a fragment
//   yields a syntax error; parsing the concatenation of fragments belonging to
//   two different calls yields plausible nonsense. Accumulate per index, parse
//   once at the end. mapOpenAiEvents is exported so this is testable against a
//   captured stream rather than only in a browser.
//
// - An SSE frame can split at any byte boundary, so the reader buffers instead
//   of assuming one chunk is one line.

import type {
  AgentEvent,
  AgentMessage,
  AgentRequest,
  AgentTool,
  AgentUsage,
  ProviderId,
  StopReason,
} from '../types'

export interface WireMessage {
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

export function toWireTool(tool: AgentTool) {
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
export function toWireMessages(request: AgentRequest, providerId: ProviderId): WireMessage[] {
  const messages: WireMessage[] = [{ role: 'system', content: request.system }]
  for (const message of request.messages) {
    messages.push(...toWireMessage(message, providerId))
  }
  return messages
}

function toWireMessage(message: AgentMessage, providerId: ProviderId): WireMessage[] {
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
        // Some models reject a tool call whose reasoning was dropped, the same
        // way Anthropic does with thinking blocks
        if (part.provider === providerId) reasoning = part.block
        break
    }
  }

  const own: WireMessage[] = []
  if (parts.length > 0 || toolCalls.length > 0) {
    const wire: WireMessage = { role: message.role }
    // A text-only turn goes as a plain string: some servers reject the parts
    // array on assistant turns
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

export async function* mapOpenAiEvents(
  chunks: AsyncIterable<string>,
  providerId: ProviderId
): AsyncIterable<AgentEvent> {
  const toolCalls = new Map<number, PartialToolCall>()
  const reasoningDetails: unknown[] = []
  let usage: AgentUsage | null = null
  let stopReason: StopReason = 'end_turn'

  for await (const raw of parseSseData(chunks)) {
    const chunk = parseChunk(raw)
    if (!chunk) continue

    if (chunk.error) {
      throw new Error(chunk.error.message ?? 'The model returned an error mid-stream')
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
    yield { type: 'provider_block', provider: providerId, block: reasoningDetails.flat() }
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

// Yields the payload of each `data:` frame, skipping SSE comments — which is
// what OpenRouter's `: OPENROUTER PROCESSING` keep-alives are.
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

export async function* decodeChunks(
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

// OpenAI-compatible servers disagree about error shape: nested `error.message`,
// a bare `message`, or plain text. Try each before falling back to the status.
export async function describeFailure(response: Response, label: string): Promise<string> {
  const body = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    const message = parsed.error?.message ?? parsed.message
    if (message) return `${label} ${response.status}: ${message}`
  } catch {
    // Not JSON; the status line is all we have
  }
  return `${label} ${response.status} ${response.statusText}`
}

export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}
