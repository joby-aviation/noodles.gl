import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type CaptureResult, useRenderer } from './renderer'

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
    await result.current.startCapture({
      canvas: mockCanvas,
      width: 100,
      height: 100,
      codec: 'avc',
      endFrame: 10,
    })

    // Assertions
    expect(result.current.isRendering).toBe(false)
    expect(mockShowSaveFilePicker).toHaveBeenCalled()
    // Redraw shouldn't be called if the save dialog is cancelled
    expect(mockRedraw).not.toHaveBeenCalled()

    // Clean up mocks
    mockShowSaveFilePicker.mockRestore()
  })

  it('renders into a buffer without a save dialog', async () => {
    // A real encode: the encoder and the MP4 muxer schedule work on the real clock
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
        codec: 'avc',
        fps: 10,
        startFrame: 0,
        endFrame: 4,
        target: 'buffer',
        onFrameComplete,
      })
    })

    expect(mockShowSaveFilePicker).not.toHaveBeenCalled()
    expect(capture?.status).toBe('done')
    if (capture?.status !== 'done') return
    expect(capture.frameCount).toBe(5)
    expect(capture.fps).toBe(10)
    expect(onFrameComplete).toHaveBeenLastCalledWith(5, 5)
    // An MP4 starts with an ftyp box
    const header = new TextDecoder().decode(new Uint8Array(capture.buffer!, 4, 4))
    expect(header).toBe('ftyp')
    expect(result.current.isRendering).toBe(false)

    clearInterval(paint)
    canvas.remove()
    mockShowSaveFilePicker.mockRestore()
    vi.useFakeTimers()
  })
})
