/**
 * AI Provider factory.
 *
 * Resolves the best available provider from configured API keys.
 * Priority when set to 'auto': anthropic > openai
 * (Anthropic has better tool use and prompt caching for this use case)
 */

export { AnthropicProvider } from './anthropic-provider'
export { OpenAIProvider } from './openai-provider'
export type {
  AIProvider,
  AIResponse,
  AISendParams,
  AIMessage,
  AIContentBlock,
  AIToolDefinition,
  AIToolCall,
  AIToolResult,
  ProviderPreference,
} from './types'

import type { KeysConfig } from '../../noodles/keys-store'
import { AnthropicProvider } from './anthropic-provider'
import { OpenAIProvider } from './openai-provider'
import type { AIProvider, ProviderPreference } from './types'

export interface ResolvedProvider {
  provider: AIProvider
  source: 'anthropic' | 'openai'
}

/**
 * Create an AI provider from the available API keys.
 *
 * @param keys - All configured API keys
 * @param preference - Which provider to prefer ('auto' picks best available)
 * @returns The resolved provider, or null if no keys are configured
 */
export function createProvider(
  keys: {
    anthropic?: string
    openai?: string
    openaiBaseUrl?: string
  },
  preference: ProviderPreference = 'auto',
): ResolvedProvider | null {
  // Explicit preference
  if (preference === 'anthropic' && keys.anthropic) {
    return {
      provider: new AnthropicProvider(keys.anthropic),
      source: 'anthropic',
    }
  }

  if (preference === 'openai' && keys.openai) {
    return {
      provider: new OpenAIProvider({
        apiKey: keys.openai,
        baseUrl: keys.openaiBaseUrl,
      }),
      source: 'openai',
    }
  }

  // Auto: try anthropic first (better tool use + caching), then openai
  if (keys.anthropic) {
    return {
      provider: new AnthropicProvider(keys.anthropic),
      source: 'anthropic',
    }
  }

  if (keys.openai) {
    return {
      provider: new OpenAIProvider({
        apiKey: keys.openai,
        baseUrl: keys.openaiBaseUrl,
      }),
      source: 'openai',
    }
  }

  return null
}
