/**
 * New Project operation.
 *
 * Creates a new empty project in the current workspace (or prompts to select one).
 */

import type { Operation, OperationContext } from './types'

/**
 * Create a new project operation
 *
 * Flow:
 * 1. Ensure workspace is selected (prompt if not)
 * 2. Check workspace is not read-only
 * 3. Prompt for project name
 * 4. Check for name conflicts (confirm replace if exists)
 * 5. Create empty project and save
 * 6. Update state to open new project
 */
export async function* newProjectOperation(context: OperationContext): Operation<void> {
  // Ensure workspace selected
  if (!context.workspace) {
    const workspace = yield { type: 'select-workspace' }
    if (!workspace) return
    context.setWorkspace(workspace)
  }

  // Check read-only
  if (context.workspace.type === 'examples') {
    yield { type: 'error', message: 'Cannot create in read-only workspace' }
    return
  }

  // Get project name
  const name = yield { type: 'prompt-name' }
  if (!name) return

  // Check conflict
  const exists = await context.checkProjectExists(context.workspace, name)
  if (exists) {
    const replace = yield { type: 'confirm-replace', projectName: name }
    if (!replace) return
  }

  // Create and save
  const newProject = context.getNewProjectTemplate()
  await context.saveProject(context.workspace, name, newProject)

  // Update state
  context.setActiveProject(name)
  context.updateURL(context.workspace.name, name)
  context.updateRecent(context.workspace, name)
}
