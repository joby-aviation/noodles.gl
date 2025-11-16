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
 * Workspace object representing a project container
 */
export interface Workspace {
	/**
	 * Type of workspace
	 */
	type: WorkspaceType

	/**
	 * User-visible name (identifier for folder workspaces)
	 * - For folder: User-provided name (can differ from folder name)
	 * - For browserStorage: "Browser Storage"
	 * - For examples: "Examples"
	 */
	name: string

	/**
	 * Directory handle for folder workspaces
	 * Only present for 'folder' type
	 */
	handle?: FileSystemDirectoryHandle
}

/**
 * Cached workspace entry stored in IndexedDB
 *
 * Recent workspaces are computed at runtime by querying all entries
 * sorted by lastAccessed. No need for separate localStorage tracking.
 * Folder name can be retrieved from handle.name when needed.
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
	 * Last opened project in this workspace
	 */
	lastProject: string | null

	/**
	 * When the workspace was last accessed
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
