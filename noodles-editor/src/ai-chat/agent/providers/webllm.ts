// WebLLM: the model runs in this tab, on this GPU. No account, no key, no
// request ever leaving the machine — paid for once, up front, as a download of
// one to six gigabytes that the user has to ask for explicitly.
//
// Five things shape this provider:
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
// 5. Prefill is most of the wait. The engine skips it for everything it has seen
//    before only when the next request extends the last one exactly, so the
//    system message and every earlier turn are kept byte-stable (preambleFor,
//    toWireTurns), and so is a transcript once it has been trimmed (transcriptFor).

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
  diagnosticFor,
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
// All six are instruction-tuned and small enough to run on an integrated GPU. The
// Qwen models are reasoning models, but constrained decoding leaves no room for a
// thinking block, so they behave as ordinary chat models here.
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
  { id: 'Qwen3.5-4B-q4f16_1-MLC', label: 'Qwen3.5 4B (3.9 GB)', sizeMb: 3868 },
  { id: 'Qwen3-8B-q4f16_1-MLC', label: 'Qwen3 8B (5.6 GB)', sizeMb: 5696 },
]

// The only one that reliably makes an edit: 89% on the single-edit bench tasks,
// against 11% for Qwen3-4B (bench/agent/results/2026-10-01-03-17-adam-mac).
// About twice as slow as Qwen3-4B and outside WebLLM's "low resource" tier, so
// Qwen3-4B stays in the list for laptops that cannot hold it.
export const DEFAULT_WEBLLM_MODEL = 'Qwen3.5-4B-q4f16_1-MLC'

// Every prebuilt model overrides context_window_size to this. Not read from the
// config at runtime because the value is needed to size the tool router before the
// engine exists. The override is there to keep VRAM low, not because the models
// stop at 4k — a caller can ask for more, and pays in KV cache for it.
export const DEFAULT_CONTEXT_WINDOW = 4096

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
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    // WebLLM's own timings, worth logging because prefill and decode fail
    // differently: a slow prefill means the cache missed, a slow decode is the GPU
    extra?: {
      time_to_first_token_s?: number
      prefill_tokens_per_s?: number
      decode_tokens_per_s?: number
      grammar_init_s?: number
    }
  } | null
}

// Loads the package, spins up the worker, and downloads the weights. Async for
// the same reason createChromeProvider is: the model has to be resident before the
// first request, and the download is where progress comes from.
export async function createWebLLMProvider(options: {
  model?: string
  onDownloadProgress?: (progress: DownloadProgress) => void
  contextWindow?: number
}): Promise<WebLLMProvider> {
  if (!(await webgpuAvailable())) {
    throw new Error(
      'Local models need WebGPU, which this browser does not offer. Try Chrome or Edge, or pick another provider in Settings → AI Provider.'
    )
  }

  const model = options.model ?? DEFAULT_WEBLLM_MODEL
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')

  const worker = new Worker(new URL('./webllm-worker.ts', import.meta.url), {
    type: 'module',
  })
  debugAiChat('[webllm] loading %s', model)

  try {
    const engine = await CreateWebWorkerMLCEngine(
      worker,
      model,
      {
        initProgressCallback: report => {
          // `progress` is a 0..1 fraction over the whole load, which is the only
          // measure WebLLM reports: the byte counts are per-shard
          debugAiChat('[webllm] %s', report.text)
          options.onDownloadProgress?.({ loaded: report.progress, total: 1 })
        },
      },
      // Only sent when it differs, so the default load is byte-for-byte the
      // prebuilt config
      contextWindow === DEFAULT_CONTEXT_WINDOW ? undefined : { context_window_size: contextWindow }
    )

    debugAiChat('[webllm] ready, %d token window', contextWindow)
    return new WebLLMProvider({
      engine: engine as unknown as WebLLMEngine,
      model,
      worker,
      contextWindow,
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
  readonly contextWindow: number

  private readonly engine: WebLLMEngine
  private readonly worker: Worker | undefined
  private callCounter = 0
  // The system message each system prompt was first sent with, and the tools it
  // listed. See preambleFor.
  private readonly preambles = new Map<string, { tools: string[]; text: string }>()
  // After an overflow: the shorter transcript sent in place of the loop's, and the
  // loop's messages it replaced, as wire text. See transcriptFor.
  private trim: { replaced: string[]; kept: AgentMessage[] } | null = null

  constructor(options: {
    engine: WebLLMEngine
    model: string
    worker?: Worker
    contextWindow?: number
  }) {
    this.contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW
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

    const completion = await this.complete(request, signal)

    if (signal?.aborted) {
      yield { type: 'stop', reason: 'aborted' }
      return
    }

    if (completion.usage) yield { type: 'usage', usage: completion.usage }
    if (completion.trimmed) yield { type: 'diagnostic', kind: 'context_trimmed' }
    yield* this.eventsFor(completion, request.tools)
  }

  private async complete(request: AgentRequest, signal?: AbortSignal): Promise<Completion> {
    const messages = this.transcriptFor(request.messages)
    try {
      return await this.generate(request, messages, signal)
    } catch (error) {
      // measuring the prompt against a 4k window before sending would mean
      // tokenizing it here, so the engine's own count is what we go on
      if (!isContextOverflow(error)) throw error

      // Nothing to drop means the retry would overflow the same way
      const trimmed = trimTranscript(messages)
      if (trimmed.length === messages.length) throw error
      debugAiChat(
        '[webllm] over context, retrying with %d of %d messages',
        trimmed.length,
        messages.length
      )
      const completion = await this.generate(request, trimmed, signal)
      this.trim = { replaced: request.messages.map(wireText), kept: trimmed }
      return { ...completion, trimmed: true }
    }
  }

  // The loop keeps every message, so after one overflow each later step would
  // overflow again and be trimmed again, to a transcript that differs from the
  // last one in its final exchange. The engine would then prefill the whole prompt
  // from an empty cache: about 3k tokens, 11 to 12 seconds on a laptop GPU, every
  // step. Sending the trimmed transcript plus what came after it extends the
  // conversation the engine holds instead, so only the new messages are prefilled.
  private transcriptFor(messages: AgentMessage[]): AgentMessage[] {
    const trim = this.trim
    const extendsTrim =
      trim !== null &&
      messages.length >= trim.replaced.length &&
      trim.replaced.every((text, index) => wireText(messages[index]) === text)
    if (!extendsTrim) {
      // A new conversation, or one the loop rewrote
      this.trim = null
      return messages
    }
    return [...trim.kept, ...messages.slice(trim.replaced.length)]
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
        { role: 'system', content: this.preambleFor(request, messages) },
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
          logTimings(chunk.usage)
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

  // WebLLM keeps its KV cache only when a request is the previous conversation
  // plus one message, byte for byte, system message included. Rebuilt per step,
  // the preamble would grow with every tool find_tools unlocks and the engine
  // would prefill the whole prompt again: about 4k tokens, 15 to 20 seconds on a
  // laptop GPU, every step. So the first preamble for a system prompt is kept
  // while every tool it lists is still offered. Tools unlocked later still reach
  // the model, through find_tools' own result and the grammar's enum.
  private preambleFor(request: AgentRequest, messages: AgentMessage[]): string {
    const offered = new Set(request.tools.map(tool => tool.name))
    const pinned = this.preambles.get(request.system)
    const stillValid =
      pinned &&
      // A preamble written for no tools has nothing to say about them
      (pinned.tools.length > 0 || offered.size === 0) &&
      pinned.tools.every(name => offered.has(name)) &&
      // A tool unlocked since is described only by the find_tools result that
      // unlocked it. Once trimming or a new turn drops that result, the model
      // would have its name and nothing else, so the preamble is rebuilt.
      [...offered]
        .filter(name => !pinned.tools.includes(name))
        .every(name => describedInTranscript(name, messages))
    if (stillValid) return pinned.text

    const text = preamble(request)
    this.preambles.set(request.system, { tools: [...offered], text })
    return text
  }

  private *eventsFor(completion: Completion, tools: AgentTool[]): Generator<AgentEvent> {
    const action = parseAction(completion.content, tools)
    const diagnostic = diagnosticFor(action)
    if (diagnostic) yield diagnostic

    // Nothing incremental: the completion is one JSON object, and streaming a
    // half-written one to the panel would show the user braces
    // The completion exactly as the engine recorded it, for toWireTurns to send
    // back. Re-serialised from the tool call it would differ, and the engine
    // would drop its cache.
    yield { type: 'provider_block', provider: 'webllm', block: completion.content }
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
  // The first attempt overflowed and this came from the trimmed transcript
  trimmed?: boolean
}

// The loop's tool results ride on user turns, which is where they belong here too.
// An assistant turn this provider produced goes back as the raw completion.
function toWireTurns(messages: AgentMessage[]): {
  role: 'user' | 'assistant'
  content: string
}[] {
  return messages
    .map(message => ({
      role: message.role,
      content: rawCompletion(message) ?? serializeMessage(message),
    }))
    .filter(turn => turn.content.length > 0)
}

// One message as the engine sees it, role included, for telling whether the loop's
// transcript still starts with the messages a trim replaced
function wireText(message: AgentMessage): string {
  return `${message.role}:${rawCompletion(message) ?? serializeMessage(message)}`
}

function describedInTranscript(toolName: string, messages: AgentMessage[]): boolean {
  return messages.some(message =>
    message.content.some(part => part.type === 'tool_result' && part.content.includes(toolName))
  )
}

function rawCompletion(message: AgentMessage): string | undefined {
  if (message.role !== 'assistant') return undefined
  for (const part of message.content) {
    if (part.type === 'provider_block' && part.provider === 'webllm') {
      return typeof part.block === 'string' ? part.block : undefined
    }
  }
  return undefined
}

function logTimings(usage: NonNullable<WebLLMChunk['usage']>) {
  const extra = usage.extra
  if (!extra) return
  // Interpolated here rather than by debug's own %d, so the line reads the same
  // wherever the console is captured (the bench parses it)
  debugAiChat(
    `[webllm] prefill ${usage.prompt_tokens ?? 0} tokens in ${extra.time_to_first_token_s?.toFixed(1)}s (${Math.round(extra.prefill_tokens_per_s ?? 0)} tok/s), decode ${usage.completion_tokens ?? 0} tokens at ${Math.round(extra.decode_tokens_per_s ?? 0)} tok/s, grammar ${extra.grammar_init_s?.toFixed(2)}s`
  )
}

// A truncated action object will not parse, so `length` matters even though the
// reply is short: it tells the loop the answer is incomplete rather than final.
function stopReasonFor(tool: string | null, finishReason: string): StopReason {
  if (tool) return 'tool_use'
  if (finishReason === 'length') return 'max_tokens'
  if (finishReason === 'abort') return 'aborted'
  return 'end_turn'
}

// Thrown as ContextWindowSizeExceededError inside the worker, but the worker posts
// errors back as their `toString()` and the engine rejects with that string, so
// what arrives is not an Error at all: only the class name at the start of the text
// is left. The token count in it is misleading too. It is the new tokens alone,
// while the engine checks them plus the KV cache kept from earlier steps.
function isContextOverflow(error: unknown): boolean {
  if (typeof error === 'string') return error.includes('ContextWindowSizeExceededError')
  if (!(error instanceof Error)) return false
  if (error.name === 'ContextWindowSizeExceededError') return true
  return error.message.includes('ContextWindowSizeExceededError')
}
