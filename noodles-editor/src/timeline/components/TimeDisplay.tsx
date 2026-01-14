// Time display component - shows current position / total duration

import { useTimelineStore } from '../timeline-store'

// Format time as MM:SS:FF (minutes:seconds:frames)
function formatTimeCode(seconds: number, fps: number): string {
  const totalFrames = Math.floor(seconds * fps)
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const frames = totalFrames % fps

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`
}

export function TimeDisplay() {
  const position = useTimelineStore(state => state.position)
  const sequence = useTimelineStore(state => state.sequence)

  const currentTime = formatTimeCode(position, sequence.fps)
  const totalTime = formatTimeCode(sequence.length, sequence.fps)

  return (
    <div className="timeline-time-display">
      <span>{currentTime}</span>
      <span className="timeline-time-display-separator">/</span>
      <span style={{ opacity: 0.6 }}>{totalTime}</span>
    </div>
  )
}
