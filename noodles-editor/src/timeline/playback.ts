// RAF-based playback driver for the native timeline system
// Provides smooth playback and manual mode for video rendering

import { debugPlayback } from '../utils/debug'
import { getTimelineStore, useTimelineStore } from './timeline-store'

// ============================================================================
// Playback Driver Class
// ============================================================================

export type PlaybackCallback = (deltaMs: number) => void

export class PlaybackDriver {
  private rafId: number | null = null
  private lastTimestamp = 0
  private manualMode = false
  private subscribers: Set<PlaybackCallback> = new Set()

  // Start the playback loop (uses requestAnimationFrame for smooth ~60fps updates)
  start(): void {
    if (this.rafId !== null || this.manualMode) return

    this.lastTimestamp = performance.now()
    this.rafId = requestAnimationFrame(this.tick)
  }

  // Stop the playback loop
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  // Check if the playback loop is running
  isRunning(): boolean {
    return this.rafId !== null
  }

  // Subscribe to tick events, returns unsubscribe function
  subscribe(callback: PlaybackCallback): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  // Enable or disable manual mode for video rendering
  // In manual mode, the RAF loop is disabled and ticks must be triggered manually
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

  // RAF callback - advances position based on elapsed time
  private tick = (timestamp: number): void => {
    if (this.manualMode) return

    const delta = timestamp - this.lastTimestamp
    this.lastTimestamp = timestamp

    this.notifySubscribers(delta)

    // Continue the loop
    this.rafId = requestAnimationFrame(this.tick)
  }

  // Notify all subscribers of a tick
  private notifySubscribers(deltaMs: number): void {
    for (const callback of this.subscribers) {
      try {
        callback(deltaMs)
      } catch (error) {
        console.error('Error in playback subscriber:', error)
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
  if (getTimelineStore().playing && !playbackDriver.isManualMode()) {
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
  getTimelineStore().stepForward(1)
}

// Step backward by one frame
export function prevFrame(): void {
  getTimelineStore().stepBackward(1)
}
