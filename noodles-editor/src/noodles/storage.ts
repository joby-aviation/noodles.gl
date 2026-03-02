import { directoryHandleCache } from './utils/directory-handle-cache'
import type { StorageType } from './utils/filesystem'
import {
  directoryExists,
  fileExists,
  getOPFSRoot,
  readFileFromDirectory,
  readFileFromDirectoryBinary,
  requestPermission,
  selectDirectory,
  writeFileToDirectory,
} from './utils/filesystem'
import { EMPTY_PROJECT, type NoodlesProjectJSON, safeStringify } from './utils/serialization'

// Pre-load all example asset URLs at build time using import.meta.glob
// This creates a lookup map: '../examples/project-name/file.ext' -> URL string
const exampleAssetUrls: Record<string, string> = import.meta.glob('../examples/**/*', {
  eager: true,
  import: 'default',
  query: '?url',
})

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

export async function getProjectDirectoryHandle(
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

    case 'publicFolder': {
      // Public folder projects don't have directory handles
      return {
        success: false,
        error: {
          type: 'not-found',
          message: 'Public folder projects do not have directory handles',
        },
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

    // Cache the directory handle if loaded via File System Access API
    // This ensures the handle is available on refresh and save operations
    if (type === 'fileSystemAccess' && typeof fromProject !== 'string') {
      await directoryHandleCache.cacheHandle(projectName, projectDirectory, projectDirectory.name)
    }

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

// Read an asset file from a project's data directory or from public folder
export async function readAsset(
  type: StorageType,
  projectName: string,
  fileName: string
): Promise<FileSystemResult<string>> {
  // For public folder projects, fetch from asset URLs
  if (type === 'publicFolder') {
    try {
      // Build the key that import.meta.glob uses: '../examples/project-name/file.ext'
      const assetKey = `../examples/${projectName}/${fileName}`
      const url = exampleAssetUrls[assetKey]

      if (!url) {
        return {
          success: false,
          error: {
            type: 'not-found',
            message: `Asset not found: ${fileName}`,
            details: `Path: examples/${projectName}/${fileName}`,
          },
        }
      }

      // Fetch the file contents from the URL
      const response = await fetch(url)
      if (!response.ok) {
        return {
          success: false,
          error: {
            type: 'not-found',
            message: `Asset not found: ${fileName}`,
            details: `Path: ${url}`,
          },
        }
      }

      const contents = await response.text()
      return {
        success: true,
        data: contents,
      }
    } catch (error) {
      return {
        success: false,
        error: handleError(error, 'read asset file from public folder'),
      }
    }
  }

  // For filesystem-based storage types (fileSystemAccess or opfs)
  // Try to get directory handle, prompting user if not found in cache
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
    const filenameWithoutDir = fileName.replace(/^data\//, '') // Remove data/ prefix if present
    const contents = await readFileFromDirectory(dataDirectory, filenameWithoutDir)

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

// Read a binary asset file from a project's data directory or from public folder
export async function readAssetBinary(
  type: StorageType,
  projectName: string,
  fileName: string
): Promise<FileSystemResult<ArrayBuffer>> {
  // For public folder projects, fetch from asset URLs
  if (type === 'publicFolder') {
    try {
      // Build the key that import.meta.glob uses: '../examples/project-name/file.ext'
      const assetKey = `../examples/${projectName}/${fileName}`
      const url = exampleAssetUrls[assetKey]

      if (!url) {
        return {
          success: false,
          error: {
            type: 'not-found',
            message: `Asset not found: ${fileName}`,
            details: `Path: examples/${projectName}/${fileName}`,
          },
        }
      }

      // Fetch the file contents from the URL as binary
      const response = await fetch(url)
      if (!response.ok) {
        return {
          success: false,
          error: {
            type: 'not-found',
            message: `Asset not found: ${fileName}`,
            details: `Path: ${url}`,
          },
        }
      }

      const contents = await response.arrayBuffer()
      return {
        success: true,
        data: contents,
      }
    } catch (error) {
      return {
        success: false,
        error: handleError(error, 'read binary asset file from public folder'),
      }
    }
  }

  // For filesystem-based storage types (fileSystemAccess or opfs)
  // Try to get directory handle, prompting user if not found in cache
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
    const filenameWithoutDir = fileName.replace(/^data\//, '') // Remove data/ prefix if present
    const contents = await readFileFromDirectoryBinary(dataDirectory, filenameWithoutDir)

    return {
      success: true,
      data: contents,
    }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'read binary asset file'),
    }
  }
}

// Check if an asset file exists in a project's data directory
export async function checkAssetExists(
  type: StorageType,
  projectName: string,
  fileName: string
): Promise<boolean> {
  // For public folder projects, check if asset exists in URL map
  if (type === 'publicFolder') {
    const assetKey = `../examples/${projectName}/${fileName}`
    return assetKey in exampleAssetUrls
  }

  // For filesystem-based storage types
  const projectDirectory = await getProjectDirectoryHandle(type, projectName, false)
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
  // Public folder projects are read-only
  if (type === 'publicFolder') {
    return {
      success: false,
      error: {
        type: 'unsupported',
        message: 'Cannot write assets to public folder projects',
      },
    }
  }

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

// ============================================================================
// Save As / Rename Utilities
// ============================================================================

// Check if a project has a data directory with files
export async function hasDataDirectory(type: StorageType, projectName: string): Promise<boolean> {
  // For public folder projects, check if any data files exist in URL map
  if (type === 'publicFolder') {
    const prefix = `../examples/${projectName}/data/`
    return Object.keys(exampleAssetUrls).some(key => key.startsWith(prefix))
  }

  const projectDirectory = await getProjectDirectoryHandle(type, projectName, false)
  if (!projectDirectory.success) {
    return false
  }

  try {
    const hasDataDir = await directoryExists(projectDirectory.data, DATA_DIRECTORY_NAME)
    if (!hasDataDir) {
      return false
    }

    // Check if data directory has any files
    const dataDirectory = await projectDirectory.data.getDirectoryHandle(DATA_DIRECTORY_NAME)
    for await (const _entry of dataDirectory.values()) {
      return true // Has at least one entry
    }
    return false
  } catch (_error) {
    return false
  }
}

// List all files in a project's data directory (recursively)
export async function listDataFiles(
  type: StorageType,
  projectName: string
): Promise<FileSystemResult<string[]>> {
  // For public folder projects, list from URL map
  if (type === 'publicFolder') {
    const prefix = `../examples/${projectName}/data/`
    const files = Object.keys(exampleAssetUrls)
      .filter(key => key.startsWith(prefix))
      .map(key => key.replace(prefix, ''))
    return { success: true, data: files }
  }

  const projectDirectory = await getProjectDirectoryHandle(type, projectName, false)
  if (!projectDirectory.success) {
    return projectDirectory
  }

  try {
    const hasDataDir = await directoryExists(projectDirectory.data, DATA_DIRECTORY_NAME)
    if (!hasDataDir) {
      return { success: true, data: [] }
    }

    const dataDirectory = await projectDirectory.data.getDirectoryHandle(DATA_DIRECTORY_NAME)
    const files: string[] = []

    // Recursively list all files
    async function listRecursive(dir: FileSystemDirectoryHandle, prefix: string) {
      for await (const entry of dir.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.kind === 'file') {
          files.push(path)
        } else if (entry.kind === 'directory') {
          const subDir = await dir.getDirectoryHandle(entry.name)
          await listRecursive(subDir, path)
        }
      }
    }

    await listRecursive(dataDirectory, '')
    return { success: true, data: files }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'list data files'),
    }
  }
}

// Copy all files from source data directory to target directory
export async function copyDataDirectory(
  sourceDirectory: FileSystemDirectoryHandle,
  targetDirectory: FileSystemDirectoryHandle
): Promise<FileSystemResult<void>> {
  try {
    // Check if source has data directory
    const hasDataDir = await directoryExists(sourceDirectory, DATA_DIRECTORY_NAME)
    if (!hasDataDir) {
      return { success: true, data: undefined } // Nothing to copy
    }

    const sourceDataDir = await sourceDirectory.getDirectoryHandle(DATA_DIRECTORY_NAME)
    const targetDataDir = await targetDirectory.getDirectoryHandle(DATA_DIRECTORY_NAME, {
      create: true,
    })

    // Recursively copy all files
    async function copyRecursive(
      sourceDir: FileSystemDirectoryHandle,
      targetDir: FileSystemDirectoryHandle
    ) {
      for await (const entry of sourceDir.values()) {
        if (entry.kind === 'file') {
          const fileHandle = await sourceDir.getFileHandle(entry.name)
          const file = await fileHandle.getFile()
          const contents = await file.arrayBuffer()
          await writeFileToDirectory(targetDir, entry.name, contents)
        } else if (entry.kind === 'directory') {
          const sourceSubDir = await sourceDir.getDirectoryHandle(entry.name)
          const targetSubDir = await targetDir.getDirectoryHandle(entry.name, { create: true })
          await copyRecursive(sourceSubDir, targetSubDir)
        }
      }
    }

    await copyRecursive(sourceDataDir, targetDataDir)
    return { success: true, data: undefined }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'copy data directory'),
    }
  }
}

// Copy data files from a public folder project to a target directory
export async function copyPublicFolderData(
  projectName: string,
  targetDirectory: FileSystemDirectoryHandle
): Promise<FileSystemResult<void>> {
  try {
    const prefix = `../examples/${projectName}/data/`
    const dataFiles = Object.entries(exampleAssetUrls).filter(([key]) => key.startsWith(prefix))

    if (dataFiles.length === 0) {
      return { success: true, data: undefined } // Nothing to copy
    }

    // Create data directory in target
    const targetDataDir = await targetDirectory.getDirectoryHandle(DATA_DIRECTORY_NAME, {
      create: true,
    })

    const failedFiles: string[] = []

    for (const [key, url] of dataFiles) {
      const relativePath = key.replace(prefix, '')
      const pathParts = relativePath.split('/')
      const fileName = pathParts.pop()!

      // Create subdirectories if needed
      let currentDir = targetDataDir
      for (const part of pathParts) {
        currentDir = await currentDir.getDirectoryHandle(part, { create: true })
      }

      // Fetch and write file
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`Failed to fetch ${url}`)
        failedFiles.push(relativePath)
        continue
      }
      const contents = await response.arrayBuffer()
      await writeFileToDirectory(currentDir, fileName, contents)
    }

    if (failedFiles.length > 0) {
      return {
        success: false,
        error: {
          type: 'unknown',
          message: `Failed to copy ${failedFiles.length} data file(s)`,
          details: `Failed files: ${failedFiles.join(', ')}`,
        },
      }
    }

    return { success: true, data: undefined }
  } catch (error) {
    return {
      success: false,
      error: handleError(error, 'copy public folder data'),
    }
  }
}
