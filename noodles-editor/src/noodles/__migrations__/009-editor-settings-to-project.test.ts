import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './009-editor-settings-to-project'

describe('009-editor-settings-to-project', () => {
  it('should migrate editor settings from Theatre.js to project-level', async () => {
    const project: NoodlesProjectJSON = {
      version: 8,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                editor: {
                  layoutMode: 'split',
                  showOverlay: false,
                },
                render: {
                  someRenderSetting: 'value',
                },
              },
            },
          },
        },
      },
    }

    const migrated = await up(project)

    // Should have editor settings at project level
    expect(migrated.editorSettings).toEqual({
      layoutMode: 'split',
      showOverlay: false,
    })

    // Should remove editor from Theatre.js staticOverrides
    const byObject = (migrated.timeline as any).sheetsById.Noodles.staticOverrides.byObject
    expect(byObject.editor).toBeUndefined()

    // Should preserve other staticOverrides
    expect(byObject.render).toEqual({
      someRenderSetting: 'value',
    })
  })

  it('should use defaults when editor settings are missing', async () => {
    const project: NoodlesProjectJSON = {
      version: 8,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {},
            },
          },
        },
      },
    }

    const migrated = await up(project)

    expect(migrated.editorSettings).toEqual({
      layoutMode: 'noodles-on-top',
      showOverlay: true,
    })
  })

  it('should handle missing timeline gracefully', async () => {
    const project: NoodlesProjectJSON = {
      version: 8,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    expect(migrated.editorSettings).toEqual({
      layoutMode: 'noodles-on-top',
      showOverlay: true,
    })
  })

  it('should migrate back down correctly', async () => {
    const projectWithSettings: NoodlesProjectJSON = {
      version: 9,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                render: {
                  someRenderSetting: 'value',
                },
              },
            },
          },
        },
      },
      editorSettings: {
        layoutMode: 'output-on-top',
        showOverlay: false,
      },
    }

    const migrated = await down(projectWithSettings)

    // Should not have editorSettings at project level
    expect((migrated as any).editorSettings).toBeUndefined()

    // Should have editor back in Theatre.js staticOverrides
    const byObject = (migrated.timeline as any).sheetsById.Noodles.staticOverrides.byObject
    expect(byObject.editor).toEqual({
      layoutMode: 'output-on-top',
      showOverlay: false,
    })

    // Should preserve other staticOverrides
    expect(byObject.render).toEqual({
      someRenderSetting: 'value',
    })
  })

  it('should round-trip correctly', async () => {
    const original: NoodlesProjectJSON = {
      version: 8,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                editor: {
                  layoutMode: 'noodles-on-top',
                  showOverlay: true,
                },
              },
            },
          },
        },
      },
    }

    const migrated = await up(original)
    const reverted = await down(migrated)

    // Timeline should be equivalent (might not be identical due to object ordering)
    const originalEditor = (original.timeline as any).sheetsById.Noodles.staticOverrides.byObject.editor
    const revertedEditor = (reverted.timeline as any).sheetsById.Noodles.staticOverrides.byObject.editor
    expect(revertedEditor).toEqual(originalEditor)
  })
})
