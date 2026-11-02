// The hosted free tier for the in-app assistant: a Cloudflare Pages Function that
// forwards the assistant's chat-completions requests to an OpenAI-compatible
// provider (Groq by default) with a key the browser never sees.
//
//   GET  /api/llm/status                  whether the tier is on, and its limits
//   POST /api/llm/v1/chat/completions     the proxied request, streamed back
//
// It is meant to get a new user to a first answer without any setup, so it only
// serves the Noodles.gl assistant, and only for a couple of messages:
//
// - The system prompt has to start with the assistant's own core prompt, checked
//   against a fingerprint rather than a copy so this file needs no Markdown
//   loader. hosted-llm.test.ts in the editor fails when core.md changes.
// - At most FREE_MESSAGES user messages per conversation. History travels with
//   every request, so this needs no storage.
// - Browser requests from this site or an allowed origin only, with caps on body
//   size, message count and output tokens, and the model chosen here rather than
//   by the client. noodles.gl itself is served by GitHub Pages, where Functions do
//   not run, so the editor there calls noodles-gl.pages.dev across origins.
// - Optionally a per-IP daily request cap, when a KV namespace is bound as
//   LLM_LIMITS. Without it the provider's own quota is the backstop.
//
// Configured in the Pages project's settings:
//   HOSTED_LLM_API_KEY   secret; without it the tier reports itself unavailable
//   HOSTED_LLM_BASE_URL  default https://api.groq.com/openai/v1
//   HOSTED_LLM_MODEL     default openai/gpt-oss-120b
//   HOSTED_LLM_PROVIDER_NAME  shown to users as where their messages go; default
//                        Groq, or the base URL's host when that is overridden
//   HOSTED_LLM_ALLOWED_ORIGINS  comma-separated origins besides this site's own;
//                        default https://noodles.gl

export const CORE_PROMPT_FINGERPRINT = {
  length: 2914,
  sha256: '7c3e15867ddc8622ef351e1cdf63581c93ab5951ac3cfbdad871eba8d210791f',
}

export const FREE_MESSAGES = 2
// Groq's free tier allows 8K tokens a minute, and one request larger than that is
// rejected outright, so the client sizes its context to fit under it
export const CONTEXT_WINDOW = 8192
const MAX_OUTPUT_TOKENS = 1024
const MAX_BODY_BYTES = 256 * 1024
const MAX_SYSTEM_CHARS = 32_000
const MAX_MESSAGES = 80
const MAX_TOOLS = 64
const DAILY_REQUESTS_PER_IP = 60
// An agent turn makes several requests in a row, which can trip a per-minute
// token limit halfway through. Waiting it out beats failing the turn.
const MAX_RATE_LIMIT_RETRIES = 2
const MAX_RETRY_WAIT_SECONDS = 15

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const DEFAULT_ALLOWED_ORIGINS = 'https://noodles.gl'

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export interface HostedLlmEnv {
  HOSTED_LLM_API_KEY?: string
  HOSTED_LLM_BASE_URL?: string
  HOSTED_LLM_MODEL?: string
  HOSTED_LLM_PROVIDER_NAME?: string
  HOSTED_LLM_ALLOWED_ORIGINS?: string
  LLM_LIMITS?: KVNamespace
}

export interface HostedLlmDeps {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
}

const defaultDeps: HostedLlmDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

export const onRequest = (context: { request: Request; env: HostedLlmEnv }) =>
  handleHostedLlm(context.request, context.env)

export async function handleHostedLlm(
  request: Request,
  env: HostedLlmEnv,
  deps: HostedLlmDeps = defaultDeps
): Promise<Response> {
  const origin = request.headers.get('Origin')
  const allowed = origin !== null && isAllowedOrigin(origin, request.url, env)

  // A JSON POST from another origin is preflighted
  if (request.method === 'OPTIONS') {
    if (!allowed) return error(403, 'The free tier only serves the Noodles.gl editor')
    return withCors(new Response(null, { status: 204 }), origin, {
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    })
  }

  const response = await route(request, env, deps, allowed)
  return allowed ? withCors(response, origin) : response
}

async function route(
  request: Request,
  env: HostedLlmEnv,
  deps: HostedLlmDeps,
  allowedOrigin: boolean
): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '')

  if (path === '/api/llm/status' && request.method === 'GET') {
    return json(200, {
      available: Boolean(env.HOSTED_LLM_API_KEY),
      model: env.HOSTED_LLM_MODEL || DEFAULT_MODEL,
      providerName: providerName(env),
      contextWindow: CONTEXT_WINDOW,
      freeMessages: FREE_MESSAGES,
    })
  }

  if (path === '/api/llm/v1/chat/completions') {
    if (request.method !== 'POST') return error(405, 'Use POST')
    // Browsers always send Origin on a POST, so a missing or foreign one is a
    // script calling this directly
    if (!allowedOrigin) return error(403, 'The free tier only serves the Noodles.gl editor')
    return proxyCompletion(request, env, deps)
  }

  return error(404, 'Not found')
}

async function proxyCompletion(
  request: Request,
  env: HostedLlmEnv,
  deps: HostedLlmDeps
): Promise<Response> {
  if (!env.HOSTED_LLM_API_KEY) return error(503, 'The free tier is not set up on this site')

  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return error(413, 'The conversation is too long for the free tier')
  }

  let body: CompletionBody
  try {
    body = JSON.parse(text)
  } catch {
    return error(400, 'The request is not JSON')
  }

  const problem = await checkBody(body)
  if (problem) return problem

  const ip = request.headers.get('CF-Connecting-IP')
  if (env.LLM_LIMITS && ip && !(await withinDailyLimit(env.LLM_LIMITS, ip))) {
    return error(429, 'The free tier limit for today is used up', 'free_limit')
  }

  // Built from named fields, so nothing the client adds reaches the provider
  const upstreamBody = JSON.stringify({
    model: env.HOSTED_LLM_MODEL || DEFAULT_MODEL,
    messages: body.messages,
    ...(body.tools?.length ? { tools: body.tools } : {}),
    max_tokens: Math.min(Number(body.max_tokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
    stream: true,
    stream_options: { include_usage: true },
  })
  const baseUrl = (env.HOSTED_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')

  for (let attempt = 0; ; attempt++) {
    let upstream: Response
    try {
      upstream = await deps.fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.HOSTED_LLM_API_KEY}`,
        },
        body: upstreamBody,
        signal: request.signal,
      })
    } catch {
      return error(502, 'Could not reach the free tier provider')
    }

    if (upstream.status === 429) {
      const wait = retryAfterSeconds(upstream)
      if (attempt < MAX_RATE_LIMIT_RETRIES && wait <= MAX_RETRY_WAIT_SECONDS) {
        await upstream.body?.cancel()
        await deps.sleep(wait * 1000)
        continue
      }
      return error(429, 'The free tier is busy right now', 'busy')
    }

    if (!upstream.ok || !upstream.body) {
      // The provider's own message says what was wrong with the request; its
      // headers, which can carry account details, stay here
      return error(upstream.status || 502, await upstreamMessage(upstream))
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/event-stream',
        'Cache-Control': 'no-store',
      },
    })
  }
}

interface CompletionBody {
  messages?: Array<{ role?: unknown; content?: unknown }>
  tools?: unknown[]
  max_tokens?: unknown
}

async function checkBody(body: CompletionBody): Promise<Response | null> {
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > MAX_MESSAGES) {
    return error(400, 'The request has no conversation, or too long a one')
  }
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > MAX_TOOLS)) {
    return error(400, 'Too many tools')
  }

  const [system, ...rest] = messages
  if (
    system?.role !== 'system' ||
    typeof system.content !== 'string' ||
    system.content.length > MAX_SYSTEM_CHARS ||
    !(await startsWithCorePrompt(system.content)) ||
    rest.some(message => message?.role === 'system')
  ) {
    return error(403, 'The free tier only serves the Noodles.gl assistant')
  }

  const userMessages = rest.filter(message => message?.role === 'user').length
  if (userMessages > FREE_MESSAGES) {
    return error(
      429,
      `The free tier covers ${FREE_MESSAGES} messages per conversation`,
      'free_limit'
    )
  }

  return null
}

async function startsWithCorePrompt(system: string): Promise<boolean> {
  const { length, sha256 } = CORE_PROMPT_FINGERPRINT
  if (system.length < length) return false
  return (await sha256Hex(system.slice(0, length))) === sha256
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

// KV is eventually consistent, so two requests at once can both read the old
// count. That lets a burst through by a request or two, which is fine for a cap
// whose job is to stop a script, not to bill anyone.
async function withinDailyLimit(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `ip:${ip}:${new Date().toISOString().slice(0, 10)}`
  const count = Number(await kv.get(key)) || 0
  if (count >= DAILY_REQUESTS_PER_IP) return false
  await kv.put(key, String(count + 1), { expirationTtl: 2 * 24 * 60 * 60 })
  return true
}

function retryAfterSeconds(response: Response): number {
  const header = response.headers.get('Retry-After')
  const seconds = header ? Number(header) : Number.NaN
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : MAX_RETRY_WAIT_SECONDS
}

async function upstreamMessage(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch {
    // Not JSON
  }
  return 'The free tier provider returned an error'
}

function providerName(env: HostedLlmEnv): string {
  if (env.HOSTED_LLM_PROVIDER_NAME) return env.HOSTED_LLM_PROVIDER_NAME
  if (!env.HOSTED_LLM_BASE_URL) return 'Groq'
  try {
    return new URL(env.HOSTED_LLM_BASE_URL).host
  } catch {
    return 'the free tier provider'
  }
}

function isAllowedOrigin(origin: string, url: string, env: HostedLlmEnv): boolean {
  let host: string
  try {
    host = new URL(origin).host
    if (host === new URL(url).host) return true
  } catch {
    return false
  }
  const allowed = (env.HOSTED_LLM_ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map(entry => entry.trim().replace(/\/+$/, ''))
  return allowed.includes(origin.replace(/\/+$/, ''))
}

function withCors(
  response: Response,
  origin: string | null,
  extra: Record<string, string> = {}
): Response {
  if (!origin) return response
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.append('Vary', 'Origin')
  for (const [name, value] of Object.entries(extra)) response.headers.set(name, value)
  return response
}

// The shape openai-format.ts's describeFailure reads, plus a code the client
// uses to tell "out of free messages" from other failures
function error(status: number, message: string, code?: string): Response {
  return json(status, { error: { message, ...(code ? { code } : {}) } })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
