// Main Timeline Panel container component
// Provides the overall layout and state management for the timeline UI

import { useCallback, useRef, useState } from 'react'
import { useTimelineStore } from '../timeline-store'
import { PlayControls } from './PlayControls'
import { TimeDisplay } from './TimeDisplay'
import { TimeRuler } from './TimeRuler'
import { Playhead } from './Playhead'
import { TrackList } from './TrackList'
import './TimelinePanel.css'

// Zoom levels in pixels per second
const MIN_PIXELS_PER_SECOND = 10
const MAX_PIXELS_PER_SECOND = 500
const DEFAULT_PIXELS_PER_SECOND = 100

export interface TimelinePanelProps {
  height?: number
}

export function TimelinePanel({ height = 300 }: TimelinePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const timelineAreaRef = useRef<HTMLDivElement>(null)

  // Local UI state
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND)
  const [scrollLeft, setScrollLeft] = useState(0)

  // Timeline store state
  const sequence = useTimelineStore(state => state.sequence)
  const position = useTimelineStore(state => state.position)
  const setPosition = useTimelineStore(state => state.setPosition)

  // Calculate timeline width based on sequence length and zoom
  const timelineWidth = sequence.length * pixelsPerSecond

  // Convert time to pixels
  const timeToPixels = useCallback(
    (time: number) => time * pixelsPerSecond,
    [pixelsPerSecond]
  )

  // Convert pixels to time
  const pixelsToTime = useCallback(
    (pixels: number) => pixels / pixelsPerSecond,
    [pixelsPerSecond]
  )

  // Handle zoom with mouse wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? 0.9 : 1.1
        setPixelsPerSecond(prev =>
          Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, prev * delta))
        )
      }
    },
    []
  )

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft)
  }, [])

  // Handle click on timeline area to set position
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!timelineAreaRef.current) return

      const rect = timelineAreaRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left + scrollLeft
      const time = Math.max(0, Math.min(pixelsToTime(x), sequence.length))
      setPosition(time)
    },
    [pixelsToTime, scrollLeft, sequence.length, setPosition]
  )

  return (
    <div
      ref={containerRef}
      className="timeline-panel"
      style={{ height }}
      onWheel={handleWheel}
    >
      {/* Header with controls */}
      <div className="timeline-header">
        <PlayControls />
        <TimeDisplay />
        <div className="timeline-zoom">
          <button
            onClick={() => setPixelsPerSecond(prev => Math.max(MIN_PIXELS_PER_SECOND, prev * 0.8))}
            title="Zoom out"
          >
            -
          </button>
          <span>{Math.round(pixelsPerSecond)}px/s</span>
          <button
            onClick={() => setPixelsPerSecond(prev => Math.min(MAX_PIXELS_PER_SECOND, prev * 1.25))}
            title="Zoom in"
          >
            +
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
        <div
          className="timeline-scroll-area"
          onScroll={handleScroll}
        >
          {/* Time ruler */}
          <TimeRuler
            width={timelineWidth}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
          />

          {/* Keyframe area */}
          <div
            ref={timelineAreaRef}
            className="timeline-keyframe-area"
            style={{ width: timelineWidth }}
            onClick={handleTimelineClick}
          >
            <TrackList
              pixelsPerSecond={pixelsPerSecond}
              timelineWidth={timelineWidth}
            />

            {/* Playhead */}
            <Playhead
              position={position}
              pixelsPerSecond={pixelsPerSecond}
              height={height - 80}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
