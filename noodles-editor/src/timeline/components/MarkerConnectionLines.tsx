// SVG overlay for bezier connection lines between markers and keyframes

import { useMemo } from 'react'
import type { TimeMarker, Track } from '../types'
import s from './TimelinePanel.module.css'

export interface MarkerConnectionLinesProps {
  markers: TimeMarker[]
  tracks: Map<string, Track>
  selectedKeyframeIds: Set<string>
  pixelsPerSecond: number
  rulerHeight: number
  trackHeight: number
  trackOrder: string[] // Array of trackIds in display order
  connectingFromMarkerId: string | null
  mousePosition: { x: number; y: number } | null
}

// Calculate bezier path from marker port to keyframe
function getConnectionPath(
  markerX: number,
  markerY: number,
  keyframeX: number,
  keyframeY: number
): string {
  const controlOffset = Math.abs(keyframeY - markerY) * 0.4
  return `M ${markerX} ${markerY} C ${markerX} ${markerY + controlOffset}, ${keyframeX} ${keyframeY - controlOffset}, ${keyframeX} ${keyframeY}`
}

export function MarkerConnectionLines({
  markers,
  tracks,
  selectedKeyframeIds,
  pixelsPerSecond,
  rulerHeight,
  trackHeight,
  trackOrder,
  connectingFromMarkerId,
  mousePosition,
}: MarkerConnectionLinesProps) {
  // Build lookup for track index
  const trackIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    trackOrder.forEach((trackId, index) => {
      map.set(trackId, index)
    })
    return map
  }, [trackOrder])

  // Collect all visible connection lines
  const connectionLines = useMemo(() => {
    const lines: Array<{
      id: string
      path: string
      isActive: boolean
    }> = []

    for (const marker of markers) {
      const markerX = marker.position * pixelsPerSecond
      const markerY = rulerHeight - 4 // Bottom of marker port

      for (const conn of marker.connectedKeyframes) {
        // Only show line if keyframe is selected
        if (!selectedKeyframeIds.has(conn.keyframeId)) continue

        const track = tracks.get(conn.trackId)
        if (!track) continue

        const keyframe = track.keyframes.find(kf => kf.id === conn.keyframeId)
        if (!keyframe) continue

        const trackIndex = trackIndexMap.get(conn.trackId)
        if (trackIndex === undefined) continue

        const keyframeX = keyframe.position * pixelsPerSecond
        const keyframeY = rulerHeight + trackIndex * trackHeight + trackHeight / 2

        lines.push({
          id: `${marker.id}-${conn.keyframeId}`,
          path: getConnectionPath(markerX, markerY, keyframeX, keyframeY),
          isActive: true,
        })
      }
    }

    return lines
  }, [markers, tracks, selectedKeyframeIds, pixelsPerSecond, rulerHeight, trackHeight, trackIndexMap])

  // Add temporary connection line during drag
  const tempLine = useMemo(() => {
    if (!connectingFromMarkerId || !mousePosition) return null

    const marker = markers.find(m => m.id === connectingFromMarkerId)
    if (!marker) return null

    const markerX = marker.position * pixelsPerSecond
    const markerY = rulerHeight - 4

    return {
      path: getConnectionPath(markerX, markerY, mousePosition.x, mousePosition.y),
    }
  }, [connectingFromMarkerId, mousePosition, markers, pixelsPerSecond, rulerHeight])

  if (connectionLines.length === 0 && !tempLine) return null

  return (
    <svg className={s.markerConnectionLines} aria-hidden="true">
      {connectionLines.map(line => (
        <path
          key={line.id}
          className={`${s.markerConnectionLine} ${line.isActive ? s.active : ''}`}
          d={line.path}
        />
      ))}
      {tempLine && (
        <path
          className={`${s.markerConnectionLine} ${s.connecting}`}
          d={tempLine.path}
        />
      )}
    </svg>
  )
}
