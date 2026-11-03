import { describe, expect, it } from 'vitest'
import { createProvider, resolveProviderModel } from './provider-factory'
import { DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic'
import { DEFAULT_OPENROUTER_MODEL } from './providers/openrouter'
import { DEFAULT_WEBLLM_MODEL } from './providers/webllm'
import type { ProviderId } from './types'

const customEndpoint = { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3.2' }
const onDownloadProgress = () => {}

describe('resolveProviderModel', () => {
  it('names the default model when none is saved', () => {
    expect(
      resolveProviderModel({ providerId: 'anthropic', model: undefined, customEndpoint })
    ).toBe(DEFAULT_ANTHROPIC_MODEL)
    expect(
      resolveProviderModel({ providerId: 'openrouter', model: undefined, customEndpoint })
    ).toBe(DEFAULT_OPENROUTER_MODEL)
    expect(resolveProviderModel({ providerId: 'webllm', model: undefined, customEndpoint })).toBe(
      DEFAULT_WEBLLM_MODEL
    )
    expect(resolveProviderModel({ providerId: 'chrome', model: undefined, customEndpoint })).toBe(
      'gemini-nano'
    )
  })

  it('keeps a saved model', () => {
    expect(
      resolveProviderModel({ providerId: 'webllm', model: 'Qwen3-4B-q4f16_1-MLC', customEndpoint })
    ).toBe('Qwen3-4B-q4f16_1-MLC')
  })

  it('reads the custom endpoint model, not the saved one', () => {
    expect(resolveProviderModel({ providerId: 'custom', model: 'other', customEndpoint })).toBe(
      'llama3.2'
    )
    expect(
      resolveProviderModel({ providerId: 'custom', model: 'other', customEndpoint: undefined })
    ).toBeUndefined()
  })

  // Load reports use the resolved name for both outcomes, so it has to be the
  // name a successful build reports
  it.each<[ProviderId, string | undefined]>([
    ['anthropic', undefined],
    ['anthropic', 'claude-opus-5'],
    ['openrouter', undefined],
    ['openrouter', 'openai/gpt-oss-20b:free'],
    ['custom', 'ignored'],
  ])('matches the built %s provider (model %s)', async (providerId, model) => {
    const options = { providerId, apiKey: 'key', model, customEndpoint, onDownloadProgress }
    const provider = await createProvider(options)
    expect(resolveProviderModel(options)).toBe(provider.model)
  })
})
