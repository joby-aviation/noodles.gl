import { directoryHandleCache } from './utils/directory-handle-cache'
import type { StorageType } from './utils/filesystem'
import {
  directoryExists,
  fileExists,
  getOPFSRoot,
  readFileFromDirectory,
  requestPermission,
  selectDirectory,
  writeFileToDirectory,
} from './utils/filesystem'
import { EMPTY_PROJECT, type NoodlesProjectJSON, safeStringify } from './utils/serialization'

// Represents a Noodles project stored in the file system
export interface FileSystemProject {
  directoryHandle: FileSystemDirectoryHandle
  projectFileHandle: FileSystemFileHandle // The noodles.json file handle
  name: string // Project name (directory name)
  projectData: NoodlesProjectJSON // The project data
  dataDirectoryHandle?: FileSystemDirectoryHandle // Optional data directory handle for assets
}

// Result type for file system operations
export type FileSystemResult<T> =
  | { success: true; data: T }
  | { success: false; error: FileSystemError }

// Error types for file system operations
export interface FileSystemError {
  type:
    | 'permission-denied'
    | 'not-found'
    | 'unsupported'
    | 'invalid-state'
    | 'security-error'
    | 'abort-error'
    | 'already-exists'
    | 'unknown'
  message: string // Human-readable error message
  details?: string // Optional error details or recovery suggestions
  originalError?: unknown // Original error object if available
}

const PROJECT_FILE_NAME = 'noodles.json'
const DATA_DIRECTORY_NAME = 'data'

// ============================================================================
// Helper Functions
// ============================================================================

function handleError(error: unknown, operation: string): FileSystemError {
  if (error instanceof Error) {
    // Handle DOMException errors
    if ('name' in error) {
      const domError = error as DOMException
      switch (domError.name) {
        case 'NotAllowedError':
          return {
            type: 'permission-denied',
            message: `Failed to ${operation}: Permission denied`,
            details: domError.message,
            originalError: error,
          }
        case 'NotFoundError':
          return {
            type: 'not-found',
            message: `Failed to ${operation}: File or directory not found`,
            details: domError.message,
            originalError: error,
          }
        case 'InvalidStateError':
          return {
            type: 'invalid-state',
            message: `Failed to ${operation}: Invalid state`,
            details: domError.message,
            originalError: error,
          }
        case 'SecurityError':
          return {
            type: 'security-error',
            message: `Failed to ${operation}: Security error`,
            details: domError.message,
            originalError: error,
          }
        case 'AbortError':
          return {
            type: 'abort-error',
            message: `Failed to ${operation}: Operation was aborted`,
            details: domError.message,
            originalError: error,
          }
      }
    }

    return {
      type: 'unknown',
      message: `Failed to ${operation}`,
      details: error.message,
      originalError: error,
    }
  }

  return {
    type: 'unknown',
    message: `Failed to ${operation}: An unknown error occurred`,
    originalError: error,
  }
}

async function getProjectDirectoryHandle(
  type: StorageType,
  projectName: string,
  promptIfMissing = false
): Promise<FileSystemResult<FileSystemDirectoryHandle>> {
  switch (type) {
    case 'fileSystemAccess': {
      try {
        // Try to get directory handle from cache
        let projectDirectory: FileSystemDirectoryHandle | null = null
        const cached = await directoryHandleCache.getCachedHandle(projectName)

        if (cached) {
          const isValid = await directoryHandleCache.validateHandle(projectName)
          if (isValid) {
            projectDirectory = cached.handle
          }
        }

        // If no cached handle or invalid, maybe prompt user to select directory
        if (!projectDirectory && promptIfMissing) {
          projectDirectory = await selectDirectory()
        }

        if (!projectDirectory) {
          return {
            success: false,
            error: {
              type: 'not-found',
              message: `No cached directory handle found for project: ${projectName}`,
            },
          }
        }

        const hasPermission = await requestPermission(projectDirectory, 'readwrite')
        if (!hasPermission) {
          return {
            success: false,
            error: {
              type: 'permission-denied',
              message: `Permission denied to write to directory: ${projectDirectory.name}`,
            },
          }
        }

        // Cache the directory handle for future use
        await directoryHandleCache.cacheHandle(projectName, projectDirectory, projectDirectory.name)

        return {
          success: true,
          data: projectDirectory,
        }
      } catch (error) {
        return {
          success: false,
          error: handleError(error, 'get project directory handle'),
        }
      }
    }

    case 'opfs': {
      try {
        const root = await getOPFSRoot()
        const directoryHandle = await root.getDirectoryHandle(projectName, { create: false })
        return {
          success: true,
          data: directoryHandle,
        }
      } catch (error) {
        return {
          success: false,
          error: {
            type: 'not-found',
            message: `Project directory not found in OPFS: ${projectName}`,
            details: error instanceof Error ? error.message : 'Unknown error',
            originalError: error,
          },
        }
      }
    }

    default:
      return {
        success: false,
        error: {
          type: 'unsupported',
          message: `Unsupported storage type: ${type}`,
        },
      }
  }
}

// ============================================================================
// Storage Abstraction Functions
// ============================================================================

export async function save(
  type: StorageType,
  projectName: string,
  projectData: NoodlesProjectJSON
): Promise<FileSystemResult<FileSystemProject>> {
  const result = await getProjectDirectoryHandle(type, projectName, true)
  if (!result.success) {
    return result
  }

  try {
    const projectDirectory = result.data

    // Serialize and write noodles.json
    const projectJson = safeStringify(projectData)
    await writeFileToDirectory(projectDirectory, PROJECT_FILE_NAME, projectJson)

    const projectFileHandle = await projectDirectory.getFileHandle(PROJECT_FILE_NAME)

    return {
      success: true,
      data: {
        directoryHandle: projectDirectory,
        projectFileHandle,
        name: projectName,
        projectData,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'save project'),
    }
  }
}

export async function checkProjectExists(type: StorageType, projectName: string) {
  const result = await getProjectDirectoryHandle(type, projectName, false)
  if (result.success) {
    const projectDirectory = result.data
    return await fileExists(projectDirectory, PROJECT_FILE_NAME)
  }
  return false
}

// Loading with fileSystemAccess never prompts without a user gesture
// OPFS always has access to its directories
// If prompt needed, do it externally and use fromProjectDirectory param
export async function load(
  type: StorageType,
  fromProject: string | FileSystemDirectoryHandle
): Promise<FileSystemResult<FileSystemProject>> {
  let projectDirectory: FileSystemDirectoryHandle
  let projectName: string

  if (typeof fromProject === 'string') {
    // Only check cache on load since prompting without a user gesture throws.
    const result = await getProjectDirectoryHandle(type, fromProject, false)
    if (!result.success) {
      return result
    }
    projectDirectory = result.data
    projectName = fromProject
  } else {
    projectDirectory = fromProject
    projectName = fromProject.name
  }

  try {
    const exists = await fileExists(projectDirectory, PROJECT_FILE_NAME)
    if (!exists) {
      return {
        success: false,
        error: {
          type: 'not-found',
          message: `Project file not found: ${PROJECT_FILE_NAME}`,
        },
      }
    }

    const projectJson = await readFileFromDirectory(projectDirectory, PROJECT_FILE_NAME)
    const parsed = JSON.parse(projectJson) as Partial<NoodlesProjectJSON>
    const projectData = {
      ...EMPTY_PROJECT,
      ...parsed,
    } as NoodlesProjectJSON

    const projectFileHandle = await projectDirectory.getFileHandle(PROJECT_FILE_NAME)

    return {
      success: true,
      data: {
        directoryHandle: projectDirectory,
        projectFileHandle,
        name: projectName,
        projectData,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'load project'),
    }
  }
}

// Read an asset file from a project's data directory
export async function readAsset(
  type: StorageType,
  projectName: string,
  fileName: string
): Promise<FileSystemResult<string>> {
  const projectDirectory = await getProjectDirectoryHandle(type, projectName, true)
  if (!projectDirectory.success) {
    return projectDirectory
  }

  try {
    const hasDataDir = await directoryExists(projectDirectory.data, DATA_DIRECTORY_NAME)
    if (!hasDataDir) {
      return {
        success: false,
        error: {
          type: 'not-found',
          message: 'Data directory not found',
        },
      }
    }

    const dataDirectory = await projectDirectory.data.getDirectoryHandle(DATA_DIRECTORY_NAME)
    const contents = await readFileFromDirectory(dataDirectory, fileName)

    return {
      success: true,
      data: contents,
    }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'read asset file'),
    }
  }
}

// Check if an asset file exists in a project's data directory
export async function checkAssetExists(
  type: StorageType,
  projectName: string,
  fileName: string
): Promise<boolean> {
  const projectDirectory = await getProjectDirectoryHandle(type, projectName, true)
  if (!projectDirectory.success) {
    return false
  }

  try {
    const hasDataDir = await directoryExists(projectDirectory.data, DATA_DIRECTORY_NAME)
    if (!hasDataDir) {
      return false
    }
    const dataDirectory = await projectDirectory.data.getDirectoryHandle(DATA_DIRECTORY_NAME)
    return await fileExists(dataDirectory, fileName)
  } catch (_error) {
    return false
  }
}

// Write an asset file to a project's data directory
export async function writeAsset(
  type: StorageType,
  projectName: string,
  fileName: string,
  contents: string | Blob
): Promise<FileSystemResult<void>> {
  const projectDirectory = await getProjectDirectoryHandle(type, projectName, true)
  if (!projectDirectory.success) {
    return projectDirectory
  }

  try {
    const dataDirectory = await projectDirectory.data.getDirectoryHandle(DATA_DIRECTORY_NAME, {
      create: true,
    })

    await writeFileToDirectory(dataDirectory, fileName, contents)

    return {
      success: true,
      data: undefined,
    }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'write asset file'),
    }
  }
}
