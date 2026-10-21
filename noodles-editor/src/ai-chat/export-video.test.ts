import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { memoryProjectStore } from '../noodles/utils/memory-project-store'
import type { CaptureResult } from '../render/renderer'
import {
  setVideoExporter,
  type VideoExporter,
  type VideoExportSettings,
} from '../render/video-export'
import { listFiles } from './agent-files'
import { exportVideo, getExportStatus } from './export-video'

// The real worker timer runs outside the fake clock; this one runs on it
vi.mock('../utils/worker-timer', () => ({
  workerSetTimeout: (callback: () => void, delayMs: number) => {
    const id = setTimeout(callback, delayMs)
    return () => clearTimeout(id)
  },
}))

const PROJECT = 'export-video-test'

const SETTINGS: VideoExportSettings = {
  startTime: 0,
  endTime: 2,
  startFrame: 0,
  endFrame: 60,
  fps: 30,
  width: 640,
  height: 360,
  codec: 'avc',
}

// An exporter whose render the test finishes by hand
function fakeExporter() {
  let resolve: (result: CaptureResult) => void = () => {}
  let onFrame: (frame: number, total: number) => void = () => {}
  const exporter = vi.fn<VideoExporter>((_request, onFrameComplete) => {
    onFrame = onFrameComplete
    return {
      status: 'started',
      settings: SETTINGS,
      result: new Promise<CaptureResult>(r => {
        resolve = r
      }),
    }
  })
  return {
    exporter,
    frame: (frame: number) => onFrame(frame, 61),
    finish: (result: CaptureResult) => resolve(result),
  }
}

const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer

function data(result: { data?: unknown }): Record<string, unknown> {
  return (result.data ?? {}) as Record<string, unknown>
}

describe('export_video', () => {
  let click: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    memoryProjectStore.deleteProject(PROJECT)
    useFileSystemStore.setState({ activeStorageType: 'memory', currentProjectName: PROJECT })
    setVideoExporter(null)
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    click.mockRestore()
  })

  // The job is module state and vi.resetModules does not isolate modules in browser
  // mode, so this runs first and every later test lets its export finish
  it('reports idle before anything has been exported', async () => {
    const status = await getExportStatus()
    expect(status.success).toBe(true)
    expect(data(status).status).toBe('idle')
  })

  it('needs the editor to be mounted', async () => {
    const result = await exportVideo({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Editor not mounted')
  })

  it('says so when the browser cannot encode video', async () => {
    setVideoExporter(fakeExporter().exporter)
    vi.stubGlobal('VideoEncoder', undefined)
    const result = await exportVideo({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('VideoEncoder')
  })

  it('passes the editor refusal through, such as an empty timeline', async () => {
    setVideoExporter(() => ({
      status: 'refused',
      error: 'The timeline is empty (length 0), so there is nothing to export',
    }))
    const result = await exportVideo({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('timeline is empty')
  })

  it('rejects a parameter that is not a number', async () => {
    const fake = fakeExporter()
    setVideoExporter(fake.exporter)
    const result = await exportVideo({ fps: '30' as unknown as number })
    expect(result.success).toBe(false)
    expect(result.error).toContain('fps must be a number')
    expect(fake.exporter).not.toHaveBeenCalled()
  })

  it('saves a short render to .agent/renders and reports the file', async () => {
    const fake = fakeExporter()
    setVideoExporter(fake.exporter)

    const pending = exportVideo({ endTime: 2, codec: 'avc' })
    expect(fake.exporter).toHaveBeenCalledWith(
      {
        startTime: undefined,
        endTime: 2,
        fps: undefined,
        width: undefined,
        height: undefined,
        codec: 'avc',
      },
      expect.any(Function)
    )
    fake.finish({ status: 'done', frameCount: 61, fps: 30, buffer: MP4 })
    const result = await pending

    expect(result.success).toBe(true)
    const done = data(result)
    expect(done).toMatchObject({
      status: 'done',
      bytes: 8,
      frameCount: 61,
      durationSeconds: 2.033,
      width: 640,
      height: 360,
      codec: 'avc',
    })
    expect(done.fileName).toMatch(/^export-video-test-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.mp4$/)
    const path = `@/.agent/renders/${done.fileName}`
    expect(done.savedTo).toEqual({ project: path })
    // An example project lives in memory, which the result has to say
    expect(String(done.warnings)).toContain('in memory')
    expect(click).not.toHaveBeenCalled()

    const listed = await listFiles({ path: '@/.agent/renders' })
    expect(data(listed).files).toEqual([`.agent/renders/${done.fileName}`])
  })

  it('returns progress after waitSeconds and finishes through get_export_status', async () => {
    const fake = fakeExporter()
    setVideoExporter(fake.exporter)

    // waitSeconds above the cap is clamped to 20, the relay's limit less a margin
    const pending = exportVideo({ waitSeconds: 600 })
    fake.frame(12)
    await vi.advanceTimersByTimeAsync(20_000)
    const running = await pending
    expect(running.success).toBe(true)
    expect(data(running)).toMatchObject({
      status: 'running',
      framesDone: 12,
      totalFrames: 61,
      percent: 19,
    })

    const again = await exportVideo({})
    expect(again.success).toBe(false)
    expect(again.error).toContain('already running (frame 12 of 61')
    expect(fake.exporter).toHaveBeenCalledTimes(1)

    const waiting = getExportStatus({ waitSeconds: 5 })
    fake.finish({ status: 'done', frameCount: 61, fps: 30, buffer: MP4 })
    const done = await waiting
    expect(data(done).status).toBe('done')

    // Once finished, the status call answers at once and a new export may start
    expect(data(await getExportStatus()).status).toBe('done')
    const next = exportVideo({ waitSeconds: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(data(await next).status).toBe('running')
    fake.finish({ status: 'error', error: new Error('stopped by the test') })
    await getExportStatus()
  })

  it('reports a failed render with how far it got', async () => {
    const fake = fakeExporter()
    setVideoExporter(fake.exporter)

    const pending = exportVideo({})
    fake.frame(30)
    fake.finish({ status: 'error', error: new Error('EncodingError: codec reclaimed') })
    const result = await pending
    expect(result.success).toBe(false)
    expect(result.error).toBe('Export failed after 30 of 61 frames: EncodingError: codec reclaimed')
    expect((await getExportStatus()).error).toBe(result.error)
  })

  it('downloads the file when asked', async () => {
    const fake = fakeExporter()
    setVideoExporter(fake.exporter)

    const pending = exportVideo({ download: true })
    fake.finish({ status: 'done', frameCount: 61, fps: 30, buffer: MP4 })
    const done = data(await pending)

    expect(click).toHaveBeenCalledTimes(1)
    const link = click.mock.contexts[0] as HTMLAnchorElement
    expect(link.download).toBe(done.fileName)
    expect(link.href).toMatch(/^blob:/)
    expect(done.savedTo).toEqual({
      project: `@/.agent/renders/${done.fileName}`,
      download: done.fileName,
    })
    // A download is the copy that survives a reload, so no in-memory warning
    expect(String(done.warnings)).not.toContain('in memory')
  })

  it('downloads instead when the project cannot be written to', async () => {
    useFileSystemStore.setState({ activeStorageType: 'publicFolder' })
    const fake = fakeExporter()
    setVideoExporter(fake.exporter)

    const pending = exportVideo({})
    fake.finish({ status: 'done', frameCount: 61, fps: 30, buffer: MP4 })
    const done = data(await pending)

    expect(click).toHaveBeenCalledTimes(1)
    expect(done.savedTo).toEqual({ download: done.fileName })
    expect(String(done.warnings)).toContain('Could not save to the project')
  })
})
