// The OpenRouter provider: one OpenAI-compatible endpoint standing in front of
// most hosted models, which is what makes the model picker worth having.
//
// The wire format lives in openai-format.ts, shared with the custom-endpoint
// provider. What is OpenRouter's own: the attribution headers, `usage.include`
// for real per-request cost, and the `web` plugin — which bills on top of tokens,
// per request, even on free models, so it is opt-in per call and must never be
// switched on by default.

import type { AgentEvent, AgentProvider, AgentRequest } from '../types'
import {
  decodeChunks,
  describeFailure,
  isAbort,
  mapOpenAiEvents,
  toWireMessages,
  toWireTool,
} from './openai-format'

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
      throw new Error(await describeFailure(response, 'OpenRouter'))
    }

    try {
      yield* mapOpenAiEvents(decodeChunks(response.body, signal), 'openrouter')
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
      messages: toWireMessages(request, 'openrouter'),
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
