/**
 * Delete Project operation.
 *
 * Deletes a project from the current workspace with confirmation.
 */

import type { Operation, OperationContext} from './types'

/**
 * Delete project operation
 *
 * Flow:
 * 1. Ensure workspace exists
 * 2. Check workspace is not read-only
 * 3. Confirm deletion with "Are you sure?" dialog
 * 4. Delete project from workspace
 * 5. If deleted project was active, clear it from state
 * 6. Remove from recent projects
 */
export async function* deleteProjectOperation(
	context: OperationContext,
	projectName: string
): Operation<void> {
	// Ensure workspace exists
	if (!context.workspace) {
		yield { type: 'error', message: 'No workspace selected' }
		return
	}

	// Check read-only
	if (context.workspace.type === 'examples') {
		yield { type: 'error', message: 'Cannot delete from read-only workspace' }
		return
	}

	// Confirm deletion with "Are you sure?" guard
	const confirmed = yield {
		type: 'confirm-delete',
		projectName,
	}
	if (!confirmed) return

	// Delete project
	await context.deleteProject(context.workspace, projectName)

	// If deleted project was active, clear it
	if (context.activeProject === projectName) {
		context.setActiveProject(null)
		context.updateURL(context.workspace.name, null)
	}

	// Remove from recent
	context.removeFromRecent(context.workspace, projectName)
}
