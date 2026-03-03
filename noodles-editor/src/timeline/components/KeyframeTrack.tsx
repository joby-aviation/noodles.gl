// Keyframe track component - renders a single track with its keyframes

import { useCallback, useRef, useState } from 'react'
import { captureTimelineState, fireTimelineMutation, getTimelineStore, useTimelineStore } from '../timeline-store'
import type { Keyframe, Track } from '../types'
import { CurvePopup } from './CurvePopup'

export interface KeyframeTrackProps {
  track: Track
  showLabelOnly?: boolean
  pixelsPerSecond?: number
  timelineWidth?: number
  sequenceLength?: number
}

// Extract display name from field path
// "maplibre-basemap / viewState / zoom" -> "zoom"
function getDisplayName(fieldPath: string): string {
  const parts = fieldPath.split(' / ')
  return parts[parts.length - 1]
}

// Get parent path for grouping
// "maplibre-basemap / viewState / zoom" -> "maplibre-basemap / viewState"
function getParentPath(fieldPath: string): string {
  const parts = fieldPath.split(' / ')
  return parts.slice(0, -1).join(' / ')
}

export function KeyframeTrack({
  track,
  showLabelOnly = false,
  pixelsPerSecond = 100,
  timelineWidth = 1000,
  sequenceLength = 10,
}: KeyframeTrackProps) {
  const selectedKeyframeIds = useTimelineStore(state => state.selectedKeyframeIds)
  const selectedTrackIds = useTimelineStore(state => state.selectedTrackIds)
  const selectKeyframe = useTimelineStore(state => state.selectKeyframe)
  const selectTrack = useTimelineStore(state => state.selectTrack)
  const addKeyframe = useTimelineStore(state => state.addKeyframe)

  const [openPopup, setOpenPopup] = useState<{
    k1: Keyframe
    k2: Keyframe
    x: number
    y: number
  } | null>(null)

  const displayName = getDisplayName(track.fieldPath)
  const parentPath = getParentPath(track.fieldPath)

  // Handle double-click to add keyframe
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (showLabelOnly) return

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const time = x / pixelsPerSecond

      const currentValue = track.defaultValue

      addKeyframe(track.id, {
        position: time,
        value: currentValue,
        interpolation: 'bezier',
      })
    },
    [track.id, track.defaultValue, pixelsPerSecond, addKeyframe, showLabelOnly]
  )

  // Handle bar segment click to open curve popup
  const handleBarClick = useCallback(
    (e: React.MouseEvent, k1: Keyframe, k2: Keyframe) => {
      e.stopPropagation()
      setOpenPopup({ k1, k2, x: e.clientX, y: e.clientY })
    },
    []
  )

  // Render label only
  if (showLabelOnly) {
    const isTrackSelected = selectedTrackIds.has(track.id)
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Track label selects track for curve editor
      <div
        className={`timeline-track-label ${isTrackSelected ? 'selected' : ''}`}
        title={track.fieldPath}
        onClick={() => selectTrack(track.id)}
      >
        <span className={`timeline-track-branch ${parentPath ? 'visible' : ''}`}>└</span>
        <span className="timeline-track-name">{displayName}</span>
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
        className="timeline-track-row"
        style={{ width: timelineWidth }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Bar segments between keyframes — clickable to edit easing */}
        {barSegments.map(bar => (
          // biome-ignore lint/a11y/noStaticElementInteractions: Bar segment opens curve popup on click
          <div
            key={bar.id}
            className="timeline-keyframe-bar"
            style={{ left: bar.left, width: bar.width }}
            onClick={e => handleBarClick(e, bar.k1, bar.k2)}
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
            isSelected={selectedKeyframeIds.has(keyframe.id)}
            selectedKeyframeIds={selectedKeyframeIds}
            onSelect={selectKeyframe}
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
          onClose={() => setOpenPopup(null)}
        />
      )}
    </>
  )
}

// Keyframe diamond with drag support
interface KeyframeDiamondProps {
  keyframe: Keyframe
  trackId: string
  pixelsPerSecond: number
  sequenceLength: number
  isSelected: boolean
  selectedKeyframeIds: Set<string>
  onSelect: (keyframeId: string, addToSelection?: boolean) => void
}

function KeyframeDiamond({
  keyframe,
  trackId,
  pixelsPerSecond,
  sequenceLength,
  isSelected,
  selectedKeyframeIds,
  onSelect,
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
        const newDraggedPos = Math.max(0, Math.min(sequenceLength, startPosition + deltaTime))
        const actualDelta = newDraggedPos - startPosition

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
        }
        isDraggingRef.current = false
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [keyframe.id, keyframe.position, isSelected, onSelect, pixelsPerSecond, sequenceLength, selectedKeyframeIds]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // If drag happened, don't toggle selection on click
      if (isDraggingRef.current) return
      e.stopPropagation()
      const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey
      onSelect(keyframe.id, addToSelection)
    },
    [keyframe.id, onSelect]
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Keyframe diamond is a drag handle
    <div
      className={`timeline-keyframe ${isSelected ? 'selected' : ''}`}
      style={{ left: x }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      title={`${keyframe.position.toFixed(2)}s`}
    />
  )
}
