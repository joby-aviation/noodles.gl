import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type CaptureResult, resolveEncoderConfig, useRenderer } from './renderer'
import { VIDEO_CODECS } from './video-export'

describe('useRenderer', () => {
  it('handles cancellation of the file save dialog', async () => {
    const mockShowSaveFilePicker = vi
      .spyOn(globalThis, 'showSaveFilePicker')
      .mockImplementation(() =>
        Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
      )

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

    // Clean up mocks
    mockShowSaveFilePicker.mockRestore()
  })

  // A real encode per codec: the encoder and the MP4 muxer schedule work on the real
  // clock. A codec the browser cannot encode at all is skipped by name, not failed,
  // because that depends on the machine (a GPU-less CI runner may have few).
  it.for(VIDEO_CODECS)('renders %s into a buffer without a save dialog', async (codec, {
    skip,
  }) => {
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
    } finally {
      clearInterval(paint)
      canvas.remove()
      mockShowSaveFilePicker.mockRestore()
      vi.useFakeTimers()
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
