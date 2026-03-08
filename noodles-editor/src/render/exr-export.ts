import * as exrjs from 'exrjs'
import type { ExrCompression } from '../noodles/utils/serialization'

const { EXRWriter, Compression } = exrjs

export interface ExrCaptureOptions {
  compression: ExrCompression
  // Pre-captured depth buffer (Y-flipped, from captureDepthFromDeckFBO).
  // If absent or null, no Depth layer is written.
  depth?: Float32Array | null
}

// Maps our compression type names to exrjs compression constants
function mapCompression(compression: ExrCompression): number {
  switch (compression) {
    case 'none':
      return Compression.Uncompressed
    case 'zip':
      return Compression.ZIP16
    case 'piz':
      return Compression.PIZ
    default:
      return Compression.ZIP16
  }
}

// Flips Float32Array pixel data vertically (WebGL is bottom-up, EXR is top-down)
export function flipYFloat32(
  data: Float32Array,
  width: number,
  height: number,
  channels: number
): Float32Array {
  const result = new Float32Array(data.length)
  const rowSize = width * channels
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowSize
    const dstRow = y * rowSize
    result.set(data.subarray(srcRow, srcRow + rowSize), dstRow)
  }
  return result
}

// Captures pixel data from ImageData (2D canvas) and creates an EXR buffer.
// ImageData is already top-down, so no Y-flip is needed (unlike gl.readPixels).
// This is the preferred path for basemap scenes where gl.readPixels may read a cleared buffer.
export function captureExrFrameFromImageData(
  imageData: ImageData,
  options: ExrCaptureOptions
): Uint8Array {
  const { compression, depth } = options
  const { width, height, data } = imageData
  const compressionType = mapCompression(compression)

  // Convert Uint8ClampedArray to Float32Array normalized to [0,1]
  const rgbaPixels = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    rgbaPixels[i] = data[i] / 255
  }

  // ImageData is already top-down (same as EXR), no Y-flip needed

  const writer = new EXRWriter(width, height)

  writer
    .addLayer('Beauty')
    .rgba(rgbaPixels)
    .compression(compressionType)
    .sampleType('f32')
    .scanlines()
    .end()

  if (depth) {
    writer
      .addLayer('Depth')
      .channel('Z', 'f32', depth)
      .compression(compressionType)
      .sampleType('f32')
      .end()
  }

  const buffer = writer.encode()
  return new Uint8Array(buffer)
}

// Captures pixel data from WebGL context and creates an EXR buffer.
// depth (if provided) must already be Y-flipped — use captureDepthFromDeckFBO.
export function captureExrFrame(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  options: ExrCaptureOptions
): Uint8Array {
  const { compression, depth } = options
  const compressionType = mapCompression(compression)

  // The canvas default framebuffer is always 8-bit regardless of EXT_color_buffer_float,
  // which only applies to offscreen framebuffers. Read as UNSIGNED_BYTE and normalize to [0,1].
  //
  // MapLibre (interleaved mode) leaves its internal FBO bound as the READ framebuffer after
  // rendering. Explicitly bind FBO 0 (canvas) so readPixels captures the composited result.
  const prevReadFBO = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
  const uint8Pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, uint8Pixels)
  if (prevReadFBO !== null) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevReadFBO)
  }
  const rgbaPixels = new Float32Array(uint8Pixels.length)
  for (let i = 0; i < uint8Pixels.length; i++) {
    rgbaPixels[i] = uint8Pixels[i] / 255
  }

  // Flip Y axis (WebGL is bottom-up, EXR is top-down)
  const flippedRgba = flipYFloat32(rgbaPixels, width, height, 4)

  // Create EXR writer
  const writer = new EXRWriter(width, height)

  // Add beauty pass (RGBA)
  writer
    .addLayer('Beauty')
    .rgba(flippedRgba)
    .compression(compressionType)
    .sampleType('f32')
    .scanlines()
    .end()

  // Add depth pass if provided (already Y-flipped by captureDepthFromDeckFBO)
  if (depth) {
    writer
      .addLayer('Depth')
      .channel('Z', 'f32', depth)
      .compression(compressionType)
      .sampleType('f32')
      .end()
  }

  // Encode to buffer
  const buffer = writer.encode()
  // encode() returns ArrayBuffer
  return new Uint8Array(buffer)
}

// Reads depth from Deck.gl's internal framebuffer. Must be called synchronously
// during or just after onAfterRender, before the FBO is cleared for the next frame.
//
// Deck.gl renders to a private luma.gl Framebuffer (_framebuffer) and blits only
// color to the canvas — the canvas depth buffer is never populated with scene depth.
// This function reads deck._framebuffer.depthStencilAttachment.texture directly
// by attaching it to a temporary read FBO.
//
// Returns null if the deck instance does not expose the expected FBO structure.
export function captureDepthFromDeckFBO(
  deck: unknown,
  gl: WebGL2RenderingContext,
  width: number,
  height: number
): Float32Array | null {
  // deck.setProps({ _framebuffer }) stores in deck.props._framebuffer, not deck._framebuffer
  // biome-ignore lint/suspicious/noExplicitAny: accessing Deck.gl private internals
  const fbo = (deck as any)?.props?._framebuffer ?? (deck as any)?._framebuffer
  const depthHandle = fbo?.depthStencilAttachment?.texture?.handle
  if (!depthHandle) {
    console.log('[depth] fbo:', fbo, 'depthStencilAttachment:', fbo?.depthStencilAttachment)
    return null
  }

  // Bind the depth texture to a temporary read FBO so gl.readPixels can access it
  const tempFBO = gl.createFramebuffer()
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tempFBO)
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthHandle, 0)

  const pixels = new Float32Array(width * height)
  gl.readPixels(0, 0, width, height, gl.DEPTH_COMPONENT, gl.FLOAT, pixels)

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
  gl.deleteFramebuffer(tempFBO)

  // Flip Y axis: WebGL is bottom-up, EXR is top-down
  return flipYFloat32(pixels, width, height, 1)
}
