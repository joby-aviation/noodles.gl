// Migration to remove layoutMode from EditorSettings.
// The layout is now always split-view with resizable panels managed by react-resizable-panels.
// Layout preferences (panel sizes/collapsed state) are stored in localStorage, not project files.

import type { NoodlesProjectJSON } from '../utils/serialization'

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  if (!project.editorSettings?.layoutMode) {
    return project
  }

  const { layoutMode, ...restSettings } = project.editorSettings

  return {
    ...project,
    editorSettings: restSettings,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  // Restore split mode as default when downgrading
  return {
    ...project,
    editorSettings: {
      ...project.editorSettings,
      layoutMode: 'split',
    },
  }
}
