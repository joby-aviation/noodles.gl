// Glue between the export_video tool and the editor's renderer. useRenderer is a hook,
// so the editor registers an exporter here while it is mounted and the tool calls it.
// Kept free of React and of the ai-chat modules so timeline-editor.tsx can import it
// without pulling the tool surface into the editor.

import type { CaptureResult, VideoCodec } from './renderer'

export const VIDEO_CODECS: VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1']

// Everything is optional: a field left out takes the active OutOp's render setting,
// and the time range defaults to the timeline's in/out points, then its full length
export interface VideoExportRequest {
  startTime?: number
  endTime?: number
  fps?: number
  width?: number
  height?: number
  codec?: VideoCodec
}

export interface VideoExportSettings {
  startTime: number
  endTime: number
  startFrame: number
  endFrame: number
  fps: number
  width: number
  height: number
  codec: VideoCodec
}

// What the editor knows when an export starts
export interface VideoExportContext {
  sequenceLength: number
  inPoint?: number
  outPoint?: number
  framerate: number
  resolution: { width: number; height: number }
  codec: VideoCodec
}

const MAX_FPS = 120
const MAX_DIMENSION = 8192

export function resolveExportSettings(
  request: VideoExportRequest,
  context: VideoExportContext
): { ok: true; settings: VideoExportSettings } | { ok: false; error: string } {
  const { sequenceLength } = context
  if (!(sequenceLength > 0)) {
    return { ok: false, error: 'The timeline is empty (length 0), so there is nothing to export' }
  }

  const fps = request.fps ?? context.framerate
  // Fractional rates such as 29.97 are fine; the renderer times frames as i / fps
  if (!Number.isFinite(fps) || fps < 1 || fps > MAX_FPS) {
    return { ok: false, error: `fps must be a number from 1 to ${MAX_FPS}, got ${fps}` }
  }

  const width = request.width ?? context.resolution.width
  const height = request.height ?? context.resolution.height
  for (const [name, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    // 4:2:0 encoders need even dimensions; rounding silently would change the frame
    if (!Number.isInteger(value) || value < 2 || value > MAX_DIMENSION || value % 2 !== 0) {
      return {
        ok: false,
        error: `${name} must be an even whole number from 2 to ${MAX_DIMENSION}, got ${value}`,
      }
    }
  }

  const codec = request.codec ?? context.codec
  if (!VIDEO_CODECS.includes(codec)) {
    return { ok: false, error: `codec must be one of ${VIDEO_CODECS.join(', ')}, got ${codec}` }
  }

  const startTime = request.startTime ?? context.inPoint ?? 0
  const endTime = request.endTime ?? context.outPoint ?? sequenceLength
  if (startTime < 0 || endTime > sequenceLength) {
    return {
      ok: false,
      error: `The range ${startTime}s-${endTime}s is outside the timeline (0s-${sequenceLength}s)`,
    }
  }
  const startFrame = Math.floor(startTime * fps)
  const endFrame = Math.floor(endTime * fps)
  if (!(endTime > startTime) || endFrame <= startFrame) {
    return {
      ok: false,
      error: `endTime (${endTime}s) must be at least one frame after startTime (${startTime}s)`,
    }
  }

  return {
    ok: true,
    settings: { startTime, endTime, startFrame, endFrame, fps, width, height, codec },
  }
}

export type VideoExportOutcome =
  | { status: 'started'; settings: VideoExportSettings; result: Promise<CaptureResult> }
  | { status: 'refused'; error: string }

export type VideoExporter = (
  request: VideoExportRequest,
  onFrameComplete: (frame: number, total: number) => void
) => VideoExportOutcome

let exporter: VideoExporter | null = null

export function setVideoExporter(fn: VideoExporter | null) {
  exporter = fn
}

export function getVideoExporter(): VideoExporter | null {
  return exporter
}
