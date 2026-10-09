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
// 'webllm' runs the model in this tab via WebGPU, so it needs no account at all —
// at the price of a multi-gigabyte download the user has to ask for.
export type ProviderId = 'anthropic' | 'openrouter' | 'custom' | 'webllm' | 'chrome'

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

// Progress of an on-device model's first load. `loaded` is a 0..1 fraction for
// both providers that report one, but a byte count in older Chrome builds, so it
// is always read against `total` rather than assumed to be a percentage.
export interface DownloadProgress {
  loaded: number
  total: number
}

export interface AgentProvider {
  readonly id: ProviderId
  readonly model: string
  // False for the two on-device providers, Chrome's Prompt API and WebLLM, which
  // have no usable tool calling and fall back to JSON-constrained action
  // selection (providers/json-tools.ts)
  readonly supportsNativeTools: boolean
  readonly supportsImages: boolean
  // Drives both the tool router's disclosure budget and the per-result char cap,
  // so a small model is not handed a payload it cannot hold
  readonly contextWindow: number

  stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>

  // Releases anything the provider holds between turns. Only the on-device
  // providers have any — a Prompt API session that owns the transcript, a WebLLM
  // engine holding a model in VRAM — and the browser will not reclaim either.
  dispose?(): void
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
