/**
 * Save As Project operation.
 *
 * Saves the current project with a new name in the current workspace.
 */

import type { Operation, OperationContext } from './types'

/**
 * Save As operation - save project with new name
 *
 * Flow:
 * 1. Ensure workspace selected (prompt if not)
 * 2. Check workspace is not read-only
 * 3. Prompt for new project name
 * 4. Check for name conflicts (confirm replace if exists)
 * 5. Get current project data and save with new name
 * 6. Update state to reflect new project name
 */
export async function* saveAsProjectOperation(
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

	// Get new project name
	const name = yield {
		type: 'prompt-name',
		defaultName: context.activeProject || undefined,
	}
	if (!name) return

	// Check conflict
	const exists = await context.checkProjectExists(context.workspace, name)
	if (exists) {
		const replace = yield { type: 'confirm-replace', projectName: name }
		if (!replace) return
	}

	// Get current project data and save with new name
	const projectData = context.getCurrentProjectData()
	await context.saveProject(context.workspace, name, projectData)

	// Update state to new project name
	context.setActiveProject(name)
	context.updateURL(context.workspace.name, name)
	context.updateRecent(context.workspace, name)
}
