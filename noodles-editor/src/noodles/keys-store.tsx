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

// Keys for the AI assistant come only from the browser or the environment. A
// project file is shared, so a key read from one would send the reader's
// conversation through someone else's account, and a key saved into one would
// hand the user's account to everyone they share it with.
export const AI_KEY_TYPES = ['anthropic', 'openrouter'] as const satisfies readonly KeyType[]

export function isAIKey(key: KeyType): boolean {
  return (AI_KEY_TYPES as readonly KeyType[]).includes(key)
}

function withoutAIKeys(keys: KeysConfig | undefined): KeysConfig | undefined {
  if (!keys) return undefined
  const kept = { ...keys }
  for (const key of AI_KEY_TYPES) delete kept[key]
  return Object.keys(kept).length > 0 ? kept : undefined
}

// Which provider the AI assistant should use. 'automatic' resolves by which
// credential is present; the rest name one of the agent loop's providers, so the
// strings deliberately match ProviderId in ai-chat/agent/types.ts.
export type ProviderPreference =
  | 'automatic'
  | 'anthropic'
  | 'openrouter'
  | 'custom'
  | 'webllm'
  | 'chrome'

// 'chrome-ai' was the persisted spelling before the preference shared a
// vocabulary with the agent loop. Read-side only, so a stored value keeps working
// without a migration step.
const LEGACY_PREFERENCES: Record<string, ProviderPreference> = { 'chrome-ai': 'chrome' }

function normalizePreference(stored: string | undefined): ProviderPreference {
  if (!stored) return 'automatic'
  return LEGACY_PREFERENCES[stored] ?? (stored as ProviderPreference)
}

export type KeySource = 'project' | 'browser' | 'env'

// A per-project choice to use the user's own key instead of the project's. It stores
// a fingerprint of the project key rather than the key, and lapses when the project
// key changes, so the user is asked again about a key they haven't seen.
export interface KeyOverride {
  source: 'browser' | 'env'
  projectKeyFingerprint: string
}

type KeyOverrides = Record<string, Partial<Record<KeyType, KeyOverride>>>

// cyrb53. Only detects that a key changed, so it needn't be cryptographic, and it's
// synchronous so key lookups stay synchronous.
export function fingerprintKey(value: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

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
  keyOverrides: KeyOverrides
  providerPreference: ProviderPreference
  customEndpoint: CustomEndpointConfig | undefined

  // NOT persisted (comes from loaded project)
  projectKeys: KeysConfig | undefined
  // The project keys as last loaded or saved, so a reload can tell it would lose an edit
  savedProjectKeys: KeysConfig | undefined
  // Which project the overrides apply to
  projectId: string | undefined
  // Counts edits to the project keys, so the editor can mark the project unsaved
  projectKeyEdits: number
  // AI keys the loaded project file contained, which were dropped rather than used
  ignoredProjectKeys: KeyType[]
}

interface KeysActions {
  // Mutations
  setBrowserKey: (key: KeyType, value: string | undefined) => void
  setBrowserKeys: (keys: KeysConfig) => void
  clearBrowserKey: (key: KeyType) => void
  setProjectKey: (key: KeyType, value: string | undefined) => void
  removeProjectKey: (key: KeyType) => void
  setProjectKeys: (keys: KeysConfig | undefined, projectId?: string) => void
  setKeyOverride: (key: KeyType, source: 'browser' | 'env' | null) => void
  copyKeyOverridesTo: (projectId: string) => void
  markProjectKeysSaved: () => void
  setProviderPreference: (preference: ProviderPreference) => void
  setCustomEndpoint: (config: CustomEndpointConfig | undefined) => void

  // Computed getters
  getKey: (key: KeyType) => string | undefined
  hasKey: (key: KeyType) => boolean
  getActiveSource: (key: KeyType) => KeySource | null
  getOverride: (key: KeyType) => KeyOverride['source'] | null
  getProviderPreference: () => ProviderPreference
  getCustomEndpoint: () => CustomEndpointConfig | undefined
}

type KeysStore = KeysState & KeysActions

export const useKeysStore = create<KeysStore>()(
  persist(
    (set, get) => ({
      // Initial state
      browserKeys: {},
      keyOverrides: {},
      providerPreference: 'automatic',
      customEndpoint: undefined,
      projectKeys: undefined,
      savedProjectKeys: undefined,
      projectId: undefined,
      projectKeyEdits: 0,
      ignoredProjectKeys: [],

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

      setProjectKey: (key, value) => {
        if (isAIKey(key)) return
        const projectKeys = { ...get().projectKeys }
        if (value?.trim()) {
          projectKeys[key] = value.trim()
        } else {
          delete projectKeys[key]
        }
        set({
          projectKeys: Object.keys(projectKeys).length > 0 ? projectKeys : undefined,
          projectKeyEdits: get().projectKeyEdits + 1,
        })
      },

      removeProjectKey: key => {
        get().setProjectKey(key, undefined)
      },

      setProjectKeys: (keys, projectId) => {
        const projectKeys = withoutAIKeys(keys)
        set({
          projectKeys,
          savedProjectKeys: projectKeys,
          projectId,
          ignoredProjectKeys: AI_KEY_TYPES.filter(key => keys?.[key]),
        })
      },

      setKeyOverride: (key, source) => {
        const { projectId, projectKeys, keyOverrides } = get()
        const projectKey = projectKeys?.[key]
        if (projectId === undefined || isAIKey(key)) return
        const forProject = { ...keyOverrides[projectId] }
        if (source && projectKey) {
          forProject[key] = { source, projectKeyFingerprint: fingerprintKey(projectKey) }
        } else {
          delete forProject[key]
        }
        const next = { ...keyOverrides }
        if (Object.keys(forProject).length > 0) {
          next[projectId] = forProject
        } else {
          delete next[projectId]
        }
        set({ keyOverrides: next })
      },

      setProviderPreference: preference => {
        set({ providerPreference: preference })
      },

      setCustomEndpoint: config => {
        set({ customEndpoint: config })
      },

      // Saving a project to a new place keeps the choices made for it there, replacing any
      // left from a project that was there before
      copyKeyOverridesTo: projectId => {
        const { projectId: current, keyOverrides } = get()
        const forProject = current === undefined ? undefined : keyOverrides[current]
        const { [projectId]: _replaced, ...others } = keyOverrides
        set({
          projectId,
          keyOverrides: forProject ? { ...others, [projectId]: forProject } : others,
        })
      },

      markProjectKeysSaved: () => {
        set({ savedProjectKeys: get().projectKeys })
      },

      // Computed getters (priority: project > browser > env, unless the user overrode the
      // project key, and never project for AI keys)
      getKey: key => {
        const source = get().getActiveSource(key)
        return source ? getSlots(get(), key)[source] : undefined
      },

      hasKey: key => {
        return !!get().getKey(key)
      },

      getActiveSource: key => {
        const slots = getSlots(get(), key)
        if (slots.project) return get().getOverride(key) ?? 'project'
        if (slots.browser) return 'browser'
        if (slots.env) return 'env'
        return null
      },

      // The override in effect, if the project key it was made for is still there and
      // the key it points to hasn't been cleared
      getOverride: key => {
        const state = get()
        const slots = getSlots(state, key)
        if (!slots.project || state.projectId === undefined) return null
        const override = state.keyOverrides[state.projectId]?.[key]
        if (!override || override.projectKeyFingerprint !== fingerprintKey(slots.project)) {
          return null
        }
        return slots[override.source] ? override.source : null
      },

      getProviderPreference: () => {
        return normalizePreference(get().providerPreference)
      },

      getCustomEndpoint: () => {
        return get().customEndpoint
      },
    }),
    {
      name: 'noodles-keys',
      // Version 1 replaced the "save browser keys in project file" setting with overrides
      version: 1,
      migrate: persisted => {
        const { saveInProject: _, ...rest } = persisted as Record<string, unknown>
        return { ...rest, keyOverrides: {} } as unknown as KeysStore
      },
      partialize: state => ({
        browserKeys: state.browserKeys,
        keyOverrides: state.keyOverrides,
        providerPreference: state.providerPreference,
        customEndpoint: state.customEndpoint,
        // Don't persist projectKeys - comes from project file
      }),
    }
  )
)

// Non-React access
export const getKeysStore = () => useKeysStore.getState()

// Choices are stored per route, so an example and a saved project with the same name
// keep separate ones
export function keysProjectId(routePrefix: string, name: string): string {
  return `${routePrefix}/${name}`
}

// Convenience selectors
export const useBrowserKeys = () => useKeysStore(state => state.browserKeys)
export const useProjectKeys = () => useKeysStore(state => state.projectKeys)

// Utility functions (no state needed)
export function getKeysForProject(): KeysConfig | undefined {
  return withoutAIKeys(getKeysStore().projectKeys)
}

function getSlots(state: KeysState, key: KeyType): Partial<Record<KeySource, string>> {
  return {
    project: isAIKey(key) ? undefined : state.projectKeys?.[key],
    browser: state.browserKeys[key],
    env: getEnvKeys()[key],
  }
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
