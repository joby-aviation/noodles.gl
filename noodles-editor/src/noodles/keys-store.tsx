import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type KeyType = 'mapbox' | 'googleMaps' | 'anthropic'

export interface KeysConfig {
  mapbox?: string
  googleMaps?: string
  anthropic?: string
}

// Separate state and actions for clarity
interface KeysState {
  // Persisted to localStorage
  browserKeys: KeysConfig
  saveInProject: boolean

  // NOT persisted (comes from loaded project)
  projectKeys: KeysConfig | undefined
}

interface KeysActions {
  // Mutations
  setBrowserKey: (key: KeyType, value: string | undefined) => void
  setBrowserKeys: (keys: KeysConfig) => void
  clearBrowserKey: (key: KeyType) => void
  setSaveInProject: (enabled: boolean) => void
  setProjectKeys: (keys: KeysConfig | undefined) => void

  // Computed getters
  getKey: (key: KeyType) => string | undefined
  hasKey: (key: KeyType) => boolean
  getActiveSource: (key: KeyType) => 'browser' | 'project' | 'env' | null
}

type KeysStore = KeysState & KeysActions

export const useKeysStore = create<KeysStore>()(
  persist(
    (set, get) => ({
      // Initial state
      browserKeys: {},
      saveInProject: false,
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
        if (keys.anthropic?.trim()) cleaned.anthropic = keys.anthropic.trim()
        set({ browserKeys: cleaned })
      },

      clearBrowserKey: key => {
        const browserKeys = { ...get().browserKeys }
        delete browserKeys[key]
        set({ browserKeys })
      },

      setSaveInProject: enabled => {
        set({ saveInProject: enabled })
      },

      setProjectKeys: keys => {
        set({ projectKeys: keys })
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
    }),
    {
      name: 'noodles-keys',
      partialize: state => ({
        browserKeys: state.browserKeys,
        saveInProject: state.saveInProject,
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
  return state.saveInProject ? state.browserKeys : undefined
}

export function getEnvKeys(): KeysConfig {
  return {
    mapbox: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
    googleMaps: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    anthropic: import.meta.env.VITE_CLAUDE_API_KEY,
  }
}
