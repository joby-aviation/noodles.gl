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

export type TimelineVariable = 'sequenceTime' | 'frame' | 'totalFrames' | 'sequence'

// Get current timeline values without tracking
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

// Create a proxy that tracks property access
export function createTrackedTimelineContext(
  onAccess: (variable: TimelineVariable) => void
): TimelineContext {
  const context = getTimelineContext()

  return new Proxy(context, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'string' && prop in target) {
        onAccess(prop as TimelineVariable)
      }
      return target[prop as keyof TimelineContext]
    },
  })
}
