import { describe, expect, it } from 'vitest'
import {
  type Credentials,
  isLocalEndpoint,
  isOnDevice,
  isProviderReady,
  readyCloudProvider,
  resolveProviderId,
} from './provider-selection'

const NOTHING: Credentials = {
  anthropicKey: undefined,
  openRouterKey: undefined,
  customEndpoint: undefined,
  webllmModel: undefined,
  webgpuReady: false,
  chromeAvailable: false,
  hostedAvailable: false,
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
  it('falls back to the free tier only when nothing is set up', () => {
    expect(resolveProviderId({ ...NOTHING, preference: 'automatic', hostedAvailable: true })).toBe(
      'hosted'
    )
  })

  it('prefers anything the user set up over the free tier', () => {
    const base = { ...NOTHING, preference: 'automatic' as const, hostedAvailable: true }
    expect(resolveProviderId({ ...base, openRouterKey: 'sk-or-x' })).toBe('openrouter')
    expect(resolveProviderId({ ...base, webgpuReady: true, webllmModel: 'm' })).toBe('webllm')
  })

  it('never offers the free tier as the faster hosted option', () => {
    expect(readyCloudProvider({ ...NOTHING, hostedAvailable: true })).toBeNull()
  })

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
    expect(resolveProviderId({ ...ready, preference: 'automatic' })).toBe('anthropic')
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

  it('runs Chrome only when it is asked for', () => {
    const ready = { ...NOTHING, chromeAvailable: true }
    expect(resolveProviderId({ ...ready, preference: 'automatic' })).toBe('anthropic')
    expect(resolveProviderId({ ...ready, preference: 'chrome' })).toBe('chrome')
  })

  // Nothing configured at all: the panel shows its connect screen, which needs a
  // provider id to label. Anthropic is the one it names.
  it('falls back to Anthropic when nothing is ready', () => {
    expect(resolveProviderId({ ...NOTHING, preference: 'automatic' })).toBe('anthropic')
  })
})

describe('isOnDevice', () => {
  it('is true only for the two providers that run in the browser', () => {
    expect(isOnDevice('webllm')).toBe(true)
    expect(isOnDevice('chrome')).toBe(true)
    expect(isOnDevice('anthropic')).toBe(false)
    expect(isOnDevice('openrouter')).toBe(false)
    expect(isOnDevice('custom')).toBe(false)
  })
})

describe('readyCloudProvider', () => {
  it('is null when only on-device providers are ready', () => {
    const credentials = {
      ...NOTHING,
      webgpuReady: true,
      webllmModel: 'Qwen3-4B-q4f16_1-MLC',
      chromeAvailable: true,
    }
    expect(readyCloudProvider(credentials)).toBeNull()
  })

  it('names the first hosted provider with a credential, in the automatic order', () => {
    expect(readyCloudProvider({ ...NOTHING, openRouterKey: 'or-key' })).toBe('openrouter')
    expect(
      readyCloudProvider({ ...NOTHING, openRouterKey: 'or-key', anthropicKey: 'sk-ant' })
    ).toBe('anthropic')
  })

  it('skips a custom endpoint on this machine or the LAN, which is not hosted', () => {
    const custom = (baseUrl: string) => ({
      ...NOTHING,
      customEndpoint: { baseUrl, model: 'm', apiKey: '' },
    })
    expect(readyCloudProvider(custom('http://localhost:1234/v1'))).toBeNull()
    expect(readyCloudProvider(custom('http://192.168.1.20:8080/v1'))).toBeNull()
    expect(readyCloudProvider(custom('https://api.groq.com/openai/v1'))).toBe('custom')
  })
})

describe('isLocalEndpoint', () => {
  it('recognises loopback, private and .local hosts', () => {
    for (const url of [
      'http://localhost:1234/v1',
      'http://127.0.0.1:8080',
      'http://[::1]:8080',
      'http://10.0.0.5/v1',
      'http://172.20.1.1/v1',
      'http://192.168.0.2/v1',
      'http://gpu-box.local:8000/v1',
      'not a url',
    ]) {
      expect(isLocalEndpoint(url), url).toBe(true)
    }
  })

  it('leaves public hosts alone', () => {
    for (const url of [
      'https://api.groq.com/openai/v1',
      'https://api.openai.com/v1',
      'http://172.32.0.1/v1',
      'https://fd.example.com/v1',
    ]) {
      expect(isLocalEndpoint(url), url).toBe(false)
    }
  })
})
