// Chrome's built-in model (Gemini Nano) via the Prompt API.
//
// Two things make this provider unlike the other two:
//
// 1. No tool calling. The API offers `responseConstraint` (a JSON Schema) and
//    nothing else, so the loop's tool round-trip is emulated: every turn asks for
//    one JSON object naming at most one tool, and this provider translates that
//    into the same tool_call event a native provider would emit. The loop never
//    learns the difference.
// 2. A context window measured in single-digit thousands of tokens, discovered at
//    runtime rather than known from the model id. Overflowing it throws
//    QuotaExceededError instead of silently truncating, which is better — but it
//    means the transcript has to be trimmed and retried rather than hoped over.
//
// The API is an origin trial and has been renamed twice (maxTokens/tokensSoFar →
// inputQuota/inputUsage, contextoverflow → quotaoverflow), so the reads below
// accept either spelling rather than pinning to one.

import { debugAiChat } from '../../../utils/debug'
import type {
  AgentEvent,
  AgentMessage,
  AgentProvider,
  AgentRequest,
  AgentTool,
  StopReason,
} from '../types'

// Nano's window as shipped. Only a fallback: a real session reports its own.
const FALLBACK_CONTEXT_WINDOW = 6144

// There is exactly one built-in model, but the picker takes a list from every
// provider, so give it one rather than special-casing the UI.
export const CHROME_MODELS = [{ id: 'gemini-nano', label: 'Gemini Nano (on-device)' }] as const

// Sentinel for "no tool this turn". An enum of strings is the most widely
// supported constraint shape there is; a nullable object property is not.
const NO_TOOL = 'none'

export type ChromeAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

interface PromptOptions {
  signal?: AbortSignal
  responseConstraint?: object
  omitResponseConstraintInput?: boolean
}

// The slice of the Prompt API this provider uses. Declared locally because the
// API is not in lib.dom yet.
interface LanguageModelSession {
  prompt(input: string, options?: PromptOptions): Promise<string>
  destroy(): void
  addEventListener?: (type: string, listener: () => void) => void
  inputQuota?: number
  inputUsage?: number
  contextWindow?: number
  maxTokens?: number
  tokensSoFar?: number
}

interface LanguageModelFactory {
  availability(): Promise<ChromeAvailability>
  create(options?: {
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    signal?: AbortSignal
    monitor?: (monitor: {
      addEventListener: (type: string, listener: (e: Event) => void) => void
    }) => void
  }): Promise<LanguageModelSession>
}

function factory(): LanguageModelFactory | undefined {
  return (globalThis as { LanguageModel?: LanguageModelFactory }).LanguageModel
}

export async function chromeAvailability(): Promise<ChromeAvailability> {
  const api = factory()
  if (!api) return 'unavailable'
  try {
    return await api.availability()
  } catch {
    return 'unavailable'
  }
}

// Creates a probe session purely to read the real window size, then throws it
// away: this provider keeps no session between turns, so the transcript the loop
// holds stays the only state.
export async function createChromeProvider(): Promise<ChromeProvider> {
  const api = factory()
  if (!api) throw new Error('Chrome’s built-in model is not available in this browser')

  const availability = await api.availability()
  if (availability === 'unavailable') {
    throw new Error('Chrome’s built-in model is unavailable on this device')
  }

  const probe = await api.create({
    monitor: monitor => {
      monitor.addEventListener('downloadprogress', event => {
        debugAiChat('[chrome] model download %o', (event as ProgressEvent).loaded)
      })
    },
  })

  const contextWindow = readQuota(probe)
  probe.destroy()

  debugAiChat('[chrome] ready, %d token window', contextWindow)
  return new ChromeProvider({ contextWindow })
}

function readQuota(session: LanguageModelSession): number {
  return session.inputQuota ?? session.contextWindow ?? session.maxTokens ?? FALLBACK_CONTEXT_WINDOW
}

export class ChromeProvider implements AgentProvider {
  readonly id = 'chrome' as const
  readonly model = 'gemini-nano'
  readonly supportsNativeTools = false
  readonly supportsImages = false
  readonly contextWindow: number

  private callCounter = 0

  constructor(options: { contextWindow?: number } = {}) {
    this.contextWindow = options.contextWindow ?? FALLBACK_CONTEXT_WINDOW
  }

  async *stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const api = factory()
    if (!api) throw new Error('Chrome’s built-in model is not available in this browser')

    let session: LanguageModelSession | null = null
    try {
      session = await api.create({
        initialPrompts: [{ role: 'system', content: systemPrompt(request) }],
        signal,
      })

      // Fires when the API evicts the oldest turns to make room. Worth knowing
      // about: it means the model has silently lost the start of the transcript.
      session.addEventListener?.('contextoverflow', () =>
        debugAiChat('[chrome] context overflowed, oldest turns evicted')
      )
      session.addEventListener?.('quotaoverflow', () =>
        debugAiChat('[chrome] quota overflowed, oldest turns evicted')
      )

      const raw = await promptWithRetry(session, request, signal)
      yield* this.eventsFor(raw, request.tools)
    } catch (error) {
      if (isAbort(error)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      throw error
    } finally {
      session?.destroy()
    }
  }

  private *eventsFor(raw: string, tools: AgentTool[]): Generator<AgentEvent> {
    const action = parseAction(raw, tools)

    // No incremental text: the response is one JSON object, and streaming a
    // half-written object to the chat panel would show the user braces. Nano's
    // replies are short enough that the wait is a second, not a minute.
    if (action.reply) yield { type: 'text_delta', text: action.reply }

    if (action.tool) {
      this.callCounter++
      yield {
        type: 'tool_call',
        id: `nano_${this.callCounter}`,
        name: action.tool,
        input: action.input,
      }
    }

    const reason: StopReason = action.tool ? 'tool_use' : 'end_turn'
    yield { type: 'stop', reason }
  }
}

// One attempt, then one more against a trimmed transcript. QuotaExceededError
// means the prompt could not be made to fit even after the API evicted what it
// could, so sending the same thing again would fail the same way.
async function promptWithRetry(
  session: LanguageModelSession,
  request: AgentRequest,
  signal?: AbortSignal
): Promise<string> {
  const options: PromptOptions = {
    signal,
    responseConstraint: responseSchema(request.tools),
    // The schema is sizeable next to a 6k window, and it is already described in
    // words by systemPrompt(), so it does not need to be spent twice
    omitResponseConstraintInput: true,
  }

  try {
    return await session.prompt(transcript(request.messages), options)
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error

    const trimmed = trimTranscript(request.messages)
    debugAiChat(
      '[chrome] over quota, retrying with %d of %d messages',
      trimmed.length,
      request.messages.length
    )
    return session.prompt(transcript(trimmed), options)
  }
}

// Keeps the first user turn (the task) and the most recent exchanges, dropping
// the middle — the same shape as compaction, minus the summary, because
// summarising costs another round-trip through the model that just ran out of room.
function trimTranscript(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 3) return messages.slice(-1)
  return [messages[0], ...messages.slice(-2)]
}

// The constraint: one flat object. Nesting the tool input under the action would
// be tidier, but a flat enum plus a free-form object is the shape small models
// fill in correctly.
function responseSchema(tools: AgentTool[]): object {
  return {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: [NO_TOOL, ...tools.map(tool => tool.name)] },
      input: { type: 'object' },
      reply: { type: 'string' },
    },
    required: ['tool', 'reply'],
  }
}

interface ParsedAction {
  tool: string | null
  input: Record<string, unknown>
  reply: string
}

// Exported for tests: everything about this provider that can go wrong at runtime
// goes wrong here.
export function parseAction(raw: string, tools: AgentTool[]): ParsedAction {
  const parsed = parseJson(raw)
  if (!parsed) {
    // Constraint ignored, which happens. The text is still an answer.
    return { tool: null, input: {}, reply: raw.trim() }
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply : ''
  const name = typeof parsed.tool === 'string' ? parsed.tool : NO_TOOL

  // A name the model invented would come back from the loop as "Unknown tool",
  // costing a whole round-trip of a window this small to learn nothing
  const known = tools.some(tool => tool.name === name)
  if (name === NO_TOOL || !known) return { tool: null, input: {}, reply }

  return { tool: name, input: asRecord(parsed.input), reply }
}

function parseJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim()
  // Some builds wrap constrained output in a fence anyway
  const unfenced = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(unfenced)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// Everything the model needs that a native provider would get as structured
// fields: the tool schemas, and how to answer.
function systemPrompt(request: AgentRequest): string {
  const tools = request.tools
    .map(
      tool =>
        `- ${tool.name}: ${tool.description}\n  input: ${JSON.stringify(tool.inputSchema.properties)}`
    )
    .join('\n')

  return `${request.system}

You answer with a single JSON object and nothing else:
{"tool": "<tool name or ${NO_TOOL}>", "input": {<arguments>}, "reply": "<what to say>"}

Call one tool at a time. Set "tool" to "${NO_TOOL}" once you have what you need, and put the answer in "reply". When you do call a tool, "reply" should say briefly what you are checking.

Tools:
${tools}`
}

// The transcript as text. Tool results arrive as JSON strings already capped by
// result-budget, so this only has to label them.
function transcript(messages: AgentMessage[]): string {
  const lines: string[] = []

  for (const message of messages) {
    for (const part of message.content) {
      switch (part.type) {
        case 'text':
          lines.push(`${message.role === 'user' ? 'User' : 'Assistant'}: ${part.text}`)
          break
        case 'tool_use':
          lines.push(`Assistant called ${part.name} with ${JSON.stringify(part.input)}`)
          break
        case 'tool_result':
          lines.push(`Result${part.isError ? ' (error)' : ''}: ${part.content}`)
          break
        // Images cannot be sent, and a provider_block from another provider is
        // meaningless here
        default:
          break
      }
    }
  }

  return lines.join('\n')
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof Error && error.name === 'QuotaExceededError'
}
