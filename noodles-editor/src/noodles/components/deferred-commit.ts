// Edits held back from the project until a dialog closes, or handed over every `LIVE_MS` while
// `live` is on: dragging a color makes an edit per pointer move, and each one reaching the
// project restyles the main map. Closing the dialog, however it closes, or unmounting it hands
// over the last edit.

import { useEffect, useRef } from 'react'

export const LIVE_MS = 150

export function useDeferredCommit<T>(onCommit: (value: T) => void, live: boolean, open: boolean) {
  const pending = useRef<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commit = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (!pending.current) return
    const { value } = pending.current
    pending.current = null
    onCommit(value)
  }
  // The latest, for the timer and the cleanups below
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    if (!open) commitRef.current()
  }, [open])
  useEffect(() => () => commitRef.current(), [])
  // Turned on, it hands over what was held back; turned off, a handover already due is
  // called off, and what it would have handed waits for the dialog to close
  useEffect(() => {
    if (live) commitRef.current()
    else {
      clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [live])

  const change = (value: T) => {
    pending.current = { value }
    if (live) timer.current ??= setTimeout(() => commitRef.current(), LIVE_MS)
  }
  return { change, commit }
}
