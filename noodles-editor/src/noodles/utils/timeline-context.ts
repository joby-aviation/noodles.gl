import { useTimelineStore } from '../../timeline/timeline-store'

export interface TimelineContext {
  sequenceTime: number
  frame: number
  totalFrames: number
  sequence: {
    length: number
    fps: number
  }
}

// Get current timeline values
export function getTimelineContext(): TimelineContext {
  const store = useTimelineStore.getState()
  return {
    sequenceTime: store.position,
    frame: Math.floor(store.position * store.sequence.fps),
    totalFrames: Math.floor(store.sequence.length * store.sequence.fps),
    sequence: {
      length: store.sequence.length,
      fps: store.sequence.fps,
    },
  }
}
