import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cachedOpenRouterFreeModels,
  DEFAULT_OPENROUTER_MODEL,
  defaultFreeModel,
  fetchOpenRouterFreeModels,
  OpenRouterProvider,
  resetOpenRouterCatalogue,
} from './openrouter'

afterEach(() => {
  vi.unstubAllGlobals()
  resetOpenRouterCatalogue()
})

// Trimmed to the fields the filter reads, in the shape /api/v1/models returns.
function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vendor/model:free',
    name: 'Vendor Model (free)',
    context_length: 64_000,
    pricing: { prompt: '0', completion: '0' },
    supported_parameters: ['tools', 'temperature'],
    ...overrides,
  }
}

function stubCatalogue(entries: unknown[], status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: entries }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchOpenRouterFreeModels', () => {
  it('keeps only free, tool-calling models', async () => {
    stubCatalogue([
      entry({ id: 'free/tools' }),
      entry({ id: 'free/no-tools', supported_parameters: ['temperature'] }),
      entry({ id: 'paid/tools', pricing: { prompt: '0.0000012', completion: '0.000002' } }),
      // Only the completion side is billed: still not free
      entry({ id: 'half-paid/tools', pricing: { prompt: '0', completion: '0.000002' } }),
    ])

    const models = await fetchOpenRouterFreeModels()

    expect(models.map(model => model.id)).toEqual(['free/tools'])
  })

  it('does not read an empty price string as zero', async () => {
    stubCatalogue([entry({ id: 'unknown/price', pricing: { prompt: '', completion: '' } })])

    expect(await fetchOpenRouterFreeModels()).toEqual([])
  })

  it('accepts numeric zero prices as well as decimal strings', async () => {
    stubCatalogue([entry({ id: 'numeric/free', pricing: { prompt: 0, completion: 0 } })])

    expect((await fetchOpenRouterFreeModels()).map(model => model.id)).toEqual(['numeric/free'])
  })

  it('orders preferred models first, then by context window', async () => {
    stubCatalogue([
      entry({ id: 'roomy/model:free', context_length: 200_000 }),
      entry({ id: 'small/model:free', context_length: 8_000 }),
      entry({ id: 'deepseek/deepseek-chat-v3-0324:free', context_length: 32_000 }),
    ])

    const models = await fetchOpenRouterFreeModels()

    expect(models.map(model => model.id)).toEqual([
      'deepseek/deepseek-chat-v3-0324:free',
      'roomy/model:free',
      'small/model:free',
    ])
  })

  it('caps the list so the picker stays a picker', async () => {
    stubCatalogue(Array.from({ length: 40 }, (_, i) => entry({ id: `free/model-${i}` })))

    expect(await fetchOpenRouterFreeModels()).toHaveLength(12)
  })

  it('fetches once and serves later callers from the cache', async () => {
    const fetchMock = stubCatalogue([entry()])

    await fetchOpenRouterFreeModels()
    await fetchOpenRouterFreeModels()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cachedOpenRouterFreeModels().map(model => model.id)).toEqual(['vendor/model:free'])
  })

  it('shares one request between concurrent callers', async () => {
    const fetchMock = stubCatalogue([entry()])

    await Promise.all([fetchOpenRouterFreeModels(), fetchOpenRouterFreeModels()])

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns nothing rather than throwing when the catalogue is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )

    expect(await fetchOpenRouterFreeModels()).toEqual([])
  })

  it('returns nothing when OpenRouter answers with an error status', async () => {
    stubCatalogue([], 503)

    expect(await fetchOpenRouterFreeModels()).toEqual([])
  })
})

describe('defaultFreeModel', () => {
  it('prefers the best listed free model that is actually available', async () => {
    stubCatalogue([
      entry({ id: 'z-ai/glm-4.5-air:free' }),
      entry({ id: 'deepseek/deepseek-chat-v3-0324:free' }),
    ])

    expect(defaultFreeModel(await fetchOpenRouterFreeModels())).toBe(
      'deepseek/deepseek-chat-v3-0324:free'
    )
  })

  it('falls back to the roomiest free model when none of the preferred ones exist', async () => {
    stubCatalogue([
      entry({ id: 'small/model:free', context_length: 8_000 }),
      entry({ id: 'roomy/model:free', context_length: 200_000 }),
    ])

    expect(defaultFreeModel(await fetchOpenRouterFreeModels())).toBe('roomy/model:free')
  })

  it('falls back to the paid default when the catalogue is empty', () => {
    expect(defaultFreeModel([])).toBe(DEFAULT_OPENROUTER_MODEL)
  })
})

describe('OpenRouterProvider context window', () => {
  it('takes the window the catalogue reported, including for paid models', async () => {
    stubCatalogue([
      // Not free, so it never reaches the picker — but its window is still worth
      // learning, since the disclosure and result budgets are sized off it.
      entry({
        id: 'vendor/paid-model',
        context_length: 300_000,
        pricing: { prompt: '0.000003', completion: '0.000015' },
      }),
    ])
    await fetchOpenRouterFreeModels()

    const provider = new OpenRouterProvider({ apiKey: 'sk-or-test', model: 'vendor/paid-model' })

    expect(provider.contextWindow).toBe(300_000)
  })

  it('keeps the static window for the shortlist when nothing was learned', () => {
    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      model: 'anthropic/claude-sonnet-4.5',
    })

    expect(provider.contextWindow).toBe(200_000)
  })

  it('falls back for a model nobody has heard of', () => {
    const provider = new OpenRouterProvider({ apiKey: 'sk-or-test', model: 'vendor/unknown' })

    expect(provider.contextWindow).toBe(128_000)
  })

  it('lets an explicit option win over both', async () => {
    stubCatalogue([entry({ id: 'vendor/model:free', context_length: 64_000 })])
    await fetchOpenRouterFreeModels()

    const provider = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      model: 'vendor/model:free',
      contextWindow: 4_096,
    })

    expect(provider.contextWindow).toBe(4_096)
  })
})
