// Zustand store for native timeline state management
// Provides Theatre.js-compatible serialization for project files

import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import { debugKeyframe, debugTimeline } from '../utils/debug'
import { evaluateTrack } from './interpolation'
import type {
  BezierHandles,
  InterpolationType,
  Keyframe,
  KeyframeValue,
  SequenceState,
  SerializedTimeMarker,
  TheatreKeyframe,
  TheatreSequenceData,
  TheatreTimelineData,
  TheatreTrackData,
  TimeMarker,
  Track,
} from './types'
import { DEFAULT_BEZIER_HANDLES, DEFAULT_SEQUENCE_STATE } from './types'

// ============================================================================
// Store Interface
// ============================================================================

export interface TimelineStore {
  // === Historic State (serialized to project) ===
  sequence: SequenceState
  tracks: Map<string, Track>
  markers: TimeMarker[]

  // === Ephemeral State (session only) ===
  position: number
  playing: boolean
  loop: boolean
  playbackSpeed: number
  selectedKeyframeIds: Set<string>
  selectedTrackIds: Set<string>
  selectedMarkerId: string | null
  connectingFromMarkerId: string | null

  // === Sequence Actions ===
  setLength: (length: number) => void
  setFps: (fps: number) => void

  // === Playback Actions ===
  setPosition: (position: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  toggleLoop: () => void
  setPlaybackSpeed: (speed: number) => void
  stepForward: (frames?: number) => void
  stepBackward: (frames?: number) => void
  goToStart: () => void
  goToEnd: () => void

  // === Track Actions ===
  getOrCreateTrack: (fieldPath: string, defaultValue: KeyframeValue) => Track
  getTrack: (fieldPath: string) => Track | undefined
  getTrackById: (trackId: string) => Track | undefined
  deleteTrack: (trackId: string) => void
  deleteTracksForOperators: (operatorIds: string[]) => void
  hasKeyframesForField: (fieldPath: string) => boolean

  // === Marker Actions ===
  addMarker: (position: number) => string
  deleteMarker: (markerId: string) => void
  deleteAllMarkers: () => void
  moveMarker: (markerId: string, newPosition: number) => void
  selectMarker: (markerId: string | null) => void
  setConnectingFromMarker: (markerId: string | null) => void
  connectKeyframeToMarker: (markerId: string, trackId: string, keyframeId: string) => void
  disconnectKeyframeFromMarker: (markerId: string, keyframeId: string) => void
  getMarkerForKeyframe: (keyframeId: string) => TimeMarker | undefined

  // === Keyframe Actions ===
  addKeyframe: (trackId: string, keyframe: Omit<Keyframe, 'id'> & { id?: string }) => string
  updateKeyframe: (
    trackId: string,
    keyframeId: string,
    updates: Partial<Omit<Keyframe, 'id'>>
  ) => void
  deleteKeyframe: (trackId: string, keyframeId: string) => void
  moveKeyframe: (trackId: string, keyframeId: string, newPosition: number) => void
  setKeyframeHandles: (trackId: string, keyframeId: string, handles: BezierHandles) => void

  // Delete all currently selected keyframes in one history entry
  deleteSelectedKeyframes: () => void

  // === Selection Actions ===
  selectKeyframe: (keyframeId: string, addToSelection?: boolean) => void
  deselectKeyframe: (keyframeId: string) => void
  clearSelection: () => void
  selectAllInTrack: (trackId: string) => void
  selectTrack: (trackId: string) => void
  // Replace entire selection atomically (used by box select)
  setSelectedKeyframes: (ids: string[]) => void
  // Shift-click on track label: add all kfs if not all selected, remove all if all selected
  toggleTrackKeyframes: (trackId: string) => void
  // Select every keyframe across all tracks
  selectAllKeyframes: () => void
  // Apply easing to all currently selected keyframes (callers must fire history)
  applyEasingToSelectedKeyframes: (
    interpolation: InterpolationType,
    handles?: BezierHandles
  ) => void

  // === Evaluation ===
  evaluateTrack: (trackId: string, time?: number) => KeyframeValue | undefined
  evaluateAllTracks: (time?: number) => Map<string, KeyframeValue>

  // === Serialization (Theatre.js compatible) ===
  toTheatreJSON: () => TheatreTimelineData
  fromTheatreJSON: (json: TheatreTimelineData, opts?: { keepPosition?: boolean }) => void
  reset: () => void
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateKeyframeId(): string {
  return `kf_${nanoid(8)}`
}

function generateTrackId(): string {
  return `track_${nanoid(8)}`
}

function generateMarkerId(): string {
  return `tm_${nanoid(8)}`
}

// Keep keyframes sorted by position
function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.position - b.position)
}

// Convert native handles to Theatre.js format [leftX, leftY, rightX, rightY]
function handlesToTheatre(handles: BezierHandles): [number, number, number, number] {
  return [handles.left[0], handles.left[1], handles.right[0], handles.right[1]]
}

// Convert Theatre.js handles to native format
function theatreToHandles(handles: [number, number, number, number]): BezierHandles {
  return {
    left: [handles[0], handles[1]],
    right: [handles[2], handles[3]],
    type: 'aligned',
  }
}

// Convert native keyframe to Theatre.js format
function keyframeToTheatre(kf: Keyframe, index: number, total: number): TheatreKeyframe {
  return {
    id: kf.id,
    position: kf.position,
    connectedRight: index < total - 1 && kf.interpolation !== 'hold',
    handles: handlesToTheatre(kf.handles || DEFAULT_BEZIER_HANDLES),
    value: kf.value,
  }
}

// Convert Theatre.js keyframe to native format
function theatreToKeyframe(tkf: TheatreKeyframe): Keyframe {
  return {
    id: tkf.id,
    position: tkf.position,
    value: tkf.value as KeyframeValue,
    interpolation: tkf.connectedRight ? 'bezier' : 'hold',
    handles: theatreToHandles(tkf.handles),
  }
}

// Detect value type for Theatre.js track data
function detectValueType(value: KeyframeValue): string {
  if (typeof value === 'number') return 'BasicKeyframedTrack'
  if (typeof value === 'boolean') return 'BasicKeyframedTrack'
  if (typeof value === 'string') return 'BasicKeyframedTrack'
  if (typeof value === 'object' && value !== null) {
    if ('r' in value && 'g' in value && 'b' in value) return 'BasicKeyframedTrack'
  }
  return 'BasicKeyframedTrack'
}

// ============================================================================
// Store Creation
// ============================================================================

export const useTimelineStore = create<TimelineStore>()(
  subscribeWithSelector((set, get) => ({
    // === Initial State ===
    sequence: { ...DEFAULT_SEQUENCE_STATE },
    tracks: new Map(),
    markers: [],
    position: 0,
    playing: false,
    loop: true,
    playbackSpeed: 1,
    selectedKeyframeIds: new Set(),
    selectedTrackIds: new Set(),
    selectedMarkerId: null,
    connectingFromMarkerId: null,

    // === Sequence Actions ===
    setLength: length => {
      set(state => ({
        sequence: { ...state.sequence, length: Math.max(0.1, length) },
        position: Math.min(state.position, length),
      }))
    },

    setFps: fps => {
      set(state => ({
        sequence: { ...state.sequence, fps: Math.max(1, Math.round(fps)) },
      }))
    },

    // === Playback Actions ===
    setPosition: position => {
      const { sequence } = get()
      set({ position: Math.max(0, Math.min(position, sequence.length)) })
    },

    play: () => set({ playing: true }),
    pause: () => set({ playing: false }),
    togglePlay: () => set(state => ({ playing: !state.playing })),
    toggleLoop: () => set(state => ({ loop: !state.loop })),

    setPlaybackSpeed: speed => {
      set({ playbackSpeed: Math.max(0.1, Math.min(10, speed)) })
    },

    stepForward: (frames = 1) => {
      const { sequence, position } = get()
      const frameTime = 1 / sequence.fps
      set({ position: Math.min(position + frameTime * frames, sequence.length) })
    },

    stepBackward: (frames = 1) => {
      const { sequence, position } = get()
      const frameTime = 1 / sequence.fps
      set({ position: Math.max(position - frameTime * frames, 0) })
    },

    goToStart: () => set({ position: 0 }),
    goToEnd: () => set(state => ({ position: state.sequence.length })),

    // === Track Actions ===
    getOrCreateTrack: (fieldPath, defaultValue) => {
      const { tracks } = get()
      let track = tracks.get(fieldPath)

      if (!track) {
        track = {
          id: fieldPath, // Use fieldPath as ID for simplicity
          fieldPath,
          keyframes: [],
          defaultValue,
        }
        const newTracks = new Map(tracks)
        newTracks.set(fieldPath, track)
        set({ tracks: newTracks })
      }

      return track
    },

    getTrack: fieldPath => get().tracks.get(fieldPath),
    getTrackById: trackId => get().tracks.get(trackId),

    deleteTrack: trackId => {
      const tracks = new Map(get().tracks)
      tracks.delete(trackId)
      // Clean up marker connections for this track
      const markers = get().markers.map(m => ({
        ...m,
        connectedKeyframes: m.connectedKeyframes.filter(c => c.trackId !== trackId),
      }))
      set({ tracks, markers })
    },

    deleteTracksForOperators: operatorIds => {
      const tracks = new Map(get().tracks)
      let changed = false
      for (const [trackId] of tracks) {
        for (const opId of operatorIds) {
          // opId is like "/my-op" or "/container/child"
          // track prefix is "my-op / " or "container / child / "
          const prefix = `${opId.slice(1).split('/').join(' / ')} / `
          if (trackId.startsWith(prefix)) {
            tracks.delete(trackId)
            changed = true
            break
          }
        }
      }
      if (changed) set({ tracks })
    },

    hasKeyframesForField: fieldPath => {
      const track = get().tracks.get(fieldPath)
      return track ? track.keyframes.length > 0 : false
    },

    // === Marker Actions ===
    addMarker: position => {
      const id = generateMarkerId()
      const markers = [...get().markers, { id, position, connectedKeyframes: [] }]
      set({ markers })
      return id
    },

    deleteMarker: markerId => {
      const markers = get().markers.filter(m => m.id !== markerId)
      const selectedMarkerId = get().selectedMarkerId === markerId ? null : get().selectedMarkerId
      set({ markers, selectedMarkerId })
    },

    deleteAllMarkers: () => {
      set({ markers: [], selectedMarkerId: null })
    },

    moveMarker: (markerId, newPosition) => {
      const { markers, tracks } = get()
      const marker = markers.find(m => m.id === markerId)
      if (!marker) return

      // Move all connected keyframes maintaining their offset
      const newTracks = new Map(tracks)
      for (const conn of marker.connectedKeyframes) {
        const track = newTracks.get(conn.trackId)
        if (!track) continue
        const newKfPosition = Math.max(0, newPosition + conn.offset)
        const keyframes = track.keyframes.map(kf =>
          kf.id === conn.keyframeId ? { ...kf, position: newKfPosition } : kf
        )
        newTracks.set(conn.trackId, { ...track, keyframes: sortKeyframes(keyframes) })
      }

      // Update marker position
      const newMarkers = markers.map(m => (m.id === markerId ? { ...m, position: newPosition } : m))
      set({ markers: newMarkers, tracks: newTracks })
    },

    selectMarker: markerId => {
      set({ selectedMarkerId: markerId })
    },

    setConnectingFromMarker: markerId => {
      set({ connectingFromMarkerId: markerId })
    },

    connectKeyframeToMarker: (markerId, trackId, keyframeId) => {
      const { markers, tracks } = get()
      const marker = markers.find(m => m.id === markerId)
      const track = tracks.get(trackId)
      if (!marker || !track) return

      const keyframe = track.keyframes.find(kf => kf.id === keyframeId)
      if (!keyframe) return

      // Check if already connected to this marker
      if (marker.connectedKeyframes.some(c => c.keyframeId === keyframeId)) return

      // Remove from any other marker first
      let newMarkers = markers.map(m => ({
        ...m,
        connectedKeyframes: m.connectedKeyframes.filter(c => c.keyframeId !== keyframeId),
      }))

      // Add to the target marker
      const offset = keyframe.position - marker.position
      newMarkers = newMarkers.map(m =>
        m.id === markerId
          ? { ...m, connectedKeyframes: [...m.connectedKeyframes, { keyframeId, trackId, offset }] }
          : m
      )
      set({ markers: newMarkers })
    },

    disconnectKeyframeFromMarker: (markerId, keyframeId) => {
      const markers = get().markers.map(m =>
        m.id === markerId
          ? {
              ...m,
              connectedKeyframes: m.connectedKeyframes.filter(c => c.keyframeId !== keyframeId),
            }
          : m
      )
      set({ markers })
    },

    getMarkerForKeyframe: keyframeId => {
      return get().markers.find(m => m.connectedKeyframes.some(c => c.keyframeId === keyframeId))
    },

    // === Keyframe Actions ===
    addKeyframe: (trackId, keyframe) => {
      const tracks = new Map(get().tracks)
      const track = tracks.get(trackId)

      if (!track) {
        debugTimeline(`Track ${trackId} not found`)
        return ''
      }

      const before = captureTimelineState()

      const id = keyframe.id || generateKeyframeId()
      const newKeyframe: Keyframe = {
        id,
        position: keyframe.position,
        value: keyframe.value,
        interpolation: keyframe.interpolation || 'bezier',
        handles: keyframe.handles,
      }

      const updatedTrack = {
        ...track,
        keyframes: sortKeyframes([...track.keyframes, newKeyframe]),
      }
      tracks.set(trackId, updatedTrack)
      set({ tracks })

      debugKeyframe(
        'store.addKeyframe track=%s pos=%s id=%s value=%O',
        trackId,
        keyframe.position,
        id,
        keyframe.value
      )
      fireTimelineMutation('Add keyframe', before)
      return id
    },

    updateKeyframe: (trackId, keyframeId, updates) => {
      const tracks = new Map(get().tracks)
      const track = tracks.get(trackId)

      if (!track) return

      const keyframes = track.keyframes.map(kf =>
        kf.id === keyframeId ? { ...kf, ...updates } : kf
      )

      const updatedTrack = {
        ...track,
        keyframes: sortKeyframes(keyframes),
      }
      tracks.set(trackId, updatedTrack)
      set({ tracks })
      debugKeyframe('store.updateKeyframe track=%s id=%s updates=%O', trackId, keyframeId, updates)
    },

    deleteKeyframe: (trackId, keyframeId) => {
      const tracks = new Map(get().tracks)
      const track = tracks.get(trackId)

      if (!track) return

      const before = captureTimelineState()

      const updatedTrack = {
        ...track,
        keyframes: track.keyframes.filter(kf => kf.id !== keyframeId),
      }
      tracks.set(trackId, updatedTrack)

      // Also remove from selection
      const selectedKeyframeIds = new Set(get().selectedKeyframeIds)
      selectedKeyframeIds.delete(keyframeId)

      // Clean up marker connections
      const markers = get().markers.map(m => ({
        ...m,
        connectedKeyframes: m.connectedKeyframes.filter(c => c.keyframeId !== keyframeId),
      }))

      set({ tracks, selectedKeyframeIds, markers })
      fireTimelineMutation('Delete keyframe', before)
    },

    deleteSelectedKeyframes: () => {
      const { selectedKeyframeIds, tracks, markers } = get()
      if (selectedKeyframeIds.size === 0) return

      const before = captureTimelineState()
      const newTracks = new Map(tracks)

      for (const [trackId, track] of newTracks) {
        const filtered = track.keyframes.filter(kf => !selectedKeyframeIds.has(kf.id))
        if (filtered.length !== track.keyframes.length) {
          newTracks.set(trackId, { ...track, keyframes: filtered })
        }
      }

      // Clean up marker connections for deleted keyframes
      const newMarkers = markers.map(m => ({
        ...m,
        connectedKeyframes: m.connectedKeyframes.filter(
          c => !selectedKeyframeIds.has(c.keyframeId)
        ),
      }))

      set({ tracks: newTracks, selectedKeyframeIds: new Set(), markers: newMarkers })
      fireTimelineMutation('Delete keyframes', before)
    },

    moveKeyframe: (trackId, keyframeId, newPosition) => {
      get().updateKeyframe(trackId, keyframeId, { position: newPosition })
    },

    setKeyframeHandles: (trackId, keyframeId, handles) => {
      get().updateKeyframe(trackId, keyframeId, { handles })
    },

    // === Selection Actions ===
    selectKeyframe: (keyframeId, addToSelection = false) => {
      set(state => {
        const selectedKeyframeIds = addToSelection
          ? new Set(state.selectedKeyframeIds)
          : new Set<string>()
        selectedKeyframeIds.add(keyframeId)
        return { selectedKeyframeIds }
      })
    },

    deselectKeyframe: keyframeId => {
      set(state => {
        const selectedKeyframeIds = new Set(state.selectedKeyframeIds)
        selectedKeyframeIds.delete(keyframeId)
        return { selectedKeyframeIds }
      })
    },

    clearSelection: () => {
      set({ selectedKeyframeIds: new Set(), selectedTrackIds: new Set() })
    },

    selectAllInTrack: trackId => {
      const track = get().tracks.get(trackId)
      if (!track) return

      set({
        selectedKeyframeIds: new Set(track.keyframes.map(kf => kf.id)),
      })
    },

    selectTrack: trackId => {
      set({ selectedTrackIds: new Set([trackId]) })
    },

    setSelectedKeyframes: ids => {
      set({ selectedKeyframeIds: new Set(ids) })
    },

    toggleTrackKeyframes: trackId => {
      const { tracks, selectedKeyframeIds } = get()
      const track = tracks.get(trackId)
      if (!track || track.keyframes.length === 0) return
      const allSelected = track.keyframes.every(kf => selectedKeyframeIds.has(kf.id))
      const next = new Set(selectedKeyframeIds)
      for (const kf of track.keyframes) {
        allSelected ? next.delete(kf.id) : next.add(kf.id)
      }
      set({ selectedKeyframeIds: next })
    },

    selectAllKeyframes: () => {
      const allIds: string[] = []
      for (const [, track] of get().tracks) {
        for (const kf of track.keyframes) {
          allIds.push(kf.id)
        }
      }
      set({ selectedKeyframeIds: new Set(allIds) })
    },

    applyEasingToSelectedKeyframes: (interpolation, handles) => {
      const { tracks, selectedKeyframeIds } = get()
      for (const [trackId, track] of tracks) {
        for (const kf of track.keyframes) {
          if (selectedKeyframeIds.has(kf.id)) {
            get().updateKeyframe(trackId, kf.id, { interpolation })
            if (handles && interpolation === 'bezier') {
              get().setKeyframeHandles(trackId, kf.id, handles)
            }
          }
        }
      }
    },

    // === Evaluation ===
    evaluateTrack: (trackId, time) => {
      const track = get().tracks.get(trackId)
      if (!track) return undefined

      const evalTime = time ?? get().position
      const result = evaluateTrack(track, evalTime)
      debugKeyframe(
        'evaluateTrack %s @ t=%s kfs=%d → %O',
        trackId,
        evalTime.toFixed(3),
        track.keyframes.length,
        result
      )
      return result
    },

    evaluateAllTracks: time => {
      const { tracks, position } = get()
      const evalTime = time ?? position
      const results = new Map<string, KeyframeValue>()

      for (const [trackId, track] of tracks) {
        const value = evaluateTrack(track, evalTime)
        if (value !== undefined) {
          results.set(trackId, value)
        }
      }

      return results
    },

    // === Serialization ===
    toTheatreJSON: () => {
      const { sequence, tracks, markers } = get()

      // Group tracks by object name (operator path)
      const tracksByObject: TheatreSequenceData['tracksByObject'] = {}

      for (const [fieldPath, track] of tracks) {
        if (track.keyframes.length === 0) continue

        // Parse field path: "operator-name / prop / subprop" -> object: "operator-name", prop: "prop.subprop"
        const parts = fieldPath.split(' / ')
        const objectName = parts[0]
        const propPath = parts.slice(1).join('.')

        if (!tracksByObject[objectName]) {
          tracksByObject[objectName] = {
            trackIdByPropPath: {},
            trackData: {},
          }
        }

        const trackDataId = generateTrackId()
        tracksByObject[objectName].trackIdByPropPath[propPath] = trackDataId

        const trackData: TheatreTrackData = {
          type: detectValueType(track.defaultValue),
          keyframes: track.keyframes.map((kf, i, arr) => keyframeToTheatre(kf, i, arr.length)),
        }
        tracksByObject[objectName].trackData[trackDataId] = trackData
      }

      // Serialize markers
      const serializedMarkers: SerializedTimeMarker[] = markers.map(m => ({
        id: m.id,
        position: m.position,
        connections: m.connectedKeyframes.map(c => ({
          keyframeId: c.keyframeId,
          trackPath: c.trackId,
          offset: c.offset,
        })),
      }))

      return {
        sheetsById: {
          Noodles: {
            sequence: {
              length: sequence.length,
              subUnitsPerUnit: sequence.fps,
              tracksByObject,
              markers: serializedMarkers.length > 0 ? serializedMarkers : undefined,
            },
            staticOverrides: { byObject: {} },
          },
        },
        definitionVersion: '0.4.0',
        revisionHistory: [],
      }
    },

    fromTheatreJSON: (json, opts) => {
      const emptyTimelineState = {
        sequence: { ...DEFAULT_SEQUENCE_STATE },
        tracks: new Map<string, Track>(),
        markers: [] as TimeMarker[],
        position: 0,
        playing: false,
        selectedKeyframeIds: new Set<string>(),
        selectedTrackIds: new Set<string>(),
        selectedMarkerId: null,
        connectingFromMarkerId: null,
      }

      if (!json || typeof json !== 'object' || !json.sheetsById?.Noodles) {
        debugTimeline('Invalid Theatre.js timeline data')
        set(emptyTimelineState)
        return
      }

      const theatreSeq = json.sheetsById.Noodles.sequence
      if (!theatreSeq) {
        // Some legacy projects only persist static overrides without a sequence.
        // Treat this as "no animated timeline" instead of an invalid project.
        set(emptyTimelineState)
        return
      }

      const newTracks = new Map<string, Track>()

      // Parse each object's tracks
      for (const [objectName, objectData] of Object.entries(theatreSeq.tracksByObject ?? {})) {
        const trackIdByPropPath = objectData?.trackIdByPropPath ?? {}
        const trackDataById = objectData?.trackData ?? {}

        for (const [propPath, trackDataId] of Object.entries(trackIdByPropPath)) {
          const trackData = trackDataById[trackDataId]
          if (!trackData) continue

          // Theatre.js stores prop paths as JSON arrays: '["pitch"]' or '["viewState","zoom"]'
          // Fall back to dot-splitting for native-format paths like "viewState.zoom"
          let propPathParts: string[]
          try {
            const parsed = JSON.parse(propPath)
            propPathParts = Array.isArray(parsed) ? parsed.map(String) : propPath.split('.')
          } catch {
            propPathParts = propPath.split('.')
          }
          const fieldPath = [objectName, ...propPathParts].join(' / ')

          const keyframes = (trackData.keyframes ?? []).map(theatreToKeyframe)
          const defaultValue = keyframes[0]?.value ?? 0

          const track: Track = {
            id: fieldPath,
            fieldPath,
            keyframes: sortKeyframes(keyframes),
            defaultValue,
          }
          newTracks.set(fieldPath, track)
        }
      }

      // Deserialize markers
      const markers: TimeMarker[] = (theatreSeq.markers ?? []).map(m => ({
        id: m.id,
        position: m.position,
        connectedKeyframes: (m.connections ?? []).map(c => ({
          keyframeId: c.keyframeId,
          trackId: c.trackPath,
          offset: c.offset,
        })),
      }))

      set({
        sequence: {
          length:
            typeof theatreSeq.length === 'number' && theatreSeq.length > 0
              ? theatreSeq.length
              : DEFAULT_SEQUENCE_STATE.length,
          fps:
            typeof theatreSeq.subUnitsPerUnit === 'number' && theatreSeq.subUnitsPerUnit > 0
              ? Math.round(theatreSeq.subUnitsPerUnit)
              : DEFAULT_SEQUENCE_STATE.fps,
        },
        tracks: newTracks,
        markers,
        position: opts?.keepPosition ? get().position : 0,
        playing: false,
        selectedKeyframeIds: new Set(),
        selectedTrackIds: new Set(),
        selectedMarkerId: null,
        connectingFromMarkerId: null,
      })
    },

    reset: () => {
      set({
        sequence: { ...DEFAULT_SEQUENCE_STATE },
        tracks: new Map(),
        markers: [],
        position: 0,
        playing: false,
        loop: true,
        playbackSpeed: 1,
        selectedKeyframeIds: new Set(),
        selectedTrackIds: new Set(),
        selectedMarkerId: null,
        connectingFromMarkerId: null,
      })
    },
  }))
)

// ============================================================================
// Standalone getters (for use outside React)
// ============================================================================

export function getTimelineStore() {
  return useTimelineStore.getState()
}

export function subscribeToPosition(callback: (position: number) => void) {
  return useTimelineStore.subscribe(state => state.position, callback)
}

export function subscribeToPlaying(callback: (playing: boolean) => void) {
  return useTimelineStore.subscribe(state => state.playing, callback)
}

// ============================================================================
// Unified history integration
// ============================================================================

// Module-level callback — set by UndoRedoHandler to record timeline mutations
// into the same undo stack as node/edge operations
let _timelineMutationCallback: ((desc: string, before: string, after: string) => void) | undefined

export function registerTimelineMutationCallback(
  cb: ((desc: string, before: string, after: string) => void) | undefined
) {
  _timelineMutationCallback = cb
}

// Capture the current timeline state as a JSON string for history snapshots
export function captureTimelineState(): string {
  return JSON.stringify(useTimelineStore.getState().toTheatreJSON())
}

// Fire a history entry for a completed mutation. Pass beforeJson captured before
// the mutation; the current state is captured as "after" automatically.
export function fireTimelineMutation(desc: string, beforeJson: string) {
  if (!_timelineMutationCallback) return
  const after = captureTimelineState()
  _timelineMutationCallback(desc, beforeJson, after)
}
