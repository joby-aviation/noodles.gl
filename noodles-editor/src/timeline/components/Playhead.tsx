// Playhead component - draggable position indicator

import { useCallback } from 'react'
import { useTimelineStore } from '../timeline-store'
import { useScrubDrag } from '../use-scrub-drag'
import s from './TimelinePanel.module.css'

export interface PlayheadProps {
  position: number
  pixelsPerSecond: number
  height: number
}

export function Playhead({ position, pixelsPerSecond, height }: PlayheadProps) {
  const isDragging = useTimelineStore(state => state.scrubSource === 'playhead')
  const sequence = useTimelineStore(state => state.sequence)
  const setPosition = useTimelineStore(state => state.setPosition)
  const startScrub = useScrubDrag('playhead')

  const x = position * pixelsPerSecond

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const startX = e.clientX
      const startPosition = position

      startScrub(moveEvent => {
        const deltaTime = (moveEvent.clientX - startX) / pixelsPerSecond
        setPosition(Math.max(0, Math.min(startPosition + deltaTime, sequence.length)))
      })
    },
    [position, pixelsPerSecond, sequence.length, setPosition, startScrub]
  )

  return (
    <div
      className={s.timelinePlayhead}
      style={{
        left: x,
        height,
        opacity: isDragging ? 0.8 : 1,
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Playhead handle uses drag interaction */}
      <div className={s.timelinePlayheadHandle} onMouseDown={handleMouseDown} />
    </div>
  )
}
