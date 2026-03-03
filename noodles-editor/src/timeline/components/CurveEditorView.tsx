// Curve editor view — shows the value or speed graph for the selected track
// Replaces the keyframe-dot area when curve editor mode is active

import { useCallback, useMemo, useRef } from 'react'
import { evaluateTrack } from '../interpolation'
import {
  captureTimelineState,
  fireTimelineMutation,
  getTimelineStore,
  useTimelineStore,
} from '../timeline-store'
import type { BezierHandles, Keyframe, KeyframeValue, Track } from '../types'
import { DEFAULT_BEZIER_HANDLES } from '../types'
import s from './TimelinePanel.module.css'

export interface CurveEditorViewProps {
  pixelsPerSecond: number
  timelineWidth: number
  sequenceLength: number
  mode: 'value' | 'speed'
  height: number
}

const SAMPLES = 200
const PAD_V = 14

function isNumericValue(v: KeyframeValue | undefined): v is number {
  return typeof v === 'number'
}

function isNumericTrack(track: Track): boolean {
  if (typeof track.defaultValue === 'number') return true
  return track.keyframes.some(kf => isNumericValue(kf.value))
}

// Round to a "nice" step given a range and target number of grid lines
function niceGridStep(range: number, targetCount: number): number {
  if (range === 0 || !isFinite(range)) return 1
  const rough = range / targetCount
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)))
  for (const factor of [1, 2, 5, 10]) {
    if (factor * magnitude >= rough) return factor * magnitude
  }
  return rough
}

export function CurveEditorView({
  pixelsPerSecond,
  timelineWidth,
  sequenceLength,
  mode,
  height,
}: CurveEditorViewProps) {
  const tracks = useTimelineStore(state => state.tracks)
  const selectedTrackIds = useTimelineStore(state => state.selectedTrackIds)
  const selectedKeyframeIds = useTimelineStore(state => state.selectedKeyframeIds)
  const selectKeyframe = useTimelineStore(state => state.selectKeyframe)
  const setPosition = useTimelineStore(state => state.setPosition)
  const position = useTimelineStore(state => state.position)

  const selectedTrackId = selectedTrackIds.size > 0 ? [...selectedTrackIds][0] : null
  const track = selectedTrackId ? tracks.get(selectedTrackId) : null

  const plotHeight = height - PAD_V * 2

  // ── Sample curve ──────────────────────────────────────────────────────────

  const { samples, minVal, maxVal } = useMemo(() => {
    if (!track || !isNumericTrack(track)) {
      return { samples: [] as number[], minVal: -1, maxVal: 1 }
    }

    const pts: number[] = []
    const dt = 0.001

    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * sequenceLength
      if (mode === 'value') {
        const v = evaluateTrack(track, t)
        pts.push(isNumericValue(v) ? v : 0)
      } else {
        const v1 = evaluateTrack(track, Math.max(0, t - dt))
        const v2 = evaluateTrack(track, Math.min(sequenceLength, t + dt))
        pts.push(
          isNumericValue(v1) && isNumericValue(v2) ? (v2 - v1) / (2 * dt) : 0
        )
      }
    }

    // Include keyframe values so range covers them
    if (mode === 'value') {
      for (const kf of track.keyframes) {
        if (isNumericValue(kf.value)) pts.push(kf.value)
      }
    }

    let lo = Math.min(...pts)
    let hi = Math.max(...pts)

    if (!isFinite(lo) || !isFinite(hi)) { lo = -1; hi = 1 }
    if (lo === hi) { lo -= 1; hi += 1 }

    const pad = (hi - lo) * 0.12
    return { samples: pts.slice(0, SAMPLES + 1), minVal: lo - pad, maxVal: hi + pad }
  }, [track, sequenceLength, mode])

  // ── Coordinate helpers ────────────────────────────────────────────────────

  const timeToX = useCallback((t: number) => t * pixelsPerSecond, [pixelsPerSecond])
  const xToTime = useCallback((x: number) => x / pixelsPerSecond, [pixelsPerSecond])
  const valToY = useCallback(
    (v: number) => PAD_V + plotHeight * (1 - (v - minVal) / (maxVal - minVal)),
    [minVal, maxVal, plotHeight]
  )
  const yToVal = useCallback(
    (y: number) => minVal + (1 - (y - PAD_V) / plotHeight) * (maxVal - minVal),
    [minVal, maxVal, plotHeight]
  )

  // ── Curve path ────────────────────────────────────────────────────────────

  const curvePath = useMemo(() => {
    if (!samples.length) return ''
    return samples
      .map((v, i) => {
        const x = timeToX((i / SAMPLES) * sequenceLength)
        const y = valToY(v)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [samples, sequenceLength, timeToX, valToY])

  // ── Grid lines ────────────────────────────────────────────────────────────

  const gridValues = useMemo(() => {
    const range = maxVal - minVal
    if (!isFinite(range) || range === 0) return []
    const step = niceGridStep(range, 4)
    const first = Math.ceil(minVal / step) * step
    const values: number[] = []
    for (let v = first; v <= maxVal + step * 0.01; v += step) {
      // Avoid floating-point noise
      const rounded = parseFloat(v.toPrecision(10))
      if (rounded >= minVal && rounded <= maxVal) values.push(rounded)
    }
    return values
  }, [minVal, maxVal])

  // ── Seek on background click ──────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return
      const rect = e.currentTarget.getBoundingClientRect()
      const t = Math.max(0, Math.min(sequenceLength, xToTime(e.clientX - rect.left)))
      setPosition(t)
    },
    [xToTime, sequenceLength, setPosition]
  )

  // ── Empty / non-numeric states ────────────────────────────────────────────

  if (!track) {
    return (
      <div className={s.timelineCurveView} style={{ width: timelineWidth, height }}>
        <div className={s.timelineEmpty}>Select a property to edit its curve</div>
      </div>
    )
  }

  if (!isNumericTrack(track)) {
    return (
      <div className={s.timelineCurveView} style={{ width: timelineWidth, height }}>
        <div className={s.timelineEmpty}>Only numeric properties can be shown in curve view</div>
      </div>
    )
  }

  const playX = timeToX(position)

  return (
    <div className={s.timelineCurveView} style={{ width: timelineWidth, height }}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG uses mousedown for seeking */}
      <svg
        width={timelineWidth}
        height={height}
        style={{ display: 'block' }}
        onMouseDown={handleMouseDown}
      >
        {/* Horizontal grid lines */}
        {gridValues.map((v, idx) => {
          const y = valToY(v)
          const isZero = Math.abs(v) < Math.abs(maxVal - minVal) * 0.001
          const label =
            Math.abs(v) >= 10000
              ? v.toExponential(1)
              : Math.abs(v) >= 1
                ? v.toFixed(0)
                : v.toPrecision(2)
          return (
            <g key={idx}>
              <line
                x1={0}
                y1={y}
                x2={timelineWidth}
                y2={y}
                stroke={isZero ? 'rgb(80 110 140/0.6)' : 'rgb(50 70 95/0.35)'}
                strokeWidth={isZero ? 1 : 0.5}
              />
              <text
                x={4}
                y={y - 3}
                fontSize={9}
                fill="rgb(100 125 155/0.65)"
                fontFamily="ui-monospace, Menlo, monospace"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {label}
              </text>
            </g>
          )
        })}

        {/* Curve */}
        {curvePath && (
          <path
            d={curvePath}
            fill="none"
            stroke="rgb(72 198 207/0.85)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Bezier handles for selected keyframes */}
        {track.keyframes.map((kf, i) => {
            if (!isNumericValue(kf.value)) return null
            if (!selectedKeyframeIds.has(kf.id)) return null
            // Show handles for any selected keyframe (not just bezier)
            // Dragging a handle will auto-set interpolation to bezier
            const nextKf = track.keyframes[i + 1]
            if (!nextKf || !isNumericValue(nextKf.value)) return null

            const handles = kf.handles ?? DEFAULT_BEZIER_HANDLES
            const Δt = nextKf.position - kf.position
            const Δv = (nextKf.value as number) - (kf.value as number)

            const kx = timeToX(kf.position)
            const ky = valToY(kf.value as number)
            const nkx = timeToX(nextKf.position)
            const nky = valToY(nextKf.value as number)
            const p1x = timeToX(kf.position + handles.left[0] * Δt)
            const p1y = valToY((kf.value as number) + handles.left[1] * Δv)
            const p2x = timeToX(kf.position + handles.right[0] * Δt)
            const p2y = valToY((kf.value as number) + handles.right[1] * Δv)

            return (
              <g key={`handles-${kf.id}`}>
                {/* Handle lines */}
                <line
                  x1={kx} y1={ky} x2={p1x} y2={p1y}
                  stroke="rgb(100 100 130/0.55)" strokeWidth={1} strokeDasharray="3 2"
                  style={{ pointerEvents: 'none' }}
                />
                <line
                  x1={nkx} y1={nky} x2={p2x} y2={p2y}
                  stroke="rgb(100 100 130/0.55)" strokeWidth={1} strokeDasharray="3 2"
                  style={{ pointerEvents: 'none' }}
                />
                {/* Left handle dot (P1) */}
                <BezierHandleDot
                  cx={p1x}
                  cy={p1y}
                  color="#ff6b6b"
                  strokeColor="#ff9999"
                  onDrag={(svgX, svgY) => {
                    const cur = getTimelineStore().tracks.get(track.id)?.keyframes.find(k => k.id === kf.id)
                    // Auto-set to bezier interpolation when dragging handles
                    if (cur?.interpolation !== 'bezier') {
                      getTimelineStore().updateKeyframe(track.id, kf.id, { interpolation: 'bezier' })
                    }
                    const curHandles = cur?.handles ?? DEFAULT_BEZIER_HANDLES
                    const newLx = Math.max(0, Math.min(1, (xToTime(svgX) - kf.position) / (Δt || 1)))
                    const newLy = (yToVal(svgY) - (kf.value as number)) / (Δv || 1)
                    getTimelineStore().setKeyframeHandles(track.id, kf.id, {
                      ...curHandles,
                      left: [newLx, newLy],
                      type: 'free',
                    })
                  }}
                  onDragEnd={before => fireTimelineMutation('Adjust bezier handles', before)}
                />
                {/* Right handle dot (P2) */}
                <BezierHandleDot
                  cx={p2x}
                  cy={p2y}
                  color="#51cf66"
                  strokeColor="#82e6a0"
                  onDrag={(svgX, svgY) => {
                    const cur = getTimelineStore().tracks.get(track.id)?.keyframes.find(k => k.id === kf.id)
                    // Auto-set to bezier interpolation when dragging handles
                    if (cur?.interpolation !== 'bezier') {
                      getTimelineStore().updateKeyframe(track.id, kf.id, { interpolation: 'bezier' })
                    }
                    const curHandles = cur?.handles ?? DEFAULT_BEZIER_HANDLES
                    const newRx = Math.max(0, Math.min(1, (xToTime(svgX) - kf.position) / (Δt || 1)))
                    const newRy = (yToVal(svgY) - (kf.value as number)) / (Δv || 1)
                    getTimelineStore().setKeyframeHandles(track.id, kf.id, {
                      ...curHandles,
                      right: [newRx, newRy],
                      type: 'free',
                    })
                  }}
                  onDragEnd={before => fireTimelineMutation('Adjust bezier handles', before)}
                />
              </g>
            )
          })}

        {/* Keyframe dots */}
        {track.keyframes.map(kf => {
          if (!isNumericValue(kf.value)) return null
          return (
            <CurveKeyframeDot
              key={kf.id}
              kf={kf}
              trackId={track.id}
              cx={timeToX(kf.position)}
              cy={valToY(kf.value as number)}
              isSelected={selectedKeyframeIds.has(kf.id)}
              mode={mode}
              sequenceLength={sequenceLength}
              xToTime={xToTime}
              yToVal={yToVal}
              onSelect={selectKeyframe}
            />
          )
        })}

        {/* Playhead */}
        <line
          x1={playX}
          y1={0}
          x2={playX}
          y2={height}
          stroke="rgb(89 213 220/0.8)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          style={{ pointerEvents: 'none' }}
        />
      </svg>
    </div>
  )
}

// ── BezierHandleDot ───────────────────────────────────────────────────────────

interface BezierHandleDotProps {
  cx: number
  cy: number
  color: string
  strokeColor: string
  onDrag: (svgX: number, svgY: number) => void
  onDragEnd: (beforeState: string) => void
}

function BezierHandleDot({ cx, cy, color, strokeColor, onDrag, onDragEnd }: BezierHandleDotProps) {
  const beforeRef = useRef('')

  const handlePointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation()
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const svgEl = el.closest('svg') as SVGSVGElement
    beforeRef.current = captureTimelineState()

    const handleMove = (me: PointerEvent) => {
      if (!svgEl) return
      const rect = svgEl.getBoundingClientRect()
      onDrag(me.clientX - rect.left, me.clientY - rect.top)
    }

    const handleUp = () => {
      onDragEnd(beforeRef.current)
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={color}
      stroke={strokeColor}
      strokeWidth={1.5}
      style={{ cursor: 'grab' }}
      onPointerDown={handlePointerDown}
    />
  )
}

// ── CurveKeyframeDot ──────────────────────────────────────────────────────────

interface CurveKeyframeDotProps {
  kf: Keyframe
  trackId: string
  cx: number
  cy: number
  isSelected: boolean
  mode: 'value' | 'speed'
  sequenceLength: number
  xToTime: (x: number) => number
  yToVal: (y: number) => number
  onSelect: (id: string, add?: boolean) => void
}

function CurveKeyframeDot({
  kf,
  trackId,
  cx,
  cy,
  isSelected,
  mode,
  sequenceLength,
  xToTime,
  yToVal,
  onSelect,
}: CurveKeyframeDotProps) {
  const isDraggingRef = useRef(false)
  const beforeRef = useRef('')

  const handlePointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const svgEl = el.closest('svg') as SVGSVGElement

    const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey
    if (!isSelected || addToSelection) onSelect(kf.id, addToSelection)

    isDraggingRef.current = false
    beforeRef.current = captureTimelineState()
    const startClientX = e.clientX

    const handleMove = (me: PointerEvent) => {
      if (!svgEl) return
      const dx = me.clientX - startClientX
      if (Math.abs(dx) < 2 && !isDraggingRef.current) return
      isDraggingRef.current = true

      const rect = svgEl.getBoundingClientRect()
      const newPos = Math.max(0, Math.min(sequenceLength, xToTime(me.clientX - rect.left)))

      if (mode === 'value') {
        const newValue = yToVal(me.clientY - rect.top)
        getTimelineStore().updateKeyframe(trackId, kf.id, { position: newPos, value: newValue })
      } else {
        getTimelineStore().updateKeyframe(trackId, kf.id, { position: newPos })
      }
    }

    const handleUp = () => {
      if (isDraggingRef.current) {
        fireTimelineMutation('Move keyframe', beforeRef.current)
      }
      isDraggingRef.current = false
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={isSelected ? 6 : 5}
      fill={isSelected ? 'rgb(72 198 207)' : 'rgb(28 36 50)'}
      stroke={isSelected ? '#8aebef' : 'rgb(72 198 207)'}
      strokeWidth={isSelected ? 2 : 1.5}
      style={{ cursor: 'move' }}
      onPointerDown={handlePointerDown}
    />
  )
}
