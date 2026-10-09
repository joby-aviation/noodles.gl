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
  // One entry per create() call; an Error rejects instead of streaming
  responses: Array<Chunk[] | Error>
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
    if (response instanceof Error) throw response
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

  it('turns a JSON action into a tool call', async () => {
    const action = '{"tool":"get_node_info","input":{"nodeId":"/viewer"},"reply":"Checking."}'
    const stub = stubEngine({ responses: [chunksFor(action)] })

    const events = await collect(providerFor(stub).stream(requestFor('what is /viewer')))

    expect(events).toEqual([
      { type: 'text_delta', text: 'Checking.' },
      { type: 'tool_call', id: 'webllm_1', name: 'get_node_info', input: { nodeId: '/viewer' } },
      { type: 'stop', reason: 'tool_use' },
    ])
  })

  it('ends the turn when the action names no tool', async () => {
    const stub = stubEngine({
      responses: [chunksFor('{"tool":"none","reply":"There are 4 nodes."}')],
    })

    const events = await collect(providerFor(stub).stream(requestFor('how many nodes')))

    expect(events).toEqual([
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
      { type: 'text_delta', text: 'Trimmed.' },
      { type: 'stop', reason: 'end_turn' },
    ])

    const first = stub.requests[0].messages as unknown[]
    const second = stub.requests[1].messages as unknown[]
    expect(second.length).toBeLessThan(first.length)
  })

  it('does not retry an error that is not an overflow', async () => {
    const stub = stubEngine({ responses: [new Error('WebGPU device lost')] })

    await expect(collect(providerFor(stub).stream(requestFor('hello')))).rejects.toThrow(
      'WebGPU device lost'
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
