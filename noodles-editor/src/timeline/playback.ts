// Playback driver for the native timeline system
// Provides smooth playback and manual mode for video rendering

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

  // Enable or disable manual mode for video rendering
  // In manual mode, the worker timer loop is disabled and ticks must be triggered manually
  setManualMode(enabled: boolean): void {
    this.manualMode = enabled
    if (enabled) {
      this.stop()
    }
  }

  // Check if manual mode is enabled
  isManualMode(): boolean {
    return this.manualMode
  }

  // Manually trigger a tick with a specific timestamp (only works in manual mode)
  manualTick(timestamp: number): void {
    if (!this.manualMode) {
      debugPlayback('manualTick called but manual mode is not enabled')
      return
    }

    const delta = timestamp - this.lastTimestamp
    this.lastTimestamp = timestamp
    this.notifySubscribers(delta)
  }

  // RAF/worker timer callback - advances position based on elapsed time
  private tick = (timestamp: number): void => {
    if (this.manualMode) return

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

    const { position, sequence, playbackSpeed, loop } = store
    const deltaSeconds = (deltaMs / 1000) * playbackSpeed
    let newPosition = position + deltaSeconds

    // Handle end of sequence
    if (newPosition >= sequence.length) {
      if (loop) {
        // Wrap around to beginning
        newPosition = newPosition % sequence.length
      } else {
        // Stop at end
        newPosition = sequence.length
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
