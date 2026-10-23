import { useSyncExternalStore } from 'react'
import { type StaleChunkHandler, staleChunk } from '../utils/stale-chunk'
import s from './stale-chunk-prompt.module.css'

// Shown instead of an automatic reload when part of the app failed to load after a deploy
// and reloading would discard unsaved work
export function StaleChunkPrompt({ handler = staleChunk }: { handler?: StaleChunkHandler }) {
  const visible = useSyncExternalStore(handler.subscribe, handler.isPromptVisible)
  if (!visible) return null

  return (
    <div className={s.prompt} role="status">
      <p className={s.text}>
        <strong>A new version of Noodles.gl is available</strong>
        <br />
        <span className={s.secondaryText}>
          Part of the editor could not load. Save your work, then reload.
        </span>
      </p>
      <div className={s.actions}>
        <button type="button" onClick={handler.dismissPrompt} className={s.dismissButton}>
          Dismiss
        </button>
        <button type="button" onClick={handler.reloadNow} className={s.reloadButton}>
          Reload
        </button>
      </div>
    </div>
  )
}
