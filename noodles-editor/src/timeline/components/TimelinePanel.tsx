// Main Timeline Panel container component
// Provides the overall layout and state management for the timeline UI

import { useCallback, useEffect, useRef, useState } from 'react'
import { captureTimelineState, fireTimelineMutation, getTimelineStore, useTimelineStore } from '../timeline-store'
import type { HandleType } from '../types'
import { DEFAULT_BEZIER_HANDLES } from '../types'
import { CurveEditorView } from './CurveEditorView'
import { PlayControls } from './PlayControls'
import { Playhead } from './Playhead'
import { TimeDisplay } from './TimeDisplay'
import { getMajorInterval, TimeRuler } from './TimeRuler'
import { TrackList } from './TrackList'
import s from './TimelinePanel.module.css'

type ViewMode = 'keyframes' | 'value' | 'speed'

// Zoom levels in pixels per second
const MIN_PIXELS_PER_SECOND = 10
const MAX_PIXELS_PER_SECOND = 500
const DEFAULT_PIXELS_PER_SECOND = 100

// Log-scale slider bounds for perceptually linear zoom
const LOG_MIN = Math.log(MIN_PIXELS_PER_SECOND)
const LOG_MAX = Math.log(MAX_PIXELS_PER_SECOND)

export interface TimelinePanelProps {
  height?: number
  onCollapse?: () => void
}

// Row height must match .timeline-track-row height in CSS
const TRACK_ROW_HEIGHT = 28

export function TimelinePanel({ height = 300, onCollapse }: TimelinePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const timelineAreaRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Local UI state
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('keyframes')

  // Box selection — use refs to avoid stale closure in the persistent document listener
  const boxSelectActive = useRef(false)
  const boxSelectStartTL = useRef({ x: 0, y: 0 }) // timeline-area-local coords
  const boxSelectCurrentTL = useRef({ x: 0, y: 0 })
  const pixelsPerSecondRef = useRef(pixelsPerSecond)
  pixelsPerSecondRef.current = pixelsPerSecond
  // Overlay rect state is only used for rendering
  const [boxSelectOverlay, setBoxSelectOverlay] = useState<{
    left: number; top: number; width: number; height: number
  } | null>(null)

  // Timeline store state
  const sequence = useTimelineStore(state => state.sequence)
  const position = useTimelineStore(state => state.position)
  const setPosition = useTimelineStore(state => state.setPosition)
  const setLength = useTimelineStore(state => state.setLength)
  const selectedKeyframeIds = useTimelineStore(state => state.selectedKeyframeIds)

  // Calculate timeline width based on sequence length and zoom
  const timelineWidth = sequence.length * pixelsPerSecond
  const majorInterval = getMajorInterval(pixelsPerSecond)

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

  // Calculate time from mouse event, snapped to the nearest frame
  const getTimeFromMouseEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!timelineAreaRef.current) return null
      const rect = timelineAreaRef.current.getBoundingClientRect()
      const currentScrollLeft = scrollAreaRef.current?.scrollLeft ?? 0
      const x = e.clientX - rect.left + currentScrollLeft
      const raw = Math.max(0, Math.min(pixelsToTime(x), sequence.length))
      return Math.round(raw * sequence.fps) / sequence.fps
    },
    [pixelsToTime, sequence.length, sequence.fps]
  )

  // Handle mousedown on timeline area — shift+drag starts box selection, plain drag scrubs
  const handleTimelineMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return

      if (e.shiftKey) {
        const rect = timelineAreaRef.current?.getBoundingClientRect()
        if (!rect) return
        const sl = scrollAreaRef.current?.scrollLeft ?? 0
        const coords = { x: e.clientX - rect.left + sl, y: e.clientY - rect.top }
        boxSelectActive.current = true
        boxSelectStartTL.current = coords
        boxSelectCurrentTL.current = coords
        setBoxSelectOverlay({ left: coords.x, top: coords.y, width: 0, height: 0 })
        return
      }

      // Plain click on blank space — clear selection and scrub
      getTimelineStore().clearSelection()
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

  // Persistent document listeners for box selection — uses refs to avoid stale closures
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!boxSelectActive.current) return
      const rect = timelineAreaRef.current?.getBoundingClientRect()
      if (!rect) return
      const sl = scrollAreaRef.current?.scrollLeft ?? 0
      const x = e.clientX - rect.left + sl
      const y = e.clientY - rect.top
      boxSelectCurrentTL.current = { x, y }
      const sx = boxSelectStartTL.current.x
      const sy = boxSelectStartTL.current.y
      setBoxSelectOverlay({
        left: Math.min(sx, x),
        top: Math.min(sy, y),
        width: Math.abs(x - sx),
        height: Math.abs(y - sy),
      })
    }

    const handleMouseUp = (_e: MouseEvent) => {
      if (!boxSelectActive.current) return
      boxSelectActive.current = false
      const start = boxSelectStartTL.current
      const end = boxSelectCurrentTL.current
      setBoxSelectOverlay(null)

      // Ignore micro-drags (plain shift-clicks with no movement)
      if (Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3) return

      const minX = Math.min(start.x, end.x)
      const maxX = Math.max(start.x, end.x)
      const minY = Math.min(start.y, end.y)
      const maxY = Math.max(start.y, end.y)

      const pps = pixelsPerSecondRef.current
      const store = getTimelineStore()

      // Use the same sort order as TrackList so track Y positions match
      const trackArray = Array.from(store.tracks.values())
        .filter(t => t.keyframes.length > 0)
        .sort((a, b) => a.fieldPath.localeCompare(b.fieldPath))

      const ids: string[] = []
      for (let i = 0; i < trackArray.length; i++) {
        const cy = i * TRACK_ROW_HEIGHT + TRACK_ROW_HEIGHT / 2
        if (cy < minY || cy > maxY) continue
        for (const kf of trackArray[i].keyframes) {
          const kfX = kf.position * pps
          if (kfX >= minX && kfX <= maxX) ids.push(kf.id)
        }
      }

      store.setSelectedKeyframes(ids)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Delete selected keyframes on Delete/Backspace key, T to cycle handle type
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKeyframeIds.size > 0) {
        e.preventDefault()
        getTimelineStore().deleteSelectedKeyframes()
      }

      // Cmd/Ctrl+A to select all keyframes
      if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        getTimelineStore().selectAllKeyframes()
      }

      // T to cycle handle type for selected keyframes
      if ((e.key === 't' || e.key === 'T') && selectedKeyframeIds.size > 0) {
        e.preventDefault()
        const before = captureTimelineState()
        const store = getTimelineStore()
        const handleTypes: HandleType[] = ['aligned', 'uneven', 'free']

        for (const [trackId, track] of store.tracks) {
          for (const kf of track.keyframes) {
            if (selectedKeyframeIds.has(kf.id)) {
              const handles = kf.handles ?? DEFAULT_BEZIER_HANDLES
              const currentIdx = handleTypes.indexOf(handles.type)
              const nextType = handleTypes[(currentIdx + 1) % handleTypes.length]
              store.setKeyframeHandles(trackId, kf.id, { ...handles, type: nextType })
            }
          }
        }
        fireTimelineMutation('Cycle handle type', before)
      }
    },
    [selectedKeyframeIds]
  )

  // Handle spacebar for play/pause globally
  useEffect(() => {
    const handleSpaceKey = (e: KeyboardEvent) => {
      // Only handle spacebar
      if (e.code !== 'Space') return

      // Don't intercept spacebar in input elements
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
        return
      }

      e.preventDefault()
      getTimelineStore().togglePlay()
    }

    document.addEventListener('keydown', handleSpaceKey)
    return () => document.removeEventListener('keydown', handleSpaceKey)
  }, [])

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Timeline panel needs focus to receive keyboard events
    // biome-ignore lint/a11y/noStaticElementInteractions: Timeline panel handles wheel and keyboard shortcuts
    <div ref={containerRef} className={s.timelinePanel} style={{ height }} onWheel={handleWheel} onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Header with controls */}
      <div className={s.timelineHeader}>
        {onCollapse && (
          <button
            type="button"
            className={s.timelineCollapseBtn}
            onClick={onCollapse}
            title="Collapse Timeline"
          >
            <ChevronDownIcon />
          </button>
        )}
        <PlayControls />
        <TimeDisplay />
        {/* Curve view toggle */}
        <button
          type="button"
          className={`${s.timelineViewModeBtn} ${viewMode !== 'keyframes' ? s.active : ''}`}
          onClick={() => setViewMode(v => v === 'keyframes' ? 'value' : 'keyframes')}
          title={viewMode === 'keyframes' ? 'Switch to curve editor' : 'Switch to keyframe view'}
        >
          <CurveViewIcon />
        </button>
        {viewMode !== 'keyframes' && (
          <button
            type="button"
            className={`${s.timelineViewModeBtn} ${s.active}`}
            onClick={() => setViewMode(v => v === 'value' ? 'speed' : 'value')}
            title={viewMode === 'value' ? 'Switch to speed graph' : 'Switch to value graph'}
          >
            {viewMode === 'value' ? 'Value' : 'Speed'}
          </button>
        )}
        <div className={s.timelineZoom}>
          <button
            type="button"
            className={s.timelineZoomBtn}
            onClick={() => setPixelsPerSecond(prev => Math.max(MIN_PIXELS_PER_SECOND, prev * 0.8))}
            title="Zoom out"
          >
            <span className={s.timelineZoomBtnText}>&minus;</span>
          </button>
          <button
            type="button"
            className={`${s.timelineZoomBtn} ${s.timelineFitBtn}`}
            onClick={() => {
              const containerWidth = scrollAreaRef.current?.clientWidth ?? 800
              setPixelsPerSecond(
                Math.max(
                  MIN_PIXELS_PER_SECOND,
                  Math.min(MAX_PIXELS_PER_SECOND, containerWidth / sequence.length)
                )
              )
            }}
            title="Fit timeline to window"
          >
            <FitIcon />
          </button>
          <input
            type="range"
            className={s.timelineZoomSlider}
            min={LOG_MIN}
            max={LOG_MAX}
            step={0.01}
            value={Math.log(pixelsPerSecond)}
            onChange={e => setPixelsPerSecond(Math.exp(Number(e.target.value)))}
            title={`Zoom: ${Math.round(pixelsPerSecond)} px/s`}
          />
          <button
            type="button"
            className={s.timelineZoomBtn}
            onClick={() => setPixelsPerSecond(prev => Math.min(MAX_PIXELS_PER_SECOND, prev * 1.25))}
            title="Zoom in"
          >
            <span className={s.timelineZoomBtnText}>+</span>
          </button>
        </div>
      </div>

      {/* Main timeline area */}
      <div className={s.timelineBody}>
        {/* Track labels column */}
        <div className={s.timelineTrackLabels}>
          <div className={s.timelineTrackLabelsHeader}>
            <span className={s.timelineTrackLabelsTitle}>Properties</span>
          </div>
          <TrackList showLabelsOnly />
        </div>

        {/* Scrollable timeline area */}
        <div ref={scrollAreaRef} className={s.timelineScrollArea} onScroll={handleScroll}>
          {/* Time ruler */}
          <TimeRuler
            width={timelineWidth}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            sequenceLength={sequence.length}
            fps={sequence.fps}
            onSetLength={setLength}
            onSetPosition={setPosition}
          />

          {/* Keyframe area or curve editor view */}
          {viewMode === 'keyframes' ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: Timeline area uses mousedown for scrubbing playhead and box selection
            <div
              ref={timelineAreaRef}
              className={`${s.timelineKeyframeArea} ${isScrubbing ? s.scrubbing : ''} ${boxSelectOverlay ? s.boxSelecting : ''}`}
              style={{
                width: timelineWidth,
                backgroundSize: `${majorInterval * pixelsPerSecond}px 100%, 100% 100%`,
              }}
              onMouseDown={handleTimelineMouseDown}
            >
              <TrackList pixelsPerSecond={pixelsPerSecond} timelineWidth={timelineWidth} sequenceLength={sequence.length} fps={sequence.fps} />
              <Playhead position={position} pixelsPerSecond={pixelsPerSecond} height={height - 80} />
              {boxSelectOverlay && (
                <div className={s.timelineBoxSelect} style={boxSelectOverlay} />
              )}
            </div>
          ) : (
            <CurveEditorView
              pixelsPerSecond={pixelsPerSecond}
              timelineWidth={timelineWidth}
              sequenceLength={sequence.length}
              mode={viewMode}
              height={height - 78}
            />
          )}
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

function FitIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1 4V1H4M8 1H11V4M11 8V11H8M4 11H1V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CurveViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1 11 C3 11 4 3 7 3 C10 3 11 9 13 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="3.5" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10.5" cy="6" r="1.5" fill="currentColor" />
    </svg>
  )
}
