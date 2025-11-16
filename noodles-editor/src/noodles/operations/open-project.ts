/**
 * Open Project operation.
 *
 * Opens a project from a workspace (prompts for workspace and project selection).
 */

import type { Operation, OperationContext } from './types'

/**
 * Open project operation
 *
 * Flow:
 * 1. Select workspace (shows recent workspaces)
 * 2. If folder workspace without name, prompt for name and cache
 * 3. List projects in workspace
 * 4. Select project from list
 * 5. Load project data
 * 6. Update state to open project
 */
export async function* openProjectOperation(context: OperationContext): Operation<void> {
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

  // List projects in workspace
  const projects = await context.listProjects(workspace)

  // Select project
  const projectName = yield {
    type: 'select-project',
    workspace,
    projects,
  }
  if (!projectName) return

  // Load project
  await context.loadProject(workspace, projectName)

  // Update state
  context.setWorkspace(workspace)
  context.setActiveProject(projectName)
  context.updateURL(workspace.name, projectName)
  context.updateRecent(workspace, projectName)
}
