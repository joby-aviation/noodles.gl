import { create } from 'zustand'
import { playbackDriver } from '../timeline/playback'
import { getTimelineStore } from '../timeline/timeline-store'
import type { RenderSource } from './render-analytics'

// The one export that can run at a time, and its progress. There is one canvas, one
// playhead and one frame-ready callback, so every way in (the Export button, the logo
// menu, the export_video tool) claims the session with beginRender before it touches
// them. The claim is synchronous, so two callers that start in the same tick can't
// both get it.
//
// The editor skips React re-renders while an export runs, so progress lives here and
// only the components that subscribe re-render.
export type RenderSession =
  | { status: 'idle' }
  | { status: 'exporting'; kind: 'video' | 'sequence'; source: RenderSource }

interface RenderSessionState {
  session: RenderSession
  // null until the first frame finishes
  percent: number | null
}

const IDLE: RenderSession = { status: 'idle' }

export const useRenderSessionStore = create<RenderSessionState>(() => ({
  session: IDLE,
  percent: null,
}))

export function isRendering(): boolean {
  return useRenderSessionStore.getState().session.status !== 'idle'
}

export function useIsRendering(): boolean {
  return useRenderSessionStore(state => state.session.status !== 'idle')
}

// Claims the session, or returns null when an export is already running. The returned
// release ends it and is safe to call more than once.
//
// While the session is held, the playback loop is off: the export sets the playhead
// for each frame, and a playing timeline would move it between the set and the read.
export function beginRender(kind: 'video' | 'sequence', source: RenderSource): (() => void) | null {
  if (isRendering()) return null

  const session: RenderSession = { status: 'exporting', kind, source }
  useRenderSessionStore.setState({ session, percent: null })
  getTimelineStore().pause()
  playbackDriver.setManualMode(true)

  let released = false
  return () => {
    if (released) return
    released = true
    // The playback loop follows the store again
    playbackDriver.setManualMode(false)
    if (useRenderSessionStore.getState().session === session) {
      useRenderSessionStore.setState({ session: IDLE })
    }
  }
}

// Called once per frame: only a change in the whole percent reaches subscribers
export function setRenderProgress(frame: number, total: number) {
  const percent = total > 0 ? Math.min(100, Math.floor((frame / total) * 100)) : 0
  if (useRenderSessionStore.getState().percent !== percent) {
    useRenderSessionStore.setState({ percent })
  }
}

export function resetRenderProgress() {
  useRenderSessionStore.setState({ percent: null })
}
