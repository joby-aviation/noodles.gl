// The map's two cameras, as Blender's 3D viewport has: the viewport, which you move around
// freely and which never renders, and the active camera, the document's, which exports and
// screenshots render through. Camera view looks through the active camera. With Lock to view on
// as well, moving the map moves the active camera; otherwise moving the map leaves camera view
// and moves the viewport. The viewport and both switches are the editor's, kept per project in
// this browser, not in the document.

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
  // Moving the map in camera view moves the active camera
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
 * What moving the map moves: the active camera when looking through it locked and it can be
 * edited, else the viewport.
 */
export function navigates(s: ViewportSwitches, cameraEditable: boolean): 'camera' | 'viewport' {
  return s.lookThrough && s.lock && cameraEditable ? 'camera' : 'viewport'
}

interface Saved extends ViewportSwitches {
  viewport?: Camera
}

interface ViewportState extends Saved {
  project?: string
  /** Switch to a project's own viewport and switches. A project starts in camera view. */
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

// Written a moment after the last change, so a drag doesn't write storage every frame
function save(state: ViewportState) {
  const { project, lookThrough, lock, viewport } = state
  if (!project) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...readAll(), [project]: { lookThrough, lock, viewport } })
      )
    } catch {
      // Storage full or off: the viewport lasts for the session
    }
  }, 300)
}

export const useViewportCamera = create<ViewportState>((set, get) => ({
  ...DEFAULTS,
  open: project => {
    if (project === get().project) return
    set({ ...DEFAULTS, viewport: undefined, ...(project ? readAll()[project] : {}), project })
  },
  // Leaving camera view goes back to where the viewport was, or starts it at the camera
  setLookThrough: (on, from) => {
    // Lock stays as it is: outside camera view it has nothing to move, as in Blender
    set(s => ({ lookThrough: on, viewport: s.viewport ?? from }))
    save(get())
  },
  // Locking looks through the camera, as it is the camera that moves
  setLock: on => {
    set(s => ({ lock: on, lookThrough: on || s.lookThrough }))
    save(get())
  },
  setViewport: camera => {
    set({ viewport: camera })
    save(get())
  },
}))

export const viewportCamera = () => useViewportCamera.getState()
