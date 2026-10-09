// Chrome"s built-in model (Gemini Nano) via the Prompt API.
//
// Three things make this provider unlike the other two:
//
// 1. No tool calling. The API offers `responseConstraint` (a JSON Schema) and
//    nothing else, so the loop's tool round-trip is emulated: every turn asks for
//    one JSON object naming at most one tool, and this provider translates that
//    into the same tool_call event a native provider would emit. The loop never
//    learns the difference. That emulation lives in json-tools.ts, shared with
//    the WebLLM provider, which has the same gap.
// 2. A context window measured in single-digit thousands of tokens, discovered at
//    runtime rather than known from the model id. Overflowing it throws
//    QuotaExceededError instead of silently truncating, so the transcript is
//    measured against the remaining room before each turn and trimmed if it
//    will not fit.
// 3. The session is the transcript. Unlike an HTTP provider, which is handed the
//    whole history on every request, a Prompt API session accumulates it. So this
//    provider keeps one session across turns and sends only the messages the
//    session has not seen — which also means the system prompt and the tool
//    schemas, which live in `initialPrompts` and are never evicted, are paid for
//    once per conversation rather than once per turn.
//
// The API has renamed things twice (maxTokens/tokensSoFar → inputQuota/inputUsage
// → contextWindow/contextUsage; contextoverflow → quotaoverflow), so the reads
// below accept every spelling rather than pinning to one.

import { debugAiChat } from '../../../utils/debug'
import { withTimeout } from '../../../utils/timeout'
import type {
  AgentEvent,
  AgentMessage,
  AgentProvider,
  AgentRequest,
  AgentTool,
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

// Re-exported because this is where the emulation used to live, and because the
// alternative is every caller learning which of the two JSON-constrained
// providers happens to own it.
export { parseAction }

// Nano's window as shipped. Only a fallback: a real session reports its own.
const FALLBACK_CONTEXT_WINDOW = 6144

// Reserve space for the model's output. Chrome throws kErrorUnknown if the output
// pushes the session over the context limit during generation, even when the input
// fit. Reserve ~15-20% of the window for the response.
const OUTPUT_HEADROOM_TOKENS = 1000

// There is exactly one built-in model, but the picker takes a list from every
// provider, so give it one rather than special-casing the UI.
export const CHROME_MODELS = [{ id: 'gemini-nano', label: 'Gemini Nano (on-device)' }] as const

// Sent when a turn has nothing new in it, which the API would reject as an empty
// prompt
const NUDGE = 'Continue.'

export type ChromeAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

type PromptRole = 'system' | 'user' | 'assistant'

interface PromptMessage {
  role: PromptRole
  content: string
}

interface PromptOptions {
  signal?: AbortSignal
  responseConstraint?: object
  omitResponseConstraintInput?: boolean
}

// The slice of the Prompt API this provider uses. Declared locally because the
// API is not in lib.dom yet.
interface LanguageModelSession {
  // Passing messages rather than a string adds them to the session's own history,
  // which is what makes sending only the new ones correct
  prompt(input: string | PromptMessage[], options?: PromptOptions): Promise<string>
  measureContextUsage?(
    input: string | PromptMessage[],
    options?: Pick<PromptOptions, 'responseConstraint' | 'omitResponseConstraintInput'>
  ): Promise<number>
  destroy(): void
  addEventListener?: (type: string, listener: () => void) => void
  // Current spelling
  contextWindow?: number
  contextUsage?: number
  // Deprecated aliases, still what shipped Chrome reports
  inputQuota?: number
  inputUsage?: number
  maxTokens?: number
  tokensSoFar?: number
}

interface CreateOptions {
  initialPrompts?: PromptMessage[]
  signal?: AbortSignal
  monitor?: (monitor: {
    addEventListener: (type: string, listener: (e: Event) => void) => void
  }) => void
  // Only used to probe for native tool support; see nativeToolSupport()
  tools?: unknown
}

interface LanguageModelFactory {
  availability(): Promise<ChromeAvailability>
  create(options?: CreateOptions): Promise<LanguageModelSession>
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

// Whether this browser implements the explainer's `tools` option on create() —
// grammar-constrained tool calls instead of the JSON emulation below.
//
// Detected by handing `tools` a value no sequence can accept. WebIDL converts
// arguments in the binding layer, before the method body runs, so a browser that
// declares the member rejects this with a TypeError while one that does not
// ignores it like any unknown member and fails (or succeeds) for its own reasons.
// The control call is what makes that a real signal rather than an assumption
// about how one engine words its errors.
//
// Passing a well-formed tool instead would give a false positive: Chrome 152
// already accepts `expectedOutputs: [{type: 'tool-call'}]` — `tool-call` is in the
// shipped LanguageModelMessageType enum — and silently drops `tools`, so a probe
// that only watched for a rejection would report support that is not there.
//
// Reported but not yet used. Wiring it up is not a swap: the API's tools take an
// `execute` callback the browser invokes itself, awaiting all of them before the
// model replies, whereas AgentProvider.stream() yields tool calls out and lets
// the loop schedule them (loop.ts:307, which serializes anything mutating). Using
// it means the provider holding a prompt() promise open across stream() calls and
// resolving it from the next request's tool_result — worth doing once the option
// ships and can be tested against a real implementation.
export async function nativeToolSupport(): Promise<boolean> {
  const api = factory()
  if (!api) return false

  const rejects = async (options: CreateOptions): Promise<unknown> => {
    let session: LanguageModelSession | null = null
    try {
      session = await api.create(options)
      return null
    } catch (error) {
      return error
    } finally {
      session?.destroy()
    }
  }

  const probe = await rejects({ tools: NOT_A_SEQUENCE })
  if (!(probe instanceof TypeError)) return false

  // An engine that throws TypeError for every create() call tells us nothing
  const control = await rejects({})
  return !(control instanceof TypeError)
}

// Not a sequence, not a dictionary, not anything `tools` could hold
const NOT_A_SEQUENCE = 42

// The first create() on a machine that has never run the model downloads ~2GB,
// so it gets minutes; an ordinary create() that has not answered in a minute is
// wedged rather than slow.
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const CREATE_TIMEOUT_MS = 60 * 1000

// Creates a probe session purely to read the real window size, then throws it
// away: the streaming session carries the system prompt and tool schemas, which
// are not known until the first request. Since this is also the call that
// triggers the model download, it is where progress is reported from.
export async function createChromeProvider(
  options: { onDownloadProgress?: (progress: DownloadProgress) => void } = {}
): Promise<ChromeProvider> {
  const api = factory()
  if (!api) throw new Error("Chrome's built-in model is not available in this browser")

  const availability = await api.availability()
  if (availability === 'unavailable') {
    throw new Error("Chrome's built-in model is unavailable on this device")
  }

  const downloading = availability === 'downloadable' || availability === 'downloading'
  const create = api.create({
    monitor: monitor => {
      monitor.addEventListener('downloadprogress', event => {
        // `loaded` is a 0..1 fraction in current Chrome and a byte count in
        // earlier builds; either way total is what it is measured against
        const { loaded, total = 1 } = event as ProgressEvent
        debugAiChat('[chrome] model download %d/%d', loaded, total)
        options.onDownloadProgress?.({ loaded, total })
      })
    },
  })

  const probe = await withTimeout(
    create,
    downloading ? DOWNLOAD_TIMEOUT_MS : CREATE_TIMEOUT_MS,
    downloading
      ? 'Chrome\'s model download timed out after 10 minutes. Check chrome://components for "Optimization Guide On Device Model", or pick another provider in Settings → AI Provider.'
      : "Chrome's built-in model did not start within 60 seconds. Restart Chrome, or pick another provider in Settings → AI Provider."
  )

  const contextWindow = readWindow(probe)
  probe.destroy()

  debugAiChat('[chrome] ready, %d token window', contextWindow)
  return new ChromeProvider({ contextWindow })
}

function readWindow(session: LanguageModelSession): number {
  return session.contextWindow ?? session.inputQuota ?? session.maxTokens ?? FALLBACK_CONTEXT_WINDOW
}

function readUsage(session: LanguageModelSession): number {
  return session.contextUsage ?? session.inputUsage ?? session.tokensSoFar ?? 0
}

export class ChromeProvider implements AgentProvider {
  readonly id = 'chrome' as const
  readonly model = 'gemini-nano'
  readonly supportsNativeTools = false
  readonly supportsImages = false
  readonly contextWindow: number

  private callCounter = 0
  private hasRetried = false

  // The live session, plus what it has already been told. `sent` is one entry per
  // AgentMessage in the order the session received them, so the next request's
  // messages can be diffed against it.
  private session: LanguageModelSession | null = null
  private sessionKey = ''
  private sent: string[] = []

  constructor(options: { contextWindow?: number } = {}) {
    this.contextWindow = options.contextWindow ?? FALLBACK_CONTEXT_WINDOW
  }

  // The chat panel switching providers, or the conversation being cleared, leaves
  // a session holding a transcript nobody will continue.
  dispose() {
    this.discard()
  }

  async *stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const api = factory()
    if (!api) throw new Error("Chrome's built-in model is not available in this browser")

    // Reset retry flag at the start of each stream so failed turns don't consume
    // the retry budget for subsequent independent requests
    this.hasRetried = false

    try {
      const raw = await this.promptTurn(api, request, signal)
      yield* this.eventsFor(raw, request.tools)
    } catch (error) {
      // The session's history is only worth keeping if the turn that would have
      // extended it succeeded
      this.discard()

      // Log full error details for debugging unknown Chrome API errors
      if (error instanceof Error) {
        debugAiChat('[chrome] prompt failed -', error.name, error.message, error)
      } else {
        debugAiChat('[chrome] prompt failed with non-Error', error)
      }

      if (isAbort(error)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      throw error
    }
  }

  private async promptTurn(
    api: LanguageModelFactory,
    request: AgentRequest,
    signal?: AbortSignal
  ): Promise<string> {
    const options: PromptOptions = {
      signal,
      responseConstraint: responseSchema(request.tools),
      // The schema is sizeable next to a 6k window, and it is already described in
      // words by preamble(), so it does not need to be spent twice
      omitResponseConstraintInput: true,
    }

    const lines = request.messages.map(serializeMessage)
    const session = await this.sessionFor(api, request, lines, signal)
    const offset = this.sent.length
    const input = toPromptMessages(lines.slice(offset), request.messages, offset)

    if (!(await this.fits(session, input, options))) {
      debugAiChat('[chrome] turn will not fit, rebuilding on a trimmed transcript')
      return this.retrimmed(api, request, options, signal)
    }

    try {
      return await this.send(session, input, options, lines)
    } catch (error) {
      if (isQuotaExceeded(error)) {
        // measureContextUsage is optional, and its estimate can be short of what the
        // session actually charges, so catch-and-retry stays as a backstop
        debugAiChat('[chrome] over quota, rebuilding on a trimmed transcript')
        return this.retrimmed(api, request, options, signal)
      }

      // Attempt one retry for unknown Chrome API errors by rebuilding the session
      if (isChromeApiError(error) && !this.hasRetried) {
        debugAiChat('[chrome] unknown API error, attempting session rebuild: %s', error)
        this.hasRetried = true
        return this.retrimmed(api, request, options, signal)
      }

      throw error
    }
  }

  // A fresh session holding only the task and the last exchange. Rebuilding rather
  // than re-prompting is what makes this work at all: the old session still holds
  // the messages that did not fit, and a session cannot forget.
  private async retrimmed(
    api: LanguageModelFactory,
    request: AgentRequest,
    options: PromptOptions,
    signal?: AbortSignal
  ): Promise<string> {
    const trimmed = trimTranscript(request.messages)
    debugAiChat('[chrome] kept %d of %d messages', trimmed.length, request.messages.length)

    const session = await this.rebuild(api, request, signal)
    const lines = trimmed.map(serializeMessage)
    return this.send(session, toPromptMessages(lines, trimmed, 0), options, lines)
  }

  private async send(
    session: LanguageModelSession,
    input: PromptMessage[],
    options: PromptOptions,
    sent: string[]
  ): Promise<string> {
    // An empty turn means the loop re-streamed a transcript the session already
    // holds. It still owes a reply, so ask for one rather than sending nothing.
    const raw = await session.prompt(input.length > 0 ? input : NUDGE, options)
    // Only now is the session known to hold these messages
    this.sent = sent
    return raw
  }

  // Reuses the live session when it is still the right one: same system prompt and
  // tool set, and a transcript this one extends rather than rewrites. Compaction
  // and the loop's own trimming both rewrite history, and a session cannot forget.
  private async sessionFor(
    api: LanguageModelFactory,
    request: AgentRequest,
    lines: string[],
    signal?: AbortSignal
  ): Promise<LanguageModelSession> {
    const key = sessionKey(request)
    const isExtension =
      lines.length >= this.sent.length && this.sent.every((line, index) => line === lines[index])

    if (this.session && this.sessionKey === key && isExtension) return this.session

    if (this.session) {
      debugAiChat(
        '[chrome] discarding session (%s)',
        this.sessionKey === key ? 'transcript rewritten' : 'prompt or tools changed'
      )
    }
    return this.rebuild(api, request, signal)
  }

  private async rebuild(
    api: LanguageModelFactory,
    request: AgentRequest,
    signal?: AbortSignal
  ): Promise<LanguageModelSession> {
    this.discard()

    // initialPrompts are never evicted, which is the whole reason the tool
    // schemas go here rather than into the turn
    const session = await api.create({
      initialPrompts: [{ role: 'system', content: preamble(request) }],
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

    this.session = session
    this.sessionKey = sessionKey(request)
    this.sent = []
    return session
  }

  private discard() {
    this.session?.destroy()
    this.session = null
    this.sessionKey = ''
    this.sent = []
  }

  // Trim before the API throws rather than after. measureContextUsage is optional
  // and a session that cannot measure is assumed to fit, since the alternative is
  // trimming a transcript that would have been fine.
  private async fits(
    session: LanguageModelSession,
    input: PromptMessage[],
    options: PromptOptions
  ): Promise<boolean> {
    if (!session.measureContextUsage || input.length === 0) return true

    try {
      const needed = await session.measureContextUsage(input, {
        responseConstraint: options.responseConstraint,
        omitResponseConstraintInput: options.omitResponseConstraintInput,
      })
      // Reserve headroom for the output to prevent mid-generation kErrorUnknown
      const room = readWindow(session) - readUsage(session) - OUTPUT_HEADROOM_TOKENS
      debugAiChat(
        '[chrome] turn needs %d tokens, %d left (reserving %d for output)',
        needed,
        room,
        OUTPUT_HEADROOM_TOKENS
      )
      return needed <= room
    } catch {
      return true
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

// A session is only reusable for the same system prompt and the same tool set;
// the router unlocking a tool changes what the schemas in initialPrompts have to
// say, and initialPrompts cannot be amended.
function sessionKey(request: AgentRequest): string {
  return `${request.system}\u0000${request.tools.map(tool => tool.name).join(',')}`
}

// The Prompt API takes 'user' and 'assistant'; the loop's tool results ride on
// user messages, which is where they belong here too.
function toPromptMessages(
  lines: string[],
  messages: AgentMessage[],
  offset: number
): PromptMessage[] {
  const prompts: PromptMessage[] = []

  lines.forEach((content, index) => {
    if (!content) return
    prompts.push({ role: messages[offset + index].role, content })
  })

  return prompts
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof Error && error.name === 'QuotaExceededError'
}

// Detects Chrome-specific API errors by name pattern. Chrome internal errors
// typically start with 'k' (like kErrorUnknown) or contain specific keywords.
function isChromeApiError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const name = error.name || ''
  const message = error.message || ''
  // Chrome error codes start with 'k', or contain Chrome-specific keywords
  return (
    name.startsWith('k') ||
    name.includes('Chrome') ||
    message.includes('Chrome') ||
    name.includes('Prompt') ||
    name.includes('Language')
  )
}
