// The hosted free tier: a couple of messages through noodles.gl's own proxy
// (functions/api/llm), so a new user gets a first answer before setting anything
// up. The proxy holds the key and pins the model; this side only needs to know
// whether the tier exists here and how many messages are left.
//
// Same wire format as a custom endpoint, so the stream goes through
// openai-format.ts. What differs is failure: the proxy says why it refused, and
// "out of free messages" has to reach the panel as something it can act on rather
// than as an error string.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentEvent, AgentProvider, AgentRequest } from '../types'
import { decodeChunks, isAbort, mapOpenAiEvents, toWireMessages, toWireTool } from './openai-format'

// noodles.gl is served by GitHub Pages, which runs no Functions, so the editor
// there calls the Cloudflare Pages deployment that does. Previews and pages.dev
// serve the proxy themselves.
function apiUrl(path: string): string {
  const origin = window.location.hostname === 'noodles.gl' ? 'https://noodles-gl.pages.dev' : ''
  return `${origin}/api/llm${path}`
}

export interface HostedStatus {
  available: boolean
  model: string
  // Where the messages go, for the panel to say so
  providerName: string
  contextWindow: number
  freeMessages: number
}

export type HostedFailure = 'free_limit' | 'busy' | 'other'

export class HostedTierError extends Error {
  readonly failure: HostedFailure

  constructor(failure: HostedFailure, message: string) {
    super(message)
    this.name = 'HostedTierError'
    this.failure = failure
  }
}

let statusRequest: Promise<HostedStatus | null> | null = null
let cachedStatus: HostedStatus | null = null

// Asked once per page. Off the deployed site (the dev server, a fork's static
// host) the route does not exist and the SPA fallback answers with HTML, so
// anything that is not the status JSON means there is no free tier here.
export function fetchHostedStatus(): Promise<HostedStatus | null> {
  statusRequest ??= (async () => {
    try {
      const response = await fetch(apiUrl('/status'), { headers: { Accept: 'application/json' } })
      if (!response.ok || !response.headers.get('Content-Type')?.includes('json')) return null
      const status = (await response.json()) as Partial<HostedStatus>
      if (status.available !== true || typeof status.model !== 'string') return null
      cachedStatus = {
        available: true,
        model: status.model,
        providerName: status.providerName ?? 'the free tier provider',
        contextWindow: status.contextWindow ?? 8192,
        freeMessages: status.freeMessages ?? 2,
      }
      return cachedStatus
    } catch {
      return null
    }
  })()
  return statusRequest
}

export function getCachedHostedStatus(): HostedStatus | null {
  return cachedStatus
}

// For tests
export function resetHostedStatus(): void {
  statusRequest = null
  cachedStatus = null
}

interface HostedUsageState {
  // Messages answered on the free tier in this browser, across conversations
  used: number
  // Set when the proxy refused for being out of messages, whatever the count says
  exhausted: boolean
  recordMessage: () => void
  markExhausted: () => void
}

export const useHostedUsageStore = create<HostedUsageState>()(
  persist(
    set => ({
      used: 0,
      exhausted: false,
      recordMessage: () => set(state => ({ used: state.used + 1 })),
      markExhausted: () => set({ exhausted: true }),
    }),
    { name: 'noodles-hosted-tier', partialize: ({ used, exhausted }) => ({ used, exhausted }) }
  )
)

export function hostedMessagesLeft(
  status: HostedStatus | null,
  usage: Pick<HostedUsageState, 'used' | 'exhausted'>
): number {
  if (!status || usage.exhausted) return 0
  return Math.max(0, status.freeMessages - usage.used)
}

export class HostedProvider implements AgentProvider {
  readonly id = 'hosted' as const
  readonly model: string
  readonly supportsNativeTools = true
  readonly supportsImages = false
  readonly contextWindow: number

  constructor(status: HostedStatus) {
    this.model = status.model
    this.contextWindow = status.contextWindow
  }

  async *stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (signal?.aborted) {
      yield { type: 'stop', reason: 'aborted' }
      return
    }

    let response: Response
    try {
      response = await fetch(apiUrl('/v1/chat/completions'), {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        // The proxy picks the model and caps the output; sending them anyway keeps
        // the body the same shape as any other OpenAI-compatible request
        body: JSON.stringify({
          model: this.model,
          messages: toWireMessages(request, 'hosted'),
          ...(request.tools.length > 0 ? { tools: request.tools.map(toWireTool) } : {}),
          max_tokens: request.maxTokens,
          stream: true,
        }),
      })
    } catch (error) {
      if (isAbort(error, signal)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      throw new HostedTierError('other', 'Could not reach the free tier')
    }

    if (!response.ok || !response.body) throw await toHostedError(response)

    try {
      yield* mapOpenAiEvents(decodeChunks(response.body, signal), 'hosted')
    } catch (error) {
      if (isAbort(error, signal)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      throw error
    }
  }
}

async function toHostedError(response: Response): Promise<HostedTierError> {
  let message = `The free tier returned ${response.status}`
  let code: unknown
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string } }
    message = body.error?.message ?? message
    code = body.error?.code
  } catch {
    // Not JSON; the status is all there is
  }
  const failure: HostedFailure = code === 'free_limit' || code === 'busy' ? code : 'other'
  return new HostedTierError(failure, message)
}
