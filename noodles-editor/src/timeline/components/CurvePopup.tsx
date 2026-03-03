// Popup for editing bezier easing between two keyframes
// Shows interpolation type selector, preset library, and bezier handle editor

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EASING_PRESETS, findMatchingPreset } from '../easing-presets'
import { evaluateCubicBezier } from '../interpolation'
import { captureTimelineState, fireTimelineMutation, useTimelineStore } from '../timeline-store'
import type { BezierHandles, InterpolationType, Keyframe } from '../types'

export interface CurvePopupProps {
  trackId: string
  k1: Keyframe
  k2: Keyframe
  anchorX: number
  anchorY: number
  onClose: () => void
}

const POPUP_WIDTH = 420
const POPUP_HEIGHT = 300
const CURVE_WIDTH = 240
const CURVE_HEIGHT = 200

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

// Small curve preview for preset buttons
function PresetPreview({ handles, isSelected }: { handles: BezierHandles; isSelected: boolean }) {
  const path = useMemo(() => generatePath(handles, 44, 32, 4), [handles])
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
  onHandlesCommit: (h: BezierHandles) => void
}) {
  const pad = 20
  const w = CURVE_WIDTH
  const h = CURVE_HEIGHT

  function toPixel(nx: number, ny: number) {
    return { x: pad + nx * (w - pad * 2), y: h - pad - ny * (h - pad * 2) }
  }

  function toNorm(px: number, py: number) {
    return {
      x: (px - pad) / (w - pad * 2),
      y: (h - pad - py) / (h - pad * 2),
    }
  }

  const curvePath = useMemo(() => generatePath(handles, w, h, pad), [handles])
  const start = toPixel(0, 0)
  const end = toPixel(1, 1)
  const lh = toPixel(handles.left[0], handles.left[1])
  const rh = toPixel(handles.right[0], handles.right[1])

  const dragHandle = useCallback(
    (
      side: 'left' | 'right',
      startEvent: React.PointerEvent<SVGCircleElement>
    ) => {
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
        onHandlesCommit(handles)
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
    },
    [handles, onHandlesChange, onHandlesCommit]
  )

  return (
    <svg
      width={w}
      height={h}
      style={{ display: 'block', background: '#171d27', borderRadius: 4 }}
      aria-label="Bezier curve editor"
    >
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map(v => {
        const xp = pad + v * (w - pad * 2)
        const yp = pad + v * (h - pad * 2)
        return (
          <g key={v}>
            <line x1={xp} y1={pad} x2={xp} y2={h - pad} stroke="#2a3445" strokeWidth={v === 0 || v === 1 ? 1 : 0.5} />
            <line x1={pad} y1={yp} x2={w - pad} y2={yp} stroke="#2a3445" strokeWidth={v === 0 || v === 1 ? 1 : 0.5} />
          </g>
        )
      })}
      {/* Handle lines */}
      <line x1={start.x} y1={start.y} x2={lh.x} y2={lh.y} stroke="#556" strokeWidth={1} strokeDasharray="3 2" />
      <line x1={end.x} y1={end.y} x2={rh.x} y2={rh.y} stroke="#556" strokeWidth={1} strokeDasharray="3 2" />
      {/* Curve */}
      <path d={curvePath} fill="none" stroke="#48c6cf" strokeWidth={2} />
      {/* Endpoints */}
      <circle cx={start.x} cy={start.y} r={4} fill="#48c6cf" />
      <circle cx={end.x} cy={end.y} r={4} fill="#48c6cf" />
      {/* Draggable handles */}
      <circle
        cx={lh.x} cy={lh.y} r={6}
        fill="#ff6b6b"
        stroke="#ff9999"
        strokeWidth={1.5}
        style={{ cursor: 'grab' }}
        onPointerDown={e => dragHandle('left', e)}
      />
      <circle
        cx={rh.x} cy={rh.y} r={6}
        fill="#51cf66"
        stroke="#82e6a0"
        strokeWidth={1.5}
        style={{ cursor: 'grab' }}
        onPointerDown={e => dragHandle('right', e)}
      />
    </svg>
  )
}

export function CurvePopup({ trackId, k1, k2: _k2, anchorX, anchorY, onClose }: CurvePopupProps) {
  const updateKeyframe = useTimelineStore(state => state.updateKeyframe)
  const setKeyframeHandles = useTimelineStore(state => state.setKeyframeHandles)
  const track = useTimelineStore(state => state.tracks.get(trackId))

  // Get current k1 from store (may have been updated)
  const currentK1 = track?.keyframes.find(kf => kf.id === k1.id) ?? k1

  const [interpolation, setInterpolation] = useState<InterpolationType>(currentK1.interpolation)
  const [previewHandles, setPreviewHandles] = useState<BezierHandles | null>(null)
  const beforeStateRef = useRef<string>(captureTimelineState())
  const popupRef = useRef<HTMLDivElement>(null)

  const activeHandles: BezierHandles = previewHandles ?? currentK1.handles ?? {
    left: [0.33, 0.33],
    right: [0.67, 0.67],
    type: 'aligned',
  }

  const matchingPreset = useMemo(() => findMatchingPreset(activeHandles), [activeHandles])

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

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

  const applyInterpolationType = useCallback(
    (type: InterpolationType) => {
      setInterpolation(type)
      updateKeyframe(trackId, k1.id, { interpolation: type })
      if (type !== 'bezier') {
        fireTimelineMutation('Set interpolation type', beforeStateRef.current)
        onClose()
      }
    },
    [trackId, k1.id, updateKeyframe, onClose]
  )

  const applyPreset = useCallback(
    (preset: (typeof EASING_PRESETS)[number]) => {
      setKeyframeHandles(trackId, k1.id, preset.handles)
      updateKeyframe(trackId, k1.id, { interpolation: 'bezier' })
      fireTimelineMutation('Set easing curve', beforeStateRef.current)
      onClose()
    },
    [trackId, k1.id, setKeyframeHandles, updateKeyframe, onClose]
  )

  const handleHandlesChange = useCallback((h: BezierHandles) => {
    setPreviewHandles(h)
    // Live update without committing to history yet
    useTimelineStore.getState().setKeyframeHandles(trackId, k1.id, h)
  }, [trackId, k1.id])

  const handleHandlesCommit = useCallback((_h: BezierHandles) => {
    setPreviewHandles(null)
    fireTimelineMutation('Adjust bezier handles', beforeStateRef.current)
    beforeStateRef.current = captureTimelineState()
  }, [])

  return createPortal(
    <div ref={popupRef} className="curve-popup" style={style}>
      {/* Interpolation type selector */}
      <div className="curve-popup-type-bar">
        {(['linear', 'hold', 'bezier'] as InterpolationType[]).map(type => (
          <button
            key={type}
            type="button"
            className={`curve-popup-type-btn ${interpolation === type ? 'active' : ''}`}
            onClick={() => applyInterpolationType(type)}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Bezier editor section */}
      {interpolation === 'bezier' && (
        <div className="curve-popup-body">
          {/* Left: preset list */}
          <div className="curve-popup-presets">
            {EASING_PRESETS.map(preset => (
              <button
                key={preset.name}
                type="button"
                className={`curve-popup-preset-item ${matchingPreset?.name === preset.name ? 'active' : ''}`}
                onMouseEnter={() => setPreviewHandles(preset.handles)}
                onMouseLeave={() => setPreviewHandles(null)}
                onClick={() => applyPreset(preset)}
                title={preset.name}
              >
                <PresetPreview
                  handles={preset.handles}
                  isSelected={matchingPreset?.name === preset.name}
                />
                <span className="curve-popup-preset-name">{preset.name}</span>
              </button>
            ))}
          </div>

          {/* Right: bezier curve editor */}
          <div className="curve-popup-editor">
            <InlineCurveEditor
              handles={activeHandles}
              onHandlesChange={handleHandlesChange}
              onHandlesCommit={handleHandlesCommit}
            />
            <div className="curve-popup-preset-label">
              {matchingPreset ? matchingPreset.name : 'Custom'}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
