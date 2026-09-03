import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type KeyType = 'mapbox' | 'googleMaps' | 'cesium' | 'anthropic' | 'openrouter' | 'overpass'

export interface KeysConfig {
  mapbox?: string
  googleMaps?: string
  cesium?: string
  anthropic?: string
  openrouter?: string
  overpass?: string
}

export type ProviderPreference = 'automatic' | 'anthropic' | 'custom' | 'chrome-ai'

export interface CustomEndpointConfig {
  baseUrl: string
  apiKey: string
  model: string
  displayName?: string
}

// Separate state and actions for clarity
interface KeysState {
  // Persisted to localStorage
  browserKeys: KeysConfig
  saveInProject: boolean
  providerPreference: ProviderPreference
  customEndpoint: CustomEndpointConfig | undefined

  // NOT persisted (comes from loaded project)
  projectKeys: KeysConfig | undefined
}

interface KeysActions {
  // Mutations
  setBrowserKey: (key: KeyType, value: string | undefined) => void
  setBrowserKeys: (keys: KeysConfig) => void
  clearBrowserKey: (key: KeyType) => void
  removeProjectKey: (key: KeyType) => void
  setSaveInProject: (enabled: boolean) => void
  setProjectKeys: (keys: KeysConfig | undefined) => void
  setProviderPreference: (preference: ProviderPreference) => void
  setCustomEndpoint: (config: CustomEndpointConfig | undefined) => void

  // Computed getters
  getKey: (key: KeyType) => string | undefined
  hasKey: (key: KeyType) => boolean
  getActiveSource: (key: KeyType) => 'browser' | 'project' | 'env' | null
  getProviderPreference: () => ProviderPreference
  getCustomEndpoint: () => CustomEndpointConfig | undefined
}

type KeysStore = KeysState & KeysActions

export const useKeysStore = create<KeysStore>()(
  persist(
    (set, get) => ({
      // Initial state
      browserKeys: {},
      saveInProject: false,
      providerPreference: 'automatic',
      customEndpoint: undefined,
      projectKeys: undefined,

      // Actions
      setBrowserKey: (key, value) => {
        const browserKeys = { ...get().browserKeys }
        if (value?.trim()) {
          browserKeys[key] = value.trim()
        } else {
          delete browserKeys[key]
        }
        set({ browserKeys })
      },

      setBrowserKeys: keys => {
        const cleaned: KeysConfig = {}
        if (keys.mapbox?.trim()) cleaned.mapbox = keys.mapbox.trim()
        if (keys.googleMaps?.trim()) cleaned.googleMaps = keys.googleMaps.trim()
        if (keys.cesium?.trim()) cleaned.cesium = keys.cesium.trim()
        if (keys.anthropic?.trim()) cleaned.anthropic = keys.anthropic.trim()
        if (keys.openrouter?.trim()) cleaned.openrouter = keys.openrouter.trim()
        if (keys.overpass?.trim()) cleaned.overpass = keys.overpass.trim()
        set({ browserKeys: cleaned })
      },

      clearBrowserKey: key => {
        const browserKeys = { ...get().browserKeys }
        delete browserKeys[key]
        set({ browserKeys })
      },

      removeProjectKey: key => {
        const projectKeys = { ...get().projectKeys }
        delete projectKeys[key]
        set({ projectKeys: Object.keys(projectKeys).length > 0 ? projectKeys : undefined })
      },

      setSaveInProject: enabled => {
        set({ saveInProject: enabled })
      },

      setProjectKeys: keys => {
        set({ projectKeys: keys })
      },

      setProviderPreference: preference => {
        set({ providerPreference: preference })
      },

      setCustomEndpoint: config => {
        set({ customEndpoint: config })
      },

      // Computed getters (priority: browser > project > env)
      getKey: key => {
        const state = get()
        if (state.browserKeys[key]) return state.browserKeys[key]
        if (state.projectKeys?.[key]) return state.projectKeys[key]
        const envKeys = getEnvKeys()
        return envKeys[key]
      },

      hasKey: key => {
        return !!get().getKey(key)
      },

      getActiveSource: key => {
        const state = get()
        if (state.browserKeys[key]) return 'browser'
        if (state.projectKeys?.[key]) return 'project'
        const envKeys = getEnvKeys()
        if (envKeys[key]) return 'env'
        return null
      },

      getProviderPreference: () => {
        return get().providerPreference
      },

      getCustomEndpoint: () => {
        return get().customEndpoint
      },
    }),
    {
      name: 'noodles-keys',
      partialize: state => ({
        browserKeys: state.browserKeys,
        saveInProject: state.saveInProject,
        providerPreference: state.providerPreference,
        customEndpoint: state.customEndpoint,
        // Don't persist projectKeys - comes from project file
      }),
    }
  )
)

// Non-React access
export const getKeysStore = () => useKeysStore.getState()

// Convenience selectors
export const useBrowserKeys = () => useKeysStore(state => state.browserKeys)
export const useSaveInProject = () => useKeysStore(state => state.saveInProject)
export const useProjectKeys = () => useKeysStore(state => state.projectKeys)

// Utility functions (no state needed)
export function getKeysForProject(): KeysConfig | undefined {
  const state = getKeysStore()
  const keys = {
    ...state.projectKeys,
    ...(state.saveInProject ? state.browserKeys : {}),
  }
  return Object.keys(keys).length > 0 ? keys : undefined
}

export function getEnvKeys(): KeysConfig {
  return {
    mapbox: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    googleMaps: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    cesium: import.meta.env.VITE_CESIUM_ACCESS_TOKEN,
    anthropic: import.meta.env.VITE_CLAUDE_API_KEY,
    openrouter: import.meta.env.VITE_OPENROUTER_API_KEY,
    overpass:
      import.meta.env.VITE_OVERPASS_ENDPOINT || 'https://overpass.openstreetmap.fr/api/interpreter',
  }
}
