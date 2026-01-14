// Track list component - container for all timeline tracks

import { useTimelineStore } from '../timeline-store'
import { KeyframeTrack } from './KeyframeTrack'

export interface TrackListProps {
  showLabelsOnly?: boolean
  pixelsPerSecond?: number
  timelineWidth?: number
}

export function TrackList({ showLabelsOnly = false, pixelsPerSecond, timelineWidth }: TrackListProps) {
  const tracks = useTimelineStore(state => state.tracks)

  // Convert tracks Map to array and sort by fieldPath
  const trackArray = Array.from(tracks.values()).sort((a, b) =>
    a.fieldPath.localeCompare(b.fieldPath)
  )

  if (trackArray.length === 0) {
    if (showLabelsOnly) {
      return (
        <div className="timeline-track-labels-empty">
          <div className="timeline-empty">No animated properties</div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="timeline-track-list">
      {trackArray.map(track => (
        <KeyframeTrack
          key={track.id}
          track={track}
          showLabelOnly={showLabelsOnly}
          pixelsPerSecond={pixelsPerSecond}
          timelineWidth={timelineWidth}
        />
      ))}
    </div>
  )
}
