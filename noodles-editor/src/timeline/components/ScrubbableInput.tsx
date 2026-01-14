// Scrubbable number input with Theatre.js-style drag behavior

import React, { useCallback, useEffect, useRef, useState } from 'react'

export interface ScrubbableInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  precision?: number
  disabled?: boolean
  hasKeyframes?: boolean
  isAtKeyframe?: boolean
  onAddKeyframe?: () => void
  onDeleteKeyframe?: () => void
}

interface DragState {
  startValue: number
  startX: number
  accumulatedDelta: number
}

// Calculate decimal places from step value
function getPrecisionFromStep(step: number): number {
  if (step >= 1) return 0
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  return Math.min(decimals, 6)
}

// Format value with appropriate precision
function formatValue(value: number, precision: number): string {
  return value.toFixed(precision)
}

// Parse and evaluate math expressions
function evaluateExpression(input: string): number | null {
  try {
    // Only allow safe characters: numbers, operators, parentheses, decimal point, whitespace
    if (!/^[\d\s+\-*/().]+$/.test(input)) {
      return null
    }
    // Use Function instead of eval for slightly better safety
    const result = new Function(`return (${input})`)()
    if (typeof result === 'number' && !Number.isNaN(result) && Number.isFinite(result)) {
      return result
    }
    return null
  } catch {
    return null
  }
}

// Diamond icon component
function DiamondIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 10 10">
      <path
        className="diamond"
        d="M5 1 L9 5 L5 9 L1 5 Z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  )
}

export function ScrubbableInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision: propPrecision,
  disabled = false,
  hasKeyframes = false,
  isAtKeyframe = false,
  onAddKeyframe,
  onDeleteKeyframe,
}: ScrubbableInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [editValue, setEditValue] = useState('')
  const dragState = useRef<DragState | null>(null)

  const precision = propPrecision ?? getPrecisionFromStep(step)

  // Clamp value to min/max if specified
  const clampValue = useCallback(
    (val: number): number => {
      let result = val
      if (min !== undefined) result = Math.max(min, result)
      if (max !== undefined) result = Math.min(max, result)
      return result
    },
    [min, max]
  )

  // Calculate delta scale based on modifier keys
  const getModifierScale = useCallback((e: PointerEvent | KeyboardEvent): number => {
    if (e.shiftKey && e.altKey) return 0.01 // Ultra-fine
    if (e.shiftKey) return 0.1 // Fine
    if (e.altKey) return 10 // Coarse
    return 1 // Normal
  }, [])

  // Handle pointer down for drag
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || isEditing) return
      if (e.button !== 0) return // Only left click

      e.preventDefault()
      inputRef.current?.setPointerCapture(e.pointerId)

      dragState.current = {
        startValue: value,
        startX: e.clientX,
        accumulatedDelta: 0,
      }

      setIsDragging(true)
    },
    [disabled, isEditing, value]
  )

  // Handle pointer move during drag
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current || !isDragging) return

      const deltaX = e.clientX - dragState.current.startX
      dragState.current.accumulatedDelta = deltaX

      const scale = getModifierScale(e.nativeEvent)
      const scaledDelta = deltaX * step * scale

      const newValue = clampValue(dragState.current.startValue + scaledDelta)
      onChange(newValue)
    },
    [isDragging, step, getModifierScale, clampValue, onChange]
  )

  // Handle pointer up to end drag
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragState.current) {
        inputRef.current?.releasePointerCapture(e.pointerId)
        dragState.current = null
        setIsDragging(false)
      }
    },
    []
  )

  // Handle double-click to enter edit mode
  const handleDoubleClick = useCallback(() => {
    if (disabled) return
    setIsEditing(true)
    setEditValue(formatValue(value, precision))
  }, [disabled, value, precision])

  // Handle input change in edit mode
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value)
  }, [])

  // Commit edit value
  const commitEdit = useCallback(() => {
    const evaluated = evaluateExpression(editValue)
    if (evaluated !== null) {
      onChange(clampValue(evaluated))
    }
    setIsEditing(false)
  }, [editValue, onChange, clampValue])

  // Cancel edit
  const cancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
  }, [])

  // Handle key down in edit mode
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isEditing) {
        if (e.key === 'Enter') {
          e.preventDefault()
          commitEdit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelEdit()
        }
        return
      }

      // Arrow key nudging
      if (!isDragging && !disabled) {
        const scale = getModifierScale(e.nativeEvent)
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          onChange(clampValue(value + step * scale))
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(clampValue(value - step * scale))
        } else if (e.key === 'PageUp') {
          e.preventDefault()
          onChange(clampValue(value + step * 10 * scale))
        } else if (e.key === 'PageDown') {
          e.preventDefault()
          onChange(clampValue(value - step * 10 * scale))
        }
      }
    },
    [isEditing, isDragging, disabled, value, step, getModifierScale, clampValue, onChange, commitEdit, cancelEdit]
  )

  // Handle blur to commit edit
  const handleBlur = useCallback(() => {
    if (isEditing) {
      commitEdit()
    }
  }, [isEditing, commitEdit])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Handle keyframe indicator click
  const handleKeyframeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isAtKeyframe && onDeleteKeyframe) {
        onDeleteKeyframe()
      } else if (!isAtKeyframe && onAddKeyframe) {
        onAddKeyframe()
      }
    },
    [isAtKeyframe, onAddKeyframe, onDeleteKeyframe]
  )

  const displayValue = isEditing ? editValue : formatValue(value, precision)

  const inputClassName = [
    'scrubbable-input-field',
    isDragging && 'dragging',
    hasKeyframes && 'has-keyframes',
    isAtKeyframe && 'at-keyframe',
  ]
    .filter(Boolean)
    .join(' ')

  const indicatorClassName = [
    'scrubbable-input-keyframe-indicator',
    hasKeyframes && 'has-keyframes',
    isAtKeyframe && 'at-keyframe',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="scrubbable-input">
      <input
        ref={inputRef}
        type="text"
        className={inputClassName}
        value={displayValue}
        onChange={handleInputChange}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={disabled}
        readOnly={!isEditing}
      />
      {(onAddKeyframe || onDeleteKeyframe) && (
        <button
          type="button"
          className={indicatorClassName}
          onClick={handleKeyframeClick}
          title={isAtKeyframe ? 'Delete keyframe' : hasKeyframes ? 'Add keyframe' : 'Add keyframe'}
        >
          <DiamondIcon filled={isAtKeyframe} />
        </button>
      )}
    </div>
  )
}
