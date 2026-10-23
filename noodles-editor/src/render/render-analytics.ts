// Analytics for video and image sequence exports. useRenderer calls this for every
// render, whether the Export button or the export_video tool started it, so each one
// is counted once: render_started, then exactly one of render_completed, render_failed
// or render_cancelled. See dev-docs/analytics.md.

import { analytics } from '../utils/analytics'

// menu: the logo menu and the Out node's panel; toolbar: the top bar's Export button
export type RenderSource = 'menu' | 'toolbar' | 'agent'

export type RenderErrorCategory =
  | 'unsupported_codec' // the browser has no encoder for this codec and size
  | 'frame' // the scene reported an error while drawing a frame
  | 'encoder' // the VideoEncoder reported an error
  | 'exception' // anything thrown: muxing, file writes, a missing frame
  | 'canvas_replaced' // the recorded canvas was rebuilt mid-export, e.g. the basemap toggled
  | 'timeout' // a frame took too long to draw or to read from the canvas

// By the short side, so a portrait 1080x1920 video counts as 1080p
export function resolutionBucket(width: number, height: number): string {
  const short = Math.min(width, height)
  if (short >= 4320) return '8k'
  if (short >= 2160) return '4k'
  if (short >= 1440) return '1440p'
  if (short >= 1080) return '1080p'
  if (short >= 720) return '720p'
  return 'under_720p'
}

// The class or DOMException name (NotAllowedError, EncodingError). Never the message,
// which can hold file paths or project content.
function errorName(error: Error): string {
  return /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error'
}

export function trackRender({
  source,
  format,
  codec,
  captureMode = 'final',
  width,
  height,
  frameCount,
}: {
  source: RenderSource
  format: 'mp4' | 'webm' | 'png_sequence' | 'exr_sequence'
  codec?: string
  captureMode?: 'final' | 'preview'
  width: number
  height: number
  frameCount: number
}) {
  const common = {
    source,
    format,
    ...(codec ? { codec } : {}),
    captureMode,
    resolution: resolutionBucket(width, height),
    frameCount,
  }
  analytics.track('render_started', common)

  let startedAt = performance.now()
  let ended = false
  const end = (event: string, extra: Record<string, unknown> = {}) => {
    if (ended) return
    ended = true
    analytics.track(event, {
      ...common,
      durationMs: Math.round(performance.now() - startedAt),
      ...extra,
    })
  }

  return {
    // Called once the save dialog closes, so time spent choosing a file is not render time
    restartClock: () => {
      startedAt = performance.now()
    },
    completed: () => end('render_completed'),
    cancelled: () => end('render_cancelled'),
    failed: (category: RenderErrorCategory, error: Error, framesDone: number) =>
      end('render_failed', { errorCategory: category, errorName: errorName(error), framesDone }),
  }
}
