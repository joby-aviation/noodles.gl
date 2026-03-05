import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRenderer } from './renderer'

// Mock exrjs to avoid dynamic import issues with fs/promises
vi.mock('exrjs', () => {
  const MockEXRWriter = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.addLayer = vi.fn(() => this)
    this.rgba = vi.fn(() => this)
    this.r = vi.fn(() => this)
    this.compression = vi.fn(() => this)
    this.sampleType = vi.fn(() => this)
    this.scanlines = vi.fn(() => this)
    this.end = vi.fn(() => this)
    this.write = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
  })
  return { EXRWriter: MockEXRWriter }
})

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
})
