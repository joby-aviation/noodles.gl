// Which of the five providers the chat should actually use.
//
// Two questions, and they are not the same one. "Is this provider usable?" is
// about credentials and hardware; "which one runs?" adds the user's stated
// preference and a fallback order. Both live here rather than in the panel so the
// rules can be tested without mounting the editor — and because getting the second
// one wrong is how a user ends up staring at a provider they never chose.

import type { CustomEndpointConfig, ProviderPreference } from '../../noodles/keys-store'
import type { ProviderId } from './types'

export interface Credentials {
  anthropicKey: string | undefined
  openRouterKey: string | undefined
  customEndpoint: CustomEndpointConfig | undefined
  // Which local model was chosen, if any. undefined means the user has never
  // asked for one, which is not the same as none being available.
  webllmModel: string | undefined
  webgpuReady: boolean
  chromeAvailable: boolean
}

// A provider is usable when whatever it needs is present: a key for the two
// hosted ones, a saved config for a custom endpoint, a capable browser for the two
// on-device ones.
export function isProviderReady(providerId: ProviderId, credentials: Credentials): boolean {
  switch (providerId) {
    case 'anthropic':
      return Boolean(credentials.anthropicKey)
    case 'openrouter':
      return Boolean(credentials.openRouterKey)
    case 'custom':
      return Boolean(credentials.customEndpoint?.baseUrl && credentials.customEndpoint?.model)
    // A chosen model is half of this condition on purpose: selecting WebLLM starts
    // a download of gigabytes, which has to be something the user asked for rather
    // than something that happens because no key was configured
    case 'webllm':
      return credentials.webgpuReady && Boolean(credentials.webllmModel)
    case 'chrome':
      return credentials.chromeAvailable
  }
}

// An explicit preference wins, but only while it is usable — clearing a key in
// Settings should not leave the chat pointed at a provider it cannot reach.
// The on-device providers come last: they are the weakest of the five, so they
// only get picked when nothing else is configured, and WebLLM only once a model
// has been chosen.
export function resolveProviderId(
  options: Credentials & { preference: ProviderPreference }
): ProviderId {
  const { preference } = options
  if (preference !== 'automatic' && isProviderReady(preference, options)) return preference

  const order: ProviderId[] = ['anthropic', 'openrouter', 'custom', 'webllm', 'chrome']
  return order.find(id => isProviderReady(id, options)) ?? 'anthropic'
}
