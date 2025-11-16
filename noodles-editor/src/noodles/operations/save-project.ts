/**
 * Save Project operation.
 *
 * Saves the current project to the current workspace.
 */

import type { Operation, OperationContext } from './types'

/**
 * Save current project operation
 *
 * Flow:
 * 1. Ensure workspace selected (prompt if not)
 * 2. Check workspace is not read-only
 * 3. Ensure project name exists (prompt if not - "Save As" flow)
 * 4. Get current project data
 * 5. Save to workspace
 * 6. Update recent access
 */
export async function* saveProjectOperation(
	context: OperationContext
): Operation<void> {
	// Ensure workspace selected
	if (!context.workspace) {
		const workspace = yield { type: 'select-workspace' }
		if (!workspace) return
		context.setWorkspace(workspace)
	}

	// Check read-only
	if (context.workspace.type === 'examples') {
		yield { type: 'error', message: 'Cannot save to read-only workspace' }
		return
	}

	// Ensure project name exists (if not, this becomes "Save As")
	if (!context.activeProject) {
		const name = yield { type: 'prompt-name' }
		if (!name) return

		// Check conflict
		const exists = await context.checkProjectExists(context.workspace, name)
		if (exists) {
			const replace = yield { type: 'confirm-replace', projectName: name }
			if (!replace) return
		}

		context.setActiveProject(name)
	}

	// Get current project data and save
	const projectData = context.getCurrentProjectData()
	await context.saveProject(context.workspace, context.activeProject, projectData)

	// Update URL and recent
	context.updateURL(context.workspace.name, context.activeProject)
	context.updateRecent(context.workspace, context.activeProject)
}
