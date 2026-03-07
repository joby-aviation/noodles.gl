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

describe('captureExrFrameFromImageData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeImageData(width: number, height: number, fill?: (data: Uint8ClampedArray) => void) {
    const data = new Uint8ClampedArray(width * height * 4)
    fill?.(data)
    return { width, height, data, colorSpace: 'srgb' as const }
  }

  it('should convert Uint8ClampedArray to normalized Float32Array [0,1]', async () => {
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    // 2x1 image: pixel 0 = (255, 128, 0, 255), pixel 1 = (0, 0, 255, 128)
    const imageData = makeImageData(2, 1, data => {
      data[0] = 255
      data[1] = 128
      data[2] = 0
      data[3] = 255
      data[4] = 0
      data[5] = 0
      data[6] = 255
      data[7] = 128
    })

    captureExrFrameFromImageData(imageData, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    const rgbaArg = instance.rgba.mock.calls[0][0] as Float32Array

    // Check normalized values
    expect(rgbaArg[0]).toBeCloseTo(1.0) // 255/255
    expect(rgbaArg[1]).toBeCloseTo(128 / 255) // 128/255
    expect(rgbaArg[2]).toBeCloseTo(0) // 0/255
    expect(rgbaArg[3]).toBeCloseTo(1.0) // 255/255
    expect(rgbaArg[4]).toBeCloseTo(0) // 0/255
    expect(rgbaArg[5]).toBeCloseTo(0) // 0/255
    expect(rgbaArg[6]).toBeCloseTo(1.0) // 255/255
    expect(rgbaArg[7]).toBeCloseTo(128 / 255) // 128/255
  })

  it('should NOT flip Y axis (ImageData is already top-down)', async () => {
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    // 2x2 image: top row = red, bottom row = green
    const imageData = makeImageData(2, 2, data => {
      // Row 0 (top): red pixels
      data[0] = 255
      data[1] = 0
      data[2] = 0
      data[3] = 255
      data[4] = 255
      data[5] = 0
      data[6] = 0
      data[7] = 255
      // Row 1 (bottom): green pixels
      data[8] = 0
      data[9] = 255
      data[10] = 0
      data[11] = 255
      data[12] = 0
      data[13] = 255
      data[14] = 0
      data[15] = 255
    })

    captureExrFrameFromImageData(imageData, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    const rgbaArg = instance.rgba.mock.calls[0][0] as Float32Array

    // First row should still be red (no flip)
    expect(rgbaArg[0]).toBeCloseTo(1.0) // R
    expect(rgbaArg[1]).toBeCloseTo(0) // G
    expect(rgbaArg[2]).toBeCloseTo(0) // B
    // Second row should still be green (no flip)
    expect(rgbaArg[8]).toBeCloseTo(0) // R
    expect(rgbaArg[9]).toBeCloseTo(1.0) // G
    expect(rgbaArg[10]).toBeCloseTo(0) // B
  })

  it('should add Beauty layer with rgba data', async () => {
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    const imageData = makeImageData(4, 4)
    captureExrFrameFromImageData(imageData, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    expect(instance.addLayer).toHaveBeenCalledWith('Beauty')
    expect(instance.rgba).toHaveBeenCalledWith(expect.any(Float32Array))
    expect(instance.compression).toHaveBeenCalled()
    expect(instance.sampleType).toHaveBeenCalledWith('f32')
    expect(instance.scanlines).toHaveBeenCalled()
    expect(instance.end).toHaveBeenCalled()
  })

  it('should not add Depth layer when depth is not provided', async () => {
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    const imageData = makeImageData(4, 4)
    captureExrFrameFromImageData(imageData, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    expect(instance.addLayer).not.toHaveBeenCalledWith('Depth')
  })

  it('should add Depth layer with Z channel when depth is provided', async () => {
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    const imageData = makeImageData(4, 4)
    const depth = new Float32Array(16).fill(0.5)
    captureExrFrameFromImageData(imageData, { compression: 'zip', depth })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    expect(instance.addLayer).toHaveBeenCalledWith('Depth')
    expect(instance.channel).toHaveBeenCalledWith('Z', 'f32', depth)
  })

  it('should return Uint8Array from encode()', async () => {
    const { captureExrFrameFromImageData } = await import('./exr-export')

    const imageData = makeImageData(2, 2)
    const result = captureExrFrameFromImageData(imageData, { compression: 'zip' })

    expect(result).toBeInstanceOf(Uint8Array)
  })
})

describe('EXR pixel data capture (regression tests for blank frames)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass non-zero pixel data to EXRWriter when ImageData has content', async () => {
    // This test catches the blank frame bug where gl.readPixels returned zeros
    vi.doUnmock('exrjs')
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    // Create ImageData with known non-zero content (red pixel)
    const data = new Uint8ClampedArray([255, 0, 0, 255]) // RGBA red
    const imageData = { width: 1, height: 1, data, colorSpace: 'srgb' as const }

    captureExrFrameFromImageData(imageData, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    const rgbaArg = instance.rgba.mock.calls[0][0] as Float32Array

    // Verify we passed non-zero data (not blank)
    const hasNonZero = rgbaArg.some(v => v > 0)
    expect(hasNonZero).toBe(true)
    expect(rgbaArg[0]).toBeCloseTo(1.0) // Red channel should be 1.0
  })

  it('should detect blank frames when ImageData is all zeros', async () => {
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    // Simulate blank frame - all zeros (this is what the bug produced)
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(0)
    const imageData = { width: 4, height: 4, data, colorSpace: 'srgb' as const }

    captureExrFrameFromImageData(imageData, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    const rgbaArg = instance.rgba.mock.calls[0][0] as Float32Array

    // All zeros - this would indicate a blank frame capture
    const allZero = rgbaArg.every(v => v === 0)
    expect(allZero).toBe(true)
  })

  it('should capture pixel data from OffscreenCanvas via getImageData', async () => {
    // This simulates the actual capture flow: OffscreenCanvas → getImageData → EXR
    // Tests that the compositor-based approach correctly extracts pixel data
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    // Create a real OffscreenCanvas and draw known content
    const offscreen = new OffscreenCanvas(2, 2)
    const ctx = offscreen.getContext('2d')!

    // Draw a red rectangle (top-left), green (top-right), blue (bottom-left), white (bottom-right)
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(1, 0, 1, 1)
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(0, 1, 1, 1)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(1, 1, 1, 1)

    // This is the exact flow used in renderer.ts
    const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height)

    captureExrFrameFromImageData(imageData, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    const rgbaArg = instance.rgba.mock.calls[0][0] as Float32Array

    // Verify we captured actual pixel data (not blank)
    const hasNonZero = rgbaArg.some(v => v > 0)
    expect(hasNonZero).toBe(true)

    // Verify specific pixels (RGBA, 4 values per pixel)
    // Pixel 0 (top-left): Red
    expect(rgbaArg[0]).toBeCloseTo(1.0) // R
    expect(rgbaArg[1]).toBeCloseTo(0) // G
    expect(rgbaArg[2]).toBeCloseTo(0) // B

    // Pixel 1 (top-right): Green
    expect(rgbaArg[4]).toBeCloseTo(0) // R
    expect(rgbaArg[5]).toBeCloseTo(1.0) // G (may have slight variation due to color space)
    expect(rgbaArg[6]).toBeCloseTo(0) // B

    // Pixel 2 (bottom-left): Blue
    expect(rgbaArg[8]).toBeCloseTo(0) // R
    expect(rgbaArg[9]).toBeCloseTo(0) // G
    expect(rgbaArg[10]).toBeCloseTo(1.0) // B

    // Pixel 3 (bottom-right): White
    expect(rgbaArg[12]).toBeCloseTo(1.0) // R
    expect(rgbaArg[13]).toBeCloseTo(1.0) // G
    expect(rgbaArg[14]).toBeCloseTo(1.0) // B
  })

  it('should preserve alpha channel from ImageData', async () => {
    const { captureExrFrameFromImageData, EXRWriter } = await import('./exr-export').then(
      async m => ({
        ...m,
        EXRWriter: (await import('exrjs')).EXRWriter,
      })
    )

    // Create ImageData with semi-transparent pixel
    const data = new Uint8ClampedArray([255, 0, 0, 128]) // Red at 50% alpha
    const imageData = { width: 1, height: 1, data, colorSpace: 'srgb' as const }

    captureExrFrameFromImageData(imageData, { compression: 'zip' })

    const instance = (EXRWriter as ReturnType<typeof vi.fn>).mock.instances.at(-1)
    const rgbaArg = instance.rgba.mock.calls[0][0] as Float32Array

    expect(rgbaArg[0]).toBeCloseTo(1.0) // R
    expect(rgbaArg[3]).toBeCloseTo(128 / 255) // A = ~0.5
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
