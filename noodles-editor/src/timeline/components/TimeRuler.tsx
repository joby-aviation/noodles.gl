// Time ruler component showing time markers based on zoom level

import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useMemo } from 'react'
import s from './TimelinePanel.module.css'
import { captureTimelineState, fireTimelineMutation } from '../timeline-store'

export interface TimeRulerProps {
  width: number
  pixelsPerSecond: number
  scrollLeft: number
  sequenceLength: number
  fps: number
  onSetLength: (length: number) => void
  onSetPosition: (position: number) => void
}

// Format time as MM:SS.ms or SS.ms depending on duration
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60

  if (mins > 0) {
    const wholeSecs = Math.floor(secs)
    return `${mins}:${wholeSecs.toString().padStart(2, '0')}`
  }
  const rounded = Math.round(seconds)
  if (Math.abs(seconds - rounded) < 0.001) {
    return `${rounded}s`
  }
  return `${secs.toFixed(1)}s`
}

// Minimum pixel spacing before frame-level ticks are rendered
const MIN_FRAME_TICK_PIXELS = 4

// Returns the major tick interval (in seconds) for the given zoom level.
// Exported so TimelinePanel can sync the background grid lines.
export function getMajorInterval(pixelsPerSecond: number): number {
  const targetMajorPixels = 80
  const targetMajorSeconds = targetMajorPixels / pixelsPerSecond
  const niceIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
  let major = niceIntervals[0]
  for (const interval of niceIntervals) {
    if (interval >= targetMajorSeconds) {
      major = interval
      break
    }
    major = interval
  }
  return major
}

// Returns tick info: when frameSpacing >= MIN_FRAME_TICK_PIXELS, use per-frame sub-ticks;
// otherwise fall back to major/4 minor ticks.
function getTickInfo(
  pixelsPerSecond: number,
  fps: number
): { major: number; subInterval: number; isFrameInterval: boolean } {
  const major = getMajorInterval(pixelsPerSecond)
  const isFrameInterval = pixelsPerSecond / fps >= MIN_FRAME_TICK_PIXELS
  const subInterval = isFrameInterval ? 1 / fps : major / 4
  return { major, subInterval, isFrameInterval }
}

function snapToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps
}

export function TimeRuler({
  width,
  pixelsPerSecond,
  scrollLeft: _scrollLeft,
  sequenceLength,
  fps,
  onSetLength,
  onSetPosition,
}: TimeRulerProps) {
  const [editingLength, setEditingLength] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const beforeStateRef = useRef<string>('')
  const dragStateRef = useRef<{ startX: number; startLength: number; before: string } | null>(null)
  const isScrubbingRef = useRef(false)

  const { ticks, labels } = useMemo(() => {
    const { major, subInterval, isFrameInterval } = getTickInfo(pixelsPerSecond, fps)
    const duration = width / pixelsPerSecond

    const tickElements: React.ReactElement[] = []
    const labelElements: React.ReactElement[] = []

    if (isFrameInterval) {
      // Use integer frame indices to avoid floating-point accumulation
      const totalFrames = Math.ceil(duration * fps)
      const framesPerMajor = Math.round(major * fps)
      for (let frame = 0; frame <= totalFrames; frame++) {
        const time = frame / fps
        const x = time * pixelsPerSecond
        const isMajor = frame % framesPerMajor === 0
        tickElements.push(
          <div
            key={`tick-${frame}`}
            className={`${s.timelineRulerTick} ${isMajor ? s.major : s.frame}`}
            style={{ left: x, height: isMajor ? 12 : 4 }}
          />
        )
        if (isMajor) {
          labelElements.push(
            <div key={`label-${frame}`} className={s.timelineRulerLabel} style={{ left: x }}>
              {formatTime(time)}
            </div>
          )
        }
      }
    } else {
      // Fall back to nice-interval minor ticks (major / 4) when frames are too dense
      for (let time = 0; time <= duration; time += subInterval) {
        const x = time * pixelsPerSecond
        const isMajor = Math.abs(time % major) < 0.001 || Math.abs((time % major) - major) < 0.001
        tickElements.push(
          <div
            key={`tick-${time}`}
            className={`${s.timelineRulerTick} ${isMajor ? s.major : ''}`}
            style={{ left: x, height: isMajor ? 12 : 6 }}
          />
        )
        if (isMajor) {
          labelElements.push(
            <div key={`label-${time}`} className={s.timelineRulerLabel} style={{ left: x }}>
              {formatTime(time)}
            </div>
          )
        }
      }
    }

    return { ticks: tickElements, labels: labelElements }
  }, [width, pixelsPerSecond, fps])

  const endX = sequenceLength * pixelsPerSecond

  // End marker drag
  const handleEndMarkerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)

      dragStateRef.current = {
        startX: e.clientX,
        startLength: sequenceLength,
        before: captureTimelineState(),
      }

      const handleMove = (moveEvent: PointerEvent) => {
        if (!dragStateRef.current) return
        const delta = (moveEvent.clientX - dragStateRef.current.startX) / pixelsPerSecond
        const newLength = Math.max(0.1, dragStateRef.current.startLength + delta)
        onSetLength(newLength)
      }

      const handleUp = () => {
        if (dragStateRef.current) {
          fireTimelineMutation('Set sequence length', dragStateRef.current.before)
          dragStateRef.current = null
        }
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [sequenceLength, pixelsPerSecond, onSetLength]
  )

  // End marker double-click to show inline input
  const handleEndMarkerDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setInputValue(sequenceLength.toFixed(2))
      beforeStateRef.current = captureTimelineState()
      setEditingLength(true)
      requestAnimationFrame(() => inputRef.current?.select())
    },
    [sequenceLength]
  )

  const commitLengthEdit = useCallback(() => {
    const parsed = parseFloat(inputValue)
    if (!Number.isNaN(parsed) && parsed > 0) {
      onSetLength(parsed)
      fireTimelineMutation('Set sequence length', beforeStateRef.current)
    }
    setEditingLength(false)
  }, [inputValue, onSetLength])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitLengthEdit()
      else if (e.key === 'Escape') setEditingLength(false)
    },
    [commitLengthEdit]
  )

  const handleRulerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return

      const target = e.target as HTMLElement
      if (target.closest('.timeline-sequence-end-marker')) return
      const rulerElement = e.currentTarget

      const updatePosition = (event: MouseEvent | React.MouseEvent<HTMLDivElement>) => {
        const rect = rulerElement.getBoundingClientRect()
        const x = event.clientX - rect.left
        const rawTime = Math.max(0, Math.min(sequenceLength, x / pixelsPerSecond))
        onSetPosition(snapToFrame(rawTime, fps))
      }

      updatePosition(e)
      isScrubbingRef.current = true

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isScrubbingRef.current) return
        updatePosition(moveEvent)
      }

      const handleMouseUp = () => {
        isScrubbingRef.current = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [onSetPosition, pixelsPerSecond, sequenceLength, fps]
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Timeline ruler supports direct click-to-seek
    <div className={s.timelineRuler} style={{ width }} onMouseDown={handleRulerMouseDown}>
      {ticks}
      {labels}

      {/* End-of-sequence marker */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Marker supports pointer drag and double-click editing */}
      <div
        className={s.timelineSequenceEndMarker}
        style={{ left: endX }}
        onPointerDown={handleEndMarkerPointerDown}
        onDoubleClick={handleEndMarkerDoubleClick}
        title="Drag to set sequence length, double-click to edit"
      >
        <div className={s.timelineSequenceEndLine} />
        <div className={s.timelineSequenceEndHandle} />
        {editingLength && (
          <input
            ref={inputRef}
            className={s.timelineSequenceEndInput}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onBlur={commitLengthEdit}
            onKeyDown={handleInputKeyDown}
            onClick={e => e.stopPropagation()}
            aria-label="Sequence duration in seconds"
          />
        )}
      </div>
    </div>
  )
}
