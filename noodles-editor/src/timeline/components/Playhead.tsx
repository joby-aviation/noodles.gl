// Playhead component - draggable position indicator

import { useCallback, useRef, useState } from 'react'
import { useTimelineStore } from '../timeline-store'
import s from './TimelinePanel.module.css'

export interface PlayheadProps {
  position: number
  pixelsPerSecond: number
  height: number
}

export function Playhead({ position, pixelsPerSecond, height }: PlayheadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ startX: number; startPosition: number } | null>(null)

  const sequence = useTimelineStore(state => state.sequence)
  const setPosition = useTimelineStore(state => state.setPosition)

  const x = position * pixelsPerSecond

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      setIsDragging(true)
      dragStartRef.current = {
        startX: e.clientX,
        startPosition: position,
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return

        const deltaX = moveEvent.clientX - dragStartRef.current.startX
        const deltaTime = deltaX / pixelsPerSecond
        const newPosition = Math.max(
          0,
          Math.min(dragStartRef.current.startPosition + deltaTime, sequence.length)
        )
        setPosition(newPosition)
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        dragStartRef.current = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [position, pixelsPerSecond, sequence.length, setPosition]
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
