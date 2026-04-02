import { scaleLinear } from 'd3'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { monotoneSlopes } from '../operators'
import type { RampInterpType } from '../operators'

export interface RampStop {
  id: string
  pos: number
  val: number
  interp?: RampInterpType
}

interface RampEditorProps {
  stops: RampStop[]
  onChange: (stops: RampStop[]) => void
  disabled?: boolean
  width?: number
  height?: number
  activeStopId?: string | null
  onActivate?: (id: string) => void
}

const PAD = 12

// Build an SVG path string for the ramp curve, segment by segment.
// Each segment uses the interp type of the left (earlier) stop.
function buildRampPath(
  sortedStops: RampStop[],
  xScale: (v: number) => number,
  yScale: (v: number) => number
): string {
  if (sortedStops.length < 2) return ''

  const slopes = monotoneSlopes(sortedStops)
  const parts: string[] = [`M ${xScale(sortedStops[0].pos)} ${yScale(sortedStops[0].val)}`]

  for (let i = 0; i < sortedStops.length - 1; i++) {
    const s0 = sortedStops[i]
    const s1 = sortedStops[i + 1]
    const x0 = xScale(s0.pos)
    const y0 = yScale(s0.val)
    const x1 = xScale(s1.pos)
    const y1 = yScale(s1.val)
    const interp = s0.interp ?? 'linear'

    if (interp === 'hold') {
      // Step: horizontal then vertical
      parts.push(`L ${x1} ${y0} L ${x1} ${y1}`)
    } else if (interp === 'smooth') {
      // Cubic bezier from PCHIP slopes, converted to pixel space.
      // Data-space control points: (x0 + h/3, y0 + m0*h/3) and (x1 - h/3, y1 - m1*h/3)
      const h = s1.pos - s0.pos
      const cp1x = xScale(s0.pos + h / 3)
      const cp1y = yScale(s0.val + slopes[i] * (h / 3))
      const cp2x = xScale(s1.pos - h / 3)
      const cp2y = yScale(s1.val - slopes[i + 1] * (h / 3))
      parts.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x1} ${y1}`)
    } else {
      // linear
      parts.push(`L ${x1} ${y1}`)
    }
  }

  return parts.join(' ')
}

export default function RampEditor({
  stops: stopsProp,
  onChange,
  disabled = false,
  width = 220,
  height = 100,
  activeStopId,
  onActivate,
}: RampEditorProps) {
  const stops = stopsProp.length > 0 ? stopsProp : []

  const [yMin, yMax] = useMemo(() => {
    if (stops.length === 0) return [0, 1]
    const vals = stops.map(s => s.val)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const range = max - min || 1
    return [min - range * 0.15, max + range * 0.15]
  }, [stops])

  const xScale = useMemo(
    () => scaleLinear().domain([0, 1]).range([PAD, width - PAD]),
    [width]
  )

  const yScale = useMemo(
    () => scaleLinear().domain([yMin, yMax]).range([height - PAD, PAD]),
    [yMin, yMax, height]
  )

  const svgRef = useRef<SVGSVGElement>(null)
  // Keep ref in sync so closures inside event handlers always see latest stops
  const stopsRef = useRef(stops)
  useEffect(() => {
    stopsRef.current = stops
  })

  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Suppress the second click of a double-click (which would add two stops)
  const lastClickTimeRef = useRef(0)

  const handleBgClick = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (disabled) return
      const now = Date.now()
      if (now - lastClickTimeRef.current < 300) return
      lastClickTimeRef.current = now
      const rect = svgRef.current!.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const pos = Math.max(0, Math.min(1, xScale.invert(x)))
      const val = yScale.invert(y)
      const newStop: RampStop = { id: crypto.randomUUID(), pos, val }
      const newStops = [...stopsRef.current, newStop].sort((a, b) => a.pos - b.pos)
      onChange(newStops)
    },
    [disabled, xScale, yScale, onChange]
  )

  const handleStopMouseDown = useCallback(
    (e: React.MouseEvent<SVGCircleElement>, stopId: string) => {
      if (disabled) return
      e.stopPropagation()
      onActivate?.(stopId)
      // Capture scales at drag start — avoids jank when y-axis auto-rescales during drag
      const capturedXScale = xScale.copy()
      const capturedYScale = yScale.copy()
      setDraggingId(stopId)

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!svgRef.current) return
        const rect = svgRef.current.getBoundingClientRect()
        const x = moveEvent.clientX - rect.left
        const y = moveEvent.clientY - rect.top
        const newPos = Math.max(0, Math.min(1, capturedXScale.invert(x)))
        const newVal = capturedYScale.invert(y)
        const updated = stopsRef.current
          .map(s => (s.id === stopId ? { ...s, pos: newPos, val: newVal } : s))
          .sort((a, b) => a.pos - b.pos)
        onChange(updated)
      }

      const onMouseUp = () => {
        setDraggingId(null)
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [disabled, xScale, yScale, onChange]
  )

  const handleStopDoubleClick = useCallback(
    (e: React.MouseEvent, stopId: string) => {
      if (disabled) return
      e.stopPropagation()
      if (stopsRef.current.length <= 2) return
      onChange(stopsRef.current.filter(s => s.id !== stopId))
    },
    [disabled, onChange]
  )

  const sortedStops = useMemo(() => [...stops].sort((a, b) => a.pos - b.pos), [stops])
  const pathD = useMemo(
    () => buildRampPath(sortedStops, xScale, yScale),
    [sortedStops, xScale, yScale]
  )

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        display: 'block',
        background: '#1a1d22',
        borderRadius: 3,
        cursor: disabled ? 'default' : 'crosshair',
        userSelect: 'none',
      }}
    >
      {/* Clickable background to add stops */}
      <rect x={0} y={0} width={width} height={height} fill="transparent" onClick={handleBgClick} />
      {sortedStops.length >= 2 && (
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
      )}
      {sortedStops.map(stop => (
        <g key={stop.id}>
          {/* Large transparent hit area for easier grabbing */}
          <circle
            cx={xScale(stop.pos)}
            cy={yScale(stop.val)}
            r={8}
            fill="transparent"
            style={{ cursor: disabled ? 'default' : draggingId === stop.id ? 'grabbing' : 'grab' }}
            onMouseDown={e => handleStopMouseDown(e, stop.id)}
            onDoubleClick={e => handleStopDoubleClick(e, stop.id)}
          />
          {/* Visible control point — white when active, blue otherwise */}
          <circle
            cx={xScale(stop.pos)}
            cy={yScale(stop.val)}
            r={activeStopId === stop.id ? 5 : 4}
            fill={activeStopId === stop.id ? '#ffffff' : draggingId === stop.id ? '#60a5fa' : '#3b82f6'}
            stroke={activeStopId === stop.id ? '#3b82f6' : '#1e3a8a'}
            strokeWidth={1.5}
            pointerEvents="none"
          />
        </g>
      ))}
    </svg>
  )
}
