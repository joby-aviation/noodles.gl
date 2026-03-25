// Keyframe indicator component for animatable fields
// Shows diamond icon indicating keyframe state and allows add/delete

import type React from 'react'
import { useCallback } from 'react'
import { getFieldPath } from '../field-bindings'
import { getTimelineStore, useTimelineStore } from '../timeline-store'
import type { KeyframeValue } from '../types'
import s from './TimelinePanel.module.css'

export interface KeyframeIndicatorProps {
  // Operator ID (e.g., "/my-operator")
  opId: string
  // Field name within the operator
  fieldName: string
  // Optional sub-path for compound fields (array of path segments)
  subPath?: string[]
  // Current value to use when adding keyframe
  currentValue: KeyframeValue
  // Whether the field is disabled
  disabled?: boolean
  // Size variant
  size?: 'small' | 'medium'
  // Callback when a keyframe is added (e.g., to auto-expand timeline)
  onKeyframeAdded?: () => void
}

// Diamond SVG icon
function DiamondIcon({
  filled,
  animated,
  size,
}: {
  filled: boolean
  animated: boolean
  size: 'small' | 'medium'
}) {
  const dimensions = size === 'small' ? 10 : 12
  const strokeWidth = size === 'small' ? 1.5 : 2

  return (
    <svg
      width={dimensions}
      height={dimensions}
      viewBox="0 0 10 10"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <path
        d="M5 1 L9 5 L5 9 L1 5 Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {animated && !filled && <circle cx="5" cy="5" r="1.5" fill="currentColor" opacity="0.5" />}
    </svg>
  )
}

export function KeyframeIndicator({
  opId,
  fieldName,
  subPath,
  currentValue,
  disabled = false,
  size = 'medium',
  onKeyframeAdded,
}: KeyframeIndicatorProps) {
  const fieldPath = getFieldPath(opId, fieldName, subPath)

  // Check if track has keyframes
  const hasKeyframes = useTimelineStore(state => {
    const track = state.tracks.get(fieldPath)
    return track ? track.keyframes.length > 0 : false
  })

  // Check if playhead is at a keyframe
  const isAtKeyframe = useTimelineStore(state => {
    const track = state.tracks.get(fieldPath)
    if (!track) return false
    const epsilon = 0.001
    return track.keyframes.some(kf => Math.abs(kf.position - state.position) < epsilon)
  })

  // Add keyframe at current position
  const addKeyframe = useCallback(() => {
    if (disabled) return

    const store = getTimelineStore()
    const position = store.position

    // Get or create track - this ensures track exists in the store
    store.getOrCreateTrack(fieldPath, currentValue)

    // Re-fetch track from store to get the latest state after potential creation
    const track = store.getTrack(fieldPath)
    if (!track) {
      console.warn(`Failed to create/get track for ${fieldPath}`)
      return
    }

    // Check if keyframe already exists at this position
    const epsilon = 0.001
    const existingKf = track.keyframes.find(kf => Math.abs(kf.position - position) < epsilon)

    if (!existingKf) {
      const keyframeId = store.addKeyframe(fieldPath, {
        position,
        value: currentValue,
        interpolation: 'bezier',
      })
      if (keyframeId) {
        // Notify parent that a keyframe was added (e.g., to auto-expand timeline)
        onKeyframeAdded?.()
      }
    }
  }, [fieldPath, currentValue, disabled, onKeyframeAdded])

  // Delete keyframe at current position
  const deleteKeyframe = useCallback(() => {
    if (disabled) return

    const store = getTimelineStore()
    const position = store.position
    const track = store.getTrack(fieldPath)

    if (!track) return

    const epsilon = 0.001
    const keyframeToDelete = track.keyframes.find(kf => Math.abs(kf.position - position) < epsilon)

    if (keyframeToDelete) {
      store.deleteKeyframe(fieldPath, keyframeToDelete.id)
    }
  }, [fieldPath, disabled])

  // Handle click - add or delete based on state
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()

      if (isAtKeyframe) {
        deleteKeyframe()
      } else {
        addKeyframe()
      }
    },
    [isAtKeyframe, addKeyframe, deleteKeyframe]
  )

  // Determine visual state
  const isAnimated = hasKeyframes && !isAtKeyframe

  // Build class names
  const className = [
    s.keyframeIndicator,
    size === 'small' ? s.keyframeIndicatorSmall : '',
    hasKeyframes ? s.hasKeyframes : '',
    isAtKeyframe ? s.atKeyframe : '',
    isAnimated ? s.animated : '',
    disabled ? 'disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  // Tooltip text
  const title = isAtKeyframe
    ? 'Delete keyframe'
    : hasKeyframes
      ? 'Add keyframe at current time'
      : 'Add keyframe'

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <DiamondIcon filled={isAtKeyframe} animated={isAnimated} size={size} />
    </button>
  )
}

// Wrapper component that adds keyframe indicator to any field
export interface WithKeyframeIndicatorProps {
  children: React.ReactNode
  opId: string
  fieldName: string
  subPath?: string[]
  currentValue: KeyframeValue
  disabled?: boolean
  showIndicator?: boolean
  onKeyframeAdded?: () => void
}

export function WithKeyframeIndicator({
  children,
  opId,
  fieldName,
  subPath,
  currentValue,
  disabled = false,
  showIndicator = true,
  onKeyframeAdded,
}: WithKeyframeIndicatorProps) {
  if (!showIndicator) {
    return <>{children}</>
  }

  return (
    <div className={s.fieldWithKeyframeIndicator}>
      {children}
      <KeyframeIndicator
        opId={opId}
        fieldName={fieldName}
        subPath={subPath}
        currentValue={currentValue}
        disabled={disabled}
        size="small"
        onKeyframeAdded={onKeyframeAdded}
      />
    </div>
  )
}
