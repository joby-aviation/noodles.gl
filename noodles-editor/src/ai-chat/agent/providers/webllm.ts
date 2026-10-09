// WebLLM: the model runs in this tab, on this GPU. No account, no key, no
// request ever leaving the machine — paid for once, up front, as a download of
// one to six gigabytes that the user has to ask for explicitly.
//
// Four things shape this provider:
//
// 1. No tool calling, for any model. WebLLM does ship native tool calls, but only
//    for four Hermes builds, and its parser requires the *entire* completion to be
//    a JSON array of calls — a plain-text final answer throws instead of ending the
//    turn. That is unusable for a loop that alternates between calling tools and
//    replying, so every model here goes through the JSON-constrained emulation in
//    json-tools.ts, the same one Chrome's built-in model uses. Grammar-constrained
//    decoding is enforced by the runtime rather than requested in the prompt, which
//    is why it works at all on a 1B model.
// 2. Every prebuilt model is pinned to a 4096-token window, prompt and completion
//    together. Overflowing it throws rather than truncating, so the transcript is
//    trimmed and the turn retried, and the output budget is clamped well below the
//    window — the loop asks for 8192 tokens, which is twice the whole context.
// 3. Inference runs in a worker (webllm-worker.ts). On the main thread the GPU
//    submit loop competes with deck.gl's render loop and the map stutters for the
//    length of the answer.
// 4. The package is only ever reached through `await import()`. It is the largest
//    dependency in the app, and users who never pick a local model pay nothing.

import { debugAiChat } from '../../../utils/debug'
import type {
  AgentEvent,
  AgentMessage,
  AgentProvider,
  AgentRequest,
  AgentTool,
  AgentUsage,
  DownloadProgress,
  StopReason,
} from '../types'
import {
  parseAction,
  preamble,
  responseSchema,
  serializeMessage,
  trimTranscript,
} from './json-tools'

export interface WebLLMModel {
  id: string
  label: string
  // Download size, which is also roughly the VRAM the model will hold
  sizeMb: number
}

// Verified against prebuiltAppConfig.model_list — an id that is not in that list
// throws at load time, and the whole point of this provider is that the first run
// works. Sizes are the config's own vram_required_MB.
//
// All five are instruction-tuned and small enough to answer in seconds on an
// integrated GPU. The Qwen3 models are reasoning models, but constrained decoding
// leaves no room for a thinking block, so they behave as ordinary chat models here.
export const WEBLLM_MODELS: readonly WebLLMModel[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B (0.9 GB)',
    sizeMb: 879,
  },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B (2.0 GB)', sizeMb: 2037 },
  {
    id: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC',
    label: 'Hermes 3 Llama 3.2 3B (2.2 GB)',
    sizeMb: 2264,
  },
  { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3 4B (3.4 GB)', sizeMb: 3432 },
  { id: 'Qwen3-8B-q4f16_1-MLC', label: 'Qwen3 8B (5.6 GB)', sizeMb: 5696 },
]

// The largest model that still fits the "low resource" tier in WebLLM's own
// config, so it is the biggest one likely to load on a laptop's integrated GPU.
export const DEFAULT_WEBLLM_MODEL = 'Qwen3-4B-q4f16_1-MLC'

// Every prebuilt model overrides context_window_size to this. Not read from the
// config at runtime because the value is needed to size the tool router before the
// engine exists.
const CONTEXT_WINDOW = 4096

// What is left for the answer after the system prompt, the tool schemas and the
// transcript. A JSON action object is a few hundred tokens; asking for more than
// this only invites the model to fill the window with prose it cannot finish.
const MAX_OUTPUT_TOKENS = 768

// Constrained JSON leaves little room for creativity, and what room is left is
// better spent on the right tool than on an interesting one
const TEMPERATURE = 0.2

// WebGPU is the hard requirement: no adapter, no local inference. Safari and
// Firefox ship `navigator.gpu` in some builds and still fail to hand out an
// adapter, so this asks for one rather than checking for the API.
export async function webgpuAvailable(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

// The slice of WebLLM's engine this provider uses. Declared locally so that
// nothing outside createWebLLMProvider references the package — which is what
// keeps it out of the main bundle — and so a test can pass in a fake.
export interface WebLLMEngine {
  chat: {
    completions: {
      create(request: WebLLMRequest): Promise<AsyncIterable<WebLLMChunk>>
    }
  }
  interruptGenerate(): void
  unload(): Promise<void>
}

interface WebLLMRequest {
  stream: true
  stream_options: { include_usage: boolean }
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  max_tokens: number
  temperature: number
  response_format?: { type: 'json_object'; schema?: string }
  extra_body?: { enable_thinking?: boolean }
}

interface WebLLMChunk {
  choices?: Array<{
    delta?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

// Loads the package, spins up the worker, and downloads the weights. Async for
// the same reason createChromeProvider is: the model has to be resident before the
// first request, and the download is where progress comes from.
export async function createWebLLMProvider(options: {
  model?: string
  onDownloadProgress?: (progress: DownloadProgress) => void
}): Promise<WebLLMProvider> {
  if (!(await webgpuAvailable())) {
    throw new Error(
      'Local models need WebGPU, which this browser does not offer. Try Chrome or Edge, or pick another provider in Settings → AI Provider.'
    )
  }

  const model = options.model ?? DEFAULT_WEBLLM_MODEL
  const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')

  const worker = new Worker(new URL('./webllm-worker.ts', import.meta.url), {
    type: 'module',
  })
  debugAiChat('[webllm] loading %s', model)

  try {
    const engine = await CreateWebWorkerMLCEngine(worker, model, {
      initProgressCallback: report => {
        // `progress` is a 0..1 fraction over the whole load, which is the only
        // measure WebLLM reports: the byte counts are per-shard
        debugAiChat('[webllm] %s', report.text)
        options.onDownloadProgress?.({ loaded: report.progress, total: 1 })
      },
    })

    debugAiChat('[webllm] ready, %d token window', CONTEXT_WINDOW)
    return new WebLLMProvider({
      engine: engine as unknown as WebLLMEngine,
      model,
      worker,
    })
  } catch (error) {
    // A failed load leaves a worker holding a partially initialised engine
    worker.terminate()
    throw error
  }
}

export class WebLLMProvider implements AgentProvider {
  readonly id = 'webllm' as const
  readonly model: string
  readonly supportsNativeTools = false
  readonly supportsImages = false
  readonly contextWindow = CONTEXT_WINDOW

  private readonly engine: WebLLMEngine
  private readonly worker: Worker | undefined
  private callCounter = 0

  constructor(options: {
    engine: WebLLMEngine
    model: string
    worker?: Worker
  }) {
    this.engine = options.engine
    this.model = options.model
    this.worker = options.worker
  }

  // A model left loaded holds gigabytes of VRAM that the browser will not reclaim
  // while the tab is open, so switching providers has to give it back.
  dispose() {
    this.engine.unload().catch(() => {
      // Nothing useful to do about a failed unload; the worker goes either way
    })
    this.worker?.terminate()
  }

  async *stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (signal?.aborted) {
      yield { type: 'stop', reason: 'aborted' }
      return
    }

    const completion = await this.complete(request, request.messages, signal)

    if (signal?.aborted) {
      yield { type: 'stop', reason: 'aborted' }
      return
    }

    if (completion.usage) yield { type: 'usage', usage: completion.usage }
    yield* this.eventsFor(completion, request.tools)
  }

  private async complete(
    request: AgentRequest,
    messages: AgentMessage[],
    signal?: AbortSignal
  ): Promise<Completion> {
    try {
      return await this.generate(request, messages, signal)
    } catch (error) {
      // measuring the prompt against a 4k window before sending would mean
      // tokenizing it here, so the engine's own count is what we go on
      if (!isContextOverflow(error) || messages.length <= 1) throw error

      const trimmed = trimTranscript(messages)
      debugAiChat(
        '[webllm] over context, retrying with %d of %d messages',
        trimmed.length,
        messages.length
      )
      return this.generate(request, trimmed, signal)
    }
  }

  private async generate(
    request: AgentRequest,
    messages: AgentMessage[],
    signal?: AbortSignal
  ): Promise<Completion> {
    const body: WebLLMRequest = {
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        // The tool schemas ride in the system message, as they do for every
        // provider without native tools
        { role: 'system', content: preamble(request) },
        ...toWireTurns(messages),
      ],
      max_tokens: Math.min(request.maxTokens, MAX_OUTPUT_TOKENS),
      temperature: TEMPERATURE,
      // A reasoning model would spend the whole window thinking, and the schema
      // leaves nowhere to put a thinking block anyway
      extra_body: { enable_thinking: false },
    }

    // With no tools there is nothing to select, so the turn is plain prose and the
    // grammar would only get in the way
    if (request.tools.length > 0) {
      body.response_format = {
        type: 'json_object',
        schema: JSON.stringify(responseSchema(request.tools)),
      }
    }

    // Stopping generation is the engine's own call, not the stream's: abandoning
    // the iterator would leave the GPU decoding tokens nobody reads. Registered
    // before the request rather than after, so an abort that lands while the
    // engine is still setting up is not silently dropped.
    const interrupt = () => this.engine.interruptGenerate()
    signal?.addEventListener('abort', interrupt, { once: true })

    let content = ''
    let usage: AgentUsage | null = null
    let finishReason = ''

    try {
      const stream = await this.engine.chat.completions.create(body)
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]
        if (choice?.delta?.content) content += choice.delta.content
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          }
        }
      }
    } finally {
      signal?.removeEventListener('abort', interrupt)
    }

    return { content, usage, finishReason }
  }

  private *eventsFor(completion: Completion, tools: AgentTool[]): Generator<AgentEvent> {
    const action = parseAction(completion.content, tools)

    // Nothing incremental: the completion is one JSON object, and streaming a
    // half-written one to the panel would show the user braces
    if (action.reply) yield { type: 'text_delta', text: action.reply }

    if (action.tool) {
      this.callCounter++
      yield {
        type: 'tool_call',
        id: `webllm_${this.callCounter}`,
        name: action.tool,
        input: action.input,
      }
    }

    yield {
      type: 'stop',
      reason: stopReasonFor(action.tool, completion.finishReason),
    }
  }
}

interface Completion {
  content: string
  usage: AgentUsage | null
  finishReason: string
}

// The loop's tool results ride on user turns, which is where they belong here too
function toWireTurns(messages: AgentMessage[]): {
  role: 'user' | 'assistant'
  content: string
}[] {
  return messages
    .map(message => ({
      role: message.role,
      content: serializeMessage(message),
    }))
    .filter(turn => turn.content.length > 0)
}

// A truncated action object will not parse, so `length` matters even though the
// reply is short: it tells the loop the answer is incomplete rather than final.
function stopReasonFor(tool: string | null, finishReason: string): StopReason {
  if (tool) return 'tool_use'
  if (finishReason === 'length') return 'max_tokens'
  if (finishReason === 'abort') return 'aborted'
  return 'end_turn'
}

// Thrown as ContextWindowSizeExceededError inside the worker, but errors cross a
// postMessage boundary as their `toString()`, so by the time it arrives the class
// is gone and only the prefix in the message is left.
function isContextOverflow(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'ContextWindowSizeExceededError') return true
  return error.message.includes('ContextWindowSizeExceededError')
}
