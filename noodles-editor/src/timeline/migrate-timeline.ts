// Migration utility to convert legacy timeline timeline data to native format

import type {
  BezierHandles,
  Keyframe,
  KeyframeValue,
  SequenceState,
  TimelineKeyframe,
  TimelineSequenceData,
  TimelineData,
  TimelineTrackData,
  Track,
} from './types'
import { DEFAULT_BEZIER_HANDLES, DEFAULT_SEQUENCE_STATE } from './types'

// ============================================================================
// Object Name Conversion
// ============================================================================

// legacy timeline uses format like "maplibre-basemap / viewState / zoom"
// We use format like "/maplibre-basemap.viewState.zoom"
export function objectNameToFieldPath(objectName: string): string {
  // Split by " / " and join with "."
  const parts = objectName.split(' / ')
  // First part becomes the operator ID with leading slash
  const opId = `/${parts[0]}`
  // Remaining parts are the property path
  const propPath = parts.slice(1).join('.')

  if (propPath) {
    return `${opId}.par.${propPath}`
  }
  return opId
}

// Reverse conversion for compatibility
export function fieldPathToObjectName(fieldPath: string): string {
  // Remove leading slash and ".par." prefix
  let path = fieldPath
  if (path.startsWith('/')) {
    path = path.slice(1)
  }

  // Split on ".par." to separate operator ID from property path
  const parIndex = path.indexOf('.par.')
  if (parIndex >= 0) {
    const opId = path.slice(0, parIndex)
    const propPath = path.slice(parIndex + 5) // Skip ".par."
    // Convert dots to " / "
    return `${opId} / ${propPath.replace(/\./g, ' / ')}`
  }

  return path
}

// ============================================================================
// Handle Conversion
// ============================================================================

// legacy timeline uses [leftX, leftY, rightX, rightY] in 0-1 space
// We use { left: [x, y], right: [x, y], type }
export function serializedHandlesToBezierHandles(
  handles: [number, number, number, number]
): BezierHandles {
  return {
    left: [handles[0], handles[1]],
    right: [handles[2], handles[3]],
    type: 'aligned', // Default to aligned, legacy timeline determines this from connected edges
  }
}

export function bezierHandlesToSerializedHandles(
  handles: BezierHandles
): [number, number, number, number] {
  return [handles.left[0], handles.left[1], handles.right[0], handles.right[1]]
}

// ============================================================================
// Value Conversion
// ============================================================================

// legacy timeline stores values directly, but compound values need special handling
export function rawValueToKeyframeValue(value: unknown, _propType?: string): KeyframeValue {
  if (value === null || value === undefined) {
    return 0
  }

  // Handle primitive types directly
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }

  // Handle object types (compound values, colors, vectors)
  if (typeof value === 'object') {
    // RGBA color
    if ('r' in value && 'g' in value && 'b' in value) {
      const v = value as { r: number; g: number; b: number; a?: number }
      return { r: v.r, g: v.g, b: v.b, a: v.a ?? 1 }
    }

    // Vec3
    if ('x' in value && 'y' in value && 'z' in value) {
      const v = value as { x: number; y: number; z: number }
      return { x: v.x, y: v.y, z: v.z }
    }

    // Vec2
    if ('x' in value && 'y' in value) {
      const v = value as { x: number; y: number }
      return { x: v.x, y: v.y }
    }

    // Point3D
    if ('lng' in value && 'lat' in value && 'alt' in value) {
      const v = value as { lng: number; lat: number; alt: number }
      return { lng: v.lng, lat: v.lat, alt: v.alt }
    }

    // Point2D
    if ('lng' in value && 'lat' in value) {
      const v = value as { lng: number; lat: number }
      return { lng: v.lng, lat: v.lat }
    }

    // Generic compound value - recurse
    const result: Record<string, KeyframeValue> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = rawValueToKeyframeValue(v)
    }
    return result
  }

  // Fallback
  return 0
}

// ============================================================================
// Keyframe Conversion
// ============================================================================

export function serializedKeyframeToKeyframe(kf: TimelineKeyframe, propType?: string): Keyframe {
  const handles = serializedHandlesToBezierHandles(kf.handles)

  // Determine interpolation type based on handles
  // Linear: handles are at diagonal (0,0) to (1,1)
  // Hold: connectedRight is false
  let interpolation: 'bezier' | 'linear' | 'hold' = 'bezier'

  if (!kf.connectedRight) {
    interpolation = 'hold'
  } else {
    // Check if handles form a linear curve
    const isLinear =
      Math.abs(handles.left[0] - handles.left[1]) < 0.001 &&
      Math.abs(handles.right[0] - handles.right[1]) < 0.001 &&
      Math.abs(handles.left[0]) < 0.001 &&
      Math.abs(handles.right[0] - 1) < 0.001
    if (isLinear) {
      interpolation = 'linear'
    }
  }

  return {
    id: kf.id,
    position: kf.position,
    value: rawValueToKeyframeValue(kf.value, propType),
    interpolation,
    handles: interpolation === 'bezier' ? handles : undefined,
  }
}

export function keyframeToSerializedKeyframe(kf: Keyframe): TimelineKeyframe {
  const handles = kf.handles ?? DEFAULT_BEZIER_HANDLES

  return {
    id: kf.id,
    position: kf.position,
    connectedRight: kf.interpolation !== 'hold',
    handles: bezierHandlesToSerializedHandles(handles),
    value: kf.value,
  }
}

// ============================================================================
// Track Conversion
// ============================================================================

export function trackDataToTrack(
  objectName: string,
  propPath: string,
  trackData: TimelineTrackData
): Track {
  const fieldPath = objectNameToFieldPath(`${objectName} / ${propPath}`)

  const keyframes = trackData.keyframes.map(kf => serializedKeyframeToKeyframe(kf, trackData.type))

  // Sort keyframes by position
  keyframes.sort((a, b) => a.position - b.position)

  // Default value: use first keyframe value or fallback
  const defaultValue = keyframes.length > 0 ? keyframes[0].value : 0

  return {
    id: fieldPath,
    fieldPath,
    keyframes,
    defaultValue,
  }
}

// ============================================================================
// Full Timeline Migration
// ============================================================================

export interface NativeTimelineData {
  sequence: SequenceState
  tracks: Record<string, Track>
}

export function migrateTimelineData(timelineData: TimelineData): NativeTimelineData {
  const noodlesSheet = timelineData.sheetsById?.Noodles
  if (!noodlesSheet) {
    // No timeline data, return defaults
    return {
      sequence: { ...DEFAULT_SEQUENCE_STATE },
      tracks: {},
    }
  }

  const sequenceData = noodlesSheet.sequence
  if (!sequenceData) {
    return {
      sequence: { ...DEFAULT_SEQUENCE_STATE },
      tracks: {},
    }
  }

  // Convert sequence state
  const sequence: SequenceState = {
    length: sequenceData.length ?? DEFAULT_SEQUENCE_STATE.length,
    fps: sequenceData.subUnitsPerUnit ?? DEFAULT_SEQUENCE_STATE.fps,
  }

  // Convert tracks
  const tracks: Record<string, Track> = {}

  const tracksByObject = sequenceData.tracksByObject ?? {}

  for (const [objectName, objectData] of Object.entries(tracksByObject)) {
    const { trackIdByPropPath, trackData } = objectData

    if (!trackIdByPropPath || !trackData) continue

    for (const [propPath, trackId] of Object.entries(trackIdByPropPath)) {
      const data = trackData[trackId]
      if (!data) continue

      const track = trackDataToTrack(objectName, propPath, data)
      tracks[track.id] = track
    }
  }

  return { sequence, tracks }
}

// Convert native format back to legacy timeline format (for backwards compatibility)
export function exportToTimelineFormat(data: NativeTimelineData): TimelineData {
  const tracksByObject: TimelineSequenceData['tracksByObject'] = {}

  for (const track of Object.values(data.tracks)) {
    const fullObjectName = fieldPathToObjectName(track.fieldPath)

    // Split into object name and prop path
    const parts = fullObjectName.split(' / ')
    const objectName = parts[0]
    const propPath = parts.slice(1).join(' / ')

    // Initialize object entry if needed
    if (!tracksByObject[objectName]) {
      tracksByObject[objectName] = {
        trackIdByPropPath: {},
        trackData: {},
      }
    }

    // Generate a track ID
    const trackId = `track_${track.id.replace(/[^a-zA-Z0-9]/g, '_')}`

    // Add prop path mapping
    tracksByObject[objectName].trackIdByPropPath[propPath] = trackId

    // Convert keyframes
    const serializedKeyframes = track.keyframes.map(keyframeToSerializedKeyframe)

    tracksByObject[objectName].trackData[trackId] = {
      type: detectValueType(track.defaultValue),
      keyframes: serializedKeyframes,
    }
  }

  return {
    sheetsById: {
      Noodles: {
        sequence: {
          length: data.sequence.length,
          subUnitsPerUnit: data.sequence.fps,
          tracksByObject,
        },
      },
    },
    definitionVersion: '0.4.0',
    revisionHistory: [],
  }
}

// Detect legacy timeline type string from value
function detectValueType(value: KeyframeValue): string {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'

  if (typeof value === 'object' && value !== null) {
    if ('r' in value && 'g' in value && 'b' in value) return 'rgba'
    if ('x' in value && 'y' in value && 'z' in value) return 'vec3'
    if ('x' in value && 'y' in value) return 'vec2'
    if ('lng' in value && 'lat' in value) return 'point2d'
    return 'compound'
  }

  return 'unknown'
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateTimelineData(data: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!data || typeof data !== 'object') {
    errors.push('Timeline data must be an object')
    return { valid: false, errors, warnings }
  }

  const timelineData = data as TimelineData

  // Check for required structure
  if (!timelineData.sheetsById) {
    warnings.push('No sheetsById found, using empty timeline')
    return { valid: true, errors, warnings }
  }

  if (!timelineData.sheetsById.Noodles) {
    warnings.push('No Noodles sheet found, using empty timeline')
    return { valid: true, errors, warnings }
  }

  const sheet = timelineData.sheetsById.Noodles
  if (!sheet.sequence) {
    warnings.push('No sequence data found, using defaults')
    return { valid: true, errors, warnings }
  }

  // Validate sequence
  const seq = sheet.sequence
  if (typeof seq.length !== 'number' || seq.length <= 0) {
    warnings.push('Invalid sequence length, using default')
  }

  if (typeof seq.subUnitsPerUnit !== 'number' || seq.subUnitsPerUnit <= 0) {
    warnings.push('Invalid FPS, using default')
  }

  // Validate tracks
  if (seq.tracksByObject) {
    for (const [objectName, objectData] of Object.entries(seq.tracksByObject)) {
      if (!objectData.trackData) {
        warnings.push(`Object "${objectName}" has no track data`)
        continue
      }

      for (const [trackId, trackData] of Object.entries(objectData.trackData)) {
        if (!trackData.keyframes || !Array.isArray(trackData.keyframes)) {
          warnings.push(`Track "${trackId}" has invalid keyframes`)
          continue
        }

        for (const kf of trackData.keyframes) {
          if (typeof kf.position !== 'number') {
            errors.push(`Keyframe in track "${trackId}" has invalid position`)
          }
          if (!kf.handles || kf.handles.length !== 4) {
            warnings.push(`Keyframe "${kf.id}" has invalid handles, using defaults`)
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
