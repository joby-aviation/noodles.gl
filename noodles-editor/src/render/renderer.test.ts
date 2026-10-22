import { act, renderHook } from '@testing-library/react'
import { decodeRgba } from 'exrjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTimelineStore } from '../timeline/timeline-store'
import { analytics } from '../utils/analytics'
import {
  type CaptureResult,
  captureScreenshot,
  resolveEncoderConfig,
  useRenderer,
  type VideoCodec,
} from './renderer'
import { ALPHA_VIDEO_CODECS, VIDEO_CODECS } from './video-export'

vi.mock('../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

const track = vi.mocked(analytics.track)
const trackedEvents = () => track.mock.calls.map(([event]) => event)

// Draws the way the editor does. redraw() repaints what is on screen, which still shows
// the previous position; the new position is drawn a moment later, and the frame is
// reported ready a while after that, once the map is idle. Each position paints its own
// red level, so a frame shows which position it recorded. Unlike the editor, a redraw
// reports ready only while its position is still the one being exported.
function editorLikeScene(fps: number, ready: () => void) {
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')!
  let shown = -1
  const paint = () => {
    ctx.fillStyle = `rgb(${(shown + 1) * 50}, 0, 0)`
    ctx.fillRect(0, 0, 8, 8)
  }
  paint()
  const position = () => Math.round(getTimelineStore().position * fps)
  const redraw = vi.fn(() => {
    paint()
    const frame = position()
    setTimeout(() => {
      shown = frame
      paint()
      setTimeout(() => frame === position() && ready(), 50)
    }, 10)
  })
  return { canvas, redraw, frameOf: (red: number) => Math.round(red / 50) - 1 }
}

// Firefox and Safari have no showSaveFilePicker. Removes Chromium's until restored.
function withoutSavePicker() {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker')!
  Reflect.deleteProperty(window, 'showSaveFilePicker')
  return () => Object.defineProperty(window, 'showSaveFilePicker', descriptor)
}

// Records <a download> clicks instead of downloading
function spyOnDownloads() {
  const downloads: { name: string; href: string }[] = []
  function record(this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href })
  }
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(record)
  return { downloads, restore: () => click.mockRestore() }
}

// Paints a new red level on each redraw and reports the frame ready, like a settled map
function paintingRenderer(projectName: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')!
  let frame = 0
  const redraw = vi.fn(() => {
    ctx.fillStyle = `rgb(${(frame++ * 40) % 255}, 0, 0)`
    ctx.fillRect(0, 0, 64, 64)
    queueMicrotask(() => result.current.captureFrame())
  })
  const { result } = renderHook(() =>
    useRenderer({ projectName, fps: 10, bitrate: 1_000_000, bitrateMode: 'constant', redraw })
  )
  const capture = async () => {
    let captured: CaptureResult | undefined
    await act(async () => {
      captured = await result.current.startCapture({
        canvas,
        width: 64,
        height: 64,
        codec: 'avc',
        startFrame: 0,
        endFrame: 2,
      })
    })
    return captured
  }
  return { canvas, capture }
}

const startsWithFtyp = (buffer: ArrayBuffer) =>
  new TextDecoder().decode(new Uint8Array(buffer, 4, 4)) === 'ftyp'

describe('useRenderer', () => {
  beforeEach(() => {
    track.mockClear()
  })

  it('handles cancellation of the file save dialog', async () => {
    const mockShowSaveFilePicker = vi
      .spyOn(globalThis, 'showSaveFilePicker')
      .mockImplementation(() =>
        Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
      )
    // The codec check runs before the dialog; pass it so the test does not depend on
    // which encoders this machine has
    const mockSupport = vi
      .spyOn(VideoEncoder, 'isConfigSupported')
      .mockImplementation(async config => ({ supported: true, config }))

    // Setup useRenderer
    const mockRedraw = vi.fn()
    const { result } = renderHook(() =>
      useRenderer({
        projectName: 'test-project-id',
        fps: 30,
        bitrate: 1_000_000,
        bitrateMode: 'constant',
        redraw: mockRedraw,
      })
    )

    // Call startCapture
    const mockCanvas = document.createElement('canvas')
    // act flushes the isRendering updates on either side of the encoder check
    await act(() =>
      result.current.startCapture({
        canvas: mockCanvas,
        width: 100,
        height: 100,
        codec: 'avc',
        endFrame: 10,
      })
    )

    // Assertions
    expect(result.current.isRendering).toBe(false)
    expect(mockShowSaveFilePicker).toHaveBeenCalled()
    // Redraw shouldn't be called if the save dialog is cancelled
    expect(mockRedraw).not.toHaveBeenCalled()
    expect(trackedEvents()).toEqual(['render_started', 'render_cancelled'])
    expect(track).toHaveBeenLastCalledWith(
      'render_cancelled',
      expect.objectContaining({ source: 'menu', format: 'mp4', codec: 'avc' })
    )

    // Clean up mocks
    mockShowSaveFilePicker.mockRestore()
    mockSupport.mockRestore()
  })

  // A real encode per codec: the encoder and the MP4 muxer schedule work on the real
  // clock. A codec the browser cannot encode at all is skipped by name, not failed,
  // because that depends on the machine (a GPU-less CI runner may have few).
  it.for(VIDEO_CODECS)(
    'renders %s into a buffer without a save dialog',
    async (codec, { skip }) => {
      vi.useRealTimers()
      const mockShowSaveFilePicker = vi.spyOn(globalThis, 'showSaveFilePicker')
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      document.body.appendChild(canvas)
      const ctx = canvas.getContext('2d')!

      try {
        // Stands in for the draw loop: paint, and report the frame ready once the renderer
        // awaits it. Like a settled map, the canvas paints only when redrawn.
        let frame = 0
        const redraw = vi.fn(() => {
          ctx.fillStyle = `rgb(${(frame++ * 40) % 255}, 0, 0)`
          ctx.fillRect(0, 0, 64, 64)
          queueMicrotask(() => result.current.captureFrame())
        })
        const { result } = renderHook(() =>
          useRenderer({ fps: 30, bitrate: 1_000_000, bitrateMode: 'constant', redraw })
        )

        const onFrameComplete = vi.fn()
        let capture: CaptureResult | undefined
        await act(async () => {
          capture = await result.current.startCapture({
            canvas,
            width: 64,
            height: 64,
            codec,
            fps: 10,
            startFrame: 0,
            endFrame: 4,
            target: 'buffer',
            source: 'agent',
            onFrameComplete,
          })
        })

        expect(mockShowSaveFilePicker).not.toHaveBeenCalled()
        expect(result.current.isRendering).toBe(false)
        if (
          capture?.status === 'error' &&
          capture.error.message.startsWith('This browser cannot encode')
        ) {
          skip(`this browser has no ${codec} encoder, hardware or software`)
        }
        // The message, not just the status, so a CI failure says why
        expect(capture?.status === 'error' ? capture.error.message : capture?.status).toBe('done')
        if (capture?.status !== 'done') return
        expect(capture.frameCount).toBe(5)
        expect(capture.fps).toBe(10)
        expect(onFrameComplete).toHaveBeenLastCalledWith(5, 5)
        // An MP4 starts with an ftyp box
        const header = new TextDecoder().decode(new Uint8Array(capture.buffer!, 4, 4))
        expect(header).toBe('ftyp')
        expect(trackedEvents()).toEqual(['render_started', 'render_completed'])
        expect(track).toHaveBeenLastCalledWith('render_completed', {
          source: 'agent',
          format: 'mp4',
          codec,
          resolution: 'under_720p',
          frameCount: 5,
          durationMs: expect.any(Number),
        })
      } finally {
        canvas.remove()
        mockShowSaveFilePicker.mockRestore()
        vi.useFakeTimers()
      }
    }
  )

  it('downloads the video when the browser has no save dialog', async ({ skip }) => {
    vi.useRealTimers()
    const restorePicker = withoutSavePicker()
    const clicks = spyOnDownloads()
    const renderer = paintingRenderer('no-picker')

    try {
      const capture = await renderer.capture()
      if (capture?.status === 'error' && capture.error.message.startsWith('This browser cannot')) {
        skip('this browser has no avc encoder')
      }
      expect(capture?.status === 'error' ? capture.error.message : capture?.status).toBe('done')
      expect(clicks.downloads.map(d => d.name)).toEqual(['no-picker-map.mp4'])
      const downloaded = await (await fetch(clicks.downloads[0].href)).blob()
      expect(downloaded.type).toBe('video/mp4')
      expect(startsWithFtyp(await downloaded.arrayBuffer())).toBe(true)
    } finally {
      renderer.canvas.remove()
      clicks.restore()
      restorePicker()
      vi.useFakeTimers()
    }
  })

  it('writes the video to the picked file, without a download', async ({ skip }) => {
    vi.useRealTimers()
    const chunks: Uint8Array[] = []
    const picker = vi.spyOn(globalThis, 'showSaveFilePicker').mockResolvedValue({
      createWritable: async () =>
        new WritableStream<{ data: Uint8Array }>({ write: chunk => void chunks.push(chunk.data) }),
    } as unknown as FileSystemFileHandle)
    const clicks = spyOnDownloads()
    const renderer = paintingRenderer('with-picker')

    try {
      const capture = await renderer.capture()
      if (capture?.status === 'error' && capture.error.message.startsWith('This browser cannot')) {
        skip('this browser has no avc encoder')
      }
      expect(capture?.status === 'error' ? capture.error.message : capture?.status).toBe('done')
      expect(picker).toHaveBeenCalledWith(
        expect.objectContaining({ suggestedName: 'with-picker-map.mp4' })
      )
      expect(chunks.length).toBeGreaterThan(0)
      expect(clicks.downloads).toEqual([])
    } finally {
      renderer.canvas.remove()
      clicks.restore()
      picker.mockRestore()
      vi.useFakeTimers()
    }
  })

  // A frame read too early, or a capture track made before the scene settled, hands
  // over the previous position's paint instead
  it('records each frame at its own position, not the one drawn before it', async ({ skip }) => {
    vi.useRealTimers()
    getTimelineStore().setPosition(0)
    const scene = editorLikeScene(10, () => result.current.captureFrame())
    const { result } = renderHook(() =>
      useRenderer({ fps: 10, bitrate: 2_000_000, bitrateMode: 'constant', redraw: scene.redraw })
    )

    try {
      let capture: CaptureResult | undefined
      await act(async () => {
        capture = await result.current.startCapture({
          canvas: scene.canvas,
          width: 64,
          height: 64,
          codec: 'vp9',
          startFrame: 0,
          endFrame: 4,
          target: 'buffer',
        })
      })
      if (capture?.status === 'error' && capture.error.message.startsWith('This browser cannot')) {
        skip('this browser has no vp9 encoder')
      }
      expect(capture?.status === 'error' ? capture.error.message : capture?.status).toBe('done')
      if (capture?.status !== 'done') return

      const { ALL_FORMATS, BufferSource, CanvasSink, Input } = await import('mediabunny')
      const input = new Input({ source: new BufferSource(capture.buffer!), formats: ALL_FORMATS })
      const sink = new CanvasSink((await input.getPrimaryVideoTrack())!)
      const recorded: number[] = []
      for (let frame = 0; frame <= 4; frame++) {
        const decoded = await sink.getCanvas(frame / 10 + 0.01)
        const ctx = (decoded!.canvas as HTMLCanvasElement).getContext('2d')!
        recorded.push(scene.frameOf(ctx.getImageData(32, 32, 1, 1).data[0]))
      }
      expect(recorded).toEqual([0, 1, 2, 3, 4])
    } finally {
      scene.canvas.remove()
      vi.useFakeTimers()
    }
  })
})

describe('useRenderer analytics on failure', () => {
  beforeEach(() => {
    track.mockClear()
  })

  it('tracks a codec the browser cannot encode once, as unsupported_codec', async () => {
    vi.spyOn(VideoEncoder, 'isConfigSupported').mockImplementation(async config => ({
      supported: false,
      config,
    }))
    const { result } = renderHook(() =>
      useRenderer({ fps: 30, bitrateMode: 'constant', redraw: vi.fn() })
    )

    let capture: CaptureResult | undefined
    await act(async () => {
      capture = await result.current.startCapture({
        canvas: document.createElement('canvas'),
        width: 3840,
        height: 2160,
        codec: 'av1',
        endFrame: 9,
        target: 'buffer',
        source: 'agent',
      })
    })

    expect(capture?.status).toBe('error')
    expect(trackedEvents()).toEqual(['render_started', 'render_failed'])
    expect(track).toHaveBeenLastCalledWith('render_failed', {
      source: 'agent',
      format: 'mp4',
      codec: 'av1',
      resolution: '4k',
      frameCount: 10,
      durationMs: expect.any(Number),
      errorCategory: 'unsupported_codec',
      errorName: 'Error',
      framesDone: 0,
    })
  })

  it('tracks a save dialog the browser refuses as a failure, not a cancellation', async () => {
    vi.spyOn(globalThis, 'showSaveFilePicker').mockRejectedValue(
      new DOMException('Must be handling a user gesture', 'SecurityError')
    )
    vi.spyOn(VideoEncoder, 'isConfigSupported').mockImplementation(async config => ({
      supported: true,
      config,
    }))
    const { result } = renderHook(() =>
      useRenderer({ fps: 30, bitrateMode: 'constant', redraw: vi.fn() })
    )

    let capture: CaptureResult | undefined
    await act(async () => {
      capture = await result.current.startCapture({
        canvas: document.createElement('canvas'),
        width: 100,
        height: 100,
        codec: 'avc',
        endFrame: 10,
      })
    })

    expect(capture?.status).toBe('error')
    expect(trackedEvents()).toEqual(['render_started', 'render_failed'])
    expect(track.mock.lastCall![1]).toMatchObject({
      errorCategory: 'exception',
      errorName: 'SecurityError',
    })
  })

  it('tracks an image sequence whose canvas cannot be captured', async () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    vi.spyOn(canvas, 'captureStream').mockImplementation(() => {
      throw new DOMException('Canvas is not origin-clean', 'SecurityError')
    })
    // The first frame draws; reading it from the canvas is what fails
    const redraw = vi.fn(() => queueMicrotask(() => result.current.captureFrame()))
    const { result } = renderHook(() => useRenderer({ fps: 30, bitrateMode: 'constant', redraw }))

    await act(async () => {
      await expect(
        result.current.startSequenceCapture({
          canvas,
          directoryHandle: {} as FileSystemDirectoryHandle,
          endFrame: 2,
        })
      ).rejects.toThrow('origin-clean')
    })

    expect(result.current.isRendering).toBe(false)
    expect(trackedEvents()).toEqual(['render_started', 'render_failed'])
    expect(track.mock.lastCall![1]).toMatchObject({
      format: 'png_sequence',
      errorCategory: 'exception',
      errorName: 'SecurityError',
      framesDone: 0,
    })
    canvas.remove()
  })

  // A real encode, on the real clock, as in the encode test above
  it('tracks a frame error partway through once, with the frames done', async ({ skip }) => {
    vi.useRealTimers()
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')!

    try {
      // Warmup, then frames 0 and 1 draw, each redrawn once more for its capture; frame 2
      // fails with a message that names a file
      let draws = 0
      const redraw = vi.fn(() => {
        ctx.fillRect(0, 0, 64, 64)
        const error =
          draws++ === 5 ? new Error('Could not load /Users/someone/data.csv') : undefined
        queueMicrotask(() => result.current.captureFrame(error ? { error } : undefined))
      })
      const { result } = renderHook(() =>
        useRenderer({ fps: 10, bitrate: 1_000_000, bitrateMode: 'constant', redraw })
      )

      let capture: CaptureResult | undefined
      await act(async () => {
        capture = await result.current.startCapture({
          canvas,
          width: 64,
          height: 64,
          codec: 'vp9',
          startFrame: 0,
          endFrame: 4,
          target: 'buffer',
        })
      })

      if (capture?.status === 'error' && capture.error.message.startsWith('This browser cannot')) {
        skip('this browser has no vp9 encoder')
      }
      expect(capture?.status).toBe('error')
      expect(trackedEvents()).toEqual(['render_started', 'render_failed'])
      const properties = track.mock.lastCall![1]
      expect(properties).toMatchObject({
        source: 'menu',
        errorCategory: 'frame',
        framesDone: 2,
        frameCount: 5,
      })
      expect(JSON.stringify(properties)).not.toContain('data.csv')
    } finally {
      canvas.remove()
      vi.useFakeTimers()
    }
  })

  // Adding or removing the basemap rebuilds the canvas mid-export. The recorded canvas
  // is never drawn again, so before the guard this export waited forever.
  it.for([
    { exportAlpha: false, label: 'MP4' },
    { exportAlpha: true, label: 'WebM with alpha' },
  ])(
    'fails with canvas_replaced when the canvas is rebuilt partway through ($label)',
    async ({ exportAlpha }, { skip }) => {
      vi.useRealTimers()
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      document.body.appendChild(canvas)
      const ctx = canvas.getContext('2d')!
      let current: HTMLCanvasElement = canvas
      const tracks: MediaStreamTrack[] = []
      const captureStream = canvas.captureStream.bind(canvas)
      vi.spyOn(canvas, 'captureStream').mockImplementation(rate => {
        const stream = captureStream(rate)
        tracks.push(...stream.getVideoTracks())
        return stream
      })

      try {
        // Warmup, then frames 0 and 1 draw, each redrawn once more for its capture; then the
        // canvas is replaced, and the next frame is never reported ready
        let draws = 0
        const redraw = vi.fn(() => {
          if (draws++ === 5) {
            canvas.remove()
            current = document.createElement('canvas')
            return
          }
          ctx.fillRect(0, 0, 64, 64)
          queueMicrotask(() => result.current.captureFrame())
        })
        const { result } = renderHook(() =>
          useRenderer({ fps: 10, bitrate: 1_000_000, bitrateMode: 'constant', redraw })
        )

        let capture: CaptureResult | undefined
        await act(async () => {
          capture = await result.current.startCapture({
            canvas,
            getCanvas: () => current,
            width: 64,
            height: 64,
            codec: 'vp9',
            exportAlpha,
            startFrame: 0,
            endFrame: 4,
            target: 'buffer',
          })
        })

        if (
          capture?.status === 'error' &&
          capture.error.message.startsWith('This browser cannot')
        ) {
          skip('this browser has no vp9 encoder')
        }
        expect(capture?.status).toBe('error')
        if (capture?.status === 'error') {
          expect(capture.error.message).toContain('rebuilt during the export')
        }
        expect(trackedEvents()).toEqual(['render_started', 'render_failed'])
        expect(track.mock.lastCall![1]).toMatchObject({
          errorCategory: 'canvas_replaced',
          errorName: 'CanvasReplacedError',
          framesDone: 2,
        })
        // The failed export released its capture, so a retry starts clean
        expect(tracks.length).toBe(1)
        expect(tracks[0].readyState).toBe('ended')
      } finally {
        canvas.remove()
        vi.useFakeTimers()
      }
    }
  )
})

describe('startSequenceCapture', () => {
  beforeEach(() => {
    track.mockClear()
  })

  // Collects what the export writes, keyed by file name
  const memoryDirectory = () => {
    const files = new Map<string, Blob>()
    const handle = {
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({
          write: async (data: Blob) => void files.set(name, data),
          close: async () => {},
        }),
      }),
    } as unknown as FileSystemDirectoryHandle
    return { files, handle }
  }

  // Real frames from the compositor, on the real clock, as in the encode tests above
  it('writes one EXR per frame at the canvas size', async () => {
    vi.useRealTimers()
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 4
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')!

    try {
      // Paints only when redrawn, as in the encode tests above
      const redraw = vi.fn(() => {
        ctx.fillStyle = '#ff0000'
        ctx.fillRect(0, 0, 8, 4)
        queueMicrotask(() => result.current.captureFrame())
      })
      const { result } = renderHook(() =>
        useRenderer({ projectName: 'exr-test', fps: 10, bitrateMode: 'constant', redraw })
      )
      const { files, handle } = memoryDirectory()

      await act(() =>
        result.current.startSequenceCapture({
          canvas,
          directoryHandle: handle,
          format: 'exr',
          startFrame: 0,
          endFrame: 1,
        })
      )

      expect([...files.keys()].sort()).toEqual(['exr-test_0000.exr', 'exr-test_0001.exr'])
      const decoded = decodeRgba(await files.get('exr-test_0000.exr')!.arrayBuffer())
      expect(decoded.width).toBe(8)
      expect(decoded.height).toBe(4)
      // Opaque red stays red in linear light
      expect(Array.from(decoded.pixels.slice(0, 4))).toEqual([1, 0, 0, 1])
      expect(track).toHaveBeenLastCalledWith(
        'render_completed',
        expect.objectContaining({ format: 'exr_sequence', frameCount: 2 })
      )
    } finally {
      canvas.remove()
      vi.useFakeTimers()
    }
  })

  // As in the video test above
  it('writes each frame at its own position, not the one drawn before it', async () => {
    vi.useRealTimers()
    getTimelineStore().setPosition(0)
    const scene = editorLikeScene(10, () => result.current.captureFrame())
    const { result } = renderHook(() =>
      useRenderer({ projectName: 'frames', fps: 10, bitrateMode: 'constant', redraw: scene.redraw })
    )
    const { files, handle } = memoryDirectory()

    try {
      await act(() =>
        result.current.startSequenceCapture({
          canvas: scene.canvas,
          directoryHandle: handle,
          startFrame: 0,
          endFrame: 4,
        })
      )

      const recorded: number[] = []
      for (const name of [...files.keys()].sort()) {
        const image = await createImageBitmap(files.get(name)!)
        const ctx = new OffscreenCanvas(8, 8).getContext('2d')!
        ctx.drawImage(image, 0, 0)
        recorded.push(scene.frameOf(ctx.getImageData(4, 4, 1, 1).data[0]))
      }
      expect(recorded).toEqual([0, 1, 2, 3, 4])
    } finally {
      scene.canvas.remove()
      vi.useFakeTimers()
    }
  })
})

describe('useRenderer transparent video', () => {
  beforeEach(() => {
    track.mockClear()
  })

  // Half opaque red, half fully transparent, painted the way deck.gl does: a WebGL
  // canvas that clears to [0, 0, 0, 0], and only when redrawn
  function transparentCanvas() {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    document.body.appendChild(canvas)
    const gl = canvas.getContext('webgl2', { alpha: true })!
    const draw = () => {
      gl.disable(gl.SCISSOR_TEST)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(0, 0, 32, 64)
      gl.clearColor(1, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    return { canvas, draw }
  }

  async function capture(
    canvas: HTMLCanvasElement,
    codec: VideoCodec,
    { size = 64, draw = () => {} } = {}
  ): Promise<CaptureResult | undefined> {
    const redraw = vi.fn(() => {
      draw()
      queueMicrotask(() => result.current.captureFrame())
    })
    const { result } = renderHook(() =>
      useRenderer({ fps: 10, bitrate: 1_000_000, bitrateMode: 'variable', redraw })
    )
    let captured: CaptureResult | undefined
    await act(async () => {
      captured = await result.current.startCapture({
        canvas,
        width: size,
        height: size,
        codec,
        exportAlpha: true,
        startFrame: 0,
        endFrame: 4,
        target: 'buffer',
      })
    })
    return captured
  }

  // A real encode and decode on the real clock. mediabunny encodes the color and the
  // alpha as two WebCodecs streams; reading the file back proves the alpha survived.
  // Played in a <video> element too, since that is how most people will view it.
  it.for(ALPHA_VIDEO_CODECS)('keeps the alpha channel in a %s WebM', async (codec, { skip }) => {
    vi.useRealTimers()
    const { canvas, draw } = transparentCanvas()
    try {
      const result = await capture(canvas, codec, { draw })
      if (result?.status === 'error' && result.error.message.startsWith('This browser cannot')) {
        skip(`this browser has no ${codec} encoder`)
      }
      expect(result?.status === 'error' ? result.error.message : result?.status).toBe('done')
      if (result?.status !== 'done') return

      const { ALL_FORMATS, BufferSource, CanvasSink, Input } = await import('mediabunny')
      const input = new Input({ source: new BufferSource(result.buffer!), formats: ALL_FORMATS })
      expect(await input.getMimeType()).toMatch(/^video\/webm/)
      const videoTrack = (await input.getPrimaryVideoTrack())!
      expect(videoTrack.codec).toBe(codec)
      expect(await videoTrack.canBeTransparent()).toBe(true)
      expect(await videoTrack.computeDuration()).toBeCloseTo(0.5)

      const decoded = await new CanvasSink(videoTrack, { alpha: true }).getCanvas(0.25)
      const ctx = (decoded!.canvas as HTMLCanvasElement).getContext('2d')!
      const [, , , opaqueAlpha] = ctx.getImageData(8, 32, 1, 1).data
      const [, , , clearAlpha] = ctx.getImageData(56, 32, 1, 1).data
      expect(opaqueAlpha).toBeGreaterThan(240)
      expect(clearAlpha).toBeLessThan(16)

      const video = document.createElement('video')
      video.muted = true
      video.src = URL.createObjectURL(new Blob([result.buffer!], { type: 'video/webm' }))
      await new Promise(resolve => {
        video.onloadeddata = resolve
      })
      // Chromium fires `seeked` before the decoded frame reaches the element, so a
      // drawImage right after it can read an empty frame on a slow machine. Wait until
      // the frame at 0.25 s (the one from 0.2 s, at 10 fps) is the one being shown.
      const shown = new Promise<void>(resolve => {
        const onFrame: VideoFrameRequestCallback = (_, { mediaTime }) => {
          if (Math.abs(mediaTime - 0.2) < 0.01) resolve()
          else video.requestVideoFrameCallback(onFrame)
        }
        video.requestVideoFrameCallback(onFrame)
      })
      const seeked = new Promise(resolve => {
        video.onseeked = resolve
      })
      video.currentTime = 0.25
      await Promise.all([seeked, shown])
      const played = document.createElement('canvas').getContext('2d')!
      played.drawImage(video, 0, 0)
      expect(played.getImageData(8, 32, 1, 1).data[3]).toBeGreaterThan(240)
      expect(played.getImageData(56, 32, 1, 1).data[3]).toBeLessThan(16)
      URL.revokeObjectURL(video.src)

      expect(track).toHaveBeenLastCalledWith(
        'render_completed',
        expect.objectContaining({ format: 'webm', codec })
      )
    } finally {
      canvas.remove()
      vi.useFakeTimers()
    }
  })

  // The canvas is drawn at the export size times the LOD
  it('scales the frames to the export size', async ({ skip }) => {
    vi.useRealTimers()
    const { canvas, draw } = transparentCanvas()
    try {
      const result = await capture(canvas, 'vp9', { size: 32, draw })
      if (result?.status === 'error' && result.error.message.startsWith('This browser cannot')) {
        skip('this browser has no vp9 encoder')
      }
      expect(result?.status === 'error' ? result.error.message : result?.status).toBe('done')
      if (result?.status !== 'done') return

      const { ALL_FORMATS, BufferSource, CanvasSink, Input } = await import('mediabunny')
      const input = new Input({ source: new BufferSource(result.buffer!), formats: ALL_FORMATS })
      const videoTrack = (await input.getPrimaryVideoTrack())!
      expect([videoTrack.displayWidth, videoTrack.displayHeight]).toEqual([32, 32])
      const decoded = await new CanvasSink(videoTrack, { alpha: true }).getCanvas(0.25)
      const ctx = (decoded!.canvas as HTMLCanvasElement).getContext('2d')!
      expect(ctx.getImageData(4, 16, 1, 1).data[3]).toBeGreaterThan(240)
      expect(ctx.getImageData(28, 16, 1, 1).data[3]).toBeLessThan(16)
    } finally {
      canvas.remove()
      vi.useFakeTimers()
    }
  })

  it('refuses a codec that cannot carry alpha before opening the save dialog', async () => {
    const picker = vi.spyOn(globalThis, 'showSaveFilePicker')
    const result = await capture(document.createElement('canvas'), 'avc')

    expect(result?.status === 'error' && result.error.message).toBe(
      'Transparent video needs the VP9 codec, not avc'
    )
    expect(picker).not.toHaveBeenCalled()
    expect(track.mock.lastCall![1]).toMatchObject({
      format: 'webm',
      errorCategory: 'unsupported_codec',
    })
    picker.mockRestore()
  })
})

describe('captureScreenshot', () => {
  beforeEach(() => {
    track.mockClear()
  })

  it('tracks the source that took the screenshot', async () => {
    const write = vi.fn()
    const clicks = spyOnDownloads()
    vi.spyOn(globalThis, 'showSaveFilePicker').mockResolvedValue({
      getFile: async () => new File([], 'shot.png', { type: 'image/png' }),
      createWritable: async () => ({ write, close: vi.fn() }),
    } as unknown as FileSystemFileHandle)
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4

    await captureScreenshot('shot', () => canvas)
    expect(track).toHaveBeenLastCalledWith('screenshot_taken', { source: 'menu' })

    await captureScreenshot('shot', () => canvas, { source: 'toolbar' })
    expect(track).toHaveBeenLastCalledWith('screenshot_taken', { source: 'toolbar' })
    expect(write).toHaveBeenCalledTimes(2)
    expect(clicks.downloads).toEqual([])
    clicks.restore()
  })

  it('downloads a PNG when the browser has no save dialog', async () => {
    const restorePicker = withoutSavePicker()
    const clicks = spyOnDownloads()
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    canvas.getContext('2d')!.fillRect(0, 0, 4, 4)

    try {
      await captureScreenshot('shot', () => canvas, { source: 'toolbar' })
      expect(clicks.downloads.map(d => d.name)).toEqual(['shot.png'])
      const downloaded = await (await fetch(clicks.downloads[0].href)).blob()
      expect(downloaded.type).toBe('image/png')
      // A PNG starts with \x89PNG
      const signature = new Uint8Array(await downloaded.arrayBuffer(), 1, 3)
      expect(new TextDecoder().decode(signature)).toBe('PNG')
      expect(track).toHaveBeenLastCalledWith('screenshot_taken', { source: 'toolbar' })
    } finally {
      clicks.restore()
      restorePicker()
    }
  })
})

describe('resolveEncoderConfig', () => {
  const base = { codec: 'vp09.00.10.08', width: 64, height: 64, bitrate: 1_000_000 }

  it('prefers the hardware encoder when there is one', async () => {
    const check = vi
      .spyOn(VideoEncoder, 'isConfigSupported')
      .mockResolvedValue({ supported: true, config: {} as VideoEncoderConfig })
    expect(await resolveEncoderConfig(base)).toEqual({
      ...base,
      hardwareAcceleration: 'prefer-hardware',
    })
    expect(check).toHaveBeenCalledTimes(1)
    check.mockRestore()
  })

  it('falls back to the software encoder when hardware is refused', async () => {
    const check = vi.spyOn(VideoEncoder, 'isConfigSupported').mockImplementation(async config => ({
      supported: config.hardwareAcceleration !== 'prefer-hardware',
      config,
    }))
    expect(await resolveEncoderConfig(base)).toEqual({
      ...base,
      hardwareAcceleration: 'no-preference',
    })
    check.mockRestore()
  })

  it('returns null when the browser cannot encode the codec at all', async () => {
    const check = vi
      .spyOn(VideoEncoder, 'isConfigSupported')
      .mockImplementation(async config => ({ supported: false, config }))
    expect(await resolveEncoderConfig(base)).toBeNull()
    check.mockRestore()
  })
})
