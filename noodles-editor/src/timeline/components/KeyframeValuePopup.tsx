// Popup for editing a keyframe's value directly
// Appears above the keyframe diamond when clicked

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Point2DField, Point3DField, Vec2Field, Vec3Field } from '../../noodles/fields'
import { getFieldFromTrackPath, keyframeValueToFieldValue } from '../field-bindings'
import { captureTimelineState, fireTimelineMutation, useTimelineStore } from '../timeline-store'
import type { Keyframe, KeyframeValue, Point2D, Point3D, RGBA, Vec2, Vec3 } from '../types'
import s from './TimelinePanel.module.css'

export interface KeyframeValuePopupProps {
  trackId: string
  keyframe: Keyframe
  anchorX: number // horizontal center of the diamond
  anchorY: number // top edge of the diamond
  onClose: () => void
}

const POPUP_WIDTH = 240
const POPUP_HEIGHT_EST = 110 // used for above/below flip logic

// Inline copy of formatTimeCode (not exported from TimeDisplay)
function formatTimeCode(seconds: number, fps: number): string {
  const totalFrames = Math.floor(seconds * fps)
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const frames = totalFrames % fps
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`
}

type ValueType =
  | 'number'
  | 'boolean'
  | 'string'
  | 'rgba'
  | 'vec2'
  | 'vec3'
  | 'point2d'
  | 'point3d'
  | 'unknown'

function detectValueType(value: KeyframeValue): ValueType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  if (value !== null && typeof value === 'object') {
    if ('r' in value && 'g' in value && 'b' in value) return 'rgba'
    if ('lng' in value && 'lat' in value && 'alt' in value) return 'point3d'
    if ('lng' in value && 'lat' in value) return 'point2d'
    if ('x' in value && 'y' in value && 'z' in value) return 'vec3'
    if ('x' in value && 'y' in value) return 'vec2'
  }
  return 'unknown'
}

function roundDisplay(v: number): string {
  return (Math.round(v * 10000) / 10000).toString()
}

// Draggable number input: drag horizontally to scrub, click to type
function ScrubInput({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  const [text, setText] = useState(roundDisplay(value))
  const [isEditing, setIsEditing] = useState(false)
  const isDragging = useRef(false)
  const startXRef = useRef(0)
  const startValRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) setText(roundDisplay(value))
  }, [value, isEditing])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      isDragging.current = false
      startXRef.current = e.clientX
      startValRef.current = value
      e.currentTarget.setPointerCapture(e.pointerId)

      const handleMove = (ev: PointerEvent) => {
        if (!isDragging.current && Math.abs(ev.clientX - startXRef.current) < 3) return
        isDragging.current = true
        let v = startValRef.current + (ev.clientX - startXRef.current) * step
        if (min !== undefined) v = Math.max(min, v)
        if (max !== undefined) v = Math.min(max, v)
        onChange(v)
      }

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [value, step, min, max, onChange]
  )

  const handleClick = useCallback(() => {
    if (isDragging.current) return
    setIsEditing(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }, [])

  const commit = useCallback(() => {
    const parsed = parseFloat(text)
    if (!Number.isNaN(parsed)) {
      let v = parsed
      if (min !== undefined) v = Math.max(min, v)
      if (max !== undefined) v = Math.min(max, v)
      onChange(v)
    }
    setIsEditing(false)
  }, [text, min, max, onChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commit()
      else if (e.key === 'Escape') {
        setText(roundDisplay(value))
        setIsEditing(false)
      }
    },
    [commit, value]
  )

  return (
    <div className={s.kfValueRow}>
      {label && <span className={s.kfValueLabel}>{label}</span>}
      {isEditing ? (
        <input
          ref={inputRef}
          type="number"
          className={`${s.kfValueInput} ${s.editing}`}
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          step={step}
        />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: scrub input uses pointer drag
        <div
          className={`${s.kfValueInput} ${s.scrub}`}
          onPointerDown={handlePointerDown}
          onClick={handleClick}
          title="Drag to scrub · click to type"
        >
          {text}
        </div>
      )}
    </div>
  )
}

// RGBA editor — colour swatch + per-channel scrub inputs
// Values are stored as 0–1 for all channels (Theatre.js convention)
function RGBAEditor({ value, onChange }: { value: RGBA; onChange: (v: RGBA) => void }) {
  // Convert 0-1 float to two-digit hex byte
  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0')

  const hexColor = `#${toHex(value.r)}${toHex(value.g)}${toHex(value.b)}`

  const handleColorInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    onChange({ ...value, r, g, b })
  }

  return (
    <>
      <div className={s.kfRgbaSwatchRow}>
        <input
          type="color"
          className={s.kfColorInput}
          value={hexColor}
          onChange={handleColorInput}
          title="Pick colour"
        />
        <span className={s.kfValueLabel} style={{ flex: 1 }}>
          Colour
        </span>
      </div>
      <ScrubInput
        label="R"
        value={value.r}
        min={0}
        max={1}
        step={0.004}
        onChange={r => onChange({ ...value, r })}
      />
      <ScrubInput
        label="G"
        value={value.g}
        min={0}
        max={1}
        step={0.004}
        onChange={g => onChange({ ...value, g })}
      />
      <ScrubInput
        label="B"
        value={value.b}
        min={0}
        max={1}
        step={0.004}
        onChange={b => onChange({ ...value, b })}
      />
      <ScrubInput
        label="A"
        value={value.a}
        min={0}
        max={1}
        step={0.01}
        onChange={a => onChange({ ...value, a })}
      />
    </>
  )
}

export function KeyframeValuePopup({
  trackId,
  keyframe,
  anchorX,
  anchorY,
  onClose,
}: KeyframeValuePopupProps) {
  const sequence = useTimelineStore(state => state.sequence)
  const liveKeyframe = useTimelineStore(
    state => state.tracks.get(trackId)?.keyframes.find(k => k.id === keyframe.id) ?? keyframe
  )

  const popupRef = useRef<HTMLDivElement>(null)
  const beforeStateRef = useRef(captureTimelineState())
  const hasChangedRef = useRef(false)

  const valueType = detectValueType(liveKeyframe.value)
  const timeCode = formatTimeCode(liveKeyframe.position, sequence.fps)

  const handleClose = useCallback(() => {
    if (hasChangedRef.current) {
      fireTimelineMutation('Edit keyframe value', beforeStateRef.current)
    }
    onClose()
  }, [onClose])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleClose])

  const style = useMemo(() => {
    const margin = 8
    let left = anchorX - POPUP_WIDTH / 2
    let top = anchorY - POPUP_HEIGHT_EST - 8
    if (left < margin) left = margin
    if (left + POPUP_WIDTH > window.innerWidth - margin) {
      left = window.innerWidth - POPUP_WIDTH - margin
    }
    // Flip below diamond if too close to top of viewport
    if (top < margin) top = anchorY + 20
    return { left, top, width: POPUP_WIDTH }
  }, [anchorX, anchorY])

  const handleValueChange = useCallback(
    (newValue: KeyframeValue) => {
      hasChangedRef.current = true

      // Update keyframe in timeline store
      useTimelineStore.getState().updateKeyframe(trackId, keyframe.id, { value: newValue })

      // Re-evaluate timeline at current position and apply to field
      const timelineStore = useTimelineStore.getState()
      const currentPosition = timelineStore.position
      const evaluatedValue = timelineStore.evaluateTrack(trackId, currentPosition)

      if (evaluatedValue !== undefined) {
        const fieldInfo = getFieldFromTrackPath(trackId)

        if (fieldInfo && !fieldInfo.operator.locked?.value) {
          const { field, subPath } = fieldInfo

          // Handle vec/point channel updates (e.g., "position / x")
          if (
            subPath &&
            subPath.length > 0 &&
            (field instanceof Vec2Field ||
              field instanceof Vec3Field ||
              field instanceof Point2DField ||
              field instanceof Point3DField)
          ) {
            const channelKey = subPath[0]
            const channelValue = evaluatedValue as number

            // Update specific channel while preserving others
            if (field.returnType === 'tuple') {
              const channelKeys = (field.constructor as typeof Vec2Field).channelKeys
              const idx = channelKeys.indexOf(channelKey as (typeof channelKeys)[number])
              const tuple = [...(field.value as number[])]
              tuple[idx] = channelValue
              field.setValue(tuple as any)
            } else {
              field.setValue({ ...field.value, [channelKey]: channelValue } as any)
            }
          } else {
            // Regular field update (not a vec/point channel)
            const fieldValue = keyframeValueToFieldValue(field, evaluatedValue)
            if (fieldValue !== undefined) {
              field.setValue(fieldValue)
            }
          }
        }
      }
    },
    [trackId, keyframe.id]
  )

  const handlePopupKeyDownCapture = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Keep timeline-level keyframe deletion shortcuts from firing while editing popup values.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation()
    }
  }, [])

  const renderEditor = () => {
    const v = liveKeyframe.value
    switch (valueType) {
      case 'number':
        return (
          <ScrubInput
            label=""
            value={v as number}
            step={0.01}
            onChange={n => handleValueChange(n)}
          />
        )
      case 'boolean':
        return (
          <div className={s.kfValueRow}>
            <span className={s.kfValueLabel}>Value</span>
            <label className={s.kfBooleanToggle}>
              <input
                type="checkbox"
                checked={v as boolean}
                onChange={e => handleValueChange(e.target.checked)}
              />
              <span className={s.kfBooleanLabel}>{(v as boolean) ? 'True' : 'False'}</span>
            </label>
          </div>
        )
      case 'string':
        return (
          <div className={s.kfValueRow}>
            <span className={s.kfValueLabel}>Value</span>
            <input
              type="text"
              className={`${s.kfValueInput} ${s.editing}`}
              value={v as string}
              onChange={e => handleValueChange(e.target.value)}
            />
          </div>
        )
      case 'rgba':
        return <RGBAEditor value={v as RGBA} onChange={handleValueChange} />
      case 'vec2': {
        const vec = v as Vec2
        return (
          <>
            <ScrubInput
              label="X"
              value={vec.x}
              step={0.01}
              onChange={x => handleValueChange({ ...vec, x })}
            />
            <ScrubInput
              label="Y"
              value={vec.y}
              step={0.01}
              onChange={y => handleValueChange({ ...vec, y })}
            />
          </>
        )
      }
      case 'vec3': {
        const vec = v as Vec3
        return (
          <>
            <ScrubInput
              label="X"
              value={vec.x}
              step={0.01}
              onChange={x => handleValueChange({ ...vec, x })}
            />
            <ScrubInput
              label="Y"
              value={vec.y}
              step={0.01}
              onChange={y => handleValueChange({ ...vec, y })}
            />
            <ScrubInput
              label="Z"
              value={vec.z}
              step={0.01}
              onChange={z => handleValueChange({ ...vec, z })}
            />
          </>
        )
      }
      case 'point2d': {
        const pt = v as Point2D
        return (
          <>
            <ScrubInput
              label="Lng"
              value={pt.lng}
              step={0.0001}
              onChange={lng => handleValueChange({ ...pt, lng })}
            />
            <ScrubInput
              label="Lat"
              value={pt.lat}
              step={0.0001}
              onChange={lat => handleValueChange({ ...pt, lat })}
            />
          </>
        )
      }
      case 'point3d': {
        const pt = v as Point3D
        return (
          <>
            <ScrubInput
              label="Lng"
              value={pt.lng}
              step={0.0001}
              onChange={lng => handleValueChange({ ...pt, lng })}
            />
            <ScrubInput
              label="Lat"
              value={pt.lat}
              step={0.0001}
              onChange={lat => handleValueChange({ ...pt, lat })}
            />
            <ScrubInput
              label="Alt"
              value={pt.alt}
              step={1}
              onChange={alt => handleValueChange({ ...pt, alt })}
            />
          </>
        )
      }
      default:
        return <div className={s.kfValueUnknown}>No editor for this value type</div>
    }
  }

  return createPortal(
    <div
      ref={popupRef}
      className={s.keyframeValuePopup}
      style={style}
      onKeyDownCapture={handlePopupKeyDownCapture}
    >
      <div className={s.kfPopupHeader}>
        <span className={s.kfPopupTimecode}>{timeCode}</span>
        <button type="button" className={s.kfPopupClose} onClick={handleClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className={s.kfPopupBody}>{renderEditor()}</div>
    </div>,
    document.body
  )
}
