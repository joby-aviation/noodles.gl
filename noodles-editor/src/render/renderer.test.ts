import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { captureScreenshot, useRenderer } from './renderer'

function mockRenderDirectory(names: string[] = []) {
  const write = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn().mockResolvedValue(undefined)
  const createWritable = vi.fn().mockResolvedValue({ write, close })
  const getFileHandle = vi.fn().mockResolvedValue({ createWritable })
  const directoryHandle = {
    async *entries() {
      for (const name of names) {
        yield [name, { kind: 'file', name }] as [string, FileSystemFileHandle]
      }
    },
    getFileHandle,
  } as unknown as FileSystemDirectoryHandle

  return { directoryHandle, getFileHandle, write, close }
}

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

  it('writes screenshots directly to the next versioned file in the renders directory', async () => {
    const { directoryHandle, getFileHandle, write, close } = mockRenderDirectory([
      'route-map-v1.png',
      'route-map-v2.mp4',
    ])
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => {
      callback(new Blob(['image'], { type: 'image/png' }))
    })
    await captureScreenshot('route/map.png', () => canvas, 1, directoryHandle)

    expect(getFileHandle).toHaveBeenCalledWith('route-map-v3.png', { create: true })
    expect(write).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
