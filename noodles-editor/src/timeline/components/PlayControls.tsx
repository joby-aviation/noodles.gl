// Play controls component - play/pause/loop/speed controls

import { useTimelineStore } from '../timeline-store'
import s from './TimelinePanel.module.css'

export function PlayControls() {
  const playing = useTimelineStore(state => state.playing)
  const loop = useTimelineStore(state => state.loop)

  const play = useTimelineStore(state => state.play)
  const pause = useTimelineStore(state => state.pause)
  const toggleLoop = useTimelineStore(state => state.toggleLoop)
  const goToStart = useTimelineStore(state => state.goToStart)
  const goToEnd = useTimelineStore(state => state.goToEnd)

  return (
    <div className={s.timelinePlayControls}>
      <button type="button" onClick={goToStart} title="Go to start (Home)">
        <StartIcon />
      </button>

      <button
        type="button"
        onClick={playing ? pause : play}
        className={playing ? s.active : ''}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <button type="button" onClick={goToEnd} title="Go to end (End)">
        <EndIcon />
      </button>

      <button
        type="button"
        onClick={toggleLoop}
        className={loop ? s.active : ''}
        title={loop ? 'Loop on' : 'Loop off'}
      >
        <LoopIcon />
      </button>
    </div>
  )
}

function StartIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.2v9.6M4.8 8l7 4.3V3.7L4.8 8z" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.7 3.5v9l7.2-4.5-7.2-4.5z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.6 3.4h2.8v9.2H4.6zM8.8 3.4h2.8v9.2H8.8z" />
    </svg>
  )
}

function EndIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.2 3.2v9.6M4.2 3.7v8.6L11.2 8 4.2 3.7z" />
    </svg>
  )
}

function LoopIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.2 4.8H5.8a2.8 2.8 0 0 0 0 5.6h1.7M3.9 8.6l-1.6 1.8 1.6 1.7M3.8 11.2h6.4a2.8 2.8 0 0 0 0-5.6H8.5M12.1 7.4l1.6-1.8-1.6-1.7" />
    </svg>
  )
}
