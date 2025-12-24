// Keys Manager
//
// Manages client-side API keys for external services.
// Keys can be stored in:
// 1. localStorage (persistent across sessions, not shared)
// 2. Project file (shared when project is shared)
// 3. Environment variables (fallback for development)

export type KeyType = 'mapbox' | 'googleMaps' | 'anthropic'

export interface KeysConfig {
  mapbox?: string
  googleMaps?: string
  anthropic?: string
}

export interface KeysState {
  keys: KeysConfig
  saveInProject: boolean
}

const STORAGE_KEY = 'noodles-keys'
const STORAGE_SAVE_IN_PROJECT_KEY = 'noodles-keys-save-in-project'

class KeysManager {
  private projectKeys: KeysConfig | undefined

  // Set project keys from loaded project file
  setProjectKeys(keys: KeysConfig | undefined): void {
    this.projectKeys = keys
  }

  // Get project keys (returns undefined if no project loaded)
  getProjectKeys(): KeysConfig | undefined {
    return this.projectKeys
  }

  // Get an API key from localStorage, project data, or environment variables
  // Priority: localStorage > project > env
  getKey(key: KeyType, projectKeys?: KeysConfig): string | undefined {
    // Try localStorage first (user's personal keys)
    const stored = getKeysFromStorage()
    if (stored.keys[key]) {
      return stored.keys[key]
    }

    // Try project keys (if provided as parameter or from loaded project)
    const keysToCheck = projectKeys || this.projectKeys
    if (keysToCheck?.[key]) {
      return keysToCheck[key]
    }

    // Fallback to environment variables
    switch (key) {
      case 'mapbox':
        return import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
      case 'googleMaps':
        return import.meta.env.VITE_GOOGLE_MAPS_API_KEY
      case 'anthropic':
        return import.meta.env.VITE_CLAUDE_API_KEY
    }
  }

  // Check if an API key is available from any source
  hasKey(key: KeyType, projectKeys?: KeysConfig): boolean {
    return !!this.getKey(key, projectKeys)
  }
}

// Export singleton instance
export const keysManager = new KeysManager()

// Get all API keys from localStorage
export function getKeysFromStorage(): KeysState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    const saveInProject = localStorage.getItem(STORAGE_SAVE_IN_PROJECT_KEY) === 'true'

    if (stored) {
      const keys = JSON.parse(stored) as KeysConfig
      return { keys, saveInProject }
    }
  } catch (error) {
    console.error('Failed to load API keys from localStorage:', error)
  }

  return { keys: {}, saveInProject: false }
}

// Custom event for key changes
export const KEYS_CHANGED_EVENT = 'noodles-keys-changed'

// Save API keys to localStorage
export function saveKeysToStorage(keys: KeysConfig, saveInProject: boolean): void {
  try {
    // Clean up empty values
    const cleanedKeys: KeysConfig = {}
    if (keys.mapbox?.trim()) cleanedKeys.mapbox = keys.mapbox.trim()
    if (keys.googleMaps?.trim()) cleanedKeys.googleMaps = keys.googleMaps.trim()
    if (keys.anthropic?.trim()) cleanedKeys.anthropic = keys.anthropic.trim()

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanedKeys))
    localStorage.setItem(STORAGE_SAVE_IN_PROJECT_KEY, saveInProject.toString())

    // Dispatch custom event to notify listeners of key changes
    window.dispatchEvent(new CustomEvent(KEYS_CHANGED_EVENT, { detail: cleanedKeys }))
  } catch (error) {
    console.error('Failed to save API keys to localStorage:', error)
  }
}

// Get API keys to be included in project file (if user opted in)
export function getKeysForProject(): KeysConfig | undefined {
  const { keys, saveInProject } = getKeysFromStorage()
  return saveInProject ? keys : undefined
}

// Mask an API key for display (show first 6 characters, then dots)
export function maskKey(key: string): string {
  if (!key || key.length <= 6) {
    return '••••••••'
  }
  // Show first 6 chars, mask the rest with at least 8 dots
  const dotsCount = Math.max(8, key.length - 6)
  return `${key.slice(0, 6)}${'•'.repeat(dotsCount)}`
}
