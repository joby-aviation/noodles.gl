import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flipYFloat32 } from './exr-export'

// Mock exrjs at module level - must be hoisted
vi.mock('exrjs', () => {
  const MockEXRWriter = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.addLayer = vi.fn(() => this)
    this.rgba = vi.fn(() => this)
    this.r = vi.fn(() => this)
    this.channel = vi.fn(() => this)
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
  it('should call gl.readPixels with UNSIGNED_BYTE type', async () => {
    const mockGL = {
      RGBA: 0x1908,
      FLOAT: 0x1406,
      UNSIGNED_BYTE: 0x1401,
      DEPTH_COMPONENT: 0x1902,
      READ_FRAMEBUFFER: 0x8ca8,
      READ_FRAMEBUFFER_BINDING: 0x8caa,
      getParameter: vi.fn().mockReturnValue(null),
      bindFramebuffer: vi.fn(),
      readPixels: vi.fn(),
    } as unknown as WebGL2RenderingContext

    const { captureExrFrame } = await import('./exr-export')

    captureExrFrame(mockGL, 100, 100, {
      compression: 'zip',
      includeDepth: false,
    })

    expect(mockGL.readPixels).toHaveBeenCalledWith(
      0,
      0,
      100,
      100,
      mockGL.RGBA,
      mockGL.UNSIGNED_BYTE,
      expect.any(Uint8Array)
    )
  })

  it('should bind FBO 0 before readPixels and restore previous binding', async () => {
    const sentinelFBO = {} as WebGLFramebuffer
    const bindOrder: Array<[number, WebGLFramebuffer | null]> = []
    const mockGL = {
      RGBA: 0x1908,
      FLOAT: 0x1406,
      UNSIGNED_BYTE: 0x1401,
      DEPTH_COMPONENT: 0x1902,
      READ_FRAMEBUFFER: 0x8ca8,
      READ_FRAMEBUFFER_BINDING: 0x8caa,
      getParameter: vi.fn().mockReturnValue(sentinelFBO),
      bindFramebuffer: vi.fn((target: number, fbo: WebGLFramebuffer | null) => {
        bindOrder.push([target, fbo])
      }),
      readPixels: vi.fn(),
    } as unknown as WebGL2RenderingContext

    const { captureExrFrame } = await import('./exr-export')

    captureExrFrame(mockGL, 2, 2, { compression: 'zip', includeDepth: false })

    // FBO 0 bound before readPixels, previous FBO restored after
    expect(bindOrder[0]).toEqual([0x8ca8, null])
    expect(bindOrder[1]).toEqual([0x8ca8, sentinelFBO])

    // readPixels should be called between the two bindFramebuffer calls
    const readPixelsCallOrder = vi.mocked(mockGL.readPixels).mock.invocationCallOrder[0]
    const firstBind = vi.mocked(mockGL.bindFramebuffer).mock.invocationCallOrder[0]
    const secondBind = vi.mocked(mockGL.bindFramebuffer).mock.invocationCallOrder[1]
    expect(readPixelsCallOrder).toBeGreaterThan(firstBind)
    expect(readPixelsCallOrder).toBeLessThan(secondBind)
  })
})

describe('captureExrFrame depth handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeMockGL(depthFill: (pixels: Float32Array) => void) {
    return {
      RGBA: 0x1908,
      FLOAT: 0x1406,
      UNSIGNED_BYTE: 0x1401,
      DEPTH_COMPONENT: 0x1902,
      READ_FRAMEBUFFER: 0x8ca8,
      READ_FRAMEBUFFER_BINDING: 0x8caa,
      getParameter: vi.fn().mockReturnValue(null),
      bindFramebuffer: vi.fn(),
      readPixels: vi
        .fn()
        .mockImplementation(
          (
            _x: number,
            _y: number,
            _w: number,
            _h: number,
            format: number,
            _type: number,
            pixels: Float32Array
          ) => {
            if (format === 0x1902) depthFill(pixels)
          }
        ),
    } as unknown as WebGL2RenderingContext
  }

  async function getLastWriterInstance() {
    const { EXRWriter } = await import('exrjs')
    return (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
  }

  it('skips Depth layer and warns when depth buffer is all zeros', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gl = makeMockGL(pixels => pixels.fill(0.0))

    const { captureExrFrame } = await import('./exr-export')
    captureExrFrame(gl, 4, 4, { compression: 'zip', includeDepth: true })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('uniform'), 0)
    const instance = await getLastWriterInstance()
    expect(instance.addLayer).not.toHaveBeenCalledWith('Depth')
  })

  it('skips Depth layer and warns when depth buffer is all ones', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gl = makeMockGL(pixels => pixels.fill(1.0))

    const { captureExrFrame } = await import('./exr-export')
    captureExrFrame(gl, 4, 4, { compression: 'zip', includeDepth: true })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('uniform'), 1)
    const instance = await getLastWriterInstance()
    expect(instance.addLayer).not.toHaveBeenCalledWith('Depth')
  })

  it('writes Depth layer when depth buffer has meaningful variation', async () => {
    const gl = makeMockGL(pixels => {
      pixels.fill(0.5)
      pixels[0] = 0.1 // introduce > 0.001 difference
    })

    const { captureExrFrame } = await import('./exr-export')
    captureExrFrame(gl, 4, 4, { compression: 'zip', includeDepth: true })

    const instance = await getLastWriterInstance()
    expect(instance.addLayer).toHaveBeenCalledWith('Depth')
    expect(instance.channel).toHaveBeenCalledWith('Z', 'f32', expect.any(Float32Array))
  })

  it('skips Depth layer when readPixels throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gl = {
      RGBA: 0x1908,
      FLOAT: 0x1406,
      UNSIGNED_BYTE: 0x1401,
      DEPTH_COMPONENT: 0x1902,
      READ_FRAMEBUFFER: 0x8ca8,
      READ_FRAMEBUFFER_BINDING: 0x8caa,
      getParameter: vi.fn().mockReturnValue(null),
      bindFramebuffer: vi.fn(),
      readPixels: vi
        .fn()
        .mockImplementation((_x: number, _y: number, _w: number, _h: number, format: number) => {
          if (format === 0x1902) throw new Error('INVALID_OPERATION')
        }),
    } as unknown as WebGL2RenderingContext

    const { captureExrFrame } = await import('./exr-export')
    captureExrFrame(gl, 4, 4, { compression: 'zip', includeDepth: true })

    expect(warnSpy).toHaveBeenCalledWith('Failed to read depth buffer:', expect.any(Error))
    const instance = await getLastWriterInstance()
    expect(instance.addLayer).not.toHaveBeenCalledWith('Depth')
  })
})
