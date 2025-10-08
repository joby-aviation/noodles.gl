import { create } from 'zustand'
import type { FileSystemError } from './storage'
import {
  checkFileSystemSupport,
  type FileSystemSupport,
  type StorageType,
} from './utils/filesystem'

// ============================================================================
// Types
// ============================================================================

interface FileSystemState {
  // Current directory handle being worked with
  currentDirectory: FileSystemDirectoryHandle | null
  // Current error if any
  error: FileSystemError | null
  // Supported storage types for this browser/context
  support: FileSystemSupport
  // Currently active storage type
  activeStorageType: StorageType
  // Project name for the current directory
  currentProjectName: string | null
}

interface FileSystemActions {
  // TODO: add setProjectName for URL-loaded projects?
  // TODO: move menu.tsx state here?
  // Set the current directory handle
  setCurrentDirectory: (handle: FileSystemDirectoryHandle | null, projectName?: string) => void
  // Set error state
  setError: (error: FileSystemError | null) => void
  // Clear error
  clearError: () => void
  // Reset all state
  reset: () => void
}

type FileSystemStore = FileSystemState & FileSystemActions

// ============================================================================
// Store
// ============================================================================

// Check what's supported at module level
const support = checkFileSystemSupport()

// Prefer File System Access API if available, otherwise OPFS
const recommendedType: StorageType = support.fileSystemAccess ? 'fileSystemAccess' : 'opfs'

const initialState: FileSystemState = {
  currentDirectory: null,
  error: null,
  support,
  activeStorageType: recommendedType,
  currentProjectName: null,
}

export const useFileSystemStore = create<FileSystemStore>((set, _get) => ({
  ...initialState,

  setCurrentDirectory: (handle, projectName) => {
    set({
      currentDirectory: handle,
      currentProjectName: projectName || handle?.name || null,
      error: null, // Clear error when setting new directory
    })
  },

  setError: error => {
    set({ error })
  },

  clearError: () => {
    set({ error: null })
  },

  reset: () => {
    set(initialState)
  },
}))

// ============================================================================
// Selectors
// ============================================================================

export const useCurrentDirectory = () => useFileSystemStore(state => state.currentDirectory)

export const useFileSystemError = () => useFileSystemStore(state => state.error)

export const useActiveStorageType = () => useFileSystemStore(state => state.activeStorageType)

export const useFileSystemSupport = () => useFileSystemStore(state => state.support)

// TODO: integrate with toolbar title
export const useCurrentProjectName = () => useFileSystemStore(state => state.currentProjectName)
