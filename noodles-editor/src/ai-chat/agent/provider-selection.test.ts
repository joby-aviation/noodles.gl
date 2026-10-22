import { describe, expect, it } from 'vitest'
import { type Credentials, isProviderReady, resolveProviderId } from './provider-selection'

const NOTHING: Credentials = {
  anthropicKey: undefined,
  openRouterKey: undefined,
  customEndpoint: undefined,
  webllmModel: undefined,
  webgpuReady: false,
  chromeAvailable: false,
}

describe('isProviderReady', () => {
  it('needs a key for the hosted providers', () => {
    expect(isProviderReady('anthropic', NOTHING)).toBe(false)
    expect(isProviderReady('anthropic', { ...NOTHING, anthropicKey: 'sk-ant-x' })).toBe(true)
    expect(isProviderReady('openrouter', { ...NOTHING, openRouterKey: 'sk-or-x' })).toBe(true)
  })

  // A base URL with no model is the state the settings form is in halfway through
  it('needs both halves of a custom endpoint', () => {
    const partial = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'k', model: '' }
    expect(isProviderReady('custom', { ...NOTHING, customEndpoint: partial })).toBe(false)
    expect(
      isProviderReady('custom', {
        ...NOTHING,
        customEndpoint: { ...partial, model: 'llama-3.3-70b-versatile' },
      })
    ).toBe(true)
  })

  it('needs a capable browser for Chrome', () => {
    expect(isProviderReady('chrome', { ...NOTHING, chromeAvailable: true })).toBe(true)
  })

  // The load-bearing half of this plan's safety: WebGPU alone must not be enough,
  // or an unconfigured editor would start downloading gigabytes on its own
  it('needs WebGPU and a chosen model for WebLLM', () => {
    expect(isProviderReady('webllm', { ...NOTHING, webgpuReady: true })).toBe(false)
    expect(isProviderReady('webllm', { ...NOTHING, webllmModel: 'Qwen3-4B-q4f16_1-MLC' })).toBe(
      false
    )
    expect(
      isProviderReady('webllm', {
        ...NOTHING,
        webgpuReady: true,
        webllmModel: 'Qwen3-4B-q4f16_1-MLC',
      })
    ).toBe(true)
  })
})

describe('resolveProviderId', () => {
  it('prefers Anthropic when several credentials are present', () => {
    const id = resolveProviderId({
      ...NOTHING,
      preference: 'automatic',
      anthropicKey: 'sk-ant-x',
      openRouterKey: 'sk-or-x',
      chromeAvailable: true,
    })
    expect(id).toBe('anthropic')
  })

  it('honours an explicit preference that is usable', () => {
    const id = resolveProviderId({
      ...NOTHING,
      preference: 'openrouter',
      anthropicKey: 'sk-ant-x',
      openRouterKey: 'sk-or-x',
    })
    expect(id).toBe('openrouter')
  })

  // Clearing a key in Settings should not leave the chat pointed at nothing
  it('falls back when the preferred provider lost its credential', () => {
    const id = resolveProviderId({
      ...NOTHING,
      preference: 'openrouter',
      anthropicKey: 'sk-ant-x',
    })
    expect(id).toBe('anthropic')
  })

  it('does not pick WebLLM automatically until a model has been chosen', () => {
    const ready = { ...NOTHING, webgpuReady: true, chromeAvailable: true }
    expect(resolveProviderId({ ...ready, preference: 'automatic' })).toBe('chrome')
    expect(
      resolveProviderId({ ...ready, preference: 'automatic', webllmModel: 'Qwen3-4B-q4f16_1-MLC' })
    ).toBe('webllm')
  })

  // Asking for it explicitly is not enough either: without a model there is nothing
  // to load, so the preference loses to readiness like any other
  it('ignores an explicit WebLLM preference with no model chosen', () => {
    const id = resolveProviderId({
      ...NOTHING,
      preference: 'webllm',
      webgpuReady: true,
      anthropicKey: 'sk-ant-x',
    })
    expect(id).toBe('anthropic')
  })

  it('prefers a local model to Chrome’s built-in one', () => {
    const id = resolveProviderId({
      ...NOTHING,
      preference: 'automatic',
      webgpuReady: true,
      webllmModel: 'Qwen3-4B-q4f16_1-MLC',
      chromeAvailable: true,
    })
    expect(id).toBe('webllm')
  })

  // Nothing configured at all: the panel shows its connect screen, which needs a
  // provider id to label. Anthropic is the one it names.
  it('falls back to Anthropic when nothing is ready', () => {
    expect(resolveProviderId({ ...NOTHING, preference: 'automatic' })).toBe('anthropic')
  })
})
