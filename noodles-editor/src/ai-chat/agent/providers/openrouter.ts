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
const MODELS_URL = 'https://openrouter.ai/api/v1/models'

export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash'

// Windows OpenRouter reports for the shortlist. Only a hint for the disclosure
// and result budgets — a wrong entry costs some wasted budget, not a failure — so
// a static table is fine as the floor. Anything the catalogue tells us takes
// precedence; see LEARNED_WINDOWS.
const CONTEXT_WINDOWS: Record<string, number> = {
  'google/gemini-2.5-flash': 1_000_000,
  'google/gemini-2.5-pro': 1_000_000,
  'anthropic/claude-sonnet-4.5': 200_000,
  'openai/gpt-5': 400_000,
}

const INPUT_MODALITIES: Record<string, readonly string[]> = {
  'google/gemini-2.5-flash': ['text', 'image'],
  'google/gemini-2.5-pro': ['text', 'image'],
  'anthropic/claude-sonnet-4.5': ['text', 'image'],
  'openai/gpt-5': ['text', 'image'],
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

// --- free-model discovery ---
//
// Which models cost nothing, and which of those can call tools, both change often
// enough that a hard-coded list goes stale — the settings dialog shipped a Groq
// preset naming a model Groq had already retired. So the free tier is discovered
// from the catalogue at runtime, with the static shortlist above as the fallback
// when the fetch fails. /api/v1/models is public: no key, CORS open.

export interface OpenRouterModel {
  id: string
  label: string
  contextWindow: number
  free: boolean
  inputModalities: readonly string[]
}

interface CatalogueEntry {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
  supported_parameters?: unknown
  architecture?: { input_modalities?: unknown }
}

// Free models worth defaulting to, best first. Intersected with what the
// catalogue actually reports, so an entry that disappears costs nothing.
const PREFERRED_FREE_MODELS = [
  'deepseek/deepseek-chat-v3-0324:free',
  'z-ai/glm-4.5-air:free',
  'qwen/qwen3-235b-a22b:free',
  'meta-llama/llama-4-maverick:free',
]

// A dropdown is not a catalogue browser. Past a dozen the user is scrolling
// rather than choosing.
const MAX_FREE_MODELS = 12

let freeModels: OpenRouterModel[] | null = null
let inFlight: Promise<OpenRouterModel[]> | null = null

// Windows read from the catalogue, for every model it listed and not only the
// free ones. Kept apart from CONTEXT_WINDOWS so the static floor stays intact and
// a test can clear what was learned.
const LEARNED_WINDOWS = new Map<string, number>()
const LEARNED_MODALITIES = new Map<string, readonly string[]>()

// Free, tool-calling models from the live catalogue. Cached for the session:
// the list does not change often enough to re-fetch, and every caller wants the
// same answer. Returns [] rather than throwing when OpenRouter is unreachable,
// since the curated paid shortlist is still usable.
export function fetchOpenRouterFreeModels(signal?: AbortSignal): Promise<OpenRouterModel[]> {
  if (freeModels) return Promise.resolve(freeModels)
  if (inFlight) return inFlight

  inFlight = loadCatalogue(signal)
    .then(models => {
      freeModels = models
      return models
    })
    .catch(() => [])
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

// What fetchOpenRouterFreeModels last returned, without starting a request.
// Lets a render read the list synchronously.
export function cachedOpenRouterFreeModels(): OpenRouterModel[] {
  return freeModels ?? []
}

// The model a freshly connected account should start on: the best preferred free
// entry that is actually available, else the roomiest free one, else the paid
// default — which will fail with a clear billing error rather than silently.
export function defaultFreeModel(models = cachedOpenRouterFreeModels()): string {
  for (const id of PREFERRED_FREE_MODELS) {
    if (models.some(model => model.id === id)) return id
  }
  return models[0]?.id ?? DEFAULT_OPENROUTER_MODEL
}

async function loadCatalogue(signal?: AbortSignal): Promise<OpenRouterModel[]> {
  const response = await fetch(MODELS_URL, { signal })
  if (!response.ok) throw new Error(await describeFailure(response, 'OpenRouter'))

  const body = (await response.json()) as { data?: CatalogueEntry[] }
  const entries = body.data ?? []

  const free: OpenRouterModel[] = []
  for (const entry of entries) {
    const model = toModel(entry)
    if (!model) continue
    LEARNED_WINDOWS.set(model.id, model.contextWindow)
    LEARNED_MODALITIES.set(model.id, model.inputModalities)
    if (model.free) free.push(model)
  }

  return rank(free).slice(0, MAX_FREE_MODELS)
}

function toModel(entry: CatalogueEntry): OpenRouterModel | null {
  if (typeof entry.id !== 'string' || !entry.id) return null

  // A model that cannot call tools cannot drive this chat: every useful answer
  // starts with list_nodes. Offering one would produce confident fiction.
  const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : []
  if (!params.includes('tools')) return null

  const contextWindow =
    typeof entry.context_length === 'number' && entry.context_length > 0
      ? entry.context_length
      : FALLBACK_CONTEXT_WINDOW

  return {
    id: entry.id,
    label: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
    contextWindow,
    // Prices are decimal strings ('0', '0.0000012'), so compare numerically:
    // '0.0000012' is truthy and Number('') is 0, which both mislead.
    free: isZero(entry.pricing?.prompt) && isZero(entry.pricing?.completion),
    inputModalities: Array.isArray(entry.architecture?.input_modalities)
      ? entry.architecture.input_modalities.filter(
          (modality): modality is string => typeof modality === 'string'
        )
      : ['text'],
  }
}

function isZero(price: unknown): boolean {
  if (typeof price === 'number') return price === 0
  if (typeof price !== 'string' || price.trim() === '') return false
  return Number(price) === 0
}

// Preferred models first in their stated order, then whatever has the most room.
function rank(models: OpenRouterModel[]): OpenRouterModel[] {
  const rankOf = (id: string) => {
    const index = PREFERRED_FREE_MODELS.indexOf(id)
    return index === -1 ? PREFERRED_FREE_MODELS.length : index
  }
  return [...models].sort(
    (a, b) => rankOf(a.id) - rankOf(b.id) || b.contextWindow - a.contextWindow
  )
}

// Exported for tests: a cached catalogue would otherwise leak between cases.
export function resetOpenRouterCatalogue() {
  freeModels = null
  inFlight = null
  LEARNED_WINDOWS.clear()
  LEARNED_MODALITIES.clear()
}

interface OpenRouterProviderOptions {
  apiKey: string
  model?: string
  contextWindow?: number
  supportsImages?: boolean
  // Adds the `web` plugin to every request. Costs roughly a cent per call, so
  // the loop turns it on for a web_search tool call rather than for the chat.
  webSearch?: { maxResults?: number }
}

export class OpenRouterProvider implements AgentProvider {
  readonly id = 'openrouter' as const
  readonly model: string
  readonly supportsNativeTools = true
  readonly supportsImages: boolean
  readonly contextWindow: number

  private apiKey: string
  private webSearch?: { maxResults?: number }

  constructor(options: OpenRouterProviderOptions) {
    this.model = options.model ?? DEFAULT_OPENROUTER_MODEL
    this.apiKey = options.apiKey
    this.webSearch = options.webSearch
    const modalities = LEARNED_MODALITIES.get(this.model) ??
      INPUT_MODALITIES[this.model] ?? ['text']
    this.supportsImages = options.supportsImages ?? modalities.includes('image')
    this.contextWindow =
      options.contextWindow ??
      LEARNED_WINDOWS.get(this.model) ??
      CONTEXT_WINDOWS[this.model] ??
      FALLBACK_CONTEXT_WINDOW
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
