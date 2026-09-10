import type { EditorSettings, NoodlesProjectJSON } from '../utils/serialization'

// EditorSettings as of schema v9, when layoutMode still existed (removed in migration 015)
export type EditorSettingsV9 = EditorSettings & {
  layoutMode?: 'split' | 'noodles-on-top' | 'output-on-top'
}

// Migration to move editor settings from Theatre.js staticOverrides to project-level settings
//
// This migration:
// 1. Extracts editor settings (layoutMode, showOverlay) from Theatre.js staticOverrides
// 2. Adds them as top-level project settings
// 3. Removes the editor object from Theatre.js staticOverrides to clean up

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, ...rest } = project

  // Extract editor settings from Theatre.js staticOverrides
  const sheetsById = (timeline as any)?.sheetsById || {}
  const noodlesSheet = sheetsById.Noodles || {}
  const staticOverrides = noodlesSheet.staticOverrides || {}
  const byObject = staticOverrides.byObject || {}
  const editorOverrides = byObject.editor || {}

  // Create editor settings object with defaults
  const editorSettings: EditorSettingsV9 = {
    layoutMode: editorOverrides.layoutMode || 'noodles-on-top',
    showOverlay: editorOverrides.showOverlay !== undefined ? editorOverrides.showOverlay : true,
  }

  // Remove editor from staticOverrides
  const { editor: _, ...restOfObjects } = byObject
  const newStaticOverrides = {
    ...staticOverrides,
    byObject: restOfObjects,
  }

  // Update timeline without editor staticOverrides
  const newTimeline = {
    ...timeline,
    sheetsById: {
      ...sheetsById,
      Noodles: {
        ...noodlesSheet,
        staticOverrides: newStaticOverrides,
      },
    },
  }

  return {
    ...rest,
    timeline: newTimeline,
    editorSettings,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { editorSettings, timeline, ...rest } = project as NoodlesProjectJSON & {
    editorSettings?: EditorSettingsV9
  }

  // Put editor settings back into Theatre.js staticOverrides
  const sheetsById = (timeline as any)?.sheetsById || {}
  const noodlesSheet = sheetsById.Noodles || {}
  const staticOverrides = noodlesSheet.staticOverrides || {}
  const byObject = staticOverrides.byObject || {}

  const newTimeline = {
    ...timeline,
    sheetsById: {
      ...sheetsById,
      Noodles: {
        ...noodlesSheet,
        staticOverrides: {
          ...staticOverrides,
          byObject: {
            ...byObject,
            editor: {
              layoutMode: editorSettings?.layoutMode || 'noodles-on-top',
              showOverlay:
                editorSettings?.showOverlay !== undefined ? editorSettings.showOverlay : true,
            },
          },
        },
      },
    },
  }

  return {
    ...rest,
    timeline: newTimeline,
  }
}
