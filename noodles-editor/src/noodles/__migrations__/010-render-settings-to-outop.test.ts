import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './010-render-settings-to-outop'

describe('010-render-settings-to-outop', () => {
  it('should migrate render settings from Theatre.js to OutOp', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              vis: null,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                render: {
                  display: 'responsive',
                  resolution: { width: 3840, height: 2160 },
                  lod: 1.5,
                },
                editor: {
                  someOtherSetting: 'value',
                },
              },
            },
          },
        },
      },
    }

    const migrated = await up(project)

    // Should have render settings in OutOp inputs
    const outOp = migrated.nodes.find(n => n.type === 'OutOp')
    expect(outOp?.data.inputs.display).toBe('responsive')
    expect(outOp?.data.inputs.resolution).toEqual({ width: 3840, height: 2160 })
    expect(outOp?.data.inputs.lod).toBe(1.5)

    // Should remove render from Theatre.js staticOverrides
    const byObject = (migrated.timeline as any).sheetsById.Noodles.staticOverrides.byObject
    expect(byObject.render).toBeUndefined()

    // Should preserve other staticOverrides
    expect(byObject.editor).toEqual({
      someOtherSetting: 'value',
    })
  })

  it('should handle missing render settings gracefully', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              vis: null,
            },
          },
        },
      ],
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

    // Should not modify nodes if no render settings exist
    expect(migrated).toEqual(project)
  })

  it('should handle partial render settings', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              vis: null,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                render: {
                  resolution: { width: 2560, height: 1440 },
                },
              },
            },
          },
        },
      },
    }

    const migrated = await up(project)

    // Should only migrate settings that exist
    const outOp = migrated.nodes.find(n => n.type === 'OutOp')
    expect(outOp?.data.inputs.resolution).toEqual({ width: 2560, height: 1440 })
    expect(outOp?.data.inputs.display).toBeUndefined()
    expect(outOp?.data.inputs.lod).toBeUndefined()
  })

  it('should handle projects without OutOp', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/viewer',
          type: 'ViewerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                render: {
                  display: 'fixed',
                },
              },
            },
          },
        },
      },
    }

    const migrated = await up(project)

    // Should still remove render from Theatre.js even without OutOp
    const byObject = (migrated.timeline as any).sheetsById.Noodles.staticOverrides.byObject
    expect(byObject.render).toBeUndefined()
  })

  it('should migrate back down correctly', async () => {
    const projectWithSettings: NoodlesProjectJSON = {
      version: 10,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              vis: null,
              display: 'responsive',
              resolution: { width: 3840, height: 2160 },
              lod: 1.5,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                editor: {
                  someOtherSetting: 'value',
                },
              },
            },
          },
        },
      },
    }

    const migrated = await down(projectWithSettings)

    // Should remove render settings from OutOp
    const outOp = migrated.nodes.find(n => n.type === 'OutOp')
    expect(outOp?.data.inputs.display).toBeUndefined()
    expect(outOp?.data.inputs.resolution).toBeUndefined()
    expect(outOp?.data.inputs.lod).toBeUndefined()
    expect(outOp?.data.inputs.vis).toBe(null) // Should preserve other inputs

    // Should have render back in Theatre.js staticOverrides
    const byObject = (migrated.timeline as any).sheetsById.Noodles.staticOverrides.byObject
    expect(byObject.render).toEqual({
      display: 'responsive',
      resolution: { width: 3840, height: 2160 },
      lod: 1.5,
    })

    // Should preserve other staticOverrides
    expect(byObject.editor).toEqual({
      someOtherSetting: 'value',
    })
  })

  it('should handle down migration without render settings', async () => {
    const project: NoodlesProjectJSON = {
      version: 10,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              vis: null,
            },
          },
        },
      ],
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

    const migrated = await down(project)

    // Should not modify project if no render settings exist
    expect(migrated).toEqual(project)
  })

  it('should round-trip correctly', async () => {
    const original: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              vis: null,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Noodles: {
            staticOverrides: {
              byObject: {
                render: {
                  display: 'fixed',
                  resolution: { width: 1920, height: 1080 },
                  lod: 2,
                },
              },
            },
          },
        },
      },
    }

    const migrated = await up(original)
    const reverted = await down(migrated)

    // Timeline should be equivalent
    const originalRender = (original.timeline as any).sheetsById.Noodles.staticOverrides.byObject.render
    const revertedRender = (reverted.timeline as any).sheetsById.Noodles.staticOverrides.byObject.render
    expect(revertedRender).toEqual(originalRender)

    // OutOp should be back to original state
    const originalOutOp = original.nodes.find(n => n.type === 'OutOp')
    const revertedOutOp = reverted.nodes.find(n => n.type === 'OutOp')
    expect(revertedOutOp?.data.inputs).toEqual(originalOutOp?.data.inputs)
  })
})
