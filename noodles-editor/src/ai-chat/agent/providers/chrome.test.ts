import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentRequest, AgentTool } from '../types'
import { ChromeProvider, chromeAvailability, createChromeProvider, parseAction } from './chrome'

const TOOLS: AgentTool[] = [
  {
    name: 'list_nodes',
    description: 'List the nodes',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_node_info',
    description: 'Read one node',
    inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } } },
  },
]

interface FakeSessionOptions {
  // One entry per prompt() call; a string resolves, an Error rejects
  responses: Array<string | Error>
  inputQuota?: number
}

interface CreateOptions {
  initialPrompts?: Array<{ role: string; content: string }>
}

function stubLanguageModel(options: FakeSessionOptions & { availability?: string }) {
  const prompts: string[] = []
  // The system prompt goes to create(), the transcript to prompt(), so both have
  // to be captured to see what the model was actually sent
  const created: CreateOptions[] = []
  let callIndex = 0

  const session = {
    prompt: vi.fn(async (input: string) => {
      prompts.push(input)
      const response = options.responses[callIndex++]
      if (response instanceof Error) throw response
      return response ?? '{"tool":"none","reply":"done"}'
    }),
    destroy: vi.fn(),
    addEventListener: vi.fn(),
    inputQuota: options.inputQuota,
  }

  const create = vi.fn(async (createOptions: CreateOptions = {}) => {
    created.push(createOptions)
    return session
  })

  vi.stubGlobal('LanguageModel', {
    availability: async () => options.availability ?? 'available',
    create,
  })

  return { session, created, prompts }
}

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    system: 'you are a test',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'how many nodes?' }] }],
    tools: TOOLS,
    maxTokens: 1024,
    ...overrides,
  }
}

async function collect(provider: ChromeProvider, req = request()): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of provider.stream(req)) events.push(event)
  return events
}

describe('parseAction', () => {
  it('reads a tool call out of the constrained object', () => {
    const action = parseAction(
      '{"tool":"get_node_info","input":{"nodeId":"/a"},"reply":"looking"}',
      TOOLS
    )

    expect(action).toEqual({ tool: 'get_node_info', input: { nodeId: '/a' }, reply: 'looking' })
  })

  it('treats the none sentinel as a final answer', () => {
    expect(parseAction('{"tool":"none","input":{},"reply":"12 nodes"}', TOOLS)).toEqual({
      tool: null,
      input: {},
      reply: '12 nodes',
    })
  })

  it('drops a tool name the model invented', () => {
    // Passing it through would spend a whole round-trip of a 6k window on
    // "Unknown tool"
    expect(parseAction('{"tool":"delete_everything","reply":"ok"}', TOOLS)).toEqual({
      tool: null,
      input: {},
      reply: 'ok',
    })
  })

  it('keeps unconstrained text as the reply', () => {
    expect(parseAction('There are 12 nodes.', TOOLS)).toEqual({
      tool: null,
      input: {},
      reply: 'There are 12 nodes.',
    })
  })

  it('unwraps a fenced object', () => {
    const action = parseAction('```json\n{"tool":"list_nodes","reply":"checking"}\n```', TOOLS)

    expect(action.tool).toBe('list_nodes')
  })

  it('ignores a non-object input rather than passing junk to the tool', () => {
    const action = parseAction('{"tool":"list_nodes","input":"all of them","reply":"x"}', TOOLS)

    expect(action.input).toEqual({})
  })
})

describe('ChromeProvider.stream', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits the same events a native tool-calling provider would', async () => {
    stubLanguageModel({ responses: ['{"tool":"list_nodes","input":{},"reply":"checking"}'] })

    const events = await collect(new ChromeProvider())

    expect(events).toEqual([
      { type: 'text_delta', text: 'checking' },
      { type: 'tool_call', id: 'nano_1', name: 'list_nodes', input: {} },
      { type: 'stop', reason: 'tool_use' },
    ])
  })

  it('ends the turn when no tool is named', async () => {
    stubLanguageModel({ responses: ['{"tool":"none","reply":"there are 12"}'] })

    const events = await collect(new ChromeProvider())

    expect(events).toEqual([
      { type: 'text_delta', text: 'there are 12' },
      { type: 'stop', reason: 'end_turn' },
    ])
  })

  it('sends the tool schemas and the JSON shape in the system prompt', async () => {
    const { created } = stubLanguageModel({ responses: ['{"tool":"none","reply":"ok"}'] })

    await collect(new ChromeProvider())

    const prompt = created[0].initialPrompts?.[0].content ?? ''
    expect(prompt).toContain('you are a test')
    expect(prompt).toContain('list_nodes')
    expect(prompt).toContain('"tool"')
  })

  it('labels tool results in the transcript it sends', async () => {
    const { prompts } = stubLanguageModel({ responses: ['{"tool":"none","reply":"ok"}'] })

    await collect(
      new ChromeProvider(),
      request({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'how many nodes?' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'nano_1', name: 'list_nodes', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUseId: 'nano_1', content: '{"nodeCount":12}' }],
          },
        ],
      })
    )

    expect(prompts[0]).toContain('Assistant called list_nodes')
    expect(prompts[0]).toContain('Result: {"nodeCount":12}')
  })

  it('retries once with a trimmed transcript when the window overflows', async () => {
    const quota = new Error('too big')
    quota.name = 'QuotaExceededError'
    const { prompts, session } = stubLanguageModel({
      responses: [quota, '{"tool":"none","reply":"recovered"}'],
    })

    const events = await collect(
      new ChromeProvider(),
      request({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'first' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'second' }] },
          { role: 'user', content: [{ type: 'text', text: 'third' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'fourth' }] },
        ],
      })
    )

    expect(session.prompt).toHaveBeenCalledTimes(2)
    // First turn kept as the task, middle dropped, tail kept
    expect(prompts[1]).toContain('first')
    expect(prompts[1]).not.toContain('second')
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' })
  })

  it('reports an aborted turn rather than throwing', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    stubLanguageModel({ responses: [abort] })

    const events = await collect(new ChromeProvider())

    expect(events).toEqual([{ type: 'stop', reason: 'aborted' }])
  })

  it('destroys the session even when the turn fails', async () => {
    const { session } = stubLanguageModel({ responses: [new Error('model exploded')] })

    await expect(collect(new ChromeProvider())).rejects.toThrow('model exploded')
    expect(session.destroy).toHaveBeenCalled()
  })

  it('explains itself when the API is absent', async () => {
    await expect(collect(new ChromeProvider())).rejects.toThrow(/not available in this browser/)
  })
})

describe('availability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is unavailable when the browser has no Prompt API', async () => {
    await expect(chromeAvailability()).resolves.toBe('unavailable')
  })

  it('reads the real window size off a probe session', async () => {
    const { session } = stubLanguageModel({ responses: [], inputQuota: 4096 })

    const provider = await createChromeProvider()

    expect(provider.contextWindow).toBe(4096)
    // The probe is not kept: this provider holds no session between turns
    expect(session.destroy).toHaveBeenCalled()
  })

  it('falls back to Nano’s shipped window when the session reports none', async () => {
    stubLanguageModel({ responses: [] })

    await expect(createChromeProvider()).resolves.toMatchObject({ contextWindow: 6144 })
  })

  it('refuses when the device cannot run the model', async () => {
    stubLanguageModel({ responses: [], availability: 'unavailable' })

    await expect(createChromeProvider()).rejects.toThrow(/unavailable on this device/)
  })
})
