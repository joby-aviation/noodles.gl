// Timeline React context for providing timeline state to components

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { connectPlaybackToTimeline, playbackDriver } from './playback'
import { getTimelineStore, useTimelineStore } from './timeline-store'
import type { TheatreTimelineData } from './types'

// Context value type
interface TimelineContextValue {
  store: typeof useTimelineStore
  playbackDriver: typeof playbackDriver
  isInitialized: boolean
}

const TimelineContext = createContext<TimelineContextValue | null>(null)

export interface TimelineProviderProps {
  children: React.ReactNode
  // Optional initial timeline data (Theatre.js format from project JSON)
  initialData?: TheatreTimelineData
}

export function TimelineProvider({ children, initialData }: TimelineProviderProps) {
  const isInitialized = useRef(false)

  // Initialize timeline from data on first mount
  useEffect(() => {
    if (isInitialized.current) return
    isInitialized.current = true

    const store = getTimelineStore()

    // Load initial data if provided (Theatre.js format)
    if (initialData) {
      try {
        store.fromTheatreJSON(initialData)
      } catch (error) {
        console.error('Failed to load timeline data:', error)
      }
    }

    // Connect playback driver to timeline store
    const disconnectPlayback = connectPlaybackToTimeline()

    return () => {
      disconnectPlayback()
    }
  }, [initialData]) // Only run on mount, ignore initialData changes

  const contextValue = useMemo<TimelineContextValue>(
    () => ({
      store: useTimelineStore,
      playbackDriver,
      isInitialized: isInitialized.current,
    }),
    []
  )

  return <TimelineContext.Provider value={contextValue}>{children}</TimelineContext.Provider>
}

// Hook to access timeline context
export function useTimeline() {
  const context = useContext(TimelineContext)
  if (!context) {
    throw new Error('useTimeline must be used within a TimelineProvider')
  }
  return context
}

// Hook for timeline position with subscription
export function useTimelinePosition() {
  return useTimelineStore(state => state.position)
}

// Hook for playing state with subscription
export function useTimelinePlaying() {
  return useTimelineStore(state => state.playing)
}

// Hook for sequence info
export function useTimelineSequence() {
  return useTimelineStore(state => state.sequence)
}

// Hook for selected track
export function useSelectedTrack(trackId: string | null) {
  return useTimelineStore(state => (trackId ? state.tracks.get(trackId) : null))
}

// Hook for all tracks
export function useTracks() {
  return useTimelineStore(state => state.tracks)
}

// Hook for selected keyframes
export function useSelectedKeyframes() {
  return useTimelineStore(state => state.selectedKeyframeIds)
}

// Hook for track evaluation at current position
export function useTrackValue(trackId: string | null) {
  const position = useTimelineStore(state => state.position)
  const track = useTimelineStore(state => (trackId ? state.tracks.get(trackId) : null))

  return useMemo(() => {
    if (!track || !trackId) return null
    return getTimelineStore().evaluateTrack(trackId, position)
  }, [trackId, track, position])
}

// Hook for checking if a field has keyframes
export function useHasKeyframes(fieldPath: string) {
  return useTimelineStore(state => {
    const track = state.tracks.get(fieldPath)
    return track ? track.keyframes.length > 0 : false
  })
}

// Hook for checking if playhead is at a keyframe for a field
export function useIsAtKeyframe(fieldPath: string) {
  return useTimelineStore(state => {
    const track = state.tracks.get(fieldPath)
    if (!track) return false
    const epsilon = 0.001
    return track.keyframes.some(kf => Math.abs(kf.position - state.position) < epsilon)
  })
}
