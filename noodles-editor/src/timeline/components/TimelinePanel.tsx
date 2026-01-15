// Main Timeline Panel container component
// Provides the overall layout and state management for the timeline UI

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTimelineStore } from '../timeline-store'
import { PlayControls } from './PlayControls'
import { Playhead } from './Playhead'
import { TimeDisplay } from './TimeDisplay'
import { TimeRuler } from './TimeRuler'
import { TrackList } from './TrackList'
import './TimelinePanel.css'

// Zoom levels in pixels per second
const MIN_PIXELS_PER_SECOND = 10
const MAX_PIXELS_PER_SECOND = 500
const DEFAULT_PIXELS_PER_SECOND = 100

export interface TimelinePanelProps {
  height?: number
  onCollapse?: () => void
}

export function TimelinePanel({ height = 300, onCollapse }: TimelinePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const timelineAreaRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Local UI state
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)

  // Timeline store state
  const sequence = useTimelineStore(state => state.sequence)
  const position = useTimelineStore(state => state.position)
  const setPosition = useTimelineStore(state => state.setPosition)

  // Calculate timeline width based on sequence length and zoom
  const timelineWidth = sequence.length * pixelsPerSecond

  // Convert time to pixels
  const _timeToPixels = useCallback((time: number) => time * pixelsPerSecond, [pixelsPerSecond])

  // Convert pixels to time
  const pixelsToTime = useCallback((pixels: number) => pixels / pixelsPerSecond, [pixelsPerSecond])

  // Handle zoom with mouse wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setPixelsPerSecond(prev =>
        Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, prev * delta))
      )
    }
  }, [])

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft)
  }, [])

  // Calculate time from mouse event
  const getTimeFromMouseEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!timelineAreaRef.current) return null
      const rect = timelineAreaRef.current.getBoundingClientRect()
      const currentScrollLeft = scrollAreaRef.current?.scrollLeft ?? 0
      const x = e.clientX - rect.left + currentScrollLeft
      return Math.max(0, Math.min(pixelsToTime(x), sequence.length))
    },
    [pixelsToTime, sequence.length]
  )

  // Handle mousedown on timeline area to start scrubbing
  const handleTimelineMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) return

      const time = getTimeFromMouseEvent(e)
      if (time !== null) {
        setPosition(time)
        setIsScrubbing(true)
      }
    },
    [getTimeFromMouseEvent, setPosition]
  )

  // Handle mousemove while scrubbing (attached to document)
  useEffect(() => {
    if (!isScrubbing) return

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromMouseEvent(e)
      if (time !== null) {
        setPosition(time)
      }
    }

    const handleMouseUp = () => {
      setIsScrubbing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isScrubbing, getTimeFromMouseEvent, setPosition])

  return (
    <div ref={containerRef} className="timeline-panel" style={{ height }} onWheel={handleWheel}>
      {/* Header with controls */}
      <div className="timeline-header">
        {onCollapse && (
          <button
            type="button"
            className="timeline-collapse-btn"
            onClick={onCollapse}
            title="Collapse Timeline"
          >
            <ChevronDownIcon />
          </button>
        )}
        <PlayControls />
        <TimeDisplay />
        <div className="timeline-zoom">
          <button
            type="button"
            className="timeline-zoom-btn"
            onClick={() => setPixelsPerSecond(prev => Math.max(MIN_PIXELS_PER_SECOND, prev * 0.8))}
            title="Zoom out"
          >
            <span className="timeline-zoom-btn-text">&minus;</span>
          </button>
          <ZoomIcon />
          <button
            type="button"
            className="timeline-zoom-btn"
            onClick={() => setPixelsPerSecond(prev => Math.min(MAX_PIXELS_PER_SECOND, prev * 1.25))}
            title="Zoom in"
          >
            <span className="timeline-zoom-btn-text">+</span>
          </button>
        </div>
      </div>

      {/* Main timeline area */}
      <div className="timeline-body">
        {/* Track labels column */}
        <div className="timeline-track-labels">
          <div className="timeline-track-labels-header" />
          <TrackList showLabelsOnly />
        </div>

        {/* Scrollable timeline area */}
        <div ref={scrollAreaRef} className="timeline-scroll-area" onScroll={handleScroll}>
          {/* Time ruler */}
          <TimeRuler
            width={timelineWidth}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
          />

          {/* Keyframe area */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Timeline area uses mousedown for scrubbing playhead */}
          <div
            ref={timelineAreaRef}
            className={`timeline-keyframe-area ${isScrubbing ? 'scrubbing' : ''}`}
            style={{ width: timelineWidth }}
            onMouseDown={handleTimelineMouseDown}
          >
            <TrackList pixelsPerSecond={pixelsPerSecond} timelineWidth={timelineWidth} />

            {/* Playhead */}
            <Playhead position={position} pixelsPerSecond={pixelsPerSecond} height={height - 80} />
          </div>
        </div>
      </div>
    </div>
  )
}

// Icon components
function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4L6 7L9 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ZoomIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="timeline-zoom-icon"
    >
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
