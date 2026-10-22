// Core type definitions for the native timeline system

// ============================================================================
// Value Types (matching field types from fields.ts)
// ============================================================================

export type RGBA = { r: number; g: number; b: number; a: number }
export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }
export type Point2D = { lng: number; lat: number }
export type Point3D = { lng: number; lat: number; alt: number }

// Primitive keyframe values
export type PrimitiveKeyframeValue =
  | number
  | boolean
  | string
  | RGBA
  | Vec2
  | Vec3
  | Point2D
  | Point3D

// Compound keyframe value (for nested objects)
export type CompoundKeyframeValue = {
  [key: string]: PrimitiveKeyframeValue | CompoundKeyframeValue
}

// Union of all animatable value types
export type KeyframeValue = PrimitiveKeyframeValue | CompoundKeyframeValue

// ============================================================================
// Bezier Handle Types
// ============================================================================

export type HandleType = 'aligned' | 'uneven' | 'free'

export interface BezierHandles {
  // Control point offsets in normalized [0-1] x [0-1] space
  // These are relative to the keyframe position
  left: [number, number] // [x, y] - control point before this keyframe
  right: [number, number] // [x, y] - control point after this keyframe
  type: HandleType
}

// Default bezier handles for linear interpolation
export const DEFAULT_BEZIER_HANDLES: BezierHandles = {
  left: [0, 0],
  right: [1, 1],
  type: 'aligned',
}

// ============================================================================
// Interpolation Types
// ============================================================================

export type InterpolationType = 'bezier' | 'linear' | 'hold'

// ============================================================================
// Keyframe
// ============================================================================

export interface Keyframe {
  id: string // Unique identifier, e.g., "kf_abc123"
  position: number // Time in seconds
  value: KeyframeValue
  interpolation: InterpolationType
  handles?: BezierHandles // Only used when interpolation is 'bezier'
}

// ============================================================================
// Track
// ============================================================================

export interface Track {
  id: string // Same as fieldPath for simplicity
  fieldPath: string // timeline format: "maplibre-basemap / viewState / zoom"
  keyframes: Keyframe[] // Always sorted by position
  defaultValue: KeyframeValue
}

// ============================================================================
// Sequence State
// ============================================================================

export interface SequenceState {
  length: number // Duration in seconds
  fps: number // Frames per second (default: 30)
  inPoint?: number // Render start time in seconds (undefined = 0)
  outPoint?: number // Render end time in seconds (undefined = length)
}

export const DEFAULT_SEQUENCE_STATE: SequenceState = {
  length: 10,
  fps: 30,
  inPoint: undefined,
  outPoint: undefined,
}

// ============================================================================
// Easing Preset
// ============================================================================

export interface EasingPreset {
  name: string
  // CSS cubic-bezier values: cubic-bezier(x1, y1, x2, y2)
  // Converted to handles format for internal use
  handles: BezierHandles
}

// ============================================================================
// Timeline Store State Types
// ============================================================================

export interface TimelineHistoricState {
  sequence: SequenceState
  tracks: Map<string, Track>
}

export interface TimelineEphemeralState {
  position: number
  playing: boolean
  loop: boolean
  playbackSpeed: number
  selectedKeyframeIds: Set<string>
  selectedTrackIds: Set<string>
}

// ============================================================================
// Time Marker Types
// ============================================================================

export interface TimeMarkerConnection {
  keyframeId: string
  trackId: string // fieldPath
  offset: number // keyframe.position - marker.position (can be negative)
}

export interface TimeMarker {
  id: string // "tm_abc123"
  position: number // Time in seconds
  connectedKeyframes: TimeMarkerConnection[]
}

// Serialized format for timeline JSON
export interface SerializedTimeMarker {
  id: string
  position: number
  connections: Array<{
    keyframeId: string
    trackPath: string
    offset: number
  }>
}

// ============================================================================
// Clipboard Types
// ============================================================================

// Represents a single keyframe entry stored in the clipboard for copy/paste
export interface CopiedKeyframeEntry {
  trackId: string
  keyframe: Keyframe
}

// ============================================================================
// Serialization Types
// ============================================================================

// Serialized track data format
export interface TimelineTrackData {
  type: string
  __debugName?: string
  keyframes: TimelineKeyframe[]
}

export interface TimelineKeyframe {
  id: string
  position: number
  connectedRight: boolean
  handles: [number, number, number, number] // [leftX, leftY, rightX, rightY]
  type?: string
  value: unknown
}

// Serialized sequence format (what we read/write from timeline field)
export interface TimelineSequenceData {
  length: number
  subUnitsPerUnit: number // fps
  tracksByObject: Record<
    string,
    {
      trackIdByPropPath: Record<string, string>
      trackData: Record<string, TimelineTrackData>
    }
  >
  markers?: SerializedTimeMarker[]
  inPoint?: number // Optional for backward compatibility
  outPoint?: number // Optional for backward compatibility
}

// Top-level serialized timeline format
export interface TimelineData {
  sheetsById: {
    Noodles: {
      sequence: TimelineSequenceData
      staticOverrides?: { byObject: Record<string, unknown> }
    }
  }
  definitionVersion?: string
  revisionHistory?: unknown[]
}
