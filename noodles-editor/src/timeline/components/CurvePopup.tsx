// Popup for editing bezier easing between two keyframes
// Shows preset library with hover preview and inline bezier handle editor

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EASING_PRESETS, findMatchingPreset } from '../easing-presets'
import { evaluateCubicBezier } from '../interpolation'
import {
  captureTimelineState,
  fireTimelineMutation,
  getTimelineStore,
  useTimelineStore,
} from '../timeline-store'
import type { BezierHandles, InterpolationType, Keyframe } from '../types'
import s from './TimelinePanel.module.css'

export interface CurvePopupProps {
  trackId: string
  k1: Keyframe
  k2: Keyframe
  anchorX: number
  anchorY: number
  onClose: () => void
  // When true, applying a curve updates all selected keyframes instead of just k1
  applyToSelected?: boolean
}

const POPUP_WIDTH = 420
const POPUP_HEIGHT = 300
const CURVE_WIDTH = 240
const CURVE_HEIGHT = 200

// Preset item that can represent either a bezier curve or hold/linear
interface PresetItem {
  name: string
  interpolation: InterpolationType
  handles: BezierHandles
}

// Build full preset list: Hold at top, then all bezier presets
const ALL_PRESETS: PresetItem[] = [
  // Hold (step function)
  {
    name: 'Hold',
    interpolation: 'hold',
    handles: { left: [0, 0], right: [1, 0], type: 'aligned' as const },
  },
  // All bezier presets
  ...EASING_PRESETS.map(p => ({
    name: p.name,
    interpolation: 'bezier' as InterpolationType,
    handles: p.handles,
  })),
]

// Generate SVG polyline path by sampling the bezier curve
function generatePath(handles: BezierHandles, w: number, h: number, pad: number): string {
  const steps = 60
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = evaluateCubicBezier(t, 0, handles.left[0], handles.right[0], 1)
    const y = evaluateCubicBezier(t, 0, handles.left[1], handles.right[1], 1)
    const px = pad + x * (w - pad * 2)
    const py = h - pad - y * (h - pad * 2)
    pts.push(`${i === 0 ? 'M' : 'L'} ${px} ${py}`)
  }
  return pts.join(' ')
}

// Generate a "hold" step function path
function generateHoldPath(w: number, h: number, pad: number): string {
  const x0 = pad
  const x1 = w - pad
  const y0 = h - pad // bottom (start value)
  const y1 = pad // top (end value)
  // Flat line at start value, then step up at end
  return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1}`
}

// Small curve preview for preset buttons
function PresetPreview({ preset, isSelected }: { preset: PresetItem; isSelected: boolean }) {
  const path = useMemo(() => {
    if (preset.interpolation === 'hold') {
      return generateHoldPath(44, 32, 4)
    }
    return generatePath(preset.handles, 44, 32, 4)
  }, [preset])

  return (
    <svg width={44} height={32} aria-hidden="true">
      <path d={path} fill="none" stroke={isSelected ? '#48c6cf' : '#667'} strokeWidth={1.5} />
    </svg>
  )
}

// Bezier curve editor used inline in the popup
function InlineCurveEditor({
  handles,
  onHandlesChange,
  onHandlesCommit,
}: {
  handles: BezierHandles
  onHandlesChange: (h: BezierHandles) => void
  onHandlesCommit: () => void
}) {
  const pad = 20
  const w = CURVE_WIDTH
  const h = CURVE_HEIGHT

  function toPixel(nx: number, ny: number) {
    return { x: pad + nx * (w - pad * 2), y: h - pad - ny * (h - pad * 2) }
  }

  const toNorm = useCallback(
    (px: number, py: number) => ({
      x: (px - pad) / (w - pad * 2),
      y: (h - pad - py) / (h - pad * 2),
    }),
    [h, w]
  )

  const curvePath = useMemo(() => generatePath(handles, w, h, pad), [handles, h, w])
  const start = toPixel(0, 0)
  const end = toPixel(1, 1)
  const lh = toPixel(handles.left[0], handles.left[1])
  const rh = toPixel(handles.right[0], handles.right[1])

  const dragHandle = useCallback(
    (side: 'left' | 'right', startEvent: React.PointerEvent<SVGCircleElement>) => {
      startEvent.preventDefault()
      startEvent.stopPropagation()
      startEvent.currentTarget.setPointerCapture(startEvent.pointerId)
      const svgEl = startEvent.currentTarget.closest('svg') as SVGSVGElement
      if (!svgEl) return

      const startHandles = { ...handles }

      const handleMove = (e: PointerEvent) => {
        const rect = svgEl.getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const norm = toNorm(px, py)

        let newLeft = startHandles.left
        let newRight = startHandles.right

        if (side === 'left') {
          newLeft = [Math.max(0, Math.min(1, norm.x)), norm.y] as [number, number]
        } else {
          newRight = [Math.max(0, Math.min(1, norm.x)), norm.y] as [number, number]
        }

        const updated: BezierHandles = { left: newLeft, right: newRight, type: 'free' }
        onHandlesChange(updated)
      }

      const handleUp = () => {
        onHandlesCommit()
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [handles, onHandlesChange, onHandlesCommit, toNorm]
  )

  return (
    <svg
      width={w}
      height={h}
      style={{ display: 'block', background: '#171d27', borderRadius: 4 }}
      aria-label="Bezier curve editor"
    >
      <title>Bezier curve editor</title>
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map(v => {
        const xp = pad + v * (w - pad * 2)
        const yp = pad + v * (h - pad * 2)
        return (
          <g key={v}>
            <line
              x1={xp}
              y1={pad}
              x2={xp}
              y2={h - pad}
              stroke="#2a3445"
              strokeWidth={v === 0 || v === 1 ? 1 : 0.5}
            />
            <line
              x1={pad}
              y1={yp}
              x2={w - pad}
              y2={yp}
              stroke="#2a3445"
              strokeWidth={v === 0 || v === 1 ? 1 : 0.5}
            />
          </g>
        )
      })}
      {/* Handle lines */}
      <line
        x1={start.x}
        y1={start.y}
        x2={lh.x}
        y2={lh.y}
        stroke="#556"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      <line
        x1={end.x}
        y1={end.y}
        x2={rh.x}
        y2={rh.y}
        stroke="#556"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      {/* Curve */}
      <path d={curvePath} fill="none" stroke="#48c6cf" strokeWidth={2} />
      {/* Endpoints */}
      <circle cx={start.x} cy={start.y} r={4} fill="#48c6cf" />
      <circle cx={end.x} cy={end.y} r={4} fill="#48c6cf" />
      {/* Draggable handles */}
      <circle
        cx={lh.x}
        cy={lh.y}
        r={6}
        fill="#ff6b6b"
        stroke="#ff9999"
        strokeWidth={1.5}
        style={{ cursor: 'grab' }}
        onPointerDown={e => dragHandle('left', e)}
      />
      <circle
        cx={rh.x}
        cy={rh.y}
        r={6}
        fill="#51cf66"
        stroke="#82e6a0"
        strokeWidth={1.5}
        style={{ cursor: 'grab' }}
        onPointerDown={e => dragHandle('right', e)}
      />
    </svg>
  )
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000
}

function formatCubicBezier(handles: BezierHandles): string {
  return `cubic-bezier(${round3(handles.left[0])}, ${round3(handles.left[1])}, ${round3(handles.right[0])}, ${round3(handles.right[1])})`
}

function clampX(n: number) {
  return Math.max(0, Math.min(1, n))
}

function parseCubicBezier(text: string): BezierHandles | null {
  // Try cubic-bezier(x1, y1, x2, y2) format
  const cbMatch = text.match(
    /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i
  )
  if (cbMatch) {
    const nums = [cbMatch[1], cbMatch[2], cbMatch[3], cbMatch[4]].map(parseFloat)
    if (!nums.some(isNaN)) {
      return {
        left: [clampX(nums[0]), nums[1]] as [number, number],
        right: [clampX(nums[2]), nums[3]] as [number, number],
        type: 'free',
      }
    }
  }
  // Try bare "x1, y1, x2, y2" format
  const parts = text.split(',').map(str => parseFloat(str.trim()))
  if (parts.length === 4 && !parts.some(isNaN)) {
    return {
      left: [clampX(parts[0]), parts[1]] as [number, number],
      right: [clampX(parts[2]), parts[3]] as [number, number],
      type: 'free',
    }
  }
  return null
}

// x1/y1/x2/y2 number inputs
function CoordEditor({
  handles,
  disabled,
  onHandlesChange,
  onHandlesCommit,
}: {
  handles: BezierHandles
  disabled: boolean
  onHandlesChange: (h: BezierHandles) => void
  onHandlesCommit: () => void
}) {
  const [vals, setVals] = useState(() => ({
    x1: String(round3(handles.left[0])),
    y1: String(round3(handles.left[1])),
    x2: String(round3(handles.right[0])),
    y2: String(round3(handles.right[1])),
  }))
  const focusedRef = useRef(false)

  // Sync from external handle changes (drag) when no input is focused
  useEffect(() => {
    if (!focusedRef.current) {
      setVals({
        x1: String(round3(handles.left[0])),
        y1: String(round3(handles.left[1])),
        x2: String(round3(handles.right[0])),
        y2: String(round3(handles.right[1])),
      })
    }
  }, [handles])

  function applyVal(key: 'x1' | 'y1' | 'x2' | 'y2', raw: string) {
    const num = parseFloat(raw)
    if (isNaN(num)) return
    const isX = key === 'x1' || key === 'x2'
    const val = isX ? clampX(num) : num
    const next = { ...handles }
    if (key === 'x1') next.left = [val, handles.left[1]]
    else if (key === 'y1') next.left = [handles.left[0], val]
    else if (key === 'x2') next.right = [val, handles.right[1]]
    else next.right = [handles.right[0], val]
    next.type = 'free'
    onHandlesChange(next)
    onHandlesCommit()
  }

  const coords: { label: string; key: 'x1' | 'y1' | 'x2' | 'y2' }[] = [
    { label: 'x1', key: 'x1' },
    { label: 'y1', key: 'y1' },
    { label: 'x2', key: 'x2' },
    { label: 'y2', key: 'y2' },
  ]

  return (
    <div className={s.curvePopupCoordEditor}>
      <div className={s.curvePopupCoordGrid}>
        {coords.map(({ label, key }) => (
          <div key={key} className={s.curvePopupCoordField}>
            <span className={s.curvePopupCoordLabel}>{label}</span>
            <input
              type="number"
              className={s.curvePopupCoordInput}
              value={vals[key]}
              step={0.001}
              disabled={disabled}
              onChange={e => setVals(v => ({ ...v, [key]: e.target.value }))}
              onFocus={() => { focusedRef.current = true }}
              onBlur={e => {
                focusedRef.current = false
                applyVal(key, e.target.value)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  applyVal(key, (e.target as HTMLInputElement).value)
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export function CurvePopup({
  trackId,
  k1,
  k2: _k2,
  anchorX,
  anchorY,
  onClose,
  applyToSelected = false,
}: CurvePopupProps) {
  const updateKeyframe = useTimelineStore(state => state.updateKeyframe)
  const setKeyframeHandles = useTimelineStore(state => state.setKeyframeHandles)
  const track = useTimelineStore(state => state.tracks.get(trackId))
  const selectedCount = useTimelineStore(state =>
    applyToSelected ? state.selectedKeyframeIds.size : 0
  )

  // Get current k1 from store (may have been updated)
  const currentK1 = track?.keyframes.find(kf => kf.id === k1.id) ?? k1

  // Store the original state on mount — will restore if closed without commit
  const originalStateRef = useRef<string>(captureTimelineState())
  const committedRef = useRef(false)
  const popupRef = useRef<HTMLDivElement>(null)

  // Current displayed handles (for the editor)
  const activeHandles: BezierHandles = currentK1.handles ?? {
    left: [0.33, 0.33],
    right: [0.67, 0.67],
    type: 'aligned',
  }

  const disabled = currentK1.interpolation === 'hold'

  // Find matching preset based on current keyframe state
  const matchingPreset = useMemo(() => {
    if (currentK1.interpolation === 'hold') {
      return ALL_PRESETS.find(p => p.interpolation === 'hold')
    }
    const bezierMatch = findMatchingPreset(activeHandles)
    if (bezierMatch) {
      return ALL_PRESETS.find(p => p.name === bezierMatch.name)
    }
    return null
  }, [currentK1.interpolation, activeHandles])

  // Edit input (cubic-bezier text, shown via pencil toggle)
  const [showEdit, setShowEdit] = useState(false)
  const [editText, setEditText] = useState(() => formatCubicBezier(activeHandles))
  const editFocusedRef = useRef(false)

  useEffect(() => {
    if (!editFocusedRef.current) {
      setEditText(formatCubicBezier(activeHandles))
    }
  }, [activeHandles])

  function applyEditText(text: string) {
    const parsed = parseCubicBezier(text)
    if (parsed) {
      handleHandlesChange(parsed)
      handleHandlesCommit()
    } else {
      setEditText(formatCubicBezier(activeHandles))
    }
  }

  // Restore original state on close if not committed
  const handleClose = useCallback(() => {
    if (!committedRef.current) {
      // Restore original state (ephemeral preview was not committed)
      // keepPosition: true preserves the playhead since fromTheatreJSON always resets it to 0
      const originalData = JSON.parse(originalStateRef.current)
      useTimelineStore.getState().fromTheatreJSON(originalData, { keepPosition: true })
    }
    onClose()
  }, [onClose])

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [handleClose])

  // Position popup: prefer below and to the right of anchor, but keep in viewport
  const style = useMemo(() => {
    const margin = 8
    let left = anchorX
    let top = anchorY + 8
    if (left + POPUP_WIDTH > window.innerWidth - margin) {
      left = window.innerWidth - POPUP_WIDTH - margin
    }
    if (top + POPUP_HEIGHT > window.innerHeight - margin) {
      top = anchorY - POPUP_HEIGHT - 8
    }
    return { left, top, width: POPUP_WIDTH }
  }, [anchorX, anchorY])

  // Hover: apply preset ephemerally (no history)
  const handlePresetHover = useCallback(
    (preset: PresetItem) => {
      updateKeyframe(trackId, k1.id, { interpolation: preset.interpolation })
      if (preset.interpolation === 'bezier') {
        setKeyframeHandles(trackId, k1.id, preset.handles)
      }
    },
    [trackId, k1.id, updateKeyframe, setKeyframeHandles]
  )

  // Leave hover: restore original (if not committed yet)
  const handlePresetLeave = useCallback(() => {
    if (!committedRef.current) {
      // keepPosition: true preserves the playhead since fromTheatreJSON always resets it to 0
      const originalData = JSON.parse(originalStateRef.current)
      useTimelineStore.getState().fromTheatreJSON(originalData, { keepPosition: true })
    }
  }, [])

  // Click: commit preset with history
  const handlePresetClick = useCallback(
    (preset: PresetItem) => {
      if (applyToSelected) {
        // Apply to all selected keyframes across all tracks
        const store = getTimelineStore()
        store.applyEasingToSelectedKeyframes(
          preset.interpolation,
          preset.interpolation === 'bezier' ? preset.handles : undefined
        )
      } else {
        updateKeyframe(trackId, k1.id, { interpolation: preset.interpolation })
        if (preset.interpolation === 'bezier') {
          setKeyframeHandles(trackId, k1.id, preset.handles)
        }
      }
      fireTimelineMutation('Set easing curve', originalStateRef.current)
      committedRef.current = true
      onClose()
    },
    [applyToSelected, trackId, k1.id, updateKeyframe, setKeyframeHandles, onClose]
  )

  // Handle editor: live update (ephemeral)
  const handleHandlesChange = useCallback(
    (h: BezierHandles) => {
      updateKeyframe(trackId, k1.id, { interpolation: 'bezier' })
      setKeyframeHandles(trackId, k1.id, h)
    },
    [trackId, k1.id, updateKeyframe, setKeyframeHandles]
  )

  // Handle editor commit: fire history
  const handleHandlesCommit = useCallback(() => {
    if (applyToSelected) {
      // Propagate the edited k1 handles to all selected keyframes
      const store = getTimelineStore()
      const currentHandles = store.tracks
        .get(trackId)
        ?.keyframes.find(kf => kf.id === k1.id)?.handles
      if (currentHandles) {
        store.applyEasingToSelectedKeyframes('bezier', currentHandles)
      }
    }
    fireTimelineMutation('Adjust bezier handles', originalStateRef.current)
    originalStateRef.current = captureTimelineState()
    committedRef.current = true
  }, [applyToSelected, trackId, k1.id])

  return createPortal(
    <div ref={popupRef} className={s.curvePopup} style={style}>
      {applyToSelected && selectedCount > 1 && (
        <div className={s.curvePopupMultiHint}>Applying to {selectedCount} keyframes</div>
      )}
      <div className={s.curvePopupBody}>
        {/* Left: preset list */}
        <div className={s.curvePopupPresets}>
          {/* Custom entry — active when curve doesn't match any preset */}
          <div
            className={`${s.curvePopupPresetItem} ${s.curvePopupCustomItem} ${!matchingPreset && currentK1.interpolation !== 'hold' ? s.active : ''}`}
            title="Custom bezier curve"
          >
            <PresetPreview
              preset={{ name: 'Custom', interpolation: 'bezier', handles: activeHandles }}
              isSelected={!matchingPreset && currentK1.interpolation !== 'hold'}
            />
            <span className={s.curvePopupPresetName}>Custom</span>
          </div>
          {ALL_PRESETS.map(preset => (
            <button
              key={preset.name}
              type="button"
              className={`${s.curvePopupPresetItem} ${matchingPreset?.name === preset.name ? s.active : ''}`}
              onMouseEnter={() => handlePresetHover(preset)}
              onMouseLeave={handlePresetLeave}
              onClick={() => handlePresetClick(preset)}
              title={preset.name}
            >
              <PresetPreview preset={preset} isSelected={matchingPreset?.name === preset.name} />
              <span className={s.curvePopupPresetName}>{preset.name}</span>
            </button>
          ))}
        </div>

        {/* Right: bezier curve editor */}
        <div className={s.curvePopupEditor}>
          <InlineCurveEditor
            handles={activeHandles}
            onHandlesChange={handleHandlesChange}
            onHandlesCommit={handleHandlesCommit}
          />
          <div className={s.curvePopupEditorHeader} data-testid="preset-label">
            <span className={s.curvePopupPresetLabelText}>
              {disabled ? 'Hold' : matchingPreset ? matchingPreset.name : 'Custom'}
            </span>
            <button
              type="button"
              className={`${s.curvePopupIconBtn} ${showEdit ? s.active : ''}`}
              disabled={disabled}
              title={showEdit ? 'Hide edit field' : 'Edit cubic-bezier value'}
              onClick={() => setShowEdit(v => !v)}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M8 1.5L9.5 3L4 8.5H2.5V7L8 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
            <button
              type="button"
              className={s.curvePopupIconBtn}
              disabled={disabled}
              title="Copy cubic-bezier value"
              onClick={() => navigator.clipboard.writeText(formatCubicBezier(activeHandles))}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                <path d="M2 9H1.5A1.5 1.5 0 0 1 0 7.5v-6A1.5 1.5 0 0 1 1.5 0h6A1.5 1.5 0 0 1 9 1.5V2" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
            </button>
          </div>
          {showEdit && (
            <input
              type="text"
              className={s.curvePopupEditInput}
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onFocus={e => {
                editFocusedRef.current = true
                e.target.select()
              }}
              onBlur={e => {
                editFocusedRef.current = false
                applyEditText(e.target.value)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  applyEditText((e.target as HTMLInputElement).value)
                  ;(e.target as HTMLInputElement).blur()
                }
                if (e.key === 'Escape') setShowEdit(false)
              }}
            />
          )}
          <CoordEditor
            handles={activeHandles}
            disabled={disabled}
            onHandlesChange={handleHandlesChange}
            onHandlesCommit={handleHandlesCommit}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
