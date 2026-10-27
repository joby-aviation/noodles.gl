// The map's two cameras, as Blender's 3D viewport has: the viewport, which you move around
// freely and which never renders, and the active camera, the document's, which exports and
// screenshots render through. Moving the map takes you to the viewport; moving the playhead
// (scrubbing, stepping, playing) takes you back to the camera. The lock pins whichever you are
// in: a locked viewport stays put when the playhead moves, and a locked camera view stays when
// the map moves, which then moves the camera itself. The viewport and the switches are the
// editor's, kept per project in this browser, not in the document.

import { create } from 'zustand'

export interface Camera {
  longitude: number
  latitude: number
  zoom: number
  pitch: number
  bearing: number
}

const STORAGE_KEY = 'noodles-viewport'

/** A map view state as a camera, when it has a position and a zoom. */
export function cameraOf(v: unknown): Camera | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as Record<string, unknown>
  const n = (k: string, fallback?: number) =>
    typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : fallback
  const longitude = n('longitude')
  const latitude = n('latitude')
  const zoom = n('zoom')
  if (longitude === undefined || latitude === undefined || zoom === undefined) return undefined
  return { longitude, latitude, zoom, pitch: n('pitch', 0) ?? 0, bearing: n('bearing', 0) ?? 0 }
}

export interface ViewportSwitches {
  // Looking through the active camera
  lookThrough: boolean
  // Pins the view you are in: the viewport through playhead moves, the camera through map moves
  lock: boolean
}

/** What the map shows: the active camera while exporting, in camera view, or before any move. */
export function showsCamera(
  s: ViewportSwitches & { viewport?: Camera },
  rendering: boolean
): boolean {
  return rendering || s.lookThrough || !s.viewport
}

/**
 * What moving the map moves: the active camera in a locked camera view, if it can be edited,
 * and nothing if it can't; otherwise the viewport.
 */
export function navigates(
  s: ViewportSwitches,
  cameraEditable: boolean
): 'camera' | 'viewport' | 'none' {
  if (s.lookThrough && s.lock) return cameraEditable ? 'camera' : 'none'
  return 'viewport'
}

/** Whether a playhead move takes the map back to the camera: unless the viewport is locked. */
export const playheadShowsCamera = (s: ViewportSwitches) => !s.lookThrough && !s.lock

interface Saved extends ViewportSwitches {
  viewport?: Camera
}

interface ViewportState extends Saved {
  project?: string
  /**
   * Switch to a project's own viewport and switches, by a key naming where the project lives and
   * its name. A project starts in camera view.
   */
  open: (project: string | undefined) => void
  setLookThrough: (on: boolean, from?: Camera) => void
  setLock: (on: boolean) => void
  setViewport: (camera: Camera) => void
}

const DEFAULTS: Saved = { lookThrough: true, lock: false }

function readAll(): Record<string, Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Saved>
  } catch {
    return {}
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let pending: { project: string; saved: Saved } | undefined

function flush() {
  clearTimeout(saveTimer)
  if (!pending) return
  const { project, saved } = pending
  pending = undefined
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [project]: saved }))
  } catch {
    // Storage full or off: the viewport lasts for the session
  }
}

// Written a moment after the last change, so a drag doesn't write storage every frame. Opening
// another project writes it at once (`open`), so a quick switch keeps it.
function save(state: ViewportState) {
  const { project, lookThrough, lock, viewport } = state
  if (!project) return
  pending = { project, saved: { lookThrough, lock, viewport } }
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 300)
}

export const useViewportCamera = create<ViewportState>((set, get) => ({
  ...DEFAULTS,
  open: project => {
    if (project === get().project) return
    flush()
    set({ ...DEFAULTS, viewport: undefined, ...(project ? readAll()[project] : {}), project })
  },
  // Leaving camera view goes back to where the viewport was, or starts it at the camera
  setLookThrough: (on, from) => {
    // The lock stays on, and pins the view you switched to
    set(s => ({ lookThrough: on, viewport: s.viewport ?? from }))
    save(get())
  },
  setLock: on => {
    set({ lock: on })
    save(get())
  },
  setViewport: camera => {
    set({ viewport: camera })
    save(get())
  },
}))

export const viewportCamera = () => useViewportCamera.getState()
