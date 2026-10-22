# Architecture Document

## Overview

This document describes the architecture of the native timeline system that will replace Theatre.js in Noodles.gl. The design preserves Theatre.js's elegant three-tier state model while providing a cleaner, more controllable implementation.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Timeline Store (Zustand)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │ Sequence    │  │ Tracks &    │  │ Ephemeral State          │ │
│  │ - length    │  │ Keyframes   │  │ - position, playing      │ │
│  │ - fps       │  │ (Historic)  │  │ - selections             │ │
│  └─────────────┘  └─────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│ Timeline UI     │  │ Field Bindings  │  │ Interpolation       │
│ - TimelinePanel │  │ - bindField()   │  │ - Bezier evaluator  │
│ - KeyframeTrack │  │ - two-way sync  │  │ - Hold/Step modes   │
│ - CurveEditor   │  │ - type convert  │  │ - Easing presets    │
└─────────────────┘  └─────────────────┘  └─────────────────────┘
```

## Three-Tier State Model

Following Theatre.js's proven pattern, state is organized into three tiers:

### Historic State (Persisted to Project)

Historic state represents the actual animation data and is saved to project files.

```typescript
interface HistoricState {
  sequence: {
    length: number         // Duration in seconds
    fps: number            // Frames per second for snapping (default: 30)
  }
  tracks: Map<string, Track>  // Operator field path -> Track
}

interface Track {
  id: string
  fieldPath: string        // e.g., "/maplibre-basemap.par.viewState.zoom"
  keyframes: Keyframe[]    // Sorted by position
  defaultValue: KeyframeValue
}

interface Keyframe {
  id: string               // Unique identifier (e.g., "kf_abc123")
  position: number         // Time in seconds
  value: KeyframeValue     // The value at this keyframe
  interpolation: 'bezier' | 'linear' | 'hold'
  handles?: BezierHandles  // Only for bezier interpolation
}

interface BezierHandles {
  left: [number, number]   // Incoming handle [x, y], normalized 0-1
  right: [number, number]  // Outgoing handle [x, y], normalized 0-1
  type: 'auto' | 'free' | 'aligned' | 'vector'
}

type KeyframeValue =
  | number
  | boolean
  | string
  | { r: number; g: number; b: number; a: number }  // Color
  | { x: number; y: number }                         // Vec2
  | { x: number; y: number; z: number }              // Vec3
  | { lng: number; lat: number }                     // Point2D
  | { lng: number; lat: number; alt: number }        // Point3D
  | Record<string, KeyframeValue>                    // Compound
```

### Ephemeral State (Session Only)

Ephemeral state is transient and resets on page reload. It's never serialized.

```typescript
interface EphemeralState {
  // Playback
  position: number         // Current playhead position in seconds
  playing: boolean         // Is playback active
  loop: boolean            // Loop at end of sequence
  playbackSpeed: number    // 1.0 = normal, 0.5 = half speed, etc.

  // Selection
  selectedTrackIds: Set<string>
  selectedKeyframeIds: Set<string>
  clipboard: Keyframe[] | null

  // UI state that resets
  curveEditorOpen: boolean
  curveEditorTrackId: string | null
}
```

### Ahistorical State (User Preferences)

Ahistorical state persists across projects and sessions in localStorage.

```typescript
interface AhistoricalState {
  // Timeline UI preferences
  timelineZoom: number           // Pixels per second
  trackExpandedStates: Record<string, boolean>
  snapToFrames: boolean

  // Curve editor preferences
  showGridLines: boolean
  favoritePresets: string[]

  // Panel visibility
  timelinePanelHeight: number
  curveEditorWidth: number
}

// Storage key: 'noodles:timeline-preferences'
```

## Core Components

### Timeline Store (`timeline-store.ts`)

Central Zustand store managing all timeline state.

```typescript
interface TimelineStore {
  // Historic state
  sequence: SequenceState
  tracks: Map<string, Track>

  // Ephemeral state
  position: number
  playing: boolean
  loop: boolean
  playbackSpeed: number
  selectedKeyframeIds: Set<string>

  // Actions - Sequence
  setLength: (length: number) => void
  setFps: (fps: number) => void

  // Actions - Playback
  setPosition: (position: number) => void
  play: () => void
  pause: () => void
  toggleLoop: () => void
  setPlaybackSpeed: (speed: number) => void
  stepForward: (frames?: number) => void
  stepBackward: (frames?: number) => void
  goToStart: () => void
  goToEnd: () => void

  // Actions - Tracks
  getOrCreateTrack: (fieldPath: string, defaultValue: KeyframeValue) => Track
  deleteTrack: (trackId: string) => void
  hasKeyframesForField: (fieldPath: string) => boolean

  // Actions - Keyframes
  addKeyframe: (trackId: string, keyframe: Omit<Keyframe, 'id'>) => string
  updateKeyframe: (trackId: string, keyframeId: string, updates: Partial<Keyframe>) => void
  deleteKeyframe: (trackId: string, keyframeId: string) => void
  moveKeyframe: (trackId: string, keyframeId: string, newPosition: number) => void
  setKeyframeHandles: (trackId: string, keyframeId: string, handles: BezierHandles) => void

  // Actions - Selection
  selectKeyframe: (keyframeId: string, addToSelection?: boolean) => void
  deselectKeyframe: (keyframeId: string) => void
  clearSelection: () => void
  selectAllInTrack: (trackId: string) => void

  // Evaluation
  evaluateTrack: (trackId: string, time: number) => KeyframeValue | undefined
  evaluateAllTracks: (time: number) => Map<string, KeyframeValue>

  // Serialization
  toJSON: () => TimelineJSON
  fromJSON: (json: TimelineJSON) => void

  // History (for undo/redo)
  pushHistory: () => void
  undo: () => void
  redo: () => void
}
```

### Interpolation Engine (`interpolation.ts`)

Pure functions for evaluating keyframe values at arbitrary times.

```typescript
// Core bezier evaluation
function evaluateCubicBezier(
  t: number,        // Parameter 0-1
  p0: number,       // Start value
  p1: number,       // Control point 1
  p2: number,       // Control point 2
  p3: number        // End value
): number

// Newton-Raphson solver to find t for given x position
function findTForX(
  x: number,        // Target x position (0-1)
  x1: number,       // Control point 1 x
  x2: number,       // Control point 2 x
  epsilon?: number  // Precision (default: 0.0001)
): number

// Main interpolation entry point
function interpolateBetweenKeyframes(
  time: number,
  k1: Keyframe,
  k2: Keyframe
): KeyframeValue

// Type-specific interpolation
function interpolateNumber(v1: number, v2: number, t: number): number
function interpolateColor(c1: RGBA, c2: RGBA, t: number): RGBA
function interpolateVec2(v1: Vec2, v2: Vec2, t: number): Vec2
function interpolateVec3(v1: Vec3, v2: Vec3, t: number): Vec3
function interpolateCompound(
  v1: Record<string, KeyframeValue>,
  v2: Record<string, KeyframeValue>,
  t: number
): Record<string, KeyframeValue>

// Track evaluation (finds surrounding keyframes and interpolates)
function evaluateTrack(track: Track, time: number): KeyframeValue | undefined
```

### Field Bindings (`field-bindings.ts`)

Two-way synchronization between operator fields and timeline tracks.

```typescript
// Bind a single field to its timeline track
function bindFieldToTimeline(
  op: Operator<IOperator>,
  fieldName: string,
  field: Field<IField>,
  timelineStore: TimelineStore
): () => void  // Returns cleanup function

// Bind all animatable fields for an operator
function bindOperatorToTimeline(
  op: Operator<IOperator>,
  timelineStore: TimelineStore
): () => void  // Returns cleanup function

// Type conversion utilities
function fieldValueToKeyframeValue(field: Field, value: unknown): KeyframeValue
function keyframeValueToFieldValue(field: Field, value: KeyframeValue): unknown

// Detection
function isAnimatableField(field: Field): boolean
function getFieldDefaultKeyframeValue(field: Field): KeyframeValue
```

### Playback Driver (`playback.ts`)

RAF-based playback control for smooth animation and rendering.

```typescript
class PlaybackDriver {
  private rafId: number | null = null
  private lastTimestamp: number = 0
  private subscribers: Set<(deltaMs: number) => void> = new Set()

  // Control
  start(): void
  stop(): void
  tick(timestamp: number): void

  // Subscription
  subscribe(callback: (deltaMs: number) => void): () => void

  // Integration with video rendering
  setManualMode(enabled: boolean): void
  manualTick(timestamp: number): void
}

// Singleton instance
export const playbackDriver = new PlaybackDriver()
```

## Project Serialization Format

### New Native Format (Version 8)

```json
{
  "version": 8,
  "nodes": [...],
  "edges": [...],
  "timeline": {
    "version": 1,
    "sequence": {
      "length": 10.5,
      "fps": 30
    },
    "tracks": {
      "/maplibre-basemap": {
        "viewState.zoom": {
          "defaultValue": 12,
          "keyframes": [
            {
              "id": "kf_abc123",
              "position": 0,
              "value": 12.5,
              "interpolation": "bezier",
              "handles": {
                "left": [0.5, 1],
                "right": [0.5, 0],
                "type": "aligned"
              }
            },
            {
              "id": "kf_def456",
              "position": 5.0,
              "value": 15.0,
              "interpolation": "bezier",
              "handles": {
                "left": [0.5, 1],
                "right": [0.5, 0],
                "type": "aligned"
              }
            }
          ]
        },
        "viewState.bearing": {
          "defaultValue": 0,
          "keyframes": [...]
        }
      }
    }
  },
  "editorSettings": {...},
  "renderSettings": {...}
}
```

### Theatre.js Format (For Migration Reference)

```json
{
  "timeline": {
    "sheetsById": {
      "Noodles": {
        "sequence": {
          "type": "PositionalSequence",
          "length": 10.5,
          "subUnitsPerUnit": 30,
          "tracksByObject": {
            "maplibre-basemap / viewState": {
              "trackIdByPropPath": {
                "[\"zoom\"]": "track_xyz789"
              },
              "trackData": {
                "track_xyz789": {
                  "type": "BasicKeyframedTrack",
                  "keyframes": [
                    {
                      "id": "kf_theatre_123",
                      "position": 0,
                      "value": 12.5,
                      "type": "bezier",
                      "handles": [0.5, 1, 0.5, 0],
                      "connectedRight": true
                    }
                  ]
                }
              }
            }
          }
        },
        "staticOverrides": {
          "byObject": {}
        }
      }
    },
    "definitionVersion": "0.4.0",
    "revisionHistory": []
  }
}
```

## Data Flow

### Playback Data Flow

```
User presses Play
       ↓
PlaybackDriver.start()
       ↓
RAF loop begins
       ↓
Each frame:
  1. Calculate delta time
  2. Update store.position += delta * playbackSpeed
  3. For each bound field:
     a. evaluateTrack(track, position)
     b. Convert keyframe value to field value
     c. field.setValue(value)
  4. Operator graph re-executes (dirty tracking)
  5. Visualization updates
       ↓
User presses Pause
       ↓
PlaybackDriver.stop()
```

### Field Edit Data Flow (User Edits Property)

```
User changes field value in property panel
       ↓
Field.setValue(newValue) called
       ↓
Field subscription fires
       ↓
Check: Is playhead at a keyframe position?
       ↓
If yes: Update keyframe value
If no: Add new keyframe at current position
       ↓
Timeline UI updates
```

### Keyframe Edit Data Flow (User Edits Timeline)

```
User drags keyframe to new position
       ↓
store.moveKeyframe(trackId, keyframeId, newPosition)
       ↓
Track keyframes re-sorted
       ↓
If playhead is at affected region:
  1. evaluateTrack(track, position)
  2. Update field value
       ↓
Visualization updates
```

## Component Hierarchy

```
TimelineEditor (main container)
├── PlayControls
│   ├── GoToStartButton
│   ├── StepBackButton
│   ├── PlayPauseButton
│   ├── StepForwardButton
│   ├── GoToEndButton
│   ├── TimeDisplay
│   ├── LoopToggle
│   └── SpeedSelector
├── TimelinePanel
│   ├── TimeRuler
│   │   └── Playhead
│   └── TrackList
│       └── KeyframeTrack (for each track)
│           ├── TrackLabel
│           └── KeyframeDiamond (for each keyframe)
└── CurveEditor (modal/panel)
    ├── CurveCanvas
    │   ├── GridBackground
    │   ├── BezierCurve
    │   └── HandleControlPoint (for each handle)
    └── PresetLibrary
        └── PresetThumbnail (for each preset)
```

## Error Handling

### Interpolation Errors

- **Missing keyframes**: Return `undefined`, field uses default value
- **Invalid handles**: Clamp to valid range, log warning
- **Type mismatch**: Skip interpolation, use nearest keyframe value

### Binding Errors

- **Infinite loop detection**: `updating` flag prevents recursive updates
- **Type conversion failure**: Log error, skip binding for that field
- **Missing operator**: Clean up binding, remove orphaned track

### Migration Errors

- **Invalid Theatre.js format**: Skip migration, preserve original timeline data
- **Unrecognized field type**: Migrate as-is, log warning
- **Corrupt keyframe data**: Skip keyframe, log error with details

## Performance Considerations

### Keyframe Lookup

Use binary search for finding keyframes at a given time:

```typescript
function findSurroundingKeyframes(
  keyframes: Keyframe[],
  time: number
): { left: Keyframe | null; right: Keyframe | null } {
  // Binary search: O(log n) instead of O(n)
  let low = 0
  let high = keyframes.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (keyframes[mid].position < time) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return {
    left: high >= 0 ? keyframes[high] : null,
    right: low < keyframes.length ? keyframes[low] : null,
  }
}
```

### Memoization

Cache interpolation results for static playhead positions:

```typescript
const interpolationCache = new Map<string, KeyframeValue>()

function getCachedValue(trackId: string, position: number): KeyframeValue | undefined {
  const key = `${trackId}:${position.toFixed(6)}`
  return interpolationCache.get(key)
}
```

### Virtual Scrolling

For 100+ tracks, use virtualized list rendering:

```typescript
// Only render tracks visible in viewport
const visibleTracks = tracks.slice(
  Math.floor(scrollTop / TRACK_HEIGHT),
  Math.ceil((scrollTop + viewportHeight) / TRACK_HEIGHT)
)
```
