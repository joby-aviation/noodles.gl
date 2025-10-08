import { useCallback, useEffect, useRef, useState } from 'react'

type DragState = {
  startX: number
  startY: number
  startValue: number
  totalDistanceMoved: number
  detected: boolean
}

type UseDragOptions = {
  disabled?: boolean
  onDragStart?: (e: React.MouseEvent | React.TouchEvent) => boolean
  onDrag?: (deltaX: number, deltaY: number, e: MouseEvent | TouchEvent) => void
  onDragEnd?: (e: MouseEvent | TouchEvent | null) => void
}

export default function useDrag(options: UseDragOptions) {
  const { disabled, onDragStart, onDrag, onDragEnd } = options
  const [isDragging, setIsDragging] = useState(false)
  const dragStateRef = useRef<DragState | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return
      if (onDragStart && !onDragStart(e)) return

      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startValue: 0,
        totalDistanceMoved: 0,
        detected: false,
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragStateRef.current) return

        const { startX, startY, detected } = dragStateRef.current
        const deltaX = e.clientX - startX
        const deltaY = startY - e.clientY // Invert Y axis so up is positive

        if (!detected) {
          dragStateRef.current.totalDistanceMoved += Math.abs(deltaX) + Math.abs(deltaY)
          if (dragStateRef.current.totalDistanceMoved > 5) {
            // Drag detection threshold
            dragStateRef.current.detected = true
            setIsDragging(true)
          }
        }

        if (dragStateRef.current.detected && onDrag) {
          onDrag(deltaX, deltaY, e)
        }
      }

      const handleMouseUp = (e: MouseEvent) => {
        if (dragStateRef.current?.detected) {
          setIsDragging(false)
          onDragEnd?.(e)
        }
        dragStateRef.current = null
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [disabled, onDragStart, onDrag, onDragEnd]
  )

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return
      if (onDragStart && !onDragStart(e)) return

      dragStateRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startValue: 0,
        totalDistanceMoved: 0,
        detected: false,
      }

      const handleTouchMove = (e: TouchEvent) => {
        if (!dragStateRef.current) return

        const { startX, startY, detected } = dragStateRef.current
        const deltaX = e.touches[0].clientX - startX
        const deltaY = startY - e.touches[0].clientY

        if (!detected) {
          dragStateRef.current.totalDistanceMoved += Math.abs(deltaX) + Math.abs(deltaY)
          if (dragStateRef.current.totalDistanceMoved > 5) {
            dragStateRef.current.detected = true
            setIsDragging(true)
          }
        }

        if (dragStateRef.current.detected && onDrag) {
          onDrag(deltaX, deltaY, e)
        }
      }

      const handleTouchEnd = (e: TouchEvent) => {
        if (dragStateRef.current?.detected) {
          setIsDragging(false)
          onDragEnd?.(e)
        }
        dragStateRef.current = null
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleTouchEnd)
      }

      document.addEventListener('touchmove', handleTouchMove)
      document.addEventListener('touchend', handleTouchEnd)
    },
    [disabled, onDragStart, onDrag, onDragEnd]
  )

  return {
    isDragging,
    handleMouseDown,
    handleTouchStart,
  }
}
