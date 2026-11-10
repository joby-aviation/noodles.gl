// A chat session on an ACP agent (https://agentclientprotocol.com) reached
// through the local bridge (noodles-mcp/src/acp-bridge.ts).
//
// The difference from AgentSession is who runs the loop. Here the agent does:
// it holds the transcript, picks the model, and calls tools, its own (files,
// shell) and the editor's. The editor's arrive back over the same socket as
// noodles/listTools and noodles/callTool, run through the same definitions as
// the in-app loop, and their edits collect into the same proposal the user
// accepts or rejects when the turn ends.

import { debugAiChat } from '../../../utils/debug'
import type { MCPTools } from '../../mcp-tools'
import { getSystemPrompt } from '../../system-prompt'
import { availableToolDefinitions, getToolDefinition } from '../../tool-definitions'
import { type ToolResponse, toToolResponse } from '../../tool-response'
import type {
  ClaudeResponse,
  Message,
  ProjectModification,
  ToolCall,
  ToolResult,
} from '../../types'
import { capToolResult, resultBudgetChars } from '../result-budget'
import type { ChatSession, SendParams } from '../session'
import { historyText } from '../session'
import { FIND_TOOLS_DEFINITION, FIND_TOOLS_NAME, ToolRouter } from '../tool-router'
import { AcpConnection, AcpError, METHOD_NOT_FOUND } from './connection'

const PROTOCOL_VERSION = 1

// The agents worth connecting are frontier models with windows this size or
// larger. Only sets how much of a large tool result is sent before it is cut.
const CONTEXT_WINDOW = 200_000

// How long a cancelled turn may take to wind down before the panel stops waiting
const CANCEL_GRACE_MS = 5000

// Leads the first prompt of every session. The in-app system prompt follows it
// unchanged, so the agent gets the same guidance as the built-in loop.
const PREAMBLE = `You are answering in the Noodles.gl editor's chat panel. The editor's tools come from its \`noodles-editor\` MCP server; your client may show them with a prefix, such as mcp__noodles-editor__list_nodes. Use them to inspect and change the user's node graph. What apply_modifications validates is shown to the user as a proposal to accept or reject when your turn ends, so a later call in the same turn does not see it applied.`

export interface ModelChoice {
  id: string
  label: string
}

export interface PermissionRequest {
  // What the agent wants to do, as it describes it
  title: string
  options: Array<{ optionId: string; name: string; kind: string }>
}

export interface AcpSessionOptions {
  url: string
  tools: MCPTools
  // The model last chosen for an ACP agent. Applied when this agent offers it.
  preferredModel?: string
  // Resolves to the chosen optionId, or null when the user dismissed it. The
  // signal fires when the turn is stopped, so the prompt can be taken down.
  onPermissionRequest: (request: PermissionRequest, signal: AbortSignal) => Promise<string | null>
  onModelsChange?: (models: ModelChoice[], current: string | undefined) => void
  // The bridge or the agent went away. The session cannot be used again.
  onDisconnect: (reason: string) => void
}

// Only the parts of ACP v1 this client reads
interface InitializeResponse {
  protocolVersion: number
  agentCapabilities?: { promptCapabilities?: { image?: boolean } }
  agentInfo?: { name?: string; title?: string }
  authMethods?: Array<{ id: string; name: string }>
}

interface SelectOption {
  value: string
  name: string
}

interface ConfigOption {
  id: string
  category?: string
  type: string
  currentValue?: unknown
  options?: Array<SelectOption | { group: string; name: string; options: SelectOption[] }>
}

interface NewSessionResponse {
  sessionId: string
  configOptions?: ConfigOption[] | null
  // The older, unstable model API, which claude-agent-acp and others still use
  models?: {
    availableModels: Array<{ modelId: string; name: string }>
    currentModelId: string
  } | null
}

interface SessionUpdate {
  sessionUpdate: string
  content?: { type: string; text?: string }
  toolCallId?: string
  title?: string
  rawInput?: unknown
  configOptions?: ConfigOption[]
}

type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled'

// Where the model choice lives for this agent, which decides how to change it
type ModelSource = { kind: 'config'; configId: string } | { kind: 'legacy' } | { kind: 'none' }

// What one prompt turn accumulates
interface Turn {
  text: string
  toolCalls: ToolCall[]
  modifications: ProjectModification[]
  onEvent?: SendParams['onEvent']
  signal: AbortSignal
}

// Where the session is, one phase at a time. send claims the turn before its
// first await, so a second send in the same tick is refused even while the
// first is still starting a new agent session. stale means the panel started a
// new conversation (reset) and the next send needs a new agent session; it is
// cleared only once that session has started, so a failed start is retried.
type Phase =
  | { status: 'ready'; stale: boolean }
  | { status: 'starting-session'; turn: Turn; stale: boolean }
  | { status: 'prompting'; turn: Turn; stale: boolean }
  | { status: 'closed'; reason: string }

export class AcpSession implements ChatSession {
  readonly agentName: string
  readonly supportsImages: boolean
  models: ModelChoice[] = []
  currentModel: string | undefined

  private connection: AcpConnection
  private options: AcpSessionOptions
  private tools: MCPTools
  // find_tools only, for the core prompt's sake: every tool is already listed
  private router = new ToolRouter(CONTEXT_WINDOW)
  private sessionId = ''
  private modelSource: ModelSource = { kind: 'none' }
  private phase: Phase = { status: 'ready', stale: false }
  // Prompt turns sent to this ACP session, and the panel's history length the
  // agent has seen. A message the panel added since (a rejected proposal, an
  // error) is passed along with the next prompt.
  private turns = 0
  private seen = 0

  private constructor(
    connection: AcpConnection,
    options: AcpSessionOptions,
    init: InitializeResponse
  ) {
    this.connection = connection
    this.options = options
    this.tools = options.tools
    this.agentName = init.agentInfo?.title ?? init.agentInfo?.name ?? 'ACP agent'
    this.supportsImages = init.agentCapabilities?.promptCapabilities?.image === true
  }

  // Only a turn whose prompt is with the agent gets its text and tool calls
  private get turn(): Turn | null {
    return this.phase.status === 'prompting' ? this.phase.turn : null
  }

  static async connect(options: AcpSessionOptions): Promise<AcpSession> {
    // Requests can arrive before the constructor has run (an agent may list
    // tools as soon as a session exists), so they wait on it
    let resolveSession: (session: AcpSession) => void = () => {}
    const ready = new Promise<AcpSession>(resolve => {
      resolveSession = resolve
    })
    let disconnected = false
    let created: AcpSession | undefined

    const connection = await AcpConnection.open(options.url, {
      onRequest: async (method, params) => (await ready).handleRequest(method, params),
      onNotification: (method, params) => {
        ready.then(session => session.handleNotification(method, params))
      },
      onClose: reason => {
        disconnected = true
        created?.close(reason)
        options.onDisconnect(reason)
      },
    })

    try {
      const init = await connection.request<InitializeResponse>('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        // The agent works on files and runs commands itself, in the directory
        // the bridge started it in. Nothing of the user's disk is reachable
        // from this tab, so none of that is offered back to it.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'noodles-gl', title: 'Noodles.gl', version: '1' },
      })
      if (init.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `The agent speaks ACP version ${init.protocolVersion}; Noodles speaks version ${PROTOCOL_VERSION}.`
        )
      }

      const session = new AcpSession(connection, options, init)
      created = session
      resolveSession(session)
      await session.startSession(init)
      if (disconnected) throw new Error('The ACP bridge closed the connection')
      return session
    } catch (error) {
      connection.close()
      throw error
    }
  }

  async setModel(id: string): Promise<void> {
    if (id === this.currentModel) return
    if (this.modelSource.kind === 'config') {
      const response = await this.connection.request<{ configOptions?: ConfigOption[] }>(
        'session/set_config_option',
        { sessionId: this.sessionId, configId: this.modelSource.configId, value: id }
      )
      this.readModels({ sessionId: this.sessionId, configOptions: response.configOptions })
    } else if (this.modelSource.kind === 'legacy') {
      await this.connection.request('session/set_model', { sessionId: this.sessionId, modelId: id })
      this.currentModel = id
    }
    this.options.onModelsChange?.(this.models, this.currentModel)
  }

  reset() {
    if (this.phase.status !== 'closed') this.phase.stale = true
  }

  dispose() {
    this.close('This chat session was closed.')
    this.connection.close()
  }

  private close(reason: string) {
    if (this.phase.status !== 'closed') this.phase = { status: 'closed', reason }
  }

  async send(params: SendParams): Promise<ClaudeResponse> {
    const phase = this.phase
    if (phase.status === 'closed') throw new Error(phase.reason)
    if (phase.status !== 'ready') throw new Error('A reply is already in progress')

    const history = params.conversationHistory ?? []
    const signal = params.signal ?? new AbortController().signal
    const turn: Turn = {
      text: '',
      toolCalls: [],
      modifications: [],
      onEvent: params.onEvent,
      signal,
    }

    if (phase.stale) {
      const starting: Phase = { status: 'starting-session', turn, stale: false }
      this.phase = starting
      try {
        await this.startSession()
      } catch (error) {
        // Still on the old agent session, so the next send tries again
        if (this.phase === starting) this.phase = { status: 'ready', stale: true }
        throw error
      }
      if (this.phase.status === 'closed') throw new Error(this.phase.reason)
      // Stopped while the new session was starting: nothing was sent, so there
      // is nothing to cancel either
      if (signal.aborted) {
        this.phase = { status: 'ready', stale: starting.stale }
        return { message: '' }
      }
      this.phase = { status: 'prompting', turn, stale: starting.stale }
    } else {
      this.phase = { status: 'prompting', turn, stale: false }
    }

    // Edits the last turn queued have landed or never will
    this.tools.clearQueuedModifications()

    const cancel = () => this.connection.notify('session/cancel', { sessionId: this.sessionId })
    signal.addEventListener('abort', cancel, { once: true })

    try {
      const prompt = this.request(params, history)
      const ignoredCancel = new Promise<null>(resolve => {
        signal.addEventListener('abort', () => setTimeout(() => resolve(null), CANCEL_GRACE_MS), {
          once: true,
        })
      })
      const result = await Promise.race([
        this.connection.request<{ stopReason: StopReason }>('session/prompt', {
          sessionId: this.sessionId,
          prompt,
        }),
        ignoredCancel,
      ])

      // The agent is still running the prompt it was told to stop, and its late
      // text and tool calls would land in whatever turn came next. Closing the
      // socket makes the bridge kill it.
      if (result === null) {
        this.close(`${this.agentName} was shut down after it ignored Stop.`)
        this.connection.close()
        this.options.onDisconnect(
          `${this.agentName} did not stop within ${CANCEL_GRACE_MS / 1000} seconds of Stop, so it was shut down. Retry to start it again.`
        )
        return {
          message: turn.text,
          projectModifications: turn.modifications,
          toolCalls: turn.toolCalls,
        }
      }

      const { stopReason } = result
      this.turns++
      this.seen = history.length + 2
      debugAiChat('[acp] turn ended: %s, %d editor tool call(s)', stopReason, turn.toolCalls.length)

      return {
        message: turn.text + stopNote(stopReason, turn.text),
        projectModifications: turn.modifications,
        toolCalls: turn.toolCalls,
      }
    } finally {
      signal.removeEventListener('abort', cancel)
      if (this.phase.status === 'prompting') {
        this.phase = { status: 'ready', stale: this.phase.stale }
      }
    }
  }

  // The content blocks of one prompt. The agent keeps its own transcript, so
  // history goes only into the first prompt of a session, when a saved
  // conversation was loaded into it; after that only what the agent did not
  // see is added.
  private request(params: SendParams, history: Message[]): Array<Record<string, unknown>> {
    const context: string[] = []
    if (this.turns === 0) {
      context.push(`${PREAMBLE}\n\n${getSystemPrompt()}`)
      if (history.length > 0)
        context.push(`Earlier in this conversation:\n\n${transcript(history)}`)
    } else if (history.length > this.seen) {
      context.push(`Since your last reply:\n\n${transcript(history.slice(this.seen))}`)
    }

    const blocks: Array<Record<string, unknown>> = []
    if (context.length > 0) blocks.push({ type: 'text', text: context.join('\n\n') })
    blocks.push({ type: 'text', text: params.message })
    if (params.screenshot && this.supportsImages) {
      blocks.push({
        type: 'image',
        mimeType: `image/${params.screenshotFormat ?? 'jpeg'}`,
        data: params.screenshot,
      })
    }
    return blocks
  }

  private async startSession(init?: InitializeResponse) {
    const previous = this.currentModel ?? this.options.preferredModel
    let response: NewSessionResponse
    try {
      // The bridge sets both: the tab knows neither the agent's directory nor
      // how to start the tools server
      response = await this.connection.request<NewSessionResponse>('session/new', {
        cwd: '/',
        mcpServers: [],
      })
    } catch (error) {
      if (error instanceof AcpError && error.code === -32000) {
        const methods = init?.authMethods?.map(method => method.name).join(', ')
        throw new Error(
          `${this.agentName} needs you to sign in first. Run it once in a terminal and log in${methods ? ` (${methods})` : ''}, then retry.`
        )
      }
      throw error
    }

    this.turns = 0
    this.seen = 0
    this.readModels(response)
    if (previous && previous !== this.currentModel && this.models.some(m => m.id === previous)) {
      await this.setModel(previous)
    } else {
      this.options.onModelsChange?.(this.models, this.currentModel)
    }
  }

  // An agent that offers a model choice does it one of two ways. The config
  // option is the current one; the models field is what many agents still send.
  private readModels(
    response: Pick<NewSessionResponse, 'configOptions' | 'models'> & { sessionId?: string }
  ) {
    if (response.sessionId) this.sessionId = response.sessionId

    const option = response.configOptions?.find(
      candidate => candidate.category === 'model' && candidate.type === 'select'
    )
    if (option) {
      this.modelSource = { kind: 'config', configId: option.id }
      this.models = (option.options ?? [])
        .flatMap(entry => ('group' in entry ? entry.options : [entry]))
        .map(entry => ({ id: entry.value, label: entry.name }))
      this.currentModel = typeof option.currentValue === 'string' ? option.currentValue : undefined
      return
    }

    if (response.models) {
      this.modelSource = { kind: 'legacy' }
      this.models = response.models.availableModels.map(model => ({
        id: model.modelId,
        label: model.name,
      }))
      this.currentModel = response.models.currentModelId
      return
    }

    // A config update that drops the model option leaves the choice as it was
    if (response.configOptions === undefined && response.models === undefined) return
    this.modelSource = { kind: 'none' }
    this.models = []
    this.currentModel = undefined
  }

  private handleNotification(method: string, params: unknown) {
    if (method !== 'session/update') return
    const { sessionId, update } = params as { sessionId: string; update: SessionUpdate }
    if (sessionId !== this.sessionId) return

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const turn = this.turn
        if (!turn || update.content?.type !== 'text' || !update.content.text) return
        turn.text += update.content.text
        turn.onEvent?.({ type: 'text_delta', text: update.content.text })
        return
      }
      // Every tool the agent runs, its own and the editor's, shows in the trace
      case 'tool_call':
        this.turn?.onEvent?.({
          type: 'tool_call',
          id: update.toolCallId ?? '',
          name: update.title ?? 'tool',
          input: (update.rawInput as Record<string, unknown>) ?? {},
        })
        return
      case 'config_option_update':
        this.readModels({ configOptions: update.configOptions })
        this.options.onModelsChange?.(this.models, this.currentModel)
        return
    }
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'session/request_permission':
        return this.requestPermission(params as PermissionParams)
      case 'noodles/listTools':
        return { tools: this.listTools() }
      case 'noodles/callTool':
        return this.callTool(params as { name: string; arguments?: Record<string, unknown> })
      default:
        // fs/* and terminal/* were declined in initialize
        throw new AcpError(METHOD_NOT_FOUND, `${method} is not supported`)
    }
  }

  private async requestPermission(params: PermissionParams) {
    const turn = this.turn
    if (!turn || turn.signal.aborted) return { outcome: { outcome: 'cancelled' } }
    const optionId = await this.options.onPermissionRequest(
      { title: params.toolCall?.title ?? 'Run a tool', options: params.options },
      turn.signal
    )
    return optionId === null
      ? { outcome: { outcome: 'cancelled' } }
      : { outcome: { outcome: 'selected', optionId } }
  }

  // The whole surface at once, not the five the in-app loop starts with: the
  // agent's client lists tools once, so a tool unlocked later would never
  // reach it. find_tools stays so the core prompt's advice still works.
  private listTools() {
    return [
      ...availableToolDefinitions().map(definition => ({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
      })),
      { ...FIND_TOOLS_DEFINITION, annotations: { readOnlyHint: true } },
    ]
  }

  private async callTool(params: {
    name: string
    arguments?: Record<string, unknown>
  }): Promise<ToolResponse> {
    const { name } = params
    const input = params.arguments ?? {}
    const turn = this.turn
    let result: ToolResult

    // Edits made between turns would have no proposal to land in, and a stopped
    // turn is one the user no longer wants anything from
    if (!turn) {
      result = {
        success: false,
        error: 'The editor runs tools only while the user waits on a reply.',
      }
    } else if (turn.signal.aborted) {
      result = { success: false, error: 'The user stopped this reply.' }
    } else {
      try {
        const definition = name === FIND_TOOLS_NAME ? null : getToolDefinition(name)
        if (name === FIND_TOOLS_NAME) {
          result = this.router.findTools(input)
        } else if (definition) {
          result = await definition.execute(this.tools, input)
        } else {
          result = { success: false, error: `Unknown tool: ${name}` }
        }
      } catch (error) {
        result = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
      turn.toolCalls.push({ name, params: input, result })
      if (result.success && hasModifications(result.data)) {
        turn.modifications.push(...result.data.modifications)
      }
    }

    // A screenshot goes back whole, as an image block; anything else is capped
    // the way the in-app loop caps it
    if (name === 'capture_visualization' && result.success) return toToolResponse(name, result)
    return toToolResponse(
      name,
      capToolResult(name, result, resultBudgetChars(CONTEXT_WINDOW)).result
    )
  }
}

interface PermissionParams {
  toolCall?: { title?: string }
  options: PermissionRequest['options']
}

function hasModifications(data: unknown): data is { modifications: ProjectModification[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { modifications?: unknown }).modifications)
  )
}

function transcript(messages: Message[]): string {
  return messages
    .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${historyText(message)}`)
    .join('\n\n')
}

// A turn that ended early says why, since the reply alone reads as complete
function stopNote(reason: StopReason, text: string): string {
  const prefix = text ? '\n\n' : ''
  switch (reason) {
    case 'refusal':
      return `${prefix}_The agent declined to continue._`
    case 'max_tokens':
    case 'max_turn_requests':
      return `${prefix}_The agent stopped at its limit for one reply. Ask it to continue._`
    default:
      return ''
  }
}
