import { create } from 'zustand'
import type { FileSystemError } from './storage'
import {
  checkFileSystemSupport,
  type FileSystemSupport,
  type StorageType,
} from './utils/filesystem'
import type { Workspace } from './storage/workspace-types'

// ============================================================================
// Types
// ============================================================================

interface FileSystemState {
  // Current workspace (replaces activeStorageType)
  currentWorkspace: Workspace | null
  // Current project name within workspace
  currentProjectName: string | null
  // Current directory handle (for backwards compatibility during migration)
  // TODO: Remove after migration complete
  currentDirectory: FileSystemDirectoryHandle | null
  // Current error if any
  error: FileSystemError | null
  // Supported storage types for this browser/context
  support: FileSystemSupport
  // Currently active storage type (for backwards compatibility)
  // TODO: Remove after migration complete
  activeStorageType: StorageType
}

interface FileSystemActions {
  // Set the current workspace and project
  setWorkspaceAndProject: (workspace: Workspace | null, projectName: string | null) => void
  // Set just the workspace
  setWorkspace: (workspace: Workspace | null) => void
  // Set just the project name
  setProjectName: (projectName: string | null) => void
  // Backwards compatibility: Set the current directory handle
  // TODO: Remove after migration complete
  setCurrentDirectory: (handle: FileSystemDirectoryHandle | null, projectName?: string) => void
  // Backwards compatibility: Set the active storage type
  // TODO: Remove after migration complete
  setActiveStorageType: (type: StorageType) => void
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
  currentWorkspace: null,
  currentProjectName: null,
  currentDirectory: null,
  error: null,
  support,
  activeStorageType: recommendedType,
}

export const useFileSystemStore = create<FileSystemStore>((set, _get) => ({
  ...initialState,

  setWorkspaceAndProject: (workspace, projectName) => {
    set({
      currentWorkspace: workspace,
      currentProjectName: projectName,
      error: null, // Clear error when setting workspace
    })
  },

  setWorkspace: (workspace) => {
    set({
      currentWorkspace: workspace,
      error: null,
    })
  },

  setProjectName: (projectName) => {
    set({
      currentProjectName: projectName,
    })
  },

  // Backwards compatibility
  setCurrentDirectory: (handle, projectName) => {
    set({
      currentDirectory: handle,
      currentProjectName: projectName || handle?.name || null,
      error: null, // Clear error when setting new directory
    })
  },

  // Backwards compatibility
  setActiveStorageType: (type) => {
    set({ activeStorageType: type })
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

/**
 * Get current workspace
 */
export const useCurrentWorkspace = () => useFileSystemStore(state => state.currentWorkspace)

/**
 * Get current project name
 */
export const useCurrentProjectName = () => useFileSystemStore(state => state.currentProjectName)

/**
 * Get current workspace and project together
 */
export const useWorkspaceAndProject = () => useFileSystemStore(state => ({
  workspace: state.currentWorkspace,
  projectName: state.currentProjectName,
}))

/**
 * Backwards compatibility: Get current directory
 * TODO: Remove after migration complete
 */
export const useCurrentDirectory = () => useFileSystemStore(state => state.currentDirectory)

/**
 * Get file system error
 */
export const useFileSystemError = () => useFileSystemStore(state => state.error)

/**
 * Backwards compatibility: Get active storage type
 * TODO: Remove after migration complete
 */
export const useActiveStorageType = () => useFileSystemStore(state => state.activeStorageType)

/**
 * Get file system support info
 */
export const useFileSystemSupport = () => useFileSystemStore(state => state.support)
