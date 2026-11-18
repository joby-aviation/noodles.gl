// What a script driving the editor reads and calls on `window.__noodles` (#883): the render
// CLI (scripts/render-project.ts) and any Playwright or Puppeteer script.
//
// - exportStatus(): the state of the current or last video export, and a `noodles:export`
//   event on window each time it changes, so a script follows an export without reading the
//   page's text. Every video export reports it, the Export button's too.
// - openProject() and renderVideo(): open a project from its files and render it, for a page
//   opened with ?headless=true or ?externalControl=true.

import { memoryProjectStore } from '../noodles/utils/memory-project-store'
import type { NoodlesProjectJSON } from '../noodles/utils/serialization'
import { getVideoExporter, type VideoExportRequest } from './video-export'

export type ExportState = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export interface ExportStatus {
  state: ExportState
  // Frames finished and the frames the export draws
  frame: number
  totalFrames: number
  error?: string
}

export const EXPORT_EVENT = 'noodles:export'

let status: ExportStatus = { state: 'idle', frame: 0, totalFrames: 0 }

export function exportStatus(): ExportStatus {
  return { ...status }
}

export function setExportStatus(next: ExportStatus) {
  status = { ...next }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EXPORT_EVENT, { detail: exportStatus() }))
  }
}

/** A project's files, as a script read them from a folder: paths as `@/` names them. */
export interface ProjectFiles {
  // The project's noodles.json
  project: unknown
  // Data files, base64, by the path `@/` gives them (`data.csv`, `tiles/a.png`)
  files?: Record<string, string>
}

const PROJECT_ID = /^[\w.-]+$/

/**
 * Opens a project from its files as an in-memory project at `/examples/<id>`, the way a
 * bundled example opens, and resolves once it is open. Nothing is written to disk.
 */
export async function openProject(
  id: string,
  { project, files = {} }: ProjectFiles,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {}
): Promise<{ route: string }> {
  if (!PROJECT_ID.test(id)) throw new Error(`Project id '${id}' must be letters, digits, . _ or -`)
  memoryProjectStore.setProjectJson(id, project as NoodlesProjectJSON)
  for (const [path, base64] of Object.entries(files)) {
    memoryProjectStore.writeAsset(id, path, new Blob([fromBase64(base64)]))
  }
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  const route = `/examples/${id}`
  const { closeProject, openRoute, useProjectOpen } = await import('../editor/project-open')
  const before = useProjectOpen.getState()
  if ('route' in before && before.route === route) {
    // The route is already open, with the document from an earlier call: the URL doesn't
    // change, so nothing would reopen it. Drop that open and open the new copy.
    closeProject()
    void openRoute('/examples', id)
  } else {
    // wouter follows pushState; the query (?headless=true) stays
    window.history.pushState(null, '', `${base}${route}${window.location.search}`)
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`The project did not open within ${timeoutMs / 1000}s`))
    }, timeoutMs)
    const check = () => {
      const state = useProjectOpen.getState()
      if (!('route' in state) || state.route !== route) return false
      if (state.status === 'open') resolve()
      else if (state.status === 'failed' || state.status === 'not-found')
        reject(new Error(`The project could not be opened (${state.status})`))
      else return false
      return true
    }
    const unsubscribe = useProjectOpen.subscribe(() => {
      if (check()) stop()
    })
    const stop = () => {
      clearTimeout(timer)
      unsubscribe()
    }
    if (check()) stop()
  })
  return { route }
}

/** Whether the editor can export now: it is mounted and registered its exporter. */
export function canExport(): boolean {
  return getVideoExporter() !== null
}

export type RenderResult =
  | { status: 'done'; frameCount: number; fps: number; mimeType: string; base64: string }
  | { status: 'error' | 'cancelled'; error: string }

/**
 * Renders the timeline as the Export button does, settings from the project's render
 * settings unless given, and returns the file. Progress arrives as `noodles:export` events.
 */
export async function renderVideo(request: VideoExportRequest = {}): Promise<RenderResult> {
  const exporter = getVideoExporter()
  if (!exporter)
    return { status: 'error', error: 'The editor is not mounted: open a project first' }
  const started = exporter(request, () => {})
  if (started.status === 'refused') return { status: 'error', error: started.error }
  const result = await started.result
  if (result.status === 'done' && result.buffer) {
    return {
      status: 'done',
      frameCount: result.frameCount,
      fps: result.fps,
      mimeType: 'video/mp4',
      base64: toBase64(result.buffer),
    }
  }
  if (result.status === 'cancelled')
    return { status: 'cancelled', error: 'The render was cancelled' }
  return {
    status: 'error',
    error: result.status === 'error' ? result.error.message : 'The encoder produced no file',
  }
}

export interface HeadlessApi {
  exportStatus: typeof exportStatus
  openProject?: typeof openProject
  canExport?: typeof canExport
  renderVideo?: typeof renderVideo
}

declare global {
  interface Window {
    __noodles?: HeadlessApi
  }
}

/**
 * Puts the API on window. exportStatus always; opening and rendering only when the page
 * opted in (`?headless=true`, or `?externalControl=true` for an agent driving the editor).
 */
export function installHeadlessApi(search = window.location.search) {
  const query = new URLSearchParams(search)
  const optedIn = query.get('headless') === 'true' || query.get('externalControl') === 'true'
  window.__noodles = {
    exportStatus,
    ...(optedIn ? { openProject, canExport, renderVideo } : {}),
  }
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // In chunks: String.fromCharCode with a whole video as arguments overflows the stack
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
