// Secrets Manager
//
// Manages client-side API keys and secrets for external services.
// Secrets can be stored in:
// 1. localStorage (persistent across sessions, not shared)
// 2. Project file (shared when project is shared)
// 3. Environment variables (fallback for development)

export type SecretKey = 'mapbox' | 'googleMaps' | 'anthropic'

export interface SecretsConfig {
  mapbox?: string
  googleMaps?: string
  anthropic?: string
}

export interface SecretsState {
  secrets: SecretsConfig
  saveInProject: boolean
}

const STORAGE_KEY = 'noodles-secrets'
const STORAGE_SAVE_IN_PROJECT_KEY = 'noodles-secrets-save-in-project'

// Get a secret from localStorage, project data, or environment variables
// Priority: localStorage > project > env
export function getSecret(key: SecretKey, projectSecrets?: SecretsConfig): string | undefined {
  // Try localStorage first (user's personal keys)
  const stored = getSecretsFromStorage()
  if (stored.secrets[key]) {
    return stored.secrets[key]
  }

  // Try project secrets (if shared)
  if (projectSecrets?.[key]) {
    return projectSecrets[key]
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

// Get all secrets from localStorage
export function getSecretsFromStorage(): SecretsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    const saveInProject = localStorage.getItem(STORAGE_SAVE_IN_PROJECT_KEY) === 'true'

    if (stored) {
      const secrets = JSON.parse(stored) as SecretsConfig
      return { secrets, saveInProject }
    }
  } catch (error) {
    console.error('Failed to load secrets from localStorage:', error)
  }

  return { secrets: {}, saveInProject: false }
}

// Save secrets to localStorage
export function saveSecretsToStorage(secrets: SecretsConfig, saveInProject: boolean): void {
  try {
    // Clean up empty values
    const cleanedSecrets: SecretsConfig = {}
    if (secrets.mapbox?.trim()) cleanedSecrets.mapbox = secrets.mapbox.trim()
    if (secrets.googleMaps?.trim()) cleanedSecrets.googleMaps = secrets.googleMaps.trim()
    if (secrets.anthropic?.trim()) cleanedSecrets.anthropic = secrets.anthropic.trim()

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanedSecrets))
    localStorage.setItem(STORAGE_SAVE_IN_PROJECT_KEY, saveInProject.toString())
  } catch (error) {
    console.error('Failed to save secrets to localStorage:', error)
  }
}

// Clear all secrets from localStorage
export function clearSecretsFromStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(STORAGE_SAVE_IN_PROJECT_KEY)
  } catch (error) {
    console.error('Failed to clear secrets from localStorage:', error)
  }
}

// Get secrets to be included in project file (if user opted in)
export function getSecretsForProject(): SecretsConfig | undefined {
  const { secrets, saveInProject } = getSecretsFromStorage()
  return saveInProject ? secrets : undefined
}

// Mask a secret for display (show first 4 and last 4 characters)
export function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) {
    return '••••••••'
  }
  return `${secret.slice(0, 4)}${'•'.repeat(Math.max(8, secret.length - 8))}${secret.slice(-4)}`
}

// Check if a secret is available from any source
export function hasSecret(key: SecretKey, projectSecrets?: SecretsConfig): boolean {
  return !!getSecret(key, projectSecrets)
}
