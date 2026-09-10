import { describe, expect, it } from 'vitest'
import {
  createWebSearchTool,
  parseOpenRouterAnswer,
  webSearchConfigFor,
  webSearchToolType,
} from './web-search'

describe('webSearchToolType', () => {
  it('picks the 2026 tool for models that have it', () => {
    expect(webSearchToolType('claude-sonnet-5')).toBe('web_search_20260209')
    expect(webSearchToolType('claude-opus-5')).toBe('web_search_20260209')
  })

  it('falls back to the 2025 tool everywhere else', () => {
    // Sending 20260209 to Haiku 4.5 is a 400, so this branch is load-bearing
    expect(webSearchToolType('claude-haiku-4-5-20251001')).toBe('web_search_20250305')
    expect(webSearchToolType('claude-sonnet-4-5-20250929')).toBe('web_search_20250305')
  })
})

describe('parseOpenRouterAnswer', () => {
  it('reads text and url_citation annotations', () => {
    const answer = parseOpenRouterAnswer({
      choices: [
        {
          message: {
            content: 'GeoParquet is a columnar format.',
            annotations: [
              { type: 'url_citation', url_citation: { url: 'https://a.dev', title: 'A' } },
              { type: 'url_citation', url_citation: { url: 'https://b.dev' } },
            ],
          },
        },
      ],
    })

    expect(answer).toEqual({
      answer: 'GeoParquet is a columnar format.',
      citations: [
        { url: 'https://a.dev', title: 'A' },
        { url: 'https://b.dev', title: undefined },
      ],
    })
  })

  it('deduplicates repeated urls and skips other annotation types', () => {
    const answer = parseOpenRouterAnswer({
      choices: [
        {
          message: {
            content: 'text',
            annotations: [
              { type: 'url_citation', url_citation: { url: 'https://a.dev', title: 'first' } },
              { type: 'url_citation', url_citation: { url: 'https://a.dev', title: 'second' } },
              { type: 'file', url_citation: { url: 'https://c.dev' } },
              { type: 'url_citation' },
            ],
          },
        },
      ],
    })

    expect(answer.citations).toEqual([{ url: 'https://a.dev', title: 'second' }])
  })

  it('returns empty rather than throwing on an unexpected body', () => {
    expect(parseOpenRouterAnswer({})).toEqual({ answer: '', citations: [] })
  })
})

describe('createWebSearchTool', () => {
  it('is unavailable on chrome', () => {
    expect(createWebSearchTool({ provider: 'chrome' })).toBeNull()
  })

  it('is read-only, so it can batch with other lookups', () => {
    const tool = createWebSearchTool({ provider: 'openrouter', apiKey: 'k', model: 'm' })

    expect(tool?.readOnly).toBe(true)
    expect(tool?.name).toBe('web_search')
  })

  it('rejects an empty query without spending a request', async () => {
    const tool = createWebSearchTool({ provider: 'openrouter', apiKey: 'k', model: 'm' })

    await expect(tool?.execute({ query: '   ' }, { depth: 0 })).resolves.toEqual({
      success: false,
      error: 'web_search requires a non-empty query',
    })
  })
})

describe('webSearchConfigFor', () => {
  it('uses the key belonging to the active provider', () => {
    expect(
      webSearchConfigFor({
        providerId: 'openrouter',
        model: 'google/gemini-2.5-flash',
        anthropicKey: 'sk-ant',
        openRouterKey: 'sk-or',
      })
    ).toEqual({ provider: 'openrouter', apiKey: 'sk-or', model: 'google/gemini-2.5-flash' })
  })

  it('returns null when the provider cannot search or its key is missing', () => {
    expect(webSearchConfigFor({ providerId: 'chrome', model: 'nano' })).toBeNull()
    expect(
      webSearchConfigFor({ providerId: 'anthropic', model: 'claude-sonnet-5', openRouterKey: 'k' })
    ).toBeNull()
  })
})
