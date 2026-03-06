// Time marker component with port for connecting to keyframes

import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import type { TimeMarker as TimeMarkerType } from '../types'
import s from './TimelinePanel.module.css'

export interface TimeMarkerProps {
  marker: TimeMarkerType
  pixelsPerSecond: number
  fps: number
  isSelected: boolean
  onSelect: (markerId: string) => void
  onMove: (markerId: string, newPosition: number) => void
  onStartConnection: (markerId: string, clientX: number, clientY: number) => void
  onMoveStart?: () => void
  onMoveEnd?: () => void
}

function snapToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps
}

export function TimeMarker({
  marker,
  pixelsPerSecond,
  fps,
  isSelected,
  onSelect,
  onMove,
  onStartConnection,
  onMoveStart,
  onMoveEnd,
}: TimeMarkerProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isPortHovered, setIsPortHovered] = useState(false)
  const dragStateRef = useRef<{ startX: number; startPosition: number } | null>(null)

  const x = marker.position * pixelsPerSecond

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()

      onSelect(marker.id)

      // Check if we're clicking on the port
      const target = e.target as HTMLElement
      if (target.closest(`.${s.timeMarkerPort}`)) {
        onStartConnection(marker.id, e.clientX, e.clientY)
        return
      }

      // Start marker drag
      e.currentTarget.setPointerCapture(e.pointerId)
      dragStateRef.current = {
        startX: e.clientX,
        startPosition: marker.position,
      }
      onMoveStart?.()

      const handleMove = (moveEvent: PointerEvent) => {
        if (!dragStateRef.current) return
        const delta = (moveEvent.clientX - dragStateRef.current.startX) / pixelsPerSecond
        const newPosition = snapToFrame(Math.max(0, dragStateRef.current.startPosition + delta), fps)
        onMove(marker.id, newPosition)
      }

      const handleUp = () => {
        dragStateRef.current = null
        onMoveEnd?.()
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [marker.id, marker.position, pixelsPerSecond, fps, onSelect, onMove, onStartConnection, onMoveStart, onMoveEnd]
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Marker supports pointer drag
    <div
      className={`${s.timeMarker} ${isSelected ? s.selected : ''}`}
      style={{ left: x }}
      onPointerDown={handlePointerDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Marker icon - small flag/triangle shape */}
      <svg className={s.timeMarkerIcon} viewBox="0 0 12 10" width="12" height="10" aria-hidden="true">
        <path d="M6 0 L12 3 L12 10 L6 7 L0 10 L0 3 Z" />
      </svg>

      {/* Port - appears on hover */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Port handles pointer drag for connections */}
      <div
        className={s.timeMarkerPort}
        style={{ opacity: isHovered || isSelected ? 1 : 0 }}
        onMouseEnter={() => setIsPortHovered(true)}
        onMouseLeave={() => setIsPortHovered(false)}
      >
        <div className={s.timeMarkerPortOuter} />
        <div
          className={s.timeMarkerPortInner}
          style={{
            width: isPortHovered ? 10 : 4,
            height: isPortHovered ? 10 : 4,
          }}
        />
      </div>
    </div>
  )
}
