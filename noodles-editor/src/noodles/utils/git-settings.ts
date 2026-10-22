import { useMemo } from 'react'
import { create } from 'zustand'
import type { StorageType } from './filesystem'

// Settings that belong to one project folder
export interface GitProjectSettings {
  enabled: boolean
  autoCommit: boolean
  autoCommitDelay: number
  // Commit into a .git that was already in the folder when Noodles first saw it
  useExistingRepo: boolean
}

export interface GitAuthor {
  name: string
  email: string
}

export interface GitSettings extends GitProjectSettings {
  // The commit author is the person, not the project, so it is shared by every project
  author: GitAuthor
}

export const DEFAULT_GIT_AUTHOR: GitAuthor = {
  name: 'Noodles User',
  email: 'user@noodles.local',
}

export const DEFAULT_GIT_PROJECT_SETTINGS: GitProjectSettings = {
  enabled: true,
  autoCommit: true,
  autoCommitDelay: 30000,
  useExistingRepo: false,
}

const PROJECT_SETTINGS_PREFIX = 'noodles-git-settings:'
const AUTHOR_KEY = 'noodles-git-author'

// Only storage backed by a real folder can hold a .git directory
export function supportsVersioning(storageType: StorageType): boolean {
  return storageType === 'fileSystemAccess' || storageType === 'opfs'
}

function readJson<T>(key: string): Partial<T> {
  try {
    const stored = localStorage.getItem(key)
    if (stored) return JSON.parse(stored) as Partial<T>
  } catch (error) {
    console.warn(`Failed to read ${key}:`, error)
  }
  return {}
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`Failed to write ${key}:`, error)
  }
}

export function getGitSettings(projectName?: string | null): GitSettings {
  const project = projectName
    ? readJson<GitProjectSettings>(`${PROJECT_SETTINGS_PREFIX}${projectName}`)
    : {}
  return {
    ...DEFAULT_GIT_PROJECT_SETTINGS,
    ...project,
    author: { ...DEFAULT_GIT_AUTHOR, ...readJson<GitAuthor>(AUTHOR_KEY) },
  }
}

// Bumped on every save so components reading settings re-render
const useGitSettingsStore = create<{ version: number }>(() => ({ version: 0 }))

// Project fields are stored for `projectName` only; without a project they are dropped.
// The author is stored once for every project.
export function saveGitSettings(settings: Partial<GitSettings>, projectName?: string | null): void {
  const { author, ...projectSettings } = settings
  if (author) {
    writeJson(AUTHOR_KEY, author)
  }
  if (projectName && Object.keys(projectSettings).length > 0) {
    const key = `${PROJECT_SETTINGS_PREFIX}${projectName}`
    writeJson(key, { ...readJson<GitProjectSettings>(key), ...projectSettings })
  }
  useGitSettingsStore.setState(state => ({ version: state.version + 1 }))
}

export function useGitSettings(projectName?: string | null): GitSettings {
  const version = useGitSettingsStore(state => state.version)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version invalidates the cached read
  return useMemo(() => getGitSettings(projectName), [projectName, version])
}

// Autosave writes and commits the project, so it only runs while versioning is on
export function shouldAutosave({
  settings,
  storageType,
  hasUnsavedChanges,
  isExamplesRoute,
}: {
  settings: GitProjectSettings
  storageType: StorageType
  hasUnsavedChanges: boolean
  isExamplesRoute: boolean
}): boolean {
  return (
    !isExamplesRoute &&
    hasUnsavedChanges &&
    supportsVersioning(storageType) &&
    settings.enabled &&
    settings.autoCommit
  )
}
