// Time ruler component showing time markers based on zoom level

import type React from 'react'
import { useMemo } from 'react'

export interface TimeRulerProps {
  width: number
  pixelsPerSecond: number
  scrollLeft: number
}

// Format time as MM:SS.ms or SS.ms depending on duration
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60

  if (mins > 0) {
    const wholeSecs = Math.floor(secs)
    return `${mins}:${wholeSecs.toString().padStart(2, '0')}`
  }
  const rounded = Math.round(seconds)
  if (Math.abs(seconds - rounded) < 0.001) {
    return `${rounded}s`
  }
  return `${secs.toFixed(1)}s`
}

// Calculate appropriate tick interval based on zoom level
function getTickInterval(pixelsPerSecond: number): { major: number; minor: number } {
  // Target ~50-100 pixels between major ticks
  const targetMajorPixels = 80

  const targetMajorSeconds = targetMajorPixels / pixelsPerSecond

  // Round to nice intervals
  const niceIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
  let major = niceIntervals[0]

  for (const interval of niceIntervals) {
    if (interval >= targetMajorSeconds) {
      major = interval
      break
    }
    major = interval
  }

  // Minor ticks subdivide major
  const minor = major / 4

  return { major, minor }
}

export function TimeRuler({ width, pixelsPerSecond, scrollLeft: _scrollLeft }: TimeRulerProps) {
  const { ticks, labels } = useMemo(() => {
    const { major, minor } = getTickInterval(pixelsPerSecond)
    const duration = width / pixelsPerSecond

    const tickElements: React.ReactElement[] = []
    const labelElements: React.ReactElement[] = []

    // Generate minor ticks
    for (let time = 0; time <= duration; time += minor) {
      const x = time * pixelsPerSecond
      const isMajor = Math.abs(time % major) < 0.001 || Math.abs((time % major) - major) < 0.001

      tickElements.push(
        <div
          key={`tick-${time}`}
          className={`timeline-ruler-tick ${isMajor ? 'major' : ''}`}
          style={{
            left: x,
            height: isMajor ? 12 : 6,
          }}
        />
      )

      // Add label for major ticks
      if (isMajor) {
        labelElements.push(
          <div key={`label-${time}`} className="timeline-ruler-label" style={{ left: x }}>
            {formatTime(time)}
          </div>
        )
      }
    }

    return { ticks: tickElements, labels: labelElements }
  }, [width, pixelsPerSecond])

  return (
    <div className="timeline-ruler" style={{ width }}>
      {ticks}
      {labels}
    </div>
  )
}
