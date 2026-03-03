// Keyframe track component - renders a single track with its keyframes

import { useCallback, useRef, useState } from 'react'
import {
  captureTimelineState,
  fireTimelineMutation,
  getTimelineStore,
  useTimelineStore,
} from '../timeline-store'
import type { Keyframe, Track } from '../types'
import { CurvePopup } from './CurvePopup'
import { KeyframeValuePopup } from './KeyframeValuePopup'
import s from './TimelinePanel.module.css'

export interface KeyframeTrackProps {
  track: Track
  showLabelOnly?: boolean
  pixelsPerSecond?: number
  timelineWidth?: number
  sequenceLength?: number
  fps?: number
  opId?: string
  isFirstInGroup?: boolean
}

function snapToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps
}

// Extract display name from field path
// "maplibre-basemap / viewState / zoom" -> "zoom"
function getDisplayName(fieldPath: string): string {
  const parts = fieldPath.split(' / ')
  return parts[parts.length - 1]
}

export function KeyframeTrack({
  track,
  showLabelOnly = false,
  pixelsPerSecond = 100,
  timelineWidth = 1000,
  sequenceLength = 10,
  fps = 30,
  opId,
  isFirstInGroup,
}: KeyframeTrackProps) {
  const selectedKeyframeIds = useTimelineStore(state => state.selectedKeyframeIds)
  const selectedTrackIds = useTimelineStore(state => state.selectedTrackIds)
  const selectKeyframe = useTimelineStore(state => state.selectKeyframe)
  const selectTrack = useTimelineStore(state => state.selectTrack)
  const toggleTrackKeyframes = useTimelineStore(state => state.toggleTrackKeyframes)
  const addKeyframe = useTimelineStore(state => state.addKeyframe)

  const [openPopup, setOpenPopup] = useState<{
    k1: Keyframe
    k2: Keyframe
    x: number
    y: number
    applyToSelected: boolean
  } | null>(null)

  const [openValuePopup, setOpenValuePopup] = useState<{
    keyframe: Keyframe
    x: number
    y: number
  } | null>(null)

  const displayName = getDisplayName(track.fieldPath)

  // Handle double-click to add keyframe
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (showLabelOnly) return

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const time = snapToFrame(x / pixelsPerSecond, fps)

      const currentValue = track.defaultValue

      addKeyframe(track.id, {
        position: time,
        value: currentValue,
        interpolation: 'bezier',
      })
    },
    [track.id, track.defaultValue, pixelsPerSecond, fps, addKeyframe, showLabelOnly]
  )

  // Handle bar segment popup open (called by KeyframeBar after confirming no drag)
  const handleBarClick = useCallback(
    (k1: Keyframe, k2: Keyframe, x: number, y: number) => {
      setOpenValuePopup(null)
      // Apply to all selected keyframes when k1 is part of a multi-selection
      const applyToSelected = selectedKeyframeIds.size > 1 && selectedKeyframeIds.has(k1.id)
      setOpenPopup({ k1, k2, x, y, applyToSelected })
    },
    [selectedKeyframeIds]
  )

  const handleOpenValuePopup = useCallback((kf: Keyframe, x: number, y: number) => {
    setOpenPopup(null)
    setOpenValuePopup({ keyframe: kf, x, y })
  }, [])

  // Render label only
  if (showLabelOnly) {
    const isTrackSelected = selectedTrackIds.has(track.id)
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Track label selects track for curve editor; shift-click toggles keyframe selection
      <div
        className={`${s.timelineTrackLabel} ${isTrackSelected ? s.selected : ''}`}
        title={track.fieldPath}
        onClick={e => {
          if (e.shiftKey) {
            toggleTrackKeyframes(track.id)
          } else {
            selectTrack(track.id)
          }
        }}
      >
        {isFirstInGroup ? (
          <>
            <span className={s.timelineTrackOpId}>{opId}</span>
            <span className={s.timelineTrackSep}> - </span>
            <span className={s.timelineTrackName}>{displayName}</span>
          </>
        ) : (
          <>
            <span className={`${s.timelineTrackBranch} ${s.visible}`}>└</span>
            <span className={s.timelineTrackName}>{displayName}</span>
          </>
        )}
      </div>
    )
  }

  // Generate bar segments between consecutive keyframes
  const barSegments = []
  for (let i = 0; i < track.keyframes.length - 1; i++) {
    const startKf = track.keyframes[i]
    const endKf = track.keyframes[i + 1]
    const startX = startKf.position * pixelsPerSecond
    const endX = endKf.position * pixelsPerSecond
    barSegments.push({
      id: `bar-${startKf.id}-${endKf.id}`,
      left: startX,
      width: endX - startX,
      k1: startKf,
      k2: endKf,
    })
  }

  // Render keyframe row
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Timeline track row uses double-click for adding keyframes */}
      <div
        className={s.timelineTrackRow}
        style={{ width: timelineWidth }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Bar segments between keyframes — draggable to move selected kfs; clickable to edit easing */}
        {barSegments.map(bar => (
          <KeyframeBar
            key={bar.id}
            k1={bar.k1}
            k2={bar.k2}
            left={bar.left}
            width={bar.width}
            pixelsPerSecond={pixelsPerSecond}
            sequenceLength={sequenceLength}
            fps={fps}
            selectedKeyframeIds={selectedKeyframeIds}
            onOpenPopup={handleBarClick}
          />
        ))}
        {/* Keyframe diamonds */}
        {track.keyframes.map(keyframe => (
          <KeyframeDiamond
            key={keyframe.id}
            keyframe={keyframe}
            trackId={track.id}
            pixelsPerSecond={pixelsPerSecond}
            sequenceLength={sequenceLength}
            fps={fps}
            isSelected={selectedKeyframeIds.has(keyframe.id)}
            selectedKeyframeIds={selectedKeyframeIds}
            onSelect={selectKeyframe}
            onOpenValuePopup={handleOpenValuePopup}
          />
        ))}
      </div>
      {openPopup && (
        <CurvePopup
          trackId={track.id}
          k1={openPopup.k1}
          k2={openPopup.k2}
          anchorX={openPopup.x}
          anchorY={openPopup.y}
          applyToSelected={openPopup.applyToSelected}
          onClose={() => setOpenPopup(null)}
        />
      )}
      {openValuePopup && (
        <KeyframeValuePopup
          trackId={track.id}
          keyframe={openValuePopup.keyframe}
          anchorX={openValuePopup.x}
          anchorY={openValuePopup.y}
          onClose={() => setOpenValuePopup(null)}
        />
      )}
    </>
  )
}

// Bar segment between two keyframes — drag moves all selected keyframes; click opens curve popup
interface KeyframeBarProps {
  k1: Keyframe
  k2: Keyframe
  left: number
  width: number
  pixelsPerSecond: number
  sequenceLength: number
  fps: number
  selectedKeyframeIds: Set<string>
  onOpenPopup: (k1: Keyframe, k2: Keyframe, x: number, y: number) => void
}

function KeyframeBar({
  k1,
  k2,
  left,
  width,
  pixelsPerSecond,
  sequenceLength,
  fps,
  selectedKeyframeIds,
  onOpenPopup,
}: KeyframeBarProps) {
  const isDraggingRef = useRef(false)
  const beforeStateRef = useRef('')

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      // Always reset so click handler sees fresh state
      isDraggingRef.current = false

      // No selected keyframes — let click fall through to the popup
      if (selectedKeyframeIds.size === 0) return

      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)

      const startX = e.clientX
      beforeStateRef.current = captureTimelineState()

      const store = getTimelineStore()
      const startPositions = new Map<string, number>()
      for (const [, track] of store.tracks) {
        for (const kf of track.keyframes) {
          if (selectedKeyframeIds.has(kf.id)) {
            startPositions.set(kf.id, kf.position)
          }
        }
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX
        if (Math.abs(deltaX) < 2 && !isDraggingRef.current) return
        isDraggingRef.current = true

        // Snap the delta to the nearest frame multiple so all selected keyframes
        // stay on frame boundaries after the move.
        const snappedDelta = snapToFrame(deltaX / pixelsPerSecond, fps)
        for (const [tid, track] of store.tracks) {
          for (const kf of track.keyframes) {
            if (startPositions.has(kf.id)) {
              const origPos = startPositions.get(kf.id) ?? kf.position
              store.updateKeyframe(tid, kf.id, {
                position: Math.max(0, Math.min(sequenceLength, origPos + snappedDelta)),
              })
            }
          }
        }
      }

      const handlePointerUp = () => {
        if (isDraggingRef.current) {
          fireTimelineMutation('Move keyframes', beforeStateRef.current)
        }
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [pixelsPerSecond, sequenceLength, fps, selectedKeyframeIds]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDraggingRef.current) return
      e.stopPropagation()
      onOpenPopup(k1, k2, e.clientX, e.clientY)
    },
    [k1, k2, onOpenPopup]
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Bar is a drag handle for selected keyframes and click target for curve popup
    <div
      className={s.timelineKeyframeBar}
      style={{ left, width }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    />
  )
}

// Keyframe diamond with drag support
interface KeyframeDiamondProps {
  keyframe: Keyframe
  trackId: string
  pixelsPerSecond: number
  sequenceLength: number
  fps: number
  isSelected: boolean
  selectedKeyframeIds: Set<string>
  onSelect: (keyframeId: string, addToSelection?: boolean) => void
  onOpenValuePopup?: (keyframe: Keyframe, x: number, y: number) => void
}

function KeyframeDiamond({
  keyframe,
  _trackId,
  pixelsPerSecond,
  sequenceLength,
  fps,
  isSelected,
  selectedKeyframeIds,
  onSelect,
  onOpenValuePopup,
}: KeyframeDiamondProps) {
  const x = keyframe.position * pixelsPerSecond
  const isDraggingRef = useRef(false)
  const beforeStateRef = useRef<string>('')

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation() // prevent timeline scrubbing
      e.preventDefault()

      // Select this keyframe (add to selection if shift/meta/ctrl held)
      const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey
      if (!isSelected || addToSelection) {
        onSelect(keyframe.id, addToSelection)
      }

      const startX = e.clientX
      const startPosition = keyframe.position
      isDraggingRef.current = false
      beforeStateRef.current = captureTimelineState()

      // Capture pointer to track drag outside element
      e.currentTarget.setPointerCapture(e.pointerId)

      // Snapshot starting positions of all selected keyframes at drag start
      const store = getTimelineStore()
      const idsToMove = selectedKeyframeIds.has(keyframe.id)
        ? selectedKeyframeIds
        : new Set([keyframe.id])
      const startPositions = new Map<string, number>()
      for (const [, track] of store.tracks) {
        for (const kf of track.keyframes) {
          if (idsToMove.has(kf.id)) {
            startPositions.set(kf.id, kf.position)
          }
        }
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX
        if (Math.abs(deltaX) < 2 && !isDraggingRef.current) return
        isDraggingRef.current = true

        const deltaTime = deltaX / pixelsPerSecond
        // Snap the lead keyframe to the nearest frame, then apply the same delta
        // to all selected keyframes so their relative positions are preserved.
        const snappedPos = snapToFrame(
          Math.max(0, Math.min(sequenceLength, startPosition + deltaTime)),
          fps
        )
        const actualDelta = snappedPos - startPosition

        for (const [tid, track] of store.tracks) {
          for (const kf of track.keyframes) {
            if (startPositions.has(kf.id)) {
              const origPos = startPositions.get(kf.id) ?? kf.position
              store.updateKeyframe(tid, kf.id, {
                position: Math.max(0, Math.min(sequenceLength, origPos + actualDelta)),
              })
            }
          }
        }
      }

      const handlePointerUp = () => {
        if (isDraggingRef.current) {
          // Fire one history entry for the whole drag gesture
          fireTimelineMutation('Move keyframe', beforeStateRef.current)
          // Note: isDraggingRef stays true so handleClick can skip popup/reselect.
          // It gets reset to false at the start of the next handlePointerDown.
        }
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [
      keyframe.id,
      keyframe.position,
      isSelected,
      onSelect,
      pixelsPerSecond,
      sequenceLength,
      fps,
      selectedKeyframeIds,
    ]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // If drag happened, don't toggle selection on click
      if (isDraggingRef.current) return
      e.stopPropagation()
      const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey
      onSelect(keyframe.id, addToSelection)
      // Open value editor on plain click (not modifier-augmented multi-select)
      if (!addToSelection && onOpenValuePopup) {
        const rect = e.currentTarget.getBoundingClientRect()
        onOpenValuePopup(keyframe, rect.left + rect.width / 2, rect.top)
      }
    },
    [keyframe, onSelect, onOpenValuePopup]
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Keyframe diamond is a drag handle
    <div
      className={`${s.timelineKeyframe} ${isSelected ? s.selected : ''}`}
      style={{ left: x }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      title={`${keyframe.position.toFixed(2)}s`}
    />
  )
}
