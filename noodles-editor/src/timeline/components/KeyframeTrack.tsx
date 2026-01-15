// Keyframe track component - renders a single track with its keyframes

import { useCallback } from 'react'
import { useTimelineStore } from '../timeline-store'
import type { Keyframe, Track } from '../types'

export interface KeyframeTrackProps {
  track: Track
  showLabelOnly?: boolean
  pixelsPerSecond?: number
  timelineWidth?: number
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
}: KeyframeTrackProps) {
  const selectedKeyframeIds = useTimelineStore(state => state.selectedKeyframeIds)
  const selectKeyframe = useTimelineStore(state => state.selectKeyframe)
  const _position = useTimelineStore(state => state.position)
  const addKeyframe = useTimelineStore(state => state.addKeyframe)

  const displayName = getDisplayName(track.fieldPath)
  const parentPath = getParentPath(track.fieldPath)

  // Handle keyframe click
  const handleKeyframeClick = useCallback(
    (e: React.MouseEvent, keyframeId: string) => {
      e.stopPropagation()
      const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey
      selectKeyframe(keyframeId, addToSelection)
    },
    [selectKeyframe]
  )

  // Handle double-click to add keyframe
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (showLabelOnly) return

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const time = x / pixelsPerSecond

      // Get current value from track evaluation or default
      const currentValue = track.defaultValue

      addKeyframe(track.id, {
        position: time,
        value: currentValue,
        interpolation: 'bezier',
      })
    },
    [track.id, track.defaultValue, pixelsPerSecond, addKeyframe, showLabelOnly]
  )

  // Render label only
  if (showLabelOnly) {
    return (
      <div className="timeline-track-label" title={track.fieldPath}>
        <span style={{ opacity: 0.5, marginRight: 4 }}>{parentPath && '└'}</span>
        {displayName}
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
    })
  }

  // Render keyframe row
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Timeline track row uses double-click for adding keyframes
    <div
      className="timeline-track-row"
      style={{ width: timelineWidth }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Bar segments between keyframes */}
      {barSegments.map(bar => (
        <div
          key={bar.id}
          className="timeline-keyframe-bar"
          style={{ left: bar.left, width: bar.width }}
        />
      ))}
      {/* Keyframe diamonds */}
      {track.keyframes.map(keyframe => (
        <KeyframeDiamond
          key={keyframe.id}
          keyframe={keyframe}
          pixelsPerSecond={pixelsPerSecond}
          isSelected={selectedKeyframeIds.has(keyframe.id)}
          onClick={handleKeyframeClick}
        />
      ))}
    </div>
  )
}

// Keyframe diamond component
interface KeyframeDiamondProps {
  keyframe: Keyframe
  pixelsPerSecond: number
  isSelected: boolean
  onClick: (e: React.MouseEvent, keyframeId: string) => void
}

function KeyframeDiamond({ keyframe, pixelsPerSecond, isSelected, onClick }: KeyframeDiamondProps) {
  const x = keyframe.position * pixelsPerSecond

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Keyframe diamond is styled as a diamond shape
    <div
      className={`timeline-keyframe ${isSelected ? 'selected' : ''}`}
      style={{ left: x }}
      onClick={e => onClick(e, keyframe.id)}
      title={`${keyframe.position.toFixed(2)}s`}
    />
  )
}
