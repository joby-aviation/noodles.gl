import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentRequest, AgentTool } from '../types'
import {
  ChromeProvider,
  chromeAvailability,
  createChromeProvider,
  nativeToolSupport,
  parseAction,
} from './chrome'

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

interface PromptMessage {
  role: string
  content: string
}

interface FakeSessionOptions {
  // One entry per prompt() call; a string resolves, an Error rejects
  responses: Array<string | Error>
  inputQuota?: number
  contextWindow?: number
  contextUsage?: number
  // Tokens measureContextUsage reports for any input. Omitted, the session cannot
  // measure at all, which is the shipped-Chrome case.
  measured?: number
}

interface CreateOptions {
  initialPrompts?: PromptMessage[]
  // Deliberately not an array type: the support probe passes a non-sequence
  tools?: unknown
}

// One fake per create() call, so a test can tell session reuse from a rebuild.
function stubLanguageModel(options: FakeSessionOptions & { availability?: string }) {
  // Flattened across sessions: what the model was sent, in order
  const prompts: string[] = []
  // The turn as the API received it, to assert roles and message boundaries
  const turns: Array<string | PromptMessage[]> = []
  const created: CreateOptions[] = []
  const sessions: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
  let callIndex = 0

  const create = vi.fn(async (createOptions: CreateOptions = {}) => {
    created.push(createOptions)

    const session = {
      prompt: vi.fn(async (input: string | PromptMessage[]) => {
        turns.push(input)
        prompts.push(
          typeof input === 'string' ? input : input.map(message => message.content).join('\n')
        )
        const response = options.responses[callIndex++]
        if (response instanceof Error) throw response
        return response ?? '{"tool":"none","reply":"done"}'
      }),
      measureContextUsage:
        options.measured === undefined ? undefined : vi.fn(async () => options.measured as number),
      destroy: vi.fn(),
      addEventListener: vi.fn(),
      inputQuota: options.inputQuota,
      contextWindow: options.contextWindow,
      contextUsage: options.contextUsage,
    }

    sessions.push(session)
    return session
  })

  vi.stubGlobal('LanguageModel', {
    availability: async () => options.availability ?? 'available',
    create,
  })

  // `session` is the first one created, which is the only one most tests make
  return {
    get session() {
      return sessions[0]
    },
    sessions,
    created,
    prompts,
    turns,
    create,
  }
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

    expect(prompts[0]).toContain('Called list_nodes')
    expect(prompts[0]).toContain('Result: {"nodeCount":12}')
  })

  it('tags each message with its role rather than flattening the transcript', async () => {
    const { turns } = stubLanguageModel({ responses: ['{"tool":"none","reply":"ok"}'] })

    await collect(
      new ChromeProvider(),
      request({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'how many nodes?' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'twelve' }] },
          { role: 'user', content: [{ type: 'text', text: 'and edges?' }] },
        ],
      })
    )

    expect(turns[0]).toEqual([
      { role: 'user', content: 'how many nodes?' },
      { role: 'assistant', content: 'twelve' },
      { role: 'user', content: 'and edges?' },
    ])
  })

  const LONG_TRANSCRIPT = [
    { role: 'user' as const, content: [{ type: 'text' as const, text: 'first' }] },
    { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'second' }] },
    { role: 'user' as const, content: [{ type: 'text' as const, text: 'third' }] },
    { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'fourth' }] },
  ]

  it('rebuilds on a trimmed transcript when the window overflows', async () => {
    const quota = new Error('too big')
    quota.name = 'QuotaExceededError'
    const { prompts, sessions, create } = stubLanguageModel({
      responses: [quota, '{"tool":"none","reply":"recovered"}'],
    })

    const events = await collect(new ChromeProvider(), request({ messages: LONG_TRANSCRIPT }))

    // A session cannot forget, so the one holding the oversized transcript is
    // thrown away rather than re-prompted
    expect(create).toHaveBeenCalledTimes(2)
    expect(sessions[0].destroy).toHaveBeenCalled()
    // First turn kept as the task, middle dropped, tail kept
    expect(prompts[1]).toContain('first')
    expect(prompts[1]).not.toContain('second')
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' })
  })

  it('trims before the API throws when the session can measure', async () => {
    const { prompts, create } = stubLanguageModel({
      responses: ['{"tool":"none","reply":"ok"}'],
      contextWindow: 6144,
      contextUsage: 6000,
      // More than the 144 tokens left
      measured: 500,
    })

    await collect(new ChromeProvider(), request({ messages: LONG_TRANSCRIPT }))

    // Trimmed on the first attempt: no QuotaExceededError was needed to find out
    expect(create).toHaveBeenCalledTimes(2)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain('second')
  })

  it('sends the turn as-is when it fits', async () => {
    const { prompts, create } = stubLanguageModel({
      responses: ['{"tool":"none","reply":"ok"}'],
      contextWindow: 6144,
      contextUsage: 100,
      measured: 500,
    })

    await collect(new ChromeProvider(), request({ messages: LONG_TRANSCRIPT }))

    expect(create).toHaveBeenCalledTimes(1)
    expect(prompts[0]).toContain('second')
  })

  it('reports an aborted turn rather than throwing', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    stubLanguageModel({ responses: [abort] })

    const events = await collect(new ChromeProvider())

    expect(events).toEqual([{ type: 'stop', reason: 'aborted' }])
  })

  it('destroys the session even when the turn fails', async () => {
    const { sessions } = stubLanguageModel({ responses: [new Error('model exploded')] })

    await expect(collect(new ChromeProvider())).rejects.toThrow('model exploded')
    expect(sessions[0].destroy).toHaveBeenCalled()
  })

  it('explains itself when the API is absent', async () => {
    await expect(collect(new ChromeProvider())).rejects.toThrow(/not available in this browser/)
  })
})

// A Prompt API session accumulates the transcript, so re-sending it every turn
// would pay for it every turn — and the system prompt with it.
describe('ChromeProvider session reuse', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const FIRST = { role: 'user' as const, content: [{ type: 'text' as const, text: 'first' }] }
  const REPLY = { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'ok' }] }
  const SECOND = { role: 'user' as const, content: [{ type: 'text' as const, text: 'second' }] }

  it('keeps one session across turns and sends only what is new', async () => {
    const { create, turns } = stubLanguageModel({
      responses: ['{"tool":"none","reply":"a"}', '{"tool":"none","reply":"b"}'],
    })
    const provider = new ChromeProvider()

    await collect(provider, request({ messages: [FIRST] }))
    await collect(provider, request({ messages: [FIRST, REPLY, SECOND] }))

    expect(create).toHaveBeenCalledTimes(1)
    // The second turn carries the two new messages, not the whole transcript
    expect(turns[1]).toEqual([
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
    ])
  })

  it('rebuilds when the tool set changes, because initialPrompts cannot be amended', async () => {
    const { create } = stubLanguageModel({
      responses: ['{"tool":"none","reply":"a"}', '{"tool":"none","reply":"b"}'],
    })
    const provider = new ChromeProvider()

    await collect(provider, request({ messages: [FIRST] }))
    // find_tools unlocking a tool is exactly this: the schemas in the preamble are
    // now wrong
    await collect(provider, request({ messages: [FIRST, REPLY, SECOND], tools: [TOOLS[0]] }))

    expect(create).toHaveBeenCalledTimes(2)
  })

  it('rebuilds when history was rewritten rather than extended', async () => {
    const { create } = stubLanguageModel({
      responses: ['{"tool":"none","reply":"a"}', '{"tool":"none","reply":"b"}'],
    })
    const provider = new ChromeProvider()

    await collect(provider, request({ messages: [FIRST, REPLY, SECOND] }))
    // What compaction leaves behind: a shorter transcript with a different start
    await collect(
      provider,
      request({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'summary so far' }] }],
      })
    )

    expect(create).toHaveBeenCalledTimes(2)
  })

  it('does not record a turn the model never answered', async () => {
    const { create, turns } = stubLanguageModel({
      responses: [new Error('model exploded'), '{"tool":"none","reply":"b"}'],
    })
    const provider = new ChromeProvider()

    await expect(collect(provider, request({ messages: [FIRST] }))).rejects.toThrow()
    await collect(provider, request({ messages: [FIRST] }))

    // The failed session is gone, so the retry starts over with the same message
    // rather than assuming the model already has it
    expect(create).toHaveBeenCalledTimes(2)
    expect(turns[1]).toEqual([{ role: 'user', content: 'first' }])
  })

  it('drops the session on dispose', async () => {
    const { create, sessions } = stubLanguageModel({
      responses: ['{"tool":"none","reply":"a"}', '{"tool":"none","reply":"b"}'],
    })
    const provider = new ChromeProvider()

    await collect(provider, request({ messages: [FIRST] }))
    provider.dispose()
    await collect(provider, request({ messages: [FIRST] }))

    expect(sessions[0].destroy).toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(2)
  })
})

// The probe reads WebIDL argument conversion rather than the model's behaviour: a
// browser that declares `tools` rejects a non-sequence with a TypeError, one that
// does not ignores it. Watching for a rejection instead would report support that
// is not there — Chrome 152 accepts `expectedOutputs: [{type: 'tool-call'}]` and
// silently drops `tools`.
describe('nativeToolSupport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Stands in for a browser that declares the member: only the IDL conversion of a
  // bad `tools` value fails, and nothing else about create() does
  function stubWithToolsMember() {
    const create = vi.fn(async (options: CreateOptions = {}) => {
      if ('tools' in options && !Array.isArray(options.tools)) {
        throw new TypeError("Failed to read the 'tools' property")
      }
      return { prompt: vi.fn(), destroy: vi.fn() }
    })
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create })
    return create
  }

  it('is false without the Prompt API', async () => {
    await expect(nativeToolSupport()).resolves.toBe(false)
  })

  it('is true when create() declares the tools member', async () => {
    stubWithToolsMember()

    await expect(nativeToolSupport()).resolves.toBe(true)
  })

  it('is false when create() ignores tools like any unknown option', async () => {
    // What shipped Chrome does: `tools` is not a member, so a bad value is dropped
    // and create() fails for its own reason — or, on a machine with the model
    // downloaded, succeeds
    const notSupported = new Error('service is not running')
    notSupported.name = 'NotSupportedError'
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: vi.fn(async () => {
        throw notSupported
      }),
    })

    await expect(nativeToolSupport()).resolves.toBe(false)
  })

  it('is false when tools is accepted but silently dropped', async () => {
    // The false positive the old probe hit: a well-formed tool and a `tool-call`
    // output type are both taken without complaint, and neither does anything
    const { sessions } = stubLanguageModel({ responses: [] })

    await expect(nativeToolSupport()).resolves.toBe(false)
    // Whatever the probe opened is closed again
    for (const session of sessions) expect(session.destroy).toHaveBeenCalled()
  })

  it('is false when every create() call throws TypeError, which proves nothing', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: vi.fn(async () => {
        throw new TypeError('this engine is broken')
      }),
    })

    await expect(nativeToolSupport()).resolves.toBe(false)
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
    const { sessions } = stubLanguageModel({ responses: [], inputQuota: 4096 })

    const provider = await createChromeProvider()

    expect(provider.contextWindow).toBe(4096)
    // The probe is thrown away: the streaming session needs a system prompt that
    // is not known until the first request
    expect(sessions[0].destroy).toHaveBeenCalled()
  })

  it('prefers the current contextWindow spelling over the deprecated aliases', async () => {
    stubLanguageModel({ responses: [], contextWindow: 8192, inputQuota: 4096 })

    await expect(createChromeProvider()).resolves.toMatchObject({ contextWindow: 8192 })
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
