import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentRequest } from '../types'
import {
  fetchHostedStatus,
  HostedProvider,
  HostedTierError,
  hostedMessagesLeft,
  resetHostedStatus,
} from './hosted'

const STATUS = {
  available: true,
  model: 'openai/gpt-oss-120b',
  providerName: 'Groq',
  contextWindow: 8192,
  freeMessages: 2,
}

const REQUEST: AgentRequest = {
  system: 'system',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  tools: [],
  maxTokens: 8192,
}

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response())
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetHostedStatus()
})

describe('fetchHostedStatus', () => {
  it('reads the status the proxy reports', async () => {
    stubFetch(() => Response.json(STATUS))

    expect(await fetchHostedStatus()).toEqual(STATUS)
  })

  // The dev server and a fork's static host answer with the SPA's index.html
  it('finds no free tier where the route serves HTML', async () => {
    stubFetch(() => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }))

    expect(await fetchHostedStatus()).toBeNull()
  })

  it('finds no free tier when the proxy has no key', async () => {
    stubFetch(() => Response.json({ ...STATUS, available: false }))

    expect(await fetchHostedStatus()).toBeNull()
  })

  it('asks once per page', async () => {
    const fetchMock = stubFetch(() => Response.json(STATUS))

    await fetchHostedStatus()
    await fetchHostedStatus()

    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('hostedMessagesLeft', () => {
  it('counts down from the free messages', () => {
    expect(hostedMessagesLeft(STATUS, { used: 0, exhausted: false })).toBe(2)
    expect(hostedMessagesLeft(STATUS, { used: 3, exhausted: false })).toBe(0)
  })

  it('is zero once the proxy said so, whatever the count', () => {
    expect(hostedMessagesLeft(STATUS, { used: 0, exhausted: true })).toBe(0)
  })
})

describe('HostedProvider', () => {
  it('streams a reply from the proxy', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        })
    )

    const events = await collect(new HostedProvider(STATUS).stream(REQUEST))

    expect(events).toContainEqual({ type: 'text_delta', text: 'Hello' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/llm/v1/chat/completions')
  })

  it.each([
    ['free_limit', 429],
    ['busy', 429],
  ] as const)('reports a %s refusal as something the panel can act on', async (code, status) => {
    stubFetch(() => Response.json({ error: { message: 'no', code } }, { status }))

    const error = await collect(new HostedProvider(STATUS).stream(REQUEST)).catch(e => e)

    expect(error).toBeInstanceOf(HostedTierError)
    expect(error.failure).toBe(code)
  })

  it('passes on any other failure with its message', async () => {
    stubFetch(() => Response.json({ error: { message: 'Request too large' } }, { status: 413 }))

    const error = await collect(new HostedProvider(STATUS).stream(REQUEST)).catch(e => e)

    expect(error.failure).toBe('other')
    expect(error.message).toBe('Request too large')
  })
})
