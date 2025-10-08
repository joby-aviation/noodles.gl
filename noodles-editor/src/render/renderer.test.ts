import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRenderer } from './renderer'

// Mock Theatre.js functions
vi.mock('@theatre/core', async () => {
  const actual = await vi.importActual('@theatre/core')
  return {
    ...actual,
    val: vi.fn((pointer: any) => {
      // Return the mocked value from the pointer
      return pointer?._mockValue ?? 10
    }),
    onChange: vi.fn(() => {
      // Return a no-op unsubscribe function
      return () => {}
    }),
  }
})

describe('useRenderer', () => {
  it('handles cancellation of the file save dialog', async () => {
    const mockShowSaveFilePicker = vi
      .spyOn(globalThis, 'showSaveFilePicker')
      .mockImplementation(() =>
        Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))
      )
    const consoleLogSpy = vi.spyOn(console, 'log')

    // Setup useRenderer
    const mockRedraw = vi.fn()
    const mockSequence = {
      // Mock sequence.pointer.length to be a Theatre.js-like pointer for the hook
      pointer: {
        length: { _mockValue: 10 },
      },
    }
    const mockProject = {
      // Mock project.address.projectId to be a Theatre.js-like project for the id
      address: { projectId: 'test-project-id' },
      ready: Promise.resolve(),
    }
    const { result } = renderHook(() =>
      useRenderer({
        project: mockProject,
        sequence: mockSequence,
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
    // It's hard to assert that redraw was not called "excessively" without knowing the exact number of calls.
    // We can assert that it was called a specific number of times if we know the expected behavior.
    // For now, let's assume it shouldn't be called at all if the save dialog is cancelled.
    expect(mockRedraw).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith('Render setup cancelled by user (map container).')

    // Clean up mocks
    consoleLogSpy.mockRestore()
    mockShowSaveFilePicker.mockRestore()
  })
})
