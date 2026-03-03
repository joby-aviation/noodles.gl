// Track list component - container for all timeline tracks

import { useTimelineStore } from '../timeline-store'
import { KeyframeTrack } from './KeyframeTrack'
import s from './TimelinePanel.module.css'

export interface TrackListProps {
  showLabelsOnly?: boolean
  pixelsPerSecond?: number
  timelineWidth?: number
  sequenceLength?: number
}

export function TrackList({
  showLabelsOnly = false,
  pixelsPerSecond,
  timelineWidth,
  sequenceLength,
}: TrackListProps) {
  const tracks = useTimelineStore(state => state.tracks)

  // Convert tracks Map to array, filter to only tracks with keyframes, and sort by fieldPath
  const trackArray = Array.from(tracks.values())
    .filter(track => track.keyframes.length > 0)
    .sort((a, b) => a.fieldPath.localeCompare(b.fieldPath))

  if (trackArray.length === 0) {
    if (showLabelsOnly) {
      return (
        <div className={s.timelineTrackLabelsEmpty}>
          <div className={s.timelineEmpty}>No animated properties</div>
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
          sequenceLength={sequenceLength}
        />
      ))}
    </div>
  )
}
