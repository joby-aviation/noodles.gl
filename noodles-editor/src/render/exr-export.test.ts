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
  it('should call gl.readPixels with UNSIGNED_BYTE type for RGBA', async () => {
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

    captureExrFrame(mockGL, 2, 2, { compression: 'zip' })

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

  it('should not add Depth layer when depth is not provided', async () => {
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

    const { captureExrFrame, EXRWriter } = await import('./exr-export').then(async m => ({
      ...m,
      EXRWriter: (await import('exrjs')).EXRWriter,
    }))

    captureExrFrame(mockGL, 4, 4, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    expect(instance.addLayer).not.toHaveBeenCalledWith('Depth')
  })

  it('should not add Depth layer when depth is null', async () => {
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

    const { captureExrFrame, EXRWriter } = await import('./exr-export').then(async m => ({
      ...m,
      EXRWriter: (await import('exrjs')).EXRWriter,
    }))

    captureExrFrame(mockGL, 4, 4, { compression: 'zip', depth: null })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    expect(instance.addLayer).not.toHaveBeenCalledWith('Depth')
  })

  it('should add Depth layer with Z channel when depth Float32Array is provided', async () => {
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

    const { captureExrFrame, EXRWriter } = await import('./exr-export').then(async m => ({
      ...m,
      EXRWriter: (await import('exrjs')).EXRWriter,
    }))

    const depth = new Float32Array(4 * 4).fill(0.5)
    depth[0] = 0.1 // some variation

    captureExrFrame(mockGL, 4, 4, { compression: 'zip', depth })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    expect(instance.addLayer).toHaveBeenCalledWith('Depth')
    expect(instance.channel).toHaveBeenCalledWith('Z', 'f32', depth)
  })
})

describe('captureDepthFromDeckFBO', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeMockGL(readPixelsFill?: (pixels: Float32Array) => void) {
    const tempFBO = {}
    return {
      READ_FRAMEBUFFER: 0x8ca8,
      DEPTH_ATTACHMENT: 0x8d00,
      DEPTH_COMPONENT: 0x1902,
      FLOAT: 0x1406,
      TEXTURE_2D: 0x0de1,
      createFramebuffer: vi.fn().mockReturnValue(tempFBO),
      bindFramebuffer: vi.fn(),
      framebufferTexture2D: vi.fn(),
      readPixels: vi
        .fn()
        .mockImplementation(
          (
            _x: number,
            _y: number,
            _w: number,
            _h: number,
            _format: number,
            _type: number,
            pixels: Float32Array
          ) => {
            readPixelsFill?.(pixels)
          }
        ),
      deleteFramebuffer: vi.fn(),
    } as unknown as WebGL2RenderingContext
  }

  it('returns null when deck._framebuffer is absent', async () => {
    const gl = makeMockGL()
    const { captureDepthFromDeckFBO } = await import('./exr-export')

    expect(captureDepthFromDeckFBO(null, gl, 4, 4)).toBeNull()
    expect(captureDepthFromDeckFBO({}, gl, 4, 4)).toBeNull()
    expect(captureDepthFromDeckFBO({ _framebuffer: null }, gl, 4, 4)).toBeNull()
  })

  it('returns null when depth texture handle is absent', async () => {
    const gl = makeMockGL()
    const { captureDepthFromDeckFBO } = await import('./exr-export')

    const deck = { _framebuffer: { depthStencilAttachment: { texture: { handle: null } } } }
    expect(captureDepthFromDeckFBO(deck, gl, 4, 4)).toBeNull()
  })

  it('binds depth texture to temp FBO and reads pixels', async () => {
    const depthHandle = {}
    const gl = makeMockGL(pixels => pixels.fill(0.5))
    const { captureDepthFromDeckFBO } = await import('./exr-export')

    const deck = {
      _framebuffer: { depthStencilAttachment: { texture: { handle: depthHandle } } },
    }

    const result = captureDepthFromDeckFBO(deck, gl, 2, 2)

    expect(result).not.toBeNull()
    expect(gl.createFramebuffer).toHaveBeenCalled()
    expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.READ_FRAMEBUFFER, expect.anything())
    expect(gl.framebufferTexture2D).toHaveBeenCalledWith(
      gl.READ_FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      depthHandle,
      0
    )
    expect(gl.readPixels).toHaveBeenCalledWith(
      0,
      0,
      2,
      2,
      gl.DEPTH_COMPONENT,
      gl.FLOAT,
      expect.any(Float32Array)
    )
    expect(gl.deleteFramebuffer).toHaveBeenCalled()
  })

  it('unbinds temp FBO after readPixels', async () => {
    const depthHandle = {}
    const bindOrder: Array<WebGLFramebuffer | null> = []
    const gl = makeMockGL()
    ;(gl.bindFramebuffer as ReturnType<typeof vi.fn>).mockImplementation(
      (_target: number, fbo: WebGLFramebuffer | null) => {
        bindOrder.push(fbo)
      }
    )
    const { captureDepthFromDeckFBO } = await import('./exr-export')

    const deck = {
      _framebuffer: { depthStencilAttachment: { texture: { handle: depthHandle } } },
    }

    captureDepthFromDeckFBO(deck, gl, 2, 2)

    // First bind: temp FBO; second bind: null (unbind)
    expect(bindOrder).toHaveLength(2)
    expect(bindOrder[0]).not.toBeNull()
    expect(bindOrder[1]).toBeNull()
  })

  it('returns Y-flipped depth data', async () => {
    const depthHandle = {}
    // 2x2 image: row 0 (bottom) = [0.1, 0.2], row 1 (top) = [0.3, 0.4]
    const gl = makeMockGL(pixels => {
      pixels[0] = 0.1
      pixels[1] = 0.2
      pixels[2] = 0.3
      pixels[3] = 0.4
    })
    const { captureDepthFromDeckFBO } = await import('./exr-export')

    const deck = {
      _framebuffer: { depthStencilAttachment: { texture: { handle: depthHandle } } },
    }

    const result = captureDepthFromDeckFBO(deck, gl, 2, 2)

    // After Y-flip: row 0 should be [0.3, 0.4], row 1 should be [0.1, 0.2]
    expect(result).not.toBeNull()
    expect(result![0]).toBeCloseTo(0.3)
    expect(result![1]).toBeCloseTo(0.4)
    expect(result![2]).toBeCloseTo(0.1)
    expect(result![3]).toBeCloseTo(0.2)
  })
})
