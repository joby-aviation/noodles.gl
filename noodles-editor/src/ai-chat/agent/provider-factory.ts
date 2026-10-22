// Builds the provider a session runs on. Shared by the chat panel and the agent
// benchmark hook, so a benchmark run exercises exactly the construction path a
// user's session does.

import type { CustomEndpointConfig } from '../../noodles/keys-store'
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic'
import { CHROME_MODELS, createChromeProvider } from './providers/chrome'
import { CustomProvider } from './providers/custom'
import { DEFAULT_OPENROUTER_MODEL, OpenRouterProvider } from './providers/openrouter'
import { createWebLLMProvider, DEFAULT_WEBLLM_MODEL } from './providers/webllm'
import type { AgentProvider, DownloadProgress, ProviderId } from './types'

export interface CreateProviderOptions {
  providerId: ProviderId
  apiKey: string | undefined
  model: string | undefined
  customEndpoint: CustomEndpointConfig | undefined
  onDownloadProgress: (progress: DownloadProgress) => void
  // WebLLM only: the KV-cache size to allocate, in tokens. Unset keeps the
  // prebuilt config's 4096.
  contextWindow?: number
}

// The model a provider built from these options runs, known before building it.
// A load that fails never produces a provider to read `.model` off, so reporting
// the outcome by this keeps a failure and a success of the same model under one
// name. Undefined only for a custom endpoint that is not configured.
export function resolveProviderModel(
  options: Pick<CreateProviderOptions, 'providerId' | 'model' | 'customEndpoint'>
): string | undefined {
  const { providerId, model, customEndpoint } = options
  switch (providerId) {
    case 'chrome':
      return CHROME_MODELS[0].id
    case 'webllm':
      return model ?? DEFAULT_WEBLLM_MODEL
    case 'openrouter':
      return model ?? DEFAULT_OPENROUTER_MODEL
    case 'anthropic':
      return model ?? DEFAULT_ANTHROPIC_MODEL
    case 'custom':
      return customEndpoint?.model
  }
}

// The on-device providers are the ones whose construction is async: the model has
// to be resident before the first request, and that is also where the download
// happens, so both report progress while they build.
export async function createProvider(options: CreateProviderOptions): Promise<AgentProvider> {
  const { providerId, apiKey, model, customEndpoint } = options
  switch (providerId) {
    case 'chrome':
      return createChromeProvider({ onDownloadProgress: options.onDownloadProgress })
    case 'webllm':
      return createWebLLMProvider({
        model,
        onDownloadProgress: options.onDownloadProgress,
        contextWindow: options.contextWindow,
      })
    case 'openrouter':
      return new OpenRouterProvider({ apiKey: apiKey ?? '', model })
    case 'anthropic':
      return new AnthropicProvider({ apiKey: apiKey ?? '', model })
    case 'custom':
      if (!customEndpoint) throw new Error('No custom endpoint is configured')
      return new CustomProvider({
        baseUrl: customEndpoint.baseUrl,
        apiKey: customEndpoint.apiKey,
        model: customEndpoint.model,
      })
  }
}
