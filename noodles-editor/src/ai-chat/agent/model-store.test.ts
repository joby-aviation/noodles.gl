import { beforeEach, describe, expect, it } from 'vitest'
import { getAgentModelStore } from './model-store'
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic'

describe('agent model store', () => {
  beforeEach(() => {
    getAgentModelStore().setModel('anthropic', undefined)
  })

  it('defaults to undefined so the provider picks', () => {
    expect(getAgentModelStore().getModel('anthropic')).toBeUndefined()
  })

  it('round-trips a chosen model', () => {
    getAgentModelStore().setModel('anthropic', 'claude-opus-5')

    expect(getAgentModelStore().getModel('anthropic')).toBe('claude-opus-5')
  })

  it('treats a blank choice as no choice', () => {
    getAgentModelStore().setModel('anthropic', 'claude-opus-5')
    getAgentModelStore().setModel('anthropic', '   ')

    expect(getAgentModelStore().getModel('anthropic')).toBeUndefined()
  })

  it('keeps providers independent', () => {
    getAgentModelStore().setModel('openrouter', 'google/gemini-2.5-flash')

    expect(getAgentModelStore().getModel('anthropic')).toBeUndefined()

    getAgentModelStore().setModel('openrouter', undefined)
  })
})

describe('AnthropicProvider model selection', () => {
  it('runs on Sonnet unless told otherwise', () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-sonnet-5')
    expect(new AnthropicProvider({ apiKey: 'test' }).model).toBe('claude-sonnet-5')
  })

  it('honours an explicit model', () => {
    expect(new AnthropicProvider({ apiKey: 'test', model: 'claude-opus-5' }).model).toBe(
      'claude-opus-5'
    )
  })
})
