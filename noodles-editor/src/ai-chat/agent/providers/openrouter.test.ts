import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../types'
import { mapOpenRouterEvents, parseSseData } from './openrouter'

// Frames as OpenRouter sends them: one JSON object per `data:` line, keep-alive
// comments interleaved, `[DONE]` last.
function sse(frames: unknown[], { done = true } = {}): string {
  const lines = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`)
  return lines.join('') + (done ? 'data: [DONE]\n\n' : '')
}

function textDelta(content: string) {
  return { choices: [{ delta: { content } }] }
}

function toolDelta(
  index: number,
  fragment: { id?: string; name?: string; arguments?: string }
): unknown {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index,
              ...(fragment.id ? { id: fragment.id } : {}),
              function: {
                ...(fragment.name ? { name: fragment.name } : {}),
                ...(fragment.arguments !== undefined ? { arguments: fragment.arguments } : {}),
              },
            },
          ],
        },
      },
    ],
  }
}

// Re-chunks a stream at a fixed size so frame boundaries land mid-JSON, which is
// what a real socket does and what a naive line-per-chunk parser gets wrong
async function* chunked(body: string, size: number): AsyncIterable<string> {
  for (let i = 0; i < body.length; i += size) {
    yield body.slice(i, i + size)
  }
}

async function collect(body: string, chunkSize = body.length): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of mapOpenRouterEvents(chunked(body, chunkSize))) {
    events.push(event)
  }
  return events
}

describe('parseSseData', () => {
  it('reassembles frames split across chunk boundaries', async () => {
    const body = sse([textDelta('hello'), textDelta(' world')])
    const payloads: string[] = []

    // 7 bytes at a time cuts every frame into pieces
    for await (const data of parseSseData(chunked(body, 7))) payloads.push(data)

    expect(payloads.map(p => JSON.parse(p).choices[0].delta.content)).toEqual(['hello', ' world'])
  })

  it('skips keep-alive comments', async () => {
    const body = `: OPENROUTER PROCESSING\n\n${sse([textDelta('hi')])}`
    const payloads: string[] = []

    for await (const data of parseSseData(chunked(body, 5))) payloads.push(data)

    expect(payloads).toHaveLength(1)
  })

  it('stops at [DONE] without yielding it', async () => {
    const body = `${sse([textDelta('hi')])}data: {"choices":[{"delta":{"content":"after"}}]}\n\n`
    const payloads: string[] = []

    for await (const data of parseSseData(chunked(body, 11))) payloads.push(data)

    expect(payloads).toHaveLength(1)
  })

  it('yields a trailing frame that never got its newline', async () => {
    const payloads: string[] = []

    for await (const data of parseSseData(chunked('data: {"a":1}', 4))) payloads.push(data)

    expect(payloads).toEqual(['{"a":1}'])
  })
})

describe('mapOpenRouterEvents', () => {
  it('streams text deltas through in order', async () => {
    const events = await collect(sse([textDelta('one '), textDelta('two')]))

    expect(events).toEqual([
      { type: 'text_delta', text: 'one ' },
      { type: 'text_delta', text: 'two' },
      { type: 'stop', reason: 'end_turn' },
    ])
  })

  it('reassembles tool-call arguments spread across deltas', async () => {
    const body = sse([
      toolDelta(0, { id: 'call_a', name: 'get_node_info', arguments: '' }),
      toolDelta(0, { arguments: '{"nodeId"' }),
      toolDelta(0, { arguments: ': "/scat' }),
      toolDelta(0, { arguments: 'terplot"}' }),
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])

    const events = await collect(body, 9)

    expect(events).toEqual([
      {
        type: 'tool_call',
        id: 'call_a',
        name: 'get_node_info',
        input: { nodeId: '/scatterplot' },
      },
      { type: 'stop', reason: 'tool_use' },
    ])
  })

  it('keeps two concurrent tool calls separate, in index order', async () => {
    // Deltas for both calls interleave, which is what silently concatenates the
    // two argument strings if they are not kept apart by index
    const body = sse([
      toolDelta(0, { id: 'call_a', name: 'get_node_info', arguments: '{"nodeId":' }),
      toolDelta(1, { id: 'call_b', name: 'get_node_output', arguments: '{"nodeId":' }),
      toolDelta(0, { arguments: '"/a"}' }),
      toolDelta(1, { arguments: '"/b"}' }),
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])

    const events = await collect(body, 13)

    expect(events.slice(0, 2)).toEqual([
      { type: 'tool_call', id: 'call_a', name: 'get_node_info', input: { nodeId: '/a' } },
      { type: 'tool_call', id: 'call_b', name: 'get_node_output', input: { nodeId: '/b' } },
    ])
  })

  it('emits empty input rather than failing on unparseable arguments', async () => {
    const body = sse([
      toolDelta(0, { id: 'call_a', name: 'list_nodes', arguments: '{"broken' }),
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])

    const events = await collect(body)

    expect(events[0]).toEqual({
      type: 'tool_call',
      id: 'call_a',
      name: 'list_nodes',
      input: {},
    })
  })

  it('reports usage and cost from the final chunk', async () => {
    const body = sse([
      textDelta('hi'),
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 80,
          cost: 0.0031,
          prompt_tokens_details: { cached_tokens: 900 },
        },
      },
    ])

    const events = await collect(body, 17)

    expect(events.at(-2)).toEqual({
      type: 'usage',
      usage: { inputTokens: 1200, outputTokens: 80, cachedInputTokens: 900, costUsd: 0.0031 },
    })
  })

  it('carries reasoning back as a provider block, ahead of the tool call', async () => {
    const body = sse([
      { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'think' }] } }] },
      toolDelta(0, { id: 'call_a', name: 'list_nodes', arguments: '{}' }),
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])

    const events = await collect(body)

    expect(events[0]).toEqual({
      type: 'provider_block',
      provider: 'openrouter',
      block: [{ type: 'reasoning.text', text: 'think' }],
    })
    expect(events[1]).toMatchObject({ type: 'tool_call' })
  })

  it('maps a truncated response to max_tokens', async () => {
    const events = await collect(
      sse([textDelta('cut'), { choices: [{ finish_reason: 'length' }] }])
    )

    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'max_tokens' })
  })

  it('throws when the stream carries an error frame', async () => {
    const body = sse([{ error: { message: 'rate limited', code: 429 } }])

    await expect(collect(body)).rejects.toThrow('rate limited')
  })

  it('ignores a malformed frame instead of failing the turn', async () => {
    const body = `data: not json\n\n${sse([textDelta('recovered')])}`

    const events = await collect(body)

    expect(events).toEqual([
      { type: 'text_delta', text: 'recovered' },
      { type: 'stop', reason: 'end_turn' },
    ])
  })
})
