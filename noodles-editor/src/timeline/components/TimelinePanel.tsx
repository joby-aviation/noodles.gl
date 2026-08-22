// Main Timeline Panel container component
// Provides the overall layout and state management for the timeline UI

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useExportActions } from '../../noodles/contexts/export-actions-context'
import { shouldBlockKeyboardShortcut } from '../../noodles/utils/input-detection'
import {
  captureTimelineState,
  fireTimelineMutation,
  getTimelineStore,
  useTimelineStore,
} from '../timeline-store'
import type { HandleType } from '../types'
import { DEFAULT_BEZIER_HANDLES } from '../types'
import { CurveEditorView } from './CurveEditorView'
import { MarkerConnectionLines } from './MarkerConnectionLines'
import { PlayControls } from './PlayControls'
import { Playhead } from './Playhead'
import { TimeDisplay } from './TimeDisplay'
import s from './TimelinePanel.module.css'
import { getMajorInterval, TimeRuler } from './TimeRuler'
import { TrackList } from './TrackList'

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
  const trackLabelsRef = useRef<HTMLDivElement>(null)

  const { isRendering } = useExportActions()

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
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  // Timeline store state
  const sequence = useTimelineStore(state => state.sequence)
  const position = useTimelineStore(state => state.position)
  const setPosition = useTimelineStore(state => state.setPosition)
  const setLength = useTimelineStore(state => state.setLength)
  const selectedKeyframeIds = useTimelineStore(state => state.selectedKeyframeIds)
  const tracks = useTimelineStore(state => state.tracks)
  const markers = useTimelineStore(state => state.markers)
  const selectedMarkerId = useTimelineStore(state => state.selectedMarkerId)
  const connectingFromMarkerId = useTimelineStore(state => state.connectingFromMarkerId)
  const setConnectingFromMarker = useTimelineStore(state => state.setConnectingFromMarker)
  const connectKeyframeToMarker = useTimelineStore(state => state.connectKeyframeToMarker)
  const deleteMarker = useTimelineStore(state => state.deleteMarker)

  // Connection drag state
  const [connectionMousePos, setConnectionMousePos] = useState<{ x: number; y: number } | null>(
    null
  )

  // Track order for connection lines (same as TrackList ordering)
  const trackOrder = useMemo(() => {
    return Array.from(tracks.values())
      .filter(t => t.keyframes.length > 0)
      .sort((a, b) => a.fieldPath.localeCompare(b.fieldPath))
      .map(t => t.id)
  }, [tracks])

  // Calculate timeline width based on sequence length and zoom
  const timelineWidth = sequence.length * pixelsPerSecond
  const majorInterval = getMajorInterval(pixelsPerSecond)

  // Convert time to pixels
  const _timeToPixels = useCallback((time: number) => time * pixelsPerSecond, [pixelsPerSecond])

  // Convert pixels to time
  const pixelsToTime = useCallback((pixels: number) => pixels / pixelsPerSecond, [pixelsPerSecond])

  // Zoom while keeping the playhead at the same screen position
  const zoomAroundPlayhead = useCallback(
    (newPixelsPerSecond: number) => {
      if (!scrollAreaRef.current) return

      const clampedZoom = Math.max(
        MIN_PIXELS_PER_SECOND,
        Math.min(MAX_PIXELS_PER_SECOND, newPixelsPerSecond)
      )

      // Calculate playhead pixel position before and after zoom
      const playheadPxBefore = position * pixelsPerSecond
      const playheadPxAfter = position * clampedZoom

      // Adjust scroll to keep playhead at same screen position
      const scrollDelta = playheadPxAfter - playheadPxBefore
      scrollAreaRef.current.scrollLeft = Math.max(0, scrollAreaRef.current.scrollLeft + scrollDelta)

      setPixelsPerSecond(clampedZoom)
    },
    [position, pixelsPerSecond]
  )

  // Handle zoom with mouse wheel (Ctrl/Cmd/Shift + scroll)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? 0.9 : 1.1
        zoomAroundPlayhead(pixelsPerSecond * delta)
      }
    },
    [pixelsPerSecond, zoomAroundPlayhead]
  )

  // Handle scroll on the right (keyframe) panel — keep the left labels panel in sync
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft)
    const scrollTop = e.currentTarget.scrollTop
    if (trackLabelsRef.current && trackLabelsRef.current.scrollTop !== scrollTop) {
      trackLabelsRef.current.scrollTop = scrollTop
    }
  }, [])

  // Handle scroll on the left (labels) panel — keep the right keyframe panel in sync
  const handleLabelsScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop
    if (scrollAreaRef.current && scrollAreaRef.current.scrollTop !== scrollTop) {
      scrollAreaRef.current.scrollTop = scrollTop
    }
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
      if (isRendering) return

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
      const store = getTimelineStore()
      store.clearSelection()
      const time = getTimeFromMouseEvent(e)
      if (time !== null) {
        setPosition(time)
        setIsScrubbing(true)
      }
    },
    [getTimeFromMouseEvent, setPosition, isRendering]
  )

  // Handle mousemove while scrubbing (attached to document)
  useEffect(() => {
    if (!isScrubbing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isRendering) return
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
  }, [isScrubbing, getTimeFromMouseEvent, setPosition, isRendering])

  // Handle marker connection start — attach document listeners synchronously so fast
  // drags (pointerdown → pointerup without much movement) aren't missed by a deferred effect.
  const handleStartMarkerConnection = useCallback(
    (markerId: string, clientX: number, clientY: number) => {
      setConnectingFromMarker(markerId)

      // Set the initial line position immediately from the pointerdown coords.
      const rect = timelineAreaRef.current?.getBoundingClientRect()
      const sl = scrollAreaRef.current?.scrollLeft ?? 0
      if (rect) {
        setConnectionMousePos({
          x: clientX - rect.left + sl,
          y: clientY - rect.top,
        })
      }

      const handlePointerMove = (e: PointerEvent) => {
        const r = timelineAreaRef.current?.getBoundingClientRect()
        if (!r) return
        const scrollLeft = scrollAreaRef.current?.scrollLeft ?? 0
        setConnectionMousePos({
          x: e.clientX - r.left + scrollLeft,
          y: e.clientY - r.top,
        })
      }

      const handlePointerUp = () => {
        setConnectingFromMarker(null)
        setConnectionMousePos(null)
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [setConnectingFromMarker]
  )

  // Handle keyframe drop for marker connection
  const handleKeyframeConnectionDrop = useCallback(
    (trackId: string, keyframeId: string) => {
      if (!connectingFromMarkerId) return
      const before = captureTimelineState()
      connectKeyframeToMarker(connectingFromMarkerId, trackId, keyframeId)
      fireTimelineMutation('Connect keyframe to marker', before)
      setConnectingFromMarker(null)
      setConnectionMousePos(null)
    },
    [connectingFromMarkerId, connectKeyframeToMarker, setConnectingFromMarker]
  )

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

  // Intercept Delete/Backspace in capture phase so keyframe/marker deletion fires before
  // ReactFlow's global handler (which would otherwise delete the selected operator node)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return

      if (selectedMarkerId) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const before = captureTimelineState()
        deleteMarker(selectedMarkerId)
        fireTimelineMutation('Delete marker', before)
        return
      }
      const store = getTimelineStore()
      if (store.selectedKeyframeIds.size > 0) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const before = captureTimelineState()
        store.deleteSelectedKeyframes()
        fireTimelineMutation('Delete keyframe', before)
      }
    }
    document.addEventListener('keydown', handleKey, { capture: true })
    return () => document.removeEventListener('keydown', handleKey, { capture: true })
  }, [selectedMarkerId, deleteMarker])

  // T to cycle handle type, Cmd/Ctrl+A to select all keyframes
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd/Ctrl+A to select all keyframes
      if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const store = getTimelineStore()
        store.selectAllKeyframes()
      }

      // Cmd/Ctrl+C to copy selected keyframes
      if ((e.key === 'c' || e.key === 'C') && (e.metaKey || e.ctrlKey) && selectedKeyframeIds.size > 0) {
        e.preventDefault()
        getTimelineStore().copySelectedKeyframes()
      }

      // Cmd/Ctrl+V to paste keyframes
      if ((e.key === 'v' || e.key === 'V') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        getTimelineStore().pasteKeyframes()
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

  // Handle spacebar for play/pause and arrow keys for frame stepping globally
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (shouldBlockKeyboardShortcut(e)) return

      const store = getTimelineStore()
      if (e.code === 'Space') {
        e.preventDefault()
        if (!isRendering) store.togglePlay()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        if (!isRendering) store.stepBackward(1)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        if (!isRendering) store.stepForward(1)
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isRendering])

  return (
    <div
      ref={containerRef}
      className={s.timelinePanel}
      style={{ height }}
      role="application"
      aria-label="Timeline panel"
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
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
          onClick={() => setViewMode(v => (v === 'keyframes' ? 'value' : 'keyframes'))}
          title={viewMode === 'keyframes' ? 'Switch to curve editor' : 'Switch to keyframe view'}
        >
          <CurveViewIcon />
        </button>
        {viewMode !== 'keyframes' && (
          <button
            type="button"
            className={`${s.timelineViewModeBtn} ${s.active}`}
            onClick={() => setViewMode(v => (v === 'value' ? 'speed' : 'value'))}
            title={viewMode === 'value' ? 'Switch to speed graph' : 'Switch to value graph'}
          >
            {viewMode === 'value' ? 'Value' : 'Speed'}
          </button>
        )}
        <div className={s.timelineZoom}>
          <button
            type="button"
            className={s.timelineZoomBtn}
            onClick={() => zoomAroundPlayhead(pixelsPerSecond * 0.8)}
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
            onChange={e => zoomAroundPlayhead(Math.exp(Number(e.target.value)))}
            title={`Zoom: ${Math.round(pixelsPerSecond)} px/s`}
          />
          <button
            type="button"
            className={s.timelineZoomBtn}
            onClick={() => zoomAroundPlayhead(pixelsPerSecond * 1.25)}
            title="Zoom in"
          >
            <span className={s.timelineZoomBtnText}>+</span>
          </button>
        </div>
      </div>

      {/* Main timeline area */}
      <div className={s.timelineBody}>
        {/* Track labels column */}
        <div ref={trackLabelsRef} className={s.timelineTrackLabels} onScroll={handleLabelsScroll}>
          <div className={s.timelineTrackLabelsHeader}>
            <span className={s.timelineTrackLabelsTitle}>Properties</span>
          </div>
          <TrackList
            showLabelsOnly
            onOpenCurveEditor={trackId => {
              const store = getTimelineStore()
              store.selectTrack(trackId)
              setViewMode('value')
            }}
          />
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
            onStartMarkerConnection={handleStartMarkerConnection}
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
              <TrackList
                pixelsPerSecond={pixelsPerSecond}
                timelineWidth={timelineWidth}
                sequenceLength={sequence.length}
                fps={sequence.fps}
                connectingFromMarkerId={connectingFromMarkerId}
                onKeyframeConnectionDrop={handleKeyframeConnectionDrop}
              />
              <Playhead
                position={position}
                pixelsPerSecond={pixelsPerSecond}
                height={height - 80}
              />
              {/* Marker connection lines */}
              <MarkerConnectionLines
                markers={markers}
                tracks={tracks}
                selectedKeyframeIds={selectedKeyframeIds}
                pixelsPerSecond={pixelsPerSecond}
                trackHeight={TRACK_ROW_HEIGHT}
                trackOrder={trackOrder}
                connectingFromMarkerId={connectingFromMarkerId}
                mousePosition={connectionMousePos}
              />
              {boxSelectOverlay && <div className={s.timelineBoxSelect} style={boxSelectOverlay} />}
              {/* Dim regions outside in/out range */}
              {sequence.inPoint > 0 && (
                <div
                  className={s.timelineDimOverlay}
                  style={{
                    left: 0,
                    width: `${sequence.inPoint * pixelsPerSecond}px`,
                  }}
                />
              )}
              {sequence.outPoint < sequence.length && (
                <div
                  className={s.timelineDimOverlay}
                  style={{
                    left: `${sequence.outPoint * pixelsPerSecond}px`,
                    width: `${(sequence.length - sequence.outPoint) * pixelsPerSecond}px`,
                  }}
                />
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
      <path
        d="M1 4V1H4M8 1H11V4M11 8V11H8M4 11H1V8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CurveViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M1 11 C3 11 4 3 7 3 C10 3 11 9 13 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="3.5" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10.5" cy="6" r="1.5" fill="currentColor" />
    </svg>
  )
}
