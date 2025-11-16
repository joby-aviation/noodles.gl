/**
 * Built-in workspace providers for OPFS (browserStorage) and Examples.
 *
 * These workspaces are always available and don't require user selection:
 * - browserStorage: OPFS workspace for browser-based storage
 * - examples: Read-only workspace from public/noodles folder
 */

import type { Workspace } from './workspace-types'

/**
 * Get the built-in browserStorage workspace (OPFS)
 */
export async function getBrowserStorageWorkspace(): Promise<Workspace> {
  return {
    type: 'browserStorage',
    name: 'Browser Storage',
    // No handle - OPFS accessed via navigator.storage.getDirectory()
  }
}

/**
 * Get the built-in examples workspace (read-only)
 */
export function getExamplesWorkspace(): Workspace {
  return {
    type: 'examples',
    name: 'Examples',
    // No handle - examples accessed via fetch from public/noodles
  }
}

/**
 * Get all built-in workspaces
 */
export async function getBuiltinWorkspaces(): Promise<Workspace[]> {
  return [await getBrowserStorageWorkspace(), getExamplesWorkspace()]
}

/**
 * Check if a workspace is a built-in workspace
 */
export function isBuiltinWorkspace(workspace: Workspace): boolean {
  return workspace.type === 'browserStorage' || workspace.type === 'examples'
}

/**
 * Get workspace display name
 */
export function getWorkspaceDisplayName(workspace: Workspace): string {
  return workspace.name
}

/**
 * Get workspace description
 */
export function getWorkspaceDescription(workspace: Workspace): string {
  switch (workspace.type) {
    case 'browserStorage':
      return 'Projects stored in your browser (OPFS)'
    case 'examples':
      return 'Read-only example projects'
    case 'folder':
      return 'Projects stored in a local folder'
  }
}
