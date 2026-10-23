// Runs the in-app assistant's Anthropic provider on Bedrock: the page's requests to the
// Anthropic Messages API are caught in the browser context and answered from Node through
// Bedrock, so the assistant runs its own Anthropic code unchanged and AWS credentials never
// reach the page.
//
// Playwright fulfills a request in one piece, so the streamed reply is collected and sent whole.
// The page parses it as the same SSE stream, but the time to first token it records is the time
// to the whole reply.

import type { BrowserContext, Request, Route } from 'playwright'

// What the proxy needs of the Bedrock client: a streamed messages.create
export interface StreamingClient {
  messages: {
    create(body: Record<string, unknown>): Promise<AsyncIterable<{ type: string }>>
  }
}

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages**'

// The page's origin may call api.anthropic.com only if the answer says so
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
}

// `claude-sonnet-5` -> `us.anthropic.claude-sonnet-5`; a Bedrock id or profile ARN as given
export function bedrockModel(model: string, prefix = 'us.anthropic.'): string {
  return model.includes('.') || model.includes(':') ? model : `${prefix}${model}`
}

// Stream events as the Messages API sends them
export function sseBody(events: { type: string }[]): string {
  return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

// A failed call as the Messages API reports one, so the page's SDK raises the same error
export function errorReply(error: unknown): { status: number; body: string } {
  const e = error as { status?: number; message?: string }
  const status = typeof e?.status === 'number' && e.status >= 400 ? e.status : 500
  return {
    status,
    body: JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: `Bedrock: ${e?.message ?? String(error)}` },
    }),
  }
}

// Answer one intercepted request from Bedrock
export async function answer(
  request: Pick<Request, 'method' | 'postData'>,
  client: StreamingClient,
  modelPrefix?: string
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  if (request.method() === 'OPTIONS') return { status: 204, headers: CORS, body: '' }
  try {
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
    const stream = await client.messages.create({
      ...body,
      model: bedrockModel(String(body.model ?? ''), modelPrefix),
      stream: true,
    })
    const events: { type: string }[] = []
    for await (const event of stream) events.push(event)
    return {
      status: 200,
      headers: { ...CORS, 'content-type': 'text/event-stream' },
      body: sseBody(events),
    }
  } catch (error) {
    const reply = errorReply(error)
    return { ...reply, headers: { ...CORS, 'content-type': 'application/json' } }
  }
}

// Route every Anthropic Messages request the context makes to Bedrock
export async function routeAnthropicToBedrock(
  context: BrowserContext,
  client: StreamingClient,
  modelPrefix?: string
): Promise<void> {
  await context.route(MESSAGES_URL, async (route: Route) => {
    await route.fulfill(await answer(route.request(), client, modelPrefix))
  })
}

// The Bedrock client, from the default AWS chain (AWS_PROFILE, SSO, env keys) and AWS_REGION
export async function bedrockClient(): Promise<StreamingClient> {
  const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
  return new AnthropicBedrock({
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  }) as unknown as StreamingClient
}
