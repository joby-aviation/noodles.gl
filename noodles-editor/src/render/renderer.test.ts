import { act, renderHook } from '@testing-library/react'
import { decodeRgba } from 'exrjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

      // Headless Chromium only hands over a captured frame once the canvas is painted
      // after requestFrame, which a live map does on its own. Keep this one painting.
      let frame = 0
      const paint = setInterval(() => {
        ctx.fillStyle = `rgb(${(frame++ * 40) % 255}, 0, 0)`
        ctx.fillRect(0, 0, 64, 64)
      }, 5)

      try {
        // Stands in for the draw loop: report the frame ready once the renderer awaits it
        const redraw = vi.fn(() => {
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
        clearInterval(paint)
        canvas.remove()
        mockShowSaveFilePicker.mockRestore()
        vi.useFakeTimers()
      }
    }
  )
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

  it('tracks an image sequence that fails during setup', async () => {
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'captureStream').mockImplementation(() => {
      throw new DOMException('Canvas is not origin-clean', 'SecurityError')
    })
    const { result } = renderHook(() =>
      useRenderer({ fps: 30, bitrateMode: 'constant', redraw: vi.fn() })
    )

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
  })

  // A real encode, on the real clock, as in the encode test above
  it('tracks a frame error partway through once, with the frames done', async ({ skip }) => {
    vi.useRealTimers()
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')!
    const paint = setInterval(() => ctx.fillRect(0, 0, 64, 64), 5)

    try {
      // Warmup, then frames 0 and 1 draw; frame 2 fails with a message that names a file
      let draws = 0
      const redraw = vi.fn(() => {
        const error =
          draws++ === 3 ? new Error('Could not load /Users/someone/data.csv') : undefined
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
      clearInterval(paint)
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
      const paint = setInterval(() => ctx.fillRect(0, 0, 64, 64), 5)
      let current: HTMLCanvasElement = canvas
      const tracks: MediaStreamTrack[] = []
      const captureStream = canvas.captureStream.bind(canvas)
      vi.spyOn(canvas, 'captureStream').mockImplementation(rate => {
        const stream = captureStream(rate)
        tracks.push(...stream.getVideoTracks())
        return stream
      })

      try {
        // Warmup, then frames 0 and 1 draw; then the canvas is replaced, and the next frame
        // is never reported ready
        let draws = 0
        const redraw = vi.fn(() => {
          if (draws++ === 3) {
            canvas.remove()
            current = document.createElement('canvas')
            return
          }
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
        clearInterval(paint)
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
    const paint = setInterval(() => {
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, 8, 4)
    }, 5)

    try {
      const redraw = vi.fn(() => queueMicrotask(() => result.current.captureFrame()))
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
      clearInterval(paint)
      canvas.remove()
      vi.useFakeTimers()
    }
  })
})

describe('useRenderer transparent video', () => {
  beforeEach(() => {
    track.mockClear()
  })

  // Half opaque red, half fully transparent, painted the way deck.gl does: a WebGL
  // canvas that clears to [0, 0, 0, 0]
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
    // Keep painting, as in the encode test above
    const paint = setInterval(draw, 5)
    return { canvas, stop: () => clearInterval(paint) }
  }

  async function capture(
    canvas: HTMLCanvasElement,
    codec: VideoCodec,
    size = 64
  ): Promise<CaptureResult | undefined> {
    const redraw = vi.fn(() => {
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
    const { canvas, stop } = transparentCanvas()
    try {
      const result = await capture(canvas, codec)
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
      stop()
      canvas.remove()
      vi.useFakeTimers()
    }
  })

  // The canvas is drawn at the export size times the LOD
  it('scales the frames to the export size', async ({ skip }) => {
    vi.useRealTimers()
    const { canvas, stop } = transparentCanvas()
    try {
      const result = await capture(canvas, 'vp9', 32)
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
      stop()
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
