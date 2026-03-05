// FFmpeg-based video encoder for alpha transparency support.
// Uses VP9 codec with yuva420p pixel format for reliable alpha encoding.

import { getFFmpeg, type FFmpegLoadProgress } from './ffmpeg-loader'
import { debugRender, debugRenderFrame } from '../utils/debug'

export type EncoderProgress = {
  stage: 'loading-ffmpeg' | 'writing-frames' | 'encoding' | 'finalizing'
  progress: number
  currentFrame?: number
  totalFrames?: number
}

export interface EncodeWithAlphaOptions {
  width: number
  height: number
  fps: number
  bitrate: number
  onProgress?: (progress: EncoderProgress) => void
}

// Encode RGBA frames to WebM with VP9 alpha using FFmpeg WASM.
// Frames are collected first, then batch-encoded.
export async function encodeWithAlpha(
  frames: Uint8Array[],
  options: EncodeWithAlphaOptions
): Promise<Uint8Array> {
  const { width, height, fps, bitrate, onProgress } = options
  const totalFrames = frames.length

  debugRender('Starting FFmpeg alpha encode: %d frames, %dx%d', totalFrames, width, height)

  // Load FFmpeg (may already be cached)
  onProgress?.({ stage: 'loading-ffmpeg', progress: 0 })
  const ffmpeg = await getFFmpeg((loadProgress: FFmpegLoadProgress) => {
    onProgress?.({
      stage: 'loading-ffmpeg',
      progress: loadProgress.progress,
    })
  })

  // Write frames to FFmpeg virtual filesystem
  debugRender('Writing %d frames to FFmpeg filesystem', totalFrames)
  for (let i = 0; i < totalFrames; i++) {
    const filename = `frame${String(i).padStart(6, '0')}.raw`
    await ffmpeg.writeFile(filename, frames[i])

    if (i % 10 === 0) {
      debugRenderFrame('Wrote frame %d/%d to FFmpeg', i, totalFrames)
    }

    onProgress?.({
      stage: 'writing-frames',
      progress: i / totalFrames,
      currentFrame: i,
      totalFrames,
    })
  }

  // Set up progress tracking for encoding
  ffmpeg.on('progress', (data: { progress: number }) => {
    onProgress?.({
      stage: 'encoding',
      progress: data.progress,
      totalFrames,
    })
  })

  // Encode to WebM with VP9 alpha
  // -f rawvideo: input is raw video frames
  // -pixel_format rgba: input pixel format
  // -video_size: frame dimensions
  // -framerate: frames per second
  // -i: input file pattern (frame000000.raw, frame000001.raw, etc.)
  // -c:v libvpx-vp9: VP9 codec (supports alpha)
  // -pix_fmt yuva420p: output format with alpha plane
  // -b:v: target bitrate
  // -auto-alt-ref 0: disable alternate reference frames (required for alpha)
  debugRender('Starting FFmpeg encode with bitrate %d', bitrate)
  await ffmpeg.exec([
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'frame%06d.raw',
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-b:v', `${bitrate}`,
    '-auto-alt-ref', '0',
    'output.webm',
  ])

  // Read encoded output
  onProgress?.({ stage: 'finalizing', progress: 0.5 })
  const data = await ffmpeg.readFile('output.webm')
  debugRender('FFmpeg encode complete, output size: %d bytes', (data as Uint8Array).length)

  // Cleanup temporary files
  for (let i = 0; i < totalFrames; i++) {
    const filename = `frame${String(i).padStart(6, '0')}.raw`
    await ffmpeg.deleteFile(filename)
  }
  await ffmpeg.deleteFile('output.webm')

  onProgress?.({ stage: 'finalizing', progress: 1 })

  return new Uint8Array(data as ArrayBuffer)
}

// Extract RGBA data from a canvas element
export function canvasToRGBA(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas')
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return new Uint8Array(imageData.data.buffer)
}

// Extract RGBA data from a VideoFrame
export async function videoFrameToRGBA(
  frame: VideoFrame,
  width: number,
  height: number
): Promise<Uint8Array> {
  // Create an offscreen canvas to draw the frame
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get 2D context from offscreen canvas')
  }

  // Draw the VideoFrame to the canvas
  ctx.drawImage(frame, 0, 0, width, height)

  // Get the image data
  const imageData = ctx.getImageData(0, 0, width, height)
  return new Uint8Array(imageData.data.buffer)
}
