import { describe, expect, it } from 'vitest'
import { resolveExportSettings, type VideoExportContext } from './video-export'

const context: VideoExportContext = {
  sequenceLength: 10,
  framerate: 30,
  resolution: { width: 1920, height: 1080 },
  codec: 'avc',
}

function errorOf(result: ReturnType<typeof resolveExportSettings>): string {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

describe('resolveExportSettings', () => {
  it('takes the render settings and the whole timeline by default', () => {
    expect(resolveExportSettings({}, context)).toEqual({
      ok: true,
      settings: {
        startTime: 0,
        endTime: 10,
        startFrame: 0,
        endFrame: 300,
        fps: 30,
        width: 1920,
        height: 1080,
        codec: 'avc',
      },
    })
  })

  it('uses the in and out points when they are set', () => {
    const result = resolveExportSettings({}, { ...context, inPoint: 2, outPoint: 4 })
    expect(result.ok && result.settings).toMatchObject({
      startTime: 2,
      endTime: 4,
      startFrame: 60,
      endFrame: 120,
    })
  })

  it('lets the request override every setting', () => {
    const result = resolveExportSettings(
      { startTime: 1, endTime: 3, fps: 60, width: 1280, height: 720, codec: 'vp9' },
      { ...context, inPoint: 2, outPoint: 4 }
    )
    expect(result.ok && result.settings).toEqual({
      startTime: 1,
      endTime: 3,
      startFrame: 60,
      endFrame: 180,
      fps: 60,
      width: 1280,
      height: 720,
      codec: 'vp9',
    })
  })

  it('accepts a fractional frame rate', () => {
    const result = resolveExportSettings({}, { ...context, framerate: 29.97 })
    expect(result.ok && result.settings).toMatchObject({ fps: 29.97, endFrame: 299 })
  })

  it('refuses an empty timeline', () => {
    expect(errorOf(resolveExportSettings({}, { ...context, sequenceLength: 0 }))).toContain(
      'timeline is empty'
    )
  })

  it('refuses a range outside the timeline or shorter than a frame', () => {
    expect(errorOf(resolveExportSettings({ endTime: 12 }, context))).toContain('outside')
    expect(errorOf(resolveExportSettings({ startTime: -1 }, context))).toContain('outside')
    expect(errorOf(resolveExportSettings({ startTime: 5, endTime: 5 }, context))).toContain(
      'one frame after'
    )
    expect(errorOf(resolveExportSettings({ startTime: 5, endTime: 5.01 }, context))).toContain(
      'one frame after'
    )
  })

  it('refuses odd or out-of-range dimensions instead of rounding them', () => {
    expect(errorOf(resolveExportSettings({ width: 1921 }, context))).toContain('width')
    expect(errorOf(resolveExportSettings({ height: 0 }, context))).toContain('height')
    expect(errorOf(resolveExportSettings({ width: 10_000 }, context))).toContain('width')
  })

  it('refuses a bad fps or codec', () => {
    expect(errorOf(resolveExportSettings({ fps: 0 }, context))).toContain('fps')
    expect(errorOf(resolveExportSettings({ fps: 121 }, context))).toContain('fps')
    expect(errorOf(resolveExportSettings({ fps: Number.NaN }, context))).toContain('fps')
    expect(
      errorOf(resolveExportSettings({ codec: 'prores' as unknown as 'avc' }, context))
    ).toContain('codec')
  })
})
