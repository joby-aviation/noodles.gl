// Playback driver for the native timeline system
// Provides smooth playback, and a manual mode that holds the loop off while an export
// sets positions directly with goToFrame

import { debugPlayback } from '../utils/debug'
import { visibilityAdaptiveLoop } from '../utils/worker-timer'
import { getTimelineStore, useTimelineStore } from './timeline-store'

// ============================================================================
// Playback Driver Class
// ============================================================================

export type PlaybackCallback = (deltaMs: number) => void

export class PlaybackDriver {
  private cancelTick: (() => void) | null = null
  private lastTimestamp = 0
  private manualMode = false
  private subscribers: Set<PlaybackCallback> = new Set()

  // Start the playback loop (~60fps, RAF when visible, worker timer when hidden)
  start(): void {
    if (this.cancelTick !== null || this.manualMode) return

    this.lastTimestamp = performance.now()
    this.cancelTick = visibilityAdaptiveLoop(this.tick, 1000 / 60)
  }

  // Stop the playback loop
  stop(): void {
    this.cancelTick?.()
    this.cancelTick = null
  }

  // Check if the playback loop is running
  isRunning(): boolean {
    return this.cancelTick !== null
  }

  // Subscribe to tick events, returns unsubscribe function
  subscribe(callback: PlaybackCallback): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  // Hold the loop off (for video rendering) or let it follow the timeline again.
  // Leaving manual mode restarts the loop if the timeline is playing.
  setManualMode(enabled: boolean): void {
    this.manualMode = enabled
    if (enabled) this.stop()
    else if (getTimelineStore().playing) this.start()
  }

  isManualMode(): boolean {
    return this.manualMode
  }

  // RAF/worker timer callback - advances position based on elapsed time
  private tick = (timestamp: number): void => {
    const delta = timestamp - this.lastTimestamp
    this.lastTimestamp = timestamp

    this.notifySubscribers(delta)
  }

  // Notify all subscribers of a tick
  private notifySubscribers(deltaMs: number): void {
    for (const callback of this.subscribers) {
      try {
        callback(deltaMs)
      } catch (error) {
        console.error('[Noodles] Playback subscriber error:', error)
        debugPlayback('Error in playback subscriber:', error)
      }
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const playbackDriver = new PlaybackDriver()

// ============================================================================
// Timeline Integration
// ============================================================================

// Connect the playback driver to the timeline store
// Advances the timeline position based on elapsed time when playing
// Returns cleanup function to disconnect
export function connectPlaybackToTimeline(): () => void {
  const unsubscribeDriver = playbackDriver.subscribe(deltaMs => {
    const store = getTimelineStore()
    if (!store.playing) return

    const { position, sequence, playbackSpeed, loop, loopInOut } = store
    const deltaSeconds = (deltaMs / 1000) * playbackSpeed
    let newPosition = position + deltaSeconds

    // Determine playback boundaries
    const startBoundary = loopInOut ? (sequence.inPoint ?? 0) : 0
    const endBoundary = loopInOut ? (sequence.outPoint ?? sequence.length) : sequence.length

    // An empty range (zero length, or in/out loaded from a file that touch or cross)
    // has nothing to play, and wrapping with % 0 would give NaN
    if (endBoundary - startBoundary <= 0) {
      store.setPosition(Math.min(startBoundary, endBoundary))
      store.pause()
      return
    }

    // Handle end of playback range
    if (newPosition >= endBoundary) {
      if (loop) {
        // Wrap around to start of range
        const overshoot = newPosition - endBoundary
        newPosition = startBoundary + (overshoot % (endBoundary - startBoundary))
      } else {
        // Stop at end
        newPosition = endBoundary
        store.pause()
      }
    }

    // Handle going before start boundary (can happen with negative playback speed)
    if (newPosition < startBoundary) {
      if (loop) {
        const undershoot = startBoundary - newPosition
        newPosition = endBoundary - (undershoot % (endBoundary - startBoundary))
      } else {
        newPosition = startBoundary
        store.pause()
      }
    }

    store.setPosition(newPosition)
  })

  // Subscribe to playing state changes to start/stop RAF loop
  const unsubscribeStore = useTimelineStore.subscribe(
    state => state.playing,
    playing => {
      if (playing && !playbackDriver.isManualMode()) {
        playbackDriver.start()
      } else {
        playbackDriver.stop()
      }
    }
  )

  // Start immediately if already playing
  const store = getTimelineStore()
  if (store.playing && !playbackDriver.isManualMode()) {
    playbackDriver.start()
  }

  return () => {
    unsubscribeDriver()
    unsubscribeStore()
    playbackDriver.stop()
  }
}

// ============================================================================
// Manual Playback Helpers (for video rendering)
// ============================================================================

// Step the timeline to a specific frame for video rendering
// Sets the position directly without animation (frame is 0-indexed)
export function goToFrame(frame: number): void {
  const store = getTimelineStore()
  const { fps } = store.sequence
  const position = frame / fps
  store.setPosition(position)
}

// Get the total number of frames in the sequence
export function getTotalFrames(): number {
  const { sequence } = getTimelineStore()
  return Math.ceil(sequence.length * sequence.fps)
}

// Get the current frame number
export function getCurrentFrame(): number {
  const { position, sequence } = getTimelineStore()
  return Math.floor(position * sequence.fps)
}

// Step forward by one frame
export function nextFrame(): void {
  const store = getTimelineStore()
  store.stepForward(1)
}

// Step backward by one frame
export function prevFrame(): void {
  const store = getTimelineStore()
  store.stepBackward(1)
}
