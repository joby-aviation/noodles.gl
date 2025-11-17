/**
 * Operation types and dialog request types for the command pattern architecture.
 *
 * Operations are async generators that yield dialog requests and perform
 * menu actions (save, load, delete, etc.) in a linear, testable way.
 */

import type { Workspace } from '../storage/workspace-types'
import type { NoodlesProjectJSON } from '../utils/serialization'

/**
 * Dialog request types that operations can yield
 */
export type DialogRequest =
  | SelectWorkspaceRequest
  | NameWorkspaceRequest
  | SelectProjectRequest
  | PromptNameRequest
  | ConfirmReplaceRequest
  | ConfirmDeleteRequest
  | SelectFileRequest
  | ErrorRequest

/**
 * Request to select a workspace
 */
export interface SelectWorkspaceRequest {
  type: 'select-workspace'
  /**
   * Custom prompt message
   */
  prompt?: string
  /**
   * Whether to show recent workspaces
   */
  showRecent?: boolean
}

/**
 * Request to name a workspace (for folder workspaces)
 */
export interface NameWorkspaceRequest {
  type: 'name-workspace'
  /**
   * Default name (from folder handle)
   */
  defaultName: string
}

/**
 * Request to select a project from workspace
 */
export interface SelectProjectRequest {
  type: 'select-project'
  /**
   * Current workspace
   */
  workspace: Workspace
  /**
   * Available projects
   */
  projects: string[]
}

/**
 * Request to prompt for project name
 */
export interface PromptNameRequest {
  type: 'prompt-name'
  /**
   * Default name (e.g., from imported file basename)
   */
  defaultName?: string
  /**
   * Whether to validate name doesn't exist
   */
  validateExists?: boolean
}

/**
 * Request to confirm replacing existing project
 */
export interface ConfirmReplaceRequest {
  type: 'confirm-replace'
  /**
   * Name of project that will be replaced
   */
  projectName: string
}

/**
 * Request to confirm deleting project
 */
export interface ConfirmDeleteRequest {
  type: 'confirm-delete'
  /**
   * Name of project to delete
   */
  projectName: string
}

/**
 * Request to select a file
 */
export interface SelectFileRequest {
  type: 'select-file'
  /**
   * File type filter (e.g., '.json')
   */
  accept?: string
}

/**
 * Request to show an error dialog
 */
export interface ErrorRequest {
  type: 'error'
  /**
   * Error message to display
   */
  message: string
}

/**
 * Operation result
 */
export type OperationResult<T> =
  | { success: true; value: T }
  | { success: false; error: OperationError; cancelled: boolean }

/**
 * Operation error types
 */
export type OperationErrorType =
  | 'cancelled'
  | 'permission-denied'
  | 'not-found'
  | 'read-only'
  | 'validation'
  | 'unknown'

/**
 * Operation error with type and details
 */
export interface OperationError extends Error {
  type: OperationErrorType
  details?: unknown
}

/**
 * Cancellation error thrown when user cancels operation
 */
export class CancellationError extends Error implements OperationError {
  type: OperationErrorType = 'cancelled'

  constructor(message = 'Operation cancelled by user') {
    super(message)
    this.name = 'CancellationError'
  }
}

/**
 * Context provided to operations for accessing state and storage
 */
export interface OperationContext {
  // Current state
  workspace: Workspace | null
  activeProject: string | null

  // State setters
  setWorkspace: (workspace: Workspace) => void
  setActiveProject: (name: string | null) => void

  // Storage operations
  saveProject: (workspace: Workspace, name: string, data: NoodlesProjectJSON) => Promise<void>
  loadProject: (workspace: Workspace, name: string) => Promise<NoodlesProjectJSON>
  deleteProject: (workspace: Workspace, name: string) => Promise<void>
  listProjects: (workspace: Workspace) => Promise<string[]>
  checkProjectExists: (workspace: Workspace, name: string) => Promise<boolean>

  // Workspace operations
  cacheWorkspace: (workspace: Workspace) => Promise<void>
  getCachedWorkspace: (name: string) => Promise<Workspace | null>
  listCachedWorkspaces: () => Promise<Workspace[]>

  // Utility functions
  updateURL: (workspace: string, project: string | null) => void
  updateRecent: (workspace: Workspace, project: string) => void
  removeFromRecent: (workspace: Workspace, project: string) => void
  getNewProjectTemplate: () => NoodlesProjectJSON

  // Current project data
  getCurrentProjectData: () => NoodlesProjectJSON
}

/**
 * Operation generator type
 */
export type Operation<T = void> = AsyncGenerator<DialogRequest, T, any>

/**
 * Operation function type
 */
export type OperationFn<T = void> = (context: OperationContext, ...args: any[]) => Operation<T>

/**
 * Helper to create an operation error
 */
export function createOperationError(
  type: OperationErrorType,
  message: string,
  details?: unknown
): OperationError {
  const error = new Error(message) as OperationError
  error.type = type
  error.details = details
  return error
}
