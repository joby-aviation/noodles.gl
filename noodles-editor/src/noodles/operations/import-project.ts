/**
 * Import Project operation.
 *
 * Imports a project from a .json file into the current workspace.
 */

import type { Operation, OperationContext } from './types'

/**
 * Import project from file operation
 *
 * Flow:
 * 1. Select JSON file to import
 * 2. Read and parse file
 * 3. Extract basename as default project name
 * 4. Ensure workspace selected (prompt if not)
 * 5. Check workspace is not read-only
 * 6. Prompt for project name (with basename default)
 * 7. Check for conflicts (confirm replace if exists)
 * 8. Save imported data
 * 9. Update state to open imported project
 */
export async function* importProjectOperation(
	context: OperationContext
): Operation<void> {
	// Select file
	const fileHandle = yield { type: 'select-file', accept: '.json' }
	if (!fileHandle) return

	// Read and parse
	const file = await fileHandle.getFile()
	const text = await file.text()
	const json = JSON.parse(text)

	// TODO: Add migration support if needed
	// const migrated = await migrateProject(json)

	// Extract basename for default name
	const defaultName = file.name.replace(/\.json$/, '')

	// Ensure workspace selected
	if (!context.workspace) {
		const workspace = yield { type: 'select-workspace' }
		if (!workspace) return
		context.setWorkspace(workspace)
	}

	// Check read-only
	if (context.workspace.type === 'examples') {
		yield { type: 'error', message: 'Cannot import to read-only workspace' }
		return
	}

	// Get project name
	const name = yield { type: 'prompt-name', defaultName }
	if (!name) return

	// Check conflict
	const exists = await context.checkProjectExists(context.workspace, name)
	if (exists) {
		const replace = yield { type: 'confirm-replace', projectName: name }
		if (!replace) return
	}

	// Save imported project
	await context.saveProject(context.workspace, name, json)

	// Update state
	context.setActiveProject(name)
	context.updateURL(context.workspace.name, name)
	context.updateRecent(context.workspace, name)
}
