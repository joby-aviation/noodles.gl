// Time display component - shows current position / total duration
// The total duration is clickable to edit the sequence length

import { useCallback, useRef, useState } from 'react'
import { captureTimelineState, fireTimelineMutation, useTimelineStore } from '../timeline-store'

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
  const setLength = useTimelineStore(state => state.setLength)

  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const beforeStateRef = useRef<string>('')

  const currentTime = formatTimeCode(position, sequence.fps)
  const totalTime = formatTimeCode(sequence.length, sequence.fps)

  const startEditing = useCallback(() => {
    setEditing(true)
    setInputValue(sequence.length.toFixed(2))
    beforeStateRef.current = captureTimelineState()
    // Focus the input after render
    requestAnimationFrame(() => inputRef.current?.select())
  }, [sequence.length])

  const commitEdit = useCallback(() => {
    const parsed = parseFloat(inputValue)
    if (!Number.isNaN(parsed) && parsed > 0) {
      setLength(parsed)
      fireTimelineMutation('Set sequence length', beforeStateRef.current)
    }
    setEditing(false)
  }, [inputValue, setLength])

  const cancelEdit = useCallback(() => {
    setEditing(false)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit()
      else if (e.key === 'Escape') cancelEdit()
    },
    [commitEdit, cancelEdit]
  )

  return (
    <div className="timeline-time-display">
      <span>{currentTime}</span>
      <span className="timeline-time-display-separator">/</span>
      {editing ? (
        <input
          ref={inputRef}
          className="timeline-duration-input"
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          aria-label="Sequence duration in seconds"
        />
      ) : (
        // biome-ignore lint/a11y/useButtonType: span used for inline display
        <span
          className="timeline-duration-clickable"
          onClick={startEditing}
          title="Click to edit sequence duration"
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') startEditing() }}
          style={{ opacity: 0.6, cursor: 'text' }}
        >
          {totalTime}
        </span>
      )}
    </div>
  )
}
