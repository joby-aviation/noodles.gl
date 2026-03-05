// Track list component - container for all timeline tracks

import { useTimelineStore } from '../timeline-store'
import { KeyframeTrack } from './KeyframeTrack'
import s from './TimelinePanel.module.css'

export interface TrackListProps {
  showLabelsOnly?: boolean
  pixelsPerSecond?: number
  timelineWidth?: number
  sequenceLength?: number
  fps?: number
  onOpenCurveEditor?: (trackId: string) => void
}

export function TrackList({
  showLabelsOnly = false,
  pixelsPerSecond,
  timelineWidth,
  sequenceLength,
  fps,
  onOpenCurveEditor,
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

  // Annotate each track with its op id and whether it's the first in its op group
  const tracksWithMeta = trackArray.map((track, i) => {
    const opId = track.fieldPath.split(' / ')[0]
    const prevOpId = i > 0 ? trackArray[i - 1].fieldPath.split(' / ')[0] : null
    return { track, opId, isFirstInGroup: opId !== prevOpId }
  })

  return (
    <div className="timeline-track-list">
      {tracksWithMeta.map(({ track, opId, isFirstInGroup }) => (
        <KeyframeTrack
          key={track.id}
          track={track}
          showLabelOnly={showLabelsOnly}
          pixelsPerSecond={pixelsPerSecond}
          timelineWidth={timelineWidth}
          sequenceLength={sequenceLength}
          fps={fps}
          opId={opId}
          isFirstInGroup={isFirstInGroup}
          onOpenCurveEditor={onOpenCurveEditor}
        />
      ))}
    </div>
  )
}
