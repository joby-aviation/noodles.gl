/**
 * Workspace types and interfaces for the unified workspace architecture.
 *
 * Workspaces are top-level containers for projects:
 * - folder: User-selected directories (File System Access API)
 * - browserStorage: Built-in OPFS workspace
 * - examples: Built-in read-only examples workspace
 */

/**
 * Type of workspace storage
 */
export type WorkspaceType = 'folder' | 'browserStorage' | 'examples'

/**
 * Workspace object representing a project container (discriminated union)
 *
 * Each workspace type has specific properties:
 * - folder: User-selected directory with FileSystemDirectoryHandle
 * - browserStorage: OPFS workspace (no handle needed)
 * - examples: Read-only examples (no handle needed)
 */
export type Workspace =
  | {
      type: 'folder'
      name: string
      handle: FileSystemDirectoryHandle
    }
  | {
      type: 'browserStorage'
      name: string
    }
  | {
      type: 'examples'
      name: string
    }

/**
 * Cached workspace entry stored in IndexedDB
 *
 * Recent workspaces are computed at runtime by querying all entries
 * sorted by lastAccessed.
 *
 * Recent projects within a workspace are computed by scanning project
 * folders and sorting by file.lastModified from noodles.json handles.
 * No manual tracking needed - file system is the database.
 */
export interface CachedWorkspaceEntry {
  /**
   * Workspace name (unique identifier)
   */
  name: string

  /**
   * Directory handle (for folder workspaces)
   */
  handle: FileSystemDirectoryHandle

  /**
   * When the workspace was last accessed
   * Updated when opening/saving projects in this workspace
   */
  lastAccessed: Date

  /**
   * When the workspace was first cached
   */
  cached: Date
}

/**
 * Workspace-related error types
 */
export type WorkspaceErrorType =
  | 'permission-denied'
  | 'not-found'
  | 'invalid-handle'
  | 'name-collision'
  | 'read-only'
  | 'unsupported'

/**
 * Workspace error with type and details
 */
export interface WorkspaceError extends Error {
  type: WorkspaceErrorType
  workspace?: Workspace
  projectName?: string
}

/**
 * Helper to check if workspace is read-only
 */
export function isReadOnly(workspace: Workspace): boolean {
  return workspace.type === 'examples'
}

/**
 * Helper to get workspace display icon
 */
export function getWorkspaceIcon(workspace: Workspace): string {
  switch (workspace.type) {
    case 'browserStorage':
      return '📦'
    case 'examples':
      return '📚'
    case 'folder':
      return '📁'
  }
}

/**
 * Helper to create a workspace error
 */
export function createWorkspaceError(
  type: WorkspaceErrorType,
  message: string,
  workspace?: Workspace,
  projectName?: string
): WorkspaceError {
  const error = new Error(message) as WorkspaceError
  error.type = type
  error.workspace = workspace
  error.projectName = projectName
  return error
}
