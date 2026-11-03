import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MCPTools } from '../../mcp-tools'
import type { Message } from '../../types'
import { CLOSE_AGENT_EXITED } from './connection'
import { AcpSession, type AcpSessionOptions } from './session'

vi.mock('../../system-prompt', () => ({ getSystemPrompt: () => 'CORE PROMPT' }))

vi.mock('../../tool-definitions', () => {
  const definitions = [
    {
      name: 'list_nodes',
      description: 'List nodes',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => ({ success: true, data: { nodes: ['/a', '/b'] } }),
    },
    {
      name: 'apply_modifications',
      description: 'Apply',
      annotations: { readOnlyHint: false },
      inputSchema: { type: 'object', properties: {} },
      execute: (_tools: unknown, params: { modifications: unknown[] }) => ({
        success: true,
        data: { modifications: params.modifications },
      }),
    },
  ]
  return {
    availableToolDefinitions: () => definitions,
    getToolDefinition: (name: string) => definitions.find(d => d.name === name),
  }
})

interface Frame {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: unknown
}

type Responder = (frame: Frame, agent: FakeAgent) => void

// Stands in for the browser WebSocket, with the bridge and agent behind it
class FakeAgent {
  static current: FakeAgent
  readyState = 0
  sent: Frame[] = []
  respond: Responder = () => {}
  private listeners = new Map<string, Array<(event: unknown) => void>>()

  constructor() {
    FakeAgent.current = this
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(l => l !== listener)
    )
  }

  send(data: string) {
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    queueMicrotask(() => this.respond(frame, this))
  }

  close(code = 1000, reason = '') {
    this.readyState = 3
    this.emit('close', { code, reason })
  }

  // From the agent's side
  reply(frame: Frame, result: unknown) {
    this.push({ jsonrpc: '2.0', id: frame.id, result })
  }

  push(frame: Frame) {
    this.emit('message', { data: JSON.stringify(frame) })
  }

  methods() {
    return this.sent.filter(frame => frame.method).map(frame => frame.method)
  }

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

// A cooperative agent: answers the handshake, offers two models the old way,
// and runs each prompt through `onPrompt`
function agent(
  onPrompt: (frame: Frame, agent: FakeAgent) => void | Promise<void> = (frame, a) =>
    a.reply(frame, { stopReason: 'end_turn' })
): Responder {
  let sessions = 0
  return (frame, a) => {
    switch (frame.method) {
      case 'initialize':
        return a.reply(frame, {
          protocolVersion: 1,
          agentInfo: { name: 'claude-agent-acp', title: 'Claude Code' },
          agentCapabilities: { promptCapabilities: { image: true } },
        })
      case 'session/new':
        sessions++
        return a.reply(frame, {
          sessionId: `s${sessions}`,
          models: {
            availableModels: [
              { modelId: 'default', name: 'Default' },
              { modelId: 'opus', name: 'Opus' },
            ],
            currentModelId: 'default',
          },
        })
      case 'session/set_model':
        return a.reply(frame, {})
      case 'session/prompt':
        return void onPrompt(frame, a)
    }
  }
}

const tools = {
  clearQueuedModifications: vi.fn(),
  getProject: () => null,
} as unknown as MCPTools

function options(overrides: Partial<AcpSessionOptions> = {}): AcpSessionOptions {
  return {
    url: 'ws://127.0.0.1:7341/acp?token=t',
    tools,
    onPermissionRequest: async () => null,
    onDisconnect: vi.fn(),
    ...overrides,
  }
}

async function connect(responder: Responder, overrides: Partial<AcpSessionOptions> = {}) {
  // The socket exists as soon as connect is called; the handshake follows
  const pending = AcpSession.connect(options(overrides))
  FakeAgent.current.respond = responder
  return pending
}

function promptText(frame: Frame): string {
  return (frame.params as { prompt: Array<{ text?: string }> }).prompt
    .map(block => block.text ?? '')
    .join('\n')
}

function update(sessionId: string, update: Record<string, unknown>): Frame {
  return { jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', Object.assign(FakeAgent, { OPEN: 1 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AcpSession.connect', () => {
  it('declines the file system and terminal, and reads what the agent offers', async () => {
    const session = await connect(agent())
    const [init] = FakeAgent.current.sent
    expect(init.method).toBe('initialize')
    expect(init.params?.clientCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    })
    expect(session.agentName).toBe('Claude Code')
    expect(session.supportsImages).toBe(true)
    expect(session.models).toEqual([
      { id: 'default', label: 'Default' },
      { id: 'opus', label: 'Opus' },
    ])
    expect(session.currentModel).toBe('default')
  })

  it('switches to the model chosen last time, when this agent has it', async () => {
    const session = await connect(agent(), { preferredModel: 'opus' })
    expect(FakeAgent.current.methods()).toEqual(['initialize', 'session/new', 'session/set_model'])
    expect(session.currentModel).toBe('opus')
  })

  it('changes model through config options when the agent uses them', async () => {
    const options = (current: string) => [
      {
        id: 'model',
        category: 'model',
        type: 'select',
        currentValue: current,
        options: [
          {
            group: 'g',
            name: 'All',
            options: [
              { value: 'a', name: 'A' },
              { value: 'b', name: 'B' },
            ],
          },
        ],
      },
    ]
    const session = await connect((frame, a) => {
      if (frame.method === 'initialize') a.reply(frame, { protocolVersion: 1 })
      if (frame.method === 'session/new')
        a.reply(frame, { sessionId: 's1', configOptions: options('a') })
      if (frame.method === 'session/set_config_option') {
        a.reply(frame, { configOptions: options(String(frame.params?.value)) })
      }
    })
    expect(session.models.map(m => m.id)).toEqual(['a', 'b'])
    await session.setModel('b')
    expect(FakeAgent.current.sent.at(-1)?.params).toEqual({
      sessionId: 's1',
      configId: 'model',
      value: 'b',
    })
    expect(session.currentModel).toBe('b')
  })

  it('says to sign in when the agent needs it', async () => {
    const pending = connect((frame, a) => {
      if (frame.method === 'initialize') {
        a.reply(frame, {
          protocolVersion: 1,
          agentInfo: { name: 'codex' },
          authMethods: [{ id: 'x', name: 'ChatGPT login' }],
        })
      }
      if (frame.method === 'session/new') {
        a.push({
          jsonrpc: '2.0',
          id: frame.id,
          error: { code: -32000, message: 'Authentication required' },
        })
      }
    })
    await expect(pending).rejects.toThrow(
      'codex needs you to sign in first. Run it once in a terminal and log in (ChatGPT login)'
    )
  })

  it('passes on the detail an agent puts in its error data', async () => {
    const pending = connect((frame, a) => {
      if (frame.method === 'initialize') a.reply(frame, { protocolVersion: 1 })
      if (frame.method === 'session/new') {
        a.push({
          jsonrpc: '2.0',
          id: frame.id,
          error: {
            code: -32603,
            message: 'Internal error',
            data: { details: 'Invalid permissions.defaultMode: auto.' },
          },
        })
      }
    })
    await expect(pending).rejects.toThrow('Internal error: Invalid permissions.defaultMode: auto.')
  })

  it('refuses an agent on another protocol version', async () => {
    const pending = connect((frame, a) => a.reply(frame, { protocolVersion: 2 }))
    await expect(pending).rejects.toThrow('ACP version 2')
  })
})

describe('AcpSession.send', () => {
  it('streams the reply and its tool calls, and leads the first prompt with the guidance', async () => {
    const session = await connect(
      agent((frame, a) => {
        a.push(
          update('s1', {
            sessionUpdate: 'tool_call',
            toolCallId: 't1',
            title: 'Read file',
            rawInput: { path: 'a' },
          })
        )
        a.push(
          update('s1', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hel' },
          })
        )
        a.push(
          update('s1', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'lo' },
          })
        )
        // Another session's updates are not this turn's
        a.push(
          update('s9', {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'x' },
          })
        )
        a.reply(frame, { stopReason: 'end_turn' })
      })
    )
    const events: unknown[] = []
    const response = await session.send({ message: 'hi', onEvent: event => events.push(event) })

    expect(response.message).toBe('Hello')
    expect(events).toEqual([
      { type: 'tool_call', id: 't1', name: 'Read file', input: { path: 'a' } },
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
    ])
    const prompt = FakeAgent.current.sent.find(f => f.method === 'session/prompt') as Frame
    expect(promptText(prompt)).toContain('noodles-editor')
    expect(promptText(prompt)).toContain('CORE PROMPT')
    expect(promptText(prompt)).toMatch(/hi$/)
  })

  it('runs the editor tools the bridge calls and proposes their edits', async () => {
    const session = await connect(
      agent(async (frame, a) => {
        a.push({ jsonrpc: '2.0', id: 'noodles-bridge:0', method: 'noodles/listTools', params: {} })
        a.push({
          jsonrpc: '2.0',
          id: 'noodles-bridge:1',
          method: 'noodles/callTool',
          params: {
            name: 'apply_modifications',
            arguments: { modifications: [{ type: 'add_node' }] },
          },
        })
        await vi.waitFor(() => expect(a.sent.filter(f => typeof f.id === 'string')).toHaveLength(2))
        a.reply(frame, { stopReason: 'end_turn' })
      })
    )
    const response = await session.send({ message: 'add a node' })

    const answers = FakeAgent.current.sent.filter(f => typeof f.id === 'string')
    const listed = (answers[0].result as { tools: Array<{ name: string }> }).tools.map(t => t.name)
    expect(listed).toEqual(['list_nodes', 'apply_modifications', 'find_tools'])
    expect((answers[1].result as { isError?: boolean }).isError).toBeUndefined()
    expect(response.projectModifications).toEqual([{ type: 'add_node' }])
    expect(response.toolCalls?.map(call => call.name)).toEqual(['apply_modifications'])
    expect(tools.clearQueuedModifications).toHaveBeenCalled()
  })

  it('refuses editor tools between turns', async () => {
    await connect(agent())
    FakeAgent.current.push({
      jsonrpc: '2.0',
      id: 'noodles-bridge:0',
      method: 'noodles/callTool',
      params: { name: 'list_nodes', arguments: {} },
    })
    await vi.waitFor(() => expect(FakeAgent.current.sent.at(-1)?.id).toBe('noodles-bridge:0'))
    expect(FakeAgent.current.sent.at(-1)?.result).toMatchObject({ isError: true })
  })

  it('tells the agent only what it has not seen, and starts over after a reset', async () => {
    const session = await connect(agent())
    const first: Message = { role: 'user', content: 'one' }
    const reply: Message = { role: 'assistant', content: 'done' }
    const rejected: Message = { role: 'assistant', content: 'Proposal rejected.' }

    await session.send({ message: 'one', conversationHistory: [] })
    await session.send({ message: 'two', conversationHistory: [first, reply, rejected] })
    const prompts = () => FakeAgent.current.sent.filter(f => f.method === 'session/prompt')
    const second = promptText(prompts()[1])
    expect(second).not.toContain('CORE PROMPT')
    expect(second).toContain('Since your last reply:\n\nAssistant: Proposal rejected.')
    expect(second).not.toContain('User: one')

    // A loaded conversation goes to a fresh agent session, history included
    session.reset()
    await session.send({ message: 'three', conversationHistory: [first, reply] })
    expect(prompts()[2].params?.sessionId).toBe('s2')
    expect(promptText(prompts()[2])).toContain(
      'Earlier in this conversation:\n\nUser: one\n\nAssistant: done'
    )
  })

  it('asks the user before the agent runs a tool, and cancels when stopped', async () => {
    const asked: string[] = []
    const controller = new AbortController()
    const session = await connect(
      agent((frame, a) => {
        a.push({
          jsonrpc: '2.0',
          id: 7,
          method: 'session/request_permission',
          params: {
            sessionId: 's1',
            toolCall: { toolCallId: 't1', title: 'Run npm test' },
            options: [
              { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'deny', name: 'Reject', kind: 'reject_once' },
            ],
          },
        })
        a.respond = (next, agent) => {
          if (next.method === 'session/cancel') agent.reply(frame, { stopReason: 'cancelled' })
        }
      }),
      {
        onPermissionRequest: async request => {
          asked.push(request.title)
          queueMicrotask(() => controller.abort())
          return 'allow'
        },
      }
    )
    const response = await session.send({ message: 'test it', signal: controller.signal })

    expect(asked).toEqual(['Run npm test'])
    expect(FakeAgent.current.sent.find(f => f.id === 7)?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    })
    expect(FakeAgent.current.methods()).toContain('session/cancel')
    expect(response.message).toBe('')
  })

  it('reports why the agent went away', async () => {
    const onDisconnect = vi.fn()
    await connect(agent(), { onDisconnect })
    FakeAgent.current.close(CLOSE_AGENT_EXITED, 'The agent exited with code 1')
    expect(onDisconnect).toHaveBeenCalledWith('The agent exited with code 1')
  })
})
