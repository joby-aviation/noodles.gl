// Provider-neutral wire types for the agent loop.
//
// The loop in loop.ts talks only to these, so one implementation drives a
// frontier Anthropic model, an OpenRouter model, and Chrome's built-in Gemini
// Nano. Anything provider-shaped (SSE framing, cache_control, JSON-constrained
// output for models without native tool calling) lives behind AgentProvider.

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'aborted' | 'error'

// 'custom' is any OpenAI-compatible endpoint the user configures — Groq, OpenAI,
// a local vLLM server — which is one provider from the loop's point of view no
// matter how many different servers it points at over time.
export type ProviderId = 'anthropic' | 'openrouter' | 'custom' | 'chrome'

export type AgentContent =
  | { type: 'text'; text: string }
  // base64 payload, matching what capture_visualization returns
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  // A block only its own provider understands, carried through the transcript so
  // it can be replayed byte-for-byte. Anthropic rejects a tool-result turn whose
  // preceding assistant turn dropped its thinking blocks, so this is load-bearing
  // rather than an optimisation. Other providers ignore blocks that aren't theirs.
  | { type: 'provider_block'; provider: ProviderId; block: unknown }

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: AgentContent[]
}

export interface AgentTool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export interface AgentRequest {
  system: string
  messages: AgentMessage[]
  tools: AgentTool[]
  maxTokens: number
}

export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  // Anthropic and OpenRouter both report cache hits separately, and the
  // difference is most of the cost on a long conversation
  cachedInputTokens?: number
  costUsd?: number
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'provider_block'; provider: ProviderId; block: unknown }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'stop'; reason: StopReason }

export interface AgentProvider {
  readonly id: ProviderId
  readonly model: string
  // False for Chrome's Prompt API, which has no tool calling and needs the loop
  // to fall back to JSON-constrained action selection
  readonly supportsNativeTools: boolean
  readonly supportsImages: boolean
  // Drives both the tool router's disclosure budget and the per-result char cap,
  // so a small model is not handed a payload it cannot hold
  readonly contextWindow: number

  stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>
}

// Convenience for the non-streaming callers (compaction's summarizer): drain a
// stream down to its text. Kept here rather than on the interface so a provider
// only ever has to implement stream().
export async function collectText(
  provider: AgentProvider,
  request: AgentRequest,
  signal?: AbortSignal
): Promise<string> {
  let text = ''
  for await (const event of provider.stream(request, signal)) {
    if (event.type === 'text_delta') text += event.text
  }
  return text
}

// Flattens a transcript to plain text, dropping images and tool plumbing.
// Used for persistence and for the compaction summarizer's input.
export function messageText(message: AgentMessage): string {
  return message.content
    .filter((part): part is Extract<AgentContent, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}
