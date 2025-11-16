/**
 * Switch Workspace operation.
 *
 * Switches to a different workspace (prompts for selection).
 */

import type { Operation, OperationContext } from './types'

/**
 * Switch workspace operation
 *
 * Flow:
 * 1. Select workspace (shows recent workspaces)
 * 2. If folder workspace without name, prompt for name and cache
 * 3. Update workspace state (clears active project)
 * 4. Update URL to reflect new workspace
 */
export async function* switchWorkspaceOperation(
	context: OperationContext
): Operation<void> {
	// Select workspace (with recent workspaces list)
	const workspace = yield {
		type: 'select-workspace',
		showRecent: true,
	}
	if (!workspace) return

	// If folder workspace, prompt for name (if not already named)
	if (workspace.type === 'folder' && !workspace.name) {
		const name = yield {
			type: 'name-workspace',
			defaultName: workspace.handle.name,
		}
		if (!name) return
		workspace.name = name
		await context.cacheWorkspace(workspace)
	}

	// Update workspace state (clear active project)
	context.setWorkspace(workspace)
	context.setActiveProject(null)
	context.updateURL(workspace.name, null)
}
