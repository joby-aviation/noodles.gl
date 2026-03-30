import { curveMonotoneX, line, scaleLinear } from 'd3'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface RampStop {
  id: string
  pos: number
  val: number
}

interface RampEditorProps {
  stops: RampStop[]
  onChange: (stops: RampStop[]) => void
  disabled?: boolean
  width?: number
  height?: number
}

const PAD = 12

export default function RampEditor({
  stops: stopsProp,
  onChange,
  disabled = false,
  width = 220,
  height = 100,
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

  const lineGen = useMemo(
    () =>
      line<RampStop>()
        .x(d => xScale(d.pos))
        .y(d => yScale(d.val))
        .curve(curveMonotoneX),
    [xScale, yScale]
  )

  const svgRef = useRef<SVGSVGElement>(null)
  // Keep ref in sync so closures inside event handlers always see latest stops
  const stopsRef = useRef(stops)
  useEffect(() => {
    stopsRef.current = stops
  })

  const [draggingId, setDraggingId] = useState<string | null>(null)

  const handleBgClick = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (disabled) return
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
        <path d={lineGen(sortedStops) ?? undefined} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
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
          {/* Visible control point */}
          <circle
            cx={xScale(stop.pos)}
            cy={yScale(stop.val)}
            r={4}
            fill={draggingId === stop.id ? '#60a5fa' : '#3b82f6'}
            stroke="#1e3a8a"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        </g>
      ))}
    </svg>
  )
}
