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
// WebLLM comes last: it is the weakest that is picked at all, so only when nothing
// else is configured, and only once a model has been chosen. Chrome is never
// picked automatically: its tool use and instruction following are too unreliable
// to land on by default, so it runs only when asked for.
export function resolveProviderId(
  options: Credentials & { preference: ProviderPreference }
): ProviderId {
  const { preference } = options
  if (preference !== 'automatic' && isProviderReady(preference, options)) return preference

  const order: ProviderId[] = ['anthropic', 'openrouter', 'custom', 'webllm']
  return order.find(id => isProviderReady(id, options)) ?? 'anthropic'
}

const ON_DEVICE: readonly ProviderId[] = ['webllm', 'chrome']

export function isOnDevice(providerId: ProviderId): boolean {
  return ON_DEVICE.includes(providerId)
}

// The hosted provider an on-device user could switch to without setting anything
// up, in the same order resolveProviderId tries them. null when none is ready,
// which is when the panel offers setup instead of a switch. A custom endpoint on
// this machine or the LAN (LM Studio, llama.cpp) is another local model, not the
// faster hosted one the notice offers, so it does not count.
export function readyCloudProvider(credentials: Credentials): ProviderId | null {
  const order: ProviderId[] = ['anthropic', 'openrouter', 'custom']
  return (
    order.find(
      id =>
        isProviderReady(id, credentials) &&
        !(id === 'custom' && isLocalEndpoint(credentials.customEndpoint?.baseUrl))
    ) ?? null
  )
}

// localhost, .local names, and loopback, private and link-local addresses. A URL
// that does not parse counts as local, since it cannot be shown to be hosted.
export function isLocalEndpoint(baseUrl: string | undefined): boolean {
  let host: string
  try {
    host = new URL(baseUrl ?? '').hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return true
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '0.0.0.0') return true
  // IPv6 literals: loopback, unique local (fc00::/7) and link-local (fe80::/10)
  if (host.includes(':')) return host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80:')
  const ipv4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (!ipv4) return false
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  )
}
