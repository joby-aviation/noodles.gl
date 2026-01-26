import { describe, expect, it, vi } from 'vitest'
import { flipYFloat32 } from './exr-export'

// Mock exrjs at module level - must be hoisted
vi.mock('exrjs', () => {
  const MockEXRWriter = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.addLayer = vi.fn(() => this)
    this.rgba = vi.fn(() => this)
    this.r = vi.fn(() => this)
    this.compression = vi.fn(() => this)
    this.sampleType = vi.fn(() => this)
    this.scanlines = vi.fn(() => this)
    this.end = vi.fn(() => this)
    this.encode = vi.fn().mockReturnValue(new Uint8Array([1, 2, 3]))
  })
  const Compression = Object.freeze({
    Uncompressed: 0,
    RLE: 1,
    ZIP1: 2,
    ZIP16: 3,
    PIZ: 4,
    PXR24: 5,
    B44: 6,
    B44A: 7,
  })
  return { EXRWriter: MockEXRWriter, Compression }
})

describe('flipYFloat32', () => {
  it('should flip pixel rows vertically for RGBA data', () => {
    // 2x2 image with RGBA channels
    // Row 0 (bottom in WebGL): Red
    // Row 1 (top in WebGL): Green
    const input = new Float32Array([
      1,
      0,
      0,
      1,
      0.5,
      0,
      0,
      1, // Row 0: Red, Dark Red
      0,
      1,
      0,
      1,
      0,
      0.5,
      0,
      1, // Row 1: Green, Dark Green
    ])

    const result = flipYFloat32(input, 2, 2, 4)

    // After flip:
    // Row 0 should be Green, Dark Green (was Row 1)
    // Row 1 should be Red, Dark Red (was Row 0)
    expect(result).toEqual(
      new Float32Array([
        0,
        1,
        0,
        1,
        0,
        0.5,
        0,
        1, // Row 0: Green, Dark Green
        1,
        0,
        0,
        1,
        0.5,
        0,
        0,
        1, // Row 1: Red, Dark Red
      ])
    )
  })

  it('should flip pixel rows vertically for single channel (depth) data', () => {
    // 3x2 image with single channel
    const input = new Float32Array([
      0.1,
      0.2,
      0.3, // Row 0
      0.4,
      0.5,
      0.6, // Row 1
    ])

    const result = flipYFloat32(input, 3, 2, 1)

    expect(result).toEqual(
      new Float32Array([
        0.4,
        0.5,
        0.6, // Row 0 (was Row 1)
        0.1,
        0.2,
        0.3, // Row 1 (was Row 0)
      ])
    )
  })

  it('should handle a single row (no flip needed)', () => {
    const input = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1])
    const result = flipYFloat32(input, 2, 1, 4)
    expect(result).toEqual(input)
  })

  it('should handle empty array', () => {
    const input = new Float32Array([])
    const result = flipYFloat32(input, 0, 0, 4)
    expect(result).toEqual(new Float32Array([]))
  })

  it('should create a new array (not modify input)', () => {
    const input = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1])
    const originalCopy = new Float32Array(input)
    flipYFloat32(input, 1, 2, 4)
    expect(input).toEqual(originalCopy)
  })
})

describe('captureExrFrame', () => {
  it('should call gl.readPixels with FLOAT type', async () => {
    // Mock WebGL2RenderingContext
    const mockGL = {
      RGBA: 0x1908,
      FLOAT: 0x1406,
      UNSIGNED_BYTE: 0x1401,
      DEPTH_COMPONENT: 0x1902,
      readPixels: vi.fn(),
      getExtension: vi.fn().mockReturnValue({}),
    } as unknown as WebGL2RenderingContext

    // Dynamic import to get the mocked version
    const { captureExrFrame } = await import('./exr-export')

    captureExrFrame(mockGL, 100, 100, {
      compression: 'zip',
      includeDepth: false,
    })

    expect(mockGL.getExtension).toHaveBeenCalledWith('EXT_color_buffer_float')
    expect(mockGL.readPixels).toHaveBeenCalledWith(
      0,
      0,
      100,
      100,
      mockGL.RGBA,
      mockGL.FLOAT,
      expect.any(Float32Array)
    )
  })
})
