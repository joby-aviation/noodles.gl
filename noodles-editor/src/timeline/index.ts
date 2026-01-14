// Native Timeline System - Public API
// Replaces Theatre.js for timeline animation

// ============================================================================
// Types
// ============================================================================

export type {
  BezierHandles,
  EasingPreset,
  HandleType,
  InterpolationType,
  Keyframe,
  KeyframeValue,
  Point2D,
  Point3D,
  RGBA,
  SequenceState,
  TheatreKeyframe,
  TheatreSequenceData,
  TheatreTimelineData,
  TheatreTrackData,
  Track,
  Vec2,
  Vec3,
} from './types'

export { DEFAULT_BEZIER_HANDLES, DEFAULT_SEQUENCE_STATE } from './types'

// ============================================================================
// Easing Presets
// ============================================================================

export {
  EASING_PRESETS,
  findMatchingPreset,
  getDefaultPreset,
  getPresetByName,
  getPresetNames,
} from './easing-presets'

// ============================================================================
// Interpolation Engine
// ============================================================================

export {
  evaluateBezierEasing,
  evaluateCubicBezier,
  evaluateTrack,
  findSurroundingKeyframes,
  findTForX,
  getKeyframeAtTime,
  interpolateBetweenKeyframes,
  interpolateColor,
  interpolateCompound,
  interpolateNumber,
  interpolatePoint2D,
  interpolatePoint3D,
  interpolateValue,
  interpolateVec2,
  interpolateVec3,
  trackHasKeyframes,
} from './interpolation'

// ============================================================================
// Timeline Store
// ============================================================================

export type { TimelineStore } from './timeline-store'

export {
  getTimelineStore,
  subscribeToPlaying,
  subscribeToPosition,
  useTimelineStore,
} from './timeline-store'

// ============================================================================
// Playback Driver
// ============================================================================

export type { PlaybackCallback } from './playback'

export {
  connectPlaybackToTimeline,
  getCurrentFrame,
  getTotalFrames,
  goToFrame,
  nextFrame,
  PlaybackDriver,
  playbackDriver,
  prevFrame,
} from './playback'

// ============================================================================
// Field Bindings
// ============================================================================

export {
  bindAllOperatorsToTimeline,
  bindFieldToTimeline,
  bindOperatorToTimeline,
  cleanupRemovedOperators,
  clearAllBindings,
  fieldValueToKeyframeValue,
  getFieldDefaultKeyframeValue,
  getFieldPath,
  isAnimatableField,
  keyframeValueToFieldValue,
  opIdToObjectName,
  unbindOperatorFromTimeline,
} from './field-bindings'

// ============================================================================
// UI Components
// ============================================================================

export {
  KeyframeTrack,
  PlayControls,
  Playhead,
  TimeDisplay,
  TimelinePanel,
  TimeRuler,
  TrackList,
} from './components'

export type {
  KeyframeTrackProps,
  PlayheadProps,
  TimelinePanelProps,
  TimeRulerProps,
  TrackListProps,
} from './components'
