// Shared document-level drag for controls that move the playhead (ruler, playhead
// handle, keyframe area). The timeline store pauses playback for the drag and resumes
// it after, so playback and the scrub don't both write the position. An export owns
// the playhead, so no scrub starts during one and a drag already running stops moving it.

import { useCallback, useEffect, useRef } from 'react'
import { isRendering } from '../render/render-session'
import { getTimelineStore, type ScrubSource } from './timeline-store'

// Begin a scrub and listen on the document until mouseup or window blur.
// Returns a function that ends the scrub early (safe to call more than once).
export function startScrubDrag(source: ScrubSource, onMove: (e: MouseEvent) => void): () => void {
  if (isRendering()) return () => {}

  const handleMove = (e: MouseEvent) => {
    if (!isRendering()) onMove(e)
  }
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', end)
    window.removeEventListener('blur', end)
    getTimelineStore().endScrub(source)
  }

  getTimelineStore().beginScrub(source)
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', end)
  window.addEventListener('blur', end)
  return end
}

// startScrubDrag for a component: ends a drag that is still running on unmount
export function useScrubDrag(source: ScrubSource): (onMove: (e: MouseEvent) => void) => void {
  const endRef = useRef<(() => void) | null>(null)

  useEffect(() => () => endRef.current?.(), [])

  return useCallback(
    (onMove: (e: MouseEvent) => void) => {
      endRef.current?.()
      endRef.current = startScrubDrag(source, onMove)
    },
    [source]
  )
}
