// Which model the chat runs on, per provider. Persisted separately from the API
// keys because a model choice is a preference, not a credential, and because the
// picker has to survive a reload to be worth having.
//
// Which *provider* to use is not here: that is keys-store's providerPreference,
// so the chat header and the settings dialog cannot disagree about it.
//
// Resolution order is the same shape as keys-store: an explicit choice wins,
// then the build's env override, then the provider's own default.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderId } from './types'

interface ModelState {
  // undefined means "whatever the provider defaults to"
  models: Partial<Record<ProviderId, string>>
}

interface ModelActions {
  setModel: (provider: ProviderId, model: string | undefined) => void
  getModel: (provider: ProviderId) => string | undefined
}

export const useAgentModelStore = create<ModelState & ModelActions>()(
  persist(
    (set, get) => ({
      models: {},

      setModel: (provider, model) => {
        const models = { ...get().models }
        if (model?.trim()) {
          models[provider] = model.trim()
        } else {
          delete models[provider]
        }
        set({ models })
      },

      getModel: provider => get().models[provider] ?? getEnvModel(provider),
    }),
    { name: 'noodles-agent-models' }
  )
)

export const getAgentModelStore = () => useAgentModelStore.getState()

export function getEnvModel(provider: ProviderId): string | undefined {
  switch (provider) {
    case 'anthropic':
      return import.meta.env.VITE_ANTHROPIC_MODEL
    case 'openrouter':
      return import.meta.env.VITE_OPENROUTER_MODEL
    // Both carry their model with them: a custom endpoint's is part of its saved
    // config, and Chrome exposes exactly one built-in model
    case 'custom':
    case 'chrome':
      return undefined
  }
}
