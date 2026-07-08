import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { DEFAULT_RENDER_SETTINGS } from '../utils/serialization'
import { down, up } from './012-render-settings-to-outop'

describe('012-render-settings-to-outop', () => {
  it('should migrate render settings from project-level to OutOp inputs', async () => {
    const project: NoodlesProjectJSON = {
      version: 11,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
      renderSettings: {
        display: 'responsive',
        resolution: { width: 3840, height: 2160 },
        codec: 'hevc',
        framerate: 60,
      },
    }

    const migrated = await up(project)

    // Should not have renderSettings at project level
    expect((migrated as any).renderSettings).toBeUndefined()

    // Should have render settings in OutOp inputs
    const outNode = migrated.nodes.find(n => n.id === '/out')
    expect(outNode?.data?.inputs).toMatchObject({
      display: 'responsive',
      width: 3840,
      height: 2160,
      codec: 'hevc',
      framerate: 60,
      // Defaults for unspecified settings
      lod: DEFAULT_RENDER_SETTINGS.lod,
      waitForData: DEFAULT_RENDER_SETTINGS.waitForData,
      bitrateMbps: DEFAULT_RENDER_SETTINGS.bitrateMbps,
      bitrateMode: DEFAULT_RENDER_SETTINGS.bitrateMode,
      scaleControl: DEFAULT_RENDER_SETTINGS.scaleControl,
      captureDelay: DEFAULT_RENDER_SETTINGS.captureDelay,
    })
  })

  it('should migrate render settings from Theatre.js staticOverrides', async () => {
    const project: NoodlesProjectJSON = {
      version: 11,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {},
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
                  resolution: { width: 1280, height: 720 },
                  codec: 'vp9',
                  framerate: 24,
                },
              },
            },
          },
        },
      },
    }

    const migrated = await up(project)

    // Should have render settings in OutOp inputs
    const outNode = migrated.nodes.find(n => n.id === '/out')
    expect(outNode?.data?.inputs).toMatchObject({
      display: 'fixed',
      width: 1280,
      height: 720,
      codec: 'vp9',
      framerate: 24,
    })

    // Should clear Theatre.js staticOverrides.byObject.render
    const byObject = (migrated.timeline as any).sheetsById.Noodles.staticOverrides.byObject
    expect(byObject.render).toBeUndefined()
  })

  it('should prefer project-level settings over Theatre.js settings', async () => {
    const project: NoodlesProjectJSON = {
      version: 11,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {},
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
                  resolution: { width: 800, height: 600 },
                },
              },
            },
          },
        },
      },
      renderSettings: {
        display: 'fixed',
        resolution: { width: 1920, height: 1080 },
      },
    }

    const migrated = await up(project)

    // Should use project-level settings
    const outNode = migrated.nodes.find(n => n.id === '/out')
    expect(outNode?.data?.inputs).toMatchObject({
      display: 'fixed',
      width: 1920,
      height: 1080,
    })
  })

  it('should use defaults when no render settings exist', async () => {
    const project: NoodlesProjectJSON = {
      version: 11,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    const outNode = migrated.nodes.find(n => n.id === '/out')
    expect(outNode?.data?.inputs).toMatchObject({
      display: DEFAULT_RENDER_SETTINGS.display,
      width: DEFAULT_RENDER_SETTINGS.resolution.width,
      height: DEFAULT_RENDER_SETTINGS.resolution.height,
      lod: DEFAULT_RENDER_SETTINGS.lod,
      waitForData: DEFAULT_RENDER_SETTINGS.waitForData,
      codec: DEFAULT_RENDER_SETTINGS.codec,
      bitrateMbps: DEFAULT_RENDER_SETTINGS.bitrateMbps,
      bitrateMode: DEFAULT_RENDER_SETTINGS.bitrateMode,
      scaleControl: DEFAULT_RENDER_SETTINGS.scaleControl,
      framerate: DEFAULT_RENDER_SETTINGS.framerate,
      captureDelay: DEFAULT_RENDER_SETTINGS.captureDelay,
    })
  })

  it('should handle missing OutOp gracefully', async () => {
    const project: NoodlesProjectJSON = {
      version: 11,
      nodes: [
        {
          id: '/number',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
      renderSettings: {
        display: 'responsive',
      },
    }

    // Should not throw
    const migrated = await up(project)

    // Should still remove project-level renderSettings
    expect((migrated as any).renderSettings).toBeUndefined()
  })

  it('should preserve existing OutOp inputs', async () => {
    const project: NoodlesProjectJSON = {
      version: 11,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 100, y: 200 },
          data: {
            inputs: {
              vis: { someVizData: 'test' },
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    const outNode = migrated.nodes.find(n => n.id === '/out')
    // Should preserve existing vis input
    expect(outNode?.data?.inputs?.vis).toEqual({ someVizData: 'test' })
    // Should also have render settings
    expect(outNode?.data?.inputs?.display).toBe(DEFAULT_RENDER_SETTINGS.display)
  })

  it('should migrate back down correctly', async () => {
    const project: NoodlesProjectJSON = {
      version: 12,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              display: 'responsive',
              width: 2560,
              height: 1440,
              lod: 1.5,
              waitForData: false,
              codec: 'av1',
              bitrateMbps: 20,
              bitrateMode: 'variable',
              scaleControl: 0.5,
              framerate: 120,
              captureDelay: 100,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await down(project)

    // Should have renderSettings at project level
    expect(migrated.renderSettings).toMatchObject({
      display: 'responsive',
      resolution: { width: 2560, height: 1440 },
      lod: 1.5,
      waitForData: false,
      codec: 'av1',
      bitrateMbps: 20,
      bitrateMode: 'variable',
      scaleControl: 0.5,
      framerate: 120,
      captureDelay: 100,
    })

    // Should remove render settings from OutOp inputs
    const outNode = migrated.nodes.find(n => n.id === '/out')
    expect(outNode?.data?.inputs?.display).toBeUndefined()
    expect(outNode?.data?.inputs?.width).toBeUndefined()
    expect(outNode?.data?.inputs?.height).toBeUndefined()
  })

  it('should round-trip correctly', async () => {
    const original: NoodlesProjectJSON = {
      version: 11,
      nodes: [
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
      renderSettings: {
        display: 'fixed',
        resolution: { width: 1920, height: 1080 },
        codec: 'hevc',
        framerate: 30,
        bitrateMbps: 15,
      },
    }

    const migrated = await up(original)
    const reverted = await down(migrated)

    // RenderSettings should be equivalent
    expect(reverted.renderSettings).toMatchObject({
      display: 'fixed',
      resolution: { width: 1920, height: 1080 },
      codec: 'hevc',
      framerate: 30,
      bitrateMbps: 15,
    })
  })
})
