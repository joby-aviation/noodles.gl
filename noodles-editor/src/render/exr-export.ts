import * as exrjs from 'exrjs'
import type { ExrCompression } from '../noodles/utils/serialization'

const { EXRWriter, Compression } = exrjs

export interface ExrCaptureOptions {
  compression: ExrCompression
  includeDepth?: boolean
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

// Extracts a single channel from interleaved RGBA data
function _extractChannel(
  data: Float32Array,
  channelIndex: number,
  totalChannels: number
): Float32Array {
  const pixelCount = data.length / totalChannels
  const result = new Float32Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    result[i] = data[i * totalChannels + channelIndex]
  }
  return result
}

// Captures pixel data from WebGL context and creates an EXR buffer
export function captureExrFrame(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  options: ExrCaptureOptions
): Uint8Array {
  const { compression, includeDepth = false } = options
  const compressionType = mapCompression(compression)

  // Check for float texture support
  const floatExt = gl.getExtension('EXT_color_buffer_float')
  const useFloatReadback = !!floatExt

  let rgbaPixels: Float32Array

  if (useFloatReadback) {
    // Read as float for HDR
    rgbaPixels = new Float32Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, rgbaPixels)
  } else {
    // Fallback: read as 8-bit and convert to float
    console.warn('EXT_color_buffer_float not available, falling back to 8-bit capture')
    const uint8Pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, uint8Pixels)
    rgbaPixels = new Float32Array(uint8Pixels.length)
    for (let i = 0; i < uint8Pixels.length; i++) {
      rgbaPixels[i] = uint8Pixels[i] / 255
    }
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

  // Add depth pass if requested
  if (includeDepth) {
    const depthPixels = new Float32Array(width * height)

    // Try to read depth buffer
    try {
      gl.readPixels(0, 0, width, height, gl.DEPTH_COMPONENT, gl.FLOAT, depthPixels)

      // Flip Y axis for depth
      const flippedDepth = flipYFloat32(depthPixels, width, height, 1)

      writer
        .addLayer('Depth')
        .channel('Z', 'f32', flippedDepth)
        .compression(compressionType)
        .sampleType('f32')
        .end()
    } catch (e) {
      console.warn('Failed to read depth buffer:', e)
    }
  }

  // Encode to buffer
  const buffer = writer.encode()
  // encode() returns ArrayBuffer
  return new Uint8Array(buffer)
}

// Captures a single PNG frame from the canvas
export function capturePngFrame(canvas: HTMLCanvasElement, quality = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Canvas is empty'))),
      'image/png',
      quality
    )
  })
}

// Captures a single JPEG frame from the canvas
export function captureJpegFrame(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Canvas is empty'))),
      'image/jpeg',
      quality
    )
  })
}
