// Migration to remove layoutMode from EditorSettings.
// The layout is now always split-view with resizable panels managed by react-resizable-panels.
// Layout preferences (panel sizes/collapsed state) are stored in localStorage, not project files.

import type { EditorSettings, NoodlesProjectJSON } from '../utils/serialization'

// layoutMode existed in project files before this migration but is gone from EditorSettings
export type LegacyEditorSettings = EditorSettings & {
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const settings = project.editorSettings as LegacyEditorSettings | undefined
  if (!settings?.layoutMode) {
    return project
  }

  const { layoutMode: _layoutMode, ...restSettings } = settings

  return {
    ...project,
    editorSettings: restSettings,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  // Restore split mode as default when downgrading
  const editorSettings: LegacyEditorSettings = {
    ...project.editorSettings,
    layoutMode: 'split',
  }
  return {
    ...project,
    editorSettings,
  }
}
