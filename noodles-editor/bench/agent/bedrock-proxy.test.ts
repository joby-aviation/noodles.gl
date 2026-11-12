import { describe, expect, it } from 'vitest'
import { answer, bedrockModel, errorReply, type StreamingClient, sseBody } from './bedrock-proxy'

const request = (body: object, method = 'POST') => ({
  method: () => method,
  postData: () => JSON.stringify(body),
})

// A client that records what it was sent and streams the given events
function fakeClient(events: { type: string }[], fail?: Error) {
  const sent: Record<string, unknown>[] = []
  const client: StreamingClient = {
    messages: {
      async create(body) {
        sent.push(body)
        if (fail) throw fail
        return (async function* () {
          yield* events
        })()
      },
    },
  }
  return { client, sent }
}

describe('bedrock proxy', () => {
  it('maps API model names to Bedrock profiles and keeps Bedrock ids', () => {
    expect(bedrockModel('claude-sonnet-5')).toBe('us.anthropic.claude-sonnet-5')
    expect(bedrockModel('claude-sonnet-5', 'eu.anthropic.')).toBe('eu.anthropic.claude-sonnet-5')
    expect(bedrockModel('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(
      'us.anthropic.claude-haiku-4-5-20251001-v1:0'
    )
  })

  it('streams the reply back as the Messages API would', async () => {
    const events = [{ type: 'message_start' }, { type: 'message_stop' }]
    const { client, sent } = fakeClient(events)
    const reply = await answer(
      request({ model: 'claude-sonnet-5', max_tokens: 10, stream: false }),
      client
    )
    expect(sent[0]).toMatchObject({
      model: 'us.anthropic.claude-sonnet-5',
      max_tokens: 10,
      stream: true,
    })
    expect(reply.status).toBe(200)
    expect(reply.headers['content-type']).toBe('text/event-stream')
    expect(reply.body).toBe(sseBody(events))
    expect(reply.body).toContain('event: message_start\ndata: {"type":"message_start"}\n\n')
  })

  it('answers a CORS preflight without calling Bedrock', async () => {
    const { client, sent } = fakeClient([])
    const reply = await answer(request({}, 'OPTIONS'), client)
    expect(reply.status).toBe(204)
    expect(reply.headers['access-control-allow-origin']).toBe('*')
    expect(sent).toHaveLength(0)
  })

  it('reports a Bedrock failure as an API error with its status', async () => {
    const denied = Object.assign(new Error('not authorized'), { status: 403 })
    const reply = await answer(request({ model: 'm' }), fakeClient([], denied).client)
    expect(reply.status).toBe(403)
    expect(JSON.parse(reply.body).error.message).toBe('Bedrock: not authorized')
    expect(errorReply(new Error('offline')).status).toBe(500)
  })
})
