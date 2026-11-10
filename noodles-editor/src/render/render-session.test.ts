import { afterEach, describe, expect, it } from 'vitest'
import { playbackDriver } from '../timeline/playback'
import { getTimelineStore } from '../timeline/timeline-store'
import {
  beginRender,
  isRendering,
  setRenderProgress,
  useRenderSessionStore,
} from './render-session'

describe('render session', () => {
  let release: (() => void) | null = null

  afterEach(() => {
    release?.()
    release = null
    getTimelineStore().pause()
    playbackDriver.stop()
  })

  it('lets one export hold the session at a time', () => {
    release = beginRender('video', 'toolbar')
    expect(release).not.toBeNull()
    expect(isRendering()).toBe(true)
    expect(useRenderSessionStore.getState().session).toEqual({
      status: 'exporting',
      kind: 'video',
      source: 'toolbar',
    })

    expect(beginRender('sequence', 'menu')).toBeNull()
    expect(beginRender('video', 'agent')).toBeNull()

    release?.()
    expect(isRendering()).toBe(false)
    release = beginRender('sequence', 'menu')
    expect(release).not.toBeNull()
  })

  it('resets progress when an export starts', () => {
    setRenderProgress(5, 10)
    expect(useRenderSessionStore.getState().percent).toBe(50)
    release = beginRender('video', 'menu')
    expect(useRenderSessionStore.getState().percent).toBeNull()
  })

  it('pauses playback and keeps the playback loop off while it runs', () => {
    getTimelineStore().play()
    playbackDriver.start()
    expect(playbackDriver.isRunning()).toBe(true)

    release = beginRender('video', 'menu')
    expect(getTimelineStore().playing).toBe(false)
    expect(playbackDriver.isRunning()).toBe(false)

    // Play pressed during the export doesn't move the playhead
    getTimelineStore().play()
    playbackDriver.start()
    expect(playbackDriver.isRunning()).toBe(false)

    // and takes effect once the export ends
    release?.()
    expect(playbackDriver.isManualMode()).toBe(false)
    expect(playbackDriver.isRunning()).toBe(true)
  })

  it('ignores a second release, so it cannot end a later export', () => {
    const first = beginRender('video', 'menu')
    first?.()
    release = beginRender('video', 'agent')
    first?.()
    expect(isRendering()).toBe(true)
    expect(playbackDriver.isManualMode()).toBe(true)
  })
})
