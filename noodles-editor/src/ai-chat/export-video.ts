// export_video and get_export_status: render the timeline to an MP4 without the
// Export button, for an external agent driving the editor over WebMCP.
//
// An export takes minutes and a tool call cannot: the local relay gives a browser
// tool 25s before it fails the call (invokeTimeoutMs in @mcp-b/webmcp-local-relay).
// So export_video starts the render and waits at most MAX_WAIT_SECONDS, then reports
// progress, and get_export_status waits on the same job until it finishes. One job at
// a time, because there is one canvas and one playhead.
//
// The MP4 is written to the project's data/.agent/renders/ through the same path guard
// as write_file, so list_files confirms it arrived. A download is triggered as well on
// request, and always when the project cannot be written to.

import { useFileSystemStore } from '../noodles/filesystem-store'
import type { CaptureResult } from '../render/renderer'
import {
  getVideoExporter,
  type VideoExportRequest,
  type VideoExportSettings,
} from '../render/video-export'
import { getTimelineStore } from '../timeline/timeline-store'
import { workerSetTimeout } from '../utils/worker-timer'
import { AGENT_DIRECTORY, type AgentStore, storageContext, writeAgentBinary } from './agent-files'
import type { ToolResult } from './types'

export const RENDERS_DIRECTORY = `${AGENT_DIRECTORY}/renders`

// Under the relay's 25s with room for the round trip
export const MAX_WAIT_SECONDS = 20

export interface ExportVideoParams extends VideoExportRequest {
  download?: boolean
  waitSeconds?: number
}

export interface ExportStatusParams {
  waitSeconds?: number
}

interface ExportJob {
  fileName: string
  // The project open when the export started. The editor stays mounted across a
  // switch between projects, so the one open at the end may be a different one.
  store: AgentStore | null
  settings: VideoExportSettings
  download: boolean
  startedAt: number
  framesDone: number
  totalFrames: number
  finished: Promise<void>
  outcome?: ToolResult
}

let job: ExportJob | null = null

const NUMBER_PARAMS = ['startTime', 'endTime', 'fps', 'width', 'height', 'waitSeconds'] as const

export async function exportVideo(params: ExportVideoParams): Promise<ToolResult> {
  if (job && !job.outcome) {
    return {
      success: false,
      error: `An export is already running (${describeProgress(job)}). Call get_export_status to follow it.`,
    }
  }

  for (const key of NUMBER_PARAMS) {
    const value = params[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      return { success: false, error: `${key} must be a number, got ${JSON.stringify(value)}` }
    }
  }

  if (typeof VideoEncoder === 'undefined' || typeof MediaStreamTrackProcessor === 'undefined') {
    return {
      success: false,
      error:
        'This browser lacks WebCodecs VideoEncoder or MediaStreamTrackProcessor, which video export needs. Use a recent Chrome or Edge.',
    }
  }

  const exporter = getVideoExporter()
  if (!exporter) {
    return { success: false, error: 'Editor not mounted — open a project first' }
  }

  const { startTime, endTime, fps, width, height, codec } = params
  let current: ExportJob | null = null
  const started = exporter({ startTime, endTime, fps, width, height, codec }, (frame, total) => {
    if (!current) return
    current.framesDone = frame
    current.totalFrames = total
  })
  if (started.status === 'refused') {
    return { success: false, error: started.error }
  }

  const { settings } = started
  const context = storageContext()
  const store = context.ok ? { type: context.type, project: context.project } : null
  const newJob: ExportJob = {
    fileName: `${fileStem(store?.project)}-${timestamp()}.mp4`,
    store,
    settings,
    download: params.download === true,
    startedAt: performance.now(),
    framesDone: 0,
    totalFrames: settings.endFrame - settings.startFrame + 1,
    finished: Promise.resolve(),
  }
  newJob.finished = started.result
    .then(result => finish(newJob, result))
    .catch(error => {
      newJob.outcome = { success: false, error: `Export failed: ${messageOf(error)}` }
    })
  current = newJob
  job = newJob

  return waitForJob(newJob, params.waitSeconds)
}

export async function getExportStatus(params: ExportStatusParams = {}): Promise<ToolResult> {
  if (!job) {
    return {
      success: true,
      data: {
        status: 'idle',
        note: 'No export has run since the page loaded. Start one with export_video.',
      },
    }
  }
  return waitForJob(job, params.waitSeconds)
}

async function waitForJob(current: ExportJob, waitSeconds?: number): Promise<ToolResult> {
  if (!current.outcome) {
    const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(0, waitSeconds ?? MAX_WAIT_SECONDS))
    let cancel = () => {}
    const timeout = new Promise<void>(resolve => {
      // A worker timer, because main-thread timers in a background tab are throttled
      // to once a minute, which would outlast the relay's timeout
      cancel = workerSetTimeout(resolve, seconds * 1000)
    })
    await Promise.race([current.finished, timeout])
    cancel()
  }

  if (current.outcome) return current.outcome

  return {
    success: true,
    data: {
      status: 'running',
      fileName: current.fileName,
      framesDone: current.framesDone,
      totalFrames: current.totalFrames,
      percent: Math.floor((current.framesDone / current.totalFrames) * 100),
      elapsedSeconds: elapsedSeconds(current),
      ...current.settings,
      note: `Still rendering. Call get_export_status to keep waiting (each call waits up to ${MAX_WAIT_SECONDS}s).`,
    },
  }
}

async function finish(current: ExportJob, result: CaptureResult): Promise<void> {
  if (result.status !== 'done' || !result.buffer) {
    const reason =
      result.status === 'error'
        ? result.error.message
        : result.status === 'cancelled'
          ? 'the render was cancelled'
          : 'the encoder produced no file'
    current.outcome = {
      success: false,
      error: `Export failed after ${current.framesDone} of ${current.totalFrames} frames: ${reason}`,
    }
    return
  }

  const blob = new Blob([result.buffer], { type: 'video/mp4' })
  const warnings: string[] = []

  const written = current.store
    ? await writeAgentBinary(`${RENDERS_DIRECTORY}/${current.fileName}`, blob, current.store)
    : ({ ok: false, error: 'no project was open' } as const)
  if (!written.ok) {
    warnings.push(`Could not save to the project (${written.error}), so it was downloaded instead.`)
  } else {
    if (current.store?.project !== useFileSystemStore.getState().currentProjectName) {
      warnings.push(
        `Saved to ${current.store?.project}, the project open when the export started, not the one open now.`
      )
    }
    if (current.store?.type === 'memory' && !current.download) {
      warnings.push(
        'This project lives in memory, so the saved copy is gone after a reload. Export again with download: true to keep one.'
      )
    }
  }

  const downloaded = current.download || !written.ok
  if (downloaded) triggerDownload(blob, current.fileName)

  if (getTimelineStore().tracks.size === 0) {
    warnings.push('The timeline has no animated tracks, so every frame shows the same scene.')
  }

  current.outcome = {
    success: true,
    data: {
      status: 'done',
      fileName: current.fileName,
      bytes: blob.size,
      frameCount: result.frameCount,
      durationSeconds: Math.round((result.frameCount / result.fps) * 1000) / 1000,
      ...current.settings,
      elapsedSeconds: elapsedSeconds(current),
      savedTo: {
        ...(written.ok ? { project: written.path } : {}),
        ...(downloaded ? { download: current.fileName } : {}),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
      note: [
        written.ok ? `Confirm with list_files({ path: '@/${RENDERS_DIRECTORY}' }).` : '',
        downloaded ? "The download goes to the browser's downloads folder." : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
  }
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // The download reads from the URL asynchronously, so revoking it at once can cancel it
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function describeProgress(current: ExportJob): string {
  return `frame ${current.framesDone} of ${current.totalFrames}, ${elapsedSeconds(current)}s in`
}

function elapsedSeconds(current: ExportJob): number {
  return Math.round((performance.now() - current.startedAt) / 100) / 10
}

function fileStem(project = 'render'): string {
  return project.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'render'
}

// 2026-10-21T14-03-22-123: sortable, legal in every file system, and to the millisecond
// because two short exports can finish within one second. writeAgentBinary refuses to
// replace a file in any case.
function timestamp(): string {
  return new Date().toISOString().slice(0, 23).replace(/[:.]/g, '-')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
