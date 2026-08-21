import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, type LegacyEditorSettings, up } from './015-remove-layout-mode'

function makeProject(overrides: Partial<NoodlesProjectJSON> = {}): NoodlesProjectJSON {
  return {
    version: 14,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    timeline: {},
    ...overrides,
  }
}

describe('015-remove-layout-mode', () => {
  it('removes layoutMode and preserves other editor settings', async () => {
    const editorSettings: LegacyEditorSettings = {
      layoutMode: 'noodles-on-top',
      showOverlay: false,
      showDebugInfo: true,
    }
    const project = makeProject({ editorSettings })

    const migrated = await up(project)

    expect(migrated.editorSettings).toEqual({ showOverlay: false, showDebugInfo: true })
  })

  it('returns the project unchanged when there is no layoutMode', async () => {
    const project = makeProject({ editorSettings: { showOverlay: true } })

    const migrated = await up(project)

    expect(migrated).toBe(project)
  })

  it('returns the project unchanged when editorSettings is absent', async () => {
    const project = makeProject()

    const migrated = await up(project)

    expect(migrated).toBe(project)
  })

  it('restores split as the default layoutMode on downgrade', async () => {
    const project = makeProject({ editorSettings: { showOverlay: true } })

    const downgraded = await down(project)

    expect(downgraded.editorSettings).toEqual({ showOverlay: true, layoutMode: 'split' })
  })

  it('round-trips: up strips what down adds', async () => {
    const project = makeProject({ editorSettings: { showDebugInfo: false } })

    const roundTripped = await up(await down(project))

    expect(roundTripped.editorSettings).toEqual({ showDebugInfo: false })
  })
})
