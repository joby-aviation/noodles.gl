import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRequest } from '../types'
import { CustomProvider, normalizeBaseUrl, validateCustomEndpoint } from './custom'

afterEach(() => {
  vi.unstubAllGlobals()
})

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    system: 'be brief',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [],
    maxTokens: 256,
    ...overrides,
  }
}

// Captures what was sent rather than what came back: the point of this provider
// is the request it builds, since the response path is openai-format's.
function stubFetch(response: Response) {
  const fetchMock = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${frame}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

async function drain(provider: CustomProvider, req = request()) {
  const events = []
  for await (const event of provider.stream(req)) events.push(event)
  return events
}

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.groq.com/openai/v1/')).toBe(
      'https://api.groq.com/openai/v1'
    )
    expect(normalizeBaseUrl('https://api.groq.com/openai/v1///')).toBe(
      'https://api.groq.com/openai/v1'
    )
  })

  it('assumes https when no scheme is given', () => {
    expect(normalizeBaseUrl('api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })

  it('leaves an explicit http scheme alone, since localhost servers use it', () => {
    expect(normalizeBaseUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1')
  })

  it('is empty for empty input', () => {
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

describe('CustomProvider request', () => {
  it('posts to chat/completions under the configured base URL', async () => {
    const fetchMock = stubFetch(sseResponse(['{"choices":[{"delta":{"content":"hi"}}]}']))
    const provider = new CustomProvider({
      baseUrl: 'http://localhost:1234/v1/',
      apiKey: 'key',
      model: 'local-model',
    })

    await drain(provider)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:1234/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key')
  })

  it('asks for usage the OpenAI way, not the OpenRouter way', async () => {
    const fetchMock = stubFetch(sseResponse(['{"choices":[{"delta":{"content":"hi"}}]}']))
    const provider = new CustomProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key',
      model: 'gpt-4o',
    })

    await drain(provider)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.stream_options).toEqual({ include_usage: true })
    expect(body.usage).toBeUndefined()
    expect(body.model).toBe('gpt-4o')
  })

  it('omits tools when the endpoint is known not to support them', async () => {
    const fetchMock = stubFetch(sseResponse(['{"choices":[{"delta":{"content":"hi"}}]}']))
    const provider = new CustomProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'key',
      model: 'tiny',
      supportsNativeTools: false,
    })

    await drain(
      provider,
      request({
        tools: [
          {
            name: 'list_nodes',
            description: 'list',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      })
    )

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).tools).toBeUndefined()
  })

  it('names the endpoint when the request cannot leave the browser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    const provider = new CustomProvider({
      baseUrl: 'https://typo.test/v1',
      apiKey: 'key',
      model: 'm',
    })

    await expect(drain(provider)).rejects.toThrow(/typo\.test\/v1\/chat\/completions/)
    await expect(drain(provider)).rejects.toThrow(/CORS/)
  })

  it('reports a server error with the server’s own message', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 })
    )
    const provider = new CustomProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'key',
      model: 'nope',
    })

    await expect(drain(provider)).rejects.toThrow('Endpoint 404: model not found')
  })

  it('defaults to a window small enough for a self-hosted model', () => {
    const provider = new CustomProvider({ baseUrl: 'https://e.test/v1', apiKey: 'k', model: 'm' })

    expect(provider.contextWindow).toBe(32_768)
    expect(provider.id).toBe('custom')
  })
})

describe('validateCustomEndpoint', () => {
  it('reports the model ids the server advertises', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ data: [{ id: 'llama-3.1-70b' }, { id: 'mixtral' }] }), {
        status: 200,
      })
    )

    const result = await validateCustomEndpoint('https://api.groq.com/openai/v1/', 'key')

    expect(result).toEqual({ ok: true, models: ['llama-3.1-70b', 'mixtral'] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/models')
  })

  it('accepts a server that answers 200 without a catalogue', async () => {
    stubFetch(new Response('ok', { status: 200 }))

    expect(await validateCustomEndpoint('https://e.test/v1', 'key')).toEqual({
      ok: true,
      models: undefined,
    })
  })

  it('fails with the status when the key is rejected', async () => {
    stubFetch(new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }))

    const result = await validateCustomEndpoint('https://e.test/v1', 'wrong')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Endpoint 401: bad key')
  })

  it('explains an unreachable host rather than passing on “Failed to fetch”', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )

    const result = await validateCustomEndpoint('https://nope.test/v1', 'key')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('https://nope.test/v1/models')
    expect(result.error).toContain('CORS')
  })
})
