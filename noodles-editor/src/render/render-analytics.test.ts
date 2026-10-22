import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../utils/analytics'
import { resolutionBucket, trackRender } from './render-analytics'

vi.mock('../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

const track = vi.mocked(analytics.track)

const render = {
  source: 'agent',
  format: 'mp4',
  codec: 'vp9',
  width: 1920,
  height: 1080,
  frameCount: 300,
} as const

describe('trackRender', () => {
  beforeEach(() => {
    track.mockClear()
  })

  it('tracks render_started with the render settings', () => {
    trackRender(render)
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('render_started', {
      source: 'agent',
      format: 'mp4',
      codec: 'vp9',
      resolution: '1080p',
      frameCount: 300,
    })
  })

  it('measures durationMs from the last restartClock', () => {
    const tracker = trackRender(render)
    vi.advanceTimersByTime(5000) // the save dialog is open
    tracker.restartClock()
    vi.advanceTimersByTime(1234)
    tracker.completed()
    expect(track).toHaveBeenLastCalledWith(
      'render_completed',
      expect.objectContaining({ durationMs: 1234, frameCount: 300 })
    )
  })

  it('sends only one ending event per render', () => {
    const tracker = trackRender(render)
    tracker.failed('encoder', new Error('boom'), 10)
    tracker.completed()
    tracker.cancelled()
    expect(track.mock.calls.map(([event]) => event)).toEqual(['render_started', 'render_failed'])
  })

  it('reports a failure by category and error name, never the message', () => {
    const tracker = trackRender(render)
    const error = new DOMException('Could not write /Users/someone/secret.mp4', 'NotAllowedError')
    tracker.failed('exception', error, 42)
    const [event, properties] = track.mock.lastCall!
    expect(event).toBe('render_failed')
    expect(properties).toMatchObject({
      errorCategory: 'exception',
      errorName: 'NotAllowedError',
      framesDone: 42,
    })
    expect(JSON.stringify(properties)).not.toContain('secret')
  })

  it('replaces an error name that is not a plain identifier', () => {
    const tracker = trackRender(render)
    const error = new Error('boom')
    error.name = 'Failed for /Users/someone/project'
    tracker.failed('exception', error, 0)
    expect(track.mock.lastCall![1]).toMatchObject({ errorName: 'Error' })
  })

  it('leaves codec out for image sequences', () => {
    trackRender({ source: 'menu', format: 'png_sequence', width: 800, height: 600, frameCount: 5 })
    expect(track.mock.lastCall![1]).not.toHaveProperty('codec')
  })
})

describe('resolutionBucket', () => {
  it.each([
    [640, 360, 'under_720p'],
    [1280, 720, '720p'],
    [1920, 1080, '1080p'],
    [1080, 1920, '1080p'],
    [2560, 1440, '1440p'],
    [3840, 2160, '4k'],
    [7680, 4320, '8k'],
  ])('%dx%d is %s', (width, height, bucket) => {
    expect(resolutionBucket(width, height)).toBe(bucket)
  })
})
