// A user-supplied OpenAI-compatible endpoint: Groq, OpenAI, Together, a vLLM or
// llama.cpp server on the LAN, LM Studio on localhost. Same wire format as
// OpenRouter, so this file is only the differences:
//
// - The base URL is whatever the user typed, so it is normalised (trailing slash
//   stripped, `/chat/completions` appended) rather than trusted.
// - Usage comes back via `stream_options.include_usage`, OpenAI's spelling, not
//   OpenRouter's `usage.include`. Neither reports a price, so the readout shows
//   tokens only.
// - There is no model catalogue to size the context window from, so the window is
//   a conservative default the user can override. Under-guessing costs some
//   wasted budget; over-guessing gets requests rejected mid-conversation.
// - Nothing validates a typo'd URL until the first message fails, which is a bad
//   place to learn. validateCustomEndpoint hits GET /models first.

import type { AgentEvent, AgentProvider, AgentRequest } from '../types'
import {
  decodeChunks,
  describeFailure,
  isAbort,
  mapOpenAiEvents,
  toWireMessages,
  toWireTool,
} from './openai-format'

// Small enough to be true of most self-hosted models, large enough that the tool
// router still discloses more than the base five.
const DEFAULT_CONTEXT_WINDOW = 32_768

// Most OpenAI-compatible servers implement tool calling; the ones that don't
// report a 400 the first time tools are sent, which is clearer than silently
// dropping them. Images are the opposite — quietly ignored by most — so they are
// off unless the user says otherwise.
interface CustomProviderOptions {
  baseUrl: string
  apiKey: string
  model: string
  contextWindow?: number
  supportsNativeTools?: boolean
  supportsImages?: boolean
}

export class CustomProvider implements AgentProvider {
  readonly id = 'custom' as const
  readonly model: string
  readonly supportsNativeTools: boolean
  readonly supportsImages: boolean
  readonly contextWindow: number

  private endpoint: string
  private apiKey: string

  constructor(options: CustomProviderOptions) {
    this.model = options.model
    this.apiKey = options.apiKey
    this.endpoint = `${normalizeBaseUrl(options.baseUrl)}/chat/completions`
    this.contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    this.supportsNativeTools = options.supportsNativeTools ?? true
    this.supportsImages = options.supportsImages ?? false
  }

  async *stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (signal?.aborted) {
      yield { type: 'stop', reason: 'aborted' }
      return
    }

    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.buildBody(request)),
      })
    } catch (error) {
      if (isAbort(error, signal)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      // A bad host or a CORS refusal both land here as an opaque TypeError, so
      // name the endpoint the user configured rather than passing that on
      throw new Error(`Could not reach ${this.endpoint}: ${describeNetworkError(error)}`)
    }

    if (!response.ok || !response.body) {
      throw new Error(await describeFailure(response, 'Endpoint'))
    }

    try {
      yield* mapOpenAiEvents(decodeChunks(response.body, signal), 'custom')
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
      messages: toWireMessages(request, 'custom'),
      max_tokens: request.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }

    if (this.supportsNativeTools && request.tools.length > 0) {
      body.tools = request.tools.map(toWireTool)
    }

    return body
  }
}

export interface EndpointValidation {
  ok: boolean
  // Model ids the server advertises, when it advertises any. Worth surfacing:
  // the commonest custom-endpoint failure is a valid server with a mistyped
  // model name, and this is the list the user needed to see.
  models?: string[]
  error?: string
}

// Checks the endpoint before it is saved. GET /models is the one route every
// OpenAI-compatible server implements, and it costs nothing to call.
export async function validateCustomEndpoint(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<EndpointValidation> {
  const url = `${normalizeBaseUrl(baseUrl)}/models`

  let response: Response
  try {
    response = await fetch(url, {
      signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
  } catch (error) {
    return { ok: false, error: `Could not reach ${url}: ${describeNetworkError(error)}` }
  }

  if (!response.ok) {
    return { ok: false, error: await describeFailure(response, 'Endpoint') }
  }

  return { ok: true, models: await readModelIds(response) }
}

async function readModelIds(response: Response): Promise<string[] | undefined> {
  try {
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const ids = (body.data ?? [])
      .map(entry => entry.id)
      .filter((id): id is string => typeof id === 'string')
    return ids.length > 0 ? ids : undefined
  } catch {
    // A server that answers 200 with something other than the catalogue shape is
    // still reachable, which is what was being tested
    return undefined
  }
}

// Accepts `https://host/v1`, `https://host/v1/`, and bare `host/v1`. Anything
// without a scheme gets https, since a browser cannot use a scheme-less URL.
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

function describeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Browsers say "Failed to fetch" for DNS failures, refused connections, and
  // CORS blocks alike; the last is the likely one for a self-hosted server
  if (/failed to fetch|load failed|networkerror/i.test(message)) {
    return 'connection refused, or the server does not allow browser requests (CORS)'
  }
  return message
}
