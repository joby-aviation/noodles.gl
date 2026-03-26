// Curve editor view — shows the value or speed graph for the selected track
// Replaces the keyframe-dot area when curve editor mode is active

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { evaluateTrack } from '../interpolation'
import {
  captureTimelineState,
  fireTimelineMutation,
  getTimelineStore,
  useTimelineStore,
} from '../timeline-store'
import type { HandleType, Keyframe, KeyframeValue, Track } from '../types'
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
  if (range === 0 || !Number.isFinite(range)) return 1
  const rough = range / targetCount
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)))
  for (const factor of [1, 2, 5, 10]) {
    if (factor * magnitude >= rough) return factor * magnitude
  }
  return rough
}

// Numerically compute the speed (dv/dt) at time t using central difference.
// Uses actual span as divisor so one-sided clamping at boundaries stays correct.
function computeSpeedAt(track: Track, t: number, sequenceLength: number): number {
  const dt = 0.001
  const tLo = Math.max(0, t - dt)
  const tHi = Math.min(sequenceLength, t + dt)
  const v1 = evaluateTrack(track, tLo)
  const v2 = evaluateTrack(track, tHi)
  const span = tHi - tLo
  return isNumericValue(v1) && isNumericValue(v2) && span > 0 ? (v2 - v1) / span : 0
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

  // ── Handle type context menu ────────────────────────────────────────────────

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    trackId: string
    keyframeId: string
  } | null>(null)

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  const setHandleType = useCallback((trackId: string, keyframeId: string, type: HandleType) => {
    const before = captureTimelineState()
    const { tracks, setKeyframeHandles } = getTimelineStore()
    const kf = tracks.get(trackId)?.keyframes.find(k => k.id === keyframeId)
    if (!kf) return
    const handles = kf.handles ?? DEFAULT_BEZIER_HANDLES
    setKeyframeHandles(trackId, keyframeId, { ...handles, type })
    fireTimelineMutation('Change handle type', before)
    setContextMenu(null)
  }, [])

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
        const tLo = Math.max(0, t - dt)
        const tHi = Math.min(sequenceLength, t + dt)
        const v1 = evaluateTrack(track, tLo)
        const v2 = evaluateTrack(track, tHi)
        const span = tHi - tLo
        pts.push(isNumericValue(v1) && isNumericValue(v2) && span > 0 ? (v2 - v1) / span : 0)
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

    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = -1
      hi = 1
    }
    if (lo === hi) {
      lo -= 1
      hi += 1
    }

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
    if (!Number.isFinite(range) || range === 0) return []
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

  // ── Speed Y-drag: update bezier handles to achieve a desired speed ─────────

  const updateKfSpeed = useCallback(
    (kfId: string, prevKfId: string | null, nextKfId: string | null, desiredSpeed: number) => {
      if (!track) return
      const { tracks, updateKeyframe, setKeyframeHandles } = getTimelineStore()
      const trackData = tracks.get(track.id)
      if (!trackData) return

      const kf = trackData.keyframes.find(k => k.id === kfId)
      const nextKf = nextKfId ? trackData.keyframes.find(k => k.id === nextKfId) : null
      const prevKf = prevKfId ? trackData.keyframes.find(k => k.id === prevKfId) : null
      if (!kf) return

      // Ensure bezier interpolation so handles apply
      if (kf.interpolation !== 'bezier') {
        updateKeyframe(track.id, kfId, { interpolation: 'bezier' })
      }

      // Re-read after potential mutation so we get any freshly-initialized handles
      const freshKf = tracks.get(track.id)?.keyframes.find(k => k.id === kfId)
      const handles = freshKf?.handles ?? DEFAULT_BEZIER_HANDLES

      // Update outgoing speed: kf.handles.left = P1 of segment kf→nextKf
      // outSpeed = P1y/P1x * (Δv/Δt)  →  P1y = desiredSpeed * P1x * Δt/Δv
      if (nextKf && isNumericValue(kf.value) && isNumericValue(nextKf.value)) {
        const ΔtNext = nextKf.position - kf.position
        const ΔvNext = (nextKf.value as number) - (kf.value as number)
        if (ΔtNext > 0 && Math.abs(ΔvNext) > 0.0001) {
          const p1x = Math.max(0.001, handles.left[0])
          const newP1y = (desiredSpeed * p1x * ΔtNext) / ΔvNext
          setKeyframeHandles(track.id, kfId, {
            ...handles,
            left: [p1x, newP1y],
          })
        }
      }

      // For aligned/uneven handles, also mirror the incoming speed
      const updatedHandles =
        tracks.get(track.id)?.keyframes.find(k => k.id === kfId)?.handles ?? handles
      if (
        (updatedHandles.type === 'aligned' || updatedHandles.type === 'uneven') &&
        prevKf &&
        isNumericValue(kf.value) &&
        isNumericValue(prevKf.value)
      ) {
        const ΔtPrev = kf.position - prevKf.position
        const ΔvPrev = (kf.value as number) - (prevKf.value as number)
        if (ΔtPrev > 0 && Math.abs(ΔvPrev) > 0.0001) {
          const prevKfLatest = tracks.get(track.id)?.keyframes.find(k => k.id === prevKf.id)
          const prevHandles = prevKfLatest?.handles ?? DEFAULT_BEZIER_HANDLES
          const p2x = Math.min(0.999, prevHandles.right[0])
          const newP2y = 1 - (desiredSpeed * (1 - p2x) * ΔtPrev) / ΔvPrev
          setKeyframeHandles(track.id, prevKf.id, {
            ...prevHandles,
            right: [p2x, newP2y],
          })
        }
      }
    },
    [track]
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
      <svg
        width={timelineWidth}
        height={height}
        style={{ display: 'block' }}
        onMouseDown={handleMouseDown}
      >
        <title>Timeline curve editor</title>
        {/* Horizontal grid lines */}
        {gridValues.map(v => {
          const y = valToY(v)
          const isZero = Math.abs(v) < Math.abs(maxVal - minVal) * 0.001
          const label =
            Math.abs(v) >= 10000
              ? v.toExponential(1)
              : Math.abs(v) >= 1
                ? v.toFixed(0)
                : v.toPrecision(2)
          return (
            <g key={`grid-${v}`}>
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

        {/* Speed influence handles for selected keyframes (speed mode only) */}
        {mode === 'speed' &&
          track.keyframes.map((kf, i) => {
            if (!isNumericValue(kf.value)) return null
            if (!selectedKeyframeIds.has(kf.id)) return null

            const prevKf = i > 0 ? track.keyframes[i - 1] : null
            const nextKf = i < track.keyframes.length - 1 ? track.keyframes[i + 1] : null

            const kx = timeToX(kf.position)
            const ky = valToY(computeSpeedAt(track, kf.position, sequenceLength))

            // Incoming influence handle (red): P2 of segment prevKf→kf, stored on prevKf.handles.right
            let incomingHandleEl = null
            if (prevKf && isNumericValue(prevKf.value)) {
              const ΔtPrev = kf.position - prevKf.position
              const ΔvPrev = (kf.value as number) - (prevKf.value as number)

              if (ΔtPrev > 0 && Math.abs(ΔvPrev) > 0.0001) {
                const prevHandles = prevKf.handles ?? DEFAULT_BEZIER_HANDLES
                const p2x = Math.min(0.999, prevHandles.right[0])
                const denom = 1 - p2x

                const inSpeed =
                  denom > 0.0001
                    ? ((1 - prevHandles.right[1]) / denom) * (ΔvPrev / ΔtPrev)
                    : computeSpeedAt(track, kf.position, sequenceLength)

                const ihx = timeToX(prevKf.position + p2x * ΔtPrev)
                const ihy = valToY(inSpeed)

                incomingHandleEl = (
                  <>
                    <line
                      x1={kx}
                      y1={ky}
                      x2={ihx}
                      y2={ihy}
                      stroke="rgb(100 100 130/0.55)"
                      strokeWidth={1}
                      strokeDasharray="3 2"
                      style={{ pointerEvents: 'none' }}
                    />
                    <BezierHandleDot
                      cx={ihx}
                      cy={ihy}
                      color="#ff6b6b"
                      strokeColor="#ff9999"
                      onDrag={(svgX, svgY) => {
                        const { tracks, updateKeyframe, setKeyframeHandles } = getTimelineStore()
                        const latestPrev = tracks
                          .get(track.id)
                          ?.keyframes.find(k => k.id === prevKf.id)
                        const latestKf = tracks.get(track.id)?.keyframes.find(k => k.id === kf.id)
                        if (!latestPrev || !latestKf) return
                        if (latestPrev.interpolation !== 'bezier') {
                          updateKeyframe(track.id, prevKf.id, { interpolation: 'bezier' })
                        }

                        // Re-read after potential mutation to get fresh handles
                        const freshPrev = tracks
                          .get(track.id)
                          ?.keyframes.find(k => k.id === prevKf.id)
                        const ph = freshPrev?.handles ?? DEFAULT_BEZIER_HANDLES

                        const newHandleTime = xToTime(svgX)
                        const newP2x = Math.max(
                          0.001,
                          Math.min(0.999, (newHandleTime - prevKf.position) / (ΔtPrev || 1))
                        )
                        const newSpeed = yToVal(svgY)
                        const newDenom = 1 - newP2x
                        const newP2y =
                          newDenom > 0.0001
                            ? 1 - (newSpeed * newDenom * ΔtPrev) / ΔvPrev
                            : ph.right[1]
                        setKeyframeHandles(track.id, prevKf.id, {
                          ...ph,
                          right: [newP2x, newP2y],
                        })

                        // Mirror to outgoing if aligned/uneven
                        const curHandles = latestKf.handles ?? DEFAULT_BEZIER_HANDLES
                        if (curHandles.type === 'aligned' || curHandles.type === 'uneven') {
                          if (nextKf && isNumericValue(nextKf.value)) {
                            const ΔtNext = nextKf.position - kf.position
                            const ΔvNext = (nextKf.value as number) - (kf.value as number)
                            if (ΔtNext > 0 && Math.abs(ΔvNext) > 0.0001) {
                              const p1x = Math.max(0.001, curHandles.left[0])
                              const newP1y = (newSpeed * p1x * ΔtNext) / ΔvNext
                              setKeyframeHandles(track.id, kf.id, {
                                ...curHandles,
                                left: [p1x, newP1y],
                              })
                            }
                          }
                        }
                      }}
                      onDragEnd={before => fireTimelineMutation('Adjust speed handles', before)}
                    />
                  </>
                )
              }
            }

            // Outgoing influence handle (green): P1 of segment kf→nextKf, stored on kf.handles.left
            let outgoingHandleEl = null
            if (nextKf && isNumericValue(nextKf.value)) {
              const ΔtNext = nextKf.position - kf.position
              const ΔvNext = (nextKf.value as number) - (kf.value as number)

              if (ΔtNext > 0 && Math.abs(ΔvNext) > 0.0001) {
                const handles = kf.handles ?? DEFAULT_BEZIER_HANDLES
                const p1x = Math.max(0.001, handles.left[0])

                const outSpeed =
                  p1x > 0.0001
                    ? (handles.left[1] / p1x) * (ΔvNext / ΔtNext)
                    : computeSpeedAt(track, kf.position, sequenceLength)

                const ohx = timeToX(kf.position + p1x * ΔtNext)
                const ohy = valToY(outSpeed)

                outgoingHandleEl = (
                  <>
                    <line
                      x1={kx}
                      y1={ky}
                      x2={ohx}
                      y2={ohy}
                      stroke="rgb(100 100 130/0.55)"
                      strokeWidth={1}
                      strokeDasharray="3 2"
                      style={{ pointerEvents: 'none' }}
                    />
                    <BezierHandleDot
                      cx={ohx}
                      cy={ohy}
                      color="#51cf66"
                      strokeColor="#82e6a0"
                      onDrag={(svgX, svgY) => {
                        const { tracks, updateKeyframe, setKeyframeHandles } = getTimelineStore()
                        const latestKf = tracks.get(track.id)?.keyframes.find(k => k.id === kf.id)
                        if (!latestKf) return
                        if (latestKf.interpolation !== 'bezier') {
                          updateKeyframe(track.id, kf.id, { interpolation: 'bezier' })
                        }

                        // Re-read after potential mutation to get fresh handles
                        const freshKf = tracks.get(track.id)?.keyframes.find(k => k.id === kf.id)
                        const curHandles = freshKf?.handles ?? DEFAULT_BEZIER_HANDLES

                        const newHandleTime = xToTime(svgX)
                        const newP1x = Math.max(
                          0.001,
                          Math.min(0.999, (newHandleTime - kf.position) / (ΔtNext || 1))
                        )
                        const newSpeed = yToVal(svgY)
                        const newP1y =
                          newP1x > 0.0001
                            ? (newSpeed * newP1x * ΔtNext) / ΔvNext
                            : curHandles.left[1]
                        setKeyframeHandles(track.id, kf.id, {
                          ...curHandles,
                          left: [newP1x, newP1y],
                        })

                        // Mirror to incoming if aligned/uneven
                        if (curHandles.type === 'aligned' || curHandles.type === 'uneven') {
                          if (prevKf && isNumericValue(prevKf.value)) {
                            const ΔtPrev = kf.position - prevKf.position
                            const ΔvPrev = (kf.value as number) - (prevKf.value as number)
                            if (ΔtPrev > 0 && Math.abs(ΔvPrev) > 0.0001) {
                              const prevLatest = tracks
                                .get(track.id)
                                ?.keyframes.find(k => k.id === prevKf.id)
                              const prevHandles = prevLatest?.handles ?? DEFAULT_BEZIER_HANDLES
                              const p2x = Math.min(0.999, prevHandles.right[0])
                              const denom = 1 - p2x
                              const newP2y =
                                denom > 0.0001
                                  ? 1 - (newSpeed * denom * ΔtPrev) / ΔvPrev
                                  : prevHandles.right[1]
                              setKeyframeHandles(track.id, prevKf.id, {
                                ...prevHandles,
                                right: [p2x, newP2y],
                              })
                            }
                          }
                        }
                      }}
                      onDragEnd={before => fireTimelineMutation('Adjust speed handles', before)}
                    />
                  </>
                )
              }
            }

            return (
              <g key={`speed-handles-${kf.id}`}>
                {incomingHandleEl}
                {outgoingHandleEl}
              </g>
            )
          })}

        {/* Bezier handles for selected keyframes (value mode only) */}
        {mode === 'value' &&
          track.keyframes.map((kf, i) => {
            if (!isNumericValue(kf.value)) return null
            if (!selectedKeyframeIds.has(kf.id)) return null

            const prevKf = i > 0 ? track.keyframes[i - 1] : null
            const nextKf = i < track.keyframes.length - 1 ? track.keyframes[i + 1] : null

            const kx = timeToX(kf.position)
            const ky = valToY(kf.value as number)

            // LEFT HANDLE (incoming to this keyframe)
            // Stored on PREVIOUS keyframe as handles.right
            // Only show if there's a previous keyframe (no left handle for first keyframe)
            let leftHandleEl = null
            if (prevKf && isNumericValue(prevKf.value)) {
              const prevHandles = prevKf.handles ?? DEFAULT_BEZIER_HANDLES
              const ΔtPrev = kf.position - prevKf.position
              const ΔvPrev = (kf.value as number) - (prevKf.value as number)
              // Use offset (0.67) if handle is at 1 (would overlap current keyframe)
              const rightX = prevHandles.right[0] === 1 ? 0.67 : prevHandles.right[0]
              const rightY = prevHandles.right[0] === 1 ? 0.67 : prevHandles.right[1]
              // handles.right position is relative to prev keyframe
              const lhx = timeToX(prevKf.position + rightX * ΔtPrev)
              const lhy = valToY((prevKf.value as number) + rightY * ΔvPrev)

              leftHandleEl = (
                <>
                  <line
                    x1={kx}
                    y1={ky}
                    x2={lhx}
                    y2={lhy}
                    stroke="rgb(100 100 130/0.55)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    style={{ pointerEvents: 'none' }}
                  />
                  <BezierHandleDot
                    cx={lhx}
                    cy={lhy}
                    color="#ff6b6b"
                    strokeColor="#ff9999"
                    onDrag={(svgX, svgY) => {
                      // Update PREVIOUS keyframe's handles.right
                      const { tracks, updateKeyframe, setKeyframeHandles } = getTimelineStore()
                      const prev = tracks.get(track.id)?.keyframes.find(k => k.id === prevKf.id)
                      if (prev?.interpolation !== 'bezier') {
                        updateKeyframe(track.id, prevKf.id, {
                          interpolation: 'bezier',
                        })
                      }
                      const prevH = prev?.handles ?? DEFAULT_BEZIER_HANDLES
                      const newRx = Math.max(
                        0,
                        Math.min(1, (xToTime(svgX) - prevKf.position) / (ΔtPrev || 1))
                      )
                      const newRy = (yToVal(svgY) - (prevKf.value as number)) / (ΔvPrev || 1)
                      setKeyframeHandles(track.id, prevKf.id, {
                        ...prevH,
                        right: [newRx, newRy],
                      })

                      // Mirror to opposite handle if aligned or uneven
                      const curKf = tracks.get(track.id)?.keyframes.find(k => k.id === kf.id)
                      const curHandles = curKf?.handles ?? DEFAULT_BEZIER_HANDLES
                      if (curHandles.type === 'aligned' || curHandles.type === 'uneven') {
                        // Calculate pixel offset from keyframe
                        const offsetX = svgX - kx
                        const offsetY = svgY - ky
                        // Mirror: negate the offset
                        const mirrorX = -offsetX
                        const mirrorY = -offsetY

                        if (nextKf && isNumericValue(nextKf.value)) {
                          const ΔtN = nextKf.position - kf.position
                          const ΔvN = (nextKf.value as number) - (kf.value as number)
                          // Convert mirrored pixel offset to normalized coords for handles.left
                          let mirrorLx = xToTime(kx + mirrorX) - kf.position
                          mirrorLx = Math.max(0, Math.min(1, mirrorLx / (ΔtN || 1)))
                          let mirrorLy = (yToVal(ky + mirrorY) - (kf.value as number)) / (ΔvN || 1)

                          if (curHandles.type === 'uneven') {
                            // Preserve original length, just change angle
                            const origLen = Math.sqrt(
                              curHandles.left[0] ** 2 + curHandles.left[1] ** 2
                            )
                            const newLen = Math.sqrt(mirrorLx ** 2 + mirrorLy ** 2)
                            if (newLen > 0.001) {
                              mirrorLx = (mirrorLx / newLen) * origLen
                              mirrorLy = (mirrorLy / newLen) * origLen
                            }
                          }

                          setKeyframeHandles(track.id, kf.id, {
                            ...curHandles,
                            left: [Math.max(0, Math.min(1, mirrorLx)), mirrorLy],
                          })
                        }
                      }
                    }}
                    onDragEnd={before => fireTimelineMutation('Adjust bezier handles', before)}
                  />
                </>
              )
            }

            // RIGHT HANDLE (outgoing from this keyframe)
            // Stored on THIS keyframe as handles.left
            // Only show if there's a next keyframe (no right handle for last keyframe)
            let rightHandleEl = null
            if (nextKf && isNumericValue(nextKf.value)) {
              const handles = kf.handles ?? DEFAULT_BEZIER_HANDLES
              const ΔtNext = nextKf.position - kf.position
              const ΔvNext = (nextKf.value as number) - (kf.value as number)
              // Use minimum offset (0.33) if handle is at 0 (would overlap keyframe)
              const leftX = handles.left[0] === 0 ? 0.33 : handles.left[0]
              const leftY = handles.left[0] === 0 ? 0.33 : handles.left[1]
              const rhx = timeToX(kf.position + leftX * ΔtNext)
              const rhy = valToY((kf.value as number) + leftY * ΔvNext)

              rightHandleEl = (
                <>
                  <line
                    x1={kx}
                    y1={ky}
                    x2={rhx}
                    y2={rhy}
                    stroke="rgb(100 100 130/0.55)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    style={{ pointerEvents: 'none' }}
                  />
                  <BezierHandleDot
                    cx={rhx}
                    cy={rhy}
                    color="#51cf66"
                    strokeColor="#82e6a0"
                    onDrag={(svgX, svgY) => {
                      // Update THIS keyframe's handles.left
                      const { tracks, updateKeyframe, setKeyframeHandles } = getTimelineStore()
                      const cur = tracks.get(track.id)?.keyframes.find(k => k.id === kf.id)
                      if (cur?.interpolation !== 'bezier') {
                        updateKeyframe(track.id, kf.id, {
                          interpolation: 'bezier',
                        })
                      }
                      const curHandles = cur?.handles ?? DEFAULT_BEZIER_HANDLES
                      const newLx = Math.max(
                        0,
                        Math.min(1, (xToTime(svgX) - kf.position) / (ΔtNext || 1))
                      )
                      const newLy = (yToVal(svgY) - (kf.value as number)) / (ΔvNext || 1)
                      setKeyframeHandles(track.id, kf.id, {
                        ...curHandles,
                        left: [newLx, newLy],
                      })

                      // Mirror to opposite handle if aligned or uneven
                      if (curHandles.type === 'aligned' || curHandles.type === 'uneven') {
                        // Calculate pixel offset from keyframe
                        const offsetX = svgX - kx
                        const offsetY = svgY - ky
                        // Mirror: negate the offset
                        const mirrorX = -offsetX
                        const mirrorY = -offsetY

                        if (prevKf && isNumericValue(prevKf.value)) {
                          const ΔtP = kf.position - prevKf.position
                          const ΔvP = (kf.value as number) - (prevKf.value as number)
                          const prevH =
                            tracks.get(track.id)?.keyframes.find(k => k.id === prevKf.id)
                              ?.handles ?? DEFAULT_BEZIER_HANDLES
                          // Convert mirrored pixel offset to normalized coords for handles.right
                          // handles.right is relative to prevKf, so we need to translate
                          let mirrorRx = xToTime(kx + mirrorX) - prevKf.position
                          mirrorRx = Math.max(0, Math.min(1, mirrorRx / (ΔtP || 1)))
                          let mirrorRy =
                            (yToVal(ky + mirrorY) - (prevKf.value as number)) / (ΔvP || 1)

                          if (curHandles.type === 'uneven') {
                            // Preserve original length, just change angle
                            const origLen = Math.sqrt(prevH.right[0] ** 2 + prevH.right[1] ** 2)
                            const newLen = Math.sqrt(mirrorRx ** 2 + mirrorRy ** 2)
                            if (newLen > 0.001) {
                              mirrorRx = (mirrorRx / newLen) * origLen
                              mirrorRy = (mirrorRy / newLen) * origLen
                            }
                          }

                          setKeyframeHandles(track.id, prevKf.id, {
                            ...prevH,
                            right: [Math.max(0, Math.min(1, mirrorRx)), mirrorRy],
                          })
                        }
                      }
                    }}
                    onDragEnd={before => fireTimelineMutation('Adjust bezier handles', before)}
                  />
                </>
              )
            }

            return (
              <g key={`handles-${kf.id}`}>
                {leftHandleEl}
                {rightHandleEl}
              </g>
            )
          })}

        {/* Keyframe dots */}
        {track.keyframes.map((kf, i) => {
          if (!isNumericValue(kf.value)) return null

          const prevKf = i > 0 ? track.keyframes[i - 1] : null
          const nextKf = i < track.keyframes.length - 1 ? track.keyframes[i + 1] : null

          // In speed mode, place the dot on the speed curve (not at the value)
          const cy =
            mode === 'speed'
              ? valToY(computeSpeedAt(track, kf.position, sequenceLength))
              : valToY(kf.value as number)

          return (
            <CurveKeyframeDot
              key={kf.id}
              kf={kf}
              trackId={track.id}
              cx={timeToX(kf.position)}
              cy={cy}
              isSelected={selectedKeyframeIds.has(kf.id)}
              mode={mode}
              sequenceLength={sequenceLength}
              xToTime={xToTime}
              yToVal={yToVal}
              onSelect={selectKeyframe}
              onContextMenu={(e, keyframe) => {
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  trackId: track.id,
                  keyframeId: keyframe.id,
                })
              }}
              onSpeedYDrag={
                mode === 'speed'
                  ? (svgY: number) => {
                      const desiredSpeed = yToVal(svgY)
                      updateKfSpeed(kf.id, prevKf?.id ?? null, nextKf?.id ?? null, desiredSpeed)
                    }
                  : undefined
              }
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

      {/* Handle type context menu */}
      {contextMenu &&
        createPortal(
          <div
            className={s.handleTypeMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onPointerDown={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setHandleType(contextMenu.trackId, contextMenu.keyframeId, 'aligned')}
            >
              Aligned (Smooth)
            </button>
            <button
              type="button"
              onClick={() => setHandleType(contextMenu.trackId, contextMenu.keyframeId, 'uneven')}
            >
              Uneven
            </button>
            <button
              type="button"
              onClick={() => setHandleType(contextMenu.trackId, contextMenu.keyframeId, 'free')}
            >
              Free (Broken)
            </button>
          </div>,
          document.body
        )}
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
  onContextMenu: (e: React.PointerEvent<SVGCircleElement>, kf: Keyframe) => void
  // Called with raw SVG Y coordinate when dragging in speed mode
  onSpeedYDrag?: (svgY: number) => void
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
  onContextMenu,
  onSpeedYDrag,
}: CurveKeyframeDotProps) {
  const isDraggingRef = useRef(false)
  const beforeRef = useRef('')

  const handlePointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      onContextMenu(e, kf)
      return
    }
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

      const { updateKeyframe } = getTimelineStore()
      if (mode === 'value') {
        const newValue = yToVal(me.clientY - rect.top)
        updateKeyframe(trackId, kf.id, { position: newPos, value: newValue })
      } else if (mode === 'speed' && onSpeedYDrag) {
        // X: update timeline position
        updateKeyframe(trackId, kf.id, { position: newPos })
        // Y: update bezier handles to achieve the dragged speed
        onSpeedYDrag(me.clientY - rect.top)
      } else {
        updateKeyframe(trackId, kf.id, { position: newPos })
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
      onContextMenu={e => e.preventDefault()}
    />
  )
}
