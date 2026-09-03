// The web_search tool.
//
// Both providers that support it do the searching server-side, so this is a
// one-shot completion with search switched on rather than a search API call:
// send the query, get back prose plus citations. That shape is why it is a
// harness tool instead of an MCPTools method — it needs a provider and a key,
// which the tool definitions have no access to.
//
// Chrome has no equivalent, so there createWebSearchTool returns null and
// find_tools never offers it.

import Anthropic from '@anthropic-ai/sdk'
import type { ToolResult } from '../types'
import type { HarnessTool } from './tool-router'
import type { ProviderId } from './types'

export const WEB_SEARCH_NAME = 'web_search'

const MAX_TOKENS = 2048
const DEFAULT_MAX_RESULTS = 3

const DESCRIPTION =
  'Search the web and return an answer with source links. Use this for anything outside the Noodles.gl codebase and docs: dataset formats, public data sources, deck.gl or MapLibre upstream behaviour, current events. Costs a fraction of a cent per call, so prefer get_documentation and search_code for questions about Noodles.gl itself.'

const INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: { type: 'string', description: 'What to search for, phrased as a question' },
    maxResults: { type: 'number', description: 'Maximum sources to consult (default 3)' },
  },
  required: ['query'],
}

export type WebSearchConfig =
  | { provider: 'anthropic'; apiKey: string; model: string }
  | { provider: 'openrouter'; apiKey: string; model: string }
  // Present so a new provider has to decide explicitly rather than inherit a
  // search path that does not work
  | { provider: 'chrome' }

export interface WebSearchAnswer {
  answer: string
  citations: Array<{ url: string; title?: string }>
}

export function createWebSearchTool(config: WebSearchConfig): HarnessTool | null {
  if (config.provider === 'chrome') return null

  return {
    name: WEB_SEARCH_NAME,
    description: DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    readOnly: true,
    execute: input => runWebSearch(config, input),
  }
}

async function runWebSearch(
  config: Exclude<WebSearchConfig, { provider: 'chrome' }>,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) return { success: false, error: 'web_search requires a non-empty query' }

  const maxResults = clampResults(input.maxResults)

  try {
    const answer =
      config.provider === 'anthropic'
        ? await searchViaAnthropic(config, query, maxResults)
        : await searchViaOpenRouter(config, query, maxResults)

    if (!answer.answer.trim() && answer.citations.length === 0) {
      return { success: false, error: `No web results for "${query}"` }
    }

    return { success: true, data: { query, ...answer } }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Web search failed',
    }
  }
}

function clampResults(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS
  return Math.max(1, Math.min(8, Math.floor(value)))
}

// Anthropic's search runs inside a normal messages call: the model issues
// server_tool_use, the server searches, and the results come back in the same
// response as web_search_tool_result blocks.
async function searchViaAnthropic(
  config: { apiKey: string; model: string },
  query: string,
  maxResults: number
): Promise<WebSearchAnswer> {
  const client = new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true })

  const message = await client.messages.create({
    model: config.model,
    max_tokens: MAX_TOKENS,
    tools: [
      {
        type: webSearchToolType(config.model),
        name: 'web_search',
        max_uses: maxResults,
      } as Anthropic.ToolUnion,
    ],
    messages: [{ role: 'user', content: query }],
  })

  const citations = new Map<string, { url: string; title?: string }>()
  let answer = ''

  for (const block of message.content) {
    if (block.type === 'text') {
      answer += block.text
      for (const citation of block.citations ?? []) {
        if (citation.type === 'web_search_result_location') {
          citations.set(citation.url, { url: citation.url, title: citation.title ?? undefined })
        }
      }
    }
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) {
        citations.set(result.url, { url: result.url, title: result.title ?? undefined })
      }
    }
  }

  return { answer, citations: [...citations.values()] }
}

// The 2026 search tool is not available on every model — Haiku 4.5 and older
// still take the 2025 one, and sending the wrong version is a 400.
function webSearchToolType(model: string): 'web_search_20260209' | 'web_search_20250305' {
  const modern = /claude-(opus-(5|4-8|4-7|4-6)|sonnet-(5|4-6))/
  return modern.test(model) ? 'web_search_20260209' : 'web_search_20250305'
}

// OpenRouter normalises every model's search results into url_citation
// annotations, so this path does not vary by model.
async function searchViaOpenRouter(
  config: { apiKey: string; model: string },
  query: string,
  maxResults: number
): Promise<WebSearchAnswer> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin,
      'X-Title': 'Noodles.gl',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: query }],
      plugins: [{ id: 'web', max_results: maxResults }],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter web search ${response.status} ${response.statusText}`)
  }

  return parseOpenRouterAnswer(await response.json())
}

interface OpenRouterCompletion {
  choices?: Array<{
    message?: {
      content?: string | null
      annotations?: Array<{
        type?: string
        url_citation?: { url?: string; title?: string }
      }>
    }
  }>
}

// Exported for tests: the annotation shape is the only part of this worth
// pinning down, and it is not worth a live search to check it.
export function parseOpenRouterAnswer(body: unknown): WebSearchAnswer {
  const message = (body as OpenRouterCompletion).choices?.[0]?.message
  const citations = new Map<string, { url: string; title?: string }>()

  for (const annotation of message?.annotations ?? []) {
    const url = annotation.url_citation?.url
    if (annotation.type === 'url_citation' && url) {
      citations.set(url, { url, title: annotation.url_citation?.title })
    }
  }

  return { answer: message?.content ?? '', citations: [...citations.values()] }
}

// Which config a provider needs, given the keys on hand. Returns null when the
// provider cannot search at all or the key for it is missing.
export function webSearchConfigFor(params: {
  providerId: ProviderId
  model: string
  anthropicKey?: string
  openRouterKey?: string
}): WebSearchConfig | null {
  if (params.providerId === 'chrome') return null
  if (params.providerId === 'anthropic') {
    return params.anthropicKey
      ? { provider: 'anthropic', apiKey: params.anthropicKey, model: params.model }
      : null
  }
  return params.openRouterKey
    ? { provider: 'openrouter', apiKey: params.openRouterKey, model: params.model }
    : null
}
