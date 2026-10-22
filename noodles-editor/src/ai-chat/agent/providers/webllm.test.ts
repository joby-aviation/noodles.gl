import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentRequest, AgentTool } from '../types'
import {
  DEFAULT_WEBLLM_MODEL,
  WEBLLM_MODELS,
  type WebLLMEngine,
  WebLLMProvider,
  webgpuAvailable,
} from './webllm'

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

interface Chunk {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

// A completion delivered the way WebLLM delivers one: already-parsed chunks, the
// content split across several of them, usage only on the last.
function chunksFor(content: string, options: { finishReason?: string; usage?: boolean } = {}) {
  const pieces = splitInThree(content)
  const chunks: Chunk[] = pieces.map(piece => ({ choices: [{ delta: { content: piece } }] }))
  chunks.push({ choices: [{ delta: {}, finish_reason: options.finishReason ?? 'stop' }] })
  if (options.usage) {
    chunks.push({ choices: [], usage: { prompt_tokens: 300, completion_tokens: 40 } })
  }
  return chunks
}

function splitInThree(text: string): string[] {
  const size = Math.max(1, Math.ceil(text.length / 3))
  const pieces: string[] = []
  for (let index = 0; index < text.length; index += size) {
    pieces.push(text.slice(index, index + size))
  }
  return pieces
}

interface StubOptions {
  // One entry per create() call; an Error or a string rejects instead of streaming
  responses: Array<Chunk[] | Error | string>
  onCreate?: () => void
}

function stubEngine(options: StubOptions) {
  const requests: Array<Record<string, unknown>> = []
  const interruptGenerate = vi.fn()
  const unload = vi.fn(async () => {})
  let callIndex = 0

  const create = async (request: Record<string, unknown>) => {
    requests.push(request)
    options.onCreate?.()
    const response = options.responses[callIndex++]
    if (response instanceof Error || typeof response === 'string') throw response
    return (async function* () {
      for (const chunk of response ?? []) yield chunk
    })()
  }

  // Cast once at the boundary: the fake's request is a plain record so a test can
  // assert on fields the provider's own narrower type does not have to admit
  const engine = {
    chat: { completions: { create } },
    interruptGenerate,
    unload,
  } as unknown as WebLLMEngine

  return { engine, requests, interruptGenerate, unload }
}

function requestFor(text: string, tools = TOOLS): AgentRequest {
  return {
    system: 'You are the assistant.',
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    tools,
    maxTokens: 8192,
  }
}

// The turn in which find_tools unlocked capture_visualization, as the loop records it
function withFindToolsResult(request: AgentRequest): AgentRequest {
  return {
    ...request,
    messages: [
      ...request.messages,
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'f1', name: 'find_tools', input: { query: 'screenshot' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'f1',
            content:
              '{"unlocked":[{"name":"capture_visualization","description":"Take a screenshot"}]}',
          },
        ],
      },
    ],
  }
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

describe('WEBLLM_MODELS', () => {
  it('offers the default model', () => {
    expect(WEBLLM_MODELS.map(model => model.id)).toContain(DEFAULT_WEBLLM_MODEL)
  })

  it('labels every model with a size', () => {
    for (const model of WEBLLM_MODELS) {
      expect(model.sizeMb).toBeGreaterThan(0)
      expect(model.label).toMatch(/GB\)$/)
    }
  })
})

describe('webgpuAvailable', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'gpu')

  afterEach(() => {
    if (original) {
      Object.defineProperty(navigator, 'gpu', original)
    } else {
      Reflect.deleteProperty(navigator, 'gpu')
    }
  })

  const stubGpu = (value: unknown) => {
    Object.defineProperty(navigator, 'gpu', { value, configurable: true, writable: true })
  }

  it('is false without the API', async () => {
    stubGpu(undefined)
    expect(await webgpuAvailable()).toBe(false)
  })

  // Safari and Firefox ship the object and still refuse an adapter
  it('is false when no adapter is handed out', async () => {
    stubGpu({ requestAdapter: async () => null })
    expect(await webgpuAvailable()).toBe(false)
  })

  it('is false when requesting an adapter throws', async () => {
    stubGpu({
      requestAdapter: async () => {
        throw new Error('no GPU process')
      },
    })
    expect(await webgpuAvailable()).toBe(false)
  })

  it('is true with an adapter', async () => {
    stubGpu({ requestAdapter: async () => ({}) })
    expect(await webgpuAvailable()).toBe(true)
  })
})

describe('WebLLMProvider', () => {
  const providerFor = (stub: ReturnType<typeof stubEngine>) =>
    new WebLLMProvider({ engine: stub.engine, model: DEFAULT_WEBLLM_MODEL })

  it('reports no native tool support, whatever the model', () => {
    const stub = stubEngine({ responses: [] })
    for (const model of WEBLLM_MODELS) {
      const provider = new WebLLMProvider({ engine: stub.engine, model: model.id })
      expect(provider.supportsNativeTools).toBe(false)
    }
  })

  it('keeps the prebuilt 4k window unless asked for more', () => {
    const stub = stubEngine({ responses: [] })
    expect(providerFor(stub).contextWindow).toBe(4096)
    const larger = new WebLLMProvider({
      engine: stub.engine,
      model: DEFAULT_WEBLLM_MODEL,
      contextWindow: 16_384,
    })
    // The router, result budget and step limit all read this, so it has to be
    // the size the engine was actually loaded with
    expect(larger.contextWindow).toBe(16_384)
  })

  it('turns a JSON action into a tool call', async () => {
    const action = '{"tool":"get_node_info","input":{"nodeId":"/viewer"},"reply":"Checking."}'
    const stub = stubEngine({ responses: [chunksFor(action)] })

    const events = await collect(providerFor(stub).stream(requestFor('what is /viewer')))

    expect(events).toEqual([
      { type: 'provider_block', provider: 'webllm', block: action },
      { type: 'text_delta', text: 'Checking.' },
      { type: 'tool_call', id: 'webllm_1', name: 'get_node_info', input: { nodeId: '/viewer' } },
      { type: 'stop', reason: 'tool_use' },
    ])
  })

  it('ends the turn when the action names no tool', async () => {
    const action = '{"tool":"none","reply":"There are 4 nodes."}'
    const stub = stubEngine({ responses: [chunksFor(action)] })

    const events = await collect(providerFor(stub).stream(requestFor('how many nodes')))

    expect(events).toEqual([
      { type: 'provider_block', provider: 'webllm', block: action },
      { type: 'text_delta', text: 'There are 4 nodes.' },
      { type: 'stop', reason: 'end_turn' },
    ])
  })

  it('reports usage when the stream carries it', async () => {
    const stub = stubEngine({
      responses: [chunksFor('{"tool":"none","reply":"Done."}', { usage: true })],
    })

    const events = await collect(providerFor(stub).stream(requestFor('anything')))

    // Before the text, so the panel's counter is current for the turn it belongs to
    expect(events[0]).toEqual({ type: 'usage', usage: { inputTokens: 300, outputTokens: 40 } })
  })

  // A truncated action object cannot parse, so the reply is whatever prose is left.
  // The stop reason is what tells the loop the answer was cut off.
  it('passes on a length stop', async () => {
    const stub = stubEngine({
      responses: [chunksFor('{"tool":"none","reply":"The nodes are', { finishReason: 'length' })],
    })

    const events = await collect(providerFor(stub).stream(requestFor('anything')))

    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'max_tokens' })
  })

  it('constrains the response only when there are tools to choose between', async () => {
    const stub = stubEngine({
      responses: [chunksFor('{"tool":"none","reply":"Hi."}'), chunksFor('Hi.')],
    })
    const provider = providerFor(stub)

    await collect(provider.stream(requestFor('hello')))
    await collect(provider.stream(requestFor('hello', [])))

    const constrained = stub.requests[0].response_format as { type: string; schema: string }
    expect(constrained.type).toBe('json_object')
    expect(JSON.parse(constrained.schema).properties.tool.enum).toEqual([
      'none',
      'list_nodes',
      'get_node_info',
    ])
    expect(stub.requests[1].response_format).toBeUndefined()
  })

  // The loop asks for 8192, which is twice this provider's whole context
  it('clamps the output budget below the context window', async () => {
    const stub = stubEngine({ responses: [chunksFor('{"tool":"none","reply":"Hi."}')] })
    const provider = providerFor(stub)

    await collect(provider.stream(requestFor('hello')))

    expect(stub.requests[0].max_tokens as number).toBeLessThan(provider.contextWindow)
  })

  it('sends the system prompt and tool schemas as one system message', async () => {
    const stub = stubEngine({ responses: [chunksFor('{"tool":"none","reply":"Hi."}')] })

    await collect(providerFor(stub).stream(requestFor('hello')))

    const messages = stub.requests[0].messages as Array<{ role: string; content: string }>
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('You are the assistant.')
    expect(messages[0].content).toContain('get_node_info')
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' })
  })

  // The engine reuses its KV cache only for a request that extends the last one
  // exactly, so a system message that grew with each unlocked tool would mean
  // prefilling the whole prompt again on every step
  it('keeps the system message stable when find_tools unlocks more tools', async () => {
    const stub = stubEngine({
      responses: [
        chunksFor('{"tool":"none","reply":"Hi."}'),
        chunksFor('{"tool":"none","reply":"Hi."}'),
      ],
    })
    const provider = providerFor(stub)
    const unlocked: AgentTool = {
      name: 'capture_visualization',
      description: 'Take a screenshot',
      inputSchema: { type: 'object', properties: {} },
    }

    await collect(provider.stream(requestFor('hello')))
    await collect(provider.stream(withFindToolsResult(requestFor('hello', [...TOOLS, unlocked]))))

    const system = (index: number) =>
      (stub.requests[index].messages as Array<{ content: string }>)[0].content
    expect(system(1)).toBe(system(0))
    // Still callable: the grammar is per request and not part of the cached prefix
    const schema = stub.requests[1].response_format as { schema: string }
    expect(JSON.parse(schema.schema).properties.tool.enum).toContain('capture_visualization')
  })

  it('rebuilds the system message once the result describing an unlocked tool is gone', async () => {
    // Trimming, or the next user turn, drops the find_tools result; with the old
    // preamble the model would have the tool's name and no description
    const stub = stubEngine({
      responses: [
        chunksFor('{"tool":"none","reply":"Hi."}'),
        chunksFor('{"tool":"none","reply":"Hi."}'),
      ],
    })
    const provider = providerFor(stub)
    const unlocked: AgentTool = {
      name: 'capture_visualization',
      description: 'Take a screenshot',
      inputSchema: { type: 'object', properties: {} },
    }

    await collect(provider.stream(requestFor('hello')))
    await collect(provider.stream(requestFor('hello', [...TOOLS, unlocked])))

    const system = (index: number) =>
      (stub.requests[index].messages as Array<{ content: string }>)[0].content
    expect(system(1)).not.toBe(system(0))
    expect(system(1)).toContain('Take a screenshot')
  })

  it('rebuilds the system message when a tool it lists is no longer offered', async () => {
    const stub = stubEngine({
      responses: [
        chunksFor('{"tool":"none","reply":"Hi."}'),
        chunksFor('{"tool":"none","reply":"Hi."}'),
      ],
    })
    const provider = providerFor(stub)

    await collect(provider.stream(requestFor('hello')))
    await collect(provider.stream(requestFor('hello', TOOLS.slice(0, 1))))

    const system = (stub.requests[1].messages as Array<{ content: string }>)[0].content
    expect(system).not.toContain('get_node_info')
  })

  it('sends its own earlier completions back verbatim', async () => {
    const raw = '<think>\n\n</think>\n\n{"tool":"list_nodes","reply":"Looking.","input":{}}'
    const stub = stubEngine({
      responses: [chunksFor(raw), chunksFor('{"tool":"none","reply":"4."}')],
    })
    const provider = providerFor(stub)

    const first = await collect(provider.stream(requestFor('how many nodes')))
    const block = first.find(event => event.type === 'provider_block')
    if (block?.type !== 'provider_block') throw new Error('no provider block')

    const request = requestFor('how many nodes')
    request.messages.push(
      {
        role: 'assistant',
        content: [
          { type: 'provider_block', provider: block.provider, block: block.block },
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 'webllm_1', name: 'list_nodes', input: {} },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'webllm_1', content: '4 nodes' }],
      }
    )
    await collect(provider.stream(request))

    const messages = stub.requests[1].messages as Array<{ role: string; content: string }>
    expect(messages[2]).toEqual({ role: 'assistant', content: raw })
    expect(messages[3]).toEqual({ role: 'user', content: 'Result: 4 nodes' })
  })

  // Errors cross the worker boundary as their toString(), so the class is gone by
  // the time this sees them and only the message prefix is left
  it('retries on a trimmed transcript when the context overflows', async () => {
    const overflow = new Error(
      'ContextWindowSizeExceededError: Prompt tokens exceed context window size: number of prompt tokens: 5000; context window size: 4096'
    )
    const stub = stubEngine({
      responses: [overflow, chunksFor('{"tool":"none","reply":"Trimmed."}')],
    })

    const request = requestFor('first question')
    request.messages = [
      { role: 'user', content: [{ type: 'text', text: 'first question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a long answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'second question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'another long answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'third question' }] },
    ]

    const events = await collect(providerFor(stub).stream(request))

    expect(events).toEqual([
      { type: 'diagnostic', kind: 'context_trimmed' },
      { type: 'provider_block', provider: 'webllm', block: '{"tool":"none","reply":"Trimmed."}' },
      { type: 'text_delta', text: 'Trimmed.' },
      { type: 'stop', reason: 'end_turn' },
    ])

    const first = stub.requests[0].messages as unknown[]
    const second = stub.requests[1].messages as unknown[]
    expect(second.length).toBeLessThan(first.length)
  })

  // What the real worker engine does: its client rejects with the worker's
  // err.toString(), a plain string, and the count is only the tokens added on top
  // of the KV cache the engine kept, which is why it reads as well under 4096
  it('retries when the overflow arrives as the worker engine rejects it, a string', async () => {
    const overflow =
      'ContextWindowSizeExceededError: Prompt tokens exceed context window size: number of prompt tokens: 446; context window size: 4096'
    const stub = stubEngine({
      responses: [overflow, chunksFor('{"tool":"none","reply":"Trimmed."}')],
    })

    const request = requestFor('make the points bigger')
    request.messages = [
      { role: 'user', content: [{ type: 'text', text: 'make the points bigger' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'a', name: 'list_nodes', input: {} }],
      },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'a', content: '[...]' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'b', name: 'get_node_info', input: { nodeId: '/a' } }],
      },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'b', content: '{...}' }] },
    ]

    const events = await collect(providerFor(stub).stream(request))

    expect(events[0]).toEqual({ type: 'diagnostic', kind: 'context_trimmed' })
    expect(events).toContainEqual({ type: 'text_delta', text: 'Trimmed.' })
    expect(stub.requests).toHaveLength(2)
    // The retry keeps the task and the last call with its result, and drops the middle
    expect((stub.requests[1].messages as unknown[]).length).toBe(4)
  })

  it('keeps sending the trimmed transcript on later steps so the engine can reuse its cache', async () => {
    const overflow = 'ContextWindowSizeExceededError: number of prompt tokens: 446'
    const stub = stubEngine({
      responses: [
        overflow,
        chunksFor('{"tool":"get_node_info","reply":"Reading","input":{"nodeId":"/c"}}'),
        chunksFor('{"tool":"none","reply":"Done.","input":{}}'),
      ],
    })
    const provider = providerFor(stub)

    const request = requestFor('make the points bigger')
    request.messages = [
      { role: 'user', content: [{ type: 'text', text: 'make the points bigger' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'a', name: 'list_nodes', input: {} }],
      },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'a', content: '[...]' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'b', name: 'get_node_info', input: { nodeId: '/a' } }],
      },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'b', content: '{...}' }] },
    ]
    const first = await collect(provider.stream(request))

    // The loop appends the step's call and its result to its own, untrimmed transcript
    const block = first.find(event => event.type === 'provider_block')
    const next: AgentRequest = {
      ...request,
      messages: [
        ...request.messages,
        {
          role: 'assistant',
          content: [
            {
              type: 'provider_block',
              provider: 'webllm',
              block: (block as { block: string }).block,
            },
            { type: 'tool_use', id: 'c', name: 'get_node_info', input: { nodeId: '/c' } },
          ],
        },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c', content: '{"c":1}' }] },
      ],
    }
    const second = await collect(provider.stream(next))

    expect(second).not.toContainEqual({ type: 'diagnostic', kind: 'context_trimmed' })
    const retried = stub.requests[1].messages as unknown[]
    const extended = stub.requests[2].messages as unknown[]
    // The trimmed request plus the call it produced and that call's result, byte for byte
    expect(extended.slice(0, retried.length)).toEqual(retried)
    expect(extended).toHaveLength(retried.length + 2)
  })

  it('sends a new conversation whole after an earlier one was trimmed', async () => {
    const stub = stubEngine({
      responses: [
        'ContextWindowSizeExceededError: number of prompt tokens: 446',
        chunksFor('{"tool":"none","reply":"Trimmed.","input":{}}'),
        chunksFor('{"tool":"none","reply":"Hello.","input":{}}'),
      ],
    })
    const provider = providerFor(stub)

    const long = requestFor('first')
    long.messages = [
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'one' }] },
      { role: 'user', content: [{ type: 'text', text: 'second' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'two' }] },
      { role: 'user', content: [{ type: 'text', text: 'third' }] },
    ]
    await collect(provider.stream(long))
    await collect(provider.stream(requestFor('hello')))

    expect(stub.requests[2].messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'hello' },
    ])
  })

  it('does not retry an error that is not an overflow', async () => {
    const stub = stubEngine({ responses: [new Error('WebGPU device lost')] })

    await expect(collect(providerFor(stub).stream(requestFor('hello')))).rejects.toThrow(
      'WebGPU device lost'
    )
    expect(stub.requests).toHaveLength(1)
  })

  // After the first tool call there is no middle to drop, and a retry on the tool
  // result alone would answer without the task or the call it came from
  it('does not retry an overflow when there is nothing to trim', async () => {
    const overflow = new Error('ContextWindowSizeExceededError: prompt tokens exceed 4096')
    const stub = stubEngine({ responses: [overflow] })

    const request = requestFor('add a layer')
    request.messages = [
      { role: 'user', content: [{ type: 'text', text: 'add a layer' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'a', name: 'list_nodes', input: {} }],
      },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'a', content: '[...]' }] },
    ]

    await expect(collect(providerFor(stub).stream(request))).rejects.toThrow(
      'ContextWindowSizeExceededError'
    )
    expect(stub.requests).toHaveLength(1)
  })

  it('stops generating on abort rather than abandoning the iterator', async () => {
    const controller = new AbortController()
    const stub = stubEngine({
      responses: [chunksFor('{"tool":"none","reply":"Half an answer"}')],
      // Aborted while the engine is producing the completion, which is the only
      // window in which interrupting means anything
      onCreate: () => controller.abort(),
    })

    const events = await collect(providerFor(stub).stream(requestFor('hello'), controller.signal))

    expect(stub.interruptGenerate).toHaveBeenCalled()
    expect(events).toEqual([{ type: 'stop', reason: 'aborted' }])
  })

  it('does not call the engine at all when the signal is already aborted', async () => {
    const stub = stubEngine({ responses: [chunksFor('{"tool":"none","reply":"Hi."}')] })

    const events = await collect(providerFor(stub).stream(requestFor('hello'), AbortSignal.abort()))

    expect(stub.requests).toHaveLength(0)
    expect(events).toEqual([{ type: 'stop', reason: 'aborted' }])
  })

  // Gigabytes of VRAM the browser will not reclaim while the tab is open
  it('unloads the model and terminates the worker on dispose', () => {
    const stub = stubEngine({ responses: [] })
    const worker = { terminate: vi.fn() } as unknown as Worker
    const provider = new WebLLMProvider({
      engine: stub.engine,
      model: DEFAULT_WEBLLM_MODEL,
      worker,
    })

    provider.dispose()

    expect(stub.unload).toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalled()
  })
})
